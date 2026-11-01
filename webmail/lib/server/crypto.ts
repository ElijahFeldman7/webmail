import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

let masterKey: Buffer | null = null;

function getMaster(): Buffer {
  if (masterKey) return masterKey;
  let secret = config.secret;
  if (!secret) {
    if (config.isProd) throw new Error("SESSION_SECRET must be set in production");
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    const p = path.join(config.dataDir, "secret");
    try {
      secret = fs.readFileSync(p, "utf8").trim();
    } catch {
      secret = crypto.randomBytes(48).toString("base64url");
      fs.writeFileSync(p, secret, { mode: 0o600 });
    }
  }
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  masterKey = crypto.createHash("sha256").update(secret).digest();
  return masterKey;
}

function subkey(purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", getMaster(), Buffer.alloc(0), Buffer.from(purpose), 32));
}

let encKey: Buffer | null = null;
let macKey: Buffer | null = null;

export function encrypt(plain: string | Buffer, aad = ""): string {
  encKey ??= subkey("webmail-enc-v1");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

export function decrypt(blob: string, aad = ""): Buffer {
  encKey ??= subkey("webmail-enc-v1");
  const raw = Buffer.from(blob, "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", encKey, raw.subarray(0, 12));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
}

export function sign(data: string): string {
  macKey ??= subkey("webmail-mac-v1");
  return crypto.createHmac("sha256", macKey).update(data).digest("base64url").slice(0, 32);
}

export function verify(data: string, sig: string): boolean {
  const expected = Buffer.from(sign(data));
  const got = Buffer.from(sig || "");
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

export const randomId = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
