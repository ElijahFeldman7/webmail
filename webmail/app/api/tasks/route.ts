import { route, body } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route(async (_req, s) => ({ tasks: db().prepare("SELECT id, title, done FROM tasks WHERE username = ? ORDER BY done, id DESC").all(s.username) }));
export const POST = route(async (req, s) => {
  const b = await body<{ title: string }>(req);
  db().prepare("INSERT INTO tasks (username, title, created) VALUES (?, ?, ?)").run(s.username, String(b.title || "").slice(0, 500), Date.now());
  return { ok: true };
});
export const PATCH = route(async (req, s) => {
  const b = await body<{ id: number; done?: boolean; title?: string }>(req);
  if (typeof b.done === "boolean") db().prepare("UPDATE tasks SET done = ? WHERE id = ? AND username = ?").run(b.done ? 1 : 0, Number(b.id), s.username);
  if (typeof b.title === "string") db().prepare("UPDATE tasks SET title = ? WHERE id = ? AND username = ?").run(b.title.slice(0, 500), Number(b.id), s.username);
  return { ok: true };
});
export const DELETE = route(async (req, s) => {
  const b = await body<{ id: number }>(req);
  db().prepare("DELETE FROM tasks WHERE id = ? AND username = ?").run(Number(b.id), s.username);
  return { ok: true };
});
