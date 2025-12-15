import { LAST_DEBUG_EVENTS_KEY } from "../constants";
import { getDebugMode } from "../state/storage";

export type RsdhDebugEventKind = "step" | "info" | "warn" | "error";

export type RsdhDebugEvent = {
  t: string;
  kind: RsdhDebugEventKind;
  scope?: string;
  msg: string;
  data?: any;
};

function safeJson(val: any, maxLen = 6000): any {
  try {
    const s = JSON.stringify(val);
    if (!s) return null;
    if (s.length <= maxLen) return val;
    return { _truncated: true, _len: s.length };
  } catch {
    return { _unserializable: true };
  }
}

function readEvents(): RsdhDebugEvent[] {
  try {
    const raw = String(localStorage.getItem(LAST_DEBUG_EVENTS_KEY) || "");
    if (!raw.trim()) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as RsdhDebugEvent[]) : [];
  } catch {
    return [];
  }
}

function writeEvents(evts: RsdhDebugEvent[]) {
  try {
    localStorage.setItem(LAST_DEBUG_EVENTS_KEY, JSON.stringify(evts.slice(-250)));
  } catch {
    // ignore
  }
}

export function clearDebugEvents() {
  try {
    localStorage.removeItem(LAST_DEBUG_EVENTS_KEY);
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent("rsdh-debug-events", { detail: { events: [] } }));
  } catch {
    // ignore
  }
}

export function emitDebugEvent(kind: RsdhDebugEventKind, msg: string, opts?: { scope?: string; data?: any }) {
  if (!getDebugMode()) return;
  const e: RsdhDebugEvent = {
    t: new Date().toISOString(),
    kind,
    scope: opts?.scope,
    msg: String(msg || ""),
    data: safeJson(opts?.data),
  };

  const all = readEvents();
  all.push(e);
  writeEvents(all);

  try {
    window.dispatchEvent(new CustomEvent("rsdh-debug-event", { detail: e }));
    window.dispatchEvent(new CustomEvent("rsdh-debug-events", { detail: { events: all.slice(-250) } }));
  } catch {
    // ignore
  }
}


