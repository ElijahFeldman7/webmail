import "server-only";
import net from "node:net";
import tls from "node:tls";
import { config } from "./config";

type Resp = { status: "OK" | "NO" | "BYE"; lines: string[]; literals: string[]; text: string };

class Conn {
  private buf = Buffer.alloc(0);
  private waiters: (() => void)[] = [];
  constructor(public sock: net.Socket | tls.TLSSocket) {
    this.attach(sock);
  }
  attach(sock: net.Socket | tls.TLSSocket) {
    this.sock = sock;
    sock.on("data", (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.waiters.splice(0).forEach((w) => w());
    });
    sock.on("error", () => this.waiters.splice(0).forEach((w) => w()));
    sock.on("close", () => this.waiters.splice(0).forEach((w) => w()));
  }
  detach() {
    this.sock.removeAllListeners("data");
    this.sock.removeAllListeners("error");
    this.sock.removeAllListeners("close");
  }
  private wait(): Promise<void> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("ManageSieve timeout")), 20000);
      this.waiters.push(() => {
        clearTimeout(t);
        if (this.sock.destroyed) rej(new Error("ManageSieve connection closed"));
        else res();
      });
    });
  }
  async read(): Promise<Resp> {
    const lines: string[] = [];
    const literals: string[] = [];
    for (;;) {
      const nl = this.buf.indexOf("\r\n");
      if (nl < 0) {
        await this.wait();
        continue;
      }
      const line = this.buf.subarray(0, nl).toString("utf8");
      const lit = /\{(\d+)\+?\}$/.exec(line);
      if (lit) {
        const n = Number(lit[1]);
        while (this.buf.length < nl + 2 + n) await this.wait();
        literals.push(this.buf.subarray(nl + 2, nl + 2 + n).toString("utf8"));
        this.buf = this.buf.subarray(nl + 2 + n);
        const nl2 = this.buf.indexOf("\r\n");
        if (nl2 >= 0) this.buf = this.buf.subarray(nl2 + 2);
        continue;
      }
      this.buf = this.buf.subarray(nl + 2);
      const m = /^(OK|NO|BYE)\b\s*(.*)$/i.exec(line);
      if (m) return { status: m[1].toUpperCase() as Resp["status"], lines, literals, text: m[2] };
      lines.push(line);
    }
  }
  write(s: string | Buffer) {
    this.sock.write(s);
  }
  async cmd(s: string): Promise<Resp> {
    this.write(s + "\r\n");
    const r = await this.read();
    if (r.status !== "OK") throw new Error(`ManageSieve: ${r.text.replace(/^\(.*?\)\s*/, "").replace(/"/g, "") || r.status}`);
    return r;
  }
}

const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export async function withSieve<T>(username: string, accessToken: string, fn: (s: SieveSession) => Promise<T>): Promise<T> {
  const sock = net.connect({ host: config.sieve.host, port: config.sieve.port });
  sock.setTimeout(30000, () => sock.destroy(new Error("timeout")));
  await new Promise<void>((res, rej) => {
    sock.once("connect", () => res());
    sock.once("error", rej);
  });
  const c = new Conn(sock);
  try {
    await c.read();
    await c.cmd("STARTTLS");
    c.detach();
    const t = tls.connect({ socket: sock, servername: config.sieve.host, minVersion: "TLSv1.2", rejectUnauthorized: !config.devTlsInsecure });
    await new Promise<void>((res, rej) => {
      t.once("secureConnect", () => res());
      t.once("error", rej);
    });
    c.attach(t);
    const caps = await c.read();
    const capText = caps.lines.join("\n");
    const sasl = /"SASL"\s+"([^"]*)"/i.exec(capText)?.[1]?.toUpperCase().split(/\s+/) ?? [];
    const ext = /"SIEVE"\s+"([^"]*)"/i.exec(capText)?.[1]?.toLowerCase().split(/\s+/) ?? [];
    if (sasl.includes("OAUTHBEARER")) {
      const payload = Buffer.from(`n,a=${username},\x01host=${config.sieve.host}\x01port=${config.sieve.port}\x01auth=Bearer ${accessToken}\x01\x01`).toString("base64");
      await c.cmd(`AUTHENTICATE "OAUTHBEARER" ${q(payload)}`);
    } else {
      const payload = Buffer.from(`user=${username}\x01auth=Bearer ${accessToken}\x01\x01`).toString("base64");
      await c.cmd(`AUTHENTICATE "XOAUTH2" ${q(payload)}`);
    }
    return await fn(new SieveSession(c, ext));
  } finally {
    try {
      c.write("LOGOUT\r\n");
    } catch {
    }
    setTimeout(() => sock.destroy(), 200).unref?.();
  }
}

export class SieveSession {
  constructor(private c: Conn, public extensions: string[]) {}
  async list(): Promise<{ name: string; active: boolean }[]> {
    const r = await this.c.cmd("LISTSCRIPTS");
    return r.lines.map((l) => {
      const m = /^"((?:[^"\\]|\\.)*)"(\s+ACTIVE)?/i.exec(l);
      return { name: m ? m[1].replace(/\\(.)/g, "$1") : l, active: !!m?.[2] };
    });
  }
  async get(name: string): Promise<string> {
    const r = await this.c.cmd(`GETSCRIPT ${q(name)}`);
    return r.literals[0] ?? "";
  }
  async put(name: string, script: string) {
    const bytes = Buffer.byteLength(script);
    this.c.write(`PUTSCRIPT ${q(name)} {${bytes}+}\r\n`);
    this.c.write(script);
    await this.c.cmd("");
  }
  async activate(name: string) {
    await this.c.cmd(`SETACTIVE ${q(name)}`);
  }
}

