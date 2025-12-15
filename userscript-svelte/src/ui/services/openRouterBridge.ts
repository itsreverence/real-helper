import { askOpenRouterStructured, assertPayloadOk, buildStructuredPromptFromPayload } from "../../core";

export async function askAi(payloadRaw: string): Promise<string> {
  const payload = assertPayloadOk(payloadRaw);
  const prompt = buildStructuredPromptFromPayload(payload);
  const res = await askOpenRouterStructured({ prompt, web: false, payload });
  return res.jsonText;
}

export async function askAiWeb(payloadRaw: string): Promise<string> {
  const payload = assertPayloadOk(payloadRaw);
  const prompt = buildStructuredPromptFromPayload(payload, { webHint: true });
  const res = await askOpenRouterStructured({ prompt, web: true, payload });
  return res.jsonText;
}


