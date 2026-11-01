import { route } from "@/lib/server/api";
import { destroySession } from "@/lib/server/session";
import { closeUser } from "@/lib/server/imap";
import { revoke } from "@/lib/server/ion";
import { db } from "@/lib/server/db";

export const POST = route(async (_req, s) => {
  const tokens = await destroySession();
  const others = db().prepare("SELECT COUNT(*) AS n FROM sessions WHERE username = ?").get(s.username) as { n: number };
  if (!others.n) closeUser(s.username);
  if (tokens?.refresh_token) await revoke(tokens.refresh_token);
  if (tokens?.access_token && tokens.access_token !== "demo") await revoke(tokens.access_token);
  return { ok: true };
});
