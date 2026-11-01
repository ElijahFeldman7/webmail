"use client";
import { useState } from "react";
import type { Addr } from "@/lib/types";

const PALETTE = ["#d32f2f", "#c2185b", "#7b1fa2", "#512da8", "#303f9f", "#1976d2", "#0288d1", "#0097a7", "#00796b", "#388e3c", "#689f38", "#afb42b", "#f57c00", "#e64a19", "#5d4037", "#616161", "#455a64"];
const DIRECTORY = /(^|\.)(tjhsst\.edu|fcps\.edu)$/i;

export function isDirectoryAddress(address: string) {
  return DIRECTORY.test(address.split("@")[1] || "");
}

const LETTERS: Record<string, string> = {
  A: "#5d4037", B: "#1976d2", C: "#c2185b", D: "#00796b", E: "#7b1fa2", F: "#e64a19", G: "#388e3c", H: "#0288d1", I: "#689f38",
  J: "#f57c00", K: "#303f9f", L: "#0097a7", M: "#d32f2f", N: "#455a64", O: "#afb42b", P: "#7b1fa2", Q: "#616161", R: "#c2185b",
  S: "#1976d2", T: "#512da8", U: "#00796b", V: "#e64a19", W: "#388e3c", X: "#5d4037", Y: "#f57c00", Z: "#303f9f",
};

export function letterColor(key: string) {
  const ch = (key.match(/[\p{L}\p{N}]/u)?.[0] ?? "").toUpperCase();
  if (LETTERS[ch]) return LETTERS[ch];
  let h = 0;
  for (const c of key.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initial(a: Addr) {
  return ((a.name || a.address).match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
}

export function shortName(a: Addr) {
  if (!a.name) return a.address;
  if (a.name.includes(",")) return a.name.split(",")[1].trim().split(/\s+/)[0] || a.name;
  return a.name.trim().split(/\s+/)[0];
}

export function SenderAvatar({ a, mine, picture, size = 40 }: { a: Addr; mine?: boolean; picture?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, flex: `0 0 ${size}px`, fontSize: Math.round(size * 0.5) };
  if (mine && picture && !broken)
    return (
      <span className="sav" style={style}>
        <img src={picture} alt="" onError={() => setBroken(true)} />
      </span>
    );
  if (mine || isDirectoryAddress(a.address))
    return (
      <span className="sav" style={{ ...style, background: letterColor(initial(a)) }} aria-hidden="true">
        {initial(a)}
      </span>
    );
  return (
    <span className="sav" style={{ ...style, background: "#c2d4f0" }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 40 40">
        <circle cx="20" cy="15.5" r="7" fill="#5f87d3" />
        <path d="M6 37c1.5-7.5 7.5-11.5 14-11.5S32.5 29.5 34 37z" fill="#5f87d3" />
      </svg>
    </span>
  );
}
