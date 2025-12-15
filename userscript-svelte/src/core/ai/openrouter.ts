import {
  LAST_AI_JSON_KEY,
  LAST_AI_SOURCES_KEY,
  LAST_TOOL_TRACE_KEY,
  LAST_MESSAGES_KEY,
  FORCE_TOOL_CALL_KEY,
  OR_DEFAULT_HEAL,
  OR_DEFAULT_MAXTOK,
  OR_DEFAULT_MODEL,
  OR_DEFAULT_STRUCTURED,
  OR_DEFAULT_TEMP,
  OR_DEFAULT_WEB_MAX_RESULTS,
  OR_ENDPOINT,
  PROXY_ENDPOINT,
  PROXY_SECRET,
  USE_PROXY,
  BYPASS_PROXY_KEY,
  OR_HEAL,
  OR_KEY,
  OR_MAXTOK,
  OR_MODEL,
  OR_STRUCTURED,
  OR_TEMP,
  OR_WEB_MAX_RESULTS,
} from "../constants";
import { gmGet } from "../state/storage";
import { getUserIdentity } from "../state/identity";
import type { OpenRouterConfig, PayloadOk } from "../types";
import { discoverProfileUrlViaClick, navigateScrapeAndReturnToDraft } from "../scrapers/playerProfile";
import { emitDebugEvent } from "../ui/debugBus";

export function getOpenRouterConfig(): OpenRouterConfig {
  const apiKey = String(gmGet(OR_KEY, "") || "").trim();
  const model = String(gmGet(OR_MODEL, OR_DEFAULT_MODEL) || OR_DEFAULT_MODEL).trim() || OR_DEFAULT_MODEL;
  const tempRaw = gmGet(OR_TEMP, OR_DEFAULT_TEMP as any);
  const maxTokRaw = gmGet(OR_MAXTOK, OR_DEFAULT_MAXTOK as any);
  const webMaxRaw = gmGet(OR_WEB_MAX_RESULTS, OR_DEFAULT_WEB_MAX_RESULTS as any);
  const structuredRaw = gmGet(OR_STRUCTURED, OR_DEFAULT_STRUCTURED as any);
  const healRaw = gmGet(OR_HEAL, OR_DEFAULT_HEAL as any);

  const temperature = Math.max(0, Math.min(2, parseFloat(String(tempRaw))));
  const max_tokens = Math.max(64, Math.min(4000, parseInt(String(maxTokRaw), 10) || OR_DEFAULT_MAXTOK));
  const web_max_results = Math.max(1, Math.min(5, parseInt(String(webMaxRaw), 10) || OR_DEFAULT_WEB_MAX_RESULTS));
  const structured = String(structuredRaw) === "1" || structuredRaw === true;
  const response_healing = String(healRaw) === "1" || healRaw === true;

  return { apiKey, model, temperature, max_tokens, web_max_results, structured, response_healing };
}

function gmHttpJson({ method, url, headers, bodyObj, timeoutMs = 60000 }: { method: string; url: string; headers?: Record<string, string>; bodyObj?: unknown; timeoutMs?: number }) {
  return new Promise<any>((resolve, reject) => {
    const body = bodyObj == null ? null : JSON.stringify(bodyObj);
    if (typeof GM_xmlhttpRequest !== "function") {
      reject(new Error("GM_xmlhttpRequest is not available (check grants)."));
      return;
    }
    GM_xmlhttpRequest({
      method,
      url,
      headers: { "Content-Type": "application/json", ...(headers || {}) },
      data: body ?? undefined,
      timeout: timeoutMs,
      onload: (resp) => {
        try {
          const text = resp?.responseText || "";
          const json = text ? JSON.parse(text) : null;
          if (resp.status >= 200 && resp.status < 300) resolve(json);
          else reject(new Error(json?.error?.message || json?.message || `HTTP ${resp.status}`));
        } catch (e) {
          reject(e);
        }
      },
      onerror: () => reject(new Error("Network error.")),
      ontimeout: () => reject(new Error("Request timed out.")),
    });
  });
}

export function lineupJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      lineup: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            slot_index: { type: "number" },
            slot_multiplier: { type: "number" },
            player: { type: "string" },
            player_boost_x: { type: ["number", "null"] },
            effective_multiplier: { type: "number" },
          },
          required: ["slot_index", "slot_multiplier", "player", "player_boost_x", "effective_multiplier"],
        },
      },
      bets: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            tier: { type: "string", enum: ["top50", "top20", "top10"] },
            recommend: { type: "boolean" },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            reason: { type: "string" },
          },
          required: ["tier", "recommend", "confidence", "reason"],
        },
      },
      assumptions: { type: "array", items: { type: "string" } },
      questions: { type: "array", items: { type: "string" } },
    },
    required: ["lineup", "bets", "assumptions", "questions"],
  };
}

