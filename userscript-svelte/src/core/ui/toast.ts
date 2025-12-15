// Simple toast notification system for userscript
// Toasts appear at the bottom of the viewport and auto-dismiss

let toastContainer: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
    if (toastContainer && document.body.contains(toastContainer)) {
        return toastContainer;
    }

    toastContainer = document.createElement("div");
    toastContainer.id = "rsdh-toast-container";
    toastContainer.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    pointer-events: none;
  `;
    document.body.appendChild(toastContainer);
    return toastContainer;
}

export type ToastType = "success" | "error" | "info";

export function showToast(message: string, type: ToastType = "info", durationMs = 3000) {
    const container = ensureContainer();

    const toast = document.createElement("div");
    toast.style.cssText = `
    font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 13px;
    font-weight: 600;
    padding: 12px 20px;
    border-radius: 10px;
    color: white;
    pointer-events: auto;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    animation: toastIn 0.25s ease;
    max-width: 320px;
    text-align: center;
    ${type === "success"
            ? "background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); border: 1px solid rgba(34, 197, 94, 0.3);"
            : type === "error"
                ? "background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border: 1px solid rgba(239, 68, 68, 0.3);"
                : "background: linear-gradient(135deg, #2c6cff 0%, #1d4ed8 100%); border: 1px solid rgba(44, 108, 255, 0.3);"}
  `;
    toast.textContent = message;

    // Add animation keyframes if not already added
    if (!document.getElementById("rsdh-toast-styles")) {
        const style = document.createElement("style");
        style.id = "rsdh-toast-styles";
        style.textContent = `
      @keyframes toastIn {
        from { opacity: 0; transform: translateY(20px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes toastOut {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to { opacity: 0; transform: translateY(-10px) scale(0.95); }
      }
    `;
        document.head.appendChild(style);
    }

    container.appendChild(toast);

    // Auto dismiss
    setTimeout(() => {
        toast.style.animation = "toastOut 0.2s ease forwards";
        setTimeout(() => {
            toast.remove();
        }, 200);
    }, durationMs);
}

// Convenience functions
export const toastSuccess = (msg: string, duration?: number) => showToast(msg, "success", duration);
export const toastError = (msg: string, duration?: number) => showToast(msg, "error", duration);
export const toastInfo = (msg: string, duration?: number) => showToast(msg, "info", duration);
