import { buildPayload, findModalRoot } from "../scrapers/capture";
import { getDebugMode } from "../state/storage";
import { buildChatPromptFromPayload, buildStructuredPromptFromPayload } from "../ai/prompt";
import { askOpenRouterStructured } from "../ai/openrouter";
import { LAST_PAYLOAD_KEY } from "../constants";
import { toastSuccess, toastError, toastInfo } from "./toast";

type ActionKind = "copy_prompt" | "ask_ai" | "ask_ai_web";

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
  b.textContent = label;
  b.style.cssText = `
    font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: -0.01em;
    padding: 10px 14px;
    border-radius: 10px;
    cursor: pointer;
    width: 100%;
    white-space: nowrap;
    transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
    ${isPrimary
      ? `background: linear-gradient(135deg, var(--rsdh-accent, #2c6cff) 0%, color-mix(in srgb, var(--rsdh-accent, #2c6cff) 80%, black) 100%);
         color: white;
         border: none;
         box-shadow: 0 2px 8px rgba(0,0,0,0.2);`
      : `background: rgba(255,255,255,0.08);
         color: #f5f5f5;
         border: 1px solid rgba(255,255,255,0.1);
         box-shadow: none;`
    }
  `;
  b.addEventListener("mouseenter", () => {
    b.style.transform = "translateY(-1px)";
    if (isPrimary) {
      b.style.boxShadow = "0 4px 16px rgba(0,0,0,0.3), 0 0 20px color-mix(in srgb, var(--rsdh-accent, #2c6cff) 40%, transparent)";
    } else {
      b.style.background = "rgba(255,255,255,0.12)";
      b.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
    }
  });
  b.addEventListener("mouseleave", () => {
    b.style.transform = "translateY(0)";
    if (isPrimary) {
      b.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
    } else {
      b.style.background = "rgba(255,255,255,0.08)";
      b.style.boxShadow = "none";
    }
  });
  b.addEventListener("mousedown", () => {
    b.style.transform = "translateY(0)";
  });
  return b;
}

function makeBar() {
  const wrap = document.createElement("div");
  wrap.id = "rsdh-modal-actions";
  wrap.style.cssText = `
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
    margin-top: 14px;
    padding: 14px 16px 0 16px;
    border-top: 1px solid color-mix(in srgb, var(--rsdh-accent, #2c6cff) 30%, rgba(255,255,255,0.1));
  `;
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
    const errMsg = payload?.error || "Could not capture modal.";
    dispatchStatus(errMsg);
    toastError(errMsg);
    return;
  }

  if (kind === "copy_prompt") {
    const prompt = buildChatPromptFromPayload(payload as any);
    GM_setClipboard(prompt);
    dispatchStatus("Copied prompt to clipboard.");
    toastSuccess("Copied prompt to clipboard!");
    return;
  }

  const statusMsg = kind === "ask_ai_web" ? "Asking AI + Web..." : "Asking AI...";
  dispatchStatus(statusMsg);
  toastInfo(statusMsg);
  const prompt = buildStructuredPromptFromPayload(payload as any, { webHint: kind === "ask_ai_web" });
  const res = await askOpenRouterStructured({ prompt, web: kind === "ask_ai_web", payload: payload as any });
  dispatchOutput(res.jsonText);
  dispatchStatus("AI response received.");
  toastSuccess("AI response received!");
}

export function startModalActionInjection() {
  const inject = () => {
    const modal = findModalRoot();
    if (!modal) return;
    if (modal.querySelector("#rsdh-modal-actions")) return;

    const bar = makeBar();
    const copyPrompt = btn("📋 Copy Prompt");
    const ask = btn("✨ Ask AI", true);
    const askWeb = btn("🌐 AI + Web", true);

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
    askWeb.addEventListener("click", () => runAction("ask_ai_web").catch(e => {
      const msg = String(e?.message || e);
      dispatchStatus(msg);
      toastError(msg);
    }));

    bar.appendChild(copyPrompt);
    bar.appendChild(ask);
    bar.appendChild(askWeb);

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


