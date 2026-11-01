import "server-only";
import fs from "node:fs";
import path from "node:path";
import MailComposer from "nodemailer/lib/mail-composer";
import nodemailer from "nodemailer";
import sanitizeHtml from "sanitize-html";
import type { ImapFlow } from "imapflow";
import { config } from "./config";
import { decrypt, encrypt, randomId, sha256 } from "./crypto";
import { db } from "./db";
import { BadRequest, appendMessage, loadParsed, parseMsgId, applyAction, rolePath } from "./mail";
import { inMailbox, withImap } from "./imap";
import { anySessionFor, getAccessToken } from "./session";
import type { Identity } from "../types";
import { lookupUser } from "./ldap";

const uploadDir = (user: string) => path.join(config.dataDir, "uploads", sha256(user).slice(0, 32));

export type UploadMeta = { id: string; filename: string; contentType: string; size: number; created: number };

export function saveUpload(user: string, filename: string, contentType: string, data: Buffer): UploadMeta {
  if (data.length > config.maxAttachmentBytes) throw new BadRequest("Attachments can be up to 25 MB.");
  const dir = uploadDir(user);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const id = randomId(18);
  const meta: UploadMeta = {
    id,
    filename: (filename || "attachment").replace(/[\x00-\x1f/\\]/g, "_").slice(0, 200),
    contentType: /^[\w.+-]+\/[\w.+-]+$/.test(contentType) ? contentType : "application/octet-stream",
    size: data.length,
    created: Date.now(),
  };
  fs.writeFileSync(path.join(dir, id), encrypt(data, user + id), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, id + ".json"), encrypt(JSON.stringify(meta), user + id), { mode: 0o600 });
  return meta;
}

function loadUpload(user: string, id: string): { meta: UploadMeta; data: Buffer } {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(id)) throw new BadRequest("Bad upload id");
  const dir = uploadDir(user);
  try {
    const meta = JSON.parse(decrypt(fs.readFileSync(path.join(dir, id + ".json"), "utf8"), user + id).toString()) as UploadMeta;
    const data = decrypt(fs.readFileSync(path.join(dir, id), "utf8"), user + id);
    return { meta, data };
  } catch {
    throw new BadRequest("Attachment expired, please re-attach it");
  }
}

export function cleanupUploads() {
  const root = path.join(config.dataDir, "uploads");
  const cutoff = Date.now() - 3 * 86400_000;
  try {
    for (const d of fs.readdirSync(root)) {
      for (const f of fs.readdirSync(path.join(root, d))) {
        const p = path.join(root, d, f);
        if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
      }
    }
  } catch {
  }
}

export type AttachmentRef = { upload: string } | { msg: string; part: string };

export type Draft = {
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html: string;
  plain?: boolean;
  attachments: AttachmentRef[];
  inReplyTo?: string;
  references?: string[];
};

export async function identitiesFor(username: string, displayName: string, tjEmail?: string | null): Promise<Identity[]> {
  const name = displayName || username;
  const ldap = await lookupUser(username);
  if (ldap?.mails.length) return [...new Set(ldap.mails.map((m) => m.toLowerCase()))].map((address) => ({ name, address }));
  const primary = (tjEmail && tjEmail.toLowerCase().endsWith("@" + config.mailDomain) ? tjEmail : `${username}@${config.mailDomain}`).toLowerCase();
  return [{ name, address: primary }];
}

function cleanComposeHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "span", "font", "u", "s", "strike", "center", "h1", "h2", "h3"]),
    allowedAttributes: {
      "*": ["style", "align", "dir", "color", "face", "size"],
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "data", "cid"],
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
  });
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const HEADER_SAFE = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, 998);
const ADDR_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export function parseAddresses(list: string): { name: string; address: string }[] {
  const out: { name: string; address: string }[] = [];
  const parts = (list || "").match(/("[^"]*"|[^,;])+/g) || [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const m = /^(.*)<([^>]+)>\s*$/.exec(p);
    const address = (m ? m[2] : p).trim();
    const name = m ? m[1].trim().replace(/^"|"$/g, "") : "";
    if (!ADDR_RE.test(address)) throw new BadRequest(`Invalid address: ${address}`);
    out.push({ name: HEADER_SAFE(name), address });
  }
  return out;
}

