import "server-only";
import { Client } from "ldapts";
import { config } from "./config";

function esc(s: string) {
  return s.replace(/[\\*()\x00]/g, (c) => "\\" + c.charCodeAt(0).toString(16).padStart(2, "0"));
}

async function connect(): Promise<Client> {
  const client = new Client({ url: config.ldap.url, timeout: 5000, connectTimeout: 5000, tlsOptions: { minVersion: "TLSv1.2" } });
  if (config.ldap.url.startsWith("ldap://")) await client.startTLS({ minVersion: "TLSv1.2", servername: new URL(config.ldap.url).hostname });
  if (config.ldap.bindDn) await client.bind(config.ldap.bindDn, config.ldap.bindPassword);
  return client;
}

const userCache = new Map<string, { at: number; mails: string[]; cn: string }>();

export async function lookupUser(username: string): Promise<{ mails: string[]; cn: string } | null> {
  if (!config.ldap.url) return null;
  const hit = userCache.get(username);
  if (hit && Date.now() - hit.at < 3600_000) return hit;
  let client: Client | null = null;
  try {
    client = await connect();
    const { searchEntries } = await client.search(config.ldap.baseDn, { scope: "sub", filter: `(&(objectClass=inetOrgPerson)(uid=${esc(username)}))`, attributes: ["mail", "cn"], sizeLimit: 2 });
    const e = searchEntries[0];
    if (!e) return null;
    const mails = (Array.isArray(e.mail) ? e.mail : e.mail ? [e.mail] : []).map(String).filter(Boolean);
    const out = { at: Date.now(), mails, cn: String(e.cn ?? "") };
    userCache.set(username, out);
    return out;
  } catch (err) {
    console.error("[webmail] ldap user lookup failed:", (err as Error).message);
    return null;
  } finally {
    await client?.unbind().catch(() => {});
  }
}

export async function searchDirectory(q: string): Promise<{ name: string; email: string }[]> {
  if (!config.ldap.url || q.trim().length < 2) return [];
  const client = await connect();
  try {
    const t = esc(q.trim().slice(0, 64));
    const { searchEntries } = await client.search(config.ldap.baseDn, {
      scope: "sub",
      filter: `(&(mail=*)(|(cn=*${t}*)(mail=${t}*)(uid=${t}*)(givenName=${t}*)(sn=${t}*)))`,
      attributes: ["cn", "mail", "uid"],
      sizeLimit: 15,
    });
    return searchEntries.map((e) => ({ name: String(e.cn ?? e.uid ?? ""), email: String(Array.isArray(e.mail) ? e.mail[0] : e.mail) }));
  } catch (e) {
    console.error("[webmail] ldap search failed:", (e as Error).message);
    return [];
  } finally {
    await client.unbind().catch(() => {});
  }
}
