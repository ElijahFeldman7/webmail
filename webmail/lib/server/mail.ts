import "server-only";
import type { ImapFlow, FetchMessageObject, MessageStructureObject, SearchObject, ListResponse } from "imapflow";
import { simpleParser, ParsedMail } from "mailparser";
import iconv from "iconv-lite";
import type { Addr, Category, CategoryTabInfo, Folder, FolderRole, ListResult, MessageDetail, MessageSummary, AttachmentInfo } from "../types";
import { inMailbox } from "./imap";
import { classify, LIST_HEADERS } from "./categorize";
import { parseQuery, ParsedQuery } from "./query";

export function msgId(folder: string, uid: number) {
  return `${Buffer.from(folder).toString("base64url")}.${uid}`;
}

export function parseMsgId(id: string): { folder: string; uid: number } {
  const m = /^([A-Za-z0-9_-]{1,400})\.(\d{1,10})$/.exec(id || "");
  if (!m) throw new BadRequest("Invalid message id");
  return { folder: Buffer.from(m[1], "base64url").toString(), uid: Number(m[2]) };
}

export class BadRequest extends Error {}
export class NotFound extends Error {}

const ROLE_NAMES: Record<string, FolderRole> = {
  "\\Sent": "sent",
  "\\Drafts": "drafts",
  "\\Junk": "spam",
  "\\Trash": "trash",
  "\\Archive": "archive",
};

type FolderCache = { at: number; list: ListResponse[] };
const folderCache = new Map<string, FolderCache>();

async function rawFolders(client: ImapFlow, user: string, fresh = false): Promise<ListResponse[]> {
  const c = folderCache.get(user);
  if (!fresh && c && Date.now() - c.at < 30_000) return c.list;
  const list = await client.list({ statusQuery: { messages: true, unseen: true } });
  folderCache.set(user, { at: Date.now(), list });
  return list;
}

function roleOf(f: ListResponse): FolderRole {
  if (f.path.toUpperCase() === "INBOX") return "inbox";
  if (f.specialUse && ROLE_NAMES[f.specialUse]) return ROLE_NAMES[f.specialUse];
  if (/^snoozed$/i.test(f.path)) return "snoozed";
  return "label";
}

export async function listFolders(client: ImapFlow, user: string, fresh = false): Promise<Folder[]> {
  const list = await rawFolders(client, user, fresh);
  return list
    .filter((f) => !f.flags.has("\\Noselect") && !f.flags.has("\\NonExistent"))
    .map((f) => ({
      path: f.path,
      name: f.path.toUpperCase() === "INBOX" ? "Inbox" : f.name,
      role: roleOf(f),
      unread: f.status?.unseen ?? 0,
      total: f.status?.messages ?? 0,
      delimiter: f.delimiter,
    }));
}

export async function rolePath(client: ImapFlow, user: string, role: FolderRole): Promise<string> {
  if (role === "inbox") return "INBOX";
  const folders = await listFolders(client, user);
  const hit = folders.find((f) => f.role === role);
  if (hit) return hit.path;
  const fallback: Record<string, string[]> = {
    sent: ["Sent", "Sent Items", "Sent Messages"],
    drafts: ["Drafts"],
    spam: ["Junk", "Spam"],
    trash: ["Trash", "Deleted Items"],
    archive: ["Archive"],
    snoozed: ["Snoozed"],
  };
  for (const name of fallback[role] ?? []) {
    const f = folders.find((x) => x.path.toLowerCase() === name.toLowerCase());
    if (f) return f.path;
  }
  const name = (fallback[role] ?? ["Archive"])[0];
  try {
    await client.mailboxCreate(name);
    await client.mailboxSubscribe(name).catch(() => {});
  } catch {
  }
  folderCache.delete(user);
  return name;
}

export function invalidateFolders(user: string) {
  folderCache.delete(user);
}

type Cached = { snippet: string; category: Category; hasAtt: { filename: string; contentType: string }[] };
const snippetCache = new Map<string, Cached>();
function cacheSet(k: string, v: Cached) {
  if (snippetCache.size > 60000) {
    let n = 0;
    for (const key of snippetCache.keys()) {
      snippetCache.delete(key);
      if (++n > 10000) break;
    }
  }
  snippetCache.set(k, v);
}

