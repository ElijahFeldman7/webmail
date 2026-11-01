import { route, params } from "@/lib/server/api";
import { backendFor } from "@/lib/server/backend";
import { randomId } from "@/lib/server/crypto";
import { getPrefs } from "@/lib/server/db";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const GET = route(async (req, s) => {
  const { id } = await params<{ id: string }>(req);
  const be = await backendFor(s);
  const m = await be.message(id);
  const { html } = await be.body(id, getPrefs(s.username).externalImages);
  const nonce = randomId(16);
  const addrs = (l: { name: string; address: string }[]) => l.map((a) => esc(a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(m.subject || "(no subject)")}</title>
<style>body{font-family:Arial,sans-serif;font-size:13px;margin:24px;color:#222}h1{font-size:18px;font-weight:700;margin:0 0 12px}table.h{border-top:1px solid #ccc;border-bottom:1px solid #ccc;width:100%;margin-bottom:16px;padding:8px 0}table.h td{padding:2px 6px;vertical-align:top}img{max-width:100%}</style></head>
<body><div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><img src="/tjlogo.png" width="28" height="28" alt=""><b>TJ Mail</b> <span style="margin-left:auto">${esc(s.username)}</span></div>
<h1>${esc(m.subject || "(no subject)")}</h1>
<table class="h"><tr><td><b>${esc(m.from.name || m.from.address)}</b> &lt;${esc(m.from.address)}&gt;</td><td style="text-align:right">${esc(new Date(m.date).toString())}</td></tr>
<tr><td colspan="2">To: ${addrs(m.to)}${m.cc.length ? `<br>Cc: ${addrs(m.cc)}` : ""}</td></tr></table>
<div>${html}</div><script nonce="${nonce}">window.onload=function(){window.print()}</script></body></html>`;
  return new Response(page, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "private, no-store",
    },
  });
});
