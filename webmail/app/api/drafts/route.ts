import { route, body } from "@/lib/server/api";
import { backendFor } from "@/lib/server/backend";
import { normalize, type Draft } from "@/lib/server/compose";

export const POST = route(async (req, s) => {
  const b = await body<{ draft: Draft; replaceId?: string }>(req, 5_000_000);
  const id = await (await backendFor(s)).saveDraft(normalize(b.draft), b.replaceId || undefined);
  return { id };
});

export const DELETE = route(async (req, s) => {
  const b = await body<{ id: string }>(req);
  if (b.id) await (await backendFor(s)).act([b.id], "delete");
  return { ok: true };
});

