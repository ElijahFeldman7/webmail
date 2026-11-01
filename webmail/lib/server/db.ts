import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config";

const g = globalThis as unknown as { __webmailDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (g.__webmailDb) return g.__webmailDb;
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const d = new DatabaseSync(path.join(config.dataDir, "webmail.sqlite"));
  d.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      tokens TEXT NOT NULL,
      profile TEXT NOT NULL,
      csrf TEXT NOT NULL,
      created INTEGER NOT NULL,
      expires INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(username);
    CREATE TABLE IF NOT EXISTS prefs (
      username TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      created INTEGER NOT NULL,
      UNIQUE(username, email)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scheduled (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      send_at INTEGER NOT NULL,
      payload TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS snoozed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      message_id TEXT NOT NULL,
      until INTEGER NOT NULL
    );
  `);
  g.__webmailDb = d;
  return d;
}

export type Prefs = {
  pageSize: number;
  undoSeconds: number;
  replyAll: boolean;
  hoverActions: boolean;
  sendAndArchive: boolean;
  externalImages: boolean;
  categories: { promotions: boolean; social: boolean; updates: boolean; forums: boolean };
  starredInPrimary: boolean;
  readingPane: boolean;
  signature: string;
  fontFamily: string;
  fontSize: string;
  hiddenLabels: string[];
  shortcuts: boolean;
  density: "default" | "comfortable" | "compact";
  composeFullscreen: boolean;
  plainText: boolean;
  theme: string;
  sidebarCollapsed: boolean;
  displayName: string;
};

export const defaultPrefs: Prefs = {
  pageSize: 50,
  undoSeconds: 5,
  replyAll: false,
  hoverActions: true,
  sendAndArchive: false,
  externalImages: true,
  categories: { promotions: true, social: true, updates: true, forums: false },
  starredInPrimary: true,
  readingPane: false,
  signature: "",
  fontFamily: "sans-serif",
  fontSize: "small",
  hiddenLabels: [],
  shortcuts: false,
  density: "default",
  composeFullscreen: false,
  plainText: false,
  theme: "default",
  sidebarCollapsed: false,
  displayName: "",
};

export function getPrefs(username: string): Prefs {
  const row = db().prepare("SELECT data FROM prefs WHERE username = ?").get(username) as { data: string } | undefined;
  if (!row) return { ...defaultPrefs };
  try {
    return { ...defaultPrefs, ...JSON.parse(row.data) };
  } catch {
    return { ...defaultPrefs };
  }
}

export function setPrefs(username: string, patch: Record<string, unknown>): Prefs {
  const cur = getPrefs(username);
  const next: Prefs = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in defaultPrefs)) continue;
    const def = (defaultPrefs as Record<string, unknown>)[k];
    if (typeof def === "number" && typeof v === "number" && Number.isFinite(v)) (next as Record<string, unknown>)[k] = v;
    else if (typeof def === "boolean" && typeof v === "boolean") (next as Record<string, unknown>)[k] = v;
    else if (typeof def === "string" && typeof v === "string") (next as Record<string, unknown>)[k] = v.slice(0, 20000);
    else if (Array.isArray(def) && Array.isArray(v)) (next as Record<string, unknown>)[k] = v.filter((x) => typeof x === "string").slice(0, 500);
    else if (k === "categories" && v && typeof v === "object") {
      const c = v as Record<string, unknown>;
      next.categories = {
        promotions: c.promotions !== false && c.promotions !== undefined ? !!c.promotions : false,
        social: !!c.social,
        updates: !!c.updates,
        forums: !!c.forums,
      };
    }
  }
  next.pageSize = Math.min(100, Math.max(10, Math.round(next.pageSize)));
  next.undoSeconds = Math.min(30, Math.max(0, Math.round(next.undoSeconds)));
  db().prepare("INSERT INTO prefs (username, data) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data").run(username, JSON.stringify(next));
  return next;
}
