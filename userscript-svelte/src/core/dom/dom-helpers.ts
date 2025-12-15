import { getDebugMode } from "../state/storage";

// Visual debugging constants
const DEBUG_HIGHLIGHT_ID_PREFIX = "rsdh-debug-highlight-";
const DEBUG_OVERLAY_Z_INDEX = 999999;

/**
 * Highlight an element with a colored overlay and label (only in debug mode)
 */
export function highlightElement(el: HTMLElement | null, label: string, color = "rgba(4, 131, 215, 0.4)"): string | null {
    if (!el || !getDebugMode()) return null;

    const id = DEBUG_HIGHLIGHT_ID_PREFIX + Date.now();
    const rect = el.getBoundingClientRect();

    const overlay = document.createElement("div");
    overlay.id = id;
    overlay.style.cssText = `
    position: fixed;
    top: ${rect.top}px;
    left: ${rect.left}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    background: ${color};
    border: 2px solid ${color.replace(/[\d.]+\)$/, "0.9)")};
    border-radius: 4px;
    z-index: ${DEBUG_OVERLAY_Z_INDEX};
    pointer-events: none;
    transition: opacity 0.3s ease;
  `;

    const labelEl = document.createElement("div");
    labelEl.style.cssText = `
    position: absolute;
    bottom: 100%;
    left: 0;
    background: rgba(0, 0, 0, 0.85);
    color: #fff;
    padding: 4px 8px;
    font-size: 12px;
    font-family: system-ui, sans-serif;
    border-radius: 4px;
    white-space: nowrap;
    margin-bottom: 4px;
  `;
    labelEl.textContent = label;
    overlay.appendChild(labelEl);

    document.body.appendChild(overlay);
    return id;
}

/**
 * Remove a highlight by ID
 */
export function removeHighlight(id: string | null) {
    if (!id) return;
    try {
        document.getElementById(id)?.remove();
    } catch { /* ignore */ }
}

/**
 * Remove all debug highlights
 */
export function removeAllHighlights() {
    try {
        document.querySelectorAll(`[id^="${DEBUG_HIGHLIGHT_ID_PREFIX}"]`).forEach(el => el.remove());
    } catch { /* ignore */ }
}

/**
 * Poll for a condition with timeout
 */
export function waitFor(pred: () => boolean, opts?: { timeoutMs?: number; intervalMs?: number }) {
    const timeoutMs = opts?.timeoutMs ?? 8000;
    const intervalMs = opts?.intervalMs ?? 100;
    const start = Date.now();
    return new Promise<boolean>((resolve) => {
        const tick = () => {
            if (pred()) return resolve(true);
            if (Date.now() - start > timeoutMs) return resolve(false);
            setTimeout(tick, intervalMs);
        };
        tick();
    });
}

/**
 * Simulate a human-like click on an element
 * React Native Web and other SPAs often need pointer events, not just click()
 */
export function humanActivate(el: HTMLElement) {
    // Don't use scrollIntoView - it causes layout shifts for elements already in view
    try { el.focus(); } catch { /* ignore */ }

    let cx = 0;
    let cy = 0;
    try {
        const r = el.getBoundingClientRect();
        cx = Math.max(1, Math.floor(r.left + r.width / 2));
        cy = Math.max(1, Math.floor(r.top + r.height / 2));
    } catch { /* ignore */ }

    // Pointer events (preferred in many React Native Web style UIs)
    try {
        const PE = (window as any).PointerEvent;
        if (typeof PE === "function") {
            el.dispatchEvent(new PE("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: cx, clientY: cy }));
            el.dispatchEvent(new PE("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: cx, clientY: cy }));
        }
    } catch { /* ignore */ }

    // Mouse events
    try { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, buttons: 1, clientX: cx, clientY: cy })); } catch { /* ignore */ }
    try { el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, buttons: 1, clientX: cx, clientY: cy })); } catch { /* ignore */ }
    try { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, buttons: 1, clientX: cx, clientY: cy })); } catch { /* ignore */ }

    // Some components only respond to keyboard activation
    try { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); } catch { /* ignore */ }
    try { el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true })); } catch { /* ignore */ }

    // Last resort
    try { el.click(); } catch { /* ignore */ }
}
