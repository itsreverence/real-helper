/**
 * RSDH Proxy Worker
 * Proxies OpenRouter API calls with:
 * - Server-side API key injection
 * - User identity tracking (via X-RSDH-User header)
 * - Per-user rate limiting
 * - Admin dashboard
 */

interface Env {
    OPENROUTER_API_KEY: string;
    RSDH_SHARED_SECRET: string;
    ADMIN_SECRET: string;
    OPENROUTER_ENDPOINT: string;
    RATE_LIMIT_PER_HOUR: string;
    RSDH_KV: KVNamespace;
}

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-RSDH-Auth, X-RSDH-User, X-RSDH-DisplayName, X-Title, HTTP-Referer, Authorization",
};

// KV key prefixes
const KEY_PREFIX = {
    USER: "user:",           // user:{username} -> { displayName, firstSeen, lastSeen }
    USAGE: "usage:",         // usage:{username}:{YYYY-MM-DD} -> { requests, models: {} }
    RATE: "rate:",           // rate:{username}:{hour} -> count
    GLOBAL: "global:",       // global:stats -> { totalRequests, uniqueUsers }
};

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        // Route based on path
        if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
            return handleAdmin(request, env, url);
        }

        // Default: proxy endpoint
        return handleProxy(request, env);
    },
};

// ============================================================================
// PROXY HANDLER
// ============================================================================

async function handleProxy(request: Request, env: Env): Promise<Response> {
    // Only allow POST
    if (request.method !== "POST") {
        return jsonError("Method not allowed", 405);
    }

    // Validate auth header
    const authHeader = request.headers.get("X-RSDH-Auth");
    if (!authHeader || authHeader !== env.RSDH_SHARED_SECRET) {
        return jsonError("Unauthorized", 401);
    }

    // Validate secrets are configured
    if (!env.OPENROUTER_API_KEY) {
        return jsonError("Server misconfigured: missing API key", 500);
    }

    // Get user identity (optional but tracked)
    const username = request.headers.get("X-RSDH-User") || "anonymous";
    const displayName = request.headers.get("X-RSDH-DisplayName") || undefined;

    // Check rate limit
    const rateLimit = parseInt(env.RATE_LIMIT_PER_HOUR || "50", 10);
    const rateLimited = await checkRateLimit(env, username, rateLimit);
    if (rateLimited) {
        return jsonError(`Rate limit exceeded (${rateLimit}/hour). Try again later.`, 429);
    }

    try {
        // Parse the incoming request body
        const body = await request.json() as { model?: string };
        const model = body.model || "unknown";

        // Log usage (non-blocking)
        logUsage(env, username, displayName, model).catch(() => { });

        // Forward to OpenRouter with our API key
        const openRouterResponse = await fetch(env.OPENROUTER_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
                "HTTP-Referer": request.headers.get("HTTP-Referer") || "https://realsports.io/",
                "X-Title": request.headers.get("X-Title") || "RealSports Draft Helper",
            },
            body: JSON.stringify(body),
        });

        // Clone headers for response
        const responseHeaders = new Headers(CORS_HEADERS);
        responseHeaders.set("Content-Type", openRouterResponse.headers.get("Content-Type") || "application/json");

        return new Response(openRouterResponse.body, {
            status: openRouterResponse.status,
            headers: responseHeaders,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return jsonError(`Proxy error: ${message}`, 500);
    }
}

// ============================================================================
// RATE LIMITING
// ============================================================================

async function checkRateLimit(env: Env, username: string, limit: number): Promise<boolean> {
    const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const key = `${KEY_PREFIX.RATE}${username}:${hour}`;

    try {
        const current = parseInt(await env.RSDH_KV.get(key) || "0", 10);
        if (current >= limit) {
            return true; // Rate limited
        }

        // Increment counter (TTL 2 hours to auto-cleanup)
        await env.RSDH_KV.put(key, String(current + 1), { expirationTtl: 7200 });
        return false;
    } catch {
        // If KV fails, allow the request (fail open)
        return false;
    }
}

// ============================================================================
// USAGE LOGGING
// ============================================================================

async function logUsage(env: Env, username: string, displayName: string | undefined, model: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const now = new Date().toISOString();
    const TTL_30_DAYS = 60 * 60 * 24 * 30; // 30 days in seconds

    // Update user record
    const userKey = `${KEY_PREFIX.USER}${username}`;
    try {
        const existing = await env.RSDH_KV.get(userKey, "json") as { firstSeen?: string; lastSeen?: string; displayName?: string } | null;
        await env.RSDH_KV.put(userKey, JSON.stringify({
            firstSeen: existing?.firstSeen || now,
            lastSeen: now,
            displayName: displayName || existing?.displayName || undefined,
        }), { expirationTtl: TTL_30_DAYS });
    } catch { /* ignore */ }

    // Update daily usage
    const usageKey = `${KEY_PREFIX.USAGE}${username}:${today}`;
    try {
        const existing = await env.RSDH_KV.get(usageKey, "json") as { requests?: number; models?: Record<string, number> } | null;
        const requests = (existing?.requests || 0) + 1;
        const models = existing?.models || {};
        models[model] = (models[model] || 0) + 1;
        await env.RSDH_KV.put(usageKey, JSON.stringify({ requests, models }), { expirationTtl: 604800 }); // 7 days
    } catch { /* ignore */ }
}

// ============================================================================
// ADMIN HANDLER
// ============================================================================

