export function gmGet<T>(key: string, fallback: T): T {
  try {
    if (typeof GM_getValue === "function") return GM_getValue<T>(key, fallback);
  } catch {
    // ignore
  }
  try {
    const raw = localStorage.getItem(key);
    return (raw == null ? fallback : (raw as unknown as T));
  } catch {
    return fallback;
  }
}

export function gmSet<T>(key: string, val: T) {
  try {
    if (typeof GM_setValue === "function") {
      GM_setValue(key, val);
      return;
    }
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(key, String(val));
  } catch {
    // ignore
  }
}

export function getDebugMode(): boolean {
  try {
    return localStorage.getItem("rsdh_debug_mode") === "1";
  } catch {
    return false;
  }
}

export function setDebugMode(on: boolean) {
  try {
    localStorage.setItem("rsdh_debug_mode", on ? "1" : "0");
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent("rsdh-debug-mode", { detail: { on } }));
  } catch {
    // ignore
  }
}



