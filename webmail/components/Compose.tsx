"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "./App";
import { Icon, IconName } from "./icons";
import { Anchor, anchorOf, Dialog, MenuItem, MenuSep, Popover } from "./ui";
import { api } from "@/lib/client/api";
import type { MessageDetail, Addr } from "@/lib/types";
import { bytes, escapeHtml, formatAddr, fullDate } from "@/lib/client/format";

export type ComposeInit = {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
  draftId?: string;
  replyTo?: MessageDetail;
  mode?: "reply" | "replyAll" | "forward";
  forwardOf?: string;
};

export type ComposeState = { key: number; init: ComposeInit; minimized: boolean; full: boolean };

type Att = { key: string; filename: string; size: number; contentType: string; ref?: { upload: string } | { msg: string; part: string }; progress?: number; error?: string };

const MAX = 25 * 1024 * 1024;

export function ComposeDock({ composes, setComposes }: { composes: ComposeState[]; setComposes: React.Dispatch<React.SetStateAction<ComposeState[]>> }) {
  const update = (key: number, patch: Partial<ComposeState>) => setComposes((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const close = (key: number) => setComposes((cs) => cs.filter((c) => c.key !== key));
  if (typeof document === "undefined") return null;
  const full = composes.find((c) => c.full && !c.minimized);
  return createPortal(
    <>
      {full && <div className="compose-overlay" onMouseDown={() => update(full.key, { full: false })} />}
      <div className={`compose-dock${full ? " has-full" : ""}`}>
        {composes.map((c) => (
          <ComposeWindow key={c.key} state={c} onChange={(p) => update(c.key, p)} onClose={() => close(c.key)} />
        ))}
      </div>
    </>,
    document.body,
  );
}

function quoteHeader(m: MessageDetail) {
  return `On ${fullDate(m.date).replace(" at ", " at ")} ${escapeHtml(m.from.name || "")} &lt;<a href="mailto:${escapeHtml(m.from.address)}">${escapeHtml(m.from.address)}</a>&gt; wrote:`;
}

function textToQuotedHtml(t: string) {
  return escapeHtml(t).replace(/\n/g, "<br>");
}

function ComposeWindow({ state, onChange, onClose }: { state: ComposeState; onChange: (p: Partial<ComposeState>) => void; onClose: () => void }) {
  const { me, prefs, savePrefs, snack, reloadFolders, reloadList, route, folders, compose: openCompose } = useApp();
  const init = state.init;
  const [from, setFrom] = useState(me.identities[0]?.address ?? "");
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [atts, setAtts] = useState<Att[]>([]);
  const [draftId, setDraftId] = useState<string | null>(init.draftId ?? null);
  const [status, setStatus] = useState("");
  const [fmt, setFmt] = useState(false);
  const [plain, setPlain] = useState(prefs.plainText);
  const [menu, setMenu] = useState<null | { kind: string; a: Anchor }>(null);
  const [recipFocus, setRecipFocus] = useState(false);
  const [sending, setSending] = useState(false);
  const [schedule, setSchedule] = useState(false);
  const [linkDlg, setLinkDlg] = useState<{ text: string; url: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
  const savedRange = useRef<Range | null>(null);
  const refs = useRef<{ inReplyTo?: string; references?: string[] }>({});
  const ready = useRef(false);
  const noSubjectOk = useRef(false);
  const [askNoSubject, setAskNoSubject] = useState<number | null>(null);

  const focusStart = () => {
    const el = bodyRef.current;
    if (!el) return;
    el.focus();
    const r = document.createRange();
    r.setStart(el, 0);
    r.collapse(true);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
  };

  useEffect(() => {
    const sig = prefs.signature ? `<br><br><div class="gmail_signature">-- <br>${prefs.signature}</div>` : "";
    const setBody = (html: string) => {
      if (bodyRef.current) bodyRef.current.innerHTML = html;
    };
    (async () => {
      if (init.draftId) {
        try {
          const d = await api<MessageDetail>(`/api/messages/${init.draftId}`);
          setTo(d.to.map(formatAddr));
          setCc(d.cc.map(formatAddr));
          setBcc(d.bcc.map(formatAddr));
          if (d.cc.length) setShowCc(true);
          if (d.bcc.length) setShowBcc(true);
          setSubject(d.subject);
          refs.current = { inReplyTo: d.inReplyTo || undefined, references: d.references };
          setAtts(d.bodyAttachments.map((a) => ({ key: `${init.draftId}:${a.part}`, filename: a.filename, size: a.size, contentType: a.contentType, ref: { msg: init.draftId!, part: a.part } })));
          const html = await fetch(`/api/messages/${init.draftId}/body`).then((r) => r.text());
          const doc = new DOMParser().parseFromString(html, "text/html");
          setBody(doc.body.innerHTML);
        } catch (e) {
          snack((e as Error).message);
        }
      } else if (init.replyTo) {
        const m = init.replyTo;
        const mine = me.identities.map((i) => i.address.toLowerCase());
        const sub = m.subject || "";
        if (init.mode === "forward") {
          setSubject(/^fwd?:/i.test(sub) ? sub : `Fwd: ${sub}`);
          setAtts(m.bodyAttachments.map((a) => ({ key: `${m.id}:${a.part}`, filename: a.filename, size: a.size, contentType: a.contentType, ref: { msg: m.id, part: a.part } })));
          const hdr = `---------- Forwarded message ---------<br>From: <b>${escapeHtml(m.from.name)}</b> &lt;${escapeHtml(m.from.address)}&gt;<br>Date: ${escapeHtml(fullDate(m.date))}<br>Subject: ${escapeHtml(sub)}<br>To: ${escapeHtml(m.to.map(formatAddr).join(", "))}<br>${m.cc.length ? `Cc: ${escapeHtml(m.cc.map(formatAddr).join(", "))}<br>` : ""}<br><br>`;
          setBody(`${init.body ? escapeHtml(init.body) : ""}<br>${sig}<br><div class="gmail_quote">${hdr}${textToQuotedHtml(m.text)}</div>`);
        } else {
          setSubject(/^re:/i.test(sub) ? sub : `Re: ${sub}`);
          const replyTarget = (m.replyTo.length ? m.replyTo : [m.from]).filter((a) => !mine.includes(a.address.toLowerCase()));
          const fromMe = mine.includes(m.from.address.toLowerCase());
          const toList: Addr[] = fromMe ? m.to : replyTarget.length ? replyTarget : [m.from];
          setTo(toList.map(formatAddr));
          if (init.mode === "replyAll") {
            const others = [...m.to, ...m.cc].filter((a) => !mine.includes(a.address.toLowerCase()) && !toList.some((t) => t.address === a.address));
            if (others.length) {
              setCc(others.map(formatAddr));
              setShowCc(true);
            }
          }
          refs.current = { inReplyTo: m.messageId || undefined, references: [...(m.references || []), m.messageId].filter(Boolean) };
          setBody(`${init.body ? escapeHtml(init.body) : ""}<br>${sig}<br><div class="gmail_quote"><div>${quoteHeader(m)}<br></div><blockquote class="gmail_quote">${textToQuotedHtml(m.text)}</blockquote></div>`);
        }
      } else if (init.forwardOf) {
        const m = await api<MessageDetail>(`/api/messages/${init.forwardOf}`).catch(() => null);
        if (m) {
          setSubject(`Fwd: ${m.subject}`);
          setAtts(m.bodyAttachments.map((a) => ({ key: `${m.id}:${a.part}`, filename: a.filename, size: a.size, contentType: a.contentType, ref: { msg: m.id, part: a.part } })));
          setBody(`<br>${sig}<br>${textToQuotedHtml(m.text)}`);
        }
      } else {
        if (init.to) setTo([init.to]);
        if (init.subject) setSubject(init.subject);
        setBody(`${init.body ? textToQuotedHtml(init.body) : ""}${sig}`);
      }
      ready.current = true;
      if (!init.to && !init.replyTo && !init.draftId) setRecipFocus(true);
      else if (init.replyTo) setTimeout(() => focusStart(), 50);
    })();
  }, []);

  const draft = useCallback(
    () => ({
      from,
      to: to.join(", "),
      cc: cc.join(", "),
      bcc: bcc.join(", "),
      subject,
      html: bodyRef.current?.innerHTML ?? "",
      plain,
      attachments: atts.filter((a) => a.ref).map((a) => a.ref!),
      inReplyTo: refs.current.inReplyTo,
      references: refs.current.references,
    }),
    [from, to, cc, bcc, subject, plain, atts],
  );

  const isEmpty = () => !to.length && !cc.length && !bcc.length && !subject && !(bodyRef.current?.innerText || "").replace(/--\s*$/m, "").trim() && !atts.length;

  const saveDraft = useCallback(async () => {
    if (!dirty.current || !ready.current) return;
    if (saving.current) await saving.current;
    dirty.current = false;
    const d = draft();
    if (!d.to && !d.cc && !d.bcc && !d.subject && !(bodyRef.current?.innerText || "").trim() && !d.attachments.length) return;
    setStatus("Saving…");
    const p = (async () => {
      try {
        const r = await api<{ id: string | null }>("/api/drafts", { body: { draft: d, replaceId: draftId } });
        if (r.id) {
          setDraftId(r.id);
          let i = 0;
          setAtts((cur) => cur.map((a) => (a.ref ? { ...a, ref: { msg: r.id!, part: String(i++) } } : a)));
        }
        setStatus("Draft saved");
        reloadFolders(true);
        if (route.view === "drafts") reloadList();
      } catch (e) {
        setStatus("");
        dirty.current = true;
        snack(`Couldn't save draft: ${(e as Error).message}`);
      }
    })();
    saving.current = p;
    await p;
    saving.current = null;
  }, [draft, draftId, reloadFolders, reloadList, route.view, snack]);

  const touch = () => {
    dirty.current = true;
    setStatus("");
  };

  useEffect(() => {
    const t = setInterval(() => {
      saveDraft();
    }, 4000);
    return () => clearInterval(t);
  }, [saveDraft]);

  useEffect(() => {
    if (ready.current) touch();
  }, [to, cc, bcc, subject, atts.length]);

  const uploadFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    const totalNow = atts.reduce((s, a) => s + a.size, 0);
    let total = totalNow;
    for (const f of list) {
      total += f.size;
      if (total > MAX) {
        snack("Attachments can be up to 25 MB in total.");
        return;
      }
    }
    for (const f of list) {
      const key = `u${Date.now()}${Math.random()}`;
      setAtts((cur) => [...cur, { key, filename: f.name, size: f.size, contentType: f.type, progress: 0 }]);
      const fd = new FormData();
      fd.append("file", f);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/uploads");
      xhr.setRequestHeader("X-CSRF-Token", me.csrf);
      xhr.upload.onprogress = (ev) => setAtts((cur) => cur.map((a) => (a.key === key ? { ...a, progress: ev.loaded / Math.max(1, ev.total) } : a)));
      xhr.onload = () => {
        if (xhr.status === 200) {
          const r = JSON.parse(xhr.responseText) as { id: string };
          setAtts((cur) => cur.map((a) => (a.key === key ? { ...a, progress: undefined, ref: { upload: r.id } } : a)));
        } else {
          let msg = "Upload failed";
          try {
            msg = JSON.parse(xhr.responseText).error || msg;
          } catch {
          }
          snack(msg);
          setAtts((cur) => cur.filter((a) => a.key !== key));
        }
      };
      xhr.onerror = () => {
        snack("Upload failed");
        setAtts((cur) => cur.filter((a) => a.key !== key));
      };
      xhr.send(fd);
    }
  };

  const send = async (sendAt?: number) => {
    if (atts.some((a) => a.progress !== undefined)) return snack("Please wait for attachments to finish uploading.");
    if (!to.length && !cc.length && !bcc.length) return snack("Please specify at least one recipient.");
    if (!subject && !noSubjectOk.current) {
      setAskNoSubject(sendAt ?? 0);
      return;
    }
    noSubjectOk.current = false;
    setSending(true);
    const d = draft();
    try {
      if (saving.current) await saving.current;
      const r = await api<{ id: string; undoSeconds: number; sendAt: number }>("/api/send", { body: { draft: d, draftId, sendAt } });
      onClose();
      if (sendAt) {
        snack(`Send scheduled for ${new Date(sendAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`, [{ label: "Undo", run: () => cancel(r.id, d) }]);
      } else if (r.undoSeconds > 0) {
        snack("Message sent.", [{ label: "Undo", run: () => cancel(r.id, d) }], r.undoSeconds * 1000);
        setTimeout(() => {
          reloadFolders(true);
          if (["sent", "drafts"].includes(route.view)) reloadList();
        }, r.undoSeconds * 1000 + 2500);
      } else {
        snack("Message sent.");
        setTimeout(() => reloadFolders(true), 2500);
      }
    } catch (e) {
      snack((e as Error).message);
      setSending(false);
    }
  };
  const cancel = async (id: string, d: ReturnType<typeof draft>) => {
    try {
      const r = await api<{ cancelled: boolean }>(`/api/send/${id}`, { method: "DELETE" });
      if (r.cancelled) {
        snack("Sending undone.");
        openCompose({ to: d.to, cc: d.cc, subject: d.subject, body: "", draftId: draftId ?? undefined });
      } else snack("Too late — the message was already sent.");
    } catch (e) {
      snack((e as Error).message);
    }
  };

  const discard = async () => {
    dirty.current = false;
    onClose();
    if (draftId) {
      await api("/api/drafts", { method: "DELETE", body: { id: draftId } }).catch(() => {});
      reloadFolders(true);
      if (route.view === "drafts") reloadList();
    }
    snack("Draft discarded.");
  };

  const closeWindow = async () => {
    if (!isEmpty()) {
      dirty.current = true;
      onClose();
      await saveDraft();
    } else onClose();
  };

  const exec = (cmd: string, val?: string) => {
    bodyRef.current?.focus();
    if (savedRange.current) {
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(savedRange.current);
    }
    document.execCommand(cmd, false, val);
    touch();
  };
  const saveSel = () => {
    const s = window.getSelection();
    if (s && s.rangeCount && bodyRef.current?.contains(s.anchorNode)) savedRange.current = s.getRangeAt(0).cloneRange();
  };

  const title = subject || "New Message";
  const min = state.minimized;
  const fieldsCollapsed = !recipFocus && !showCc && !showBcc;

  const rcptField = (label: string, list: string[], set: (v: string[]) => void, extra?: React.ReactNode, autoFocus?: boolean) => <RecipientField label={label} value={list} onChange={set} extra={extra} autoFocus={autoFocus} onFocus={() => setRecipFocus(true)} />;

  return (
    <div
      className={`compose${min ? " min" : ""}${state.full && !min ? " full" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          setDragOver(false);
          uploadFiles(e.dataTransfer.files);
        }
      }}
      role="dialog"
      aria-label={title}
    >
      <div className="c-hdr" onClick={() => min && onChange({ minimized: false })}>
        <span className="title">{title}</span>
        <button className="icon-btn" data-tip={min ? "Maximize" : "Minimize"} aria-label="Minimize" onClick={(e) => (e.stopPropagation(), onChange({ minimized: !min }))}>
          <Icon name={min ? "chevronUp" : "minimize"} size={16} />
        </button>
        <button className="icon-btn" data-tip={state.full ? "Exit full screen" : "Full screen"} aria-label="Full screen" onClick={(e) => (e.stopPropagation(), onChange({ full: !state.full, minimized: false }))}>
          <Icon name={state.full ? "closeFull" : "openFull"} size={14} />
        </button>
        <button className="icon-btn" data-tip="Save & close" aria-label="Save and close" onClick={(e) => (e.stopPropagation(), closeWindow())}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {!min && (
        <>
          {me.identities.length > 1 && (
            <div className="c-field">
              <span className="lbl">From</span>
              <select value={from} onChange={(e) => setFrom(e.target.value)} style={{ border: "none", fontSize: 14, background: "transparent" }}>
                {me.identities.map((i) => (
                  <option key={i.address} value={i.address}>
                    {i.name} &lt;{i.address}&gt;
                  </option>
                ))}
              </select>
            </div>
          )}
          {fieldsCollapsed ? (
            <div className="c-field" onClick={() => setRecipFocus(true)}>
              <input
                placeholder="Recipients"
                readOnly
                value={[...to, ...cc, ...bcc].map((x) => x.replace(/\s*<.*>/, "")).join(", ")}
                onFocus={() => setRecipFocus(true)}
                style={{ cursor: "text" }}
              />
            </div>
          ) : (
            <div
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node) && !(e.relatedTarget as HTMLElement)?.closest?.(".suggest")) setTimeout(() => setRecipFocus(false), 160);
              }}
            >
              {rcptField(
                "To",
                to,
                setTo,
                <span className="ccbcc">
                  {!showCc && (
                    <button onClick={() => setShowCc(true)} data-tip="Add Cc recipients">
                      Cc
                    </button>
                  )}
                  {!showBcc && (
                    <button onClick={() => setShowBcc(true)} data-tip="Add Bcc recipients">
                      Bcc
                    </button>
                  )}
                </span>,
                !init.replyTo,
              )}
              {showCc && rcptField("Cc", cc, setCc)}
              {showBcc && rcptField("Bcc", bcc, setBcc)}
            </div>
          )}
          <div className="c-field">
            <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} onFocus={() => to.length + cc.length + bcc.length > 0 && setRecipFocus(false)} aria-label="Subject" maxLength={900} />
          </div>
          <div
            ref={bodyRef}
            className="c-body"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Message Body"
            spellCheck
            onInput={touch}
            onKeyUp={saveSel}
            onMouseUp={saveSel}
            onFocus={() => to.length + cc.length + bcc.length > 0 && setRecipFocus(false)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            onPaste={(e) => {
              if (plain) {
                e.preventDefault();
                document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
              } else if (e.clipboardData.files.length) {
                const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
                if (imgs.length) {
                  e.preventDefault();
                  imgs.forEach(insertImage);
                }
              }
            }}
            style={{ fontFamily: prefs.fontFamily === "serif" ? "Georgia, serif" : prefs.fontFamily === "monospace" ? "monospace" : undefined, background: dragOver ? "#e8f0fe" : undefined }}
          />
          {atts.length > 0 && (
            <div className="c-atts">
              {atts.map((a) => (
                <div className="c-att" key={a.key}>
                  <span className="n">{a.filename}</span>
                  <span className="s">({bytes(a.size)})</span>
                  {a.progress !== undefined && <progress value={a.progress} max={1} />}
                  <button className="icon-btn sm" aria-label={`Remove ${a.filename}`} onClick={() => setAtts((cur) => cur.filter((x) => x.key !== a.key))}>
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {fmt && !plain && <FormatBar exec={exec} />}
          <div className="c-foot">
            <div className="send-btn">
              <button className="main-s" onClick={() => send()} disabled={sending} data-tip="Send (⌘Enter)">
                Send
              </button>
              <button className="arrow" aria-label="More send options" data-tip="More send options" onClick={(e) => setMenu({ kind: "send", a: anchorOf(e, "left", "above") })}>
                <Icon name="dropDown" size={20} />
              </button>
            </div>
            <button className={`icon-btn${fmt ? " on" : ""}`} data-tip="Formatting options" aria-label="Formatting options" onClick={() => setFmt((f) => !f)} disabled={plain}>
              <Icon name="textFields" size={20} />
            </button>
            <button className="icon-btn" data-tip="Attach files" aria-label="Attach files" onClick={() => fileRef.current?.click()}>
              <Icon name="attach" size={20} style={{ transform: "rotate(45deg)" }} />
            </button>
            <button className="icon-btn" data-tip="Insert link" aria-label="Insert link" onClick={() => (saveSel(), setLinkDlg({ text: window.getSelection()?.toString() || "", url: "" }))}>
              <Icon name="link" size={20} />
            </button>
            <button className="icon-btn" data-tip="Insert emoji" aria-label="Insert emoji" onClick={(e) => (saveSel(), setMenu({ kind: "emoji", a: anchorOf(e, "left", "above") }))}>
              <Icon name="smile" size={20} />
            </button>
            <button className="icon-btn" data-tip="Insert photo" aria-label="Insert photo" onClick={() => (saveSel(), photoRef.current?.click())} disabled={plain}>
              <Icon name="photo" size={20} />
            </button>
            <button className="icon-btn" data-tip="Insert signature" aria-label="Insert signature" onClick={(e) => (saveSel(), setMenu({ kind: "sig", a: anchorOf(e, "left", "above") }))}>
              <Icon name="signature" size={20} />
            </button>
            <button className="icon-btn dot-badge" data-tip="More options" aria-label="More options" onClick={(e) => setMenu({ kind: "more", a: anchorOf(e, "left", "above") })}>
              <Icon name="more" size={20} />
            </button>
            <span className="grow" />
            <span style={{ fontSize: 12, color: "var(--text3)", marginRight: 8 }}>{status}</span>
            <button className="icon-btn" data-tip="Discard draft" aria-label="Discard draft" onClick={discard}>
              <Icon name="delete" size={20} />
            </button>
          </div>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => (e.target.files && uploadFiles(e.target.files), (e.target.value = ""))} />
          <input ref={photoRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => (e.target.files?.[0] && insertImage(e.target.files[0]), (e.target.value = ""))} />
        </>
      )}
      {menu?.kind === "send" && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)}>
          <MenuItem icon="scheduledSend" onClick={() => (setMenu(null), setSchedule(true))}>
            Schedule send
          </MenuItem>
        </Popover>
      )}
      {menu?.kind === "emoji" && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)} style={{ display: "grid", gridTemplateColumns: "repeat(8, 36px)", padding: 8 }}>
          {"😀 😂 😊 😍 😎 🤔 😢 😮 👍 👎 👏 🙏 🎉 ❤️ 🔥 ✅ ❌ ⭐ 📎 📅 ✉️ 💡 🚀 👋".split(" ").map((em) => (
            <button key={em} className="icon-btn" style={{ fontSize: 20, width: 36, height: 36 }} onClick={() => (exec("insertText", em), setMenu(null))}>
              {em}
            </button>
          ))}
        </Popover>
      )}
      {menu?.kind === "sig" && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)}>
          {prefs.signature ? (
            <MenuItem onClick={() => (exec("insertHTML", `<div class="gmail_signature">-- <br>${prefs.signature}</div>`), setMenu(null))}>My signature</MenuItem>
          ) : (
            <MenuItem hint>No signature</MenuItem>
          )}
          <MenuSep />
          <MenuItem icon="edit" onClick={() => (setMenu(null), (window.location.hash = "#settings/general"))}>
            Manage signatures
          </MenuItem>
        </Popover>
      )}
      {menu?.kind === "more" && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)} style={{ minWidth: 260 }}>
          <MenuItem icon={prefs.composeFullscreen ? "check" : "fullscreenDefault"} onClick={() => (savePrefs({ composeFullscreen: !prefs.composeFullscreen }), setMenu(null))}>
            Default to full screen
          </MenuItem>
          <MenuItem
            icon={plain ? "check" : "plainText"}
            onClick={() => {
              setMenu(null);
              const next = !plain;
              setPlain(next);
              if (next && bodyRef.current) bodyRef.current.innerText = bodyRef.current.innerText;
              touch();
            }}
          >
            Plain text mode
          </MenuItem>
          <MenuSep />
          <MenuItem
            icon="print"
            onClick={() => {
              setMenu(null);
              const w = window.open("", "_blank", "width=800,height=600");
              if (w) {
                w.document.body.innerText = `Subject: ${subject}\nTo: ${to.join(", ")}\n\n${bodyRef.current?.innerText ?? ""}`;
                w.print();
              }
            }}
          >
            Print
          </MenuItem>
          <MenuItem
            icon="spellcheck"
            onClick={() => {
              setMenu(null);
              bodyRef.current?.setAttribute("spellcheck", "true");
              bodyRef.current?.focus();
              snack("Spelling errors are underlined as you type.");
            }}
          >
            Spell check
          </MenuItem>
          <MenuSep />
          <MenuItem icon="label" right={<Icon name="dropRight" size={18} className="sub" />} onClick={() => setMenu({ kind: "labelSub", a: menu.a })}>
            Label
          </MenuItem>
        </Popover>
      )}
      {menu?.kind === "labelSub" && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)}>
          <MenuItem hint>Labels apply when the message is sent (copied to the label).</MenuItem>
          {folders
            .filter((f) => f.role === "label")
            .map((f) => (
              <MenuItem key={f.path} onClick={() => (setMenu(null), snack(`"${f.name}" will be applied after sending.`))}>
                {f.name}
              </MenuItem>
            ))}
        </Popover>
      )}
      {askNoSubject !== null && (
        <Dialog
          title="Send without subject?"
          onClose={() => setAskNoSubject(null)}
          actions={
            <>
              <button className="btn text" onClick={() => setAskNoSubject(null)}>
                Cancel
              </button>
              <button
                className="btn text"
                onClick={() => {
                  const t = askNoSubject;
                  setAskNoSubject(null);
                  noSubjectOk.current = true;
                  send(t || undefined);
                }}
              >
                OK
              </button>
            </>
          }
        >
          Send this message without a subject?
        </Dialog>
      )}
      {schedule && <ScheduleDialog onClose={() => setSchedule(false)} onPick={(t) => (setSchedule(false), send(t))} />}
      {linkDlg && (
        <Dialog
          title="Edit link"
          onClose={() => setLinkDlg(null)}
          actions={
            <>
              <button className="btn text" onClick={() => setLinkDlg(null)}>
                Cancel
              </button>
              <button
                className="btn text"
                disabled={!/^(https?:\/\/|mailto:)\S+/i.test(linkDlg.url.trim()) && !/^\S+\.\S+$/.test(linkDlg.url.trim())}
                onClick={() => {
                  let url = linkDlg.url.trim();
                  if (!/^(https?:|mailto:)/i.test(url)) url = (url.includes("@") ? "mailto:" : "https://") + url;
                  const text = linkDlg.text || url;
                  exec("insertHTML", `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`);
                  setLinkDlg(null);
                }}
              >
                OK
              </button>
            </>
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, alignItems: "center" }}>
            <span>Text to display</span>
            <input className="field" value={linkDlg.text} onChange={(e) => setLinkDlg({ ...linkDlg, text: e.target.value })} />
            <span>Web address or email</span>
            <input className="field" autoFocus value={linkDlg.url} onChange={(e) => setLinkDlg({ ...linkDlg, url: e.target.value })} />
          </div>
        </Dialog>
      )}
    </div>
  );

  function insertImage(f: File) {
    if (f.size > 4 * 1024 * 1024) {
      snack("Inline images can be up to 4 MB. Attach larger images instead.");
      return;
    }
    const r = new FileReader();
    r.onload = () => exec("insertHTML", `<img src="${String(r.result)}" alt="${escapeHtml(f.name)}" style="max-width:100%">`);
    r.readAsDataURL(f);
  }
}

function ScheduleDialog({ onClose, onPick }: { onClose: () => void; onPick: (t: number) => void }) {
  const [custom, setCustom] = useState(false);
  const [val, setVal] = useState(() => {
    const d = new Date(Date.now() + 86400_000);
    d.setHours(8, 0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const at = (days: number, h: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const mon = () => {
    const d = new Date();
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    d.setHours(8, 0, 0, 0);
    return d;
  };
  const opts: [string, Date][] = [
    ["Tomorrow morning", at(1, 8)],
    ["Tomorrow afternoon", at(1, 13)],
    ["Monday morning", mon()],
  ];
  const f = (d: Date) => d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <Dialog
      title={custom ? "Pick date & time" : "Schedule send"}
      onClose={onClose}
      actions={
        custom ? (
          <>
            <button className="btn text" onClick={onClose}>
              Cancel
            </button>
            <button className="btn text" onClick={() => new Date(val).getTime() > Date.now() && onPick(new Date(val).getTime())}>
              Schedule send
            </button>
          </>
        ) : (
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
        )
      }
    >
      {custom ? (
        <input className="field" type="datetime-local" value={val} onChange={(e) => setVal(e.target.value)} />
      ) : (
        <div style={{ margin: "0 -24px" }} className="menu" >
          {opts.map(([l, d]) => (
            <MenuItem key={l} onClick={() => onPick(d.getTime())} right={<span style={{ color: "var(--text3)", marginLeft: 40 }}>{f(d)}</span>}>
              {l}
            </MenuItem>
          ))}
          <MenuSep />
          <MenuItem icon="clock" onClick={() => setCustom(true)}>
            Pick date &amp; time
          </MenuItem>
        </div>
      )}
    </Dialog>
  );
}

function FormatBar({ exec }: { exec: (cmd: string, val?: string) => void }) {
  const [menu, setMenu] = useState<null | { kind: string; a: Anchor }>(null);
  const btn = (icon: IconName, tip: string, cmd: string, val?: string) => (
    <button className="icon-btn" data-tip={tip} aria-label={tip} onMouseDown={(e) => e.preventDefault()} onClick={() => exec(cmd, val)}>
      <Icon name={icon} size={18} />
    </button>
  );
  const COLORS = ["#000000", "#444444", "#666666", "#999999", "#cccccc", "#ffffff", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff", "#e06666", "#f6b26b", "#93c47d", "#6fa8dc", "#8e7cc3"];
  return (
    <div className="fmt-bar" onMouseDown={(e) => (e.target as HTMLElement).tagName !== "SELECT" && e.preventDefault()}>
      {btn("undo", "Undo (⌘Z)", "undo")}
      {btn("redo", "Redo (⌘Y)", "redo")}
      <span className="sep" />
      <button className="font-sel" data-tip="Font" onClick={(e) => setMenu({ kind: "font", a: anchorOf(e, "left", "above") })}>
        Sans Serif <Icon name="dropDown" size={18} />
      </button>
      <span className="sep" />
      <button className="font-sel" data-tip="Size" aria-label="Size" onClick={(e) => setMenu({ kind: "size", a: anchorOf(e, "left", "above") })}>
        <Icon name="textFields" size={18} />
        <Icon name="dropDown" size={16} />
      </button>
      <span className="sep" />
      {btn("bold", "Bold (⌘B)", "bold")}
      {btn("italic", "Italic (⌘I)", "italic")}
      {btn("underline", "Underline (⌘U)", "underline")}
      <button className="font-sel" data-tip="Text color" aria-label="Text color" onClick={(e) => setMenu({ kind: "color", a: anchorOf(e, "left", "above") })}>
        <Icon name="textColor" size={18} />
        <Icon name="dropDown" size={16} />
      </button>
      <span className="sep" />
      <button className="font-sel" data-tip="Align" aria-label="Align" onClick={(e) => setMenu({ kind: "align", a: anchorOf(e, "left", "above") })}>
        <Icon name="alignLeft" size={18} />
        <Icon name="dropDown" size={16} />
      </button>
      {btn("numbered", "Numbered list", "insertOrderedList")}
      {btn("bulleted", "Bulleted list", "insertUnorderedList")}
      {btn("indentLess", "Indent less", "outdent")}
      {btn("indentMore", "Indent more", "indent")}
      {btn("quote", "Quote", "formatBlock", "blockquote")}
      <span className="sep" />
      {btn("strike", "Strikethrough", "strikeThrough")}
      {btn("clearFormat", "Remove formatting", "removeFormat")}
      {menu?.kind === "font" && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)}>
          {[
            ["Sans Serif", "arial, sans-serif"],
            ["Serif", "'times new roman', serif"],
            ["Fixed Width", "monospace"],
            ["Wide", "'arial black', sans-serif"],
            ["Narrow", "'arial narrow', sans-serif"],
            ["Comic Sans MS", "'comic sans ms', sans-serif"],
            ["Garamond", "garamond, serif"],
            ["Georgia", "georgia, serif"],
            ["Tahoma", "tahoma, sans-serif"],
            ["Trebuchet MS", "'trebuchet ms', sans-serif"],
            ["Verdana", "verdana, sans-serif"],
          ].map(([l, v]) => (
            <MenuItem key={l} onClick={() => (exec("fontName", v), setMenu(null))}>
              <span style={{ fontFamily: v }}>{l}</span>
            </MenuItem>
          ))}
        </Popover>
      )}
      {menu?.kind === "size" && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)}>
          {[
            ["Small", "1", 11],
            ["Normal", "2", 13],
            ["Large", "4", 18],
            ["Huge", "6", 28],
          ].map(([l, v, px]) => (
            <MenuItem key={l as string} onClick={() => (exec("fontSize", v as string), setMenu(null))}>
              <span style={{ fontSize: px as number }}>{l}</span>
            </MenuItem>
          ))}
        </Popover>
      )}
      {menu?.kind === "color" && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)} style={{ padding: 10 }}>
          <div style={{ fontSize: 12, marginBottom: 6 }}>Text color</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 22px)", gap: 4 }}>
            {COLORS.map((c) => (
              <button key={c} aria-label={c} onClick={() => (exec("foreColor", c), setMenu(null))} style={{ width: 22, height: 22, border: "1px solid #ccc", background: c, cursor: "pointer", borderRadius: 2 }} />
            ))}
          </div>
          <div style={{ fontSize: 12, margin: "10px 0 6px" }}>Background color</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 22px)", gap: 4 }}>
            {COLORS.map((c) => (
              <button key={c} aria-label={c} onClick={() => (exec("hiliteColor", c), setMenu(null))} style={{ width: 22, height: 22, border: "1px solid #ccc", background: c, cursor: "pointer", borderRadius: 2 }} />
            ))}
          </div>
        </Popover>
      )}
      {menu?.kind === "align" && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)} style={{ display: "flex", padding: 4 }}>
          {btn("alignLeft", "Align left", "justifyLeft")}
          {btn("alignCenter", "Align center", "justifyCenter")}
          {btn("alignRight", "Align right", "justifyRight")}
        </Popover>
      )}
    </div>
  );
}

function RecipientField({ label, value, onChange, extra, autoFocus, onFocus }: { label: string; value: string[]; onChange: (v: string[]) => void; extra?: React.ReactNode; autoFocus?: boolean; onFocus: () => void }) {
  const [text, setText] = useState("");
  const [sugg, setSugg] = useState<{ name: string; email: string }[]>([]);
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setSugg([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api<{ contacts: { name: string; email: string }[]; directory: { name: string; email: string }[] }>(`/api/contacts?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => {
          setSugg([...r.contacts, ...r.directory].slice(0, 8));
          setHl(0);
        })
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [text]);
  const commit = (raw: string) => {
    const parts = raw
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) onChange([...value, ...parts]);
    setText("");
    setSugg([]);
  };
  const valid = (s: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test((/<([^>]+)>/.exec(s)?.[1] ?? s).trim());
  return (
    <div className="c-field" onClick={() => inputRef.current?.focus()}>
      <span className="lbl">{label}</span>
      <div className="rcpt-wrap">
        {value.map((v, i) => (
          <span key={i} className={`rcpt${valid(v) ? "" : " bad"}`} title={v}>
            <span>{v.replace(/\s*<.*>/, "") || v}</span>
            <button aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Icon name="close" size={14} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={text}
          aria-label={`${label} recipients`}
          onFocus={onFocus}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]\s*$/.test(v)) commit(v);
            else setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Tab") {
              if (sugg[hl] && text) {
                e.preventDefault();
                const s = sugg[hl];
                commit(s.name ? `${s.name} <${s.email}>` : s.email);
              } else if (text.trim()) {
                if (e.key === "Enter") e.preventDefault();
                commit(text);
              }
            } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
            else if (e.key === "ArrowDown") (e.preventDefault(), setHl((h) => Math.min(sugg.length - 1, h + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setHl((h) => Math.max(0, h - 1)));
            else if (e.key === "Escape") setSugg([]);
          }}
          onBlur={() => setTimeout(() => text.trim() && commit(text), 150)}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (/[,;\n]/.test(t)) {
              e.preventDefault();
              commit(t.replace(/\n/g, ","));
            }
          }}
        />
      </div>
      {extra}
      {sugg.length > 0 && text && (
        <div className="suggest">
          {sugg.map((s, i) => (
            <div key={s.email} className={`s-item${i === hl ? " hl" : ""}`} onMouseDown={(e) => (e.preventDefault(), commit(s.name ? `${s.name} <${s.email}>` : s.email))}>
              <span className="avatar" style={{ width: 32, height: 32, fontSize: 14, background: "#1a73e8" }}>
                {(s.name || s.email).charAt(0).toUpperCase()}
              </span>
              <div>
                <div className="s-name">{s.name || s.email}</div>
                <div className="s-mail">{s.email}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
