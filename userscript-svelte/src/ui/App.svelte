<script lang="ts">
  import { onMount } from "svelte";
  import {
    buildPromptFromLastCapture,
    buildStructuredPromptFromLastCapture,
    captureNow,
    loadLastPayloadRaw,
    openDraftModal,
  } from "./services/captureBridge";
  import { askAi, askAiWeb } from "./services/openRouterBridge";
  import { getUiState, setUiState, type Tab } from "./services/state";
  import { renderAiJsonHtml, renderPayloadHtml } from "../core";
  import { getDebugMode, setDebugMode } from "../core";
  import { toastSuccess, toastError, toastInfo } from "../core";
  import { getCachedModels, fetchOpenRouterModels } from "../core";
  import {
    OR_DEFAULT_MAXTOK,
    OR_DEFAULT_MODEL,
    OR_DEFAULT_TEMP,
    OR_DEFAULT_WEB_MAX_RESULTS,
    OR_HEAL,
    OR_KEY,
    OR_MAXTOK,
    OR_MODEL,
    OR_STRUCTURED,
    OR_TEMP,
    OR_WEB_MAX_RESULTS,
    LAST_AI_SOURCES_KEY,
    LAST_AI_JSON_KEY,
    LAST_TOOL_TRACE_KEY,
    LAST_DEBUG_EVENTS_KEY,
    FORCE_TOOL_CALL_KEY,
    FORCE_SEARCH_TOOL_KEY,
    BYPASS_PROXY_KEY,
    ENABLE_PROFILE_TOOL_KEY,
    ENABLE_WEB_SEARCH_KEY,
    ENABLE_SEARCH_TOOL_KEY,
    LINEUP_STRATEGY_KEY,
    USE_PROXY,
    PROXY_ENDPOINT,
  } from "../core";
  import { gmGet, gmSet } from "../core";
  import {
    getUserIdentity,
    setUserIdentity,
    clearUserIdentity,
    scrapeProfileFromPage,
    isOnProfilePage,
    navigateToProfile,
    type UserIdentity,
  } from "../core";

  let tab: Tab = "context";
  let outputRaw = "";
  let lastPayloadRaw = "";
  let outputHtml = "";
  let askMenuOpen = false;
  let askMenuHost: HTMLDivElement | null = null;
  let isLoading = false;
  let loadingMessage = "";

  // Debug data
  let lastAiJson = "";
  let lastChatPrompt = "";
  let lastStructuredPrompt = "";
  let lastSources = "";
  let lastToolTrace = "";
  let lastDebugEvents = "";
  let aiResultHtml = "";

  // settings
  let debugMode = false;
  let apiKey = "";
  let model = OR_DEFAULT_MODEL;
  let temperature = OR_DEFAULT_TEMP;
  let maxTokens = String(OR_DEFAULT_MAXTOK);
  let webMaxResults = OR_DEFAULT_WEB_MAX_RESULTS;
  let structured = true;
  let healing = true;
  let forceToolChoice = "none"; // none | profile | search
  let bypassProxy = false; // Debug mode: bypass proxy and use direct API
  let enableProfileTool = true; // Enable AI to look up player profiles
  let enableWebSearch = true; // Enable AI to search the web
  let enableSearchTool = true; // Enable AI to search draft players
  let lineupStrategy = "balanced"; // safe | balanced | risky

  // Managed config from proxy
  let managedConfig: {
    defaultModel?: string;
    temperature?: number;
    maxTokens?: number;
    enableWebSearch?: boolean;
    webMaxResults?: number;
  } | null = null;

  // User identity for profile linking
  let linkedUser: UserIdentity | null = null;
  let linkingStatus = "";

  async function tryLinkProfile() {
    linkingStatus = "Navigating to profile...";

    // First, try to navigate to the profile page
    const navigated = await navigateToProfile();
    if (!navigated) {
      linkingStatus =
        "Could not find profile button. Are you on realsports.io?";
      toastError("Profile button not found");
      return;
    }

    // Wait a bit more for the profile panel to fully render
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Now try to scrape
    const identity = scrapeProfileFromPage();
    if (identity) {
      setUserIdentity(identity);
      linkedUser = identity;
      linkingStatus = "";
      toastSuccess(`Linked as @${identity.username}`);
    } else {
      linkingStatus = "Could not find profile. Make sure you're logged in.";
      toastError("Profile not found");
    }
  }

  function unlinkProfile() {
    clearUserIdentity();
    linkedUser = null;
    toastInfo("Account unlinked");
  }

  // OpenRouter models (loaded dynamically with cache)
  let availableModels: string[] = getCachedModels();

  function setTab(t: Tab) {
    // If switching to debug tab but debug mode is off, go to context instead
    if (t === "debug" && !debugMode) {
      t = "context";
    }
    tab = t;
    setUiState({ tab: t });
  }

  onMount(() => {
    const st = getUiState();
    debugMode = getDebugMode();
    // If saved tab was debug but debug mode is off, fall back to context
    tab = st.tab === "debug" && !debugMode ? "context" : st.tab;

    lastPayloadRaw = loadLastPayloadRaw();
    outputRaw = lastPayloadRaw;
    renderFromRaw();

    apiKey = String(gmGet(OR_KEY, "") || "");
    model = String(gmGet(OR_MODEL, OR_DEFAULT_MODEL) || OR_DEFAULT_MODEL);
    temperature =
      parseFloat(String(gmGet(OR_TEMP, OR_DEFAULT_TEMP))) || OR_DEFAULT_TEMP;
    maxTokens = String(gmGet(OR_MAXTOK, OR_DEFAULT_MAXTOK as any));
    webMaxResults =
      parseInt(
        String(gmGet(OR_WEB_MAX_RESULTS, OR_DEFAULT_WEB_MAX_RESULTS)),
        10,
      ) || OR_DEFAULT_WEB_MAX_RESULTS;
    structured =
      String(gmGet(OR_STRUCTURED, true as any)) === "1" ||
      gmGet(OR_STRUCTURED, true as any) === true;
    healing =
      String(gmGet(OR_HEAL, true as any)) === "1" ||
      gmGet(OR_HEAL, true as any) === true;
    // Load force tool choice from the old keys for backwards compatibility
    const forceProfile =
      String(gmGet(FORCE_TOOL_CALL_KEY, "0" as any)) === "1" ||
      gmGet(FORCE_TOOL_CALL_KEY, "0" as any) === true;
    const forceSearch =
      String(gmGet(FORCE_SEARCH_TOOL_KEY, "0" as any)) === "1" ||
      gmGet(FORCE_SEARCH_TOOL_KEY, "0" as any) === true;
    forceToolChoice = forceProfile
      ? "profile"
      : forceSearch
        ? "search"
        : "none";
    bypassProxy =
      String(gmGet(BYPASS_PROXY_KEY, "0" as any)) === "1" ||
      gmGet(BYPASS_PROXY_KEY, "0" as any) === true;
    enableProfileTool = gmGet(ENABLE_PROFILE_TOOL_KEY, "1" as any) !== "0";
    enableWebSearch = gmGet(ENABLE_WEB_SEARCH_KEY, "1" as any) !== "0";
    enableSearchTool = gmGet(ENABLE_SEARCH_TOOL_KEY, "1" as any) !== "0";
    lineupStrategy = String(
      gmGet(LINEUP_STRATEGY_KEY, "balanced" as any) || "balanced",
    );

    // Load linked user identity
    linkedUser = getUserIdentity();

    // Fetch fresh models in background (updates cache)
    fetchOpenRouterModels().then((models) => {
      availableModels = models;
    });

    // Fetch managed config from proxy
    if (USE_PROXY && PROXY_ENDPOINT) {
      fetch(`${PROXY_ENDPOINT}/api/info`)
        .then((res) => res.json())
        .then((config) => {
          managedConfig = config;
        })
        .catch(() => {
          /* ignore */
        });
    }

    const onDocClick = (ev: MouseEvent) => {
      if (!askMenuOpen) return;
      const path = (ev.composedPath?.() || []) as EventTarget[];
      if (askMenuHost && path.includes(askMenuHost)) return;
      askMenuOpen = false;
    };
    document.addEventListener("click", onDocClick, true);

    const onOut = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { raw?: string } | undefined;
      if (!detail?.raw) return;

      try {
        const obj = JSON.parse(detail.raw);

        // If this is a payload capture (has ok: true), it's context data
        if (obj?.ok === true) {
          outputRaw = detail.raw;
          lastPayloadRaw = detail.raw;
          // Clear old AI-related data since this is a fresh capture
          lastAiJson = "";
          lastToolTrace = "";
          lastSources = "";
          // Generate prompts for debug view
          try {
            lastChatPrompt = buildPromptFromLastCapture(detail.raw);
          } catch {
            lastChatPrompt = "";
          }
          try {
            lastStructuredPrompt = buildStructuredPromptFromLastCapture(
              detail.raw,
            );
          } catch {
            lastStructuredPrompt = "";
          }
          renderFromRaw();
          tab = "context";
          return;
        }

        // If this is an AI response with lineup/bets, render in Results tab
        if (obj && Array.isArray(obj.lineup) && Array.isArray(obj.bets)) {
          lastAiJson = detail.raw;
          // Load debug data from localStorage
          try {
            const s = JSON.parse(
              localStorage.getItem(LAST_AI_SOURCES_KEY) || "[]",
            );
            lastSources = Array.isArray(s) ? s.join("\n") : String(s);
          } catch {
            lastSources = "";
          }
          try {
            lastToolTrace = String(
              localStorage.getItem(LAST_TOOL_TRACE_KEY) || "",
            );
          } catch {
            lastToolTrace = "";
          }
          try {
            lastDebugEvents = String(
              localStorage.getItem(LAST_DEBUG_EVENTS_KEY) || "",
            );
          } catch {
            lastDebugEvents = "";
          }
          aiResultHtml = renderAiJsonHtml(
            obj,
            lastSources ? lastSources.split("\n") : [],
          );
          tab = "results";
          return;
        }
      } catch {
        // Non-JSON output, treat as raw
      }

      // Fallback: put in context tab
      outputRaw = detail.raw;
      renderFromRaw();
      tab = "context";
    };

    const onDbg = () => {
      try {
        lastDebugEvents = String(
          localStorage.getItem(LAST_DEBUG_EVENTS_KEY) || "",
        );
      } catch {
        lastDebugEvents = "";
      }
    };

    window.addEventListener("rsdh-output", onOut as any);
    window.addEventListener("rsdh-debug-events", onDbg as any);

    return () => {
      document.removeEventListener("click", onDocClick, true);
      window.removeEventListener("rsdh-output", onOut as any);
      window.removeEventListener("rsdh-debug-events", onDbg as any);
    };
  });

  function renderFromRaw() {
    const raw = (outputRaw || "").trim();
    if (!raw) {
      outputHtml = `<div class="card"><div class="h">Output</div><div class="sub">Capture a draft modal or run Ask AI.</div></div>`;
      return;
    }
    try {
      const obj = JSON.parse(raw);
      if (obj && obj.ok === true) {
        outputHtml = renderPayloadHtml(obj);
        return;
      }
      if (obj && Array.isArray(obj.lineup) && Array.isArray(obj.bets)) {
        let sources: string[] = [];
        try {
          sources =
            JSON.parse(localStorage.getItem(LAST_AI_SOURCES_KEY) || "[]") || [];
        } catch {}
        outputHtml = renderAiJsonHtml(obj, sources);
        return;
      }
    } catch {
      // ignore
    }
    outputHtml = `<div class="card"><div class="h">Output</div><pre class="code-output">${raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></div>`;
  }

  async function onCapture() {
    setTab("context");
    try {
      const payload = captureNow(debugMode);
      lastPayloadRaw = JSON.stringify(payload, null, 2);
      outputRaw = lastPayloadRaw;
      renderFromRaw();
    } catch (e) {
      // Error handled in renderFromRaw
    }
  }

  async function onCopyPrompt() {
    try {
      const prompt = buildPromptFromLastCapture(
        lastPayloadRaw || loadLastPayloadRaw(),
      );
      GM_setClipboard(prompt);
    } catch (e) {
      toastError(`Copy prompt error: ${String((e as Error)?.message || e)}`);
    }
  }

  async function onAsk(web: boolean) {
    isLoading = true;
    loadingMessage = web ? "Searching web & asking AI..." : "Thinking...";
    setTab("context");
    askMenuOpen = false;
    try {
      const payloadRaw = lastPayloadRaw || loadLastPayloadRaw();
      const res = web ? await askAiWeb(payloadRaw) : await askAi(payloadRaw);
      outputRaw = res;
      renderFromRaw();
    } catch (e) {
      toastError(`Ask error: ${String((e as Error)?.message || e)}`);
    } finally {
      isLoading = false;
      loadingMessage = "";
    }
  }

  function onClear() {
    outputRaw = "";
    outputHtml = `<div class="card"><div class="h">Output</div><div class="sub">Cleared.</div></div>`;
    toastInfo("Output cleared");
  }

  function copyText(s: string) {
    try {
      GM_setClipboard(s);
      toastSuccess("Copied to clipboard!");
    } catch (e) {
      const msg = `Copy failed: ${String((e as Error)?.message || e)}`;
      toastError(msg);
    }
  }

  function onSaveSettings() {
    const parsedMaxTokens = parseInt(maxTokens, 10);
    if (isNaN(parsedMaxTokens) || parsedMaxTokens < 1) {
      maxTokens = "1";
      toastError("Max tokens must be at least 1");
      return;
    }

    if (apiKey.trim() && apiKey.trim() !== "********")
      gmSet(OR_KEY, apiKey.trim());
    gmSet(OR_MODEL, (model || OR_DEFAULT_MODEL).trim());
    gmSet(OR_TEMP, String(temperature));
    gmSet(OR_MAXTOK, String(parsedMaxTokens));
    gmSet(OR_WEB_MAX_RESULTS, String(webMaxResults));
    gmSet(OR_STRUCTURED, structured ? "1" : "0");
    gmSet(OR_HEAL, healing ? "1" : "0");
    gmSet(FORCE_TOOL_CALL_KEY, forceToolChoice === "profile" ? "1" : "0");
    gmSet(FORCE_SEARCH_TOOL_KEY, forceToolChoice === "search" ? "1" : "0");
    gmSet(BYPASS_PROXY_KEY, bypassProxy ? "1" : "0");
    gmSet(ENABLE_PROFILE_TOOL_KEY, enableProfileTool ? "1" : "0");
    gmSet(ENABLE_WEB_SEARCH_KEY, enableWebSearch ? "1" : "0");
    gmSet(ENABLE_SEARCH_TOOL_KEY, enableSearchTool ? "1" : "0");
    setDebugMode(debugMode);

    // If debug mode turned off and we're on debug tab, switch to context
    if (!debugMode && tab === "debug") {
      setTab("context");
    }

    toastSuccess("Settings saved!");
  }
