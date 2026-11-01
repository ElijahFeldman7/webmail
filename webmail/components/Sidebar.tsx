"use client";
import { useState } from "react";
import { useApp } from "./App";
import { Icon, IconName } from "./icons";
import { Anchor, anchorOf, MenuItem, Popover, PromptDialog, Dialog } from "./ui";
import { api } from "@/lib/client/api";
import type { Folder } from "@/lib/types";

type Item = { key: string; label: string; icon: IconName; activeIcon?: IconName; hash: string; count?: number; bold?: boolean; role?: string };

export const DRAG_MIME = "application/x-webmail-ids";

export function Sidebar() {
  const { route, go, folders, prefs, savePrefs, compose, list, act, reloadFolders, snack, narrow, drawer, setDrawer, setPanel } = useApp();
  const [more, setMore] = useState(false);
  const [newLabel, setNewLabel] = useState<{ parent?: string } | null>(null);
  const [labelMenu, setLabelMenu] = useState<{ f: Folder; a: Anchor } | null>(null);
  const [rename, setRename] = useState<Folder | null>(null);
  const [remove, setRemove] = useState<Folder | null>(null);
  const [dropOver, setDropOver] = useState<string | null>(null);
  const [hoverExpand, setHoverExpand] = useState(false);
  const collapsed = !narrow && prefs.sidebarCollapsed && !hoverExpand;

  const f = (role: string) => folders.find((x) => x.role === role);
  const inboxUnread = list?.tabs?.find((t) => t.key === "primary")?.newCount ?? f("inbox")?.unread ?? 0;
  const spam = f("spam");
  const drafts = f("drafts");

  const primary: Item[] = [
    { key: "inbox", label: "Inbox", icon: "inbox", activeIcon: "inboxFilled", hash: "#inbox", count: inboxUnread || undefined, bold: inboxUnread > 0, role: "inbox" },
    { key: "starred", label: "Starred", icon: "starBorder", activeIcon: "star", hash: "#starred" },
    { key: "snoozed", label: "Snoozed", icon: "clock", hash: "#snoozed", role: "snoozed" },
    { key: "sent", label: "Sent", icon: "send", activeIcon: "sendFilled", hash: "#sent", role: "sent" },
    { key: "drafts", label: "Drafts", icon: "draft", activeIcon: "draftFilled", hash: "#drafts", count: drafts?.total || undefined, bold: !!drafts?.total, role: "drafts" },
    { key: "purchases", label: "Purchases", icon: "bag", hash: "#purchases" },
  ];
  const extra: Item[] = [
    { key: "imp", label: "Important", icon: "important", activeIcon: "importantFilled", hash: "#imp" },
    { key: "scheduled", label: "Scheduled", icon: "scheduledSend", hash: "#scheduled" },
    { key: "all", label: "All Mail", icon: "allMail", hash: "#all" },
    { key: "spam", label: "Spam", icon: "spam", hash: "#spam", count: spam?.unread || undefined, bold: !!spam?.unread, role: "spam" },
    { key: "trash", label: "Trash", icon: "delete", hash: "#trash", role: "trash" },
  ];

  const activeKey = route.view === "label" ? `label:${route.label}` : route.view;
  const labels = folders.filter((x) => x.role === "label").filter((x) => !prefs.hiddenLabels.includes(x.path));

  const onDrop = async (e: React.DragEvent, target: { role?: string; path?: string; key: string }) => {
    e.preventDefault();
    setDropOver(null);
    const ids = JSON.parse(e.dataTransfer.getData(DRAG_MIME) || "[]") as string[];
    if (!ids.length) return;
    if (target.key === "starred") return act(ids, "star");
    if (target.key === "imp") return act(ids, "important");
    if (target.role === "trash") return act(ids, "trash");
    if (target.role === "spam") return act(ids, "spam");
    if (target.role === "inbox") return act(ids, "inbox");
    const path = target.path ?? folders.find((x) => x.role === target.role)?.path;
    if (path) act(ids, "move", { target: path, label: folders.find((x) => x.path === path)?.name });
  };

  const dropProps = (key: string, role?: string, path?: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes(DRAG_MIME)) {
        e.preventDefault();
        setDropOver(key);
      }
    },
    onDragLeave: () => setDropOver((d) => (d === key ? null : d)),
    onDrop: (e: React.DragEvent) => onDrop(e, { key, role, path }),
  });

  const renderItem = (it: Item) => {
    const active = activeKey === it.key;
    return (
      <a
        key={it.key}
        href={it.hash}
        className={`nav-item${active ? " active" : ""}${it.bold && !active ? " bold" : ""}`}
        style={dropOver === it.key ? { background: "#e8f0fe" } : undefined}
        data-tip={collapsed ? it.label : undefined}
        onClick={(e) => {
          if (active && !route.msg) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("webmail:refresh"));
          }
        }}
        {...dropProps(it.key, it.role)}
      >
        <Icon name={active && it.activeIcon ? it.activeIcon : it.icon} className="nav-icon" />
        <span className="nav-label">{it.label}</span>
        {it.count ? <span className="nav-count">{it.count}</span> : null}
      </a>
    );
  };

  const depth = (x: Folder) => (x.delimiter ? x.path.split(x.delimiter).length - 1 : 0);

  return (
    <>
    {narrow && drawer && <div className="drawer-bg" onClick={() => setDrawer(false)} />}
    <nav
      className={`sidebar${collapsed ? " collapsed" : ""}${narrow ? " drawer" : ""}${narrow && drawer ? " open" : ""}`}
      aria-label="Mailboxes"
      aria-hidden={narrow && !drawer ? true : undefined}
      onMouseEnter={() => prefs.sidebarCollapsed && setHoverExpand(false)}
      onClick={(e) => {
        if (narrow && (e.target as HTMLElement).closest("a")) setDrawer(false);
      }}
    >
      {narrow && (
        <div className="drawer-hdr">
          <img src="/tjlogo.png" width={32} height={32} alt="" />
          <span>TJ Mail</span>
        </div>
      )}
      <button className="compose-btn" onClick={() => (setDrawer(false), compose())} data-tip={collapsed ? "Compose" : undefined}>
        <Icon name="edit" size={24} />
        {!collapsed && "Compose"}
      </button>
      <div className="nav-scroll">
        {primary.map(renderItem)}
        <button className="nav-item" onClick={() => setMore((m) => !m)}>
          <Icon name={more ? "expandLess" : "expandMore"} className="nav-icon" />
          <span className="nav-label">{more ? "Less" : "More"}</span>
        </button>
        {more && (
          <>
            {extra.map(renderItem)}
            <a href={`#search/${encodeURIComponent("has:unsubscribe")}`} className="nav-item">
              <Icon name="subscriptions" className="nav-icon" />
              <span className="nav-label">Manage subscriptions</span>
            </a>
            <a href="#settings/labels" className="nav-item">
              <Icon name="settings" className="nav-icon" />
              <span className="nav-label">Manage labels</span>
            </a>
            <button className="nav-item" onClick={() => setNewLabel({})}>
              <Icon name="add" className="nav-icon" />
              <span className="nav-label">Create new label</span>
            </button>
          </>
        )}
        <div className="labels-hdr">
          <span>Labels</span>
          <button className="icon-btn sm" data-tip="Create new label" aria-label="Create new label" onClick={() => setNewLabel({})}>
            <Icon name="add" size={20} />
          </button>
        </div>
        {labels.map((x) => {
          const key = `label:${x.path}`;
          const active = activeKey === key;
          return (
            <a
              key={x.path}
              href={`#label/${encodeURIComponent(x.path)}`}
              className={`nav-item${active ? " active" : ""}${x.unread && !active ? " bold" : ""}`}
              style={{ paddingLeft: 26 + depth(x) * 12, ...(dropOver === key ? { background: "#e8f0fe" } : null) }}
              onContextMenu={(e) => {
                e.preventDefault();
                setLabelMenu({ f: x, a: { rect: new DOMRect(e.clientX, e.clientY, 0, 0) } });
              }}
              data-tip={collapsed ? x.name : undefined}
              {...dropProps(key, undefined, x.path)}
            >
              <Icon name={active ? "labelFilled" : "label"} className="nav-icon" />
              <span className="nav-label">{x.name}</span>
              {x.unread ? <span className="nav-count">{x.unread}</span> : null}
              {x.role === "label" && (
                <span
                  role="button"
                  className="icon-btn sm label-more"
                  style={{ width: 24, height: 24, marginRight: -6, display: "none" }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setLabelMenu({ f: x, a: anchorOf(e) });
                  }}
                >
                  <Icon name="more" size={18} />
                </span>
              )}
            </a>
          );
        })}
        {narrow && (
          <>
            <div className="labels-hdr">
              <span>Apps</span>
            </div>
            {(
              [
                ["calendar", "Calendar", "clock"],
                ["tasks", "Tasks", "addTask"],
                ["keep", "Keep", "edit"],
                ["contacts", "Contacts", "person"],
              ] as const
            ).map(([k, l, ic]) => (
              <button key={k} className="nav-item" onClick={() => (setPanel(k), setDrawer(false))}>
                <Icon name={ic} className="nav-icon" />
                <span className="nav-label">{l}</span>
              </button>
            ))}
            <a href="#settings/general" className="nav-item">
              <Icon name="settings" className="nav-icon" />
              <span className="nav-label">Settings</span>
            </a>
            <a href="https://guides.tjhsst.edu" target="_blank" rel="noopener noreferrer" className="nav-item">
              <Icon name="help" className="nav-icon" />
              <span className="nav-label">Help</span>
            </a>
          </>
        )}
      </div>
      <style>{`.nav-item:hover .label-more{display:inline-flex!important}`}</style>
      {labelMenu && (
        <Popover anchor={labelMenu.a} onClose={() => setLabelMenu(null)}>
          <MenuItem disabled hint>
            In label list
          </MenuItem>
          <MenuItem
            onClick={() => {
              savePrefs({ hiddenLabels: [...prefs.hiddenLabels, labelMenu.f.path] });
              setLabelMenu(null);
            }}
          >
            Hide
          </MenuItem>
          <div className="msep" />
          <MenuItem onClick={() => (setRename(labelMenu.f), setLabelMenu(null))}>Edit</MenuItem>
          <MenuItem onClick={() => (setRemove(labelMenu.f), setLabelMenu(null))}>Remove label</MenuItem>
          <MenuItem onClick={() => (setNewLabel({ parent: labelMenu.f.path }), setLabelMenu(null))}>Add sublabel</MenuItem>
        </Popover>
      )}
      {newLabel && (
        <PromptDialog
          title="New label"
          label={newLabel.parent ? `Please enter a new label name (nested under "${newLabel.parent}"):` : "Please enter a new label name:"}
          onClose={() => setNewLabel(null)}
          onOk={async (name) => {
            try {
              await api("/api/folders", { body: { name, parent: newLabel.parent } });
              snack(`Label "${name}" created.`);
              reloadFolders(true);
            } catch (e) {
              snack((e as Error).message);
            }
            setNewLabel(null);
          }}
        />
      )}
      {rename && (
        <PromptDialog
          title="Edit label"
          label="Label name:"
          initial={rename.name}
          okLabel="Save"
          onClose={() => setRename(null)}
          onOk={async (name) => {
            try {
              const r = await api<{ path: string }>("/api/folders", { method: "PATCH", body: { path: rename.path, name } });
              reloadFolders(true);
              if (route.view === "label" && route.label === rename.path) go({ view: "label", label: r.path });
            } catch (e) {
              snack((e as Error).message);
            }
            setRename(null);
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
                    snack(`Label "${remove.name}" removed.`);
                    reloadFolders(true);
                    if (route.view === "label" && route.label === remove.path) go({ view: "inbox" });
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
          Delete the label &quot;{remove.name}&quot;? On this mail server labels are folders, so messages in it will be deleted too.
          {remove.total > 0 && <b> It contains {remove.total} messages.</b>}
        </Dialog>
      )}
    </nav>
    </>
  );
}
