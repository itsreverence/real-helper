// Fetch and cache OpenRouter models

const MODELS_CACHE_KEY = "rsdh_openrouter_models_cache";
const MODELS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CachedModels {
    models: string[];
    timestamp: number;
}

// Fallback models if fetch fails
const FALLBACK_MODELS = [
    "google/gemini-2.5-flash",
    "google/gemini-2.5-pro",
    "google/gemini-2.0-flash-001",
    "anthropic/claude-sonnet-4",
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3.5-haiku",
    "openai/gpt-4o",
    "openai/gpt-4o-mini",
    "openai/gpt-4-turbo",
    "openai/o1",
    "openai/o1-mini",
    "meta-llama/llama-3.3-70b-instruct",
    "deepseek/deepseek-chat-v3-0324",
    "mistralai/mistral-large",
    "qwen/qwen-2.5-72b-instruct"
];

function loadCache(): CachedModels | null {
    try {
        const raw = localStorage.getItem(MODELS_CACHE_KEY);
        if (!raw) return null;
        const cached = JSON.parse(raw) as CachedModels;
        if (Date.now() - cached.timestamp > MODELS_CACHE_TTL) {
            return null; // Cache expired
        }
        return cached;
    } catch {
        return null;
    }
}

function saveCache(models: string[]) {
    try {
        const data: CachedModels = { models, timestamp: Date.now() };
        localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(data));
    } catch {
        // ignore
    }
}

export async function fetchOpenRouterModels(): Promise<string[]> {
    // Check cache first
    const cached = loadCache();
    if (cached && cached.models.length > 0) {
        return cached.models;
    }

    try {
        // Use GM_xmlhttpRequest if available, otherwise fallback
        if (typeof GM_xmlhttpRequest !== "function") {
            return FALLBACK_MODELS;
        }

        const response = await new Promise<any>((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: "https://openrouter.ai/api/v1/models",
                headers: { "Content-Type": "application/json" },
                timeout: 10000,
                onload: (res) => {
                    try {
                        const data = res?.responseText ? JSON.parse(res.responseText) : null;
                        resolve(data);
                    } catch {
                        reject(new Error("Failed to parse models response"));
                    }
                },
                onerror: () => reject(new Error("Network error")),
                ontimeout: () => reject(new Error("Request timed out"))
            });
        });

        if (response?.data && Array.isArray(response.data)) {
            // Filter and sort models - prefer popular providers
            const models = response.data
                .map((m: any) => m.id as string)
                .filter((id: string) => {
                    // Filter to models that support chat completions
                    return id && !id.includes(":free") && !id.includes(":extended");
                })
                .sort((a: string, b: string) => {
                    // Prioritize popular providers
                    const priority = ["google/", "anthropic/", "openai/", "meta-llama/", "deepseek/", "mistralai/"];
                    const aIdx = priority.findIndex(p => a.startsWith(p));
                    const bIdx = priority.findIndex(p => b.startsWith(p));
                    if (aIdx !== -1 && bIdx === -1) return -1;
                    if (bIdx !== -1 && aIdx === -1) return 1;
                    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
                    return a.localeCompare(b);
                });

            if (models.length > 0) {
                saveCache(models);
                return models;
            }
        }

        return FALLBACK_MODELS;
    } catch {
        return FALLBACK_MODELS;
    }
}

// Get cached models synchronously (for initial load)
export function getCachedModels(): string[] {
    const cached = loadCache();
    return cached?.models || FALLBACK_MODELS;
}
