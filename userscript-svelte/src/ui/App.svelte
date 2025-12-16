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
    USE_PROXY,
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
  let forceToolCall = false;
  let forceSearchTool = false; // Debug: force AI to call search tool
  let bypassProxy = false; // Debug mode: bypass proxy and use direct API
  let enableProfileTool = true; // Enable AI to look up player profiles
  let enableWebSearch = true; // Enable AI to search the web
  let enableSearchTool = true; // Enable AI to search draft players

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
    forceToolCall =
      String(gmGet(FORCE_TOOL_CALL_KEY, "0" as any)) === "1" ||
      gmGet(FORCE_TOOL_CALL_KEY, "0" as any) === true;
    forceSearchTool =
      String(gmGet(FORCE_SEARCH_TOOL_KEY, "0" as any)) === "1" ||
      gmGet(FORCE_SEARCH_TOOL_KEY, "0" as any) === true;
    bypassProxy =
      String(gmGet(BYPASS_PROXY_KEY, "0" as any)) === "1" ||
      gmGet(BYPASS_PROXY_KEY, "0" as any) === true;
    enableProfileTool = gmGet(ENABLE_PROFILE_TOOL_KEY, "1" as any) !== "0";
    enableWebSearch = gmGet(ENABLE_WEB_SEARCH_KEY, "1" as any) !== "0";
    enableSearchTool = gmGet(ENABLE_SEARCH_TOOL_KEY, "1" as any) !== "0";

    // Load linked user identity
    linkedUser = getUserIdentity();

    // Fetch fresh models in background (updates cache)
    fetchOpenRouterModels().then((models) => {
      availableModels = models;
    });

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
    gmSet(FORCE_TOOL_CALL_KEY, forceToolCall ? "1" : "0");
    gmSet(FORCE_SEARCH_TOOL_KEY, forceSearchTool ? "1" : "0");
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
  <div class="header">
    <div class="title">
      <span style="margin-right: 6px;">✦</span>
      Draft Helper
    </div>
    <button class="secondary" on:click={() => setUiState({ hidden: true })}>
      <span style="font-size: 14px;">✕</span>
    </button>
  </div>

  <!-- Tab bar: 3 tabs normally, 4 when debug mode is on -->
  <div
    class="tabs"
    style="grid-template-columns: {debugMode
      ? '1fr 1fr 1fr 1fr'
      : '1fr 1fr 1fr'};"
  >
    <button
      class="tab secondary {tab === 'context' ? 'active' : ''}"
      on:click={() => setTab("context")}>Context</button
    >
    <button
      class="tab secondary {tab === 'results' ? 'active' : ''}"
      on:click={() => setTab("results")}>Results</button
    >
    <button
      class="tab secondary {tab === 'settings' ? 'active' : ''}"
      on:click={() => setTab("settings")}>Settings</button
    >
    {#if debugMode}
      <button
        class="tab secondary {tab === 'debug' ? 'active' : ''}"
        on:click={() => setTab("debug")}
        style="background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.3);"
      >
        🐛 Debug
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
        <div class="empty-icon">📋</div>
        <h3 class="empty-title">No Data Captured</h3>
        <p class="empty-description">
          Open a draft modal on the site, then use the Capture button to collect
          player and contest data.
        </p>
        <div class="empty-hint">💡 Look for "Draft" or "Update" buttons</div>
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
        <div class="empty-icon">✨</div>
        <h3 class="empty-title">No AI Results Yet</h3>
        <p class="empty-description">
          Capture a draft modal first, then use "Ask AI" from the modal to get
          lineup recommendations.
        </p>
        <div class="empty-hint">
          🚀 AI will analyze your roster and suggest optimal picks
        </div>
      </div>
    {/if}
  </div>

  <!-- Settings Tab -->
  <div class="view {tab === 'settings' ? '' : 'hidden'}">
    <!-- Account Linking Card -->
    <div class="card">
      <div class="h">
        <span style="opacity: 0.6; margin-right: 6px;">👤</span>Account
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
        <span style="opacity: 0.6; margin-right: 6px;">🔑</span>OpenRouter API
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
      <label class="sub" for="or-model">Model</label>
      <input
        id="or-model"
        style="width:100%; margin-bottom:8px;"
        type="text"
        bind:value={model}
        list="model-list"
        placeholder="Start typing to search..."
      />
      <datalist id="model-list">
        {#each availableModels as m}
          <option value={m}>{m}</option>
        {/each}
      </datalist>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div>
          <label class="sub" for="or-temp">Temperature: {temperature}</label>
          <input
            id="or-temp"
            style="width:100%;"
            type="range"
            min="0"
            max="2"
            step="0.1"
            bind:value={temperature}
          />
        </div>
        <div>
          <label class="sub" for="or-max">Max tokens</label>
          <input
            id="or-max"
            style="width:100%;"
            type="text"
            bind:value={maxTokens}
          />
        </div>
      </div>
      <label
        style="display:flex; align-items:center; gap:10px; font-size:12px; color: rgba(255,255,255,0.90); user-select:none; cursor:pointer; margin-top: 12px;"
      >
        <input type="checkbox" bind:checked={enableWebSearch} />
        <span
          ><strong>Web Search</strong><br /><span class="sub"
            >Search the web for current player news and updates</span
          ></span
        >
      </label>
      {#if enableWebSearch}
        <div style="margin-top:8px; margin-left: 28px;">
          <label class="sub" for="or-web">Max results: {webMaxResults}</label>
          <input
            id="or-web"
            style="width:100%;"
            type="range"
            min="1"
            max="5"
            step="1"
            bind:value={webMaxResults}
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
      <!-- Quick Status Overview -->
      <div class="card" style="border-left: 3px solid rgba(245, 158, 11, 0.6);">
        <div class="h">📊 Last Request Summary</div>
        <div
          style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;"
        >
          <!-- Capture Status -->
          <div
            style="padding: 10px; background: rgba(255,255,255,0.04); border-radius: 8px;"
          >
            <div
              style="font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 4px;"
            >
              📋 Capture
            </div>
            <div
              style="font-size: 13px; color: {outputRaw
                ? 'rgba(34,197,94,0.9)'
                : 'rgba(255,255,255,0.4)'};"
            >
              {#if outputRaw}
                ✓ Data captured
              {:else}
                — No capture yet
              {/if}
            </div>
          </div>
          <!-- Web Search Status -->
          <div
            style="padding: 10px; background: rgba(255,255,255,0.04); border-radius: 8px;"
          >
            <div
              style="font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 4px;"
            >
              🌐 Web Search
            </div>
            <div
              style="font-size: 13px; color: {lastSources
                ? 'rgba(34,197,94,0.9)'
                : 'rgba(255,255,255,0.4)'};"
            >
              {#if lastSources}
                ✓ {lastSources.split("\n").filter((l) => l.trim()).length} sources
                found
              {:else}
                — Not used
              {/if}
            </div>
          </div>
          <!-- Tool Calls Status -->
          <div
            style="padding: 10px; background: rgba(255,255,255,0.04); border-radius: 8px;"
          >
            <div
              style="font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 4px;"
            >
              🔗 Tool Calls
            </div>
            <div
              style="font-size: 13px; color: {lastToolTrace &&
              lastToolTrace.includes('tool_call')
                ? 'rgba(34,197,94,0.9)'
                : 'rgba(255,255,255,0.4)'};"
            >
              {#if lastToolTrace && lastToolTrace.includes("tool_call")}
                ✓ Profile lookup used
              {:else}
                — No tools called
              {/if}
            </div>
          </div>
          <!-- AI Response Status -->
          <div
            style="padding: 10px; background: rgba(255,255,255,0.04); border-radius: 8px;"
          >
            <div
              style="font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 4px;"
            >
              🤖 AI Response
            </div>
            <div
              style="font-size: 13px; color: {lastAiJson
                ? 'rgba(34,197,94,0.9)'
                : 'rgba(255,255,255,0.4)'};"
            >
              {#if lastAiJson}
                ✓ Response received
              {:else}
                — No response yet
              {/if}
            </div>
          </div>
        </div>
      </div>

      <!-- Dev Options -->
      <div class="card" style="background: rgba(255,255,255,0.04);">
        <label
          style="display:flex; align-items:center; gap:10px; font-size:12px; color: rgba(255,255,255,0.90); user-select:none; cursor:pointer;"
        >
          <input type="checkbox" bind:checked={forceToolCall} />
          <span
            ><strong>Force Profile Tool (test)</strong><br /><span class="sub"
              >Makes AI call <code>get_player_profile_stats</code> once to verify
              tool tracing.</span
            ></span
          >
        </label>
        <label
          style="display:flex; align-items:center; gap:10px; font-size:12px; color: rgba(255,255,255,0.90); user-select:none; cursor:pointer; margin-top: 10px;"
        >
          <input type="checkbox" bind:checked={forceSearchTool} />
          <span
            ><strong>Force Search Tool (test)</strong><br /><span class="sub"
              >Makes AI call <code>search_draft_players</code> once to verify tool
              tracing.</span
            ></span
          >
        </label>
      </div>

      <!-- Raw Data Card -->
      <div class="card">
        <div class="h" style="margin-bottom: 12px;">📁 Raw Data</div>

        <details class="details">
          <summary>📄 Raw Capture Data</summary>
          <textarea
            bind:value={outputRaw}
            placeholder="Raw JSON / text..."
            on:input={renderFromRaw}
          ></textarea>
          <button
            class="secondary"
            style="margin-top:6px; width:auto; padding:6px 12px; font-size:11px;"
            on:click={() => copyText(outputRaw)}>📋 Copy</button
          >
        </details>

        <details class="details" style="margin-top:8px;">
          <summary>🌐 Web Sources</summary>
          <textarea readonly value={lastSources || "(No web sources)"}
          ></textarea>
          <button
            class="secondary"
            style="margin-top:6px; width:auto; padding:6px 12px; font-size:11px;"
            on:click={() => copyText(lastSources)}>📋 Copy</button
          >
        </details>

        <details class="details" style="margin-top:8px;">
          <summary>🔗 Tool Call Trace</summary>
          <textarea readonly value={lastToolTrace || "(No tool calls)"}
          ></textarea>
          <button
            class="secondary"
            style="margin-top:6px; width:auto; padding:6px 12px; font-size:11px;"
            on:click={() => copyText(lastToolTrace)}>📋 Copy</button
          >
        </details>

        <details class="details" style="margin-top:8px;">
          <summary>🤖 AI Response JSON</summary>
          <textarea
            readonly
            value={lastAiJson}
            placeholder="No AI response yet."
          ></textarea>
          <button
            class="secondary"
            style="margin-top:6px; width:auto; padding:6px 12px; font-size:11px;"
            on:click={() => copyText(lastAiJson)}>📋 Copy</button
          >
        </details>

        <details class="details" style="margin-top:8px;">
          <summary>📋 Prompts (Chat + Structured)</summary>
          <div class="sub" style="margin-bottom: 6px;">Chat Prompt:</div>
          <textarea
            readonly
            value={lastChatPrompt}
            placeholder="Capture a draft modal to see the prompt here."
            style="min-height: 80px;"
          ></textarea>
          <div class="sub" style="margin: 8px 0 6px 0;">Structured Prompt:</div>
          <textarea
            readonly
            value={lastStructuredPrompt}
            placeholder="Use Ask AI to see the structured prompt here."
            style="min-height: 80px;"
          ></textarea>
          <button
            class="secondary"
            style="margin-top:6px; width:auto; padding:6px 12px; font-size:11px;"
            on:click={() => copyText(lastStructuredPrompt)}
            >📋 Copy Structured</button
          >
        </details>
      </div>
    </div>
  {/if}
</div>
