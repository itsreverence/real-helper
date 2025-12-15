import { getDebugMode } from "../state/storage";
import { clearDebugEvents, type RsdhDebugEvent } from "./debugBus";

const HUD_ID = "rsdh-debug-hud";
const STYLE_ID = "rsdh-debug-hud-style";

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${HUD_ID} {
      position: fixed;
      right: 14px;
      bottom: 14px;
      width: 360px;
      max-height: 50vh;
      z-index: 2147483646;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      color: rgba(255,255,255,0.92);
      background: rgba(10, 10, 12, 0.86);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 14px;
      box-shadow: 0 18px 40px rgba(0,0,0,0.45);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      overflow: hidden;
    }
    #${HUD_ID}[data-collapsed="1"] .rsdh-body { display: none; }
    #${HUD_ID} .rsdh-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 10px 10px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.10);
      background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0));
    }
    #${HUD_ID} .rsdh-title { font-size: 12px; font-weight: 700; letter-spacing: 0.3px; }
    #${HUD_ID} .rsdh-sub { font-size: 11px; opacity: 0.78; margin-top: 2px; }
    #${HUD_ID} .rsdh-actions { display:flex; gap:6px; align-items:center; }
    #${HUD_ID} button {
      font-size: 11px;
      padding: 6px 8px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.92);
      cursor: pointer;
    }
    #${HUD_ID} button:hover { background: rgba(255,255,255,0.10); }
    #${HUD_ID} .rsdh-body { padding: 10px 12px 12px 12px; }
    #${HUD_ID} .rsdh-status {
      font-size: 12px;
      padding: 8px 10px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.10);
      background: rgba(255,255,255,0.05);
      margin-bottom: 10px;
      line-height: 1.3;
      white-space: pre-wrap;
    }
    #${HUD_ID} .rsdh-list {
      display: grid;
      gap: 6px;
      overflow: auto;
      max-height: 26vh;
      padding-right: 4px;
    }
    #${HUD_ID} .rsdh-row { display:flex; gap:8px; align-items:flex-start; }
    #${HUD_ID} .dot {
      width: 8px; height: 8px;
      border-radius: 999px;
      margin-top: 4px;
      background: rgba(255,255,255,0.35);
      box-shadow: 0 0 0 2px rgba(255,255,255,0.06);
      flex: 0 0 auto;
    }
    #${HUD_ID} .dot.step { background: rgba(59,130,246,0.95); }
    #${HUD_ID} .dot.info { background: rgba(34,197,94,0.95); }
    #${HUD_ID} .dot.warn { background: rgba(245,158,11,0.95); }
    #${HUD_ID} .dot.error { background: rgba(239,68,68,0.95); }
    #${HUD_ID} .msg { font-size: 11px; line-height: 1.25; opacity: 0.92; }
    #${HUD_ID} .meta { font-size: 10px; opacity: 0.62; margin-top: 1px; }
  `;
  document.documentElement.appendChild(style);
}

function ensureHud() {
  let hud = document.getElementById(HUD_ID) as HTMLDivElement | null;
  if (hud) return hud;
  ensureStyle();
  hud = document.createElement("div");
  hud.id = HUD_ID;
  hud.setAttribute("data-collapsed", "0");
  hud.innerHTML = `
    <div class="rsdh-head">
      <div>
        <div class="rsdh-title">RSDH Debug HUD</div>
        <div class="rsdh-sub">Live tool + scraping timeline</div>
      </div>
      <div class="rsdh-actions">
        <button type="button" data-act="clear">Clear</button>
        <button type="button" data-act="collapse">Hide</button>
      </div>
    </div>
    <div class="rsdh-body">
      <div class="rsdh-status" data-role="status">Waiting…</div>
      <div class="rsdh-list" data-role="list"></div>
    </div>
  `;
  document.documentElement.appendChild(hud);

  hud.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement | null;
    const act = t?.getAttribute?.("data-act");
    if (!act) return;
    if (act === "clear") {
      clearDebugEvents();
      render(hud!, []);  // Immediately clear the HUD display
    }
    if (act === "collapse") {
      const collapsed = hud!.getAttribute("data-collapsed") === "1";
      hud!.setAttribute("data-collapsed", collapsed ? "0" : "1");
      const btn = hud!.querySelector("button[data-act='collapse']") as HTMLButtonElement | null;
      if (btn) btn.textContent = collapsed ? "Hide" : "Show";
    }
  });

  return hud;
}

let lastEvents: RsdhDebugEvent[] = [];

function render(hud: HTMLElement, events: RsdhDebugEvent[]) {
  const statusEl = hud.querySelector("[data-role='status']") as HTMLElement | null;
  const listEl = hud.querySelector("[data-role='list']") as HTMLElement | null;
  if (!statusEl || !listEl) return;

  lastEvents = events || [];

  const last = events[events.length - 1];
  statusEl.textContent = last ? `${last.scope ? `[${last.scope}] ` : ""}${last.msg}` : "Waiting…";

  const tail = events.slice(-10);
  listEl.innerHTML = tail
    .map((e, idx) => {
      const time = e.t ? e.t.slice(11, 19) : "";
      const scope = e.scope ? ` • ${e.scope}` : "";
      const kind = e.kind || "info";
      const msg = escapeHtml(String(e.msg || ""));
      const dataHint = e.data != null ? ` • data` : "";
      return `
        <div class="rsdh-row" data-idx="${events.length - tail.length + idx}">
          <div class="dot ${kind}"></div>
          <div>
            <div class="msg">${msg}</div>
            <div class="meta">${time}${scope} • ${kind}${dataHint}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" } as any)[c] || c);
}

