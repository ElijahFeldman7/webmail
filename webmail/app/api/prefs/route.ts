import { route, body } from "@/lib/server/api";
import { getPrefs, setPrefs } from "@/lib/server/db";

export const GET = route(async (_req, s) => getPrefs(s.username));
export const PUT = route(async (req, s) => setPrefs(s.username, await body<Record<string, unknown>>(req, 100_000)));
