import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { config } from "@/lib/server/config";
import { decrypt } from "@/lib/server/crypto";
import { exchangeCode, fetchProfile } from "@/lib/server/ion";
import { createSession } from "@/lib/server/session";

function fail(msg: string) {
  const u = new URL("/", config.appUrl);
  u.searchParams.set("error", msg);
  const res = NextResponse.redirect(u);
  res.cookies.delete({ name: "wm_oauth", path: "/api/auth" });
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cookie = req.headers.get("cookie")?.match(/(?:^|;\s*)wm_oauth=([^;]+)/)?.[1];
  if (url.searchParams.get("error")) return fail("Sign-in was cancelled.");
  if (!cookie) return fail("Your sign-in attempt expired. Please try again.");
  let saved: { state: string; verifier: string; t: number };
  try {
    saved = JSON.parse(decrypt(decodeURIComponent(cookie), "oauth").toString());
  } catch {
    return fail("Your sign-in attempt expired. Please try again.");
  }
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const a = Buffer.from(state);
  const b = Buffer.from(saved.state);
  if (!code || a.length !== b.length || !crypto.timingSafeEqual(a, b) || Date.now() - saved.t > 600_000) {
    return fail("Sign-in could not be verified. Please try again.");
  }
  try {
    const tokens = await exchangeCode(code, saved.verifier);
    const profile = await fetchProfile(tokens.access_token);
    if (!profile.ion_username || !/^[a-z0-9._-]+$/i.test(profile.ion_username)) return fail("Your Ion account has no mail username.");
    await createSession(tokens, profile);
  } catch (e) {
    console.error("[webmail] oauth callback failed:", (e as Error).message);
    return fail("Ion sign-in failed. Please try again.");
  }
  const res = NextResponse.redirect(new URL("/", config.appUrl));
  res.cookies.delete({ name: "wm_oauth", path: "/api/auth" });
  return res;
}
