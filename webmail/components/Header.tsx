"use client";
import { useEffect, useRef, useState } from "react";
import { useApp, routeQuery } from "./App";
import { Icon, TJLogo } from "./icons";
import { Anchor, anchorOf, Popover, MenuItem, MenuSep } from "./ui";
import { api } from "@/lib/client/api";
import { bytes } from "@/lib/client/format";

export function Avatar({ name, size = 32, picture }: { name: string; size?: number; picture?: string | null }) {
  const [broken, setBroken] = useState(false);
  const letter = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.5 }}>
      {picture && !broken ? (
        <img src={picture} alt="" onError={() => setBroken(true)} />
      ) : (
        letter
      )}
    </span>
  );
}

export function Header() {
  const { route, go, prefs, savePrefs, me, narrow, drawer, setDrawer } = useApp();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const [adv, setAdv] = useState(false);
  const [menu, setMenu] = useState<null | { kind: "apps" | "account" | "help"; a: Anchor }>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQ(routeQuery(route));
  }, [route]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const submit = (text: string) => {
    const t = text.trim();
    setAdv(false);
    inputRef.current?.blur();
    if (!t) return go({ view: "inbox" });
    go({ view: "search", q: t, page: 1, msg: undefined });
  };

  return (
    <header className="hdr">
      <div className="hdr-left">
        <button className="icon-btn lg menu-btn" data-tip="Main menu" aria-label="Main menu" onClick={() => (narrow ? setDrawer(!drawer) : savePrefs({ sidebarCollapsed: !prefs.sidebarCollapsed }))}>
          <Icon name="menu" size={24} />
        </button>
        <a className="logo" href="#inbox" aria-label="TJ Mail" data-tip="TJ Mail">
          <TJLogo size={36} />
          <span className="logo-text">TJ Mail</span>
        </a>
      </div>
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <div className={`search-box${adv ? " open" : focus ? " focus" : ""}`}>
          <button type="submit" className="icon-btn" data-tip="Search" aria-label="Search mail">
            <Icon name="search" size={24} />
          </button>
          <input ref={inputRef} placeholder="Search mail" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} aria-label="Search mail" />
          {q && (
            <button
              type="button"
              className="icon-btn"
              data-tip="Clear search"
              aria-label="Clear search"
              onClick={() => {
                setQ("");
                if (route.view === "search" || routeQuery(route)) go({ view: "inbox" });
              }}
            >
              <Icon name="close" size={24} />
            </button>
          )}
          <button type="button" className="icon-btn" data-tip="Show search options" aria-label="Advanced search options" onClick={() => setAdv((v) => !v)}>
            <Icon name="tune" size={24} />
          </button>
        </div>
        {adv && <AdvancedSearch initial={q} onSearch={submit} onClose={() => setAdv(false)} />}
      </form>
      <div className="hdr-right">
        <button className={`icon-btn${menu?.kind === "help" ? " active" : ""}`} data-tip="Support" aria-label="Support" onClick={(e) => setMenu({ kind: "help", a: anchorOf(e, "right") })}>
          <Icon name="help" size={24} />
        </button>
        <button className={`icon-btn${route.view === "settings" ? " active" : ""}`} data-tip="Settings" aria-label="Settings" onClick={() => go({ view: "settings", settings: "general" })}>
          <Icon name="settings" size={24} />
        </button>
        <a className="pill-btn" href="https://ion.tjhsst.edu" target="_blank" rel="noopener noreferrer">
          Ion
        </a>
        <button className={`icon-btn${menu?.kind === "apps" ? " active" : ""}`} data-tip="TJHSST apps" aria-label="TJHSST apps" onClick={(e) => setMenu({ kind: "apps", a: anchorOf(e, "right") })}>
          <Icon name="apps" size={24} />
        </button>
        <button className={`avatar-btn${menu?.kind === "account" ? " active" : ""}`} data-tip={`TJ Account\n${me.displayName}`} aria-label="Account" onClick={(e) => setMenu({ kind: "account", a: anchorOf(e, "right") })}>
          <Avatar name={me.displayName} picture={me.picture} />
        </button>
      </div>
      {menu?.kind === "help" && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)}>
          <MenuItem icon="help" onClick={() => window.open("https://guides.tjhsst.edu", "_blank", "noopener")}>
            Help
          </MenuItem>
          <MenuItem icon="keyboard" onClick={() => { setMenu(null); window.dispatchEvent(new CustomEvent("webmail:shortcuts")); }}>
            Keyboard shortcuts
          </MenuItem>
          <MenuSep />
          <MenuItem icon="external" onClick={() => window.open("https://status.tjhsst.edu", "_blank", "noopener")}>
            Service status
          </MenuItem>
          <MenuItem icon="send" onClick={() => window.open("mailto:sysadmins@tjhsst.edu", "_blank")}>
            Contact the sysadmins
          </MenuItem>
        </Popover>
      )}
      {menu?.kind === "apps" && <AppsMenu anchor={menu.a} onClose={() => setMenu(null)} />}
      {menu?.kind === "account" && <AccountMenu anchor={menu.a} onClose={() => setMenu(null)} />}
    </header>
  );
}

