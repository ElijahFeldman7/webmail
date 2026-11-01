import "server-only";
import type { Backend, ListArgs } from "./backend";
import type { Category, Folder, ListResult, MessageDetail, MessageSummary, Identity } from "../types";
import type { Action } from "./mail";
import { BadRequest, NotFound } from "./mail";
import { sanitizeEmailHtml, textToHtml } from "./sanitize";
import type { Draft } from "./compose";
import { parseAddresses } from "./compose";
import { getPrefs } from "./db";

type DemoMsg = MessageSummary & { html?: string; text: string; cc?: string; conv?: string };

const ME = { name: "Eli Feldman", address: "demo@tjhsst.edu" };

function d(month: number, day: number, h = 9, m = 0, y = 2026) {
  return new Date(y, month - 1, day, h, m).toISOString();
}

const HACKATIME_HTML = `<div style="max-width:568px;margin:0 auto;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2328">
<div style="padding:16px 0 0"><div style="width:32px;height:32px;border-radius:50%;background:#ec3750;color:#fff;text-align:center;line-height:32px;font-weight:700">&#9829;</div></div>
<h1 style="font-size:26px;margin:18px 0 6px">Your coding recap</h1>
<div style="color:#57606a;font-size:14px;margin-bottom:22px">Oct 18 - Oct 25, 2026</div>
<p style="font-size:14px;margin:0 0 22px">Hi <b>elifeldman769</b>, here is your weekly coding snapshot from Hackatime.</p>
<div style="border:1px solid #e6e8eb;border-radius:8px;overflow:hidden;margin-bottom:16px">
<div style="background:#fdf1f2;padding:16px 18px"><div style="font-size:11px;letter-spacing:1px;color:#ec3750;font-weight:600">TOTAL CODING TIME</div><div style="font-size:30px;font-weight:700;margin-top:6px">16h 44m</div></div>
<table style="width:100%;border-collapse:collapse;font-size:13px"><tr>
<td style="padding:14px 18px;border-top:1px solid #e6e8eb"><div style="color:#57606a;font-size:12px">Daily average</div><div style="font-weight:700;font-size:18px;margin-top:4px">2h 23m</div></td>
<td style="padding:14px 18px;border-top:1px solid #e6e8eb;border-left:1px solid #e6e8eb"><div style="color:#57606a;font-size:12px">Active days</div><div style="font-weight:700;font-size:18px;margin-top:4px">7<span style="color:#8c959f">/7</span></div></td>
<td style="padding:14px 18px;border-top:1px solid #e6e8eb;border-left:1px solid #e6e8eb"><div style="color:#57606a;font-size:12px">Heartbeats</div><div style="font-weight:700;font-size:18px;margin-top:4px">2,613</div></td>
</tr></table></div>
<div style="border:1px solid #e6e8eb;border-radius:8px;overflow:hidden;margin-bottom:16px">
<div style="background:#f6f8fa;padding:12px 18px;font-size:11px;letter-spacing:1px;color:#ec3750;font-weight:600">TOP PROJECTS</div>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${[["ansible", "4h 27m"], ["cv", "3h 54m"], ["ai", "2h 56m"], ["scholarkg", "2h 9m"], ["eli", "1h 53m"]].map(([a, b]) => `<tr><td style="padding:14px 18px;border-top:1px solid #e6e8eb">${a}</td><td style="padding:14px 18px;border-top:1px solid #e6e8eb;text-align:right;font-weight:700">${b}</td></tr>`).join("")}
</table></div>
<div style="border:1px solid #e6e8eb;border-radius:8px;overflow:hidden;margin-bottom:16px">
<div style="background:#f6f8fa;padding:12px 18px;font-size:11px;letter-spacing:1px;color:#ec3750;font-weight:600">TOP LANGUAGES</div>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${[["Python", "3h 35m"], ["C++", "3h 31m"], ["YAML", "36m"], ["TypeScript", "32m"], ["Markdown", "26m"]].map(([a, b]) => `<tr><td style="padding:14px 18px;border-top:1px solid #e6e8eb">${a}</td><td style="padding:14px 18px;border-top:1px solid #e6e8eb;text-align:right;font-weight:700">${b}</td></tr>`).join("")}
</table></div>
<div style="text-align:center;margin:20px 0 40px"><a href="https://hackatime.hackclub.com" style="display:inline-block;background:#c0394b;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:6px">View your dashboard &rarr;</a></div>
<hr style="border:none;border-top:1px solid #d0d7de;margin:0 -20px">
<p style="text-align:center;color:#8c959f;font-size:12px">Don't want to get these anymore? <a href="https://hackatime.hackclub.com" style="color:#8c959f">Unsubscribe</a></p>
<img src="https://hackatime.hackclub.com/pixel.gif" width="1" height="1" alt="">
</div>`;

