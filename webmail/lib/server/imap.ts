import "server-only";
import { ImapFlow } from "imapflow";
import { config } from "./config";
import { getAccessToken } from "./session";

type Entry = {
  client: ImapFlow | null;
  connecting: Promise<ImapFlow> | null;
  lastUsed: number;
  timer: NodeJS.Timeout | null;
  idHash: string;
};

type Watch = {
  client: ImapFlow | null;
  listeners: Set<(ev: MailEvent) => void>;
  starting: boolean;
  idHash: string;
};

export type MailEvent = { type: "new" | "changed"; folder: string };

const g = globalThis as unknown as { __imapPool?: Map<string, Entry>; __imapWatch?: Map<string, Watch> };
const pool = (g.__imapPool ??= new Map());
const watches = (g.__imapWatch ??= new Map());

export class MailAuthError extends Error {}

async function connect(username: string, idHash: string): Promise<ImapFlow> {
  const accessToken = await getAccessToken(idHash);
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: true,
    auth: { user: username, accessToken },
    logger: false,
    emitLogs: false,
    disableAutoIdle: false,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 5 * 60 * 1000,
    tls: { rejectUnauthorized: !config.devTlsInsecure, minVersion: "TLSv1.2" },
  });
  client.on("error", () => {
  });
  try {
    await client.connect();
  } catch (e) {
    const err = e as { authenticationFailed?: boolean; message?: string };
    if (err.authenticationFailed) throw new MailAuthError("Mail server rejected the login");
    throw e;
  }
  return client;
}

function scheduleClose(username: string, entry: Entry) {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    if (Date.now() - entry.lastUsed >= config.imapIdleMs - 1000) {
      const c = entry.client;
      entry.client = null;
      pool.delete(username);
      c?.logout().catch(() => c.close());
    } else scheduleClose(username, entry);
  }, config.imapIdleMs);
  entry.timer.unref?.();
}

export async function getClient(username: string, idHash: string): Promise<ImapFlow> {
  let entry = pool.get(username);
  if (!entry) {
    entry = { client: null, connecting: null, lastUsed: Date.now(), timer: null, idHash };
    pool.set(username, entry);
  }
  entry.lastUsed = Date.now();
  entry.idHash = idHash;
  scheduleClose(username, entry);
  if (entry.client && entry.client.usable) return entry.client;
  if (!entry.connecting) {
    const e = entry;
    e.connecting = connect(username, idHash)
      .then((c) => {
        e.client = c;
        c.on("close", () => {
          if (e.client === c) e.client = null;
        });
        return c;
      })
      .finally(() => {
        e.connecting = null;
      });
  }
  return entry.connecting;
}

export async function withImap<T>(username: string, idHash: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await getClient(username, idHash);
    try {
      return await fn(client);
    } catch (e) {
      const msg = (e as Error).message || "";
      const dropped = !client.usable || /Connection not available|closed|ECONNRESET|EPIPE|socket/i.test(msg);
      if (attempt === 0 && dropped) {
        const entry = pool.get(username);
        if (entry?.client === client) entry.client = null;
        continue;
      }
      throw e;
    }
  }
}

export async function inMailbox<T>(client: ImapFlow, path: string, fn: () => Promise<T>, readOnly = false): Promise<T> {
  const lock = await client.getMailboxLock(path, { readOnly });
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

export function closeUser(username: string) {
  const e = pool.get(username);
  if (e) {
    pool.delete(username);
    if (e.timer) clearTimeout(e.timer);
    e.client?.logout().catch(() => e.client?.close());
  }
  const w = watches.get(username);
  if (w) {
    watches.delete(username);
    w.client?.logout().catch(() => w.client?.close());
  }
}

export function watch(username: string, idHash: string, listener: (ev: MailEvent) => void): () => void {
  let w = watches.get(username);
  if (!w) {
    w = { client: null, listeners: new Set(), starting: false, idHash };
    watches.set(username, w);
  }
  w.idHash = idHash;
  w.listeners.add(listener);
  startWatch(username, w);
  return () => {
    w!.listeners.delete(listener);
    if (w!.listeners.size === 0) {
      setTimeout(() => {
        if (w!.listeners.size === 0 && watches.get(username) === w) {
          watches.delete(username);
          const c = w!.client;
          w!.client = null;
          c?.logout().catch(() => c.close());
        }
      }, 30_000).unref?.();
    }
  };
}

function startWatch(username: string, w: Watch) {
  if (w.client || w.starting) return;
  w.starting = true;
  connect(username, w.idHash)
    .then(async (c) => {
      w.client = c;
      c.on("exists", () => w.listeners.forEach((l) => l({ type: "new", folder: "INBOX" })));
      c.on("flags", () => w.listeners.forEach((l) => l({ type: "changed", folder: "INBOX" })));
      c.on("expunge", () => w.listeners.forEach((l) => l({ type: "changed", folder: "INBOX" })));
      c.on("close", () => {
        if (w.client === c) w.client = null;
        if (watches.get(username) === w && w.listeners.size > 0) setTimeout(() => startWatch(username, w), 10_000).unref?.();
      });
      await c.mailboxOpen("INBOX", { readOnly: true });
    })
    .catch(() => {
      if (watches.get(username) === w && w.listeners.size > 0) setTimeout(() => startWatch(username, w), 30_000).unref?.();
    })
    .finally(() => {
      w.starting = false;
    });
}
