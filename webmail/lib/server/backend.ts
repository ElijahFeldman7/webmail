import "server-only";
import type { Folder, ListResult, MessageDetail, Category, Identity } from "../types";
import { config } from "./config";
import type { Session } from "./session";
import { withImap, inMailbox } from "./imap";
import * as M from "./mail";
import { sanitizeEmailHtml, textToHtml } from "./sanitize";
import { buildMessage, Draft, enqueue, identitiesFor, recordSnooze } from "./compose";
import { getPrefs } from "./db";

export type ListArgs = { view: string; category?: Category; q?: string; page: number };

export interface Backend {
  identities(): Promise<Identity[]>;
  folders(fresh?: boolean): Promise<Folder[]>;
  list(a: ListArgs): Promise<ListResult>;
  message(id: string): Promise<MessageDetail>;
  body(id: string, allowRemote: boolean): Promise<{ html: string; blocked: number }>;
  attachment(id: string, part: string): Promise<{ filename: string; contentType: string; content: Buffer }>;
  act(ids: string[], action: M.Action, target?: string): Promise<{ moved: Record<string, string> }>;
  snooze(ids: string[], until: number): Promise<void>;
  markAllRead(view: string): Promise<void>;
  empty(role: "trash" | "spam"): Promise<void>;
  createFolder(name: string, parent?: string): Promise<string>;
  renameFolder(path: string, name: string): Promise<string>;
  deleteFolder(path: string): Promise<void>;
  saveDraft(d: Draft, replaceId?: string): Promise<string | null>;
  send(d: Draft, opts: { sendAt: number; kind: "undo" | "scheduled"; draftId?: string }): Promise<string>;
  quota(): Promise<{ used: number; limit: number } | null>;
  raw(id: string): Promise<Buffer>;
}

export function enabledCategories(username: string): Category[] {
  const p = getPrefs(username);
  const out: Category[] = ["primary"];
  if (p.categories.promotions) out.push("promotions");
  if (p.categories.social) out.push("social");
  if (p.categories.updates) out.push("updates");
  if (p.categories.forums) out.push("forums");
  return out;
}

class ImapBackend implements Backend {
  constructor(private s: Session) {}
  private run<T>(fn: (c: import("imapflow").ImapFlow) => Promise<T>) {
    return withImap(this.s.username, this.s.idHash, fn);
  }
  private get user() {
    return this.s.username;
  }
  async identities() {
    const p = getPrefs(this.user);
    return identitiesFor(this.user, p.displayName || this.s.profile.display_name || this.s.profile.full_name || this.user, this.s.profile.tj_email);
  }
  folders(fresh = false) {
    return this.run((c) => M.listFolders(c, this.user, fresh));
  }
  list(a: ListArgs) {
    const p = getPrefs(this.user);
    return this.run((c) =>
      M.listMessages(c, this.user, {
        view: a.view,
        category: a.category,
        q: a.q,
        page: a.page,
        pageSize: p.pageSize,
        enabledCategories: enabledCategories(this.user),
        starredInPrimary: p.starredInPrimary,
      }),
    );
  }
  message(id: string) {
    return this.run((c) => M.getMessage(c, this.user, id));
  }
  body(id: string, allowRemote: boolean) {
    return this.run(async (c) => {
      const parsed = await M.loadParsed(c, this.user, id);
      const cidMap = new Map<string, string>();
      parsed.attachments.forEach((a, i) => {
        if (a.cid && /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(a.contentType)) cidMap.set(a.cid, `/api/messages/${id}/attachments/${i}?inline=1`);
      });
      if (typeof parsed.html === "string" && parsed.html) {
        const r = sanitizeEmailHtml(parsed.html, { cidMap, allowRemote });
        return { html: r.html, blocked: r.blockedImages };
      }
      return { html: textToHtml(parsed.text || ""), blocked: 0 };
    });
  }
  attachment(id: string, part: string) {
    return this.run(async (c) => {
      const parsed = await M.loadParsed(c, this.user, id);
      const a = parsed.attachments[Number(part)];
      if (!a) throw new M.NotFound("Attachment not found");
      return { filename: a.filename || "attachment", contentType: a.contentType || "application/octet-stream", content: a.content };
    });
  }
  act(ids: string[], action: M.Action, target?: string) {
    return this.run((c) => M.applyAction(c, this.user, ids, action, target));
  }
  snooze(ids: string[], until: number) {
    return this.run(async (c) => {
      for (const id of ids) {
        const parsed = await M.loadParsed(c, this.user, id);
        if (parsed.messageId) recordSnooze(this.user, parsed.messageId, until);
      }
      const path = await M.rolePath(c, this.user, "snoozed");
      await M.applyAction(c, this.user, ids, "move", path);
    });
  }
  markAllRead(view: string) {
    return this.run(async (c) => {
      const role = ["inbox", "sent", "drafts", "spam", "trash", "archive", "snoozed"].includes(view) ? (view as "inbox") : null;
      const path = role ? await M.rolePath(c, this.user, role) : view.startsWith("label:") ? view.slice(6) : "INBOX";
      await M.markAllRead(c, this.user, path);
    });
  }
  empty(role: "trash" | "spam") {
    return this.run((c) => M.emptyFolder(c, this.user, role));
  }
  createFolder(name: string, parent?: string) {
    return this.run((c) => M.createFolder(c, this.user, name, parent));
  }
  renameFolder(path: string, name: string) {
    return this.run((c) => M.renameFolder(c, this.user, path, name));
  }
  deleteFolder(path: string) {
    return this.run((c) => M.deleteFolder(c, this.user, path));
  }
  saveDraft(d: Draft, replaceId?: string) {
    return this.run(async (c) => {
      const built = await buildMessage(c, this.user, await this.identities(), d, { forDraft: true });
      const id = await M.appendMessage(c, this.user, "drafts", built.withBcc, ["\\Draft", "\\Seen"]);
      if (replaceId) await M.applyAction(c, this.user, [replaceId], "delete").catch(() => {});
      return id;
    });
  }
  send(d: Draft, opts: { sendAt: number; kind: "undo" | "scheduled"; draftId?: string }) {
    return this.run(async (c) => {
      const built = await buildMessage(c, this.user, await this.identities(), d, { forDraft: false });
      return enqueue(this.user, opts.sendAt, built, opts.kind, opts.draftId);
    });
  }
  quota() {
    return this.run((c) => M.quota(c));
  }
  raw(id: string) {
    return this.run(async (c) => {
      const { folder, uid } = M.parseMsgId(id);
      const src = await inMailbox(
        c,
        folder,
        async () => {
          const m = await c.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
          return m && m.source ? m.source : null;
        },
        true,
      );
      if (!src) throw new M.NotFound("Message not found");
      return src;
    });
  }
}

export async function backendFor(s: Session): Promise<Backend> {
  if (config.demo && s.username === "demo") {
    const { DemoBackend } = await import("./demo");
    return new DemoBackend();
  }
  return new ImapBackend(s);
}
