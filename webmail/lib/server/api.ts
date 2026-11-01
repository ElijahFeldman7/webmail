import "server-only";
import { NextResponse } from "next/server";
import { config } from "./config";
import { AuthError, getSession, Session } from "./session";
import { MailAuthError } from "./imap";
import { BadRequest, NotFound } from "./mail";
import { ensureScheduler } from "./compose";

export type Handler = (req: Request, session: Session) => Promise<Response | unknown>;

function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (origin) {
    const allowed = new URL(config.appUrl).origin;
    const self = new URL(req.url).origin;
    return origin === allowed || origin === self;
  }
  return !!site;
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function route(handler: Handler, opts: { mutating?: boolean } = {}) {
  return async (req: Request, ctx?: unknown) => {
    ensureScheduler();
    const session = await getSession();
    if (!session) return json({ error: "Not signed in" }, 401);
    const mutating = opts.mutating ?? !["GET", "HEAD"].includes(req.method);
    if (mutating) {
      if (!sameOrigin(req) || req.headers.get("x-csrf-token") !== session.csrf) return json({ error: "Invalid request origin" }, 403);
    }
    try {
      (req as Request & { ctx?: unknown }).ctx = ctx;
      const out = await handler(req, session);
      if (out instanceof Response) return out;
      return json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof BadRequest) return json({ error: e.message }, 400);
  if (e instanceof NotFound) return json({ error: e.message }, 404);
  if (e instanceof AuthError || e instanceof MailAuthError) return json({ error: e.message, reauth: true }, 401);
  const msg = (e as Error)?.message || String(e);
  console.error("[webmail] api error:", msg);
  if (/ManageSieve/.test(msg)) return json({ error: msg.replace(/^ManageSieve:\s*/, "Mail filter server: ") }, 502);
  if ((e as { code?: string }).code === "ECONNREFUSED" || e instanceof AggregateError || /ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/.test(msg)) return json({ error: "Couldn't reach the mail server. Please try again." }, 502);
  const serverMsg = (e as { responseText?: string; response?: string }).responseText || (e as { response?: string }).response;
  return json({ error: serverMsg ? `Mail server: ${String(serverMsg).slice(0, 200)}` : "Something went wrong. Please try again." }, 500);
}

export async function params<T>(req: Request): Promise<T> {
  const ctx = (req as Request & { ctx?: { params?: Promise<T> } }).ctx;
  return (await ctx?.params) as T;
}

export async function body<T>(req: Request, max = 1_000_000): Promise<T> {
  const text = await req.text();
  if (text.length > max) throw new BadRequest("Request too large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BadRequest("Invalid JSON");
  }
}
