import { route } from "@/lib/server/api";
import { config } from "@/lib/server/config";
import { getAccessToken } from "@/lib/server/session";

const cache = new Map<string, { at: number; type: string; body: ArrayBuffer }>();

export const GET = route(async (_req, s) => {
  const hit = cache.get(s.username);
  let entry = hit && Date.now() - hit.at < 3600_000 ? hit : null;
  if (!entry) {
    if (!s.profile.id) return new Response(null, { status: 404 });
    const token = await getAccessToken(s.idHash);
    const r = await fetch(`${config.ion.url}/api/profile/${s.profile.id}/picture`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    const type = r.headers.get("content-type") || "";
    if (!r.ok || !/^image\/(jpeg|png|gif|webp)/.test(type)) return new Response(null, { status: 404 });
    entry = { at: Date.now(), type, body: await r.arrayBuffer() };
    cache.set(s.username, entry);
  }
  return new Response(entry.body, { headers: { "Content-Type": entry.type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
});