type Seed = [string, string, string, string, string, Partial<DemoMsg>?];

const PRIMARY: Seed[] = [
  ["Pozez JCC", "news@pozezjcc.org", "Upcoming Cultural Programs at the J", "November at the J is full of chances to explore Jewish culture in all its variety. Next month, we're offering concerts, films, and more.", d(10, 28)],
  ["Chase", "no.reply.alerts@chase.com", "We tried adding your external account", "External account We couldn't add your external account We're unable to add the external account below.", d(10, 28)],
  ["Chase", "no.reply.alerts@chase.com", "Your Paperless Statement settings have been updated", "Paperless settings Updates to your paperless statement settings Another person named on your account changed settings.", d(10, 25, 16), { threadCount: 2 }],
  ["Hackatime", "hackatime@hackclub.com", "Your Hackatime weekly summary (Oct 18 - Oct 25, 2026)", "Your coding recap Oct 18 - Oct 25, 2026 Hi elifeldman769, here is your weekly coding snapshot from Hackatime.", d(10, 25, 15, 30), { html: HACKATIME_HTML }],
  ["Chase", "no.reply.alerts@chase.com", "Finish setting up your external account access", "External account Your external account is almost ready to use As you requested, we added your account.", d(10, 24)],
  ["Zach Latta (Hack Club)", "zach@hackclub.com", "A birthday ask", "Hi Elijah, Today is my birthday. If we haven't met yet, I'm Zach, founder of Hack Club. I started Hack Club when I was 15 to support teens.", d(10, 22)],
  ["ESPN Fantasy Games", "espnfantasy@espn.com", "ESPN Fantasy Basketball Draft Results", "Thank you for participating in our offline draft draft. Your draft results for My 2027 League are listed below.", d(10, 19)],
  ["MyDisney via ESPN", "memberservices@espn.com", "Your one-time passcode for ESPN", "", d(10, 18, 12)],
  ["Hackatime", "hackatime@hackclub.com", "Your Hackatime weekly summary (Oct 11 - Oct 18, 2026)", "Your coding recap Oct 11 - Oct 18, 2026 Hi elifeldman769, here is your weekly coding snapshot from Hackatime.", d(10, 18, 10), { html: HACKATIME_HTML.replace(/Oct 18 - Oct 25/g, "Oct 11 - Oct 18") }],
  ["Dave's Hot Chicken", "noreply@daveshotchicken.com", "Reset Password", "Hi eli, Someone has requested a link to change your password. You can do this through the link below. https://dashboard.punchh.com", d(10, 13)],
  ["Google Cloud", "cloud-noreply@google.com", "[Action Required] Mark AI agent OAuth clients as agentic for Google Workspace MCP by Nov 11, 2026", "A new agentic setting for OAuth clients is coming to Google Workspace.", d(10, 12, 18)],
  ["Chase", "no.reply.alerts@chase.com", "You're now sharing data with Fidelity Investments", "Connected Banking You agreed to share data with Fidelity Investments Fidelity Investments can now access your account data.", d(10, 12, 17)],
  ["OpenAlex", "noreply@openalex.org", "Your OpenAlex login link", "Hi Elijah Feldman, Click the link below to log in to OpenAlex: Or copy and paste this URL into your browser.", d(10, 12, 16)],
  ["Sleeper", "hello@sleeper.com", "🏆🏀 needs a few more people", "Your league, 🏀, needs a few more people. Finish filling your league and inviting some friends to 🏀, by sharing the link.", d(10, 12, 15)],
  ["Vercel", "notifications@vercel.com", "Preview deployment failed for workflow", "eli's projects · director at d2d14a2 · October 12, 2026 at 5:24 PM UTC       Preview deployment failed for workflow", d(10, 12, 14)],
  ["Vercel", "notifications@vercel.com", "424789 is your Vercel log in code", "Log in to Vercel Hi elifeldman769-4124, A login request was made from Alexandria, United States. 424789 This code expires soon.", d(10, 12, 13)],
  ["me", ME.address, "", "", d(10, 12, 12), { attachments: [{ filename: "Scanned Document.pdf", contentType: "application/pdf" }] }],
];

