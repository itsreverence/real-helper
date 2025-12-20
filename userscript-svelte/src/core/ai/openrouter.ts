import {
  LAST_AI_JSON_KEY,
  LAST_AI_SOURCES_KEY,
  LAST_TOOL_TRACE_KEY,
  LAST_MESSAGES_KEY,
  FORCE_TOOL_CALL_KEY,
  FORCE_SEARCH_TOOL_KEY,
  ENABLE_PROFILE_TOOL_KEY,
  ENABLE_SEARCH_TOOL_KEY,
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
import { findModalRoot, parsePlayerPoolFromModalDom } from "../scrapers/capture";
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
          else {
            // Enhanced error logging for debugging provider issues
            const errorDetails = {
              status: resp.status,
              error: json?.error,
              message: json?.message,
              metadata: json?.error?.metadata,
              provider_error: json?.error?.metadata?.provider_error,
              raw: text?.slice(0, 2000), // First 2000 chars of raw response
            };
            console.error("[OpenRouter API Error]", errorDetails);
            // Store for debugging via console
            try {
              localStorage.setItem("RSDH_LAST_API_ERROR", JSON.stringify(errorDetails, null, 2));
            } catch { /* ignore */ }

            // Build a more descriptive error message
            const providerErr = json?.error?.metadata?.provider_error;
            const errCode = json?.error?.code;
            const errType = json?.error?.type;
            let errMsg = json?.error?.message || json?.message || `HTTP ${resp.status}`;
            if (providerErr) {
              errMsg += ` | Provider: ${typeof providerErr === 'string' ? providerErr : JSON.stringify(providerErr)}`;
            }
            if (errCode) errMsg += ` [code: ${errCode}]`;
            if (errType) errMsg += ` [type: ${errType}]`;

            reject(new Error(errMsg));
          }
        } catch (e) {
          console.error("[OpenRouter Parse Error]", e, resp?.responseText?.slice(0, 500));
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
            confidence: { type: "number", minimum: 0, maximum: 100 },
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

function toolSpec_search_draft_players() {
  return {
    type: "function",
    function: {
      name: "search_draft_players",
      description:
        "Search the draft modal for players by name. The initial pool shows up to ~50 players, but many more may be available. Use this to find specific players by name (full or partial) that might not appear in the initial list. Returns matching players with boost values. Note: only searches by player name, not position or team.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Player name or partial name to search for (e.g. 'McDavid', 'Connor', 'Ovi')." },
        },
        required: ["query"],
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

  if (toolName === "search_draft_players") {
    const query = String(args?.query || "").trim();
    if (!query) return { error: "missing_query" };

    emitDebugEvent("step", `Tool call: search_draft_players(${query})`, { scope: "tool" });

    // Find the draft modal using the same reliable method as capture
    const modal = findModalRoot();
    if (!modal) {
      emitDebugEvent("warn", "Draft modal not found for search", { scope: "tool" });
      return { error: "no_draft_modal", message: "Draft modal not found. Make sure the draft modal is open." };
    }

    emitDebugEvent("info", "Found draft modal", { scope: "tool" });

    // Find the search input - it's an input with placeholder containing "Search"
    const searchInput = modal.querySelector('input[placeholder*="Search"]') as HTMLInputElement
      || modal.querySelector('input[placeholder*="search"]') as HTMLInputElement
      || document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;

    if (!searchInput) {
      emitDebugEvent("warn", "Search input not found in modal", { scope: "tool" });
      return { error: "no_search_input", message: "Search input not found in modal" };
    }

    emitDebugEvent("step", "Found search input, entering query...", { scope: "tool" });

    // Clear existing value and set new query
    searchInput.value = "";
    searchInput.focus();

    // Simulate typing
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(searchInput, query);
    } else {
      searchInput.value = query;
    }
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait for debounce and results to filter (increased for reliability)
    await new Promise(r => setTimeout(r, 800));

    emitDebugEvent("step", "Scraping filtered player pool...", { scope: "tool" });

    // Use the same robust scraping as initial capture
    const playerPool = parsePlayerPoolFromModalDom(modal);

    emitDebugEvent("info", `Found ${playerPool.length} players matching '${query}'`, { scope: "tool" });

    // Clear the search to restore full list
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(searchInput, "");
    } else {
      searchInput.value = "";
    }
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Map to the expected format with boost as string
    const players = playerPool.map(p => ({
      name: p.name,
      boost: p.boost_x !== null && p.boost_x !== undefined ? `+${p.boost_x}x` : null,
      status: p.status,
      profile_url: p.profile_url || null,
    }));

    return { query, players_found: players.length, players };
  }

  return { error: "unknown_tool", toolName };
}

