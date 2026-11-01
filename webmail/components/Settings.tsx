"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, Prefs } from "./App";
import { Icon } from "./icons";
import { api } from "@/lib/client/api";
import { Footer } from "./MailList";
import { Dialog, PromptDialog } from "./ui";
import type { Folder } from "@/lib/types";

const TABS: [string, string][] = [
  ["general", "General"],
  ["labels", "Labels"],
  ["inbox", "Inbox"],
  ["accounts", "Accounts and Import"],
  ["filters", "Filters and Blocked Addresses"],
  ["fwdandpop", "Forwarding and POP/IMAP"],
  ["addons", "Add-ons"],
  ["chat", "Chat and Meet"],
  ["advanced", "Advanced"],
  ["offline", "Offline"],
  ["themes", "Themes"],
];

type Filter = { id: string; from?: string; to?: string; subject?: string; has?: string; doesnt?: string; action: { move?: string; markRead?: boolean; star?: boolean; trash?: boolean; forward?: string; neverSpam?: boolean; important?: boolean } };
type SieveConfig = { filters: Filter[]; blocked: string[]; vacation: { enabled: boolean; subject: string; body: string; start?: string; end?: string; days: number }; forward: { enabled: boolean; address: string }; include: string | null };

export function Settings() {
  const { route, go } = useApp();
  const tab = route.settings || "general";
  return (
    <>
      <div className="settings-title" style={{ marginTop: 6 }}>
        <span>Settings</span>
        <button className="input-tools" style={{ marginRight: 0 }} data-tip="Input tools" aria-label="Input tools">
          <Icon name="keyboard" size={20} />
          <Icon name="dropDown" size={16} />
        </button>
      </div>
      <div className="settings-tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => go({ view: "settings", settings: k })}>
            {l}
          </button>
        ))}
      </div>
      <div className="scroll">
        <div className="settings-body">
          {tab === "general" && <General />}
          {tab === "labels" && <Labels />}
          {tab === "inbox" && <InboxTab />}
          {tab === "accounts" && <Accounts />}
          {tab === "filters" && <Filters />}
          {tab === "fwdandpop" && <Forwarding />}
          {tab === "addons" && <Addons />}
          {tab === "chat" && <Chat />}
          {tab === "advanced" && <Advanced />}
          {tab === "offline" && <Offline />}
          {tab === "themes" && <Themes />}
        </div>
        <Footer />
      </div>
    </>
  );
}

function useDraftPrefs() {
  const { prefs, savePrefs, snack } = useApp();
  const [d, setD] = useState<Prefs>(prefs);
  useEffect(() => setD(prefs), [prefs]);
  const changed = JSON.stringify(d) !== JSON.stringify(prefs);
  const save = async () => {
    await savePrefs(d);
    snack("Your preferences have been saved.");
  };
  return { d, setD, changed, save, reset: () => setD(prefs) };
}

function SaveRow({ changed, save, reset }: { changed: boolean; save: () => void; reset: () => void }) {
  return (
    <div className="save-row">
      <button className="gbtn" disabled={!changed} onClick={save}>
        Save Changes
      </button>
      <button className="gbtn" onClick={reset}>
        Cancel
      </button>
    </div>
  );
}

function Row({ label, children, sub }: { label: React.ReactNode; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="srow">
      <div className="sl">
        {label}
        {sub}
      </div>
      <div className="sv">{children}</div>
    </div>
  );
}

const LM = <span className="lm" style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => window.open("https://guides.tjhsst.edu", "_blank", "noopener")}>Learn more</span>;

