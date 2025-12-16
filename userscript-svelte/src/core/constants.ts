export const MODAL_ANCHORS = ["Select 5 players", "Press two player", "Press two players", "to swap"] as const;

export const MULT_TOKEN_RE = /(\d+(?:\.\d+)?)x\b/gi;
export const BOOST_LINE_RE = /^\+(\d+(?:\.\d+)?)x\b/i;

export const MAX_POOL_IN_PROMPT = 200;
export const SPORTS = ["NFL", "NHL", "NBA", "MLB", "CFB", "CBB", "UFC", "Golf", "FC", "WNBA"] as const;

export const ACCENT_CACHE_KEY = "rsdh_accent_rgb";
export const DEBUG_MODE_KEY = "rsdh_debug_mode";

// OpenRouter keys match the legacy userscript so settings carry over.
export const OR_KEY = "rsdh_openrouter_api_key";
export const OR_MODEL = "rsdh_openrouter_model";
export const OR_TEMP = "rsdh_openrouter_temp";
export const OR_MAXTOK = "rsdh_openrouter_max_tokens";
export const OR_WEB_MAX_RESULTS = "rsdh_openrouter_web_max_results";
export const OR_STRUCTURED = "rsdh_openrouter_structured_json";
export const OR_HEAL = "rsdh_openrouter_response_healing";

export const OR_DEFAULT_MODEL = "google/gemini-2.5-flash";
export const OR_DEFAULT_TEMP = 0.2;
export const OR_DEFAULT_MAXTOK = 1000;
export const OR_DEFAULT_WEB_MAX_RESULTS = 2;
export const OR_DEFAULT_STRUCTURED = true;
export const OR_DEFAULT_HEAL = true;

export const OR_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// Proxy mode configuration
// Values are injected at build time from .env file (see .env.example)
// When proxy mode is enabled, API key is server-side and not needed in userscript
export const PROXY_ENDPOINT = import.meta.env.VITE_PROXY_ENDPOINT || "";
export const PROXY_SECRET = import.meta.env.VITE_PROXY_SECRET || "";
export const USE_PROXY = Boolean(PROXY_ENDPOINT);

export const LAST_PAYLOAD_KEY = "rsdh_last_payload";
export const LAST_AI_SOURCES_KEY = "rsdh_last_ai_sources";
export const LAST_AI_JSON_KEY = "rsdh_last_ai_json";
export const LAST_TOOL_TRACE_KEY = "rsdh_last_tool_trace";
export const LAST_DEBUG_EVENTS_KEY = "rsdh_last_debug_events";
export const LAST_MESSAGES_KEY = "rsdh_last_messages";

// Debug/testing flags
export const FORCE_TOOL_CALL_KEY = "rsdh_force_tool_call";
export const FORCE_SEARCH_TOOL_KEY = "rsdh_force_search_tool";  // Debug: force AI to call search tool
export const BYPASS_PROXY_KEY = "rsdh_bypass_proxy";  // Debug mode: use direct API instead of proxy

// Feature flags
export const ENABLE_PROFILE_TOOL_KEY = "rsdh_enable_profile_tool";  // Enable AI to look up player profiles
export const ENABLE_WEB_SEARCH_KEY = "rsdh_enable_web_search";  // Enable AI to search the web
export const ENABLE_SEARCH_TOOL_KEY = "rsdh_enable_search_tool";  // Enable AI to search draft players



