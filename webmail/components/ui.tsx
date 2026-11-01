"use client";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, IconName } from "./icons";

export type Anchor = { rect: DOMRect; align?: "left" | "right"; place?: "below" | "above" };

export function anchorOf(e: { currentTarget: Element }, align: "left" | "right" = "left", place: "below" | "above" = "below"): Anchor {
  return { rect: e.currentTarget.getBoundingClientRect(), align, place };
}

export function Popover({ anchor, onClose, children, className = "menu", offsetY = 0, offsetX = 0, style }: { anchor: Anchor; onClose: () => void; children: ReactNode; className?: string; offsetY?: number; offsetX?: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const r = anchor.rect;
    let left = anchor.align === "right" ? r.right - w : r.left;
    let top = anchor.place === "above" ? r.top - h - 4 : r.bottom + 2;
    left += offsetX;
    top += offsetY;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    if (top + h > window.innerHeight - 8) top = Math.max(8, anchor.place === "above" ? 8 : r.top - h - 2);
    setPos({ left, top });
  }, [anchor, offsetX, offsetY]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <>
      <div className="backdrop" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div ref={ref} className={className} style={{ ...style, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }} role="menu">
        {children}
      </div>
    </>,
    document.body,
  );
}

export function MenuItem({ icon, children, onClick, disabled, hint, right, iconSize = 20, highlighted }: { icon?: IconName; children: ReactNode; onClick?: () => void; disabled?: boolean; hint?: boolean; right?: ReactNode; iconSize?: number; highlighted?: boolean }) {
  if (hint) return <div className="mi hint">{children}</div>;
  return (
    <button className={`mi${icon ? " with-icon" : ""}${disabled ? " disabled" : ""}${highlighted ? " hl" : ""}`} onClick={disabled ? undefined : onClick} role="menuitem" disabled={disabled}>
      {icon && <Icon name={icon} size={iconSize} />}
      <span className="grow">{children}</span>
      {right}
    </button>
  );
}

export function MenuSep() {
  return <div className="msep" />;
}

export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; left: number; top: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: Element | null = null;
    const over = (e: MouseEvent) => {
      const el = (e.target as Element)?.closest?.("[data-tip]");
      if (el === current) return;
      current = el;
      if (timer) clearTimeout(timer);
      setTip(null);
      if (!el) return;
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        const text = el.getAttribute("data-tip") || "";
        const w = text.length * 6.6 + 16;
        setTip({ text, left: Math.max(4, Math.min(window.innerWidth - w - 4, r.left + r.width / 2 - w / 2)), top: r.bottom + 4 });
      }, 600);
    };
    const hide = () => {
      if (timer) clearTimeout(timer);
      current = null;
      setTip(null);
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mousedown", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mousedown", hide);
      document.removeEventListener("scroll", hide, true);
    };
  }, []);
  if (!tip) return null;
  return (
    <div className="tooltip" style={{ left: tip.left, top: tip.top }}>
      {tip.text}
    </div>
  );
}

export type Snack = { id: number; text: string; actions?: { label: string; run: () => void }[]; timeout?: number };

export function Snackbar({ snack, onClose }: { snack: Snack | null; onClose: () => void }) {
  useEffect(() => {
    if (!snack) return;
    const t = setTimeout(onClose, snack.timeout ?? 6000);
    return () => clearTimeout(t);
  }, [snack, onClose]);
  if (!snack) return null;
  return (
    <div className="snackbar" role="status">
      <span style={{ flex: 1 }}>{snack.text}</span>
      {snack.actions?.map((a) => (
        <button
          key={a.label}
          onClick={() => {
            a.run();
            onClose();
          }}
        >
          {a.label}
        </button>
      ))}
      <button className="x" aria-label="Dismiss" onClick={onClose}>
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}

export function Dialog({ title, children, onClose, actions }: { title: string; children: ReactNode; onClose: () => void; actions: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div className="dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
        <div className="d-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}

export function PromptDialog({ title, label, initial = "", okLabel = "Create", onOk, onClose, extra }: { title: string; label: string; initial?: string; okLabel?: string; onOk: (v: string) => void; onClose: () => void; extra?: ReactNode }) {
  const [v, setV] = useState(initial);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
          <button className="btn text" disabled={!v.trim()} onClick={() => onOk(v.trim())}>
            {okLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 14, marginBottom: 8 }}>{label}</div>
      <input
        className="field"
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v.trim()) onOk(v.trim());
        }}
      />
      {extra}
    </Dialog>
  );
}
