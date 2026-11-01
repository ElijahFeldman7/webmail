"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, routeQuery, Route } from "./App";
import { Icon, IconName } from "./icons";
import { Anchor, anchorOf, MenuItem, MenuSep, Popover, Dialog } from "./ui";
import { listDate, displayName, bytes } from "@/lib/client/format";
import type { Category, MessageSummary, Folder } from "@/lib/types";
import { api } from "@/lib/client/api";
import { DRAG_MIME } from "./Sidebar";

const TAB_META: Record<Category, { label: string; icon: IconName; activeIcon: IconName }> = {
  primary: { label: "Primary", icon: "inbox", activeIcon: "inboxFilled" },
  promotions: { label: "Promotions", icon: "tag", activeIcon: "tagFilled" },
  social: { label: "Social", icon: "people", activeIcon: "people" },
  updates: { label: "Updates", icon: "info", activeIcon: "infoFilled" },
  forums: { label: "Forums", icon: "forum", activeIcon: "forum" },
};

export function snoozeTimes() {
  const now = new Date();
  const at = (d: Date, h: number) => {
    const x = new Date(d);
    x.setHours(h, 0, 0, 0);
    return x;
  };
  const later = now.getHours() < 18 ? at(now, 18) : new Date(now.getTime() + 3 * 3600_000);
  const tomorrow = at(new Date(now.getTime() + 86400_000), 8);
  const sat = new Date(now);
  sat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
  const mon = new Date(now);
  mon.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const fmt = (d: Date, withDay = true) => `${withDay ? d.toLocaleDateString([], { weekday: "short" }) + ", " : ""}${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return [
    { label: "Later today", time: later, desc: fmt(later, false) },
    { label: "Tomorrow", time: tomorrow, desc: fmt(tomorrow) },
    { label: "This weekend", time: at(sat, 8), desc: fmt(at(sat, 8)) },
    { label: "Next week", time: at(mon, 8), desc: fmt(at(mon, 8)) },
  ];
}

export function SnoozeMenu({ anchor, onClose, onPick }: { anchor: Anchor; onClose: () => void; onPick: (t: number) => void }) {
  const [custom, setCustom] = useState(false);
  const [val, setVal] = useState(() => {
    const d = new Date(Date.now() + 86400_000);
    d.setHours(8, 0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  if (custom)
    return (
      <Dialog
        title="Pick date & time"
        onClose={onClose}
        actions={
          <>
            <button className="btn text" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn text"
              onClick={() => {
                const t = new Date(val).getTime();
                if (t > Date.now()) onPick(t);
                onClose();
              }}
            >
              Save
            </button>
          </>
        }
      >
        <input className="field" type="datetime-local" value={val} onChange={(e) => setVal(e.target.value)} />
      </Dialog>
    );
  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div style={{ padding: "8px 16px 10px", fontSize: 14, fontWeight: 500, fontFamily: "var(--font-ui)" }}>Snooze until…</div>
      {snoozeTimes().map((s) => (
        <MenuItem
          key={s.label}
          onClick={() => {
            onPick(s.time.getTime());
            onClose();
          }}
          right={<span style={{ color: "var(--text3)", marginLeft: 32, fontSize: 13 }}>{s.desc}</span>}
        >
          {s.label}
        </MenuItem>
      ))}
      <MenuSep />
      <MenuItem icon="clock" onClick={() => setCustom(true)}>
        Pick date &amp; time
      </MenuItem>
    </Popover>
  );
}

export function FolderPicker({ anchor, onClose, onPick, title, folders, exclude }: { anchor: Anchor; onClose: () => void; onPick: (f: Folder) => void; title: string; folders: Folder[]; exclude?: string }) {
  const [filter, setFilter] = useState("");
  const order: Record<string, number> = { inbox: 0, label: 1, archive: 1, snoozed: 2, spam: 3, trash: 4 };
  const items = folders
    .filter((f) => f.role !== "drafts" && f.role !== "sent" && f.path !== exclude)
    .filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.path.localeCompare(b.path));
  return (
    <Popover anchor={anchor} onClose={onClose} style={{ minWidth: 220 }}>
      <div style={{ padding: "4px 16px 8px", fontSize: 14, fontFamily: "var(--font-ui)" }}>{title}</div>
      <div style={{ padding: "0 16px 8px" }}>
        <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "100%", border: "none", borderBottom: "1px solid #dadce0", outline: "none", fontSize: 14, padding: "4px 0" }} />
      </div>
      {items.map((f) => (
        <MenuItem
          key={f.path}
          onClick={() => {
            onPick(f);
            onClose();
          }}
        >
          {f.role === "spam" ? "Spam" : f.role === "trash" ? "Trash" : f.name}
        </MenuItem>
      ))}
    </Popover>
  );
}

export function MailList() {
  const app = useApp();
  const { route, go, list, listLoading, reloadList, selected, setSelected, act, folders, prefs, compose, myAddresses, snack, me } = app;
  const [menu, setMenu] = useState<null | { kind: "select" | "more" | "move" | "label" | "snooze" | "input" | "chip"; a: Anchor; ids?: string[]; chip?: string }>(null);
  const [inputTool, setInputTool] = useState("English");
  const lastClicked = useRef<number | null>(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
    setFocusIdx(-1);
  }, [route.view, route.category, route.page, route.q, route.label]);

  const msgs = useMemo(() => list?.messages ?? [], [list]);
  const ids = msgs.map((m) => m.id);
  const selIds = ids.filter((i) => selected.has(i));
  const allSel = selIds.length > 0 && selIds.length === ids.length;
  const someSel = selIds.length > 0;
  const selMsgs = msgs.filter((m) => selected.has(m.id));

  const toggle = (id: string, idx: number, shift: boolean) => {
    const next = new Set(selected);
    if (shift && lastClicked.current !== null) {
      const [a, b] = [Math.min(lastClicked.current, idx), Math.max(lastClicked.current, idx)];
      const on = !selected.has(id);
      for (let i = a; i <= b; i++) on ? next.add(ids[i]) : next.delete(ids[i]);
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    lastClicked.current = idx;
    setSelected(next);
  };

  const selectBy = (fn: (m: MessageSummary) => boolean) => setSelected(new Set(msgs.filter(fn).map((m) => m.id)));

  const openMsg = useCallback(
    (m: MessageSummary) => {
      if (m.draft || route.view === "drafts") {
        compose({ draftId: m.id });
        return;
      }
      go({ msg: m.id });
    },
    [route.view, compose, go],
  );

  const isSpam = route.view === "spam";
  const isTrash = route.view === "trash";
  const isSnoozed = route.view === "snoozed";

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      const cur = msgs[focusIdx];
      const targets = selIds.length ? selIds : cur ? [cur.id] : [];
      switch (e.key) {
        case "j":
          setFocusIdx((i) => Math.min(msgs.length - 1, i + 1));
          break;
        case "k":
          setFocusIdx((i) => Math.max(0, i - 1));
          break;
        case "o":
        case "Enter":
          if (cur) openMsg(cur);
          break;
        case "x":
          if (cur) toggle(cur.id, focusIdx, false);
          break;
        case "s":
          if (cur) act([cur.id], cur.starred ? "unstar" : "star", { silent: true });
          break;
        case "e":
          if (targets.length && !isSpam && !isTrash) act(targets, "archive");
          break;
        case "#":
          if (targets.length) act(targets, isTrash ? "delete" : "trash");
          break;
        case "!":
          if (targets.length) act(targets, isSpam ? "notspam" : "spam");
          break;
        case "c":
          e.preventDefault();
          compose();
          break;
        case "I":
          if (targets.length) act(targets, "read", { silent: true });
          break;
        case "U":
          if (targets.length) act(targets, "unread", { silent: true });
          break;
        case "*":
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const total = list?.total ?? 0;
  const start = list && total ? list.offset + 1 : 0;
  const end = list ? list.offset + msgs.length : 0;
  const pages = list ? Math.ceil(total / list.pageSize) : 1;

  const tabs = route.view === "inbox" && !route.q ? list?.tabs : undefined;
  const category = route.category ?? "primary";

  const chipSet: Record<string, string[]> = {
    starred: ["From", "Any time", "Has attachment", "To", "Advanced search"],
    sent: ["Any time", "Has attachment", "To", "Advanced search"],
    spam: ["From", "Any time", "Has attachment", "To", "Is unread", "Advanced search"],
    trash: ["From", "Any time", "Has attachment", "To", "Is unread", "Advanced search"],
    search: ["From", "Any time", "Has attachment", "To", "Is unread", "Advanced search"],
    label: ["From", "Any time", "Has attachment", "To", "Is unread", "Advanced search"],
    all: ["From", "Any time", "Has attachment", "To", "Is unread", "Advanced search"],
    imp: ["From", "Any time", "Has attachment", "To", "Is unread", "Advanced search"],
    snoozed: ["From", "Any time", "Has attachment", "To", "Advanced search"],
    purchases: ["From", "Any time", "Has attachment", "To", "Is unread", "Advanced search"],
  };
  const showChips = !!chipSet[route.view] && !(route.view === "drafts");
  const baseQ = routeQuery(route);
  const applyQ = (add: string, removeRe?: RegExp) => {
    let q = baseQ;
    if (removeRe) q = q.replace(removeRe, "").trim();
    q = `${q} ${add}`.trim();
    go({ view: "search", q, page: 1 });
  };

  if (route.view === "scheduled") return <ScheduledList />;

  const sel = (
    <div className="select-btn" data-tip="Select">
      <button className="cb" aria-label="Select all" onClick={() => setSelected(someSel ? new Set() : new Set(ids))}>
        <Icon name={allSel ? "checked" : someSel ? "indeterminate" : "checkBlank"} size={20} />
      </button>
      <button className="dd" aria-label="Select options" onClick={(e) => setMenu({ kind: "select", a: anchorOf(e) })}>
        <Icon name="dropDown" size={18} />
      </button>
    </div>
  );

  return (
    <>
      <div className="scroll" ref={scrollRef}>
      {showChips && (
        <div className="chips" style={{ paddingTop: 0 }}>
          {chipSet[route.view].map((c) => {
            const on = (c === "Has attachment" && /has:attachment/.test(baseQ)) || (c === "Is unread" && /is:unread/.test(baseQ));
            if (c === "Advanced search")
              return (
                <button key={c} className="link-btn" style={{ marginLeft: 6 }} onClick={() => document.querySelector<HTMLButtonElement>('[aria-label="Advanced search options"]')?.click()}>
                  Advanced search
                </button>
              );
            const dropdown = ["From", "Any time", "To"].includes(c);
            return (
              <button
                key={c}
                className={`fchip${dropdown ? "" : " plain"}${on ? " on" : ""}`}
                onClick={(e) => {
                  if (c === "Has attachment") return on ? applyQ("", /\s*has:attachment/) : applyQ("has:attachment");
                  if (c === "Is unread") return on ? applyQ("", /\s*is:unread/) : applyQ("is:unread");
                  setMenu({ kind: "chip", a: anchorOf(e), chip: c });
                }}
              >
                {c}
                {dropdown && <Icon name="dropDown" size={18} />}
              </button>
            );
          })}
        </div>
      )}
      <div className="toolbar">
        {sel}
        {!someSel ? (
          <>
            <button className="icon-btn" data-tip="Refresh" aria-label="Refresh" onClick={() => (reloadList(), app.reloadFolders(true))}>
              <Icon name="refresh" size={20} />
            </button>
            <button className="icon-btn" data-tip="More" aria-label="More" onClick={(e) => setMenu({ kind: "more", a: anchorOf(e) })}>
              <Icon name="more" size={20} />
            </button>
          </>
        ) : (
          <>
            {isSpam ? (
              <button className="btn text" style={{ height: 32, fontSize: 14, color: "#444746", padding: "0 10px" }} onClick={() => act(selIds, "notspam")}>
                Not spam
              </button>
            ) : isTrash ? (
              <>
                <button className="btn text" style={{ height: 32, fontSize: 14, color: "#444746", padding: "0 10px" }} onClick={() => act(selIds, "delete")}>
                  Delete forever
                </button>
              </>
            ) : (
              <>
                {route.view === "inbox" ? (
                  <button className="icon-btn" data-tip="Archive" aria-label="Archive" onClick={() => act(selIds, "archive")}>
                    <Icon name="archive" size={20} />
                  </button>
                ) : isSnoozed ? (
                  <button className="icon-btn" data-tip="Unsnooze" aria-label="Unsnooze" onClick={() => act(selIds, "inbox")}>
                    <Icon name="unarchive" size={20} />
                  </button>
                ) : (
                  <button className="icon-btn" data-tip="Move to Inbox" aria-label="Move to Inbox" onClick={() => act(selIds, "inbox")}>
                    <Icon name="unarchive" size={20} />
                  </button>
                )}
                <button className="icon-btn" data-tip="Report spam" aria-label="Report spam" onClick={() => act(selIds, "spam")}>
                  <Icon name="spam" size={20} />
                </button>
                <button className="icon-btn" data-tip="Delete" aria-label="Delete" onClick={() => act(selIds, "trash")}>
                  <Icon name="delete" size={20} />
                </button>
              </>
            )}
            <span className="sep" />
            {selMsgs.some((m) => m.unread) ? (
              <button className="icon-btn" data-tip="Mark as read" aria-label="Mark as read" onClick={() => act(selIds, "read", { silent: true })}>
                <Icon name="markRead" size={20} />
              </button>
            ) : (
              <button className="icon-btn" data-tip="Mark as unread" aria-label="Mark as unread" onClick={() => act(selIds, "unread", { silent: true })}>
                <Icon name="markUnread" size={20} />
              </button>
            )}
            <button className="icon-btn" data-tip="Move to" aria-label="Move to" onClick={(e) => setMenu({ kind: "move", a: anchorOf(e), ids: selIds })}>
              <Icon name="moveTo" size={20} />
            </button>
            <button className="icon-btn" data-tip="More" aria-label="More" onClick={(e) => setMenu({ kind: "more", a: anchorOf(e) })}>
              <Icon name="more" size={20} />
            </button>
          </>
        )}
        <div className="spacer" />
        {(total > 0 || listLoading) && (
          <div className="pager">
            <span className="count" data-tip="Show more messages">
              {total ? (
                <>
                  {start}–{end} of {total.toLocaleString()}
                </>
              ) : null}
            </span>
            <button className="icon-btn" data-tip="Newer" aria-label="Newer" disabled={route.page <= 1} onClick={() => go({ page: route.page - 1 })}>
              <Icon name="chevronLeft" size={20} />
            </button>
            <button className="icon-btn" data-tip="Older" aria-label="Older" disabled={route.page >= pages} onClick={() => go({ page: route.page + 1 })}>
              <Icon name="chevronRight" size={20} />
            </button>
          </div>
        )}
        <button className="input-tools" data-tip="Input tools" aria-label="Input tools" onClick={(e) => setMenu({ kind: "input", a: anchorOf(e, "right") })}>
          <Icon name="keyboard" size={20} />
          <Icon name="dropDown" size={16} />
        </button>
      </div>
        {tabs && tabs.length > 1 && (
          <div className="tabs" role="tablist">
            {tabs.map((t) => {
              const active = t.key === category;
              const meta = TAB_META[t.key];
              const showNew = !active && t.newCount > 0 && t.key !== "primary";
              return (
                <button key={t.key} role="tab" aria-selected={active} className={`tab${active ? " active" : ""}`} onClick={() => go({ view: "inbox", category: t.key, page: 1, msg: undefined })}>
                  <Icon name={active ? meta.activeIcon : meta.icon} className="tab-icon" />
                  <span className="tab-text">
                    <span className="tab-title">
                      {meta.label}
                      {showNew && <span className={`badge ${t.key}`}>{t.newCount} new</span>}
                    </span>
                    {showNew && t.preview && <span className="tab-sub" style={{ display: "block" }}>{t.preview}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {isSpam && msgs.length > 0 && (
          <div className="notice-bar">
            Messages in Spam can be deleted by the mail server.
            <button className="link-btn" onClick={() => act([], "empty", { target: "spam" })}>
              Delete all spam messages now
            </button>
          </div>
        )}
        {isTrash && msgs.length > 0 && (
          <div className="notice-bar">
            <button className="link-btn" onClick={() => act([], "empty", { target: "trash" })}>
              Empty Trash now
            </button>
          </div>
        )}
        <div className="list" role="list">
          {msgs.map((m, i) => (
            <Row
              key={m.id}
              m={m}
              idx={i}
              focused={i === focusIdx}
              selected={selected.has(m.id)}
              onToggle={toggle}
              onOpen={openMsg}
              category={category}
              view={route}
              myAddresses={myAddresses}
              hover={prefs.hoverActions}
              selIds={selIds}
              onSnooze={(a) => setMenu({ kind: "snooze", a, ids: [m.id] })}
            />
          ))}
        </div>
        {list && !msgs.length && !listLoading && <EmptyState route={route} />}
        {!list && listLoading && (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <div className="spinner" />
          </div>
        )}
        <Footer />
      </div>

      {menu?.kind === "select" && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)}>
          {(
            [
              ["All", () => true],
              ["None", () => false],
              ["Read", (m: MessageSummary) => !m.unread],
              ["Unread", (m: MessageSummary) => m.unread],
              ["Starred", (m: MessageSummary) => m.starred],
              ["Unstarred", (m: MessageSummary) => !m.starred],
            ] as [string, (m: MessageSummary) => boolean][]
          ).map(([l, fn]) => (
            <MenuItem
              key={l}
              onClick={() => {
                selectBy(fn);
                setMenu(null);
              }}
            >
              {l}
            </MenuItem>
          ))}
        </Popover>
      )}
      {menu?.kind === "more" && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)}>
          {!someSel ? (
            <>
              <MenuItem
                icon="markRead"
                onClick={() => {
                  act([], "markAllRead");
                  setMenu(null);
                  setTimeout(reloadList, 300);
                }}
              >
                Mark all as read
              </MenuItem>
              <MenuSep />
              <MenuItem hint>Select messages to see more actions</MenuItem>
            </>
          ) : (
            <>
              <MenuItem icon="markRead" onClick={() => (act(selIds, "read", { silent: true }), setMenu(null))}>
                Mark as read
              </MenuItem>
              <MenuItem icon="markUnread" onClick={() => (act(selIds, "unread", { silent: true }), setMenu(null))}>
                Mark as unread
              </MenuItem>
              <MenuItem icon="importantFilled" onClick={() => (act(selIds, "important", { silent: true }), setMenu(null))}>
                Mark as important
              </MenuItem>
              <MenuItem icon="important" onClick={() => (act(selIds, "notimportant", { silent: true }), setMenu(null))}>
                Mark as not important
              </MenuItem>
              {!isSpam && !isTrash && (
                <MenuItem icon="clock" onClick={() => setMenu({ kind: "snooze", a: menu.a, ids: selIds })}>
                  Snooze
                </MenuItem>
              )}
              <MenuItem icon="label" onClick={() => setMenu({ kind: "label", a: menu.a, ids: selIds })}>
                Label as
              </MenuItem>
              <MenuSep />
              <MenuItem icon="star" onClick={() => (act(selIds, "star", { silent: true }), setMenu(null))}>
                Add star
              </MenuItem>
              <MenuItem icon="starBorder" onClick={() => (act(selIds, "unstar", { silent: true }), setMenu(null))}>
                Remove star
              </MenuItem>
              <MenuSep />
              <MenuItem
                icon="tune"
                onClick={() => {
                  const from = selMsgs[0]?.from.address;
                  sessionStorage.setItem("webmail:newFilter", JSON.stringify({ from }));
                  setMenu(null);
                  go({ view: "settings", settings: "filters" });
                }}
              >
                Filter messages like these
              </MenuItem>
              {selMsgs.length === 1 && (
                <MenuItem
                  icon="forward"
                  onClick={() => {
                    setMenu(null);
                    compose({ forwardOf: selMsgs[0].id });
                  }}
                >
                  Forward as attachment
                </MenuItem>
              )}
            </>
          )}
        </Popover>
      )}
      {menu?.kind === "snooze" && <SnoozeMenu anchor={menu.a} onClose={() => setMenu(null)} onPick={(t) => act(menu.ids || [], "snooze", { until: t })} />}
      {menu?.kind === "move" && (
        <FolderPicker anchor={menu.a} onClose={() => setMenu(null)} title="Move to:" folders={folders} exclude={msgs.find((m) => m.id === menu.ids?.[0])?.folder} onPick={(f) => act(menu.ids || [], f.role === "trash" ? "trash" : f.role === "spam" ? "spam" : "move", { target: f.path, label: f.name })} />
      )}
      {menu?.kind === "label" && <FolderPicker anchor={menu.a} onClose={() => setMenu(null)} title="Label as:" folders={folders.filter((f) => f.role === "label" || f.role === "archive")} onPick={(f) => act(menu.ids || [], "copy", { target: f.path, label: f.name })} />}
      {menu?.kind === "input" && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)} style={{ minWidth: 210 }}>
          {[
            ["keyboard", "English"],
            ["keyboard", "English Dvorak"],
            ["textFields", "English (transliteration)"],
            ["edit", "English (handwriting)"],
          ].map(([ic, l]) => (
            <MenuItem key={l} icon={ic as IconName} highlighted={inputTool === l} onClick={() => (setInputTool(l), setMenu(null), snack(`Input tool set to ${l}.`))}>
              {l.replace(/ \(.*\)/, "")}
            </MenuItem>
          ))}
          <MenuSep />
          <MenuItem onClick={() => (setMenu(null), go({ view: "settings", settings: "general" }))}>Input Tools Settings</MenuItem>
        </Popover>
      )}
      {menu?.kind === "chip" && <ChipMenu chip={menu.chip!} anchor={menu.a} onClose={() => setMenu(null)} apply={applyQ} me={me.email} />}
    </>
  );
}

function ChipMenu({ chip, anchor, onClose, apply, me }: { chip: string; anchor: Anchor; onClose: () => void; apply: (add: string, re?: RegExp) => void; me: string }) {
  const [v, setV] = useState("");
  if (chip === "Any time") {
    const opts: [string, string][] = [
      ["Older than a week", "older_than:7d"],
      ["Older than a month", "older_than:1m"],
      ["Older than 6 months", "older_than:6m"],
      ["Older than a year", "older_than:1y"],
      ["Newer than a week", "newer_than:7d"],
      ["Newer than a month", "newer_than:1m"],
    ];
    return (
      <Popover anchor={anchor} onClose={onClose}>
        <MenuItem onClick={() => (apply("", /\s*(older|newer)_than:\S+/), onClose())}>Any time</MenuItem>
        {opts.map(([l, q]) => (
          <MenuItem key={l} onClick={() => (apply(q, /\s*(older|newer)_than:\S+/), onClose())}>
            {l}
          </MenuItem>
        ))}
      </Popover>
    );
  }
  const key = chip === "From" ? "from" : "to";
  return (
    <Popover anchor={anchor} onClose={onClose} style={{ padding: 12, width: 300 }}>
      <input
        autoFocus
        placeholder={chip === "From" ? "Sender name or address" : "Recipient name or address"}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v.trim()) {
            apply(`${key}:${/\s/.test(v.trim()) ? `"${v.trim()}"` : v.trim()}`, new RegExp(`\\s*${key}:("[^"]*"|\\S+)`));
            onClose();
          }
        }}
        style={{ width: "100%", height: 36, border: "1px solid #dadce0", borderRadius: 4, padding: "0 10px", fontSize: 14, outline: "none" }}
      />
      <div style={{ marginTop: 6 }}>
        <MenuItem onClick={() => (apply(`${key}:${me}`, new RegExp(`\\s*${key}:("[^"]*"|\\S+)`)), onClose())}>{key === "to" ? "To me" : "From me"}</MenuItem>
      </div>
    </Popover>
  );
}