function walk(node: MessageStructureObject | undefined, fn: (n: MessageStructureObject) => void) {
  if (!node) return;
  fn(node);
  node.childNodes?.forEach((c) => walk(c, fn));
}

function attachmentsOf(bs?: MessageStructureObject): { filename: string; contentType: string }[] {
  const out: { filename: string; contentType: string }[] = [];
  walk(bs, (n) => {
    if (n.childNodes?.length) return;
    const filename = n.dispositionParameters?.filename || n.parameters?.name;
    if (n.disposition === "attachment" || (filename && !/^text\/(plain|html)$/.test(n.type))) {
      if (n.disposition === "inline" && n.id && n.type.startsWith("image/")) return;
      if (filename) out.push({ filename, contentType: n.type });
    }
  });
  return out;
}

function textPart(bs?: MessageStructureObject): { key: string; node: MessageStructureObject } | null {
  let plain: MessageStructureObject | null = null;
  let html: MessageStructureObject | null = null;
  walk(bs, (n) => {
    if (n.disposition === "attachment") return;
    if (!plain && n.type === "text/plain") plain = n;
    if (!html && n.type === "text/html") html = n;
  });
  const pick = (plain ?? html) as MessageStructureObject | null;
  if (!pick) return null;
  return { key: pick.part || "1", node: pick };
}

