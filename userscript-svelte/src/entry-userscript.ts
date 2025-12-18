import cssText from "./ui/app.css?inline";
import App from "./ui/App.svelte";
import { mount as svelteMount } from "svelte";
import { detectAccentCss } from "./core/ui/theme";
import { getUiState, setUiState } from "./ui/services/state";
import { startModalActionInjection } from "./core/ui/modalActions";
// Debug HUD removed - now integrated into Debug tab in main panel

function ensureHost() {
  const id = "rsdh-svelte-root";
  let host = document.getElementById(id);
  if (!host) {
    host = document.createElement("div");
    host.id = id;
    document.documentElement.appendChild(host);
  }
  return host as HTMLElement;
}

function ensureHandle(shadow: ShadowRoot) {
  const id = "rsdh-svelte-handle";
  let handle = shadow.getElementById(id) as HTMLButtonElement | null;
  if (!handle) {
    handle = document.createElement("button");
    handle.id = id;
    handle.className = "fab";
    handle.type = "button";
    handle.title = "Open Draft Helper";
    handle.setAttribute("aria-label", "Open Draft Helper");
    // Inline styles for guaranteed visibility in shadow DOM
    handle.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      width: 50px;
      height: 50px;
      border-radius: 4px;
      background: rgba(18, 18, 26, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #00E5FF;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      transition: all 0.2s ease;
    `;
    handle.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2l1.2 4.3L17.5 8l-4.3 1.2L12 13.5l-1.2-4.3L6.5 8l4.3-1.7L12 2Z" fill="currentColor" opacity="0.95"/>
        <path d="M19 11l.8 2.8L22.6 15l-2.8.8L19 18.6l-.8-2.8L15.4 15l2.8-1.2L19 11Z" fill="currentColor" opacity="0.85"/>
      </svg>
    `;
    handle.addEventListener("click", () => setUiState({ hidden: false }));
    handle.addEventListener("mouseenter", () => {
      handle!.style.background = "#00E5FF";
      handle!.style.color = "#000";
    });
    handle.addEventListener("mouseleave", () => {
      handle!.style.background = "rgba(18, 18, 26, 0.95)";
      handle!.style.color = "#00E5FF";
    });
    shadow.appendChild(handle);
  }
  return handle;
}


function applyHidden(appRoot: HTMLElement, handle: HTMLElement, hidden: boolean) {
  appRoot.style.display = hidden ? "none" : "";
  handle.style.display = hidden ? "" : "none";
}

function startAccentSync(host: HTMLElement) {
  const apply = () => {
    const css = detectAccentCss();
    if (css) host.style.setProperty("--rsdh-accent", css);
  };
  apply();
  try {
    setInterval(apply, 5000);
  } catch {
    // ignore
  }
}

function mountApp() {
  const host = ensureHost();
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });

  // Inject styles into shadow root so we don't depend on page CSS.
  const styleId = "rsdh-style";
  if (!shadow.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = cssText;
    shadow.appendChild(style);
  }

  const handle = ensureHandle(shadow);

  const appId = "app";
  let target = shadow.getElementById(appId) as HTMLElement | null;
  if (!target) {
    target = document.createElement("div");
    target.id = appId;
    shadow.appendChild(target);
  }

  svelteMount(App, { target });

  // initial visibility
  const st = getUiState();
  applyHidden(target, handle, !!st.hidden);

  // listen for state changes
  window.addEventListener("rsdh-ui-state", (ev: Event) => {
    const detail = (ev as CustomEvent).detail as { hidden?: boolean } | undefined;
    if (!detail) return;
    if (typeof detail.hidden === "boolean") applyHidden(target, handle, detail.hidden);
  });

  startAccentSync(host);
}

mountApp();
startModalActionInjection();