async function resolveAttachments(client: ImapFlow | null, user: string, refs: AttachmentRef[]) {
  const out: { filename: string; contentType: string; content: Buffer }[] = [];
  for (const r of refs.slice(0, 100)) {
    if ("upload" in r) {
      const { meta, data } = loadUpload(user, r.upload);
      out.push({ filename: meta.filename, contentType: meta.contentType, content: data });
    } else if (client) {
      parseMsgId(r.msg);
      const parsed = await loadParsed(client, user, r.msg);
      const a = parsed.attachments[Number(r.part)];
      if (a) out.push({ filename: a.filename || "attachment", contentType: a.contentType, content: a.content });
    }
  }
  return out;
}

export async function buildMessage(client: ImapFlow | null, user: string, identities: Identity[], d: Draft, opts: { forDraft: boolean }) {
  const ident = identities.find((i) => i.address.toLowerCase() === (d.from || "").toLowerCase()) ?? identities[0];
  if (!opts.forDraft && d.from && ident.address.toLowerCase() !== d.from.toLowerCase()) throw new BadRequest("You can't send from that address");
  const to = parseAddresses(d.to);
  const cc = parseAddresses(d.cc);
  const bcc = parseAddresses(d.bcc);
  if (!opts.forDraft && !to.length && !cc.length && !bcc.length) throw new BadRequest("Please specify at least one recipient.");
  if (to.length + cc.length + bcc.length > 500) throw new BadRequest("Too many recipients");
  const attachments = await resolveAttachments(client, user, d.attachments || []);
  const html = d.plain ? undefined : cleanComposeHtml(d.html || "");
  const text = d.plain ? htmlToPlain(d.html || "") : htmlToPlain(html || "");
  const refs = (d.references || []).filter((r) => /^<[^<>\s]+>$/.test(r)).slice(-20);
  const inReplyTo = d.inReplyTo && /^<[^<>\s]+>$/.test(d.inReplyTo) ? d.inReplyTo : undefined;
  const mail = new MailComposer({
    from: { name: HEADER_SAFE(ident.name), address: ident.address },
    to,
    cc,
    bcc,
    subject: HEADER_SAFE(d.subject || ""),
    text,
    html,
    attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
    inReplyTo,
    references: refs.length ? refs : undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
    headers: { "X-Mailer": "TJHSST Webmail" },
    messageId: `<${randomId(16)}@${config.mailDomain}>`,
  });
  const node = mail.compile();
  node.keepBcc = true;
  const withBcc = await node.build();
  if (attachments.reduce((n, a) => n + a.content.length, 0) > config.maxAttachmentBytes) throw new BadRequest("Attachments can be up to 25 MB in total.");
  if (withBcc.length > config.maxMessageBytes) throw new BadRequest("This message is larger than the mail server's 35 MB limit.");
  const envelope = node.getEnvelope();
  node.keepBcc = false;
  const raw = await node.build();
  return { raw, withBcc, envelope, from: ident.address, summary: { to: [...to, ...cc, ...bcc].map((x) => x.name || x.address).join(", "), subject: d.subject || "" } };
}

export async function smtpSend(username: string, accessToken: string, envelope: { from: string | false; to: string[] }, raw: Buffer) {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    requireTLS: true,
    auth: { type: "OAuth2", user: username, accessToken },
    tls: { rejectUnauthorized: !config.devTlsInsecure, minVersion: "TLSv1.2" },
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
    logger: false,
  });
  try {
    await transport.sendMail({ envelope: { from: envelope.from || undefined, to: envelope.to }, raw });
  } finally {
    transport.close();
  }
}

type Payload = { from: string; to: string[]; raw: string; withBcc: string; draftId?: string };