export type Filter = {
  id: string;
  from?: string;
  to?: string;
  subject?: string;
  has?: string;
  doesnt?: string;
  action: { move?: string; markRead?: boolean; star?: boolean; trash?: boolean; forward?: string; neverSpam?: boolean; important?: boolean };
};

export type SieveConfig = {
  filters: Filter[];
  blocked: string[];
  vacation: { enabled: boolean; subject: string; body: string; start?: string; end?: string; days: number };
  forward: { enabled: boolean; address: string };
  include: string | null;
};

export const emptyConfig = (): SieveConfig => ({ filters: [], blocked: [], vacation: { enabled: false, subject: "", body: "", days: 1 }, forward: { enabled: false, address: "" }, include: null });

const SCRIPT = "webmail";
const MARK = "# webmail-config: ";

export function parseConfig(script: string): SieveConfig | null {
  const line = script.split(/\r?\n/).find((l) => l.startsWith(MARK));
  if (!line) return null;
  try {
    return { ...emptyConfig(), ...JSON.parse(Buffer.from(line.slice(MARK.length), "base64").toString()) };
  } catch {
    return null;
  }
}

const S = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function generate(cfg: SieveConfig, folders: { trash: string; spam: string }, ext: string[]): string {
  const req = new Set<string>(["fileinto"]);
  const out: string[] = [];
  const has = (e: string) => ext.includes(e);
  if (cfg.blocked.length) out.push(`# Blocked senders\nif address :is "from" [${cfg.blocked.map(S).join(", ")}] {\n  fileinto ${S(folders.spam)};\n  stop;\n}`);
  for (const f of cfg.filters) {
    const conds: string[] = [];
    if (f.from) conds.push(`address :contains "from" ${S(f.from)}`);
    if (f.to) conds.push(`address :contains ["to", "cc"] ${S(f.to)}`);
    if (f.subject) conds.push(`header :contains "subject" ${S(f.subject)}`);
    if (f.has && has("body")) {
      req.add("body");
      conds.push(`body :text :contains ${S(f.has)}`);
    }
    if (f.doesnt && has("body")) {
      req.add("body");
      conds.push(`not body :text :contains ${S(f.doesnt)}`);
    }
    if (!conds.length) continue;
    const acts: string[] = [];
    if ((f.action.markRead || f.action.star || f.action.important) && has("imap4flags")) {
      req.add("imap4flags");
      const flags = [f.action.markRead && "\\\\Seen", f.action.star && "\\\\Flagged", f.action.important && "$Important"].filter(Boolean) as string[];
      acts.push(`addflag [${flags.map((x) => `"${x}"`).join(", ")}];`);
    }
    if (f.action.forward) {
      if (has("copy")) req.add("copy");
      acts.push(`redirect${has("copy") ? " :copy" : ""} ${S(f.action.forward)};`);
    }
    if (f.action.trash) acts.push(`fileinto ${S(folders.trash)};`, "stop;");
    else if (f.action.move) acts.push(`fileinto ${S(f.action.move)};`, "stop;");
    else if (f.action.neverSpam) acts.push("keep;", "stop;");
    if (!acts.length) continue;
    out.push(`# Filter ${f.id}\nif allof (${conds.join(", ")}) {\n  ${acts.join("\n  ")}\n}`);
  }
  if (cfg.forward.enabled && cfg.forward.address) {
    if (has("copy")) req.add("copy");
    out.push(`# Forwarding\nredirect${has("copy") ? " :copy" : ""} ${S(cfg.forward.address)};${has("copy") ? "" : "\nkeep;"}`);
  }
  if (cfg.vacation.enabled && has("vacation")) {
    req.add("vacation");
    const conds: string[] = [];
    if ((cfg.vacation.start || cfg.vacation.end) && has("date") && has("relational")) {
      req.add("date");
      req.add("relational");
      if (cfg.vacation.start) conds.push(`currentdate :value "ge" "date" ${S(cfg.vacation.start)}`);
      if (cfg.vacation.end) conds.push(`currentdate :value "le" "date" ${S(cfg.vacation.end)}`);
    }
    const v = `vacation :days ${Math.max(1, Math.min(30, cfg.vacation.days || 1))} :subject ${S(cfg.vacation.subject || "Out of office")} ${S(cfg.vacation.body || "")};`;
    out.push(`# Vacation responder\n${conds.length ? `if allof (${conds.join(", ")}) {\n  ${v}\n}` : v}`);
  }
  if (cfg.include && has("include")) {
    req.add("include");
    out.push(`# Previously active script\ninclude :personal ${S(cfg.include)};`);
  }
  const header = `require [${[...req].map((r) => `"${r}"`).join(", ")}];\n${MARK}${Buffer.from(JSON.stringify(cfg)).toString("base64")}\n# Managed by TJ Mail. Edits made outside the web interface will be overwritten.\n`;
  return header + "\n" + out.join("\n\n") + "\n";
}

export async function loadConfig(s: SieveSession): Promise<SieveConfig> {
  const scripts = await s.list();
  const mine = scripts.find((x) => x.name === SCRIPT);
  if (mine) {
    const cfg = parseConfig(await s.get(SCRIPT));
    if (cfg) return cfg;
  }
  const cfg = emptyConfig();
  const active = scripts.find((x) => x.active && x.name !== SCRIPT);
  if (active) cfg.include = active.name;
  return cfg;
}

export async function saveConfig(s: SieveSession, cfg: SieveConfig, folders: { trash: string; spam: string }) {
  const script = generate(cfg, folders, s.extensions);
  await s.put(SCRIPT, script);
  await s.activate(SCRIPT);
}
