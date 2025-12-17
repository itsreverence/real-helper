# TODO

## Near-term (keep tools local; improve reliability)
- **Harden profile URL discovery**
  - Improve detection of the player-row “profile” icon (SPA click target) across sports/pages.
  - Add local caching of `player_name -> profile_url` + `profile_url -> scraped_summary` (with TTL).
  - Add better failure reporting in the UI when a profile can’t be discovered/fetched.

- **Tool-calling compatibility**
  - Maintain OpenRouter request fallbacks when routing rejects certain parameter combinations.
  - Add a small “model capability check” UI hint (tools-compatible vs not) using OpenRouter model metadata.

## Mid-term (Cloudflare Worker: OpenRouter proxy + local tool relay)
- **Worker: OpenRouter proxy (hide user keys)**
  - Create Cloudflare Worker endpoint `POST /chat` that calls OpenRouter `chat/completions`.
  - Store `OPENROUTER_API_KEY` as a Worker secret (no keys in the userscript).
  - Add request auth: `RSDH_SHARED_SECRET` (header) and basic rate limiting.
  - Add structured logging (request ids, model, latency, errors) with privacy-safe redaction.

- **Worker + userscript: tool relay loop**
  - Worker runs the agent loop; when it receives `tool_calls`, it returns a “tool_request” payload to the userscript.
  - Userscript executes tools locally (logged-in session + SPA click-discovery + `GM_xmlhttpRequest`).
  - Userscript posts `tool_result` back to Worker; Worker continues until final answer.
  - Ensure strict JSON schema finalization remains deterministic.

## Long-term (admin panel + user management)
- **User identity + registration**
  - Generate a per-install anonymous client id (rotatable) stored locally.
  - Optional user login (email/password or OAuth) for “admin” / premium features.

- **Admin panel**
  - Dashboard: active installs, daily/weekly usage, model distribution, error rates, latency.
  - User list: installs, last seen, version, feature flags.
  - Audit log: key events (settings changes, failures, rate limit hits).

- **Telemetry (privacy-first)**
  - Opt-in telemetry toggle in UI (default off).
  - Send only aggregate metrics (counts/timing), never raw prompts/payloads by default.
  - Add a “debug upload” mode that requires explicit user action and shows exactly what will be sent.

- **Feature flags**
  - Remote config to enable/disable: tool relay, web plugin usage, profile scraping modes, model defaults.
  - Per-user overrides and staged rollouts.