const PROMOS: Seed[] = [
  ["Hack Club Stardance", "stardance@hackclub.com", "(/ﾟ∀ﾟ)/ ✧ run it back? we've got five more days on us", "run it back? we've got five more days on us · ✦ · ° ✧ · ˚", d(10, 27), { unread: true }],
  ["Pinterest", "recommendations@discover.pinterest.com", "Zendaya Style Inspo", "zendaya Zendaya zendaya street style Zendaya Darnell's birthday party! Zendaya Coleman", d(11, 1, 8, 39), { unread: true }],
  ["Pinterest", "recommendations@discover.pinterest.com", "Zendaya Style Inspo", "Small Chested Women Aesthetic| Body Positivity Confidence| Flat Silhouette| Self Accept", d(10, 31), { unread: true }],
  ["Pinterest", "recommendations@discover.pinterest.com", "Obsessed", "Millie Bobby Brown zendaya and tom holland Zendaya zendaya Millie Bobby Brown Millie Bro", d(10, 30), { unread: true }],
  ["Quizlet", "team@quizlet.com", "Vadets Final Exam and top sets, just for you", "Don't lose your momentum", d(10, 29), { unread: true }],
  ["Aeroplan", "aeroplan@mail.aircanada.com", "Last chance this year: 15% more points on Marriott Bonvoy conversion", "Hurry, offer ends Oct. 31. 0 pts + A", d(10, 29), { unread: true }],
  ["Pinterest", "recommendations@discover.pinterest.com", "Zendaya Street Style Inspo", "Zendaya Coleman Street Style Zendaya Zendaya Street Style Zendaya Zendaya", d(10, 29), { unread: true }],
  ["Figma", "announcements@figma.com", "Explore more directions with Figma's agent", "Bring your references, compare concepts, and refine a flow with", d(10, 29), { unread: true }],
];

const UPDATES: Seed[] = [
  ["Amazon Business", "no-reply@amazon.com", "Business buying deserves business pricing", "Business-only pricing and quantity discounts a personal account can't offer.", d(10, 26), { unread: true }],
  ["Quora Digest", "digest@quora.com", "What do I do when academia sends me this'Your name is mentioned by a well known autho...?", "\"Academia.edu\" emails can be misleading.", d(10, 19), { unread: true }],
  ["ChatGPT", "noreply@email.openai.com", "4 new image styles to try", "Photo booth or y2K digicam? ChatGPT See your photos in a new way Pick an idea b", d(10, 14), { unread: true }],
];

