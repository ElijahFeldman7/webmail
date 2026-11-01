import { route, params } from "@/lib/server/api";
import { backendFor } from "@/lib/server/backend";

export const GET = route(async (req, s) => {
  const { id } = await params<{ id: string }>(req);
  return (await backendFor(s)).message(id);
});