function Row({
  m,
  idx,
  selected,
  focused,
  onToggle,
  onOpen,
  category,
  view,
  myAddresses,
  hover,
  selIds,
  onSnooze,
}: {
  m: MessageSummary;
  idx: number;
  selected: boolean;
  focused: boolean;
  onToggle: (id: string, idx: number, shift: boolean) => void;
  onOpen: (m: MessageSummary) => void;
  category: Category;
  view: Route;
  myAddresses: string[];
  hover: boolean;
  selIds: string[];
  onSnooze: (a: Anchor) => void;
}) {
  const { act } = useApp();
  const isSent = view.view === "sent" || view.view === "scheduled";
  const isDraft = m.draft || view.view === "drafts";
  const fromText = isSent || (isDraft && m.to.length) ? `To: ${m.to.map((a) => displayName(a, myAddresses)).join(", ") || "(no recipients)"}` : displayName(m.from, myAddresses);
  const showNew = m.unread && category !== "primary" && view.view === "inbox";
  const tall = m.attachments.length > 0;
  const canDrag = typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
  const date = listDate(m.date);
  return (
    <div
      role="listitem"
      className={`row${m.unread ? " unread" : ""}${selected ? " selected" : ""}${tall ? " tall" : ""}`}
      style={focused ? { boxShadow: "inset 4px 0 0 #0b57d0, inset 0 -1px 0 0 var(--row-sep)" } : undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onOpen(m);
      }}
      draggable={canDrag}
      onDragStart={(e) => {
        const ids = selected && selIds.length ? selIds : [m.id];
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = "move";
        const ghost = document.createElement("div");
        ghost.textContent = ids.length === 1 ? `Move 1 conversation` : `Move ${ids.length} conversations`;
        ghost.style.cssText = "position:fixed;top:-100px;padding:6px 12px;background:#0b57d0;color:#fff;border-radius:4px;font:500 14px var(--font-ui)";
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        setTimeout(() => ghost.remove(), 0);
      }}
    >
      <span className="drag">
        <Icon name="drag" size={16} style={{ width: 8, marginLeft: -4 }} />
      </span>
      <span className="c-check">
        <button
          aria-label={selected ? "Deselect" : "Select"}
          data-tip="Select"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(m.id, idx, e.shiftKey);
          }}
        >
          <Icon name={selected ? "checked" : "checkBlank"} size={20} />
        </button>
      </span>
      <span className={`c-star${m.starred ? " on" : ""}`}>
        <button
          aria-label={m.starred ? "Starred" : "Not starred"}
          data-tip={m.starred ? "Starred" : "Not starred"}
          onClick={(e) => {
            e.stopPropagation();
            act([m.id], m.starred ? "unstar" : "star", { silent: true });
          }}
        >
          <Icon name={m.starred ? "star" : "starBorder"} size={20} />
        </button>
      </span>
      <span className="c-from" title={isSent ? m.to.map((a) => a.address).join(", ") : m.from.address}>
        <span className="nm">
          {isDraft ? <span style={{ color: "#d93025", fontWeight: 400 }}>Draft</span> : fromText}
          {view.view === "drafts" && m.to.length ? <span style={{ fontWeight: 400 }}> {fromText.replace(/^To: /, "")}</span> : null}
        </span>
        {m.threadCount && m.threadCount > 1 ? <span className="cnt">{m.threadCount}</span> : null}
        {showNew && <span className="new-chip">New</span>}
      </span>
      <span className="c-main">
        <span className="c-line">
          {m.folderLabel && <span className="folder-chip">{m.folderLabel}</span>}
          <span className="c-subject">{m.subject || "(no subject)"}</span>
          {m.snippet && (
            <span className="c-snippet">
              <span className="dash">&nbsp;-&nbsp;</span>
              {m.snippet}
            </span>
          )}
        </span>
        {tall && (
          <span className="att-chips">
            {m.attachments.slice(0, 3).map((a, i) => (
              <span className="att-chip" key={i} title={a.filename}>
                <Icon name={a.contentType === "application/pdf" ? "pdf" : a.contentType.startsWith("image/") ? "image" : "file"} size={16} style={{ color: a.contentType === "application/pdf" ? "#ea4335" : a.contentType.startsWith("image/") ? "#ea4335" : "#4285f4" }} />
                <span>{a.filename}</span>
              </span>
            ))}
            {m.attachments.length > 3 && <span className="att-chip">+{m.attachments.length - 3}</span>}
          </span>
        )}
      </span>
      <span className={`c-date${hover ? " hoverable" : ""}${m.unread ? "" : " read"}`} title={new Date(m.date).toLocaleString()}>
        {date}
      </span>
      <span className={`hover-actions${hover ? " on" : ""}`}>
        {view.view !== "trash" && view.view !== "spam" && view.view !== "inbox" ? null : null}
        {view.view === "inbox" && (
          <button className="icon-btn" data-tip="Archive" aria-label="Archive" onClick={(e) => (e.stopPropagation(), act([m.id], "archive"))}>
            <Icon name="archive" size={20} />
          </button>
        )}
        <button className="icon-btn" data-tip={view.view === "trash" ? "Delete forever" : "Delete"} aria-label="Delete" onClick={(e) => (e.stopPropagation(), act([m.id], view.view === "trash" ? "delete" : "trash"))}>
          <Icon name={view.view === "trash" ? "deleteForever" : "delete"} size={20} />
        </button>
        <button className="icon-btn" data-tip={m.unread ? "Mark as read" : "Mark as unread"} aria-label={m.unread ? "Mark as read" : "Mark as unread"} onClick={(e) => (e.stopPropagation(), act([m.id], m.unread ? "read" : "unread", { silent: true }))}>
          <Icon name={m.unread ? "markRead" : "markUnread"} size={20} />
        </button>
        {view.view !== "trash" && view.view !== "spam" && (
          <button
            className="icon-btn"
            data-tip="Snooze"
            aria-label="Snooze"
            onClick={(e) => {
              e.stopPropagation();
              onSnooze(anchorOf(e, "right"));
            }}
          >
            <Icon name="clock" size={20} />
          </button>
        )}
      </span>
    </div>
  );
}