async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
    // Check admin auth
    const authHeader = request.headers.get("Authorization");
    const providedSecret = authHeader?.replace("Bearer ", "") || url.searchParams.get("token");

    if (!env.ADMIN_SECRET || providedSecret !== env.ADMIN_SECRET) {
        return new Response("Unauthorized. Add ?token=YOUR_ADMIN_SECRET", {
            status: 401,
            headers: { "Content-Type": "text/plain", ...CORS_HEADERS },
        });
    }

    // Route admin endpoints
    if (url.pathname === "/admin/api/users") {
        return handleAdminUsers(env);
    }
    if (url.pathname === "/admin/api/stats") {
        return handleAdminStats(env);
    }

    // Default: admin dashboard HTML
    return handleAdminDashboard();
}

async function handleAdminUsers(env: Env): Promise<Response> {
    const users: Array<{ username: string; displayName?: string; firstSeen: string; lastSeen: string; todayRequests: number }> = [];
    const today = new Date().toISOString().slice(0, 10);

    try {
        // List all user keys
        const userList = await env.RSDH_KV.list({ prefix: KEY_PREFIX.USER });

        for (const key of userList.keys) {
            const username = key.name.replace(KEY_PREFIX.USER, "");
            const userData = await env.RSDH_KV.get(key.name, "json") as { firstSeen?: string; lastSeen?: string; displayName?: string } | null;
            const usageData = await env.RSDH_KV.get(`${KEY_PREFIX.USAGE}${username}:${today}`, "json") as { requests?: number } | null;

            users.push({
                username,
                displayName: userData?.displayName,
                firstSeen: userData?.firstSeen || "unknown",
                lastSeen: userData?.lastSeen || "unknown",
                todayRequests: usageData?.requests || 0,
            });
        }

        // Sort by last seen (most recent first)
        users.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    } catch { /* ignore */ }

    return new Response(JSON.stringify({ users }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
}

async function handleAdminStats(env: Env): Promise<Response> {
    const today = new Date().toISOString().slice(0, 10);
    let totalRequests = 0;
    const modelUsage: Record<string, number> = {};

    try {
        // Sum up today's usage
        const usageList = await env.RSDH_KV.list({ prefix: `${KEY_PREFIX.USAGE}` });

        for (const key of usageList.keys) {
            if (key.name.includes(today)) {
                const data = await env.RSDH_KV.get(key.name, "json") as { requests?: number; models?: Record<string, number> } | null;
                totalRequests += data?.requests || 0;
                if (data?.models) {
                    for (const [model, count] of Object.entries(data.models)) {
                        modelUsage[model] = (modelUsage[model] || 0) + count;
                    }
                }
            }
        }
    } catch { /* ignore */ }

    return new Response(JSON.stringify({ today, totalRequests, modelUsage }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
}

function handleAdminDashboard(): Response {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RSDH Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
    h1 { margin-bottom: 20px; color: #58a6ff; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .card h2 { font-size: 14px; color: #8b949e; margin-bottom: 12px; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; font-weight: 500; }
    .stat { font-size: 32px; font-weight: bold; color: #58a6ff; }
    .refresh { background: #238636; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
    .refresh:hover { background: #2ea043; }
    .loading { color: #8b949e; }
  </style>
</head>
<body>
  <h1>✦ RSDH Admin Dashboard</h1>
  
  <div class="card">
    <h2>Today's Stats</h2>
    <div id="stats" class="loading">Loading...</div>
  </div>
  
  <div class="card">
    <h2>Users</h2>
    <button class="refresh" onclick="loadData()">↻ Refresh</button>
    <div id="users" class="loading" style="margin-top: 12px;">Loading...</div>
  </div>

  <script>
    const token = new URLSearchParams(location.search).get('token');
    
    async function loadData() {
      // Load stats
      try {
        const stats = await fetch('/admin/api/stats?token=' + token).then(r => r.json());
        document.getElementById('stats').innerHTML = \`
          <span class="stat">\${stats.totalRequests}</span> requests today
          <div style="margin-top: 8px; color: #8b949e;">
            Models: \${Object.entries(stats.modelUsage || {}).map(([m, c]) => \`\${m}: \${c}\`).join(', ') || 'none'}
          </div>
        \`;
      } catch { document.getElementById('stats').textContent = 'Error loading stats'; }

      // Load users
      try {
        const data = await fetch('/admin/api/users?token=' + token).then(r => r.json());
        if (!data.users?.length) {
          document.getElementById('users').innerHTML = 'No users yet';
          return;
        }
        document.getElementById('users').innerHTML = \`
          <table>
            <thead><tr><th>User</th><th>Today</th><th>Last Seen</th></tr></thead>
            <tbody>
              \${data.users.map(u => \`
                <tr>
                  <td>\${u.displayName || ''}<div style="color:#8b949e;font-size:12px;">@\${u.username}</div></td>
                  <td>\${u.todayRequests}</td>
                  <td>\${new Date(u.lastSeen).toLocaleString()}</td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        \`;
      } catch { document.getElementById('users').textContent = 'Error loading users'; }
    }

    loadData();
  </script>
</body>
</html>`;

    return new Response(html, {
        headers: { "Content-Type": "text/html", ...CORS_HEADERS },
    });
}

// ============================================================================
// UTILITIES
// ============================================================================

function jsonError(message: string, status: number): Response {
    return new Response(
        JSON.stringify({ error: { message } }),
        {
            status,
            headers: {
                "Content-Type": "application/json",
                ...CORS_HEADERS,
            },
        }
    );
}