const SPAM: Seed[] = [
  ["Kung Fu Tea", "news@kungfutea.com", "Don't Ghost These Halloween Deals!", "Last chance for Taro Tarot BOGO 50% OFF! Plus, come dressed in costume", d(10, 31), { unread: true }],
  ["Kung Fu Tea", "news@kungfutea.com", "Two Halloween Deals, One Spooky Weekend!", "Enjoy BOGO 50% OFF on Taro Tarot drinks through 10/31, plus", d(10, 30), { unread: true }],
  ["CollegeXpress", "info@collegexpress.com", "We are the University of Louisville", "Hi Elijah, University of Louisville is interested in you...so now they've asked", d(10, 29), { unread: true }],
  ["Kung Fu Tea", "news@kungfutea.com", "Double the Trouble, Double the Treats!", "Two spooky-good boba deals are coming! Taro Tarot BOGO 50% OFF", d(10, 27), { unread: true }],
  ["Kung Fu Tea", "news@kungfutea.com", "Here for a spooky good time, not a long time!", "Gone 11/1! Sip Tarot Taro & The Boba Oracles before they vani", d(10, 26), { unread: true }],
  ["Quizlet", "team@quizlet.com", "Your Quizlet ranking is in 👀", "See where you stand and how high you can climb.", d(10, 22), { unread: true }],
  ["Kung Fu Tea", "news@kungfutea.com", "Don't Let This Boba Date Waddle Away!", "Last chance to buy one Pudgy Penguins drink & get the second 50%", d(10, 9), { unread: true }],
  ["Kung Fu Tea", "news@kungfutea.com", "Your Boba Date Just Got Sweeter!", "Buy one Pudgy Penguins drink, get the second 50% off... Facebook Instagr", d(10, 7), { unread: true }],
  ["Quizlet", "team@quizlet.com", "Welcome to Camp Miasma", "Get 60 days of MUBI for free", d(10, 6), { unread: true }],
  ["Kung Fu Tea", "news@kungfutea.com", "Meet Polly's sweetest sip!", "Because every Pengu needs their Polly... Facebook Instagram TikTok X If you'd no lo", d(10, 4), { unread: true }],
  ["Kung Fu Tea", "news@kungfutea.com", "Meet Pengu's perfect boba date order!", "Because some things are just better together... Facebook Instagram T", d(10, 3), { unread: true }],
  ["Kung Fu Tea", "news@kungfutea.com", "Collect, Sip & Unbox Pudgy Penguins at KFT!", "Exclusive collectible card and Little Treats Blind Boxes have lan", d(10, 2), { unread: true }],
];

const SENT: Seed[] = [
  ["me", ME.address, "", "", d(10, 12, 11), { to: [{ name: "me", address: ME.address }], attachments: [{ filename: "Scanned Document.pdf", contentType: "application/pdf" }], folderLabel: "Inbox" }],
  ["me", ME.address, "", "", d(10, 12, 10), { to: [{ name: "me", address: ME.address }], attachments: [{ filename: "Scanned Document.pdf", contentType: "application/pdf" }, { filename: "Scanned Document 2.pdf", contentType: "application/pdf" }, { filename: "Scanned Document 3.pdf", contentType: "application/pdf" }], folderLabel: "Inbox" }],
  ["me", ME.address, "Improved SAT Prep UI", "Hi Kaplan, I built a SAT prep tool that currently pulls questions from the SAT question bank", d(8, 20, 12), { to: [{ name: "", address: "knarecruiting@kaplan.com" }], attachments: [{ filename: "Screenshot 2026-08-20.png", contentType: "image/png" }] }],
  ["me", ME.address, "Improved SAT Prep UI", "Hi Princeton Review, I built a SAT prep tool that currently pulls questions from the SAT question bank", d(8, 20, 11), { to: [{ name: "", address: "prep@review.com" }], attachments: [{ filename: "Screenshot 2026-08-20.png", contentType: "image/png" }] }],
];

let seq = 1000;
function mk(folder: string, s: Seed, extra: Partial<DemoMsg> = {}): DemoMsg {
  const [name, address, subject, text, date, more] = s;
  const uid = ++seq;
  return {
    id: `${Buffer.from(folder).toString("base64url")}.${uid}`,
    folder,
    uid,
    from: { name, address },
    to: [ME],
    subject,
    snippet: text.slice(0, 200),
    date,
    unread: false,
    starred: false,
    important: false,
    draft: false,
    attachments: [],
    text,
    ...extra,
    ...more,
  };
}

