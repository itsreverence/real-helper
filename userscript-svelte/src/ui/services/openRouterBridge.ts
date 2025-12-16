import { askOpenRouterStructured, assertPayloadOk, buildStructuredPromptFromPayload, gmGet } from "../../core";
import { ENABLE_WEB_SEARCH_KEY, ENABLE_PROFILE_TOOL_KEY } from "../../core";

export async function askAi(payloadRaw: string): Promise<string> {
  const payload = assertPayloadOk(payloadRaw);
  const webEnabled = gmGet(ENABLE_WEB_SEARCH_KEY, "1" as any) !== "0";
  const profileToolEnabled = gmGet(ENABLE_PROFILE_TOOL_KEY, "1" as any) !== "0";
  const prompt = buildStructuredPromptFromPayload(payload, { webHint: webEnabled, toolHint: profileToolEnabled });
  const res = await askOpenRouterStructured({ prompt, web: webEnabled, payload });
  return res.jsonText;
}

export async function askAiWeb(payloadRaw: string): Promise<string> {
  const payload = assertPayloadOk(payloadRaw);
  const profileToolEnabled = gmGet(ENABLE_PROFILE_TOOL_KEY, "1" as any) !== "0";
  const prompt = buildStructuredPromptFromPayload(payload, { webHint: true, toolHint: profileToolEnabled });
  const res = await askOpenRouterStructured({ prompt, web: true, payload });
  return res.jsonText;
}
