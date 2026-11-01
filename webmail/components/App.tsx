"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, setCsrf, setOnAuthLost } from "@/lib/client/api";
import type { Category, Folder, ListResult, Me, MessageSummary } from "@/lib/types";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { MailList } from "./MailList";
import { MessageView } from "./MessageView";
import { ComposeDock, ComposeInit, ComposeState } from "./Compose";
import { Settings } from "./Settings";
import { Rail, SidePanel, PanelKind } from "./SidePanel";
import { Snack, Snackbar, Tooltips } from "./ui";
import { SignIn } from "./SignIn";

export type Prefs = {
  pageSize: number;
  undoSeconds: number;
  replyAll: boolean;
  hoverActions: boolean;
  sendAndArchive: boolean;
  externalImages: boolean;
  categories: { promotions: boolean; social: boolean; updates: boolean; forums: boolean };
  starredInPrimary: boolean;
  readingPane: boolean;
  signature: string;
  fontFamily: string;
  fontSize: string;
  hiddenLabels: string[];
  shortcuts: boolean;
  density: string;
  composeFullscreen: boolean;
  plainText: boolean;
  theme: string;
  sidebarCollapsed: boolean;
  displayName: string;
};

export type Route = {
  view: string;
  category?: Category;
  label?: string;
  q?: string;
  page: number;
  msg?: string;
  settings?: string;
};

const SIMPLE = ["inbox", "starred", "snoozed", "sent", "drafts", "imp", "scheduled", "all", "spam", "trash", "purchases"];
const MSG_RE = /^[A-Za-z0-9_-]+\.\d+$/;

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#/, "").split("/").filter(Boolean);
  const r: Route = { view: "inbox", page: 1 };
  if (!parts.length) return r;
  const head = parts.shift()!;
  if (head === "settings") return { view: "settings", page: 1, settings: parts[0] || "general" };
  if (head === "category") {
    r.view = "inbox";
    const c = parts.shift() as Category;
    if (["promotions", "social", "updates", "forums"].includes(c)) r.category = c;
  } else if (head === "label") {
    r.view = "label";
    r.label = decodeURIComponent(parts.shift() || "");
  } else if (head === "search") {
    r.view = "search";
    r.q = decodeURIComponent(parts.shift() || "");
  } else if (SIMPLE.includes(head)) r.view = head;
  for (const p of parts) {
    const m = /^p(\d+)$/.exec(p);
    if (m) r.page = Number(m[1]);
    else if (MSG_RE.test(p)) r.msg = p;
  }
  return r;
}

export function buildHash(r: Route): string {
  let h = "#";
  if (r.view === "settings") return `#settings/${r.settings || "general"}`;
  if (r.view === "inbox") h += r.category && r.category !== "primary" ? `category/${r.category}` : "inbox";
  else if (r.view === "label") h += `label/${encodeURIComponent(r.label || "")}`;
  else if (r.view === "search") h += `search/${encodeURIComponent(r.q || "")}`;
  else h += r.view;
  if (r.page > 1) h += `/p${r.page}`;
  if (r.msg) h += `/${r.msg}`;
  return h;
}

export function serverView(r: Route): { view: string; q?: string; category?: Category } {
  if (r.view === "imp") return { view: "important" };
  if (r.view === "label") return { view: `label:${r.label}` };
  if (r.view === "search") return { view: "search", q: r.q };
  return { view: r.view, category: r.category };
}

export function routeQuery(r: Route): string {
  switch (r.view) {
    case "starred":
      return "is:starred";
    case "snoozed":
      return "is:snoozed";
    case "sent":
      return "in:sent";
    case "drafts":
      return "in:draft";
    case "imp":
      return "is:important";
    case "scheduled":
      return "in:scheduled";
    case "all":
      return "";
    case "spam":
      return "in:spam";
    case "trash":
      return "in:trash";
    case "purchases":
      return "label:purchases";
    case "label":
      return `label:${(r.label || "").replace(/\s/g, "-")}`;
    case "search":
      return r.q || "";
  }
  return "";
}

