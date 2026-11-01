"use client";

let csrf = "";
export function setCsrf(t: string) {
  csrf = t;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public reauth = false) {
    super(message);
  }
}

let onAuthLost: (() => void) | null = null;
export function setOnAuthLost(fn: () => void) {
  onAuthLost = fn;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method || (opts.body !== undefined || opts.form ? "POST" : "GET");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") headers["X-CSRF-Token"] = csrf;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method, headers, body, credentials: "same-origin", signal: opts.signal, cache: "no-store" });
  if (!res.ok) {
    let msg = res.statusText;
    let reauth = false;
    try {
      const j = await res.json();
      msg = j.error || msg;
      reauth = !!j.reauth;
    } catch {
    }
    if (res.status === 401 && onAuthLost) onAuthLost();
    throw new ApiError(msg, res.status, reauth);
  }
  return (await res.json()) as T;
}