const APPS: { name: string; url: string; img?: string; color?: string; letter?: string }[] = [
  { name: "Ion", url: "https://ion.tjhsst.edu", img: "/tjlogo.png" },
  { name: "Director", url: "https://director.tjhsst.edu", color: "#1a73e8", letter: "D" },
  { name: "Mail", url: "#inbox", img: "/tjlogo.png" },
  { name: "Tin", url: "https://tin.tjhsst.edu", img: "/apps/tin.svg" },
  { name: "Status", url: "https://status.tjhsst.edu", img: "/apps/status.png" },
  { name: "Guides", url: "https://guides.tjhsst.edu", color: "#188038", letter: "G" },
  { name: "Password", url: "https://password.tjhsst.edu", color: "#e37400", letter: "P" },
  { name: "2FA", url: "https://2fa.tjhsst.edu", color: "#9334e6", letter: "2" },
  { name: "Forwarding", url: "https://mailforwarding.tjhsst.edu", img: "/apps/mailforwarding.png" },
];
const MORE_APPS: typeof APPS = [
  { name: "TJHSST", url: "https://www.tjhsst.edu", color: "#0048ab", letter: "TJ" },
  { name: "Sysadmins", url: "https://sysadmins.tjhsst.edu", color: "#5f6368", letter: "S" },
  { name: "Classic mail", url: "https://roundcube.tjhsst.edu", color: "#37beff", letter: "R" },
];

function AppTile({ a }: { a: (typeof APPS)[number] }) {
  const internal = a.url.startsWith("#");
  return (
    <a className="app-tile" href={a.url} target={internal ? undefined : "_blank"} rel="noopener noreferrer">
      <span className="app-ic" style={{ background: a.img ? "transparent" : a.color }}>
        {a.img ? <img src={a.img} width={40} height={40} alt="" /> : a.letter}
      </span>
      {a.name}
    </a>
  );
}

function AppsMenu({ anchor, onClose }: { anchor: Anchor; onClose: () => void }) {
  return (
    <Popover anchor={anchor} onClose={onClose} className="card-pop apps-pop" offsetY={8}>
      <div className="apps-fav">
        <div className="apps-hdr">
          <span>TJHSST apps</span>
        </div>
        <div className="apps-grid">
          {APPS.map((a) => (
            <AppTile key={a.name} a={a} />
          ))}
        </div>
      </div>
      <div className="apps-grid" style={{ marginTop: 8 }}>
        {MORE_APPS.map((a) => (
          <AppTile key={a.name} a={a} />
        ))}
      </div>
    </Popover>
  );
}

