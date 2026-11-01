import { route, body } from "@/lib/server/api";
import { backendFor } from "@/lib/server/backend";
import { BadRequest, type Action } from "@/lib/server/mail";
import type { Category } from "@/lib/types";

const CATS: Category[] = ["primary", "promotions", "social", "updates", "forums"];
const ACTIONS: Action[] = ["read", "unread", "star", "unstar", "important", "notimportant", "archive", "trash", "delete", "spam", "notspam", "move", "copy", "inbox"];

export const GET = route(async (req, s) => {
  const u = new URL(req.url).searchParams;
  const view = (u.get("view") || "inbox").slice(0, 500);
  const category = u.get("category") as Category | null;
  const page = Math.max(1, Math.min(10000, Number(u.get("page")) || 1));
  return (await backendFor(s)).list({
    view,
    category: category && CATS.includes(category) ? category : undefined,
    q: (u.get("q") || "").slice(0, 1000),
    page,
  });
});

type Body = { ids?: string[]; action: Action | "snooze" | "markAllRead" | "empty"; target?: string; until?: number; view?: string };

export const POST = route(async (req, s) => {
  const b = await body<Body>(req);
  const be = await backendFor(s);
  const ids = Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === "string") : [];
  if (b.action === "snooze") {
    const until = Number(b.until);
    if (!Number.isFinite(until) || until < Date.now()) throw new BadRequest("Pick a time in the future");
    await be.snooze(ids, until);
    return { ok: true };
  }
  if (b.action === "markAllRead") {
    await be.markAllRead(String(b.view || "inbox"));
    return { ok: true };
  }
  if (b.action === "empty") {
    if (b.target !== "trash" && b.target !== "spam") throw new BadRequest("Bad folder");
    await be.empty(b.target);
    return { ok: true };
  }
  if (!ACTIONS.includes(b.action)) throw new BadRequest("Unknown action");
  return await be.act(ids, b.action, b.target);
});
