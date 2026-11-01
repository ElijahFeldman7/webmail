"use client";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "./App";
import { AppIcon, Icon } from "./icons";
import { api } from "@/lib/client/api";

export type PanelKind = "calendar" | "keep" | "tasks" | "contacts";

export function Rail() {
  const { panel, setPanel } = useApp();
  const [hidden, setHidden] = useState(false);
  const items: [PanelKind, string, string][] = [
    ["calendar", "Calendar", "#4285f4"],
    ["keep", "Keep", "#fbbc04"],
    ["tasks", "Tasks", "#1a73e8"],
    ["contacts", "Contacts", "#1a73e8"],
  ];
  if (hidden)
    return (
      <div style={{ position: "fixed", right: 0, bottom: 16, zIndex: 5 }}>
        <button className="icon-btn" data-tip="Show side panel" aria-label="Show side panel" onClick={() => setHidden(false)}>
          <Icon name="chevronLeft" size={20} />
        </button>
      </div>
    );
  return (
    <aside className="rail" aria-label="Side panel">
      {items.map(([k, label, color]) => (
        <button key={k} className={`rail-btn${panel === k ? " active" : ""}`} style={{ color }} data-tip={label} aria-label={label} onClick={() => setPanel(panel === k ? null : k)}>
          <AppIcon kind={k} size={20} />
        </button>
      ))}
      <div className="rail-sep" />
      <button className="rail-btn" data-tip="Get add-ons" aria-label="Get add-ons" onClick={() => (window.location.hash = "#settings/addons")} style={{ color: "#444746" }}>
        <Icon name="add" size={20} />
      </button>
      <div className="rail-bottom">
        <button className="icon-btn" data-tip="Hide side panel" aria-label="Hide side panel" onClick={() => (setHidden(true), setPanel(null))}>
          <Icon name="chevronRight" size={20} />
        </button>
      </div>
    </aside>
  );
}

export function SidePanel({ kind, onClose }: { kind: PanelKind; onClose: () => void }) {
  const titles: Record<PanelKind, string> = { calendar: "Calendar", keep: "Keep", tasks: "Tasks", contacts: "Contacts" };
  return (
    <section className="sidepanel" aria-label={titles[kind]}>
      {kind === "calendar" && <CalendarPanel onClose={onClose} />}
      {kind === "keep" && <KeepPanel onClose={onClose} />}
      {kind === "tasks" && <TasksPanel onClose={onClose} />}
      {kind === "contacts" && <ContactsPanel onClose={onClose} />}
    </section>
  );
}

function Hdr({ kicker, title, onClose, extra }: { kicker: string; title: React.ReactNode; onClose: () => void; extra?: React.ReactNode }) {
  return (
    <div className="sp-hdr">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sp-kicker">{kicker}</div>
        <div className="sp-title">{title}</div>
      </div>
      {extra}
      <button className="icon-btn" aria-label="Close" data-tip="Close" onClick={onClose}>
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}

function Loading({ kind }: { kind: PanelKind }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, paddingBottom: 60 }}>
      <AppIcon kind={kind} size={80} />
      <div className="spinner" />
    </div>
  );
}

function CalendarPanel({ onClose }: { onClose: () => void }) {
  const [day, setDay] = useState<{ date: string; name: string; blocks: { name: string; start: string; end: string }[] } | null | undefined>(undefined);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<{ day: typeof day }>("/api/schedule")
      .then((r) => setDay(r.day))
      .catch((e) => setErr((e as Error).message));
  }, []);
  const label = day?.date ? new Date(day.date + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) : "Loading...";
  return (
    <>
      <Hdr kicker="Calendar" title={day === undefined && !err ? "Loading..." : label} onClose={onClose} />
      {day === undefined && !err ? (
        <Loading kind="calendar" />
      ) : (
        <div className="sp-body">
          {err && <div style={{ color: "#c5221f" }}>{err}</div>}
          {day === null && <div style={{ color: "var(--text2)" }}>No school today.</div>}
          {day && (
            <>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 500, margin: "4px 0 12px" }}>Bell schedule · {day.name}</div>
              {day.blocks.map((b) => (
                <div key={b.name + b.start} style={{ display: "flex", padding: "8px 10px", marginBottom: 6, background: "#e8f0fe", borderRadius: 8, borderLeft: "4px solid #1a73e8", fontSize: 13 }}>
                  <span style={{ flex: 1, fontWeight: 500 }}>{b.name}</span>
                  <span style={{ color: "var(--text2)" }}>
                    {b.start} – {b.end}
                  </span>
                </div>
              ))}
              <a href="https://ion.tjhsst.edu/schedule" target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>
                Open in Ion
              </a>
            </>
          )}
        </div>
      )}
    </>
  );
}

