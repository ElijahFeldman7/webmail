import "server-only";
import { cookies } from "next/headers";
import { config, secureCookies } from "./config";
import { db } from "./db";
import { decrypt, encrypt, randomId, sha256 } from "./crypto";
import { IonProfile, IonTokens, refreshTokens } from "./ion";

export const SESSION_COOKIE = secureCookies() ? "__Host-wm_sid" : "wm_sid";

export type Session = {
  idHash: string;
  username: string;
  profile: IonProfile;
  csrf: string;
};

type Row = {
  id_hash: string;
  username: string;
  tokens: string;
  profile: string;
  csrf: string;
  expires: number;
  last_seen: number;
};

export async function createSession(tokens: IonTokens, profile: IonProfile): Promise<void> {
  const id = randomId(32);
  const idHash = sha256(id);
  const now = Date.now();
  const expires = now + config.sessionDays * 86400_000;
  db()
    .prepare("INSERT INTO sessions (id_hash, username, tokens, profile, csrf, created, expires, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(idHash, profile.ion_username, encrypt(JSON.stringify(tokens), idHash), JSON.stringify(profile), randomId(24), now, expires, now);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires: new Date(expires),
  });
}

function loadRow(id: string | undefined): Row | null {
  if (!id || id.length > 100) return null;
  const idHash = sha256(id);
  const row = db().prepare("SELECT * FROM sessions WHERE id_hash = ?").get(idHash) as Row | undefined;
  if (!row) return null;
  if (row.expires < Date.now()) {
    db().prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
    return null;
  }
  return row;
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const row = loadRow(jar.get(SESSION_COOKIE)?.value);
  if (!row) return null;
  const now = Date.now();
  if (now - row.last_seen > 60_000) db().prepare("UPDATE sessions SET last_seen = ? WHERE id_hash = ?").run(now, row.id_hash);
  return { idHash: row.id_hash, username: row.username, profile: JSON.parse(row.profile), csrf: row.csrf };
}

const refreshing = new Map<string, Promise<string>>();

export async function getAccessToken(idHash: string): Promise<string> {
  const row = db().prepare("SELECT tokens FROM sessions WHERE id_hash = ?").get(idHash) as { tokens: string } | undefined;
  if (!row) throw new AuthError("Session expired");
  const tokens = JSON.parse(decrypt(row.tokens, idHash).toString()) as IonTokens;
  if (tokens.access_token === "demo") return "demo";
  if (tokens.expires_at - Date.now() > 120_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new AuthError("Session expired");
  let p = refreshing.get(idHash);
  if (!p) {
    p = (async () => {
      try {
        const next = await refreshTokens(tokens.refresh_token!);
        if (!next.refresh_token) next.refresh_token = tokens.refresh_token;
        db().prepare("UPDATE sessions SET tokens = ? WHERE id_hash = ?").run(encrypt(JSON.stringify(next), idHash), idHash);
        return next.access_token;
      } catch (e) {
        db().prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
        throw new AuthError("Session expired: " + (e as Error).message);
      } finally {
        refreshing.delete(idHash);
      }
    })();
    refreshing.set(idHash, p);
  }
  return p;
}

export function getTokens(idHash: string): IonTokens | null {
  const row = db().prepare("SELECT tokens FROM sessions WHERE id_hash = ?").get(idHash) as { tokens: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(decrypt(row.tokens, idHash).toString());
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<IonTokens | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  let tokens: IonTokens | null = null;
  if (id) {
    const idHash = sha256(id);
    tokens = getTokens(idHash);
    db().prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
  }
  jar.delete(SESSION_COOKIE);
  return tokens;
}

export function anySessionFor(username: string): string | null {
  const row = db()
    .prepare("SELECT id_hash FROM sessions WHERE username = ? AND expires > ? ORDER BY last_seen DESC LIMIT 1")
    .get(username, Date.now()) as { id_hash: string } | undefined;
  return row?.id_hash ?? null;
}

export class AuthError extends Error {}
