// Simple toast notification system for userscript
// Toasts appear at the bottom-left of the viewport and auto-dismiss

let toastContainer: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (toastContainer && document.body.contains(toastContainer)) {
    return toastContainer;
  }

  toastContainer = document.createElement("div");
  toastContainer.id = "rsdh-toast-container";
  toastContainer.style.cssText = `
    position: fixed;
    bottom: 40px;
    left: 40px;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
    pointer-events: none;
  `;
  document.body.appendChild(toastContainer);
  return toastContainer;
}

export type ToastType = "success" | "error" | "info";

export function showToast(message: string, type: ToastType = "info", durationMs = 3000) {
  const container = ensureContainer();

  const toast = document.createElement("div");

  // Broadcast Accent Colors
  const colors = {
    success: "#7CFF01", // RealSports Green
    error: "#FF3D00",   // Broadcast Red
    info: "#00E5FF"     // Electric Blue
  };

  const accent = colors[type];

  toast.style.cssText = `
    font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 14px 20px;
    border-radius: 2px;
    color: white;
    background: #0D0D12;
    border-left: 4px solid ${accent};
    pointer-events: auto;
    box-shadow: 0 12px 32px rgba(0,0,0,0.8), 0 0 10px ${accent}20;
    animation: broadcastToastIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    max-width: 320px;
    position: relative;
    overflow: hidden;
  `;

  // Add a subtle scanline effect to the toast
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: absolute;
    inset: 0;
    background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.03));
    background-size: 100% 2px, 3px 100%;
    pointer-events: none;
  `;
  toast.appendChild(overlay);

  const textNode = document.createTextNode(message);
  toast.appendChild(textNode);

  // Add animation keyframes if not already added
  if (!document.getElementById("rsdh-toast-styles")) {
    const style = document.createElement("style");
    style.id = "rsdh-toast-styles";
    style.textContent = `
      @keyframes broadcastToastIn {
        from { opacity: 0; transform: translateX(-40px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes broadcastToastOut {
        from { opacity: 1; transform: scale(1); }
        to { opacity: 0; transform: scale(0.9) translateX(-20px); }
      }
    `;
    document.head.appendChild(style);
  }

  container.appendChild(toast);

  // Auto dismiss
  setTimeout(() => {
    toast.style.animation = "broadcastToastOut 0.2s ease forwards";
    setTimeout(() => {
      toast.remove();
    }, 200);
  }, durationMs);
}

// Convenience functions
export const toastSuccess = (msg: string, duration?: number) => showToast(msg, "success", duration);
export const toastError = (msg: string, duration?: number) => showToast(msg, "error", duration);
export const toastInfo = (msg: string, duration?: number) => showToast(msg, "info", duration);