function KeepPanel({ onClose }: { onClose: () => void }) {
  const [notes, setNotes] = useState<{ id: number; title: string; body: string }[] | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api<{ notes: NonNullable<typeof notes> }>("/api/notes").then((r) => setNotes(r.notes)), []);
  useEffect(() => {
    load().catch(() => setNotes([]));
  }, [load]);
  const add = async () => {
    if (draft.title.trim() || draft.body.trim()) await api("/api/notes", { body: draft });
    setDraft({ title: "", body: "" });
    setOpen(false);
    load();
  };
  return (
    <>
      <Hdr kicker="Keep" title={notes ? "Notes" : "Loading..."} onClose={onClose} />
      {!notes ? (
        <Loading kind="keep" />
      ) : (
        <div className="sp-body">
          <div style={{ border: "1px solid #dadce0", borderRadius: 8, padding: "8px 12px", boxShadow: open ? "0 1px 3px rgba(60,64,67,.3)" : undefined }}>
            {open && <input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ border: "none", outline: "none", width: "100%", fontWeight: 500, fontSize: 14, marginBottom: 6 }} />}
            <textarea placeholder="Take a note…" value={draft.body} onFocus={() => setOpen(true)} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={open ? 3 : 1} style={{ border: "none", outline: "none", width: "100%", resize: "none", fontSize: 14, fontFamily: "inherit" }} />
            {open && (
              <div style={{ textAlign: "right" }}>
                <button className="btn text" onClick={add}>
                  Close
                </button>
              </div>
            )}
          </div>
          {notes.map((n) => (
            <div key={n.id} style={{ border: "1px solid #e0e0e0", borderRadius: 8, padding: 12, marginTop: 10, position: "relative" }}>
              {n.title && <div style={{ fontWeight: 500, marginBottom: 4 }}>{n.title}</div>}
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{n.body}</div>
              <button className="icon-btn sm" style={{ position: "absolute", right: 4, top: 4 }} aria-label="Delete note" onClick={() => api("/api/notes", { method: "DELETE", body: { id: n.id } }).then(load)}>
                <Icon name="delete" size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TasksPanel({ onClose }: { onClose: () => void }) {
  const [tasks, setTasks] = useState<{ id: number; title: string; done: number }[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const load = useCallback(() => api<{ tasks: NonNullable<typeof tasks> }>("/api/tasks").then((r) => setTasks(r.tasks)), []);
  useEffect(() => {
    load().catch(() => setTasks([]));
  }, [load]);
  const add = async () => {
    if (title.trim()) await api("/api/tasks", { body: { title } });
    setTitle("");
    setAdding(false);
    load();
  };
  return (
    <>
      <Hdr
        kicker="Tasks"
        title={
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            My Tasks <Icon name="dropDown" size={20} />
          </span>
        }
        onClose={onClose}
        extra={
          <button className="icon-btn" aria-label="Open in new tab" data-tip="Open in new tab">
            <Icon name="openNew" size={20} />
          </button>
        }
      />
      <div className="sp-body" style={{ padding: "0 8px 16px" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <button className="btn text" style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 8 }} onClick={() => setAdding(true)}>
            <Icon name="addTask" size={20} /> Add a task
          </button>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" aria-label="Task options">
            <Icon name="more" size={20} />
          </button>
        </div>
        {adding && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px" }}>
            <span style={{ width: 18, height: 18, border: "2px solid #5f6368", borderRadius: "50%" }} />
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} onBlur={add} placeholder="Title" style={{ flex: 1, border: "none", borderBottom: "2px solid #0b57d0", outline: "none", fontSize: 14, padding: "4px 0" }} />
          </div>
        )}
        {tasks && tasks.length === 0 && !adding && (
          <div style={{ textAlign: "center", marginTop: 60 }}>
            <svg width="180" height="140" viewBox="0 0 180 140" aria-hidden="true">
              <circle cx="58" cy="40" r="14" fill="#fce8e6" stroke="#f28b82" />
              <path d="M51 40l5 5 9-9" stroke="#ea4335" strokeWidth="2" fill="none" />
              <rect x="80" y="30" width="60" height="18" rx="9" fill="#ceead6" />
              <path d="M40 120 C70 60 90 60 110 110 L140 80" stroke="#1a73e8" strokeWidth="2" fill="#d2e3fc" />
              <circle cx="45" cy="88" r="10" fill="#fbbc04" />
            </svg>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 16, marginTop: 18 }}>No tasks yet</div>
            <div style={{ fontSize: 13, color: "var(--text2)", margin: "10px 24px", lineHeight: "20px" }}>Add your to-dos and keep track of them in TJ Mail</div>
          </div>
        )}
        {tasks?.map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px" }}>
            <button
              aria-label={t.done ? "Mark incomplete" : "Mark complete"}
              onClick={() => api("/api/tasks", { method: "PATCH", body: { id: t.id, done: !t.done } }).then(load)}
              style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid #5f6368", background: t.done ? "#0b57d0" : "transparent", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}
            >
              {t.done ? <Icon name="check" size={14} /> : null}
            </button>
            <span style={{ flex: 1, textDecoration: t.done ? "line-through" : undefined, color: t.done ? "var(--text3)" : undefined }}>{t.title}</span>
            <button className="icon-btn sm" aria-label="Delete task" onClick={() => api("/api/tasks", { method: "DELETE", body: { id: t.id } }).then(load)}>
              <Icon name="delete" size={18} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function ContactsPanel({ onClose }: { onClose: () => void }) {
  const { compose, snack } = useApp();
  const [contacts, setContacts] = useState<{ id: number; name: string; email: string }[] | null>(null);
  const [q, setQ] = useState("");
  const [dir, setDir] = useState<{ name: string; email: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [nc, setNc] = useState({ name: "", email: "" });
  const load = useCallback(() => api<{ contacts: NonNullable<typeof contacts> }>("/api/contacts").then((r) => setContacts(r.contacts)), []);
  useEffect(() => {
    load().catch(() => setContacts([]));
  }, [load]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setDir([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ directory: { name: string; email: string }[] }>(`/api/contacts?q=${encodeURIComponent(q)}`)
        .then((r) => setDir(r.directory))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const shown = (contacts ?? []).filter((c) => !q || (c.name + c.email).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Hdr kicker="Contacts" title={contacts ? "Contacts" : "Loading..."} onClose={onClose} />
      {!contacts ? (
        <Loading kind="contacts" />
      ) : (
        <div className="sp-body">
          <input placeholder="Search contacts and directory" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", height: 36, border: "1px solid #dadce0", borderRadius: 18, padding: "0 14px", fontSize: 14, outline: "none", marginBottom: 10 }} />
          <button className="btn text" style={{ paddingLeft: 4, marginBottom: 6 }} onClick={() => setAdding((a) => !a)}>
            + Create contact
          </button>
          {adding && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              <input className="textfield" placeholder="Name" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} />
              <input className="textfield" placeholder="Email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} />
              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    await api("/api/contacts", { body: nc });
                    setNc({ name: "", email: "" });
                    setAdding(false);
                    load();
                  } catch (e) {
                    snack((e as Error).message);
                  }
                }}
              >
                Save
              </button>
            </div>
          )}
          {shown.map((c) => (
            <ContactRow key={c.id} name={c.name} email={c.email} onMail={() => compose({ to: c.name ? `${c.name} <${c.email}>` : c.email })} onDelete={() => api("/api/contacts", { method: "DELETE", body: { id: c.id } }).then(load)} />
          ))}
          {dir.length > 0 && <div className="sp-kicker" style={{ margin: "12px 0 6px" }}>Directory</div>}
          {dir.map((c) => (
            <ContactRow key={c.email} name={c.name} email={c.email} onMail={() => compose({ to: c.name ? `${c.name} <${c.email}>` : c.email })} />
          ))}
          {!shown.length && !dir.length && <div style={{ color: "var(--text2)", fontSize: 13, marginTop: 20, textAlign: "center" }}>{q ? "No matches." : "No saved contacts yet."}</div>}
        </div>
      )}
    </>
  );
}

function ContactRow({ name, email, onMail, onDelete }: { name: string; email: string; onMail: () => void; onDelete?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
      <span className="avatar" style={{ width: 32, height: 32, fontSize: 14, background: "#1a73e8" }}>
        {(name || email).charAt(0).toUpperCase()}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || email}</div>
        <div style={{ fontSize: 12, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</div>
      </div>
      <button className="icon-btn sm" aria-label={`Email ${email}`} data-tip="Send email" onClick={onMail}>
        <Icon name="send" size={18} />
      </button>
      {onDelete && (
        <button className="icon-btn sm" aria-label="Delete contact" data-tip="Delete" onClick={onDelete}>
          <Icon name="delete" size={18} />
        </button>
      )}
    </div>
  );
}
