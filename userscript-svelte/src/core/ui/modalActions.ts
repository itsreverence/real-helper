import { buildPayload, findModalRoot } from "../scrapers/capture";
import { getDebugMode } from "../state/storage";
import { buildChatPromptFromPayload, buildStructuredPromptFromPayload } from "../ai/prompt";
import { askOpenRouterStructured } from "../ai/openrouter";
import { LAST_PAYLOAD_KEY, ENABLE_WEB_SEARCH_KEY, ENABLE_PROFILE_TOOL_KEY, ENABLE_SEARCH_TOOL_KEY, LINEUP_STRATEGY_KEY } from "../constants";
import { toastSuccess, toastError, toastInfo } from "./toast";
import { gmGet } from "../state/storage";

type ActionKind = "copy_prompt" | "ask_ai";

function setLastPayload(payload: any) {
  try {
    localStorage.setItem(LAST_PAYLOAD_KEY, JSON.stringify(payload, null, 2));
  } catch {
    // ignore
  }
}

function dispatchOutput(raw: string) {
  try {
    window.dispatchEvent(new CustomEvent("rsdh-output", { detail: { raw } }));
  } catch {
    // ignore
  }
}

function dispatchStatus(text: string) {
  try {
    window.dispatchEvent(new CustomEvent("rsdh-status", { detail: { text } }));
  } catch {
    // ignore
  }
}

function btn(label: string, isPrimary = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label.toUpperCase(); // Broadcast style: Uppercase
  b.style.cssText = `
    font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.1em;
    padding: 12px 16px;
    border-radius: 2px;
    cursor: pointer;
    width: 100%;
    white-space: nowrap;
    transition: all 0.15s ease;
    ${isPrimary
      ? `background: #00E5FF;
         color: #000;
         border: none;
         box-shadow: 0 4px 12px rgba(0, 229, 255, 0.3);`
      : `background: rgba(13, 13, 18, 0.8);
         color: #F5F5F7;
         border: 1px solid rgba(255, 255, 255, 0.1);
         box-shadow: none;`
    }
  `;
  b.addEventListener("mouseenter", () => {
    b.style.transform = "translateY(-2px)";
    if (isPrimary) {
      b.style.boxShadow = "0 8px 24px rgba(0, 229, 255, 0.5), 0 0 15px rgba(0, 229, 255, 0.4)";
    } else {
      b.style.background = "rgba(255, 255, 255, 0.05)";
      b.style.borderColor = "rgba(255, 255, 255, 0.3)";
      b.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";
    }
  });
  b.addEventListener("mouseleave", () => {
    b.style.transform = "translateY(0)";
    if (isPrimary) {
      b.style.boxShadow = "0 4px 12px rgba(0, 229, 255, 0.3)";
    } else {
      b.style.background = "rgba(13, 13, 18, 0.8)";
      b.style.borderColor = "rgba(255, 255, 255, 0.1)";
      b.style.boxShadow = "none";
    }
  });
  b.addEventListener("mousedown", () => {
    b.style.transform = "translateY(1px)";
  });
  return b;
}

function makeBar() {
  const wrap = document.createElement("div");
  wrap.id = "rsdh-modal-actions";
  wrap.style.cssText = `
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 16px;
    padding: 20px 20px 0 20px;
    background: rgba(13, 13, 18, 0.4);
    border-top: 2px solid rgba(0, 229, 255, 0.2);
    position: relative;
    backdrop-filter: blur(8px);
  `;
  // Add label
  const label = document.createElement("div");
  label.textContent = "AI COMMANDS ENABLED";
  label.style.cssText = `
    grid-column: 1 / -1;
    font-size: 9px;
    font-weight: 900;
    color: #00E5FF;
    letter-spacing: 0.15em;
    margin-bottom: -4px;
    opacity: 0.6;
  `;
  wrap.appendChild(label);
  return wrap;
}

function findSubmitArea(modal: Element): HTMLElement | null {
  const candidates = Array.from(modal.querySelectorAll("button,div,[role='button']")) as HTMLElement[];
  const hit = candidates.find(el => {
    const t = (el.innerText || el.textContent || "").trim();
    return /^(submit|update)$/i.test(t);
  });
  if (!hit) return null;
  // insert after the button's parent container if possible
  return (hit.parentElement as HTMLElement) || hit;
}

async function runAction(kind: ActionKind) {
  dispatchStatus("Capturing...");
  const payload = buildPayload({ includeDebug: getDebugMode() });
  setLastPayload(payload);
  dispatchOutput(JSON.stringify(payload, null, 2));
  if (!payload || payload.ok !== true) {
    const errMsg = payload?.error || "SIGNAL LOST: COULD NOT CAPTURE MODAL.";
    dispatchStatus(errMsg);
    toastError(errMsg);
    return;
  }

  if (kind === "copy_prompt") {
    const prompt = buildChatPromptFromPayload(payload as any);
    GM_setClipboard(prompt);
    dispatchStatus("PROMPT GATHERED. COPIED TO CLIPBOARD.");
    toastSuccess("PROMPT GATHERED.");
    return;
  }

  // Check if web search is enabled in settings
  const webEnabled = gmGet(ENABLE_WEB_SEARCH_KEY, "1" as any) !== "0";
  const profileToolEnabled = gmGet(ENABLE_PROFILE_TOOL_KEY, "1" as any) !== "0";
  const searchToolEnabled = gmGet(ENABLE_SEARCH_TOOL_KEY, "1" as any) !== "0";
  const strategy = String(gmGet(LINEUP_STRATEGY_KEY, "balanced" as any) || "balanced") as "safe" | "balanced" | "risky";
  const statusMsg = webEnabled ? "INITIATING MULTI-SOURCE AI SCAN..." : "INITIATING AI CORE SCAN...";
  dispatchStatus(statusMsg);
  toastInfo(statusMsg);
  const prompt = buildStructuredPromptFromPayload(payload as any, { webHint: webEnabled, toolHint: profileToolEnabled, searchHint: searchToolEnabled, strategy });
  const res = await askOpenRouterStructured({ prompt, web: webEnabled, payload: payload as any });
  dispatchOutput(res.jsonText);
  dispatchStatus("DATA SYNC COMPLETE. AI ANALYSIS READY.");
  toastSuccess("SYNC COMPLETE.");
}

export function startModalActionInjection() {
  const inject = () => {
    const modal = findModalRoot();
    if (!modal) return;
    if (modal.querySelector("#rsdh-modal-actions")) return;

    const bar = makeBar();
    const copyPrompt = btn("Copy Prompt");
    const ask = btn("Ask AI", true);

    copyPrompt.addEventListener("click", () => runAction("copy_prompt").catch(e => {
      const msg = String(e?.message || e);
      dispatchStatus(msg);
      toastError(msg);
    }));
    ask.addEventListener("click", () => runAction("ask_ai").catch(e => {
      const msg = String(e?.message || e);
      dispatchStatus(msg);
      toastError(msg);
    }));

    bar.appendChild(copyPrompt);
    bar.appendChild(ask);

    const anchor = findSubmitArea(modal);
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(bar, anchor.nextSibling);
    } else {
      modal.appendChild(bar);
    }
  };

  inject();
  const obs = new MutationObserver(() => inject());
  obs.observe(document.documentElement, { childList: true, subtree: true });
}