function decodeQP(s: string): Buffer {
  const bytes: number[] = [];
  const t = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
      bytes.push(parseInt(t.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(t.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", zwnj: "", zwj: "", shy: "", rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", copy: "\u00a9", reg: "\u00ae", trade: "\u2122", middot: "\u00b7", bull: "\u2022" };

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
function safeChar(code: number) {
  try {
    return code === 0x200c || code === 0x34f || code === 0xad ? "" : String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function decodePart(buf: Buffer, node: MessageStructureObject): string {
  let raw = buf;
  const enc = (node.encoding || "").toLowerCase();
  const s = buf.toString("latin1");
  if (enc === "base64") {
    const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
    raw = Buffer.from(clean.slice(0, clean.length - (clean.length % 4)), "base64");
  } else if (enc === "quoted-printable") raw = decodeQP(s);
  const charset = (node.parameters?.charset || "utf-8").toLowerCase();
  let text: string;
  try {
    text = iconv.encodingExists(charset) ? iconv.decode(raw, charset) : raw.toString("utf8");
  } catch {
    text = raw.toString("utf8");
  }
  if (node.type === "text/html") text = htmlToText(text);
  return text
    .replace(/[\u200b-\u200f\u2028\u2029\u034f\u00ad\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function addr(a?: { name?: string; address?: string }): Addr {
  return { name: a?.name || "", address: a?.address || "" };
}

const SUMMARY_QUERY = {
  uid: true,
  flags: true,
  envelope: true,
  bodyStructure: true,
  internalDate: true,
  headers: LIST_HEADERS,
} as const;

function toSummary(folder: string, m: FetchMessageObject, cached?: Cached): MessageSummary {
  const env = m.envelope;
  const flags = m.flags ?? new Set<string>();
  return {
    id: msgId(folder, m.uid),
    folder,
    uid: m.uid,
    from: addr(env?.from?.[0] ?? env?.sender?.[0]),
    to: (env?.to ?? []).map(addr),
    subject: env?.subject || "",
    snippet: cached?.snippet ?? "",
    date: new Date((env?.date as Date) || (m.internalDate as Date) || Date.now()).toISOString(),
    unread: !flags.has("\\Seen"),
    starred: flags.has("\\Flagged"),
    important: flags.has("$Important") || flags.has("Important"),
    draft: flags.has("\\Draft"),
    attachments: cached?.hasAtt ?? attachmentsOf(m.bodyStructure),
    category: cached?.category,
  };
}

export async function fetchSummaries(client: ImapFlow, user: string, folder: string, uids: number[]): Promise<MessageSummary[]> {
  if (!uids.length) return [];
  const uv = String(client.mailbox && typeof client.mailbox === "object" ? client.mailbox.uidValidity : "0");
  const msgs = await client.fetchAll(uids.join(","), SUMMARY_QUERY, { uid: true });
  const need = new Map<string, FetchMessageObject[]>();
  for (const m of msgs) {
    const k = `${user}|${folder}|${uv}|${m.uid}`;
    if (snippetCache.has(k)) continue;
    const tp = textPart(m.bodyStructure);
    const key = tp?.key ?? "1";
    if (!need.has(key)) need.set(key, []);
    need.get(key)!.push(m);
  }
  for (const [key, group] of need) {
    let parts: FetchMessageObject[] = [];
    try {
      parts = await client.fetchAll(group.map((m) => m.uid).join(","), { uid: true, bodyParts: [{ key, start: 0, maxLength: 3000 }] }, { uid: true });
    } catch {
      parts = [];
    }
    const byUid = new Map(parts.map((p) => [p.uid, p]));
    for (const m of group) {
      const tp = textPart(m.bodyStructure);
      const p = byUid.get(m.uid);
      let buf: Buffer | undefined;
      if (p?.bodyParts) for (const v of p.bodyParts.values()) buf = v;
      const snippet = tp && buf ? decodePart(buf, tp.node) : "";
      cacheSet(`${user}|${folder}|${uv}|${m.uid}`, {
        snippet,
        category: classify(m.envelope?.from?.[0]?.address || "", m.envelope?.subject || "", m.headers?.toString() || ""),
        hasAtt: attachmentsOf(m.bodyStructure),
      });
    }
  }
  const out = msgs.map((m) => toSummary(folder, m, snippetCache.get(`${user}|${folder}|${uv}|${m.uid}`)));
  out.sort((a, b) => b.uid - a.uid);
  return out;
}

type CatIndex = { uidValidity: string; cats: Map<number, Category>; senders: Map<number, string> };
const catIndex = new Map<string, CatIndex>();

async function inboxCategories(client: ImapFlow, user: string, allUids: number[]): Promise<CatIndex> {
  const uv = String(client.mailbox && typeof client.mailbox === "object" ? client.mailbox.uidValidity : "0");
  let idx = catIndex.get(user);
  if (!idx || idx.uidValidity !== uv) {
    idx = { uidValidity: uv, cats: new Map(), senders: new Map() };
    catIndex.set(user, idx);
  }
  const missing = allUids.filter((u) => !idx!.cats.has(u));
  for (let i = 0; i < missing.length; i += 2000) {
    const chunk = missing.slice(i, i + 2000);
    const rows = await client.fetchAll(chunk.join(","), { uid: true, envelope: true, headers: LIST_HEADERS }, { uid: true });
    for (const r of rows) {
      const from = r.envelope?.from?.[0];
      idx.cats.set(r.uid, classify(from?.address || "", r.envelope?.subject || "", r.headers?.toString() || ""));
      idx.senders.set(r.uid, `${from?.name || from?.address || ""} — ${r.envelope?.subject || "(no subject)"}`);
    }
    for (const u of chunk) if (!idx.cats.has(u)) idx.cats.set(u, "primary");
  }
  return idx;
}

export type ListParams = {
  view: string;
  category?: Category;
  q?: string;
  page: number;
  pageSize: number;
  enabledCategories: Category[];
  starredInPrimary: boolean;
};

function sortDesc(a: number[]) {
  return a.sort((x, y) => y - x);
}

async function searchUids(client: ImapFlow, criteria: SearchObject): Promise<number[]> {
  const r = await client.search(criteria, { uid: true });
  return Array.isArray(r) ? sortDesc(r) : [];
}

function scopeFolders(folders: Folder[], scope: ParsedQuery["scope"]): Folder[] {
  if (scope.kind === "folder") return folders.filter((f) => f.path === scope.path);
  if (scope.kind === "role") return folders.filter((f) => f.role === scope.role);
  if (scope.kind === "all") return folders.filter((f) => f.role !== "spam" && f.role !== "trash");
  return folders;
}

export async function listMessages(client: ImapFlow, user: string, p: ListParams): Promise<ListResult> {
  const folders = await listFolders(client, user);
  const offset = Math.max(0, (p.page - 1) * p.pageSize);

  if (p.view === "inbox" && !p.q) {
    return inMailbox(client, "INBOX", async () => {
      const all = await searchUids(client, { all: true });
      const enabled = p.enabledCategories.filter((c) => c !== "primary");
      if (!enabled.length) {
        const page = all.slice(offset, offset + p.pageSize);
        return { messages: await fetchSummaries(client, user, "INBOX", page), total: all.length, offset, pageSize: p.pageSize };
      }
      const idx = await inboxCategories(client, user, all);
      const unseen = new Set(await searchUids(client, { seen: false }));
      const flagged = p.starredInPrimary ? new Set(await searchUids(client, { flagged: true })) : new Set<number>();
      const effective = (u: number): Category => {
        const c = idx.cats.get(u) ?? "primary";
        if (flagged.has(u)) return "primary";
        return (enabled as Category[]).includes(c) ? c : "primary";
      };
      const want = p.category ?? "primary";
      const uids = all.filter((u) => effective(u) === want);
      const tabs: CategoryTabInfo[] = (["primary", ...enabled] as Category[]).map((key) => {
        const unread = all.filter((u) => unseen.has(u) && effective(u) === key);
        return { key, newCount: unread.length, preview: unread.length ? idx.senders.get(unread[0]) || "" : "" };
      });
      const page = uids.slice(offset, offset + p.pageSize);
      const messages = await fetchSummaries(client, user, "INBOX", page);
      return { messages, total: uids.length, offset, pageSize: p.pageSize, tabs };
    });
  }

  let q: ParsedQuery;
  const base = parseQuery(p.q || "");
  switch (p.view) {
    case "inbox":
      q = { ...base, scope: base.scope.kind === "anywhere" ? { kind: "role", role: "inbox" } : base.scope };
      break;
    case "starred":
      q = { ...base, scope: { kind: "all" }, criteria: { ...base.criteria, flagged: true } };
      break;
    case "important":
      q = { ...base, scope: { kind: "all" }, criteria: { ...base.criteria, keyword: "$Important" } };
      break;
    case "sent":
    case "drafts":
    case "spam":
    case "trash":
    case "snoozed":
    case "archive":
      q = { ...base, scope: { kind: "role", role: p.view as FolderRole } };
      break;
    case "all":
      q = { ...base, scope: { kind: "all" } };
      break;
    case "purchases":
      q = { ...base, scope: { kind: "all" }, criteria: { ...base.criteria, or: [{ subject: "order" }, { subject: "receipt" }, { subject: "purchase" }, { subject: "invoice" }] } };
      break;
    case "search":
      q = base.scope.kind === "anywhere" ? { ...base, scope: { kind: "all" } } : base;
      if (base.inAnywhere) q = { ...q, scope: { kind: "anywhere" } };
      break;
    default:
      if (p.view.startsWith("label:")) q = { ...base, scope: { kind: "folder", path: p.view.slice(6) } };
      else throw new BadRequest("Unknown view");
  }

  const targets = scopeFolders(folders, q.scope);
  const criteria: SearchObject = Object.keys(q.criteria).length ? q.criteria : { all: true };
  const multi = targets.length > 1;

  const perFolder: { folder: Folder; uids: number[] }[] = [];
  for (const f of targets) {
    try {
      const uids = await inMailbox(client, f.path, () => searchUids(client, criteria), true);
      if (uids.length) perFolder.push({ folder: f, uids });
    } catch {
    }
  }
  const total = perFolder.reduce((s, x) => s + x.uids.length, 0);

  let pageRefs: { folder: Folder; uid: number }[];
  if (!multi || perFolder.length <= 1) {
    const only = perFolder[0];
    pageRefs = only ? only.uids.slice(offset, offset + p.pageSize).map((uid) => ({ folder: only.folder, uid })) : [];
  } else {
    const need = offset + p.pageSize;
    const dated: { folder: Folder; uid: number; t: number }[] = [];
    for (const pf of perFolder) {
      const top = pf.uids.slice(0, need);
      const rows = await inMailbox(client, pf.folder.path, () => client.fetchAll(top.join(","), { uid: true, internalDate: true }, { uid: true }), true);
      for (const r of rows) dated.push({ folder: pf.folder, uid: r.uid, t: new Date(r.internalDate as Date).getTime() });
    }
    dated.sort((a, b) => b.t - a.t);
    pageRefs = dated.slice(offset, offset + p.pageSize);
  }

  const byFolder = new Map<string, { folder: Folder; uids: number[] }>();
  for (const r of pageRefs) {
    if (!byFolder.has(r.folder.path)) byFolder.set(r.folder.path, { folder: r.folder, uids: [] });
    byFolder.get(r.folder.path)!.uids.push(r.uid);
  }
  const results = new Map<string, MessageSummary>();
  for (const { folder, uids } of byFolder.values()) {
    const rows = await inMailbox(client, folder.path, () => fetchSummaries(client, user, folder.path, uids), true);
    for (const r of rows) {
      if (multi || p.view === "search") r.folderLabel = folder.role === "label" ? folder.name : folder.role === "inbox" ? "Inbox" : undefined;
      results.set(r.id, r);
    }
  }
  const messages = pageRefs.map((r) => results.get(msgId(r.folder.path, r.uid))).filter(Boolean) as MessageSummary[];
  return { messages, total, offset, pageSize: p.pageSize };
}

type ParsedEntry = { at: number; parsed: ParsedMail; size: number };
const parsedCache = new Map<string, ParsedEntry>();

export async function loadParsed(client: ImapFlow, user: string, id: string): Promise<ParsedMail> {
  const key = `${user}|${id}`;
  const hit = parsedCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.parsed;
  const { folder, uid } = parseMsgId(id);
  const source = await inMailbox(
    client,
    folder,
    async () => {
      const m = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      return m && m.source ? m.source : null;
    },
    true,
  );
  if (!source) throw new NotFound("Message not found");
  const parsed = await simpleParser(source, { skipImageLinks: true, skipTextLinks: true, maxHtmlLengthToParse: 10 * 1024 * 1024 });
  if (parsedCache.size > 30) {
    const oldest = [...parsedCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    parsedCache.delete(oldest[0]);
  }
  parsedCache.set(key, { at: Date.now(), parsed, size: source.length });
  return parsed;
}

function addrList(v: ParsedMail["to"]): Addr[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.flatMap((x) => x.value).map((a) => ({ name: a.name || "", address: a.address || "" }));
}

export function attachmentList(parsed: ParsedMail): AttachmentInfo[] {
  return parsed.attachments.map((a, i) => ({
    part: String(i),
    filename: a.filename || (a.contentType === "message/rfc822" ? "message.eml" : "attachment"),
    contentType: a.contentType,
    size: a.size,
    inline: a.contentDisposition === "inline" && !!a.cid,
    cid: a.cid,
  }));
}

export async function getMessage(client: ImapFlow, user: string, id: string, markSeen = true): Promise<MessageDetail> {
  const { folder, uid } = parseMsgId(id);
  const parsed = await loadParsed(client, user, id);
  const summary = await inMailbox(client, folder, async () => {
    const rows = await fetchSummaries(client, user, folder, [uid]);
    if (!rows[0]) throw new NotFound("Message not found");
    if (markSeen && rows[0].unread) {
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      rows[0].unread = false;
    }
    return rows[0];
  });
  const refs = (Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : []).filter(Boolean);
  const html = typeof parsed.html === "string" ? parsed.html : "";
  const thread = await findThread(client, user, folder, parsed.messageId || "", refs, parsed.inReplyTo || "", id);
  const lu = parsed.headers.get("list-unsubscribe");
  let listUnsubscribe: string | null = null;
  if (lu) {
    const s = typeof lu === "string" ? lu : (lu as { url?: string; mail?: string }).url || (lu as { mail?: string }).mail || "";
    const m = /<(https?:[^>]+)>/i.exec(String(s)) || /^(https?:\S+)$/i.exec(String(s));
    listUnsubscribe = m ? m[1] : (lu as { url?: string }).url || null;
  }
  return {
    ...summary,
    from: addrList(parsed.from)[0] ?? summary.from,
    to: addrList(parsed.to),
    cc: addrList(parsed.cc),
    bcc: addrList(parsed.bcc),
    replyTo: addrList(parsed.replyTo),
    subject: parsed.subject || summary.subject,
    messageId: parsed.messageId || "",
    inReplyTo: parsed.inReplyTo || "",
    references: refs,
    listUnsubscribe: listUnsubscribe && /^https:\/\//i.test(listUnsubscribe) ? listUnsubscribe : null,
    text: parsed.text || (html ? htmlToText(html).trim() : ""),
    hasHtml: !!html,
    hasRemoteImages: /<img[^>]+src\s*=\s*["']?\s*https?:/i.test(html) || /url\(\s*['"]?https?:/i.test(html),
    bodyAttachments: attachmentList(parsed).filter((a) => !a.inline),
    thread,
  };
}

async function findThread(client: ImapFlow, user: string, folder: string, messageId: string, refs: string[], inReplyTo: string, selfId: string): Promise<MessageSummary[]> {
  const ids = [...new Set([...refs.slice(-8), inReplyTo, messageId].filter(Boolean))];
  if (!ids.length) return [];
  const folders = await listFolders(client, user);
  const sent = folders.find((f) => f.role === "sent")?.path;
  const targets = [...new Set([folder, sent, "INBOX"].filter(Boolean) as string[])];
  const out: MessageSummary[] = [];
  for (const path of targets) {
    try {
      const clauses: SearchObject[] = [];
      for (const mid of ids) clauses.push({ header: { "message-id": mid } });
      if (messageId) clauses.push({ header: { references: messageId } });
      const uids = await inMailbox(client, path, () => searchUids(client, clauses.length === 1 ? clauses[0] : { or: clauses }), true);
      if (!uids.length) continue;
      const rows = await inMailbox(client, path, () => fetchSummaries(client, user, path, uids.slice(0, 50)), true);
      out.push(...rows);
    } catch {
    }
  }
  const seen = new Set<string>();
  const unique = out.filter((m) => {
    if (m.id === selfId || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  return unique.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export type Action =
  | "read"
  | "unread"
  | "star"
  | "unstar"
  | "important"
  | "notimportant"
  | "archive"
  | "trash"
  | "delete"
  | "spam"
  | "notspam"
  | "move"
  | "copy"
  | "inbox";

function groupIds(ids: string[]) {
  const by = new Map<string, number[]>();
  for (const id of ids) {
    const { folder, uid } = parseMsgId(id);
    if (!by.has(folder)) by.set(folder, []);
    by.get(folder)!.push(uid);
  }
  return by;
}

export async function applyAction(client: ImapFlow, user: string, ids: string[], action: Action, target?: string): Promise<{ moved: Record<string, string> }> {
  if (!ids.length) return { moved: {} };
  if (ids.length > 5000) throw new BadRequest("Too many messages");
  const by = groupIds(ids);
  const moved: Record<string, string> = {};
  let dest: string | null = null;
  if (action === "archive") dest = await rolePath(client, user, "archive");
  if (action === "trash") dest = await rolePath(client, user, "trash");
  if (action === "spam") dest = await rolePath(client, user, "spam");
  if (action === "notspam" || action === "inbox") dest = "INBOX";
  if (action === "move" || action === "copy") {
    const folders = await listFolders(client, user);
    if (!target || !folders.some((f) => f.path === target)) throw new BadRequest("Unknown folder");
    dest = target;
  }
  for (const [folder, uids] of by) {
    const range = uids.join(",");
    await inMailbox(client, folder, async () => {
      switch (action) {
        case "read":
          await client.messageFlagsAdd(range, ["\\Seen"], { uid: true });
          break;
        case "unread":
          await client.messageFlagsRemove(range, ["\\Seen"], { uid: true });
          break;
        case "star":
          await client.messageFlagsAdd(range, ["\\Flagged"], { uid: true });
          break;
        case "unstar":
          await client.messageFlagsRemove(range, ["\\Flagged"], { uid: true });
          break;
        case "important":
          await client.messageFlagsAdd(range, ["$Important"], { uid: true });
          break;
        case "notimportant":
          await client.messageFlagsRemove(range, ["$Important", "Important"], { uid: true });
          break;
        case "delete":
          await client.messageDelete(range, { uid: true });
          break;
        case "copy":
          await client.messageCopy(range, dest!, { uid: true });
          break;
        default: {
          if (!dest || dest === folder) {
            if (action === "trash") await client.messageDelete(range, { uid: true });
            break;
          }
          const r = await client.messageMove(range, dest, { uid: true });
          if (r && r.uidMap) for (const [from, to] of r.uidMap) moved[msgId(folder, from)] = msgId(dest, to);
        }
      }
    });
  }
  invalidateFolders(user);
  return { moved };
}

export async function markAllRead(client: ImapFlow, user: string, path: string) {
  await inMailbox(client, path, async () => {
    const uids = await searchUids(client, { seen: false });
    if (uids.length) await client.messageFlagsAdd(uids.join(","), ["\\Seen"], { uid: true });
  });
  invalidateFolders(user);
}

export async function emptyFolder(client: ImapFlow, user: string, role: "trash" | "spam") {
  const path = await rolePath(client, user, role);
  await inMailbox(client, path, async () => {
    const st = client.mailbox && typeof client.mailbox === "object" ? client.mailbox.exists : 0;
    if (st) await client.messageDelete("1:*");
  });
  invalidateFolders(user);
}

export function validFolderName(name: string): string {
  const n = (name || "").trim();
  if (!n || n.length > 200 || /[\x00-\x1f*%"\\]/.test(n) || /^inbox$/i.test(n)) throw new BadRequest("Invalid label name");
  return n;
}

export async function createFolder(client: ImapFlow, user: string, name: string, parent?: string) {
  const n = validFolderName(name);
  const folders = await listFolders(client, user);
  const delim = folders[0]?.delimiter || "/";
  const path = parent && folders.some((f) => f.path === parent) ? `${parent}${delim}${n}` : n;
  await client.mailboxCreate(path);
  await client.mailboxSubscribe(path).catch(() => {});
  invalidateFolders(user);
  return path;
}

export async function renameFolder(client: ImapFlow, user: string, path: string, name: string) {
  const folders = await listFolders(client, user);
  const f = folders.find((x) => x.path === path);
  if (!f || f.role !== "label") throw new BadRequest("Cannot rename this folder");
  const n = validFolderName(name);
  const idx = path.lastIndexOf(f.delimiter);
  const newPath = idx >= 0 ? path.slice(0, idx + 1) + n : n;
  await client.mailboxRename(path, newPath);
  invalidateFolders(user);
  return newPath;
}

export async function deleteFolder(client: ImapFlow, user: string, path: string) {
  const folders = await listFolders(client, user);
  const f = folders.find((x) => x.path === path);
  if (!f || f.role !== "label") throw new BadRequest("Cannot delete this folder");
  await client.mailboxDelete(path);
  invalidateFolders(user);
}

export async function appendMessage(client: ImapFlow, user: string, role: "sent" | "drafts", raw: Buffer, flags: string[]): Promise<string | null> {
  const path = await rolePath(client, user, role);
  const r = await client.append(path, raw, flags);
  invalidateFolders(user);
  return r && r.uid ? msgId(path, r.uid) : null;
}

export async function quota(client: ImapFlow): Promise<{ used: number; limit: number } | null> {
  try {
    const q = await client.getQuota("INBOX");
    if (q && q.storage && q.storage.limit) return { used: q.storage.usage ?? 0, limit: q.storage.limit };
  } catch {
  }
  return null;
}
