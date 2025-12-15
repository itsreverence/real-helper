import { buildPayload, clickFirstDraftOrUpdateButton } from "../../core/scrapers/capture";
import { buildChatPromptFromPayload, buildStructuredPromptFromPayload } from "../../core/ai/prompt";
import { LAST_PAYLOAD_KEY } from "../../core/constants";
import type { Payload, PayloadOk } from "../../core/types";

export function openDraftModal() {
  clickFirstDraftOrUpdateButton();
}

export function captureNow(includeDebug: boolean): Payload {
  const payload = buildPayload({ includeDebug });
  try {
    localStorage.setItem(LAST_PAYLOAD_KEY, JSON.stringify(payload, null, 2));
  } catch {
    // ignore
  }
  return payload;
}

export function loadLastPayloadRaw(): string {
  try {
    return localStorage.getItem(LAST_PAYLOAD_KEY) || "";
  } catch {
    return "";
  }
}

export function buildPromptFromLastCapture(payloadRaw: string): string {
  const obj = JSON.parse(payloadRaw || "null") as PayloadOk;
  if (!obj || obj.ok !== true) throw new Error(String((obj as any)?.error || "No valid capture payload. Click Capture first."));
  return buildChatPromptFromPayload(obj);
}

export function buildStructuredPromptFromLastCapture(payloadRaw: string): string {
  const obj = JSON.parse(payloadRaw || "null") as PayloadOk;
  if (!obj || obj.ok !== true) throw new Error(String((obj as any)?.error || "No valid capture payload. Click Capture first."));
  return buildStructuredPromptFromPayload(obj);
}


