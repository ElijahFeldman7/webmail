"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./App";
import { Icon } from "./icons";
import { Anchor, anchorOf, MenuItem, MenuSep, Popover } from "./ui";
import { api } from "@/lib/client/api";
import type { MessageDetail, MessageSummary, Addr } from "@/lib/types";
import { longDate, fullDate, displayName, bytes, listDate } from "@/lib/client/format";
import { FolderPicker, SnoozeMenu } from "./MailList";
import { SenderAvatar, isDirectoryAddress, shortName } from "./Avatar";

export function MessageView({ id }: { id: string }) {
  const { go, list, act, folders, compose, prefs, snack, myAddresses, setList, me } = useApp();
  const [msg, setMsg] = useState<MessageDetail | null>(null);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<null | { kind: "more" | "move" | "label" | "snooze"; a: Anchor }>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([id]));
  const [loaded, setLoaded] = useState<Record<string, MessageDetail>>({});

  useEffect(() => {
    let alive = true;
    setMsg(null);
    setError("");
    api<MessageDetail>(`/api/messages/${id}`)
      .then((m) => {
        if (!alive) return;
        setMsg(m);
        setLoaded((l) => ({ ...l, [id]: m }));
        setList((cur) => (cur ? { ...cur, messages: cur.messages.map((x) => (x.id === id ? { ...x, unread: false } : x)) } : cur));
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [id, setList]);

  const backToList = useCallback(() => go({ msg: undefined }), [go]);

  const idx = list?.messages.findIndex((m) => m.id === id) ?? -1;
  const pos = idx >= 0 && list ? list.offset + idx + 1 : 0;
  const newer = idx > 0 ? list?.messages[idx - 1] : undefined;
  const older = idx >= 0 && list && idx < list.messages.length - 1 ? list.messages[idx + 1] : undefined;

  const doAndLeave = async (action: string, extra?: { target?: string; until?: number; label?: string }) => {
    await act([id], action, extra);
    backToList();
  };

  const toggleStar = () => {
    if (!msg) return;
    act([msg.id], msg.starred ? "unstar" : "star", { silent: true });
    setMsg({ ...msg, starred: !msg.starred });
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!msg) return;
      if (e.key === "u") backToList();
      else if (e.key === "j" && older) go({ msg: older.id });
      else if (e.key === "k" && newer) go({ msg: newer.id });
      else if (e.key === "r") compose({ replyTo: msg, mode: "reply" });
      else if (e.key === "a") compose({ replyTo: msg, mode: "replyAll" });
      else if (e.key === "f") compose({ replyTo: msg, mode: "forward" });
      else if (e.key === "e" && msg.folder === "INBOX") doAndLeave("archive");
      else if (e.key === "#") doAndLeave("trash");
      else if (e.key === "s") toggleStar();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const folder = folders.find((f) => f.path === msg?.folder);
  const role = folder?.role;
  const chip = role === "inbox" ? "Inbox" : role === "label" ? folder?.name : role === "spam" ? "Spam" : role === "trash" ? "Trash" : null;

  const thread = useMemo(() => {
    if (!msg) return [];
    return [...msg.thread, msg as MessageSummary].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [msg]);

  const print = () => window.open(`/api/messages/${id}/print`, "_blank", "noopener");

  return (
    <>
      <div className="toolbar">
        <button className="icon-btn" data-tip="Back to list" aria-label="Back" onClick={backToList} style={{ marginLeft: 0, marginRight: 14 }}>
          <Icon name="back" size={20} />
        </button>
        {role === "inbox" ? (
          <button className="icon-btn" data-tip="Archive" aria-label="Archive" onClick={() => doAndLeave("archive")}>
            <Icon name="archive" size={20} />
          </button>
        ) : (
          role !== "trash" &&
          role !== "spam" && (
            <button className="icon-btn" data-tip="Move to Inbox" aria-label="Move to Inbox" onClick={() => doAndLeave("inbox")}>
              <Icon name="unarchive" size={20} />
            </button>
          )
        )}
        {role === "spam" ? (
          <button className="btn text" style={{ height: 32, color: "#444746", padding: "0 10px" }} onClick={() => doAndLeave("notspam")}>
            Not spam
          </button>
        ) : (
          <button className="icon-btn" data-tip="Report spam" aria-label="Report spam" onClick={() => doAndLeave("spam")}>
            <Icon name="spam" size={20} />
          </button>
        )}
        <button className="icon-btn" data-tip={role === "trash" ? "Delete forever" : "Delete"} aria-label="Delete" onClick={() => doAndLeave(role === "trash" ? "delete" : "trash")}>
          <Icon name={role === "trash" ? "deleteForever" : "delete"} size={20} />
        </button>
        <span className="sep" />
        <button
          className="icon-btn"
          data-tip="Mark as unread"
          aria-label="Mark as unread"
          onClick={async () => {
            await act([id], "unread", { silent: true });
            backToList();
          }}
        >
          <Icon name="markUnread" size={20} />
        </button>
        <button className="icon-btn" data-tip="Move to" aria-label="Move to" onClick={(e) => setMenu({ kind: "move", a: anchorOf(e) })}>
          <Icon name="moveTo" size={20} />
        </button>
        <button className="icon-btn" data-tip="More" aria-label="More" onClick={(e) => setMenu({ kind: "more", a: anchorOf(e) })}>
          <Icon name="more" size={20} />
        </button>
        <div className="spacer" />
        <div className="pager">
          {pos > 0 && list && (
            <span className="count">
              {pos} of {list.total.toLocaleString()}
            </span>
          )}
          <button className="icon-btn" data-tip="Newer" aria-label="Newer" disabled={!newer} onClick={() => newer && go({ msg: newer.id })}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <button className="icon-btn" data-tip="Older" aria-label="Older" disabled={!older} onClick={() => older && go({ msg: older.id })}>
            <Icon name="chevronRight" size={20} />
          </button>
        </div>
        <button className="input-tools" data-tip="Input tools" aria-label="Input tools">
          <Icon name="keyboard" size={20} />
          <Icon name="dropDown" size={16} />
        </button>
      </div>
      <div className="msg-scroll scroll">
        {error && <div className="empty">{error}</div>}
        {!msg && !error && (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <div className="spinner" />
          </div>
        )}
        {msg && (
          <>
            <div className="msg-subject">
              <h2>
                {msg.subject || "(no subject)"}
                {chip && (
                  <span className="chip-inline">
                    {chip}
                    {role === "inbox" || role === "label" ? (
                      <button aria-label={`Remove label ${chip}`} data-tip="Remove label from this conversation" onClick={() => (role === "inbox" ? doAndLeave("archive") : doAndLeave("inbox"))}>
                        <Icon name="close" size={12} />
                      </button>
                    ) : null}
                  </span>
                )}
              </h2>
              <div className="subj-actions">
                <button className="icon-btn" data-tip="Print all" aria-label="Print" onClick={print}>
                  <Icon name="print" size={20} />
                </button>
                <button className="icon-btn" data-tip="In new window" aria-label="Open in new window" onClick={() => window.open(window.location.href, "_blank", "noopener,width=900,height=800")}>
                  <Icon name="openNew" size={20} />
                </button>
              </div>
            </div>
            {thread.map((t) => {
              const isOpen = expanded.has(t.id);
              if (!isOpen)
                return (
                  <div key={t.id} className="thread-collapsed" role="button" tabIndex={0} onClick={() => setExpanded(new Set([...expanded, t.id]))} onKeyDown={(e) => e.key === "Enter" && setExpanded(new Set([...expanded, t.id]))}>
                    <SenderAvatar a={t.from} mine={myAddresses.includes(t.from.address.toLowerCase())} picture={me.picture} />
                    <div className="t-main">
                      <div className="t-top">
                        <span className="t-from">{t.from.name || t.from.address}</span>
                        <span className="t-date" title={fullDate(t.date)}>
                          {longDate(t.date)}
                        </span>
                      </div>
                      <div className="t-snip">{t.snippet || "\u00a0"}</div>
                    </div>
                    <button
                      className={`icon-btn t-star${t.starred ? " on" : ""}`}
                      aria-label={t.starred ? "Starred" : "Not starred"}
                      data-tip={t.starred ? "Starred" : "Not starred"}
                      onClick={(e) => {
                        e.stopPropagation();
                        act([t.id], t.starred ? "unstar" : "star", { silent: true });
                        setMsg((cur) => (cur ? { ...cur, thread: cur.thread.map((x) => (x.id === t.id ? { ...x, starred: !x.starred } : x)) } : cur));
                      }}
                    >
                      <Icon name={t.starred ? "star" : "starBorder"} size={20} />
                    </button>
                  </div>
                );
              return <MessageCard key={t.id} id={t.id} preset={loaded[t.id]} onLoaded={(m) => setLoaded((l) => ({ ...l, [t.id]: m }))} onStar={t.id === id ? toggleStar : undefined} />;
            })}
            <div className="reply-bar">
              <button className="btn outline" onClick={() => compose({ replyTo: msg, mode: prefs.replyAll ? "replyAll" : "reply" })}>
                <Icon name={prefs.replyAll ? "replyAll" : "reply"} size={20} />
                {prefs.replyAll ? "Reply all" : "Reply"}
              </button>
              {!prefs.replyAll && msg.to.length + msg.cc.length > 1 && (
                <button className="btn outline" onClick={() => compose({ replyTo: msg, mode: "replyAll" })}>
                  <Icon name="replyAll" size={20} />
                  Reply all
                </button>
              )}
              <button className="btn outline" onClick={() => compose({ replyTo: msg, mode: "forward" })}>
                <Icon name="reply" size={20} flip />
                Forward
              </button>
              <EmojiReply msg={msg} />
            </div>
          </>
        )}
      </div>
      {menu?.kind === "more" && msg && (
        <Popover anchor={menu.a} onClose={() => setMenu(null)}>
          <MenuItem icon="reply" onClick={() => (setMenu(null), compose({ replyTo: msg, mode: "reply" }))}>
            Reply
          </MenuItem>
          <MenuItem icon="replyAll" onClick={() => (setMenu(null), compose({ replyTo: msg, mode: "replyAll" }))}>
            Reply all
          </MenuItem>
          <MenuItem icon="forward" onClick={() => (setMenu(null), compose({ replyTo: msg, mode: "forward" }))}>
            Forward
          </MenuItem>
          <MenuSep />
          {role !== "trash" && role !== "spam" && (
            <MenuItem icon="clock" onClick={() => setMenu({ kind: "snooze", a: menu.a })}>
              Snooze
            </MenuItem>
          )}
          <MenuItem icon="label" onClick={() => setMenu({ kind: "label", a: menu.a })}>
            Label as
          </MenuItem>
          <MenuItem icon={msg.important ? "important" : "importantFilled"} onClick={() => (setMenu(null), act([id], msg.important ? "notimportant" : "important", { silent: true }), setMsg({ ...msg, important: !msg.important }))}>
            {msg.important ? "Mark as not important" : "Mark as important"}
          </MenuItem>
          <MenuItem
            icon="tune"
            onClick={() => {
              sessionStorage.setItem("webmail:newFilter", JSON.stringify({ from: msg.from.address }));
              setMenu(null);
              go({ view: "settings", settings: "filters", msg: undefined });
            }}
          >
            Filter messages like this
          </MenuItem>
          <MenuItem icon="print" onClick={() => (setMenu(null), print())}>
            Print
          </MenuItem>
          <MenuItem icon="download" onClick={() => (setMenu(null), window.open(`/api/messages/${id}/raw?download=1`, "_blank", "noopener"))}>
            Download message
          </MenuItem>
          <MenuItem icon="file" onClick={() => (setMenu(null), window.open(`/api/messages/${id}/raw`, "_blank", "noopener"))}>
            Show original
          </MenuItem>
          <MenuSep />
          <MenuItem
            icon="spam"
            onClick={async () => {
              setMenu(null);
              try {
                await api("/api/filters", { method: "PATCH", body: { block: msg.from.address } });
                snack(`Blocked ${msg.from.address}. Future messages will go to Spam.`);
              } catch (e) {
                snack((e as Error).message);
              }
            }}
          >
            Block &quot;{msg.from.name || msg.from.address}&quot;
          </MenuItem>
        </Popover>
      )}
      {menu?.kind === "snooze" && <SnoozeMenu anchor={menu.a} onClose={() => setMenu(null)} onPick={(t) => doAndLeave("snooze", { until: t })} />}
      {menu?.kind === "move" && msg && (
        <FolderPicker anchor={menu.a} onClose={() => setMenu(null)} title="Move to:" folders={folders} exclude={msg.folder} onPick={(f) => doAndLeave(f.role === "trash" ? "trash" : f.role === "spam" ? "spam" : "move", { target: f.path, label: f.name })} />
      )}
      {menu?.kind === "label" && msg && <FolderPicker anchor={menu.a} onClose={() => setMenu(null)} title="Label as:" folders={folders.filter((f) => f.role === "label" || f.role === "archive")} onPick={(f) => act([id], "copy", { target: f.path, label: f.name })} />}
    </>
  );
}

function EmojiReply({ msg }: { msg: MessageDetail }) {
  const { compose } = useApp();
  const [a, setA] = useState<Anchor | null>(null);
  const emojis = ["👍", "❤️", "😂", "🎉", "😮", "🙏", "👀", "✅"];
  return (
    <>
      <button className="icon-btn" style={{ border: "1px solid #747775", width: 36, height: 36 }} data-tip="Reply with an emoji" aria-label="Reply with an emoji" onClick={(e) => setA(anchorOf(e, "left", "above"))}>
        <Icon name="smile" size={20} />
      </button>
      {a && (
        <Popover anchor={a} onClose={() => setA(null)} style={{ display: "flex", padding: 6, gap: 2 }}>
          {emojis.map((em) => (
            <button
              key={em}
              className="icon-btn"
              style={{ fontSize: 20 }}
              onClick={() => {
                setA(null);
                compose({ replyTo: msg, mode: "reply", body: em });
              }}
            >
              {em}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

function MessageCard({ id, preset, onLoaded, onStar }: { id: string; preset?: MessageDetail; onLoaded: (m: MessageDetail) => void; onStar?: () => void }) {
  const { prefs, compose, myAddresses, act, snack, me } = useApp();
  const [m, setM] = useState<MessageDetail | null>(preset ?? null);
  const [showImages, setShowImages] = useState(false);
  const [details, setDetails] = useState(false);
  const [menu, setMenu] = useState<Anchor | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(80);

  useEffect(() => {
    if (preset) {
      setM(preset);
      return;
    }
    api<MessageDetail>(`/api/messages/${id}`)
      .then((x) => {
        setM(x);
        onLoaded(x);
      })
      .catch((e) => snack((e as Error).message));
  }, [id]);

  const fit = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.documentElement || !doc.body) return;
    const avail = frame.current!.clientWidth;
    doc.body.style.zoom = "1";
    const wide = doc.documentElement.scrollWidth;
    if (avail > 0 && wide > avail + 2) doc.body.style.zoom = String(Math.max(0.3, avail / wide));
    const next = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
    setH(next + 2);
  }, []);

  const onLoad = () => {
    fit();
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", fit));
    try {
      const ro = new ResizeObserver(fit);
      if (doc.body) ro.observe(doc.body);
    } catch {
    }
    doc.addEventListener("click", (ev) => {
      const a = (ev.target as Element)?.closest?.("a");
      const href = a?.getAttribute("href") || "";
      if (href.toLowerCase().startsWith("mailto:")) {
        ev.preventDefault();
        const u = new URL(href);
        compose({ to: decodeURIComponent(u.pathname), subject: u.searchParams.get("subject") || "", body: u.searchParams.get("body") || "" });
      }
    });
  };

  if (!m)
    return (
      <div style={{ padding: 20, display: "flex", justifyContent: "center" }}>
        <div className="spinner" />
      </div>
    );

  const allowImages = prefs.externalImages || showImages;
  const toList = [...m.to, ...m.cc].map((a) => (myAddresses.includes(a.address.toLowerCase()) ? "me" : shortName(a)));
  const src = `/api/messages/${id}/body${allowImages ? "?images=1" : ""}`;

  return (
    <div className="msg">
      <div className="msg-head">
        <SenderAvatar a={m.from} mine={myAddresses.includes(m.from.address.toLowerCase())} picture={me.picture} />
        <div className="msg-meta">
          <div className="msg-from">
            <b title={m.from.address}>{m.from.name || m.from.address}</b>
            {m.from.name && !isDirectoryAddress(m.from.address) && <span className="addr">&lt;{m.from.address}&gt;</span>}
            {m.listUnsubscribe && (
              <a className="unsub" href={m.listUnsubscribe} target="_blank" rel="noopener noreferrer nofollow">
                Unsubscribe
              </a>
            )}
          </div>
          <button className="msg-to" onClick={() => setDetails((d) => !d)} aria-label="Show details">
            to {toList.join(", ") || "undisclosed recipients"}
            <Icon name="dropDown" size={18} />
          </button>
          {details && (
            <>
              <div className="backdrop" style={{ zIndex: 19 }} onMouseDown={() => setDetails(false)} />
              <div className="msg-details">
                <table>
                  <tbody>
                    <tr>
                      <td>from:</td>
                      <td>
                        <b>{m.from.name}</b> &lt;{m.from.address}&gt;
                      </td>
                    </tr>
                    {m.replyTo.length > 0 && (
                      <tr>
                        <td>reply-to:</td>
                        <td>{m.replyTo.map((a) => a.address).join(", ")}</td>
                      </tr>
                    )}
                    <tr>
                      <td>to:</td>
                      <td>{m.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ")}</td>
                    </tr>
                    {m.cc.length > 0 && (
                      <tr>
                        <td>cc:</td>
                        <td>{m.cc.map((a) => a.address).join(", ")}</td>
                      </tr>
                    )}
                    <tr>
                      <td>date:</td>
                      <td>{fullDate(m.date)}</td>
                    </tr>
                    <tr>
                      <td>subject:</td>
                      <td>{m.subject}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="msg-right">
          <span className="date" title={fullDate(m.date)}>
            {longDate(m.date)}
          </span>
          {onStar && (
            <button className="icon-btn" data-tip={m.starred ? "Starred" : "Not starred"} aria-label="Star" onClick={() => (onStar(), setM({ ...m, starred: !m.starred }))} style={m.starred ? { color: "#f4b400" } : undefined}>
              <Icon name={m.starred ? "star" : "starBorder"} size={20} />
            </button>
          )}
          <button className="icon-btn" data-tip="Add reaction" aria-label="Add reaction" onClick={() => compose({ replyTo: m, mode: "reply", body: "👍" })}>
            <Icon name="smile" size={20} />
          </button>
          <button className="icon-btn" data-tip="Reply" aria-label="Reply" onClick={() => compose({ replyTo: m, mode: "reply" })}>
            <Icon name="reply" size={20} />
          </button>
          <button className="icon-btn" data-tip="More" aria-label="More" onClick={(e) => setMenu(anchorOf(e, "right"))}>
            <Icon name="more" size={20} />
          </button>
        </div>
      </div>
      {m.hasRemoteImages && !allowImages && (
        <div className="images-bar">
          Images are not displayed.{" "}
          <button className="link-btn" style={{ fontSize: 13 }} onClick={() => setShowImages(true)}>
            Display images below
          </button>
        </div>
      )}
      <div className="msg-body">
        <iframe
          ref={frame}
          key={src}
          src={src}
          title={`Message from ${m.from.name || m.from.address}`}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          style={{ height: h }}
          onLoad={onLoad}
        />
      </div>
      {m.bodyAttachments.length > 0 && (
        <div className="msg-atts">
          <div className="att-title">
            {m.bodyAttachments.length === 1 ? "One attachment" : `${m.bodyAttachments.length} attachments`}
            <span style={{ color: "var(--text3)", fontWeight: 400, fontSize: 12, marginLeft: 8 }}>• Scanned by the TJHSST mail servers</span>
          </div>
          <div className="att-cards">
            {m.bodyAttachments.map((a) => {
              const img = /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(a.contentType);
              return (
                <a key={a.part} className="att-card" href={`/api/messages/${id}/attachments/${a.part}${img || a.contentType === "application/pdf" ? "?view=1" : ""}`} target="_blank" rel="noopener noreferrer" title={`${a.filename} (${bytes(a.size)})`}>
                  <div className="att-prev">
                    {img ? (
                      <img src={`/api/messages/${id}/attachments/${a.part}?inline=1`} alt="" />
                    ) : (
                      <Icon name={a.contentType === "application/pdf" ? "pdf" : "file"} size={40} style={{ color: a.contentType === "application/pdf" ? "#ea4335" : "#4285f4" }} />
                    )}
                  </div>
                  <div className="att-name">
                    <Icon name={a.contentType === "application/pdf" ? "pdf" : img ? "image" : "file"} size={16} style={{ color: "#ea4335", flex: "0 0 auto" }} />
                    <span>{a.filename}</span>
                    <a
                      href={`/api/messages/${id}/attachments/${a.part}`}
                      download
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginLeft: "auto", color: "var(--text2)", display: "flex" }}
                      aria-label={`Download ${a.filename}`}
                      data-tip="Download"
                    >
                      <Icon name="download" size={18} />
                    </a>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)}>
          <MenuItem icon="reply" onClick={() => (setMenu(null), compose({ replyTo: m, mode: "reply" }))}>
            Reply
          </MenuItem>
          <MenuItem icon="replyAll" onClick={() => (setMenu(null), compose({ replyTo: m, mode: "replyAll" }))}>
            Reply all
          </MenuItem>
          <MenuItem icon="forward" onClick={() => (setMenu(null), compose({ replyTo: m, mode: "forward" }))}>
            Forward
          </MenuItem>
          <MenuSep />
          <MenuItem icon="delete" onClick={() => (setMenu(null), act([m.id], "trash"))}>
            Delete this message
          </MenuItem>
          <MenuItem icon="markUnread" onClick={() => (setMenu(null), act([m.id], "unread", { silent: true }))}>
            Mark as unread
          </MenuItem>
          <MenuItem icon="file" onClick={() => (setMenu(null), window.open(`/api/messages/${m.id}/raw`, "_blank", "noopener"))}>
            Show original
          </MenuItem>
        </Popover>
      )}
    </div>
  );
}
