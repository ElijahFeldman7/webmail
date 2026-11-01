import { route, body } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route(async (_req, s) => ({ notes: db().prepare("SELECT id, title, body, updated FROM notes WHERE username = ? ORDER BY updated DESC").all(s.username) }));
export const POST = route(async (req, s) => {
  const b = await body<{ id?: number; title?: string; body?: string }>(req, 200_000);
  const title = String(b.title || "").slice(0, 500);
  const text = String(b.body || "").slice(0, 100_000);
  if (b.id) db().prepare("UPDATE notes SET title = ?, body = ?, updated = ? WHERE id = ? AND username = ?").run(title, text, Date.now(), Number(b.id), s.username);
  else db().prepare("INSERT INTO notes (username, title, body, updated) VALUES (?, ?, ?, ?)").run(s.username, title, text, Date.now());
  return { ok: true };
});
export const DELETE = route(async (req, s) => {
  const b = await body<{ id: number }>(req);
  db().prepare("DELETE FROM notes WHERE id = ? AND username = ?").run(Number(b.id), s.username);
  return { ok: true };
});
