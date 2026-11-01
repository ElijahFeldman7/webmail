import { route, params } from "@/lib/server/api";
import { backendFor } from "@/lib/server/backend";

export const GET = route(async (req, s) => {
  const { id } = await params<{ id: string }>(req);
  const raw = await (await backendFor(s)).raw(id);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(raw), {
    headers: {
      "Content-Type": download ? "message/rfc822" : "text/plain; charset=utf-8",
      "Content-Disposition": download ? `attachment; filename="message.eml"` : "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
});
