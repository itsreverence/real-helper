export type Tab = "context" | "results" | "settings" | "debug";

type UiState = {
  tab: Tab;
  hidden: boolean;
};

const KEY = "rsdh_svelte_ui_state";

export function getUiState(): UiState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { tab: "context", hidden: false };
    const obj = JSON.parse(raw);
    // Back-compat: legacy tabs "actions"/"output" map to "context"
    const t = String(obj?.tab || "context");
    const tab: Tab = (t === "settings") ? "settings" : (t === "results") ? "results" : (t === "debug") ? "debug" : "context";
    return { tab, hidden: !!obj?.hidden };
  } catch {
    return { tab: "context", hidden: false };
  }
}

export function setUiState(partial: Partial<UiState>) {
  const cur = getUiState();
  const next: UiState = { ...cur, ...partial };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }

  // Notify the entrypoint so it can toggle panel/handle visibility.
  try {
    window.dispatchEvent(new CustomEvent("rsdh-ui-state", { detail: next }));
  } catch {
    // ignore
  }
}