type State = { msgs: DemoMsg[]; labels: string[]; v: number };
const SEED_VERSION = 5;
const g = globalThis as unknown as { __demo?: State };

function state(): State {
  if (g.__demo && g.__demo.v === SEED_VERSION) return g.__demo;
  const msgs: DemoMsg[] = [];
  PRIMARY.forEach((s) => msgs.push(mk("INBOX", s, { category: "primary" })));
  for (let i = 0; i < 710; i++) {
    const day = new Date(2026, 9, 11);
    day.setDate(day.getDate() - Math.floor(i / 3));
    msgs.push(mk("INBOX", ["Hack Club", "team@hackclub.com", `Weekly update #${700 - i}`, "What's new with Hack Club this week: events, projects, and more from the community.", day.toISOString()], { category: "primary" }));
  }
  PROMOS.forEach((s) => msgs.push(mk("INBOX", s, { category: "promotions" })));
  for (let i = 0; i < 970; i++) {
    const day = new Date(2026, 9, 26);
    day.setDate(day.getDate() - Math.floor(i / 4));
    msgs.push(mk("INBOX", ["Pinterest", "recommendations@discover.pinterest.com", "Ideas you might love", "Discover new ideas inspired by your recent activity.", day.toISOString()], { category: "promotions", unread: i < 25 }));
  }
  UPDATES.forEach((s) => msgs.push(mk("INBOX", s, { category: "updates" })));
  SPAM.forEach((s) => msgs.push(mk("Junk", s)));
  SENT.forEach((s) => msgs.push(mk("Sent", s)));
  msgs.push(mk("Archive", ["Do Not Reply", "noreply@2k.com", "Confirm your 2K Sports Account", "Thank you for creating your 2K Sports Account. Please follow the link below to confirm", d(1, 9, 9, 0, 2025)], { starred: true, folderLabel: "Inbox" }));
  msgs.push(mk("Archive", ["CPK Rewards", "rewards@cpk.com", "FREE Birthday Dessert For You!", "Happy Birthday from CPK! CPK Logo Join CPK Rewards My Account Order Online", d(8, 1, 9, 0, 2024)], { starred: true, folderLabel: "Inbox" }));
  ["Security alert", "Prism is shutting down on January 1, 2027", "Codeforces Round 1131 (Div. 3)"].forEach((t, i) =>
    msgs.push(mk("Trash", ["Google", "no-reply@accounts.google.com", t, "", d(10, 30 - i)], { unread: true })),
  );
  msgs.push(
    mk("Trash", ["Attacker", "evil@example.com", "XSS test", "hostile html", d(10, 31, 7)], {
      html: `<script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">js link</a><a href="data:text/html,<script>alert(4)</script>">data link</a>
<iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name=p></form><svg onload=alert(5)><circle/></svg>
<meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"><object data="x.swf"></object>
<style>@import url(https://evil.example/x.css); body{background:url(https://tracker.example/bg.png)} .x{width:expression(alert(6))}</style>
<div style="background-image:url('https://tracker.example/s.png')">styled</div>
<img src="http://127.0.0.1:3000/api/me"><img src="http://169.254.169.254/latest/meta-data/"><img src="https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png">
<p onclick="alert(7)">click</p><a href="https://ok.example/">safe link</a><style></style><scr<script>ipt>alert(8)</script>`,
    }),
  );
  const conv: Seed[] = [
    ["Aarush Deshpande", "2027adeshpan@tjhsst.edu", "One student job stuck", "Is every node up/working? ---------- Forwarded message --------- From: Torbert, Shane M <SMTorbert@fcps.edu> Date: Fri, Oct 23, 2026 at 11:04 AM Subject: One student job stuck in the queue", d(10, 23, 13, 0)],
    ["Eli Feldman", ME.address, "Re: One student job stuck", "pretty sure this was just hpc12 but should be fine now", d(10, 23, 18, 23)],
    ["Aarush Deshpande", "2027adeshpan@tjhsst.edu", "Re: One student job stuck", "Hi Dr. Torbert, It looks like this was caused by hpc12 being down for a bit, but not being marked as down (so it was waiting for a down node to come up before starting)", d(10, 23, 19, 11)],
    ["Torbert, Shane M", "SMTorbert@fcps.edu", "Re: One student job stuck", "good thanks\n\n==================================================\nShane Torbert, PhD  Computer Systems Lab\nThomas Jefferson HS for Science and Technology\n6560 Braddock Road, Alexandria, VA  22312\n\nTEL 703.750.8300  FAX 703.750.5010\nWEB http://user.tjhsst.edu/smtorbert\n==================================================", d(10, 26, 8, 38)],
  ];
  conv.forEach((c) => msgs.push(mk("INBOX", c, { conv: "hpc", category: "primary", to: [{ name: "Aarush Deshpande", address: "2027adeshpan@tjhsst.edu" }, { name: "Lead", address: "lead@tjhsst.edu" }, { name: "", address: "cluster@tjhsst.edu" }] })));
  g.__demo = { msgs, labels: [], v: SEED_VERSION };
  return g.__demo;
}

