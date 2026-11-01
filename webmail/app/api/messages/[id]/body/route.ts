import { route, params } from "@/lib/server/api";
import { backendFor } from "@/lib/server/backend";
import { getPrefs } from "@/lib/server/db";
import { BODY_CSP, wrapBody } from "@/lib/server/sanitize";

export const GET = route(async (req, s) => {
  const { id } = await params<{ id: string }>(req);
  const u = new URL(req.url).searchParams;
  const allow = u.get("images") === "1" || getPrefs(s.username).externalImages;
  const { html, blocked } = await (await backendFor(s)).body(id, allow);
  return new Response(wrapBody(html), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": BODY_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "private, no-store",
      "X-Blocked-Images": String(blocked),
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
});
