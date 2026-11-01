import { route, body } from "@/lib/server/api";
import { backendFor } from "@/lib/server/backend";
import { BadRequest } from "@/lib/server/mail";

export const GET = route(async (req, s) => {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  return { folders: await (await backendFor(s)).folders(fresh) };
});

export const POST = route(async (req, s) => {
  const b = await body<{ name: string; parent?: string }>(req);
  return { path: await (await backendFor(s)).createFolder(String(b.name || ""), b.parent) };
});

export const PATCH = route(async (req, s) => {
  const b = await body<{ path: string; name: string }>(req);
  if (!b.path) throw new BadRequest("Missing path");
  return { path: await (await backendFor(s)).renameFolder(String(b.path), String(b.name || "")) };
});

export const DELETE = route(async (req, s) => {
  const b = await body<{ path: string }>(req);
  if (!b.path) throw new BadRequest("Missing path");
  await (await backendFor(s)).deleteFolder(String(b.path));
  return { ok: true };
});
