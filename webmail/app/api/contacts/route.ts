import { route, body } from "@/lib/server/api";
import { db } from "@/lib/server/db";
import { searchDirectory } from "@/lib/server/ldap";
import { BadRequest } from "@/lib/server/mail";

type Row = { id: number; name: string; email: string };

export const GET = route(async (req, s) => {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 100);
  if (!q) {
    const all = db().prepare("SELECT id, name, email FROM contacts WHERE username = ? ORDER BY name COLLATE NOCASE, email LIMIT 2000").all(s.username) as Row[];
    return { contacts: all, directory: [] };
  }
  const like = `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
  const mine = db().prepare("SELECT id, name, email FROM contacts WHERE username = ? AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY name LIMIT 10").all(s.username, like, like) as Row[];
  const dir = await searchDirectory(q);
  const seen = new Set(mine.map((c) => c.email.toLowerCase()));
  return { contacts: mine, directory: dir.filter((d) => d.email && !seen.has(d.email.toLowerCase())).slice(0, 10) };
});

export const POST = route(async (req, s) => {
  const b = await body<{ name?: string; email: string }>(req);
  const email = String(b.email || "").trim().slice(0, 254);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new BadRequest("Invalid email address");
  db().prepare("INSERT INTO contacts (username, name, email, created) VALUES (?, ?, ?, ?) ON CONFLICT(username, email) DO UPDATE SET name = excluded.name").run(s.username, String(b.name || "").slice(0, 200), email, Date.now());
  return { ok: true };
});

export const DELETE = route(async (req, s) => {
  const b = await body<{ id: number }>(req);
  db().prepare("DELETE FROM contacts WHERE id = ? AND username = ?").run(Number(b.id), s.username);
  return { ok: true };
});