function extractCitations(msg: any): string[] {
  const ann = Array.isArray(msg?.annotations) ? msg.annotations : [];
  const cites = ann
    .filter((a: any) => a && a.type === "url_citation" && a.url_citation && a.url_citation.url)
    .map((a: any) => a.url_citation.url)
    .slice(0, 25);
  return Array.from(new Set(cites));
}

function isNoEndpointsError(e: any) {
  const msg = String(e?.message || e || "");
  return msg.toLowerCase().includes("no endpoints found");
}

type ToolTraceEntry =
  | { t: string; kind: "start"; model: string; web: boolean }
  | { t: string; kind: "routing_fallback"; stage: "tool_loop" | "final"; label: string }
  | { t: string; kind: "tool_call"; name: string; id: string; args: any }
  | { t: string; kind: "tool_result"; name: string; id: string; ok: boolean; ms: number; summary?: any }
  | { t: string; kind: "done" };

function nowIso() {
  return new Date().toISOString();
}

function writeToolTrace(entries: ToolTraceEntry[]) {
  try { localStorage.setItem(LAST_TOOL_TRACE_KEY, JSON.stringify(entries, null, 2)); } catch { /* ignore */ }
}

async function gmHttpJsonWithFallback(
  attempts: Array<{ body: any; label: string }>,
  base: { url: string; headers: Record<string, string>; timeoutMs: number },
) {
  let lastErr: any = null;
  for (const a of attempts) {
    try {
      const res = await gmHttpJson({
        method: "POST",
        url: base.url,
        headers: base.headers,
        bodyObj: a.body,
        timeoutMs: base.timeoutMs,
      });
      return { res, usedLabel: a.label };
    } catch (e) {
      lastErr = e;
      // Only auto-fallback for routing/parameter incompat errors.
      if (!isNoEndpointsError(e)) throw e;
    }
  }
  throw lastErr || new Error("OpenRouter request failed.");
}

function toolSpec_get_player_profile_stats() {
  return {
    type: "function",
    function: {
      name: "get_player_profile_stats",
      description:
        "Fetch and summarize a player's RealSports profile page (rankings, prior performances, recent game logs). Clicks the player's profile icon in the draft modal, scrapes their stats, then returns to the draft. Use when deciding between players beyond boost values.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          player_name: { type: "string", description: "Player name exactly as shown in the draft modal." },
        },
        required: ["player_name"],
      },
    },
  };
}

async function executeToolCall(toolName: string, args: any, ctx: { payload?: PayloadOk | null }) {
  if (toolName === "get_player_profile_stats") {
    const player_name = String(args?.player_name || "").trim();
    if (!player_name) return { error: "missing_player_name" };

    emitDebugEvent("step", `Tool call: get_player_profile_stats(${player_name})`, { scope: "tool" });

    // Always use click-to-navigate approach - find the player in the draft modal and click their profile icon
    emitDebugEvent("step", "Discovering profile URL via click…", { scope: "tool" });
    const profile_url = await discoverProfileUrlViaClick(player_name);

    if (!profile_url) {
      return {
        error: "player_not_found",
        player_name,
        hint: "Could not find this player in the draft modal. Make sure the draft modal is open and the player is visible in the list.",
      };
    }

    emitDebugEvent("step", `Scraping profile…`, { scope: "tool", data: { profile_url } });
    const sport = ctx.payload?.sport || null;
    // Always return to draft after scraping
    const stats = await navigateScrapeAndReturnToDraft({ player_name, profile_url, return_to_draft: true, sport });
    emitDebugEvent("info", "Tool result ready", { scope: "tool", data: { scraped_via: (stats as any)?.scraped_via, navigated_to_profile: (stats as any)?.navigated_to_profile } });
    return { ...stats, discovery: "click", mode: "live_dom" };
  }

  return { error: "unknown_tool", toolName };
}

