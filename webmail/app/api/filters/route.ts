import { route, body } from "@/lib/server/api";
import { backendFor } from "@/lib/server/backend";
import { config } from "@/lib/server/config";
import { BadRequest } from "@/lib/server/mail";
import { getAccessToken, type Session } from "@/lib/server/session";
import { emptyConfig, loadConfig, saveConfig, withSieve, type SieveConfig, type Filter } from "@/lib/server/sieve";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const demoStore = new Map<string, SieveConfig>();
const isDemo = (s: Session) => config.demo && s.username === "demo";

async function folderNames(s: Session) {
  const folders = await (await backendFor(s)).folders();
  return {
    all: folders.map((f) => f.path),
    trash: folders.find((f) => f.role === "trash")?.path ?? "Trash",
    spam: folders.find((f) => f.role === "spam")?.path ?? "Junk",
  };
}

function clean(input: SieveConfig, folders: string[]): SieveConfig {
  const str = (v: unknown, n = 500) => (typeof v === "string" ? v.slice(0, n) : "");
  const cfg = emptyConfig();
  cfg.include = typeof input.include === "string" && /^[\w.-]{1,100}$/.test(input.include) ? input.include : null;
  cfg.blocked = (Array.isArray(input.blocked) ? input.blocked : []).map((x) => str(x, 254).trim().toLowerCase()).filter((x) => EMAIL.test(x)).slice(0, 1000);
  cfg.filters = (Array.isArray(input.filters) ? input.filters : []).slice(0, 200).map((f: Filter, i): Filter => {
    const a = f.action || {};
    const fwd = str(a.forward, 254).trim();
    if (fwd && !EMAIL.test(fwd)) throw new BadRequest(`Invalid forwarding address: ${fwd}`);
    const move = str(a.move, 300);
    if (move && !folders.includes(move)) throw new BadRequest(`Unknown label: ${move}`);
    return {
      id: str(f.id, 40) || String(Date.now() + i),
      from: str(f.from),
      to: str(f.to),
      subject: str(f.subject),
      has: str(f.has),
      doesnt: str(f.doesnt),
      action: { move: move || undefined, markRead: !!a.markRead, star: !!a.star, trash: !!a.trash, forward: fwd || undefined, neverSpam: !!a.neverSpam, important: !!a.important },
    };
  });
  const v = input.vacation || ({} as SieveConfig["vacation"]);
  const date = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
  cfg.vacation = { enabled: !!v.enabled, subject: str(v.subject, 300), body: str(v.body, 10000), start: date(v.start), end: date(v.end), days: Math.max(1, Math.min(30, Number(v.days) || 1)) };
  const fw = input.forward || ({} as SieveConfig["forward"]);
  const addr = str(fw.address, 254).trim();
  if (fw.enabled && !EMAIL.test(addr)) throw new BadRequest("Invalid forwarding address");
  cfg.forward = { enabled: !!fw.enabled && EMAIL.test(addr), address: addr };
  return cfg;
}

async function load(s: Session): Promise<SieveConfig> {
  if (isDemo(s)) return demoStore.get(s.username) ?? emptyConfig();
  return withSieve(s.username, await getAccessToken(s.idHash), (c) => loadConfig(c));
}

async function save(s: Session, cfg: SieveConfig, f: { trash: string; spam: string }) {
  if (isDemo(s)) return void demoStore.set(s.username, cfg);
  await withSieve(s.username, await getAccessToken(s.idHash), (c) => saveConfig(c, cfg, f));
}

export const GET = route(async (_req, s) => ({ config: await load(s) }));

export const PUT = route(async (req, s) => {
  const b = await body<{ config: SieveConfig }>(req, 200_000);
  const f = await folderNames(s);
  const cfg = clean(b.config, f.all);
  await save(s, cfg, f);
  return { config: cfg };
});

export const PATCH = route(async (req, s) => {
  const b = await body<{ block?: string; unblock?: string[]; addFilter?: Filter }>(req);
  const f = await folderNames(s);
  const cur = await load(s);
  if (b.block) {
    const a = b.block.trim().toLowerCase();
    if (!EMAIL.test(a)) throw new BadRequest("Invalid address");
    if (!cur.blocked.includes(a)) cur.blocked.push(a);
  }
  if (b.unblock) cur.blocked = cur.blocked.filter((x) => !b.unblock!.includes(x));
  if (b.addFilter) cur.filters.push(b.addFilter);
  const cfg = clean(cur, f.all);
  await save(s, cfg, f);
  return { config: cfg };
});
