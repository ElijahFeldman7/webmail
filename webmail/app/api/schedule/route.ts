import { route } from "@/lib/server/api";
import { ionGet } from "@/lib/server/ion";
import { getAccessToken } from "@/lib/server/session";

export const GET = route(async (_req, s) => {
  if (s.username === "demo") {
    return { day: { date: new Date().toISOString().slice(0, 10), name: "Anchor Day", blocks: [["Period 1", "8:40", "9:25"], ["Period 2", "9:35", "10:15"], ["Lunch", "11:45", "12:25"]].map(([name, start, end]) => ({ name, start, end })) } };
  }
  const token = await getAccessToken(s.idHash);
  type IonDay = { date: string; day_type?: { name?: string; blocks?: { name: string; start: { hour: number; minute: number }; end: { hour: number; minute: number } }[] } };
  const data = await ionGet<{ results?: IonDay[] }>("/schedule", token);
  const today = data.results?.[0];
  return { day: today ? { date: today.date, name: plain(today.day_type?.name ?? ""), blocks: (today.day_type?.blocks ?? []).map((b) => ({ name: plain(b.name), start: fmt(b.start), end: fmt(b.end) })) } : null };
});

function plain(s: string) {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function fmt(t: { hour: number; minute: number }) {
  const h = t.hour % 12 || 12;
  return `${h}:${String(t.minute).padStart(2, "0")}`;
}
