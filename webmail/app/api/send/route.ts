import { route, body } from "@/lib/server/api";
import { backendFor } from "@/lib/server/backend";
import { normalize, type Draft } from "@/lib/server/compose";
import { getPrefs } from "@/lib/server/db";
import { BadRequest } from "@/lib/server/mail";

export const POST = route(async (req, s) => {
  const b = await body<{ draft: Draft; draftId?: string; sendAt?: number }>(req, 5_000_000);
  const prefs = getPrefs(s.username);
  let sendAt = Date.now() + prefs.undoSeconds * 1000;
  let kind: "undo" | "scheduled" = "undo";
  if (b.sendAt) {
    const t = Number(b.sendAt);
    if (!Number.isFinite(t) || t < Date.now() - 60_000 || t > Date.now() + 2 * 365 * 86400_000) throw new BadRequest("Invalid schedule time");
    sendAt = t;
    kind = "scheduled";
  }
  const id = await (await backendFor(s)).send(normalize(b.draft), { sendAt, kind, draftId: b.draftId || undefined });
  return { id, sendAt, undoSeconds: kind === "undo" ? prefs.undoSeconds : 0 };
});