</script>

<div class="panel">
  <div class="texture-overlay"></div>

  <div class="header">
    <div class="title">
      <i>✦</i> BROADCAST COMMAND CENTER
    </div>
    <div class="flex-row">
      {#if isLoading}
        <div class="spinner"></div>
      {/if}
      <button
        class="secondary"
        style="width: auto; padding: 6px 10px;"
        on:click={() => setUiState({ hidden: true })}
      >
        EXIT
      </button>
    </div>
  </div>

  <!-- Live Ticker -->
  <div class="ticker-container">
    <div class="ticker-label">LIVE FEED</div>
    <div class="ticker-wrapper">
      {#if lastPayloadRaw}
        {@const p = JSON.parse(lastPayloadRaw)}
        {@const playerCount = p.player_pool?.length || 4}
        {@const duration = Math.max(20, playerCount * 1.5)}
        {#if p.player_pool}
          <div class="ticker-content" style="animation-duration: {duration}s;">
            {#each p.player_pool as player}
              <span>{player.name} ({(player.boost_x ?? 0).toFixed(1)}x)</span>
              <span class="text-accent">•</span>
            {/each}
            {#each p.player_pool as player}
              <span>{player.name} ({(player.boost_x ?? 0).toFixed(1)}x)</span>
              <span class="text-accent">•</span>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="ticker-content" style="animation-duration: 15s;">
          <span>WAITING FOR DRAFT DATA...</span>
          <span class="text-accent">•</span>
          <span>AI ANALYSIS READY...</span>
          <span class="text-accent">•</span>
          <span>WAITING FOR DRAFT DATA...</span>
          <span class="text-accent">•</span>
          <span>AI ANALYSIS READY...</span>
          <span class="text-accent">•</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- Tab bar -->
  <div class="tabs">
    <button
      class="tab {tab === 'context' ? 'active' : ''}"
      on:click={() => setTab("context")}>Context</button
    >
    <button
      class="tab {tab === 'results' ? 'active' : ''}"
      on:click={() => setTab("results")}>Results</button
    >
    <button
      class="tab {tab === 'settings' ? 'active' : ''}"
      on:click={() => setTab("settings")}>Settings</button
    >
    {#if debugMode}
      <button
        class="tab {tab === 'debug' ? 'active' : ''}"
        on:click={() => setTab("debug")}
        style="--rsdh-accent: #f59e0b;"
      >
        Debug
      </button>
    {/if}
  </div>

  <!-- Context Tab -->
  <div class="view {tab === 'context' ? '' : 'hidden'}">
    {#if isLoading}
      <div class="loading-container">
        <div class="spinner"></div>
        <div class="loading-text">{loadingMessage}</div>
      </div>
    {:else if outputHtml}
      <div>{@html outputHtml}</div>
    {:else}
      <div class="empty-state">
        <div class="empty-icon">📡</div>
        <h3 class="empty-title">NO SIGNAL DETECTED</h3>
        <p class="empty-description">
          Awaiting input from RealSports draft modal. Capture to initiate
          analysis.
        </p>
        <div class="empty-hint">
          <span class="text-accent">READY TO RECEIVE</span>
        </div>
      </div>
    {/if}
  </div>

  <!-- Results Tab -->
  <div class="view {tab === 'results' ? '' : 'hidden'}">
    {#if isLoading}
      <div class="loading-container">
        <div class="spinner"></div>
        <div class="loading-text">{loadingMessage}</div>
      </div>
    {:else if aiResultHtml}
      <div>{@html aiResultHtml}</div>
    {:else}
      <div class="empty-state">
        <div class="empty-icon">🤖</div>
        <h3 class="empty-title">AI CO-PILOT OFFLINE</h3>
        <p class="empty-description">
          Execute 'ASK AI' to generate real-time roster optimizations and fit
          scores.
        </p>
        <div class="empty-hint">
          <span class="text-green">SYSTEMS READY</span>
        </div>
      </div>
    {/if}
  </div>

  <!-- Settings Tab -->
  <div class="view {tab === 'settings' ? '' : 'hidden'}">
    <!-- Account Linking Card -->
    <div class="card">
      <div class="h">
        <span>ACCOUNT IDENTITY</span>
      </div>
      {#if linkedUser}
        <div
          style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;"
        >
          {#if linkedUser.avatarUrl}
            <img
              src={linkedUser.avatarUrl}
              alt=""
              style="width: 40px; height: 40px; border-radius: 50%; border: 2px solid var(--rsdh-accent);"
            />
          {:else}
            <div
              style="width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center;"
            >
              👤
            </div>
          {/if}
          <div>
            {#if linkedUser.displayName && linkedUser.displayName !== linkedUser.username}
              <div style="font-weight: 600; color: rgba(255,255,255,0.9);">
                {linkedUser.displayName}
              </div>
            {/if}
            <div class="sub">@{linkedUser.username}</div>
          </div>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button style="font-size: 11px;" on:click={tryLinkProfile}>
            🔄 Update
          </button>
          <button
            class="secondary"
            style="font-size: 11px;"
            on:click={unlinkProfile}
          >
            Unlink
          </button>
        </div>
        {#if linkingStatus}
          <div
            class="sub"
            style="margin-top: 8px; color: rgba(245,158,11,0.9);"
          >
            {linkingStatus}
          </div>
        {/if}
      {:else}
        <div
          class="sub"
          style="margin-bottom:12px; padding: 8px 10px; background: rgba(245,158,11,0.08); border-radius: 6px; border-left: 2px solid rgba(245,158,11,0.4);"
        >
          Link your RealSports account to enable usage tracking.
        </div>
        <button on:click={tryLinkProfile}> 🔗 Link Account </button>
        {#if linkingStatus}
          <div
            class="sub"
            style="margin-top: 8px; color: rgba(245,158,11,0.9);"
          >
            {linkingStatus}
          </div>
        {/if}
      {/if}
    </div>

    <div class="card">
      <div class="h">
        <span>API ENDPOINT CONFIG</span>
      </div>
      {#if !USE_PROXY}
        <div
          class="sub"
          style="margin-bottom:12px; padding: 8px 10px; background: rgba(255,200,0,0.08); border-radius: 6px; border-left: 2px solid rgba(255,200,0,0.4);"
        >
          Your API key is stored locally and never shared.
        </div>
        <label class="sub" for="or-key">API Key</label>
        <input
          id="or-key"
          style="width:100%; margin-bottom:8px;"
          type="password"
          bind:value={apiKey}
          placeholder="sk-or-..."
        />
      {/if}
      <div
        style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;"
      >
        <div style="grid-column: span 2;">
          <label class="sub" for="or-model">Model</label>
          <input
            id="or-model"
            style="width:100%; margin-bottom:8px; {!bypassProxy
              ? 'opacity: 0.6; font-style: italic;'
              : ''}"
            type="text"
            value={!bypassProxy && managedConfig?.defaultModel
              ? managedConfig.defaultModel === "any"
                ? "Dynamic Selection"
                : managedConfig.defaultModel
              : model}
            on:input={(e) =>
              bypassProxy && (model = (e.target as HTMLInputElement).value)}
            list="model-list"
            placeholder={!bypassProxy
              ? "Managed by Admin"
              : "Start typing to search..."}
            disabled={!bypassProxy}
          />
          {#if bypassProxy}
            <datalist id="model-list">
              {#each availableModels as m}
                <option value={m}>{m}</option>
              {/each}
            </datalist>
          {/if}
        </div>
        <div>
          <label class="sub" for="or-max">Max tokens</label>
          <input
            id="or-max"
            style="width:100%; {!bypassProxy ? 'opacity: 0.6;' : ''}"
            type="text"
            value={!bypassProxy && managedConfig?.maxTokens
              ? String(managedConfig.maxTokens)
              : maxTokens}
            on:input={(e) =>
              bypassProxy && (maxTokens = (e.target as HTMLInputElement).value)}
            disabled={!bypassProxy}
          />
        </div>
        <div style="grid-column: span 2;">
          <label class="sub" for="or-temp"
            >Temperature: {!bypassProxy &&
            managedConfig?.temperature !== undefined
              ? managedConfig.temperature
              : temperature}</label
          >
          <input
            id="or-temp"
            style="width:100%; {!bypassProxy ? 'opacity: 0.6;' : ''}"
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={!bypassProxy && managedConfig?.temperature !== undefined
              ? managedConfig.temperature
              : temperature}
            on:input={(e) =>
              bypassProxy &&
              (temperature = parseFloat((e.target as HTMLInputElement).value))}
            disabled={!bypassProxy}
          />
        </div>
        {#if !bypassProxy}
          <div
            style="grid-column: span 2; padding: 8px; background: rgba(0,229,255,0.03); border: 1px dashed rgba(0,229,255,0.2); border-radius: 4px; text-align: center; margin-top: 4px;"
          >
            <span
              class="sub"
              style="font-size: 9px; color: var(--rsdh-accent); opacity: 0.8;"
              >✦ SETTINGS_LOADED_FROM_PROXY</span
            >
          </div>
        {/if}
      </div>
      <label
        style="display:flex; align-items:center; gap:10px; font-size:12px; color: rgba(255,255,255,0.90); user-select:none; cursor:pointer; margin-top: 12px; {!bypassProxy
          ? 'opacity: 0.6;'
          : ''}"
      >
        <input
          type="checkbox"
          checked={!bypassProxy && managedConfig?.enableWebSearch !== undefined
            ? managedConfig.enableWebSearch
            : enableWebSearch}
          on:change={(e) =>
            bypassProxy &&
            (enableWebSearch = (e.target as HTMLInputElement).checked)}
          disabled={!bypassProxy}
        />
        <span
          ><strong>Web Search</strong><br /><span class="sub"
            >Search the web for current player news and updates</span
          ></span
        >
      </label>
      {#if !bypassProxy && managedConfig?.enableWebSearch !== undefined ? managedConfig.enableWebSearch : enableWebSearch}
        <div
          style="margin-top:8px; margin-left: 28px; {!bypassProxy
            ? 'opacity: 0.6;'
            : ''}"
        >
          <label class="sub" for="or-web"
            >Max results: {!bypassProxy &&
            managedConfig?.webMaxResults !== undefined
              ? managedConfig.webMaxResults
              : webMaxResults}</label
          >
          <input
            id="or-web"
            style="width:100%;"
            type="range"
            min="1"
            max="5"
            step="1"
            value={!bypassProxy && managedConfig?.webMaxResults !== undefined
              ? managedConfig.webMaxResults
              : webMaxResults}
            on:input={(e) =>
              bypassProxy &&
              (webMaxResults = parseInt(
                (e.target as HTMLInputElement).value,
                10,
              ))}
            disabled={!bypassProxy}
          />
        </div>
      {/if}

      <label
        style="display:flex; align-items:center; gap:10px; font-size:12px; color: rgba(255,255,255,0.90); user-select:none; cursor:pointer; margin-top: 12px;"
      >
        <input type="checkbox" bind:checked={enableProfileTool} />
        <span
          ><strong>Player Profile Lookup</strong><br /><span class="sub"
            >Allow AI to look up detailed player stats from their profile</span
          ></span
        >
      </label>
      <label
        style="display:flex; align-items:center; gap:10px; font-size:12px; color: rgba(255,255,255,0.90); user-select:none; cursor:pointer; margin-top: 12px;"
      >
        <input type="checkbox" bind:checked={enableSearchTool} />
        <span
          ><strong>Draft Player Search</strong><br /><span class="sub"
            >Allow AI to search for players not in the initial ~50 shown</span
          ></span
        >
      </label>

      <!-- Force Tool Call -->
      <label
        style="display:flex; align-items:center; gap:10px; font-size:12px; color: rgba(255,255,255,0.90); user-select:none; cursor:pointer; margin-top: 12px;"
      >
        <input
          type="checkbox"
          checked={forceToolChoice !== "none"}
          on:change={(e) => {
            if ((e.target as HTMLInputElement).checked) {
              forceToolChoice = "profile";
            } else {
              forceToolChoice = "none";
            }
            gmSet(
              FORCE_TOOL_CALL_KEY,
              forceToolChoice === "profile" ? "1" : "0",
            );
            gmSet(
              FORCE_SEARCH_TOOL_KEY,
              forceToolChoice === "search" ? "1" : "0",
            );
          }}
        />
        <span
          ><strong>Force Tool Call</strong><br /><span class="sub"
            >Make AI always use a specific tool before analyzing</span
          ></span
        >
      </label>
      {#if forceToolChoice !== "none"}
        <div style="margin-top: 8px; margin-left: 28px;">
          <select
            style="width:100%; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.3); color: #fff; font-size: 13px;"
            bind:value={forceToolChoice}
            on:change={() => {
              gmSet(
                FORCE_TOOL_CALL_KEY,
                forceToolChoice === "profile" ? "1" : "0",
              );
              gmSet(
                FORCE_SEARCH_TOOL_KEY,
                forceToolChoice === "search" ? "1" : "0",
              );
            }}
          >
            <option value="profile">🔍 Player Profile Lookup</option>
            <option value="search">🔎 Draft Player Search</option>
          </select>
        </div>
      {/if}

      <!-- Lineup Strategy Dropdown -->
      <div style="margin-top: 16px;">
        <label class="sub" for="lineup-strategy">Lineup Strategy</label>
        <select
          id="lineup-strategy"
          style="width:100%; margin-top: 4px; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.3); color: #fff; font-size: 13px;"
          bind:value={lineupStrategy}
          on:change={() => gmSet(LINEUP_STRATEGY_KEY, lineupStrategy)}
        >
          <option value="safe">🛡️ Safe - Consistent, high floor players</option>
          <option value="balanced">⚖️ Balanced - Mix of floor and upside</option
          >
          <option value="risky">🎲 Risky - Boom-or-bust, high ceiling</option>
        </select>
        <div class="sub" style="margin-top: 4px;">
          {#if lineupStrategy === "safe"}
            Prioritizes consistent performers for reliable results
          {:else if lineupStrategy === "risky"}
            Targets high upside players for ceiling plays
          {:else}
            Default strategy balancing consistency and upside
          {/if}
        </div>
      </div>
    </div>

    <!-- Advanced Settings (Collapsible in Card) -->
    <div class="card">
      <details class="details" style="margin: -12px -14px; padding: 12px 14px;">
        <summary>⚙️ Advanced</summary>
        <div style="margin-top: 12px;">
          <label
            style="display:flex; align-items:center; gap:10px; font-size:12px; color: rgba(255,255,255,0.90); user-select:none; cursor:pointer; margin-bottom: 12px;"
          >
            <input type="checkbox" bind:checked={bypassProxy} />
            <span
              ><strong>Use my own API key</strong><br /><span class="sub"
                >Bypass hosted proxy and call OpenRouter directly</span
              ></span
            >
          </label>
          {#if bypassProxy}
            <label class="sub" for="or-key">Your OpenRouter API Key</label>
            <input
              id="or-key"
              style="width:100%; margin-bottom:8px;"
              type="password"
              bind:value={apiKey}
              placeholder="sk-or-..."
            />
            <div class="sub" style="color: rgba(245,158,11,0.8);">
              ⚠️ Your key is stored locally. You will be billed directly.
            </div>
          {/if}
          <label
            style="display:flex; align-items:center; gap:10px; font-size:12px; color: rgba(255,255,255,0.90); user-select:none; cursor:pointer; margin-top: 12px;"
          >
            <input type="checkbox" bind:checked={debugMode} />
            <span
              ><strong>Debug Mode</strong><br /><span class="sub"
                >Show Debug tab with raw data and developer tools</span
              ></span
            >
          </label>
        </div>
      </details>
    </div>

    <div style="display:flex; gap:8px; margin-top:14px;">
      <button
        on:click={onSaveSettings}
        style="display:flex; align-items:center; justify-content:center; gap:6px;"
      >
        <span>💾</span> Save Settings
      </button>
    </div>
  </div>

  <!-- Debug Tab (only rendered when debugMode is true) -->
  {#if debugMode}
    <div class="view {tab === 'debug' ? '' : 'hidden'}">
      <!-- Summary Header -->
      <div class="card" style="border-left: 3px solid var(--rsdh-accent);">
        <div
          style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;"
        >
          <span style="font-size: 18px;">📉</span>
          <span
            style="font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;"
            >TELEMETRY SUMMARY</span
          >
        </div>
        {#if lastPayloadRaw}
          {@const payload = (() => {
            try {
              return JSON.parse(lastPayloadRaw);
            } catch {
              return null;
            }
          })()}
          {#if payload}
            <div
              style="display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; color: rgba(255,255,255,0.7);"
            >
              <span><strong>{payload.sport || "Unknown"}</strong></span>
              {#if payload.draft_type}
                <span
                  style="color: {payload.draft_type === 'game'
                    ? '#f59e0b'
                    : 'inherit'};"
                >
                  {payload.draft_type === "game"
                    ? "🎯 Game Draft"
                    : "🏆 League Draft"}
                </span>
              {/if}
              <span
                >👥 {payload.player_pool_count ||
                  payload.player_pool?.length ||
                  "?"} players</span
              >
              {#if payload.game_matchup}
                <span
                  >⚔️ {payload.game_matchup.team1} vs {payload.game_matchup
                    .team2}</span
                >
              {:else if payload.games?.length}
                <span>🏒 {payload.games.length} games</span>
              {/if}
              {#if typeof payload.game_entries_remaining === "number"}
                <span style="color: rgba(255,255,255,0.5);"
                  >{payload.game_entries_remaining} entries left</span
                >
              {/if}
            </div>
            <div
              style="font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 6px;"
            >
              Captured: {payload.captured_at
                ? new Date(payload.captured_at).toLocaleTimeString()
                : "Unknown"}
            </div>
          {:else}
            <div class="sub">Unable to parse payload</div>
          {/if}
        {:else}
          <div class="sub">
            No capture yet. Open a draft modal and click Capture.
          </div>
        {/if}
      </div>

      <!-- Timeline Steps -->
      <div class="card">
        <div class="h" style="margin-bottom: 12px;">🕐 Request Timeline</div>

        <!-- Step 1: Capture -->
        <details class="timeline-step" open>
          <summary class="timeline-summary">
            <span class="timeline-icon {outputRaw ? 'success' : ''}">
              {outputRaw ? "✓" : "○"}
            </span>
            <span class="timeline-title">1. Capture</span>
            <span class="timeline-status">
              {#if outputRaw}
                {@const p = (() => {
                  try {
                    return JSON.parse(outputRaw);
                  } catch {
                    return null;
                  }
                })()}
                {p?.player_pool_count || p?.player_pool?.length || "?"} players,
                {p?.slots?.length || "?"} slots
              {:else}
                Pending
              {/if}
            </span>
          </summary>
          <div class="timeline-content">
            {#if outputRaw}
              {@const p = (() => {
                try {
                  return JSON.parse(outputRaw);
                } catch {
                  return null;
                }
              })()}
              {#if p}
                <div
                  style="font-size: 12px; color: rgba(255,255,255,0.75); line-height: 1.6;"
                >
                  <!-- Basic Info -->
                  <div style="margin-bottom: 10px;">
                    <strong>Sport:</strong>
                    {p.sport || "Unknown"} ({p.sport_detection_method ||
                      "unknown"}) &nbsp;|&nbsp; <strong>Mode:</strong>
                    {p.mode || "unknown"}
                    {#if p.draft_type}
                      &nbsp;|&nbsp; <strong>Draft:</strong>
                      <span
                        style="color: {p.draft_type === 'game'
                          ? '#f59e0b'
                          : 'inherit'};"
                      >
                        {p.draft_type === "game" ? "🎯 Game" : "🏆 League"}
                      </span>
                    {/if}
                    {#if typeof p.game_entries_remaining === "number"}
                      &nbsp;|&nbsp; <span style="color: rgba(255,255,255,0.6);">
                        {p.game_entries_remaining} entries left
                      </span>
                    {/if}
                  </div>

                  <!-- Slots -->
                  <div style="margin-bottom: 10px;">
                    <strong>Slots ({p.slots?.length || 0}):</strong>
                    {#if p.slots?.length}
                      <div style="margin-left: 12px; margin-top: 4px;">
                        {#each p.slots as slot, i}
                          <div style="padding: 2px 0; font-size: 11px;">
                            {i + 1}.
                            <span style="color: var(--rsdh-accent-light);"
                              >{slot.multiplier}x</span
                            >
                            {#if slot.selection}
                              — <span style="color: #22c55e;"
                                >{slot.selection}</span
                              >
                            {:else}
                              — <span style="color: rgba(255,255,255,0.4);"
                                >Empty</span
                              >
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <span class="sub"> None detected</span>
                    {/if}
                  </div>

                  <!-- Player Pool Sample -->
                  <div style="margin-bottom: 10px;">
                    <strong
                      >Player Pool ({p.player_pool?.length ||
                        p.player_pool_count ||
                        0}):</strong
                    >
                    {#if p.player_pool?.length}
                      <div
                        style="margin-left: 12px; margin-top: 4px; max-height: 120px; overflow-y: auto;"
                      >
                        {#each p.player_pool.slice(0, 15) as player}
                          <div
                            style="padding: 2px 0; font-size: 11px; display: flex; gap: 8px;"
                          >
                            <span style="min-width: 140px;">{player.name}</span>
                            <span
                              style="color: var(--rsdh-accent-light); min-width: 50px;"
                              >+{player.boost_x ?? 0}x</span
                            >
                            {#if player.status && player.status !== "Active"}
                              <span
                                style="color: {player.status === 'Out'
                                  ? '#ef4444'
                                  : '#f59e0b'}; font-size: 10px;"
                              >
                                {player.status}
                              </span>
                            {/if}
                          </div>
                        {/each}
                        {#if p.player_pool.length > 15}
                          <div class="sub" style="margin-top: 4px;">
                            ...and {p.player_pool.length - 15} more
                          </div>
                        {/if}
                      </div>
                    {:else}
                      <span class="sub"> None detected</span>
                    {/if}
                  </div>

                  <!-- Game Matchup (for game drafts) -->
                  {#if p.game_matchup}
                    <div style="margin-bottom: 10px;">
                      <strong>🎯 Game Matchup:</strong>
                      <div
                        style="margin-left: 12px; margin-top: 4px; font-size: 11px;"
                      >
                        <div
                          style="display: flex; gap: 8px; align-items: center;"
                        >
                          <span>{p.game_matchup.team1}</span>
                          {#if p.game_matchup.team1_record}
                            <span style="color: rgba(255,255,255,0.5);"
                              >({p.game_matchup.team1_record})</span
                            >
                          {/if}
                          {#if p.game_matchup.team1_score !== null && p.game_matchup.team1_score !== undefined}
                            <span style="color: #22c55e; font-weight: 600;"
                              >{p.game_matchup.team1_score}</span
                            >
                          {/if}
                          <span style="color: rgba(255,255,255,0.4);">vs</span>
                          <span>{p.game_matchup.team2}</span>
                          {#if p.game_matchup.team2_record}
                            <span style="color: rgba(255,255,255,0.5);"
                              >({p.game_matchup.team2_record})</span
                            >
                          {/if}
                          {#if p.game_matchup.team2_score !== null && p.game_matchup.team2_score !== undefined}
                            <span style="color: #22c55e; font-weight: 600;"
                              >{p.game_matchup.team2_score}</span
                            >
                          {/if}
                        </div>
                        <div
                          style="margin-top: 4px; color: rgba(255,255,255,0.5);"
                        >
                          {#if p.game_matchup.time}
                            @ {p.game_matchup.time}
                          {/if}
                          {#if p.game_matchup.spread}
                            &nbsp;• {p.game_matchup.spread}
                          {/if}
                          {#if p.game_matchup.status !== "upcoming"}
                            &nbsp;• {p.game_matchup.status === "finished"
                              ? "Final"
                              : "Live"}
                          {/if}
                        </div>
                      </div>
                    </div>
                  {/if}

                  <!-- Games (for league drafts) -->
                  {#if p.games?.length}
                    <div>
                      <strong>Games ({p.games.length}):</strong>
                      <div style="margin-left: 12px; margin-top: 4px;">
                        {#each p.games.slice(0, 6) as g}
                          <div style="padding: 2px 0; font-size: 11px;">
                            {g.team1} vs {g.team2}
                            {#if g.time}
                              <span style="color: rgba(255,255,255,0.5);"
                                >@ {g.time}</span
                              >
                            {:else if g.status === "finished"}
                              <span style="color: rgba(255,255,255,0.5);"
                                >(Final{g.score ? `: ${g.score}` : ""})</span
                              >
                            {/if}
                          </div>
                        {/each}
                        {#if p.games.length > 6}
                          <div class="sub">
                            ...and {p.games.length - 6} more
                          </div>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            {:else}
              <div class="sub">No data captured yet</div>
            {/if}
          </div>
        </details>

        <!-- Step 2: Prompt -->
        <details class="timeline-step">
          <summary class="timeline-summary">
            <span class="timeline-icon {lastStructuredPrompt ? 'success' : ''}">
              {lastStructuredPrompt ? "✓" : "○"}
            </span>
            <span class="timeline-title">2. Prompt Built</span>
            <span class="timeline-status">
              {lastStructuredPrompt
                ? `${lastStructuredPrompt.length} chars`
                : "Pending"}
            </span>
          </summary>
          <div class="timeline-content">
            <div
              style="font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 8px;"
            >
              Two prompts are generated: <strong>Chat</strong> (for copy/paste
              to chatbots) and <strong>Structured</strong> (for OpenRouter with tool
              hints).
            </div>

            <!-- Chat Prompt -->
            <details class="details" style="margin-bottom: 8px;">
              <summary style="font-size: 11px;"
                >📝 Chat Prompt (for copy/paste)</summary
              >
              {#if lastChatPrompt}
                <textarea
                  readonly
                  value={lastChatPrompt}
                  style="min-height: 100px; font-size: 10px; margin-top: 6px;"
                ></textarea>
                <button
                  class="secondary"
                  style="margin-top:4px; font-size:10px; padding:4px 8px;"
                  on:click={() => copyText(lastChatPrompt)}>📋 Copy Chat</button
                >
              {:else}
                <div class="sub" style="margin-top: 6px;">
                  Capture a draft modal to generate
                </div>
              {/if}
            </details>

            <!-- Structured Prompt -->
            <details class="details" open>
              <summary style="font-size: 11px;"
                >🔧 Structured Prompt (for OpenRouter/API)</summary
              >
              {#if lastStructuredPrompt}
                <textarea
                  readonly
                  value={lastStructuredPrompt}
                  style="min-height: 100px; font-size: 10px; margin-top: 6px;"
                ></textarea>
                <button
                  class="secondary"
                  style="margin-top:4px; font-size:10px; padding:4px 8px;"
                  on:click={() => copyText(lastStructuredPrompt)}
                  >📋 Copy Structured</button
                >
              {:else}
                <div class="sub" style="margin-top: 6px;">
                  Use Ask AI to generate
                </div>
              {/if}
            </details>
          </div>
        </details>

        <!-- Step 3: Tools Called -->
        <details class="timeline-step">
          <summary class="timeline-summary">
            <span
              class="timeline-icon {lastToolTrace &&
              lastToolTrace.includes('tool_call')
                ? 'success'
                : ''}"
            >
              {lastToolTrace && lastToolTrace.includes("tool_call") ? "✓" : "○"}
            </span>
            <span class="timeline-title">3. Tool Calls</span>
            <span class="timeline-status">
              {#if lastToolTrace && lastToolTrace.includes("tool_call")}
                {@const toolCount = (lastToolTrace.match(/tool_call/g) || [])
                  .length}
                {toolCount} call{toolCount !== 1 ? "s" : ""}
              {:else}
                None
              {/if}
            </span>
          </summary>
          <div class="timeline-content">
            {#if lastToolTrace && lastToolTrace.includes("tool_call")}
              {@const toolCalls = (() => {
                // Parse tool trace - look for tool_call entries
                const calls = [];
                try {
                  // Try to parse as JSON array first
                  const parsed = JSON.parse(lastToolTrace);
                  if (Array.isArray(parsed)) {
                    for (const item of parsed) {
                      if (item.kind === "tool_call") {
                        calls.push({
                          name: item.name || "Unknown",
                          args: item.args || item.arguments || {},
                          result: item.result || null,
                        });
                      }
                    }
                  }
                } catch {
                  // Fallback: parse line-by-line if not valid JSON
                  const lines = lastToolTrace.split("\n");
                  for (const line of lines) {
                    if (
                      line.includes('"kind": "tool_call"') ||
                      line.includes('"name":')
                    ) {
                      try {
                        const obj = JSON.parse(line);
                        if (obj.name) {
                          calls.push({
                            name: obj.name,
                            args: obj.args || obj.arguments || {},
                            result: obj.result,
                          });
                        }
                      } catch {
                        /* skip */
                      }
                    }
                  }
                }
                return calls;
              })()}
              <div style="display: flex; flex-direction: column; gap: 8px;">
                {#each toolCalls as tc, i}
                  <div
                    style="background: rgba(255,255,255,0.04); border-radius: 8px; padding: 10px; border-left: 3px solid var(--rsdh-accent);"
                  >
                    <div
                      style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;"
                    >
                      <span
                        style="font-weight: 600; font-size: 12px; color: var(--rsdh-accent-light);"
                      >
                        {tc.name === "search_draft_players" ? "🔍" : "👤"}
                        {tc.name}
                      </span>
                    </div>
                    <div style="font-size: 11px; color: rgba(255,255,255,0.7);">
                      {#if tc.name === "search_draft_players"}
                        Query: <strong>"{tc.args?.query || "N/A"}"</strong>
                        {#if tc.result}
                          <br />Found:
                          <span style="color: #22c55e;"
                            >{tc.result?.players_found ??
                              tc.result?.length ??
                              "?"} players</span
                          >
                        {/if}
                      {:else if tc.name === "get_player_profile_stats"}
                        Player: <strong>{tc.args?.player_name || "N/A"}</strong>
                        {#if tc.result?.header}
                          <br />Team: {tc.result.header.team || "N/A"} | Pos: {tc
                            .result.header.position || "N/A"}
                        {/if}
                      {:else}
                        Args: {JSON.stringify(tc.args).slice(0, 100)}
                      {/if}
                    </div>
                  </div>
                {/each}
                {#if toolCalls.length === 0}
                  <div class="sub">
                    Tool calls detected but couldn't parse details. Check Raw
                    Data.
                  </div>
                {/if}
              </div>
            {:else}
              <div class="sub">No tools were called</div>
            {/if}
          </div>
        </details>

        <!-- Step 4: Response -->
        <details class="timeline-step">
          <summary class="timeline-summary">
            <span class="timeline-icon {lastAiJson ? 'success' : ''}">
              {lastAiJson ? "✓" : "○"}
            </span>
            <span class="timeline-title">4. AI Response</span>
            <span class="timeline-status">
              {#if lastAiJson}
                {@const resp = (() => {
                  try {
                    return JSON.parse(lastAiJson);
                  } catch {
                    return null;
                  }
                })()}
                {resp?.lineup?.length || "?"} players, {resp?.bets?.length ||
                  "?"} bets
              {:else}
                Pending
              {/if}
            </span>
          </summary>
          <div class="timeline-content">
            {#if lastAiJson}
              {@const resp = (() => {
                try {
                  return JSON.parse(lastAiJson);
                } catch {
                  return null;
                }
              })()}
              {#if resp}
                <div
                  style="font-size: 12px; color: rgba(255,255,255,0.75); line-height: 1.6;"
                >
                  <!-- Lineup -->
                  <div style="margin-bottom: 12px;">
                    <strong>Lineup ({resp.lineup?.length || 0} players):</strong
                    >
                    {#if resp.lineup?.length}
                      <div style="margin-left: 12px; margin-top: 4px;">
                        {#each resp.lineup as pick, i}
                          <div
                            style="padding: 3px 0; font-size: 11px; display: flex; gap: 8px; align-items: baseline;"
                          >
                            <span
                              style="color: var(--rsdh-accent-light); min-width: 20px;"
                              >S{pick.slot_index ?? i + 1}</span
                            >
                            <span style="min-width: 140px; font-weight: 500;"
                              >{pick.player || "N/A"}</span
                            >
                            <span
                              style="color: rgba(255,255,255,0.5); font-size: 10px;"
                            >
                              {pick.slot_multiplier ?? "?"}x slot + {pick.player_boost_x ??
                                0}x boost =
                              <span style="color: #22c55e;"
                                >{pick.effective_multiplier ?? "?"}x</span
                              >
                            </span>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <span class="sub"> None</span>
                    {/if}
                  </div>

                  <!-- Bets -->
                  <div>
                    <strong>Bet Recommendations:</strong>
                    {#if resp.bets?.length}
                      <div style="margin-left: 12px; margin-top: 4px;">
                        {#each resp.bets as bet}
                          <div
                            style="padding: 4px 0; font-size: 11px; display: flex; gap: 8px; align-items: baseline;"
                          >
                            <span style="min-width: 70px; font-weight: 500;"
                              >{bet.tier || "N/A"}</span
                            >
                            <span
                              style="font-weight: 600; color: {bet.recommend
                                ? '#22c55e'
                                : '#ef4444'}; min-width: 30px;"
                            >
                              {bet.recommend ? "YES" : "NO"}
                            </span>
                            <span
                              style="color: rgba(255,255,255,0.5); font-size: 10px; flex: 1;"
                            >
                              {bet.reason?.slice(0, 60) || ""}{bet.reason
                                ?.length > 60
                                ? "..."
                                : ""}
                            </span>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <span class="sub"> None</span>
                    {/if}
                  </div>
                </div>
              {/if}
            {:else}
              <div class="sub">No response yet</div>
            {/if}
          </div>
        </details>

        <!-- Web Sources (if any) -->
        {#if lastSources}
          <details class="timeline-step">
            <summary class="timeline-summary">
              <span class="timeline-icon success">✓</span>
              <span class="timeline-title">Web Search</span>
              <span class="timeline-status">
                {lastSources.split("\n").filter((l) => l.trim()).length} sources
              </span>
            </summary>
            <div class="timeline-content">
              <div style="font-size: 11px; color: rgba(255,255,255,0.6);">
                {#each lastSources
                  .split("\n")
                  .filter((l) => l.trim())
                  .slice(0, 5) as src}
                  <div style="padding: 2px 0;">
                    🔗 {src.slice(0, 60)}{src.length > 60 ? "..." : ""}
                  </div>
                {/each}
              </div>
            </div>
          </details>
        {/if}
      </div>

      <!-- Raw Data (Collapsed) -->
      <div class="card">
        <details class="details">
          <summary style="font-size: 13px; font-weight: 600;"
            >📁 Raw Data</summary
          >
          <div style="margin-top: 12px;">
            <details class="details" style="margin-bottom: 8px;">
              <summary style="font-size: 12px;">Capture JSON</summary>
              <textarea
                readonly
                value={outputRaw || "(No capture data)"}
                style="min-height: 100px;"
              ></textarea>
              <button
                class="secondary"
                style="margin-top:4px; font-size:10px; padding:4px 8px;"
                on:click={() => copyText(outputRaw)}>📋 Copy</button
              >
            </details>
            <details class="details" style="margin-bottom: 8px;">
              <summary style="font-size: 12px;">Tool Trace</summary>
              <textarea
                readonly
                value={lastToolTrace || "(No tool calls)"}
                style="min-height: 100px;"
              ></textarea>
              <button
                class="secondary"
                style="margin-top:4px; font-size:10px; padding:4px 8px;"
                on:click={() => copyText(lastToolTrace)}>📋 Copy</button
              >
            </details>
            <details class="details" style="margin-bottom: 8px;">
              <summary style="font-size: 12px;">AI Response JSON</summary>
              <textarea
                readonly
                value={lastAiJson || "(No AI response)"}
                style="min-height: 100px;"
              ></textarea>
              <button
                class="secondary"
                style="margin-top:4px; font-size:10px; padding:4px 8px;"
                on:click={() => copyText(lastAiJson)}>📋 Copy</button
              >
            </details>
            <details class="details">
              <summary style="font-size: 12px;">Prompts</summary>
              <div class="sub" style="margin: 6px 0 4px;">Chat Prompt:</div>
              <textarea
                readonly
                value={lastChatPrompt || "(No chat prompt)"}
                style="min-height: 60px;"
              ></textarea>
              <div class="sub" style="margin: 8px 0 4px;">
                Structured Prompt:
              </div>
              <textarea
                readonly
                value={lastStructuredPrompt || "(No structured prompt)"}
                style="min-height: 60px;"
              ></textarea>
            </details>
          </div>
        </details>
      </div>
    </div>
  {/if}
</div>