export async function askOpenRouterStructured(opts: { prompt: string; web: boolean; payload?: PayloadOk }): Promise<{ jsonText: string; sources: string[] }> {
  const cfg = getOpenRouterConfig();
  // Check bypass at runtime for the API key requirement
  const bypassCheck = (String(gmGet(BYPASS_PROXY_KEY, "0" as any)) === "1") || gmGet(BYPASS_PROXY_KEY, "0" as any) === true;
  const needsApiKey = !USE_PROXY || bypassCheck;
  if (needsApiKey && !cfg.apiKey) throw new Error("Missing OpenRouter API key.");

  // Require linked account when using proxy (not bypassing with own key)
  const useProxyMode = USE_PROXY && !bypassCheck;
  if (useProxyMode) {
    const identity = getUserIdentity();
    if (!identity?.username) {
      throw new Error("Please link your account in Settings before using Ask AI.");
    }
  }

  const forceTool = (String(gmGet(FORCE_TOOL_CALL_KEY, "0" as any)) === "1") || gmGet(FORCE_TOOL_CALL_KEY, "0" as any) === true;
  const forceSearchTool = (String(gmGet(FORCE_SEARCH_TOOL_KEY, "0" as any)) === "1") || gmGet(FORCE_SEARCH_TOOL_KEY, "0" as any) === true;

  let prompt = opts.prompt;
  if (forceTool) {
    prompt = [
      "DEBUG TOOL TEST: You MUST call the tool `get_player_profile_stats` exactly once before producing the final JSON schema answer.",
      "Pick ONE player from the available pool (prefer a high-boost or a close decision).",
      "IMPORTANT: Call the tool with return_to_draft=true so you can read dynamic Feed/Plays content, then come back to the draft.",
      "After you receive the tool result, continue normally and return the final JSON schema output.",
      "",
      opts.prompt,
    ].join("\n");
  } else if (forceSearchTool) {
    prompt = [
      "DEBUG TOOL TEST: You MUST call the tool `search_draft_players` exactly once before producing the final JSON schema answer.",
      "Search for a player by name (e.g. 'McDavid', 'Crosby', 'Ovi') to find additional players that may not be in the initial list.",
      "Note: This search only works with player names, not positions or teams.",
      "After you receive the search results, continue normally and return the final JSON schema output.",
      "",
      opts.prompt,
    ].join("\n");
  }

  const toolTrace: ToolTraceEntry[] = [{ t: nowIso(), kind: "start", model: cfg.model, web: !!opts.web }];
  writeToolTrace(toolTrace);

  // Check which tools are enabled (default: true for both)
  const profileToolEnabled = gmGet(ENABLE_PROFILE_TOOL_KEY, "1" as any) !== "0";
  const searchToolEnabledSetting = gmGet(ENABLE_SEARCH_TOOL_KEY, "1" as any) !== "0";

  // Automatically disable search tool if player pool < 50 (all options already visible)
  // This is common in game drafts where only 2 teams participate (~30-35 players total)
  const poolCount = opts.payload?.player_pool_count ?? opts.payload?.player_pool?.length ?? 0;
  const searchToolEnabled = searchToolEnabledSetting && poolCount >= 50;

  const tools = [
    ...(profileToolEnabled ? [toolSpec_get_player_profile_stats()] : []),
    ...(searchToolEnabled ? [toolSpec_search_draft_players()] : []),
  ];

  // Determine if we should force a specific tool (for debugging)
  const forcedToolChoice = forceTool
    ? { type: "function", function: { name: "get_player_profile_stats" } }
    : forceSearchTool
      ? { type: "function", function: { name: "search_draft_players" } }
      : "auto";

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
      if (identity.displayName) {
        baseHeaders["X-RSDH-DisplayName"] = identity.displayName;
      }
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

  // Detect Gemini models to use compatible parameters from the start
  // Gemini 2.0+ doesn't support parallel_tool_calls or provider.require_parameters
  const isGeminiModel = cfg.model.toLowerCase().includes('gemini');

  for (let i = 0; i < maxIterations; i++) {
    const baseBody: any = {
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
      max_tokens: cfg.max_tokens,
      tools,
    };

    // Build attempts based on model compatibility
    // Gemini models: skip parameters they don't support to avoid 404 fallbacks
    const attempts = isGeminiModel
      ? [
        // Gemini-compatible: just tools with tool_choice
        { label: "gemini+tools+tool_choice", body: { ...baseBody, tool_choice: forcedToolChoice, plugins: toolLoopPlugins } },
        // Fallback: tools only
        { label: "gemini+tools-only", body: { ...baseBody, plugins: toolLoopPlugins } },
      ]
      : [
        // Standard models: try all parameter combinations
        { label: "tools+tool_choice+parallel+provider", body: { ...baseBody, tool_choice: forcedToolChoice, parallel_tool_calls: false, provider: { require_parameters: true }, plugins: toolLoopPlugins } },
        { label: "tools+tool_choice+provider", body: { ...baseBody, tool_choice: forcedToolChoice, provider: { require_parameters: true }, plugins: toolLoopPlugins } },
        { label: "tools+tool_choice", body: { ...baseBody, tool_choice: forcedToolChoice, plugins: toolLoopPlugins } },
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

    // Push assistant tool call message preserving ALL fields (required for Gemini 2.0+ thought signatures)
    // See: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#preserving-reasoning-blocks
    // Debug: log the full message structure to understand what fields Gemini returns
    console.log("[OpenRouter] Assistant message with tool calls:", JSON.stringify(msg, null, 2));
    try {
      localStorage.setItem("RSDH_LAST_ASSISTANT_MSG", JSON.stringify(msg, null, 2));
    } catch { /* ignore */ }

    // For Gemini models with reasoning_details, we need to limit tool calls to what has reasoning data
    // Gemini's reasoning_details array contains entries matched by id to specific tool calls
    const reasoningDetailsIds = new Set(
      (Array.isArray(msg?.reasoning_details) ? msg.reasoning_details : [])
        .map((rd: any) => rd?.id)
        .filter(Boolean)
    );

    // Determine how many tool calls to process BEFORE we build the assistant message
    // If there are reasoning_details, only process tool calls that have matching reasoning
    // Otherwise, limit to 3 to avoid long processing times
    let toolCallsToProcess: any[];
    if (reasoningDetailsIds.size > 0) {
      // Filter to only tool calls with reasoning_details
      const matchedToolCalls = toolCalls.filter((tc: any) => reasoningDetailsIds.has(tc?.id));
      console.log(`[OpenRouter] Gemini reasoning_details present: ${reasoningDetailsIds.size} entries, ${matchedToolCalls.length} matched tool calls`);
      // If we have matches, use those; otherwise fall back to first tool call only
      toolCallsToProcess = matchedToolCalls.length > 0 ? matchedToolCalls : toolCalls.slice(0, 1);
    } else {
      toolCallsToProcess = toolCalls.slice(0, 3);
    }

    // Get the set of tool call IDs we're actually processing
    const toolCallIdsToProcess = new Set(toolCallsToProcess.map((tc: any) => tc?.id).filter(Boolean));

    // Use JSON deep clone to ensure we don't have any reference issues that could corrupt data
    // This is critical for preserving reasoning_details/thought signatures exactly as received
    const assistantMsg: any = JSON.parse(JSON.stringify(msg));
    // Ensure role is set (in case it wasn't in the response)
    assistantMsg.role = "assistant";
    // Ensure content field exists
    if (!('content' in assistantMsg)) assistantMsg.content = null;

    // CRITICAL: Filter tool_calls and reasoning_details to ONLY include the ones we're processing
    // This prevents mismatch between # of tool_calls and # of tool results
    if (Array.isArray(assistantMsg.tool_calls)) {
      assistantMsg.tool_calls = assistantMsg.tool_calls.filter((tc: any) => toolCallIdsToProcess.has(tc?.id));
      console.log(`[OpenRouter] Filtered assistant tool_calls to ${assistantMsg.tool_calls.length} (from ${toolCalls.length})`);
    }
    if (Array.isArray(assistantMsg.reasoning_details)) {
      assistantMsg.reasoning_details = assistantMsg.reasoning_details.filter((rd: any) => toolCallIdsToProcess.has(rd?.id));
      console.log(`[OpenRouter] Filtered reasoning_details to ${assistantMsg.reasoning_details.length}`);
    }

    messages.push(assistantMsg);

    for (const tc of toolCallsToProcess) {
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
      if (toolName === "search_draft_players") {
        summary.query = r?.query || args?.query || null;
        summary.players_found = typeof r?.players_found === "number" ? r.players_found : 0;
        // Include first 5 player names for quick reference
        if (Array.isArray(r?.players) && r.players.length > 0) {
          summary.sample_players = r.players.slice(0, 5).map((p: any) => p.name);
        }
        if (r?.error) summary.error = r.error;
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

  // Debug: log the full messages array we're about to send
  console.log("[OpenRouter] Messages after tool loop:", JSON.stringify(messages, null, 2));
  try {
    localStorage.setItem("RSDH_LAST_MESSAGES_SENT", JSON.stringify(messages, null, 2));
  } catch { /* ignore */ }

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

  // Build final attempts based on model compatibility (same as tool loop)
  const finalAttempts = isGeminiModel
    ? [
      // Gemini-compatible: simple schema call with tool_choice none
      { label: "gemini+final+tools+tool_choice", body: { ...finalBase, tools, tool_choice: "none", plugins } },
      { label: "gemini+final+schema+plugins", body: { ...finalBase, plugins } },
      { label: "gemini+final+schema-only", body: { ...finalBase } },
    ]
    : [
      // Standard models: try all parameter combinations
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