function EmptyState({ route }: { route: Route }) {
  const { compose } = useApp();
  const t: Record<string, React.ReactNode> = {
    drafts: (
      <>
        You don&apos;t have any saved drafts.
        <br />
        Saving a draft allows you to keep a message you aren&apos;t ready to send yet.
      </>
    ),
    starred: (
      <>
        No starred messages. Stars let you give messages a special status to make them easier to find. To star a message, click on the star outline beside any message or conversation.
      </>
    ),
    snoozed: (
      <>
        Nothing snoozed.
        <br />
        Snooze messages to temporarily remove them from your inbox until you need them.
      </>
    ),
    sent: (
      <>
        No sent messages!{" "}
        <button className="link-btn" onClick={() => compose()}>
          Send
        </button>{" "}
        one now!
      </>
    ),
    spam: <>Hooray, no spam here!</>,
    trash: <>No conversations in Trash.</>,
    search: (
      <>
        No messages matched your search. Try using search options such as sender, date, size and more.
      </>
    ),
    imp: <>No important messages.</>,
    purchases: <>No purchases yet.</>,
  };
  const msg = t[route.view] ?? (route.view === "inbox" ? <>Your {route.category && route.category !== "primary" ? route.category.charAt(0).toUpperCase() + route.category.slice(1) : "Primary"} tab is empty.</> : <>There are no conversations with this label.</>);
  return <div className="empty">{msg}</div>;
}