const ROLE_PATH: Record<string, string> = { inbox: "INBOX", sent: "Sent", drafts: "Drafts", spam: "Junk", trash: "Trash", archive: "Archive", snoozed: "Snoozed" };

function strip(m: DemoMsg): MessageSummary {
  const { html: _h, text: _t, cc: _c, conv: _v, ...rest } = m;
  void _v;
  void _h;
  void _t;
  void _c;
  return rest;
}

export class DemoBackend implements Backend {
  async identities(): Promise<Identity[]> {
    return [ME];
  }
  async folders(): Promise<Folder[]> {
    const s = state();
    const count = (p: string) => s.msgs.filter((m) => m.folder === p);
    const roles: [string, Folder["role"], string][] = [
      ["INBOX", "inbox", "Inbox"],
      ["Sent", "sent", "Sent"],
      ["Drafts", "drafts", "Drafts"],
      ["Junk", "spam", "Spam"],
      ["Trash", "trash", "Trash"],
      ["Archive", "archive", "Archive"],
      ["Snoozed", "snoozed", "Snoozed"],
    ];
    const out: Folder[] = roles.map(([path, role, name]) => ({ path, role, name, total: count(path).length, unread: count(path).filter((m) => m.unread).length, delimiter: "/" }));
    for (const l of s.labels) out.push({ path: l, role: "label", name: l, total: count(l).length, unread: count(l).filter((m) => m.unread).length, delimiter: "/" });
    out[0].unread = s.msgs.filter((m) => m.folder === "INBOX" && m.unread && (m.category ?? "primary") === "primary").length;
    return out;
  }
  async list(a: ListArgs): Promise<ListResult> {
    const s = state();
    const p = getPrefs("demo");
    const pageSize = p.pageSize;
    const offset = (a.page - 1) * pageSize;
    let rows = s.msgs;
    let tabs: ListResult["tabs"];
    const q = (a.q || "").toLowerCase();
    if (a.view === "inbox" && !q) {
      const enabled: Category[] = ["primary", ...(["promotions", "social", "updates", "forums"] as Category[]).filter((c) => p.categories[c as "promotions"])];
      const eff = (m: DemoMsg): Category => (m.starred && p.starredInPrimary ? "primary" : enabled.includes(m.category ?? "primary") ? (m.category ?? "primary") : "primary");
      const inbox = s.msgs.filter((m) => m.folder === "INBOX");
      tabs = enabled.map((key) => {
        const unread = inbox.filter((m) => m.unread && eff(m) === key).sort((x, y) => +new Date(y.date) - +new Date(x.date));
        return { key, newCount: unread.length, preview: unread[0] ? `${unread[0].from.name} — ${unread[0].subject}` : "" };
      });
      rows = inbox.filter((m) => eff(m) === (a.category ?? "primary"));
    } else {
      const view = a.view;
      if (view === "starred") rows = s.msgs.filter((m) => m.starred && m.folder !== "Trash" && m.folder !== "Junk");
      else if (view === "important") rows = s.msgs.filter((m) => m.important);
      else if (view === "all") rows = s.msgs.filter((m) => m.folder !== "Trash" && m.folder !== "Junk");
      else if (view === "purchases") rows = [];
      else if (view.startsWith("label:")) rows = s.msgs.filter((m) => m.folder === view.slice(6));
      else if (ROLE_PATH[view]) rows = s.msgs.filter((m) => m.folder === ROLE_PATH[view]);
      else if (view === "search") rows = s.msgs.filter((m) => m.folder !== "Trash" && m.folder !== "Junk");
      if (q) {
        const terms = q.split(/\s+/).filter((t) => !/^(in|is|label):/.test(t));
        if (q.includes("is:unread")) rows = rows.filter((m) => m.unread);
        if (q.includes("is:starred")) rows = rows.filter((m) => m.starred);
        const inm = /in:(\w+)/.exec(q);
        if (inm && ROLE_PATH[inm[1]]) rows = s.msgs.filter((m) => m.folder === ROLE_PATH[inm[1]]);
        for (const t of terms) {
          const [k, v] = t.includes(":") ? t.split(":", 2) : ["", t];
          rows = rows.filter((m) => {
            if (k === "from") return (m.from.name + m.from.address).toLowerCase().includes(v);
            if (k === "to") return m.to.some((x) => (x.name + x.address).toLowerCase().includes(v));
            if (k === "subject") return m.subject.toLowerCase().includes(v);
            if (k) return true;
            return (m.subject + m.snippet + m.from.name + m.from.address).toLowerCase().includes(v);
          });
        }
      }
    }
    rows = [...rows].sort((x, y) => +new Date(y.date) - +new Date(x.date));
    return { messages: rows.slice(offset, offset + pageSize).map(strip), total: rows.length, offset, pageSize, tabs };
  }
  private find(id: string) {
    const m = state().msgs.find((x) => x.id === id);
    if (!m) throw new NotFound("Message not found");
    return m;
  }
  async message(id: string): Promise<MessageDetail> {
    const m = this.find(id);
    m.unread = false;
    return {
      ...strip(m),
      cc: m.cc ? parseAddresses(m.cc) : [],
      bcc: [],
      replyTo: [],
      messageId: `<${m.uid}@demo>`,
      inReplyTo: "",
      references: [],
      listUnsubscribe: m.html ? "https://hackatime.hackclub.com/unsubscribe" : null,
      text: m.text,
      hasHtml: !!m.html,
      hasRemoteImages: !!m.html && /src="https?:/.test(m.html),
      bodyAttachments: m.attachments.map((a, i) => ({ part: String(i), filename: a.filename, contentType: a.contentType, size: 182_000 + i * 1000 })),
      thread: m.conv ? state().msgs.filter((x) => x.conv === m.conv && x.id !== m.id).map(strip) : [],
    };
  }
  async body(id: string, allowRemote: boolean) {
    const m = this.find(id);
    if (m.html) {
      const r = sanitizeEmailHtml(m.html, { cidMap: new Map(), allowRemote });
      return { html: r.html, blocked: r.blockedImages };
    }
    return { html: textToHtml(m.text || ""), blocked: 0 };
  }
  async attachment(id: string, part: string) {
    const m = this.find(id);
    const a = m.attachments[Number(part)];
    if (!a) throw new NotFound("Attachment not found");
    return { filename: a.filename, contentType: "text/plain", content: Buffer.from("Demo attachment " + a.filename) };
  }
  async act(ids: string[], action: Action, target?: string) {
    const s = state();
    const moved: Record<string, string> = {};
    for (const id of ids) {
      const m = s.msgs.find((x) => x.id === id);
      if (!m) continue;
      const moveTo = (f: string) => {
        m.folder = f;
        const nid = `${Buffer.from(f).toString("base64url")}.${m.uid}`;
        moved[m.id] = nid;
        m.id = nid;
      };
      switch (action) {
        case "read": m.unread = false; break;
        case "unread": m.unread = true; break;
        case "star": m.starred = true; break;
        case "unstar": m.starred = false; break;
        case "important": m.important = true; break;
        case "notimportant": m.important = false; break;
        case "archive": moveTo("Archive"); break;
        case "trash": if (m.folder === "Trash") s.msgs.splice(s.msgs.indexOf(m), 1); else moveTo("Trash"); break;
        case "delete": s.msgs.splice(s.msgs.indexOf(m), 1); break;
        case "spam": moveTo("Junk"); break;
        case "notspam": case "inbox": moveTo("INBOX"); break;
        case "move": if (target) moveTo(target); break;
        case "copy": if (target) s.msgs.push({ ...m, folder: target, uid: ++seq, id: `${Buffer.from(target).toString("base64url")}.${seq}` }); break;
      }
    }
    return { moved };
  }
  async snooze(ids: string[]) {
    await this.act(ids, "move", "Snoozed");
  }
  async markAllRead(view: string) {
    const path = ROLE_PATH[view] ?? (view.startsWith("label:") ? view.slice(6) : "INBOX");
    state().msgs.forEach((m) => {
      if (m.folder === path) m.unread = false;
    });
  }
  async empty(role: "trash" | "spam") {
    const s = state();
    s.msgs = s.msgs.filter((m) => m.folder !== ROLE_PATH[role]);
  }
  async createFolder(name: string) {
    const s = state();
    if (!name.trim()) throw new BadRequest("Invalid label name");
    if (!s.labels.includes(name)) s.labels.push(name.trim());
    return name.trim();
  }
  async renameFolder(path: string, name: string) {
    const s = state();
    s.labels = s.labels.map((l) => (l === path ? name : l));
    s.msgs.forEach((m) => {
      if (m.folder === path) m.folder = name;
    });
    return name;
  }
  async deleteFolder(path: string) {
    const s = state();
    s.labels = s.labels.filter((l) => l !== path);
  }
  async saveDraft(dr: Draft, replaceId?: string) {
    const s = state();
    if (replaceId) s.msgs = s.msgs.filter((m) => m.id !== replaceId);
    const m = mk("Drafts", ["me", ME.address, dr.subject, dr.html.replace(/<[^>]+>/g, " ").trim(), new Date().toISOString()], { draft: true, to: dr.to ? [{ name: "", address: dr.to }] : [] });
    s.msgs.push(m);
    return m.id;
  }
  async send(dr: Draft, opts: { draftId?: string }) {
    parseAddresses(dr.to);
    const s = state();
    if (opts.draftId) s.msgs = s.msgs.filter((m) => m.id !== opts.draftId);
    s.msgs.push(mk("Sent", ["me", ME.address, dr.subject, dr.html.replace(/<[^>]+>/g, " ").trim(), new Date().toISOString()], { to: parseAddresses(dr.to) }));
    return "demo-" + Date.now();
  }
  async raw(id: string) {
    const m = this.find(id);
    return Buffer.from(`From: ${m.from.name} <${m.from.address}>\r\nTo: ${ME.address}\r\nSubject: ${m.subject}\r\nDate: ${new Date(m.date).toUTCString()}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${m.text}\r\n`);
  }
  async quota() {
    return { used: Math.round(15 * 1024 ** 3 * 0.89), limit: 15 * 1024 ** 3 };
  }
}
