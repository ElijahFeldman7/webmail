import { route, params } from "@/lib/server/api";
import { cancelQueued } from "@/lib/server/compose";

export const DELETE = route(async (req, s) => {
  const { id } = await params<{ id: string }>(req);
  return { cancelled: cancelQueued(s.username, String(id)) };
});