export function Footer() {
  const { me } = useApp();
  const q = me.quota;
  const pct = q ? Math.round((q.used / q.limit) * 100) : 0;
  return (
    <div className="footer">
      <div>
        {q && (
          <>
            <div className="quota-bar" title={`${bytes(q.used)} of ${bytes(q.limit)}`}>
              <div style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {pct}% of {bytes(q.limit)} used
            </span>
          </>
        )}
      </div>
      <div className="center">
        <a href="https://www.tjhsst.edu" target="_blank" rel="noopener noreferrer">
          TJHSST
        </a>{" "}
        ·{" "}
        <a href="https://guides.tjhsst.edu" target="_blank" rel="noopener noreferrer">
          Help
        </a>{" "}
        ·{" "}
        <a href="https://status.tjhsst.edu" target="_blank" rel="noopener noreferrer">
          Status
        </a>
      </div>
      <div className="right">
        Signed in as {me.username}
        <br />
        <a href="https://roundcube.tjhsst.edu" target="_blank" rel="noopener noreferrer">
          Classic webmail
        </a>
      </div>
    </div>
  );
}

function ScheduledList() {
  const { snack } = useApp();
  const [items, setItems] = useState<{ id: string; sendAt: number; to: string; subject: string; status: string; error?: string }[] | null>(null);
  const load = useCallback(() => {
    api<{ items: NonNullable<typeof items> }>("/api/scheduled")
      .then((r) => setItems(r.items))
      .catch((e) => snack((e as Error).message));
  }, [snack]);
  useEffect(load, [load]);
  return (
    <>
      <div className="toolbar">
        <button className="icon-btn" data-tip="Refresh" aria-label="Refresh" onClick={load}>
          <Icon name="refresh" size={20} />
        </button>
      </div>
      <div className="scroll">
        {items?.map((it) => (
          <div key={it.id} className="row" style={{ cursor: "default" }}>
            <span className="c-check" />
            <span className="c-from">To: {it.to || "(no recipients)"}</span>
            <span className="c-main">
              <span className="c-line">
                {it.status === "failed" ? <span className="folder-chip" style={{ background: "#fce8e6", color: "#c5221f" }}>Failed</span> : <span className="folder-chip">Scheduled</span>}
                <span className="c-subject">{it.subject || "(no subject)"}</span>
                {it.error && <span className="c-snippet">&nbsp;-&nbsp;{it.error}</span>}
              </span>
            </span>
            <span className="c-date read" style={{ width: "auto", whiteSpace: "nowrap" }}>
              {new Date(it.sendAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
            <button
              className="btn text"
              style={{ marginLeft: 8 }}
              onClick={async () => {
                await api(`/api/send/${it.id}`, { method: "DELETE" });
                snack("Scheduled send cancelled.");
                load();
              }}
            >
              Cancel send
            </button>
          </div>
        ))}
        {items && !items.length && <div className="empty">No scheduled messages.</div>}
        <Footer />
      </div>
    </>
  );
}
