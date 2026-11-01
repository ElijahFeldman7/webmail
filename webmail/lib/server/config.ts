import "server-only";
import path from "node:path";
import fs from "node:fs";

function loadParentEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  if (process.env.NODE_ENV === "production") return out;
  for (const p of [path.resolve( process.cwd(), ".env"), path.resolve( process.cwd(), "..", ".env")]) {
    try {
      const txt = fs.readFileSync( p, "utf8");
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
      }
    } catch {
    }
  }
  return out;
}

const isProd = process.env.NODE_ENV === "production";
const fileEnv = loadParentEnv();
function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fileEnv[name] ?? fallback;
}

export const config = {
  isProd,
  appUrl: (env("APP_URL", "http://localhost:3000") as string).replace(/\/$/, ""),
  ion: {
    url: (env("ION_URL", "https://ion.tjhsst.edu") as string).replace(/\/$/, ""),
    clientId: env("ION_CLIENT_ID") ?? env("CLIENT_ID") ?? "",
    clientSecret: env("ION_CLIENT_SECRET") ?? env("CLIENT_SECRET") ?? "",
    scope: env("ION_SCOPE", "read") as string,
  },
  imap: {
    host: env("IMAP_HOST", "imap.tjhsst.edu") as string,
    port: Number(env("IMAP_PORT", "993")),
  },
  smtp: {
    host: env("SMTP_HOST", "smtp.tjhsst.edu") as string,
    port: Number(env("SMTP_PORT", "465")),
    secure: env("SMTP_SECURE", env("SMTP_PORT", "465") === "587" ? "0" : "1") === "1",
  },
  sieve: {
    host: env("SIEVE_HOST", env("IMAP_HOST", "imap.tjhsst.edu")) as string,
    port: Number(env("SIEVE_PORT", "4190")),
  },
  ldap: {
    url: env("LDAP_URL", "") as string,
    bindDn: env("LDAP_BIND_DN", "") as string,
    bindPassword: env("LDAP_BIND_PASSWORD", "") as string,
    baseDn: env("LDAP_BASE_DN", "cn=users,cn=accounts,dc=csl,dc=tjhsst,dc=edu") as string,
  },
  mailDomain: env("MAIL_DOMAIN", "tjhsst.edu") as string,
  dataDir: env("DATA_DIR", path.resolve(process.cwd(), ".data")) as string,
  secret: env("SESSION_SECRET", "") as string,
  maxMessageBytes: Number(env("SMTP_MAX_BYTES", "36700160")),
  maxAttachmentBytes: 25 * 1024 * 1024,
  imapIdleMs: Number(env("IMAP_IDLE_MS", String(5 * 60 * 1000))),
  sessionDays: 30,
  demo: !isProd && env("DEMO", "0") === "1",
  devLogin: !isProd && env("DEV_LOGIN", "0") === "1",
  devTlsInsecure: !isProd && env("DEV_TLS_INSECURE", "0") === "1",
};

export const redirectUri = () => `${config.appUrl}/api/auth/callback`;
export const secureCookies = () => config.appUrl.startsWith("https://");
