import "server-only";
import { config, redirectUri } from "./config";

export type IonTokens = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
};

export type IonProfile = {
  id: number;
  ion_username: string;
  display_name: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  tj_email?: string | null;
  emails?: string[];
  picture?: string;
};

export function authorizeUrl(state: string, codeChallenge: string): string {
  const u = new URL(`${config.ion.url}/oauth/authorize/`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", config.ion.clientId);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("scope", config.ion.scope);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<IonTokens> {
  const res = await fetch(`${config.ion.url}/oauth/token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${encodeURIComponent(config.ion.clientId)}:${encodeURIComponent(config.ion.clientSecret)}`).toString("base64"),
    },
    body: new URLSearchParams(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ion token endpoint returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!j.access_token) throw new Error("Ion token response missing access_token");
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + (j.expires_in ?? 3600) * 1000,
    scope: j.scope,
  };
}

export const exchangeCode = (code: string, verifier: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier });

export const refreshTokens = (refresh: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });

export async function ionGet<T>(pathName: string, accessToken: string): Promise<T> {
  const res = await fetch(`${config.ion.url}/api${pathName}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Ion API ${pathName} returned ${res.status}`);
  return (await res.json()) as T;
}

export const fetchProfile = (accessToken: string) => ionGet<IonProfile>("/profile", accessToken);

export async function revoke(token: string) {
  try {
    await fetch(`${config.ion.url}/oauth/revoke_token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, client_id: config.ion.clientId, client_secret: config.ion.clientSecret }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
  }
}