export function enqueue(user: string, sendAt: number, built: Awaited<ReturnType<typeof buildMessage>>, kind: "undo" | "scheduled", draftId?: string): string {
  const id = randomId(12);
  const payload: Payload = { from: built.from, to: built.envelope.to, raw: built.raw.toString("base64"), withBcc: built.withBcc.toString("base64"), draftId };
  db()
    .prepare("INSERT INTO scheduled (id, username, send_at, payload, summary, status) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, user, sendAt, encrypt(JSON.stringify(payload), "sched:" + id), JSON.stringify({ ...built.summary, kind, date: new Date().toISOString() }), "pending");
  if (sendAt - Date.now() < 60_000) setTimeout(() => runDue().catch(() => {}), Math.max(0, sendAt - Date.now()) + 50).unref?.();
  return id;
}

export function cancelQueued(user: string, id: string): boolean {
  const r = db().prepare("UPDATE scheduled SET status = 'cancelled' WHERE id = ? AND username = ? AND status = 'pending'").run(id, user);
  return Number(r.changes) > 0;
}

export function listScheduled(user: string) {
  return (db().prepare("SELECT id, send_at, summary, status, error FROM scheduled WHERE username = ? AND status IN ('pending','failed') ORDER BY send_at").all(user) as { id: string; send_at: number; summary: string; status: string; error: string | null }[])
    .map((r) => ({ id: r.id, sendAt: r.send_at, status: r.status, error: r.error, ...JSON.parse(r.summary) }))
    .filter((r) => r.kind === "scheduled" || r.status === "failed");
}

let running = false;
export async function runDue() {
  if (running) return;
  running = true;
  try {
    db().prepare("UPDATE scheduled SET status = 'failed', error = 'Interrupted while sending; it may or may not have been delivered. Check Sent.' WHERE status = 'sending' AND send_at < ?").run(Date.now() - 10 * 60_000);
    const due = db().prepare("SELECT id, username, payload FROM scheduled WHERE status = 'pending' AND send_at <= ? ORDER BY send_at LIMIT 20").all(Date.now()) as { id: string; username: string; payload: string }[];
    for (const row of due) {
      const claimed = db().prepare("UPDATE scheduled SET status = 'sending' WHERE id = ? AND status = 'pending'").run(row.id);
      if (!Number(claimed.changes)) continue;
      try {
        const p = JSON.parse(decrypt(row.payload, "sched:" + row.id).toString()) as Payload;
        const idHash = anySessionFor(row.username);
        if (!idHash) throw new Error("Not signed in; sign in again to send this message");
        const token = await getAccessToken(idHash);
        await smtpSend(row.username, token, { from: p.from, to: p.to }, Buffer.from(p.raw, "base64"));
        db().prepare("UPDATE scheduled SET status = 'sent', payload = '' WHERE id = ?").run(row.id);
        await withImap(row.username, idHash, async (c) => {
          await appendMessage(c, row.username, "sent", Buffer.from(p.withBcc, "base64"), ["\\Seen"]);
          if (p.draftId) await applyAction(c, row.username, [p.draftId], "delete").catch(() => {});
        }).catch(() => {});
      } catch (e) {
        db().prepare("UPDATE scheduled SET status = 'failed', error = ? WHERE id = ?").run(String((e as Error).message).slice(0, 300), row.id);
      }
    }
    await wakeSnoozed();
  } finally {
    running = false;
  }
}

export function recordSnooze(user: string, messageId: string, until: number) {
  db().prepare("INSERT INTO snoozed (username, message_id, until) VALUES (?, ?, ?)").run(user, messageId, until);
}

async function wakeSnoozed() {
  const due = db().prepare("SELECT id, username, message_id FROM snoozed WHERE until <= ? LIMIT 50").all(Date.now()) as { id: number; username: string; message_id: string }[];
  for (const s of due) {
    const idHash = anySessionFor(s.username);
    if (!idHash) continue;
    try {
      await withImap(s.username, idHash, async (c) => {
        const path = await rolePath(c, s.username, "snoozed");
        await inMailbox(c, path, async () => {
          const uids = await c.search({ header: { "message-id": s.message_id } }, { uid: true });
          if (Array.isArray(uids) && uids.length) {
            await c.messageFlagsRemove(uids.join(","), ["\\Seen"], { uid: true });
            await c.messageMove(uids.join(","), "INBOX", { uid: true });
          }
        });
      });
      db().prepare("DELETE FROM snoozed WHERE id = ?").run(s.id);
    } catch {
    }
  }
}

export function snoozeUntilFor(user: string): Map<string, number> {
  const rows = db().prepare("SELECT message_id, until FROM snoozed WHERE username = ?").all(user) as { message_id: string; until: number }[];
  return new Map(rows.map((r) => [r.message_id, r.until]));
}

const g = globalThis as unknown as { __webmailTicker?: NodeJS.Timeout };
export function ensureScheduler() {
  if (g.__webmailTicker) return;
  g.__webmailTicker = setInterval(() => {
    runDue().catch(() => {});
  }, 15_000);
  g.__webmailTicker.unref?.();
  setInterval(cleanupUploads, 3600_000).unref?.();
}

export function normalize(d: Partial<Draft>): Draft {
  return {
    from: String(d.from || ""),
    to: String(d.to || ""),
    cc: String(d.cc || ""),
    bcc: String(d.bcc || ""),
    subject: String(d.subject || ""),
    html: String(d.html || ""),
    plain: !!d.plain,
    attachments: Array.isArray(d.attachments) ? d.attachments.filter((a) => a && typeof a === "object") : [],
    inReplyTo: d.inReplyTo ? String(d.inReplyTo) : undefined,
    references: Array.isArray(d.references) ? d.references.map(String) : undefined,
  };
}
