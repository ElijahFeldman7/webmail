import { route, params } from "@/lib/server/api";
import { backendFor } from "@/lib/server/backend";

const INLINE_SAFE = /^(image\/(png|jpe?g|gif|webp|bmp)|application\/pdf|text\/plain)$/i;

export const GET = route(async (req, s) => {
  const { id, part } = await params<{ id: string; part: string }>(req);
  const a = await (await backendFor(s)).attachment(id, String(Number(part) || 0));
  const u = new URL(req.url).searchParams;
  const type = a.contentType.toLowerCase();
  const inline = (u.get("inline") === "1" || u.get("view") === "1") && INLINE_SAFE.test(type);
  const name = a.filename.replace(/[\r\n"]/g, "_");
  return new Response(new Uint8Array(a.content), {
    headers: {
      "Content-Type": inline ? (type === "text/plain" ? "text/plain; charset=utf-8" : type) : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": inline && type === "application/pdf" ? "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, max-age=600",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
});
