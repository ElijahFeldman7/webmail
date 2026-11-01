import { route } from "@/lib/server/api";
import { verify } from "@/lib/server/crypto";
import { fetchImage } from "@/lib/server/proxy";

const cache = new Map<string, { at: number; type: string; body: Buffer }>();
let cacheBytes = 0;

export const GET = route(async (req) => {
  const u = new URL(req.url).searchParams;
  const enc = u.get("u") || "";
  let url = "";
  try {
    url = Buffer.from(enc, "base64url").toString();
  } catch {
  }
  if (!url || !verify("img:" + url, u.get("s") || "")) return new Response("Bad signature", { status: 403 });
  let hit = cache.get(url);
  if (!hit || Date.now() - hit.at > 3600_000) {
    try {
      const img = await fetchImage(url);
      hit = { at: Date.now(), ...img };
      if (img.body.length < 2_000_000) {
        cache.set(url, hit);
        cacheBytes += img.body.length;
        if (cacheBytes > 200_000_000) {
          cache.clear();
          cacheBytes = 0;
        }
      }
    } catch {
      return new Response(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"), {
        headers: { "Content-Type": "image/gif", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
      });
    }
  }
  return new Response(new Uint8Array(hit.body), {
    headers: {
      "Content-Type": hit.type,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
});