type Ctx = {
  me: Me;
  prefs: Prefs;
  savePrefs: (p: Partial<Prefs>) => Promise<void>;
  folders: Folder[];
  reloadFolders: (fresh?: boolean) => void;
  route: Route;
  go: (r: Partial<Route> & { view?: string }, replace?: boolean) => void;
  list: ListResult | null;
  listLoading: boolean;
  reloadList: () => void;
  setList: React.Dispatch<React.SetStateAction<ListResult | null>>;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  act: (ids: string[], action: string, extra?: { target?: string; until?: number; silent?: boolean; label?: string }) => Promise<void>;
  compose: (init?: ComposeInit) => void;
  snack: (text: string, actions?: Snack["actions"], timeout?: number) => void;
  panel: PanelKind | null;
  narrow: boolean;
  phone: boolean;
  drawer: boolean;
  setDrawer: (v: boolean) => void;
  setPanel: (p: PanelKind | null) => void;
  myAddresses: string[];
  roleOf: (path: string) => Folder | undefined;
};

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

export default function App() {
  const [state, setState] = useState<"loading" | "signin" | "ready">("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [prefs, setPrefsState] = useState<Prefs | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ me: Me; prefs: Prefs }>("/api/me");
      setCsrf(r.me.csrf);
      setMe(r.me);
      setPrefsState(r.prefs);
      setState("ready");
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) setState("signin");
      else {
        setError((e as Error).message);
        setState("signin");
      }
    }
  }, []);

  useEffect(() => {
    const u = new URL(window.location.href);
    const err = u.searchParams.get("error");
    if (err) {
      setError(err);
      u.searchParams.delete("error");
      window.history.replaceState(null, "", u.pathname + u.hash);
    }
    setOnAuthLost(() => setState("signin"));
    load();
  }, [load]);

  if (state === "loading")
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 24 }}>
        <img src="/tjlogo.png" width={64} height={64} alt="" />
        <div className="spinner" />
      </div>
    );
  if (state === "signin" || !me || !prefs) return <SignIn error={error} />;
  return <Mail me={me} initialPrefs={prefs} />;
}