export function startDebugHud() {
  const apply = () => {
    const on = getDebugMode();
    const existing = document.getElementById(HUD_ID);
    if (!on) {
      try { existing?.remove(); } catch { /* ignore */ }
      return;
    }
    ensureHud();
  };

  apply();

  window.addEventListener("rsdh-debug-mode", apply as any);
  window.addEventListener("rsdh-debug-events", (ev: Event) => {
    const detail = (ev as CustomEvent).detail as { events?: RsdhDebugEvent[] } | undefined;
    if (!detail?.events) return;
    const hud = document.getElementById(HUD_ID);
    if (!hud) return;
    render(hud, detail.events);
  });

  window.addEventListener("rsdh-debug-event", (ev: Event) => {
    const e = (ev as CustomEvent).detail as RsdhDebugEvent | undefined;
    if (!e) return;
    const hud = document.getElementById(HUD_ID);
    if (!hud) return;
    // quick incremental update: re-render by requesting the current list via event stream if available
    // (the bus usually emits rsdh-debug-events too).
    const listEvts: RsdhDebugEvent[] = [];
    listEvts.push(e);
    // If we didn't get a batch event, at least show the latest message.
    const statusEl = hud.querySelector("[data-role='status']") as HTMLElement | null;
    if (statusEl) statusEl.textContent = `${e.scope ? `[${e.scope}] ` : ""}${e.msg}`;
  });

  // Row click -> show details JSON
  document.addEventListener("click", (ev) => {
    const hud = document.getElementById(HUD_ID);
    if (!hud) return;
    const path = (ev as any).composedPath?.() || [];
    if (!path.includes(hud)) return;
    const row = (ev.target as HTMLElement | null)?.closest?.(".rsdh-row") as HTMLElement | null;
    if (!row) return;
    const idx = parseInt(String(row.getAttribute("data-idx") || ""), 10);
    if (!Number.isFinite(idx)) return;
    const e = lastEvents[idx];
    if (!e) return;
    const statusEl = hud.querySelector("[data-role='status']") as HTMLElement | null;
    if (!statusEl) return;
    const header = `${e.scope ? `[${e.scope}] ` : ""}${e.msg}`;
    const data = e.data != null ? `\n\n${JSON.stringify(e.data, null, 2)}` : "";
    statusEl.textContent = header + data;
  }, true);

  // Auto-move HUD if Svelte panel is open so it doesn't get covered.
  window.addEventListener("rsdh-ui-state", (ev: Event) => {
    const detail = (ev as CustomEvent).detail as { hidden?: boolean } | undefined;
    const hud = document.getElementById(HUD_ID) as HTMLElement | null;
    if (!hud) return;
    const hidden = !!detail?.hidden;
    // When UI is open (hidden=false), move HUD to bottom-left. Otherwise keep bottom-right.
    if (!hidden) {
      hud.style.left = "14px";
      hud.style.right = "";
    } else {
      hud.style.right = "14px";
      hud.style.left = "";
    }
  });
}


