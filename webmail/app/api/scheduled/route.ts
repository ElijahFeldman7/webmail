import { route } from "@/lib/server/api";
import { listScheduled } from "@/lib/server/compose";

export const GET = route(async (_req, s) => ({ items: listScheduled(s.username) }));