function Mail({ me, initialPrefs }: { me: Me; initialPrefs: Prefs }) {
  const [prefs, setPrefs] = useState(initialPrefs);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [route, setRoute] = useState<Route>(() => (typeof window === "undefined" ? { view: "inbox", page: 1 } : parseHash(window.location.hash)));
  const [list, setList] = useState<ListResult | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composes, setComposes] = useState<ComposeState[]>([]);
  const [snackState, setSnack] = useState<Snack | null>(null);
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const narrow = useMedia("(max-width: 900px)");
  const phone = useMedia("(max-width: 640px)");
  const [drawer, setDrawer] = useState(false);
  const listReq = useRef(0);

  const myAddresses = useMemo(() => me.identities.map((i) => i.address.toLowerCase()), [me]);

  const snack = useCallback((text: string, actions?: Snack["actions"], timeout?: number) => setSnack({ id: Date.now(), text, actions, timeout }), []);

  const savePrefs = useCallback(async (p: Partial<Prefs>) => {
    setPrefs((cur) => ({ ...cur, ...p }));
    try {
      const next = await api<Prefs>("/api/prefs", { method: "PUT", body: p });
      setPrefs(next);
    } catch (e) {
      snack((e as Error).message);
    }
  }, [snack]);

  const reloadFolders = useCallback((fresh = false) => {
    api<{ folders: Folder[] }>(`/api/folders${fresh ? "?fresh=1" : ""}`)
      .then((r) => setFolders(r.folders))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash) window.history.replaceState(null, "", "#inbox");
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((r: Partial<Route> & { view?: string }, replace = false) => {
    const cur = parseHash(window.location.hash);
    const next: Route = r.view && r.view !== cur.view ? { page: 1, ...r, view: r.view } : { ...cur, ...r };
    if ("view" in r && r.view !== cur.view) {
      if (!("category" in r)) delete next.category;
      if (!("msg" in r)) delete next.msg;
    }
    const h = buildHash(next);
    if (replace) {
      window.history.replaceState(null, "", h);
      setRoute(parseHash(h));
    } else window.location.hash = h;
  }, []);

  const listKey = useMemo(() => {
    if (route.view === "settings" || route.view === "scheduled") return null;
    const sv = serverView(route);
    return JSON.stringify({ ...sv, page: route.page });
  }, [route]);

  const reloadList = useCallback(() => {
    if (!listKey) return;
    const k = JSON.parse(listKey) as { view: string; q?: string; category?: string; page: number };
    const id = ++listReq.current;
    setListLoading(true);
    const qs = new URLSearchParams({ view: k.view, page: String(k.page) });
    if (k.q) qs.set("q", k.q);
    if (k.category) qs.set("category", k.category);
    api<ListResult>(`/api/messages?${qs}`)
      .then((r) => {
        if (id === listReq.current) setList(r);
      })
      .catch((e) => {
        if (id === listReq.current) snack((e as Error).message);
      })
      .finally(() => {
        if (id === listReq.current) setListLoading(false);
      });
  }, [listKey, snack]);

  useEffect(() => {
    setSelected(new Set());
    reloadList();
  }, [reloadList]);

  useEffect(() => {
    reloadFolders();
  }, [reloadFolders]);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      es = new EventSource("/api/events");
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "new" || data.type === "changed") {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => {
              reloadFolders(true);
              window.dispatchEvent(new CustomEvent("webmail:refresh"));
            }, 800);
          }
        } catch {
        }
      };
      es.onerror = () => {
        es?.close();
        retry = setTimeout(open, 15000);
      };
    };
    open();
    const vis = () => {
      if (document.visibilityState === "visible") {
        reloadFolders(true);
        window.dispatchEvent(new CustomEvent("webmail:refresh"));
      }
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      es?.close();
      if (retry) clearTimeout(retry);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [reloadFolders]);

  useEffect(() => {
    const h = () => {
      if (!parseHash(window.location.hash).msg) reloadList();
    };
    window.addEventListener("webmail:refresh", h);
    return () => window.removeEventListener("webmail:refresh", h);
  }, [reloadList]);

  useEffect(() => {
    const inbox = folders.find((f) => f.role === "inbox");
    const names: Record<string, string> = { inbox: "Inbox", starred: "Starred", snoozed: "Snoozed", sent: "Sent Mail", drafts: "Drafts", imp: "Important", scheduled: "Scheduled", all: "All Mail", spam: "Spam", trash: "Trash", purchases: "Purchases", settings: "Settings", search: "Search results", label: route.label || "" };
    const n = inbox?.unread ? ` (${inbox.unread})` : "";
    document.title = `${names[route.view] ?? "Inbox"}${route.view === "inbox" ? n : ""} - ${me.email} - TJ Mail`;
  }, [route, folders, me.email]);

  const roleOf = useCallback((path: string) => folders.find((f) => f.path === path), [folders]);

  const act = useCallback(
    async (ids: string[], action: string, extra: { target?: string; until?: number; silent?: boolean; label?: string } = {}) => {
      if (!ids.length && !["markAllRead", "empty"].includes(action)) return;
      const removes = ["archive", "trash", "delete", "spam", "notspam", "move", "inbox", "snooze"].includes(action);
      const prev = list;
      setList((cur) => {
        if (!cur) return cur;
        if (removes) {
          const keep = cur.messages.filter((m) => !ids.includes(m.id));
          return { ...cur, messages: keep, total: Math.max(0, cur.total - (cur.messages.length - keep.length)) };
        }
        const patch: Partial<MessageSummary> =
          action === "read" ? { unread: false } : action === "unread" ? { unread: true } : action === "star" ? { starred: true } : action === "unstar" ? { starred: false } : action === "important" ? { important: true } : action === "notimportant" ? { important: false } : {};
        return { ...cur, messages: cur.messages.map((m) => (ids.includes(m.id) ? { ...m, ...patch } : m)) };
      });
      if (removes) setSelected(new Set());
      try {
        const r = await api<{ moved?: Record<string, string> }>("/api/messages", { body: { ids, action, target: extra.target, until: extra.until, view: serverView(route).view } });
        reloadFolders(true);
        if (extra.silent) return;
        const n = ids.length;
        const what = n === 1 ? "Conversation" : `${n} conversations`;
        const label = extra.label;
        const msgs: Record<string, string> = {
          archive: `${what} archived.`,
          trash: `${what} moved to Trash.`,
          delete: `${what} deleted forever.`,
          spam: `${what} marked as spam.`,
          notspam: `${what} moved to Inbox.`,
          inbox: `${what} moved to Inbox.`,
          move: `${what} moved to "${label ?? extra.target}".`,
          copy: `${what} added to "${label ?? extra.target}".`,
          read: `${what} marked as read.`,
          unread: `${what} marked as unread.`,
          snooze: `${what} snoozed until ${extra.until ? new Date(extra.until).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}.`,
          markAllRead: "All conversations marked as read.",
          empty: "Messages deleted forever.",
        };
        const moved = r.moved || {};
        const undoTarget: Record<string, string | undefined> = { archive: "INBOX", trash: undefined, spam: "INBOX", notspam: undefined, inbox: undefined, move: undefined };
        const canUndo = ["archive", "trash", "spam", "move", "notspam", "inbox"].includes(action) && Object.keys(moved).length;
        if (msgs[action] && ["archive", "trash", "delete", "spam", "notspam", "inbox", "move", "copy", "snooze", "markAllRead", "empty"].includes(action)) {
          snack(
            msgs[action],
            canUndo
              ? [
                  {
                    label: "Undo",
                    run: async () => {
                      const back = new Map<string, string[]>();
                      for (const [oldId, newId] of Object.entries(moved)) {
                        const src = atobUrl(oldId.split(".")[0]);
                        const dst = undoTarget[action] ?? src;
                        if (!back.has(dst)) back.set(dst, []);
                        back.get(dst)!.push(newId);
                      }
                      for (const [dst, list2] of back) await api("/api/messages", { body: { ids: list2, action: "move", target: dst } });
                      snack("Action undone.");
                      reloadList();
                      reloadFolders(true);
                    },
                  },
                ]
              : undefined,
          );
        }
      } catch (e) {
        setList(prev);
        snack((e as Error).message);
      }
    },
    [list, route, reloadFolders, reloadList, snack],
  );

  const compose = useCallback(
    (init?: ComposeInit) => {
      setComposes((cs) => {
        if (init?.draftId && cs.some((c) => c.init.draftId === init.draftId)) return cs;
        const next = [...cs, { key: Date.now() + Math.random(), init: init ?? {}, minimized: false, full: prefs.composeFullscreen }];
        return next.slice(-3);
      });
    },
    [prefs.composeFullscreen],
  );

  useEffect(() => {
    const u = new URL(window.location.href);
    const to = u.searchParams.get("to");
    if (to) {
      compose({ to });
      u.searchParams.delete("to");
      window.history.replaceState(null, "", u.pathname + u.hash);
    }
  }, [compose]);

  useEffect(() => {
    setDrawer(false);
  }, [route.view, route.label, route.category, route.msg, route.settings]);

  const ctx: Ctx = {
    me,
    prefs,
    savePrefs,
    folders,
    reloadFolders,
    route,
    go,
    list,
    listLoading,
    reloadList,
    setList,
    selected,
    setSelected,
    act,
    compose,
    snack,
    panel,
    setPanel,
    narrow,
    phone,
    drawer,
    setDrawer,
    myAddresses,
    roleOf,
  };

  let content: React.ReactNode;
  if (route.view === "settings") content = <Settings />;
  else if (route.msg) content = <MessageView key={route.msg} id={route.msg} />;
  else content = <MailList />;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <Header />
        <div className="body">
          <Sidebar />
          <div className="main">
            <div className="panel">{content}</div>
            {panel && <SidePanel kind={panel} onClose={() => setPanel(null)} />}
          </div>
          <Rail />
        </div>
        {phone && !route.msg && route.view !== "settings" && !composes.some((c) => !c.minimized) && (
          <button className="fab" onClick={() => compose()} aria-label="Compose">
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
            </svg>
            Compose
          </button>
        )}
        <ComposeDock composes={composes} setComposes={setComposes} />
        <Snackbar snack={snackState} onClose={() => setSnack(null)} />
        <Tooltips />
        {prefs.theme !== "default" && <style>{`:root{--bg:${THEMES[prefs.theme] ?? "#f8fafd"}}`}</style>}
      </div>
    </AppCtx.Provider>
  );
}

const THEMES: Record<string, string> = { blue: "#e8f0fe", green: "#e6f4ea", sand: "#fef7e0", rose: "#fce8e6", slate: "#e8eaed" };

function useMedia(q: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(q).matches,
    () => false,
  );
}

export function atobUrl(s: string) {
  try {
    const b = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b + "===".slice((b.length + 3) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}
