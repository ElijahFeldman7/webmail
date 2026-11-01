import { route } from "@/lib/server/api";
import { config } from "@/lib/server/config";
import { watch } from "@/lib/server/imap";

export const GET = route(async (req, s) => {
  const enc = new TextEncoder();
  let unsub: (() => void) | null = null;
  let ping: NodeJS.Timeout | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
        }
      };
      send({ type: "hello" });
      if (!(config.demo && s.username === "demo")) unsub = watch(s.username, s.idHash, send);
      ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
        }
      }, 25_000);
      req.signal.addEventListener("abort", () => {
        unsub?.();
        if (ping) clearInterval(ping);
        try {
          controller.close();
        } catch {
        }
      });
    },
    cancel() {
      unsub?.();
      if (ping) clearInterval(ping);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
});
