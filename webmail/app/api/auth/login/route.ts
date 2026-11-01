import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { config, secureCookies } from "@/lib/server/config";
import { encrypt, randomId } from "@/lib/server/crypto";
import { authorizeUrl } from "@/lib/server/ion";
import { createSession } from "@/lib/server/session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (config.demo && url.searchParams.get("demo") === "1") {
    await createSession(
      { access_token: "demo", expires_at: Date.now() + 86400_000 },
      { id: 0, ion_username: "demo", display_name: "Eli Feldman", first_name: "Eli", last_name: "Feldman", tj_email: "demo@tjhsst.edu" },
    );
    return NextResponse.redirect(new URL("/", config.appUrl));
  }
  if (config.devLogin && url.searchParams.get("dev") === "testuser") {
    await createSession(
      { access_token: "testtoken", expires_at: Date.now() + 86400_000 },
      { id: 0, ion_username: "testuser", display_name: "Test User", first_name: "Test", last_name: "User", tj_email: "testuser@tjhsst.edu" },
    );
    return NextResponse.redirect(new URL("/", config.appUrl));
  }
  if (!config.ion.clientId || !config.ion.clientSecret) return new NextResponse("Ion OAuth is not configured", { status: 500 });
  const state = randomId(24);
  const verifier = randomId(48);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const res = NextResponse.redirect(authorizeUrl(state, challenge));
  res.cookies.set("wm_oauth", encrypt(JSON.stringify({ state, verifier, t: Date.now() }), "oauth"), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 600,
  });
  return res;
}