function AccountMenu({ anchor, onClose }: { anchor: Anchor; onClose: () => void }) {
  const { me } = useApp();
  const used = me.quota ? me.quota.used / me.quota.limit : 0;
  const signOut = async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } finally {
      window.location.href = "/";
    }
  };
  return (
    <Popover anchor={anchor} onClose={onClose} className="card-pop acct" offsetY={8}>
      <div className="acct-top">
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={22} />
        </button>
      </div>
      <div className="acct-card">
        <div className="acct-row">
          <Avatar name={me.displayName} picture={me.picture} size={56} />
          <div style={{ minWidth: 0 }}>
            <div className="acct-name">{me.displayName}</div>
            <div className="acct-mail">{me.email}</div>
          </div>
        </div>
      </div>
      <a className="acct-btn" href="https://ion.tjhsst.edu/profile" target="_blank" rel="noopener noreferrer">
        <TJLogo size={18} />
        Manage your Ion account
      </a>
      <button className="acct-btn" onClick={signOut}>
        <Icon name="logout" size={18} />
        Sign out
      </button>
      {me.quota && (
        <div className="acct-btn" style={{ cursor: "default" }}>
          <span style={{ width: 18, height: 18, borderRadius: 9, background: used > 0.85 ? "#e37400" : "#0b57d0", color: "#fff", fontSize: 12, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>!</span>
          <span style={{ flex: 1 }}>
            {Math.round(used * 100)}% of {bytes(me.quota.limit)} used
          </span>
        </div>
      )}
      <div className="acct-foot">
        <a href="https://www.tjhsst.edu" target="_blank" rel="noopener noreferrer">
          TJHSST
        </a>
        •
        <a href="https://guides.tjhsst.edu" target="_blank" rel="noopener noreferrer">
          Help
        </a>
      </div>
    </Popover>
  );
}

function AdvancedSearch({ initial, onSearch, onClose }: { initial: string; onSearch: (q: string) => void; onClose: () => void }) {
  const { act: _act, go } = useApp();
  void _act;
  const [f, setF] = useState({ from: "", to: "", subject: "", has: "", not: "", sizeOp: "larger", size: "", unit: "MB", within: "1d", date: "", scope: "all", attach: false, noChats: false });
  useEffect(() => {
    const m = (k: string) => new RegExp(`${k}:("[^"]*"|\\S+)`).exec(initial)?.[1]?.replace(/"/g, "") ?? "";
    setF((x) => ({ ...x, from: m("from"), to: m("to"), subject: m("subject"), attach: /has:attachment/.test(initial) }));
  }, [initial]);
  const build = () => {
    const parts: string[] = [];
    const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
    if (f.from) parts.push(`from:${quote(f.from)}`);
    if (f.to) parts.push(`to:${quote(f.to)}`);
    if (f.subject) parts.push(`subject:${quote(f.subject)}`);
    if (f.has) parts.push(f.has);
    if (f.not) parts.push(...f.not.split(/\s+/).filter(Boolean).map((w) => `-${w}`));
    if (f.size) parts.push(`${f.sizeOp === "larger" ? "larger" : "smaller"}:${f.size}${f.unit === "MB" ? "M" : f.unit === "KB" ? "K" : ""}`);
    if (f.date) {
      const d = new Date(f.date);
      if (!isNaN(d.getTime())) {
        const days = { "1d": 1, "3d": 3, "1w": 7, "2w": 14, "1m": 30, "2m": 60, "6m": 182, "1y": 365 }[f.within] ?? 1;
        const a = new Date(d.getTime() - days * 86400_000);
        const b = new Date(d.getTime() + days * 86400_000);
        const fmt = (x: Date) => `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`;
        parts.push(`after:${fmt(a)}`, `before:${fmt(b)}`);
      }
    }
    if (f.attach) parts.push("has:attachment");
    if (f.scope !== "all") parts.push(f.scope);
    return parts.join(" ");
  };
  const valid = !!build();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  return (
    <>
      <div className="backdrop" style={{ zIndex: 49 }} onMouseDown={onClose} />
      <div className="adv" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), valid && onSearch(build()))}>
        <div className="arow">
          <label>From</label>
          <input type="text" value={f.from} onChange={set("from")} autoFocus />
        </div>
        <div className="arow">
          <label>To</label>
          <input type="text" value={f.to} onChange={set("to")} />
        </div>
        <div className="arow">
          <label>Subject</label>
          <input type="text" value={f.subject} onChange={set("subject")} />
        </div>
        <div className="arow">
          <label>Has the words</label>
          <input type="text" value={f.has} onChange={set("has")} />
        </div>
        <div className="arow">
          <label>Doesn&apos;t have</label>
          <input type="text" value={f.not} onChange={set("not")} />
        </div>
        <div className="arow">
          <label>Size</label>
          <select value={f.sizeOp} onChange={set("sizeOp")} style={{ width: 280 }}>
            <option value="larger">greater than</option>
            <option value="smaller">less than</option>
          </select>
          <input type="text" value={f.size} onChange={set("size")} style={{ flex: "0 0 140px", marginLeft: 24 }} inputMode="numeric" />
          <select value={f.unit} onChange={set("unit")} style={{ width: 120, marginLeft: 24 }}>
            <option>MB</option>
            <option>KB</option>
            <option>Bytes</option>
          </select>
        </div>
        <div className="arow">
          <label>Date within</label>
          <select value={f.within} onChange={set("within")} style={{ width: 280 }}>
            <option value="1d">1 day</option>
            <option value="3d">3 days</option>
            <option value="1w">1 week</option>
            <option value="2w">2 weeks</option>
            <option value="1m">1 month</option>
            <option value="2m">2 months</option>
            <option value="6m">6 months</option>
            <option value="1y">1 year</option>
          </select>
          <input type="text" placeholder="" value={f.date} onChange={set("date")} style={{ marginLeft: 24 }} onFocus={(e) => (e.target.type = "date")} />
        </div>
        <div className="arow">
          <label>Search</label>
          <select value={f.scope} onChange={set("scope")} style={{ flex: 1 }}>
            <option value="all">All Mail</option>
            <option value="in:inbox">Inbox</option>
            <option value="is:starred">Starred</option>
            <option value="in:sent">Sent Mail</option>
            <option value="in:draft">Drafts</option>
            <option value="in:spam">Spam</option>
            <option value="in:trash">Trash</option>
            <option value="in:anywhere">Mail &amp; Spam &amp; Trash</option>
            <option value="is:unread">Unread Mail</option>
            <option value="is:read">Read Mail</option>
          </select>
        </div>
        <div className="checks">
          <label>
            <input type="checkbox" checked={f.attach} onChange={set("attach")} /> Has attachment
          </label>
          <label>
            <input type="checkbox" checked={f.noChats} onChange={set("noChats")} /> Don&apos;t include chats
          </label>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn text"
            disabled={!valid}
            onClick={() => {
              onClose();
              go({ view: "settings", settings: "filters" });
              sessionStorage.setItem("webmail:newFilter", JSON.stringify({ from: f.from, to: f.to, subject: f.subject, has: f.has }));
            }}
          >
            Create filter
          </button>
          <button type="button" className="btn primary" disabled={!valid} onClick={() => onSearch(build())}>
            Search
          </button>
        </div>
      </div>
    </>
  );
}
