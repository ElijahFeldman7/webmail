const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function time12(d: Date) {
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

export function listDate(iso: string, now = new Date()) {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return time12(d);
  if (d.getFullYear() === now.getFullYear()) return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

export function longDate(iso: string, now = new Date()) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === now.getFullYear();
  const base = `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? "" : ", " + d.getFullYear()}, ${time12(d)}`;
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  let ago = "";
  if (mins < 1) ago = "now";
  else if (mins < 60) ago = `${mins} minute${mins === 1 ? "" : "s"} ago`;
  else if (mins < 60 * 24) ago = `${Math.floor(mins / 60)} hour${Math.floor(mins / 60) === 1 ? "" : "s"} ago`;
  else if (mins < 60 * 24 * 30) ago = `${Math.floor(mins / 1440)} day${Math.floor(mins / 1440) === 1 ? "" : "s"} ago`;
  return ago ? `${base} (${ago})` : base;
}

export function fullDate(iso: string) {
  const d = new Date(iso);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${time12(d)}`;
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  const g = n / 1024 / 1024 / 1024;
  return `${Number.isInteger(Math.round(g * 10) / 10) ? Math.round(g) : g.toFixed(1)} GB`;
}

export function displayName(a: { name: string; address: string }, myAddresses: string[] = []) {
  if (myAddresses.includes(a.address.toLowerCase())) return "me";
  return a.name || a.address.split("@")[0] || a.address;
}

export function formatAddr(a: { name: string; address: string }) {
  if (!a.name) return a.address;
  const needsQuote = /[,;<>"@()]/.test(a.name);
  return `${needsQuote ? `"${a.name.replace(/"/g, "")}"` : a.name} <${a.address}>`;
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
