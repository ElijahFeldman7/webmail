import "server-only";
import type { SearchObject } from "imapflow";
import type { FolderRole } from "../types";

export type ParsedQuery = {
  scope: { kind: "anywhere" } | { kind: "all" } | { kind: "role"; role: FolderRole } | { kind: "folder"; path: string };
  criteria: SearchObject;
  inAnywhere?: boolean;
};

const ROLES: Record<string, FolderRole> = {
  inbox: "inbox",
  sent: "sent",
  draft: "drafts",
  drafts: "drafts",
  spam: "spam",
  junk: "spam",
  trash: "trash",
  bin: "trash",
  archive: "archive",
  snoozed: "snoozed",
};

function tokenize(q: string): string[] {
  const out: string[] = [];
  const re = /(-?[a-z_]+:)?("([^"]*)"|\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) out.push(m[0]);
  return out;
}

function unquote(s: string) {
  return s.replace(/^"(.*)"$/, "$1");
}

function size(v: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)([kmg]?)b?$/i.exec(v);
  if (!m) return undefined;
  const mult = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2].toLowerCase() as "" | "k" | "m" | "g"];
  return Math.round(Number(m[1]) * mult);
}

function date(v: string): Date | undefined {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(v);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

function relative(v: string): Date | undefined {
  const m = /^(\d+)([dmy])$/i.exec(v);
  if (!m) return undefined;
  const d = new Date();
  const n = Number(m[1]);
  if (m[2].toLowerCase() === "d") d.setDate(d.getDate() - n);
  if (m[2].toLowerCase() === "m") d.setMonth(d.getMonth() - n);
  if (m[2].toLowerCase() === "y") d.setFullYear(d.getFullYear() - n);
  return d;
}

export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { scope: { kind: "anywhere" }, criteria: {} };
  const c = out.criteria as Record<string, unknown>;
  const words: string[] = [];
  const nots: SearchObject[] = [];
  for (const tok of tokenize(q.slice(0, 1000))) {
    const m = /^(-?)([a-z_]+):(.*)$/i.exec(tok);
    if (!m) {
      if (tok.startsWith("-") && tok.length > 1) nots.push({ text: unquote(tok.slice(1)) });
      else words.push(unquote(tok));
      continue;
    }
    const neg = m[1] === "-";
    const key = m[2].toLowerCase();
    const val = unquote(m[3]);
    const lv = val.toLowerCase();
    const add = (o: SearchObject) => (neg ? nots.push(o) : Object.assign(c, o));
    switch (key) {
      case "from":
      case "to":
      case "cc":
      case "bcc":
      case "subject":
        add({ [key]: val });
        break;
      case "in":
        if (lv === "anywhere") out.inAnywhere = true;
        else if (ROLES[lv]) out.scope = { kind: "role", role: ROLES[lv] };
        else out.scope = { kind: "folder", path: val };
        break;
      case "label":
        out.scope = { kind: "folder", path: val };
        break;
      case "is":
        if (lv === "unread") add({ seen: false });
        else if (lv === "read") add({ seen: true });
        else if (lv === "starred") add({ flagged: true });
        else if (lv === "important") add({ keyword: "$Important" });
        else if (lv === "snoozed") out.scope = { kind: "role", role: "snoozed" };
        break;
      case "has":
        if (lv === "attachment") add({ header: { "content-type": "multipart/mixed" } });
        else if (lv === "unsubscribe") add({ header: { "list-unsubscribe": true } });
        break;
      case "larger":
      case "size": {
        const s = size(val);
        if (s) add({ larger: s });
        break;
      }
      case "smaller": {
        const s = size(val);
        if (s) add({ smaller: s });
        break;
      }
      case "after":
      case "newer": {
        const d = date(val);
        if (d) add({ since: d });
        break;
      }
      case "before":
      case "older": {
        const d = date(val);
        if (d) add({ before: d });
        break;
      }
      case "newer_than": {
        const d = relative(val);
        if (d) add({ since: d });
        break;
      }
      case "older_than": {
        const d = relative(val);
        if (d) add({ before: d });
        break;
      }
      case "filename":
        add({ body: val });
        break;
      default:
        words.push(tok);
    }
  }
  if (words.length) c.text = words.join(" ");
  if (nots.length === 1) c.not = nots[0];
  else if (nots.length > 1) c.not = { or: nots };
  return out;
}