function Radio({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="opt">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

function General() {
  const { d, setD, changed, save, reset } = useDraftPrefs();
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setD({ ...d, [k]: v });
  const sigRef = useRef<HTMLDivElement>(null);
  const [vac, setVac] = useState<SieveConfig | null>(null);
  const [vacErr, setVacErr] = useState("");
  const { snack } = useApp();
  useEffect(() => {
    api<{ config: SieveConfig }>("/api/filters")
      .then((r) => setVac(r.config))
      .catch((e) => setVacErr((e as Error).message));
  }, []);
  useEffect(() => {
    if (sigRef.current && sigRef.current.innerHTML !== d.signature) sigRef.current.innerHTML = d.signature;
  }, []);
  const saveAll = async () => {
    await save();
    if (vac) {
      try {
        await api("/api/filters", { method: "PUT", body: { config: vac } });
      } catch (e) {
        snack(`Vacation responder: ${(e as Error).message}`);
      }
    }
  };
  return (
    <>
      <Row label="Language:">
        <div>
          <b>TJ Mail display language:</b>{" "}
          <select style={{ width: 260 }} defaultValue="en">
            <option value="en">English (US)</option>
          </select>
        </div>
        <label className="opt" style={{ marginTop: 18 }}>
          <input type="checkbox" defaultChecked /> <span><b>Enable input tools</b> - Use various text input tools to type in the language of your choice</span>
        </label>
        <div style={{ marginTop: 16 }}>
          <Radio name="rtl" checked onChange={() => {}}>
            <b>Right-to-left editing support off</b>
          </Radio>
          <Radio name="rtl" checked={false} onChange={() => {}}>
            <b>Right-to-left editing support on</b>
          </Radio>
        </div>
      </Row>
      <Row label="Maximum page size:">
        <b>Show</b>{" "}
        <select value={d.pageSize} onChange={(e) => set("pageSize", Number(e.target.value))}>
          {[10, 15, 20, 25, 50, 100].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>{" "}
        <b>conversations per page</b>
      </Row>
      <Row label="Undo Send:">
        <b>Send cancellation period:</b>{" "}
        <select value={d.undoSeconds} onChange={(e) => set("undoSeconds", Number(e.target.value))}>
          {[5, 10, 20, 30].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>{" "}
        <b>seconds</b>
      </Row>
      <Row label="Default reply behavior:" sub={LM}>
        <Radio name="reply" checked={!d.replyAll} onChange={() => set("replyAll", false)}>
          Reply
        </Radio>
        <Radio name="reply" checked={d.replyAll} onChange={() => set("replyAll", true)}>
          Reply all
        </Radio>
      </Row>
      <Row label="Hover actions:">
        <Radio name="hover" checked={d.hoverActions} onChange={() => set("hoverActions", true)}>
          <b>Enable hover actions</b> - Quickly gain access to archive, delete, mark as read, and snooze controls on hover.
        </Radio>
        <Radio name="hover" checked={!d.hoverActions} onChange={() => set("hoverActions", false)}>
          <b>Disable hover actions</b>
        </Radio>
      </Row>
      <Row label="Send and Archive:" sub={LM}>
        <Radio name="sa" checked={d.sendAndArchive} onChange={() => set("sendAndArchive", true)}>
          <b>Show &quot;Send &amp; Archive&quot; button in reply</b>
        </Radio>
        <Radio name="sa" checked={!d.sendAndArchive} onChange={() => set("sendAndArchive", false)}>
          <b>Hide &quot;Send &amp; Archive&quot; button in reply</b>
        </Radio>
      </Row>
      <Row
        label="Default text style:"
        sub={
          <div className="note">
            (Use the &apos;Remove formatting&apos; button on the toolbar to reset the default text style)
          </div>
        }
      >
        <div style={{ boxShadow: "0 1px 2px rgba(60,64,67,.3), 0 1px 3px 1px rgba(60,64,67,.15)", borderRadius: 4, width: 410, padding: 4 }}>
          <div className="fmt-bar" style={{ margin: 0 }}>
            <select className="font-sel" value={d.fontFamily} onChange={(e) => set("fontFamily", e.target.value)}>
              <option value="sans-serif">Sans Serif</option>
              <option value="serif">Serif</option>
              <option value="monospace">Fixed Width</option>
            </select>
            <span className="sep" />
            <select className="font-sel" value={d.fontSize} onChange={(e) => set("fontSize", e.target.value)}>
              <option value="small">Small</option>
              <option value="normal">Normal</option>
              <option value="large">Large</option>
              <option value="huge">Huge</option>
            </select>
            <span className="sep" />
            <button className="icon-btn" aria-label="Remove formatting" onClick={() => setD({ ...d, fontFamily: "sans-serif", fontSize: "small" })}>
              <Icon name="clearFormat" size={18} />
            </button>
          </div>
          <div style={{ padding: "8px 6px", fontFamily: d.fontFamily === "serif" ? "Georgia,serif" : d.fontFamily === "monospace" ? "monospace" : "Arial,sans-serif", fontSize: { small: 13, normal: 14, large: 18, huge: 26 }[d.fontSize] ?? 13 }}>This is what your body text will look like.</div>
        </div>
      </Row>
      <Row label="Images:">
        <Radio name="img" checked={d.externalImages} onChange={() => set("externalImages", true)}>
          <b>Always display external images</b> - images are loaded through the TJ Mail proxy, so senders can&apos;t see your IP address.
        </Radio>
        <Radio name="img" checked={!d.externalImages} onChange={() => set("externalImages", false)}>
          <b>Ask before displaying external images</b>
        </Radio>
      </Row>
      <Row label="Keyboard shortcuts:" sub={LM}>
        <Radio name="ks" checked={!d.shortcuts} onChange={() => set("shortcuts", false)}>
          <b>Keyboard shortcuts off</b>
        </Radio>
        <Radio name="ks" checked={d.shortcuts} onChange={() => set("shortcuts", true)}>
          <b>Keyboard shortcuts on</b> - c compose, / search, j/k navigate, e archive, # delete, r reply, a reply all, f forward
        </Radio>
      </Row>
      <Row label="My name:" sub={<div className="note">Shown to people you email.</div>}>
        <input className="textfield" style={{ width: 300 }} value={d.displayName} placeholder="Name from Ion" onChange={(e) => set("displayName", e.target.value)} />
      </Row>
      <Row label="Signature:" sub={<div className="note">(appended at the end of all outgoing messages)</div>}>
        <div ref={sigRef} className="sig-editor" contentEditable suppressContentEditableWarning onInput={(e) => set("signature", (e.target as HTMLDivElement).innerHTML)} />
      </Row>
      <Row label="Vacation responder:" sub={<div className="note">(sends an automated reply to incoming messages)</div>}>
        {vacErr && <div style={{ color: "#c5221f" }}>Couldn&apos;t load mail filter settings: {vacErr}</div>}
        {vac && (
          <>
            <Radio name="vac" checked={!vac.vacation.enabled} onChange={() => setVac({ ...vac, vacation: { ...vac.vacation, enabled: false } })}>
              Vacation responder off
            </Radio>
            <Radio name="vac" checked={vac.vacation.enabled} onChange={() => setVac({ ...vac, vacation: { ...vac.vacation, enabled: true } })}>
              Vacation responder on
            </Radio>
            <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8, marginTop: 10, maxWidth: 620, alignItems: "center" }}>
              <span>First day:</span>
              <input className="textfield" type="date" value={vac.vacation.start || ""} onChange={(e) => setVac({ ...vac, vacation: { ...vac.vacation, start: e.target.value } })} style={{ width: 180 }} />
              <span>Last day:</span>
              <input className="textfield" type="date" value={vac.vacation.end || ""} onChange={(e) => setVac({ ...vac, vacation: { ...vac.vacation, end: e.target.value } })} style={{ width: 180 }} />
              <span>Subject:</span>
              <input className="textfield" value={vac.vacation.subject} onChange={(e) => setVac({ ...vac, vacation: { ...vac.vacation, subject: e.target.value } })} />
              <span style={{ alignSelf: "start" }}>Message:</span>
              <textarea value={vac.vacation.body} onChange={(e) => setVac({ ...vac, vacation: { ...vac.vacation, body: e.target.value } })} rows={6} style={{ border: "1px solid #ccc", fontSize: 13, padding: 6 }} />
            </div>
          </>
        )}
      </Row>
      <SaveRow changed={changed || !!vac} save={saveAll} reset={reset} />
    </>
  );
}

function Labels() {
  const { prefs, savePrefs, folders, reloadFolders, snack } = useApp();
  const [newLabel, setNewLabel] = useState(false);
  const [edit, setEdit] = useState<Folder | null>(null);
  const [remove, setRemove] = useState<Folder | null>(null);
  const hidden = new Set(prefs.hiddenLabels);
  const toggle = (k: string, hide: boolean) => savePrefs({ hiddenLabels: hide ? [...prefs.hiddenLabels.filter((x) => x !== k), k] : prefs.hiddenLabels.filter((x) => x !== k) });
  const ShowHide = ({ k, unread }: { k: string; unread?: boolean }) => {
    const h = hidden.has(k);
    return (
      <>
        {h ? <button className="lk" onClick={() => toggle(k, false)}>show</button> : <span className="bold">show</span>}
        {h ? <span className="bold">hide</span> : <button className="lk" onClick={() => toggle(k, true)}>hide</button>}
        {unread && <button className="lk">show if unread</button>}
      </>
    );
  };
  const sys: [string, string, boolean?][] = [
    ["Inbox", ""],
    ["Starred", "sys:starred"],
    ["Snoozed", "sys:snoozed"],
    ["Important", "sys:imp"],
    ["Sent", "sys:sent"],
    ["Scheduled", "sys:scheduled", true],
    ["Drafts", "sys:drafts", true],
    ["All Mail", "sys:all"],
    ["Spam", "sys:spam", true],
    ["Trash", "sys:trash"],
  ];
  const labels = folders.filter((f) => f.role === "label" || f.role === "archive");
  return (
    <>
      <table className="lab-table">
        <thead>
          <tr>
            <th style={{ borderTop: "none", width: 160 }}>System labels</th>
            <th style={{ borderTop: "none" }}>Show in label list</th>
            <th style={{ borderTop: "none" }} />
            <th style={{ borderTop: "none" }} />
          </tr>
        </thead>
        <tbody>
          {sys.map(([l, k, u]) => (
            <tr key={l}>
              <td>{l}</td>
              <td>{k && <ShowHide k={k} unread={u} />}</td>
              <td />
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <label className="opt" style={{ justifyContent: "flex-end" }}>
                  <input type="checkbox" checked readOnly disabled={l === "Inbox"} /> Show in IMAP
                </label>
              </td>
            </tr>
          ))}
          <tr>
            <th>Categories</th>
            <th>Show in label list</th>
            <th>Show in message list</th>
            <th />
          </tr>
          {[
            ["Purchases", "sys:purchases"],
            ["Social", "cat:social"],
            ["Updates", "cat:updates"],
            ["Forums", "cat:forums"],
            ["Promotions", "cat:promotions"],
          ].map(([l, k]) => (
            <tr key={l}>
              <td>{l}</td>
              <td>
                <ShowHide k={k} />
              </td>
              <td>{l !== "Purchases" && <ShowHide k={k + ":list"} />}</td>
              <td />
            </tr>
          ))}
          <tr>
            <th>Labels</th>
            <th>Show in label list</th>
            <th>Show in message list</th>
            <th>Actions</th>
          </tr>
          <tr>
            <td colSpan={4}>
              <button className="gbtn" onClick={() => setNewLabel(true)}>
                Create new label
              </button>
            </td>
          </tr>
          {labels.map((f) => (
            <tr key={f.path}>
              <td>
                {f.path}
                {f.total ? <span style={{ color: "var(--text3)" }}> ({f.total} messages)</span> : null}
              </td>
              <td>
                <ShowHide k={f.path} />
              </td>
              <td>
                <span className="bold">show</span>
              </td>
              <td>
                {f.role === "label" && (
                  <>
                    <button className="lk" onClick={() => setRemove(f)}>
                      remove
                    </button>
                    <button className="lk" onClick={() => setEdit(f)}>
                      edit
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: "16px 8px", color: "var(--text3)", fontSize: 13 }}>Note: on the TJHSST mail servers, labels are IMAP folders. A message can be in several labels by copying it (Label as), or moved between them (Move to).</div>
      {newLabel && (
        <PromptDialog
          title="New label"
          label="Please enter a new label name:"
          onClose={() => setNewLabel(false)}
          onOk={async (name) => {
            try {
              await api("/api/folders", { body: { name } });
              reloadFolders(true);
            } catch (e) {
              snack((e as Error).message);
            }
            setNewLabel(false);
          }}
        />
      )}
      {edit && (
        <PromptDialog
          title="Edit label"
          label="Label name:"
          initial={edit.name}
          okLabel="Save"
          onClose={() => setEdit(null)}
          onOk={async (name) => {
            try {
              await api("/api/folders", { method: "PATCH", body: { path: edit.path, name } });
              reloadFolders(true);
            } catch (e) {
              snack((e as Error).message);
            }
            setEdit(null);
          }}
        />
      )}
      {remove && (
        <Dialog
          title="Remove label"
          onClose={() => setRemove(null)}
          actions={
            <>
              <button className="btn text" onClick={() => setRemove(null)}>
                Cancel
              </button>
              <button
                className="btn text"
                onClick={async () => {
                  try {
                    await api("/api/folders", { method: "DELETE", body: { path: remove.path } });
                    reloadFolders(true);
                  } catch (e) {
                    snack((e as Error).message);
                  }
                  setRemove(null);
                }}
              >
                Delete
              </button>
            </>
          }
        >
          Delete the label &quot;{remove.name}&quot; and the {remove.total} messages in it?
        </Dialog>
      )}
    </>
  );
}

function InboxTab() {
  const { d, setD, changed, save, reset } = useDraftPrefs();
  const cat = (k: keyof Prefs["categories"]) => (
    <label className="opt">
      <input type="checkbox" checked={d.categories[k]} onChange={(e) => setD({ ...d, categories: { ...d.categories, [k]: e.target.checked } })} />
      <b>{k.charAt(0).toUpperCase() + k.slice(1)}</b>
    </label>
  );
  return (
    <>
      <Row label="Inbox type:">
        <select style={{ width: 140 }} defaultValue="default">
          <option value="default">Default</option>
        </select>
      </Row>
      <Row label="Categories:" sub={LM}>
        <label className="opt">
          <input type="checkbox" checked disabled /> <b className="muted">Primary</b>
        </label>
        {cat("promotions")}
        {cat("social")}
        {cat("updates")}
        {cat("forums")}
        <div style={{ marginTop: 14, fontWeight: 700 }}>Starred messages</div>
        <label className="opt">
          <input type="checkbox" checked={d.starredInPrimary} onChange={(e) => setD({ ...d, starredInPrimary: e.target.checked })} />
          <b>Include starred in Primary</b>
        </label>
        <div style={{ marginTop: 14, display: "flex", gap: 24, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: "8px 0" }}>Choose which message categories to show as inbox tabs. Other messages will appear in the Primary tab.</p>
            <p style={{ margin: "8px 0" }}>Deselect all categories to go back to your old inbox.</p>
            <p style={{ margin: "8px 0", color: "var(--text3)", fontSize: 13 }}>Categories are assigned from message headers (mailing-list and bulk-mail markers, social network senders); message contents are not scanned.</p>
          </div>
          <svg width="346" height="140" viewBox="0 0 346 140" aria-hidden="true">
            <rect x="0.5" y="0.5" width="345" height="139" fill="#fff" stroke="#dadce0" />
            <rect x="0.5" y="0.5" width="120" height="28" fill="#fff" stroke="#dadce0" />
            <rect x="120.5" y="0.5" width="120" height="28" fill="#fff" stroke="#dadce0" />
            {[44, 66, 88, 110].map((y, i) => (
              <g key={y}>
                <rect x="1" y={y - 10} width="344" height="22" fill={i === 1 ? "#ebebeb" : "#fff"} />
                <circle cx="14" cy={y} r="3.5" fill="none" stroke="#bbb" />
                <circle cx="26" cy={y} r="1.5" fill="#bbb" />
              </g>
            ))}
            <path d="M175 18 q-5 40 -40 45" fill="none" stroke="#666" strokeWidth="1.5" />
          </svg>
        </div>
      </Row>
      <Row label="Reading pane:">
        <label className="opt">
          <input type="checkbox" checked={d.readingPane} onChange={(e) => setD({ ...d, readingPane: e.target.checked })} />
          <span>
            <b>Show reading pane</b> - provides a way to read mail right next to your list of conversations, making mail reading and writing mail faster and adding more context.
          </span>
        </label>
      </Row>
      <SaveRow changed={changed} save={save} reset={reset} />
    </>
  );
}

function Accounts() {
  const { me, prefs, savePrefs, snack } = useApp();
  const [editName, setEditName] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const doImport = async (f: File) => {
    setImporting(true);
    try {
      const text = await f.text();
      const contacts: { name: string; email: string }[] = [];
      if (/BEGIN:VCARD/i.test(text)) {
        for (const card of text.split(/END:VCARD/i)) {
          const fn = /^FN[^:]*:(.*)$/im.exec(card)?.[1]?.trim() ?? "";
          for (const m of card.matchAll(/^EMAIL[^:]*:(.*)$/gim)) contacts.push({ name: fn, email: m[1].trim() });
        }
      } else {
        const rows = text.split(/\r?\n/);
        const hdr = rows.shift()?.toLowerCase().split(",") ?? [];
        const ei = hdr.findIndex((h) => h.includes("mail"));
        const ni = hdr.findIndex((h) => h.includes("name"));
        for (const r of rows) {
          const cols = r.split(",");
          if (cols[ei]) contacts.push({ name: (cols[ni] || "").replace(/"/g, ""), email: cols[ei].replace(/"/g, "").trim() });
        }
      }
      let ok = 0;
      for (const c of contacts.slice(0, 2000)) {
        try {
          await api("/api/contacts", { body: c });
          ok++;
        } catch {
        }
      }
      snack(`Imported ${ok} contact${ok === 1 ? "" : "s"}.`);
    } finally {
      setImporting(false);
    }
  };
  return (
    <>
      <Row label="Change account settings:">
        <a href="https://password.tjhsst.edu" target="_blank" rel="noopener noreferrer">
          Change password
        </a>
        <br />
        <a href="https://2fa.tjhsst.edu" target="_blank" rel="noopener noreferrer">
          Two-factor authentication
        </a>
        <br />
        <a href="https://ion.tjhsst.edu/preferences" target="_blank" rel="noopener noreferrer">
          Other Ion account settings
        </a>
      </Row>
      <Row label="Import mail and contacts:" sub={LM}>
        Import contacts from Roundcube or another mail client (vCard .vcf or .csv).
        <br />
        <button className="link-btn" style={{ fontWeight: 700, fontFamily: "inherit" }} onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? "Importing…" : "Import contacts"}
        </button>
        <input ref={fileRef} type="file" hidden accept=".vcf,.csv,text/vcard,text/csv" onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
      </Row>
      <Row label="Send mail as:" sub={<><div className="note">(The TJHSST mail server only accepts addresses that belong to your account.)</div>{LM}</>}>
        {me.identities.map((i) => (
          <div key={i.address} style={{ display: "flex", justifyContent: "space-between", maxWidth: 560 }}>
            <b>
              {prefs.displayName || i.name} &lt;{i.address}&gt;
            </b>
            <button className="link-btn" style={{ fontWeight: 400, fontFamily: "inherit" }} onClick={() => setEditName(true)}>
              edit info
            </button>
          </div>
        ))}
      </Row>
      <Row label="Check mail from other accounts:" sub={LM}>
        <span className="muted">Not available on the TJHSST mail servers.</span>
      </Row>
      <Row label="Mail client settings:" sub={<div className="note">(For Thunderbird, Apple Mail, phones)</div>}>
        IMAP: <b>imap.tjhsst.edu</b>, port 993, SSL/TLS
        <br />
        SMTP: <b>smtp.tjhsst.edu</b>, port 465 (SSL/TLS) or 587 (STARTTLS)
        <br />
        Username: <b>{me.username}</b>
      </Row>
      <Row label="Storage:">
        {me.quota ? (
          <>
            You are currently using {Math.round((me.quota.used / me.quota.limit) * 100)}% of your {Math.round(me.quota.limit / 1024 / 1024 / 1024) || "<1"} GB.
          </>
        ) : (
          "No storage limit reported by the mail server."
        )}
      </Row>
      {editName && (
        <PromptDialog
          title="Edit email address"
          label="Name:"
          initial={prefs.displayName || me.displayName}
          okLabel="Save Changes"
          onClose={() => setEditName(false)}
          onOk={async (v) => {
            await savePrefs({ displayName: v });
            setEditName(false);
          }}
        />
      )}
    </>
  );
}

function useSieve() {
  const { snack } = useApp();
  const [cfg, setCfg] = useState<SieveConfig | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<{ config: SieveConfig }>("/api/filters")
      .then((r) => setCfg(r.config))
      .catch((e) => setErr((e as Error).message));
  }, []);
  const save = async (next: SieveConfig) => {
    try {
      const r = await api<{ config: SieveConfig }>("/api/filters", { method: "PUT", body: { config: next } });
      setCfg(r.config);
      snack("Your preferences have been saved.");
    } catch (e) {
      snack((e as Error).message);
    }
  };
  return { cfg, setCfg, err, save };
}

function describe(f: Filter, folders: Folder[]) {
  const m = [f.from && `from:(${f.from})`, f.to && `to:(${f.to})`, f.subject && `subject:(${f.subject})`, f.has && f.has, f.doesnt && `-{${f.doesnt}}`].filter(Boolean).join(" ");
  const a = [
    f.action.markRead && "Mark as read",
    f.action.star && "Star it",
    f.action.important && "Mark as important",
    f.action.move && `Apply label "${folders.find((x) => x.path === f.action.move)?.name ?? f.action.move}"`,
    f.action.trash && "Delete it",
    f.action.forward && `Forward to ${f.action.forward}`,
    f.action.neverSpam && "Never send it to Spam",
  ]
    .filter(Boolean)
    .join(", ");
  return { m, a };
}

function Filters() {
  const { folders } = useApp();
  const { cfg, err, save } = useSieve();
  const [selF, setSelF] = useState<Set<string>>(new Set());
  const [selB, setSelB] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Filter | null>(null);
  useEffect(() => {
    const pending = sessionStorage.getItem("webmail:newFilter");
    if (pending) {
      sessionStorage.removeItem("webmail:newFilter");
      try {
        setEditing({ id: String(Date.now()), action: {}, ...JSON.parse(pending) });
      } catch {
      }
    }
  }, []);
  if (err) return <div style={{ padding: 16 }}>Couldn&apos;t load filters from the mail server: {err}</div>;
  if (!cfg) return <div style={{ padding: 16 }}>Loading…</div>;
  return (
    <>
      <div style={{ fontWeight: 700, padding: "12px 0 6px", borderBottom: "1px solid #e0e0e0" }}>The following filters are applied to all incoming mail:</div>
      {cfg.include && <div style={{ padding: "8px 0", color: "var(--text3)", fontSize: 13 }}>Filters from your previous webmail (&quot;{cfg.include}&quot;) are still applied after these.</div>}
      {cfg.filters.map((f) => {
        const d = describe(f, folders);
        return (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f1f3f4" }}>
            <input type="checkbox" checked={selF.has(f.id)} onChange={(e) => setSelF((s) => (e.target.checked ? new Set([...s, f.id]) : new Set([...s].filter((x) => x !== f.id))))} />
            <div style={{ flex: 1 }}>
              <b>Matches:</b> {d.m}
              <br />
              <b>Do this:</b> {d.a}
            </div>
            <button className="link-btn" style={{ fontWeight: 400 }} onClick={() => setEditing(f)}>
              edit
            </button>
            <button className="link-btn" style={{ fontWeight: 400 }} onClick={() => save({ ...cfg, filters: cfg.filters.filter((x) => x.id !== f.id) })}>
              delete
            </button>
          </div>
        );
      })}
      <div style={{ padding: "6px 0" }}>
        Select:{" "}
        <button className="link-btn" style={{ fontWeight: 400, fontFamily: "inherit" }} onClick={() => setSelF(new Set(cfg.filters.map((f) => f.id)))}>
          All
        </button>
        ,{" "}
        <button className="link-btn" style={{ fontWeight: 400, fontFamily: "inherit" }} onClick={() => setSelF(new Set())}>
          None
        </button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="gbtn"
          disabled={!selF.size}
          onClick={() => {
            const blob = new Blob([JSON.stringify(cfg.filters.filter((f) => selF.has(f.id)), null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "mailFilters.json";
            a.click();
          }}
        >
          Export
        </button>
        <button className="gbtn" disabled={!selF.size} onClick={() => (save({ ...cfg, filters: cfg.filters.filter((f) => !selF.has(f.id)) }), setSelF(new Set()))}>
          Delete
        </button>
      </div>
      <div style={{ textAlign: "center", padding: "8px 0 14px", borderBottom: "1px solid #e0e0e0", display: "flex", justifyContent: "center", gap: 24 }}>
        <button className="link-btn" style={{ fontWeight: 400, fontFamily: "inherit" }} onClick={() => setEditing({ id: String(Date.now()), action: {} })}>
          Create a new filter
        </button>
        <label className="link-btn" style={{ fontWeight: 400, fontFamily: "inherit" }}>
          Import filters
          <input
            type="file"
            hidden
            accept="application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const list = JSON.parse(await f.text()) as Filter[];
                save({ ...cfg, filters: [...cfg.filters, ...list.map((x, i) => ({ ...x, id: String(Date.now() + i) }))] });
              } catch {
              }
            }}
          />
        </label>
      </div>
      <div style={{ fontWeight: 700, padding: "12px 0 6px", borderBottom: "1px solid #e0e0e0" }}>The following email addresses are blocked. Messages from these addresses will appear in Spam:</div>
      {cfg.blocked.length === 0 ? (
        <div style={{ padding: "10px 0" }}>You currently have no blocked addresses.</div>
      ) : (
        cfg.blocked.map((b) => (
          <label key={b} className="opt" style={{ padding: "6px 0" }}>
            <input type="checkbox" checked={selB.has(b)} onChange={(e) => setSelB((s) => (e.target.checked ? new Set([...s, b]) : new Set([...s].filter((x) => x !== b))))} />
            {b}
          </label>
        ))
      )}
      <div style={{ padding: "6px 0" }}>
        Select:{" "}
        <button className="link-btn" style={{ fontWeight: 400, fontFamily: "inherit" }} onClick={() => setSelB(new Set(cfg.blocked))}>
          All
        </button>
        ,{" "}
        <button className="link-btn" style={{ fontWeight: 400, fontFamily: "inherit" }} onClick={() => setSelB(new Set())}>
          None
        </button>
      </div>
      <button className="gbtn" disabled={!selB.size} onClick={() => (save({ ...cfg, blocked: cfg.blocked.filter((b) => !selB.has(b)) }), setSelB(new Set()))}>
        Unblock selected addresses
      </button>
      {editing && (
        <FilterDialog
          filter={editing}
          folders={folders}
          onClose={() => setEditing(null)}
          onSave={(f) => {
            const exists = cfg.filters.some((x) => x.id === f.id);
            save({ ...cfg, filters: exists ? cfg.filters.map((x) => (x.id === f.id ? f : x)) : [...cfg.filters, f] });
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function FilterDialog({ filter, folders, onClose, onSave }: { filter: Filter; folders: Folder[]; onClose: () => void; onSave: (f: Filter) => void }) {
  const [f, setF] = useState<Filter>(filter);
  const set = (k: keyof Filter) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const act = (k: keyof Filter["action"], v: unknown) => setF({ ...f, action: { ...f.action, [k]: v } });
  const valid = !!(f.from || f.to || f.subject || f.has || f.doesnt) && Object.values(f.action).some(Boolean);
  const labels = useMemo(() => folders.filter((x) => x.role === "label" || x.role === "archive" || x.role === "inbox"), [folders]);
  return (
    <Dialog
      title="Create filter"
      onClose={onClose}
      actions={
        <>
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave(f)}>
            Create filter
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center", minWidth: "min(480px, 100%)" }}>
        <span>From</span>
        <input className="field" value={f.from || ""} onChange={set("from")} />
        <span>To</span>
        <input className="field" value={f.to || ""} onChange={set("to")} />
        <span>Subject</span>
        <input className="field" value={f.subject || ""} onChange={set("subject")} />
        <span>Has the words</span>
        <input className="field" value={f.has || ""} onChange={set("has")} />
        <span>Doesn&apos;t have</span>
        <input className="field" value={f.doesnt || ""} onChange={set("doesnt")} />
      </div>
      <div style={{ marginTop: 16, fontWeight: 500 }}>When a message is an exact match for your search criteria:</div>
      <label className="opt">
        <input type="checkbox" checked={!!f.action.markRead} onChange={(e) => act("markRead", e.target.checked)} /> Mark as read
      </label>
      <label className="opt">
        <input type="checkbox" checked={!!f.action.star} onChange={(e) => act("star", e.target.checked)} /> Star it
      </label>
      <label className="opt">
        <input type="checkbox" checked={!!f.action.move} onChange={(e) => act("move", e.target.checked ? labels.find((x) => x.role !== "inbox")?.path ?? "" : undefined)} /> Apply the label (move to):
        <select value={f.action.move || ""} onChange={(e) => act("move", e.target.value || undefined)} style={{ marginLeft: 6 }}>
          <option value="">Choose label…</option>
          {labels
            .filter((x) => x.role !== "inbox")
            .map((x) => (
              <option key={x.path} value={x.path}>
                {x.name}
              </option>
            ))}
        </select>
      </label>
      <label className="opt">
        <input type="checkbox" checked={!!f.action.forward} onChange={(e) => act("forward", e.target.checked ? " " : undefined)} /> Forward it to:
        <input className="textfield" value={(f.action.forward || "").trim()} onChange={(e) => act("forward", e.target.value)} style={{ marginLeft: 6, width: 220 }} />
      </label>
      <label className="opt">
        <input type="checkbox" checked={!!f.action.trash} onChange={(e) => act("trash", e.target.checked)} /> Delete it
      </label>
      <label className="opt">
        <input type="checkbox" checked={!!f.action.neverSpam} onChange={(e) => act("neverSpam", e.target.checked)} /> Never send it to Spam
      </label>
      <label className="opt">
        <input type="checkbox" checked={!!f.action.important} onChange={(e) => act("important", e.target.checked)} /> Always mark it as important
      </label>
    </Dialog>
  );
}

function Forwarding() {
  const { cfg, err, save } = useSieve();
  const [add, setAdd] = useState(false);
  const { go, me } = useApp();
  return (
    <>
      <Row label="Forwarding:" sub={LM}>
        {err && <div>Couldn&apos;t load settings: {err}</div>}
        {cfg && (
          <>
            {cfg.forward.address ? (
              <>
                <Radio name="fw" checked={!cfg.forward.enabled} onChange={() => save({ ...cfg, forward: { ...cfg.forward, enabled: false } })}>
                  Disable forwarding
                </Radio>
                <Radio name="fw" checked={cfg.forward.enabled} onChange={() => save({ ...cfg, forward: { ...cfg.forward, enabled: true } })}>
                  Forward a copy of incoming mail to <b>{cfg.forward.address}</b> and keep TJ Mail&apos;s copy in the Inbox
                </Radio>
                <button className="gbtn" style={{ marginTop: 8 }} onClick={() => save({ ...cfg, forward: { enabled: false, address: "" } })}>
                  Remove address
                </button>
              </>
            ) : (
              <button className="gbtn" onClick={() => setAdd(true)}>
                Add a forwarding address
              </button>
            )}
            <p style={{ margin: "14px 0 0" }}>
              Tip: You can also forward only some of your mail by{" "}
              <button className="link-btn" style={{ fontWeight: 400, fontFamily: "inherit" }} onClick={() => go({ view: "settings", settings: "filters" })}>
                creating a filter!
              </button>
            </p>
          </>
        )}
      </Row>
      <Row label="POP download:" sub={LM}>
        <b>1. Status: POP is not offered</b>
        <div className="muted">The TJHSST mail servers support IMAP only.</div>
      </Row>
      <Row label="IMAP access:" sub={<><div className="note">(access TJ Mail from other clients using IMAP)</div>{LM}</>}>
        <b>Status: IMAP is enabled</b>
        <div style={{ marginTop: 10 }}>
          <b>Configure your email client</b> (e.g. Outlook, Thunderbird, iPhone)
        </div>
        <div style={{ marginTop: 6 }}>
          Incoming: <b>imap.tjhsst.edu</b> port 993 (SSL/TLS)
          <br />
          Outgoing: <b>smtp.tjhsst.edu</b> port 465 (SSL/TLS) or 587 (STARTTLS)
          <br />
          Username: <b>{me.username}</b>
        </div>
      </Row>
      {add && cfg && (
        <PromptDialog
          title="Add a forwarding address"
          label="Please enter a new forwarding email address:"
          okLabel="Next"
          onClose={() => setAdd(false)}
          onOk={(v) => {
            save({ ...cfg, forward: { enabled: true, address: v } });
            setAdd(false);
          }}
        />
      )}
    </>
  );
}

function Addons() {
  return (
    <>
      <Row label="Installed add-ons:" sub={LM}>
        There are no add-ons installed.
      </Row>
      <Row label="">TJ Mail does not support third-party add-ons. Integrations with TJHSST services (Ion schedule, contacts directory) are built in and appear in the side panel.</Row>
      <Row label="Installed developer add-ons:">There are no add-ons installed.</Row>
    </>
  );
}

function Chat() {
  return (
    <>
      <Row label="Chat:">
        <Radio name="chat" checked={false} onChange={() => {}}>
          <b className="muted">Chat</b>
        </Radio>
        <Radio name="chat" checked onChange={() => {}}>
          <b>Off</b>
        </Radio>
      </Row>
      <Row label="Meet:">
        <Radio name="meet" checked={false} onChange={() => {}}>
          <b className="muted">Show the Meet section in the main menu</b>
        </Radio>
        <Radio name="meet" checked onChange={() => {}}>
          <b>Hide the Meet section in the main menu</b>
        </Radio>
      </Row>
      <div className="save-row">
        <button className="gbtn" disabled>
          Save Changes
        </button>
        <button className="gbtn">Cancel</button>
      </div>
    </>
  );
}

function Advanced() {
  const items: [string, string][] = [
    ["Auto-advance", 'Show the next conversation instead of your inbox after you delete, archive or mute a conversation.'],
    ["Templates", 'Turn frequent messages into templates to save time. Templates can be created and inserted through the "More options" menu in the compose toolbar.'],
    ["Custom keyboard shortcuts", "Enable the ability to customize your keyboard shortcuts via a new settings tab from which you can remap keys to various actions."],
    ["Unread message icon and badge", "See how many unread messages are in your inbox with a quick glance at the TJ Mail icon on the tab header."],
  ];
  const [v, setV] = useState<Record<string, boolean>>({});
  return (
    <>
      {items.map(([t, d]) => (
        <div key={t} className="srow" style={{ padding: "18px 0 18px 0" }}>
          <div style={{ flex: 1, paddingRight: 80 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t}</div>
            {d}
          </div>
          <div style={{ display: "flex", gap: 32, alignItems: "center", paddingRight: 40 }}>
            <Radio name={t} checked={!!v[t]} onChange={() => setV({ ...v, [t]: true })}>
              <b>Enable</b>
            </Radio>
            <Radio name={t} checked={!v[t]} onChange={() => setV({ ...v, [t]: false })}>
              <b>Disable</b>
            </Radio>
          </div>
        </div>
      ))}
      <div className="save-row">
        <button className="gbtn" disabled={!Object.values(v).some(Boolean)}>
          Save Changes
        </button>
        <button className="gbtn" onClick={() => setV({})}>
          Cancel
        </button>
      </div>
    </>
  );
}

function Offline() {
  return (
    <>
      <Row label="Offline:" sub={LM}>
        <label className="opt">
          <input type="checkbox" disabled /> <b>Enable offline mail</b>
        </label>
        <div className="muted" style={{ fontSize: 13 }}>
          Offline mail isn&apos;t available: messages are kept on the TJHSST mail servers only.
        </div>
      </Row>
      <div className="save-row">
        <button className="gbtn" disabled>
          Save Changes
        </button>
        <button className="gbtn">Cancel</button>
      </div>
    </>
  );
}

function Themes() {
  const { prefs, savePrefs } = useApp();
  const [open, setOpen] = useState(false);
  const themes: [string, string][] = [
    ["default", "#f8fafd"],
    ["blue", "#e8f0fe"],
    ["green", "#e6f4ea"],
    ["sand", "#fef7e0"],
    ["rose", "#fce8e6"],
    ["slate", "#e8eaed"],
  ];
  return (
    <div style={{ padding: "12px 0" }}>
      <button className="btn outline" style={{ color: "var(--primary)", borderColor: "#c4c7c5", borderRadius: 4, height: 36, padding: "0 16px" }} onClick={() => setOpen(true)}>
        Set theme
      </button>
      {open && (
        <Dialog
          title="Pick your theme"
          onClose={() => setOpen(false)}
          actions={
            <button className="btn text" onClick={() => setOpen(false)}>
              Done
            </button>
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 120px)", gap: 12 }}>
            {themes.map(([k, c]) => (
              <button key={k} onClick={() => savePrefs({ theme: k })} style={{ height: 80, background: c, border: prefs.theme === k ? "3px solid #0b57d0" : "1px solid #dadce0", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                {k}
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}
