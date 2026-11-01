import "server-only";
import dns from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = /^image\/(png|jpe?g|gif|webp|bmp|x-icon|vnd\.microsoft\.icon|avif)$/i;

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v) || v.startsWith("64:ff9b:") || v.startsWith("2001:db8");
}

function safeLookup(hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    const list = (addresses as dns.LookupAddress[]).filter((a) => !isPrivate(a.address));
    if (!list.length) return cb(Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }), "");
    if (options.all) cb(null, list);
    else cb(null, list[0].address, list[0].family);
  });
}

export async function fetchImage(url: string, hops = 0): Promise<{ type: string; body: Buffer }> {
  if (hops > 3) throw new Error("Too many redirects");
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Bad scheme");
  if (u.username || u.password) throw new Error("Credentials in URL");
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) throw new Error("Port not allowed");
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) && isPrivate(u.hostname.replace(/^\[|\]$/g, ""))) throw new Error("Blocked address");
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(
      u,
      {
        lookup: safeLookup as unknown as typeof dns.lookup,
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0 (TJHSST Webmail image proxy)", Accept: "image/avif,image/webp,image/png,image/*;q=0.8" },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          fetchImage(new URL(res.headers.location, u).toString(), hops + 1).then(resolve, reject);
          return;
        }
        const type = String(res.headers["content-type"] || "").split(";")[0].trim();
        if (status !== 200 || !ALLOWED.test(type)) {
          res.resume();
          return reject(new Error(`Upstream ${status} ${type}`));
        }
        const len = Number(res.headers["content-length"] || 0);
        if (len > MAX_BYTES) {
          res.destroy();
          return reject(new Error("Too large"));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (c: Buffer) => {
          total += c.length;
          if (total > MAX_BYTES) {
            res.destroy();
            reject(new Error("Too large"));
          } else chunks.push(c);
        });
        res.on("end", () => resolve({ type, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timeout")));
    req.on("error", reject);
  });
}