export async function askOpenRouterStructured(opts: { prompt: string; web: boolean; payload?: PayloadOk }): Promise<{ jsonText: string; sources: string[] }> {
  const cfg = getOpenRouterConfig();
  // Check bypass at runtime for the API key requirement
  const bypassCheck = (String(gmGet(BYPASS_PROXY_KEY, "0" as any)) === "1") || gmGet(BYPASS_PROXY_KEY, "0" as any) === true;
  const needsApiKey = !USE_PROXY || bypassCheck;
  if (needsApiKey && !cfg.apiKey) throw new Error("Missing OpenRouter API key.");

  const forceTool = (String(gmGet(FORCE_TOOL_CALL_KEY, "0" as any)) === "1") || gmGet(FORCE_TOOL_CALL_KEY, "0" as any) === true;
  const prompt = forceTool
    ? [
      "DEBUG TOOL TEST: You MUST call the tool `get_player_profile_stats` exactly once before producing the final JSON schema answer.",
      "Pick ONE player from the available pool (prefer a high-boost or a close decision).",
      "IMPORTANT: Call the tool with return_to_draft=true so you can read dynamic Feed/Plays content, then come back to the draft.",
      "After you receive the tool result, continue normally and return the final JSON schema output.",
      "",
      opts.prompt,
    ].join("\n")
    : opts.prompt;

  const toolTrace: ToolTraceEntry[] = [{ t: nowIso(), kind: "start", model: cfg.model, web: !!opts.web }];
  writeToolTrace(toolTrace);

  const tools = [toolSpec_get_player_profile_stats()];

  // Check if debug bypass is enabled (runtime check from storage)
  const bypassProxy = (String(gmGet(BYPASS_PROXY_KEY, "0" as any)) === "1") || gmGet(BYPASS_PROXY_KEY, "0" as any) === true;
  const useProxyNow = USE_PROXY && !bypassProxy;

  // Build headers based on mode: proxy uses X-RSDH-Auth, direct uses Authorization
  const baseHeaders: Record<string, string> = useProxyNow
    ? {
      "X-RSDH-Auth": PROXY_SECRET,
      "HTTP-Referer": "https://realsports.io/",
      "X-Title": "RealSports Draft Helper",
    }
    : {
      Authorization: `Bearer ${cfg.apiKey}`,
      "HTTP-Referer": "https://realsports.io/",
      "X-Title": "RealSports Draft Helper",
    };

  // Add user identity header for tracking (only in proxy mode)
  if (useProxyNow) {
    const identity = getUserIdentity();
    if (identity?.username) {
      baseHeaders["X-RSDH-User"] = identity.username;
    }
  }

  // Use proxy endpoint or direct OpenRouter endpoint
  const apiEndpoint = useProxyNow ? PROXY_ENDPOINT : OR_ENDPOINT;

  const plugins: any[] = [];
  if (opts.web) plugins.push({ id: "web", engine: "exa", max_results: cfg.web_max_results });
  if (cfg.response_healing) plugins.push({ id: "response-healing" });
  // Tools and plugins/strict schema aren't always routable together for every provider.
  // During the tool loop, we intentionally disable plugins to maximize routing success.
  const toolLoopPlugins: any[] = [];

  // Agentic tool loop (per OpenRouter tool calling)
  // We first allow tool calls without forcing JSON schema (some models won't emit tool_calls when response_format is strict),
  // then do one final forced-schema call with tool_choice=none for deterministic output.
  const messages: any[] = [{ role: "user", content: prompt }];
  const maxIterations = 6;
  let lastMsg: any = null;
  let lastSources: string[] = [];

  for (let i = 0; i < maxIterations; i++) {
    const baseBody: any = {
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
      max_tokens: cfg.max_tokens,
      tools,
    };

    const attempts = [
      { label: "tools+tool_choice+parallel+provider", body: { ...baseBody, tool_choice: "auto", parallel_tool_calls: false, provider: { require_parameters: true }, plugins: toolLoopPlugins } },
      { label: "tools+tool_choice+provider", body: { ...baseBody, tool_choice: "auto", provider: { require_parameters: true }, plugins: toolLoopPlugins } },
      { label: "tools+tool_choice", body: { ...baseBody, tool_choice: "auto", plugins: toolLoopPlugins } },
      { label: "tools-only", body: { ...baseBody, plugins: toolLoopPlugins } },
    ];

    const { res, usedLabel } = await gmHttpJsonWithFallback(attempts, { url: apiEndpoint, headers: baseHeaders, timeoutMs: 90000 });
    if (usedLabel !== attempts[0].label) {
      toolTrace.push({ t: nowIso(), kind: "routing_fallback", stage: "tool_loop", label: usedLabel });
      writeToolTrace(toolTrace);
    }

    const msg = res?.choices?.[0]?.message;
    lastMsg = msg;
    lastSources = extractCitations(msg);

    const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : null;
    if (!toolCalls || toolCalls.length === 0) break;

    // Push assistant tool call message and then tool results
    messages.push({ role: "assistant", content: msg?.content ?? null, tool_calls: toolCalls });

    for (const tc of toolCalls.slice(0, 3)) {
      const toolName = tc?.function?.name;
      const rawArgs = tc?.function?.arguments;
      let args: any = {};
      try {
        args = rawArgs ? JSON.parse(rawArgs) : {};
      } catch {
        args = { _raw: rawArgs };
      }

      const tcId = String(tc?.id || "");
      toolTrace.push({ t: nowIso(), kind: "tool_call", name: String(toolName || ""), id: tcId, args });
      writeToolTrace(toolTrace);

      const t0 = performance.now();
      const result = await executeToolCall(String(toolName || ""), args, { payload: opts.payload });
      const ms = Math.round(performance.now() - t0);
      const r: any = result as any;
      const ok = !r?.error;
      const summary: any = {};
      if (toolName === "get_player_profile_stats") {
        summary.player_name = r?.player_name || args?.player_name;
        summary.profile_url = r?.profile_url || null;
        summary.discovery = r?.discovery || null;
        summary.mode = r?.mode || "live_dom";
        summary.returned_to_draft = typeof r?.returned_to_draft === "boolean" ? r.returned_to_draft : null;
        summary.modal_reopened = typeof r?.modal_reopened === "boolean" ? r.modal_reopened : null;
        summary.navigated_to_profile = typeof r?.navigated_to_profile === "boolean" ? r.navigated_to_profile : null;
        summary.modal_was_open = typeof r?.modal_was_open === "boolean" ? r.modal_was_open : null;
        summary.header = r?.header_text ? true : false;
        summary.season_summary = r?.season_summary?.entries ? r.season_summary.entries.length : null;
        summary.recent_performances = r?.recent_performances?.entries ? r.recent_performances.entries.length : null;
        summary.feed_entries = Array.isArray(r?.feed_entries) ? r.feed_entries.length : null;

        summary.lines = Array.isArray(r?.interesting_lines) ? r.interesting_lines.length : null;
        summary.tables = Array.isArray(r?.tables) ? r.tables.length : null;
        summary.embedded_json = Array.isArray(r?.embedded_json) ? r.embedded_json.length : null;
        summary.facts = Array.isArray(r?.facts) ? r.facts.length : null;
        summary.recent_log = Array.isArray(r?.recent_log) ? r.recent_log.length : null;
        if (r?.error) summary.error = r.error;
        // Include actual scraped data for debugging
        summary.scraped_data = {
          header_text: r?.header_text || null,
          season_summary: r?.season_summary || null,
          recent_performances: r?.recent_performances || null,
          feed_entries: r?.feed_entries || [],

        };
      }
      toolTrace.push({ t: nowIso(), kind: "tool_result", name: String(toolName || ""), id: tcId, ok, ms, summary });
      writeToolTrace(toolTrace);
      messages.push({
        role: "tool",
        tool_call_id: tcId,
        content: JSON.stringify(result),
      });
    }
  }

  // Final schema-forced call (no tool calls allowed)
  const schema = {
    type: "json_schema",
    json_schema: { name: "draft_lineup", strict: true, schema: lineupJsonSchema() },
  };

  const finalBase: any = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.max_tokens,
    response_format: schema,
  };

  const finalAttempts = [
    // Try strict + tools first (best if routable)
    { label: "final+tools+tool_choice+provider+plugins", body: { ...finalBase, tools, tool_choice: "none", provider: { require_parameters: true }, plugins } },
    { label: "final+tools+tool_choice", body: { ...finalBase, tools, tool_choice: "none", plugins: [] } },
    // If routing can't handle tools params, drop tools entirely but keep the schema
    { label: "final+schema+plugins", body: { ...finalBase, plugins } },
    { label: "final+schema-only", body: { ...finalBase } },
  ];

  const { res: finalRes, usedLabel: finalUsed } = await gmHttpJsonWithFallback(finalAttempts, { url: apiEndpoint, headers: baseHeaders, timeoutMs: 90000 });
  if (finalUsed !== finalAttempts[0].label) {
    toolTrace.push({ t: nowIso(), kind: "routing_fallback", stage: "final", label: finalUsed });
    writeToolTrace(toolTrace);
  }

  const finalMsg = finalRes?.choices?.[0]?.message;
  const content = finalMsg?.content;
  if (!content) throw new Error("No content returned.");

  try { localStorage.setItem(LAST_AI_JSON_KEY, content); } catch { /* ignore */ }

  const sources = extractCitations(finalMsg);
  try { localStorage.setItem(LAST_AI_SOURCES_KEY, JSON.stringify(sources, null, 2)); } catch { /* ignore */ }

  // Save full messages array for debugging (shows exactly what AI received including tool results)
  try { localStorage.setItem(LAST_MESSAGES_KEY, JSON.stringify(messages, null, 2)); } catch { /* ignore */ }

  toolTrace.push({ t: nowIso(), kind: "done" });
  writeToolTrace(toolTrace);

  return { jsonText: content, sources: sources.length ? sources : (lastSources || []) };
}

export function assertPayloadOk(raw: string): PayloadOk {
  const obj = JSON.parse(raw);
  if (!obj || obj.ok !== true) throw new Error("No valid capture payload found. Click Capture first.");
  return obj as PayloadOk;
}



