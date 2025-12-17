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
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>RSDH Admin Dashboard</title>
    <script type="module" crossorigin>(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))r(s);new MutationObserver(s=>{for(const i of s)if(i.type==="childList")for(const a of i.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&r(a)}).observe(document,{childList:!0,subtree:!0});function n(s){const i={};return s.integrity&&(i.integrity=s.integrity),s.referrerPolicy&&(i.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?i.credentials="include":s.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function r(s){if(s.ep)return;s.ep=!0;const i=n(s);fetch(s.href,i)}})();const at=!1;var Pt=Array.isArray,Nn=Array.prototype.indexOf,et=Array.from,Cn=Object.defineProperty,Ie=Object.getOwnPropertyDescriptor,Dn=Object.prototype,Fn=Array.prototype,In=Object.getPrototypeOf,St=Object.isExtensible;function Mn(e){for(var t=0;t<e.length;t++)e[t]()}function Lt(){var e,t,n=new Promise((r,s)=>{e=r,t=s});return{promise:n,resolve:e,reject:t}}function Pn(e,t){if(Array.isArray(e))return e;if(!(Symbol.iterator in e))return Array.from(e);const n=[];for(const r of e)if(n.push(r),n.length===t)break;return n}const x=2,Ut=4,_t=8,Ln=1<<24,re=16,ie=32,we=64,tt=128,K=512,A=1024,M=2048,X=4096,q=8192,ae=16384,pt=32768,Se=65536,At=1<<17,qt=1<<18,Oe=1<<19,Un=1<<20,fe=1<<25,pe=32768,ot=1<<21,bt=1<<22,oe=1<<23,ft=Symbol("\$state"),ye=new class extends Error{name="StaleReactionError";message="The reaction that called \`getAbortSignal()\` was re-run or destroyed"};function qn(e){throw new Error("https://svelte.dev/e/lifecycle_outside_component")}function Vn(){throw new Error("https://svelte.dev/e/async_derived_orphan")}function jn(e){throw new Error("https://svelte.dev/e/effect_in_teardown")}function Hn(){throw new Error("https://svelte.dev/e/effect_in_unowned_derived")}function Yn(e){throw new Error("https://svelte.dev/e/effect_orphan")}function Bn(){throw new Error("https://svelte.dev/e/effect_update_depth_exceeded")}function zn(){throw new Error("https://svelte.dev/e/state_descriptors_fixed")}function Gn(){throw new Error("https://svelte.dev/e/state_prototype_fixed")}function Kn(){throw new Error("https://svelte.dev/e/state_unsafe_mutation")}function \$n(){throw new Error("https://svelte.dev/e/svelte_boundary_reset_onerror")}const Wn=1,Qn=2,Zn=16,Xn=1,Jn=2,S=Symbol();function er(){console.warn("https://svelte.dev/e/svelte_boundary_reset_noop")}function Vt(e){return e===this.v}function tr(e,t){return e!=e?t==t:e!==t||e!==null&&typeof e=="object"||typeof e=="function"}function jt(e){return!tr(e,this.v)}let nr=!1,V=null;function Ae(e){V=e}function Ht(e,t=!1,n){V={p:V,i:!1,c:null,e:null,s:e,x:null,l:null}}function Yt(e){var t=V,n=t.e;if(n!==null){t.e=null;for(var r of n)rn(r)}return t.i=!0,V=t.p,{}}function Bt(){return!0}let xe=[];function rr(){var e=xe;xe=[],Mn(e)}function gt(e){if(xe.length===0){var t=xe;queueMicrotask(()=>{t===xe&&rr()})}xe.push(e)}function zt(e){var t=b;if(t===null)return _.f|=oe,e;if((t.f&pt)===0){if((t.f&tt)===0)throw e;t.b.error(e)}else Re(e,t)}function Re(e,t){for(;t!==null;){if((t.f&tt)!==0)try{t.b.error(e);return}catch(n){e=n}t=t.parent}throw e}const Ge=new Set;let E=null,z=null,W=[],mt=null,ut=!1;class Q{committed=!1;current=new Map;previous=new Map;#e=new Set;#t=new Set;#r=0;#n=0;#a=null;#s=new Set;#i=new Set;skipped_effects=new Set;is_fork=!1;is_deferred(){return this.is_fork||this.#n>0}process(t){W=[],this.apply();var n={parent:null,effect:null,effects:[],render_effects:[]};for(const r of t)this.#l(r,n);this.is_fork||this.#u(),this.is_deferred()?(this.#f(n.effects),this.#f(n.render_effects)):(E=null,Rt(n.render_effects),Rt(n.effects),this.#a?.resolve()),z=null}#l(t,n){t.f^=A;for(var r=t.first;r!==null;){var s=r.f,i=(s&(ie|we))!==0,a=i&&(s&A)!==0,f=a||(s&q)!==0||this.skipped_effects.has(r);if((r.f&tt)!==0&&r.b?.is_pending()&&(n={parent:n,effect:r,effects:[],render_effects:[]}),!f&&r.fn!==null){i?r.f^=A:(s&Ut)!==0?n.effects.push(r):Ve(r)&&((r.f&re)!==0&&this.#s.add(r),Ue(r));var l=r.first;if(l!==null){r=l;continue}}var o=r.parent;for(r=r.next;r===null&&o!==null;)o===n.effect&&(this.#f(n.effects),this.#f(n.render_effects),n=n.parent),r=o.next,o=o.parent}}#f(t){for(const n of t)(n.f&M)!==0?this.#s.add(n):(n.f&X)!==0&&this.#i.add(n),this.#o(n.deps),R(n,A)}#o(t){if(t!==null)for(const n of t)(n.f&x)===0||(n.f&pe)===0||(n.f^=pe,this.#o(n.deps))}capture(t,n){this.previous.has(t)||this.previous.set(t,n),(t.f&oe)===0&&(this.current.set(t,t.v),z?.set(t,t.v))}activate(){E=this,this.apply()}deactivate(){E===this&&(E=null,z=null)}flush(){if(this.activate(),W.length>0){if(ir(),E!==null&&E!==this)return}else this.#r===0&&this.process([]);this.deactivate()}discard(){for(const t of this.#t)t(this);this.#t.clear()}#u(){if(this.#n===0){for(const t of this.#e)t();this.#e.clear()}this.#r===0&&this.#c()}#c(){if(Ge.size>1){this.previous.clear();var t=z,n=!0,r={parent:null,effect:null,effects:[],render_effects:[]};for(const i of Ge){if(i===this){n=!1;continue}const a=[];for(const[l,o]of this.current){if(i.current.has(l))if(n&&o!==i.current.get(l))i.current.set(l,o);else continue;a.push(l)}if(a.length===0)continue;const f=[...i.current.keys()].filter(l=>!this.current.has(l));if(f.length>0){var s=W;W=[];const l=new Set,o=new Map;for(const u of a)Gt(u,f,l,o);if(W.length>0){E=i,i.apply();for(const u of W)i.#l(u,r);i.deactivate()}W=s}}E=null,z=t}this.committed=!0,Ge.delete(this)}increment(t){this.#r+=1,t&&(this.#n+=1)}decrement(t){this.#r-=1,t&&(this.#n-=1),this.revive()}revive(){for(const t of this.#s)this.#i.delete(t),R(t,M),be(t);for(const t of this.#i)R(t,X),be(t);this.flush()}oncommit(t){this.#e.add(t)}ondiscard(t){this.#t.add(t)}settled(){return(this.#a??=Lt()).promise}static ensure(){if(E===null){const t=E=new Q;Ge.add(E),Q.enqueue(()=>{E===t&&t.flush()})}return E}static enqueue(t){gt(t)}apply(){}}function ir(){var e=he;ut=!0;var t=null;try{var n=0;for(Xe(!0);W.length>0;){var r=Q.ensure();if(n++>1e3){var s,i;sr()}r.process(W),ue.clear()}}finally{ut=!1,Xe(e),mt=null}}function sr(){try{Bn()}catch(e){Re(e,mt)}}let te=null;function Rt(e){var t=e.length;if(t!==0){for(var n=0;n<t;){var r=e[n++];if((r.f&(ae|q))===0&&Ve(r)&&(te=new Set,Ue(r),r.deps===null&&r.first===null&&r.nodes===null&&(r.teardown===null&&r.ac===null?fn(r):r.fn=null),te?.size>0)){ue.clear();for(const s of te){if((s.f&(ae|q))!==0)continue;const i=[s];let a=s.parent;for(;a!==null;)te.has(a)&&(te.delete(a),i.push(a)),a=a.parent;for(let f=i.length-1;f>=0;f--){const l=i[f];(l.f&(ae|q))===0&&Ue(l)}}te.clear()}}te=null}}function Gt(e,t,n,r){if(!n.has(e)&&(n.add(e),e.reactions!==null))for(const s of e.reactions){const i=s.f;(i&x)!==0?Gt(s,t,n,r):(i&(bt|re))!==0&&(i&M)===0&&Kt(s,t,r)&&(R(s,M),be(s))}}function Kt(e,t,n){const r=n.get(e);if(r!==void 0)return r;if(e.deps!==null)for(const s of e.deps){if(t.includes(s))return!0;if((s.f&x)!==0&&Kt(s,t,n))return n.set(s,!0),!0}return n.set(e,!1),!1}function be(e){for(var t=mt=e;t.parent!==null;){t=t.parent;var n=t.f;if(ut&&t===b&&(n&re)!==0&&(n&qt)===0)return;if((n&(we|ie))!==0){if((n&A)===0)return;t.f^=A}}W.push(t)}function lr(e){let t=0,n=ge(0),r;return()=>{Pe()&&(w(n),Ar(()=>(t===0&&(r=gn(()=>e(()=>Me(n)))),t+=1,()=>{gt(()=>{t-=1,t===0&&(r?.(),r=void 0,Me(n))})})))}}var fr=Se|Oe|tt;function ar(e,t,n){new or(e,t,n)}class or{parent;#e=!1;#t;#r=null;#n;#a;#s;#i=null;#l=null;#f=null;#o=null;#u=null;#c=0;#v=0;#h=!1;#d=null;#m=lr(()=>(this.#d=ge(this.#c),()=>{this.#d=null}));constructor(t,n,r){this.#t=t,this.#n=n,this.#a=r,this.parent=b.b,this.#e=!!this.#n.pending,this.#s=yt(()=>{b.b=this;{var s=this.#b();try{this.#i=B(()=>r(s))}catch(i){this.error(i)}this.#v>0?this.#p():this.#e=!1}return()=>{this.#u?.remove()}},fr)}#w(){try{this.#i=B(()=>this.#a(this.#t))}catch(t){this.error(t)}this.#e=!1}#E(){const t=this.#n.pending;t&&(this.#l=B(()=>t(this.#t)),Q.enqueue(()=>{var n=this.#b();this.#i=this.#_(()=>(Q.ensure(),B(()=>this.#a(n)))),this.#v>0?this.#p():(de(this.#l,()=>{this.#l=null}),this.#e=!1)}))}#b(){var t=this.#t;return this.#e&&(this.#u=me(),this.#t.before(this.#u),t=this.#u),t}is_pending(){return this.#e||!!this.parent&&this.parent.is_pending()}has_pending_snippet(){return!!this.#n.pending}#_(t){var n=b,r=_,s=V;J(this.#s),F(this.#s),Ae(this.#s.ctx);try{return t()}catch(i){return zt(i),null}finally{J(n),F(r),Ae(s)}}#p(){const t=this.#n.pending;this.#i!==null&&(this.#o=document.createDocumentFragment(),this.#o.append(this.#u),un(this.#i,this.#o)),this.#l===null&&(this.#l=B(()=>t(this.#t)))}#g(t){if(!this.has_pending_snippet()){this.parent&&this.parent.#g(t);return}this.#v+=t,this.#v===0&&(this.#e=!1,this.#l&&de(this.#l,()=>{this.#l=null}),this.#o&&(this.#t.before(this.#o),this.#o=null))}update_pending_count(t){this.#g(t),this.#c+=t,this.#d&&ke(this.#d,this.#c)}get_effect_pending(){return this.#m(),w(this.#d)}error(t){var n=this.#n.onerror;let r=this.#n.failed;if(this.#h||!n&&!r)throw t;this.#i&&(I(this.#i),this.#i=null),this.#l&&(I(this.#l),this.#l=null),this.#f&&(I(this.#f),this.#f=null);var s=!1,i=!1;const a=()=>{if(s){er();return}s=!0,i&&\$n(),Q.ensure(),this.#c=0,this.#f!==null&&de(this.#f,()=>{this.#f=null}),this.#e=this.has_pending_snippet(),this.#i=this.#_(()=>(this.#h=!1,B(()=>this.#a(this.#t)))),this.#v>0?this.#p():this.#e=!1};var f=_;try{F(null),i=!0,n?.(t,a),i=!1}catch(l){Re(l,this.#s&&this.#s.parent)}finally{F(f)}r&&gt(()=>{this.#f=this.#_(()=>{Q.ensure(),this.#h=!0;try{return B(()=>{r(this.#t,()=>t,()=>a)})}catch(l){return Re(l,this.#s.parent),null}finally{this.#h=!1}})})}}function ur(e,t,n,r){const s=wt;if(n.length===0&&e.length===0){r(t.map(s));return}var i=E,a=b,f=cr();function l(){Promise.all(n.map(o=>vr(o))).then(o=>{f();try{r([...t.map(s),...o])}catch(u){(a.f&ae)===0&&Re(u,a)}i?.deactivate(),Qe()}).catch(o=>{Re(o,a)})}e.length>0?Promise.all(e).then(()=>{f();try{return l()}finally{i?.deactivate(),Qe()}}):l()}function cr(){var e=b,t=_,n=V,r=E;return function(i=!0){J(e),F(t),Ae(n),i&&r?.activate()}}function Qe(){J(null),F(null),Ae(null)}function wt(e){var t=x|M,n=_!==null&&(_.f&x)!==0?_:null;return b!==null&&(b.f|=Oe),{ctx:V,deps:null,effects:null,equals:Vt,f:t,fn:e,reactions:null,rv:0,v:S,wv:0,parent:n??b,ac:null}}function vr(e,t){let n=b;n===null&&Vn();var r=n.b,s=void 0,i=ge(S),a=!_,f=new Map;return Sr(()=>{var l=Lt();s=l.promise;try{Promise.resolve(e()).then(l.resolve,l.reject).then(()=>{o===E&&o.committed&&o.deactivate(),Qe()})}catch(d){l.reject(d),Qe()}var o=E;if(a){var u=!r.is_pending();r.update_pending_count(1),o.increment(u),f.get(o)?.reject(ye),f.delete(o),f.set(o,l)}const v=(d,h=void 0)=>{if(o.activate(),h)h!==ye&&(i.f|=oe,ke(i,h));else{(i.f&oe)!==0&&(i.f^=oe),ke(i,d);for(const[c,g]of f){if(f.delete(c),c===o)break;g.reject(ye)}}a&&(r.update_pending_count(-1),o.decrement(u))};l.promise.then(v,d=>v(null,d||"unknown"))}),yr(()=>{for(const l of f.values())l.reject(ye)}),new Promise(l=>{function o(u){function v(){u===s?l(i):o(s)}u.then(v,v)}o(s)})}function dr(e){const t=wt(e);return cn(t),t}function hr(e){const t=wt(e);return t.equals=jt,t}function \$t(e){var t=e.effects;if(t!==null){e.effects=null;for(var n=0;n<t.length;n+=1)I(t[n])}}function _r(e){for(var t=e.parent;t!==null;){if((t.f&x)===0)return(t.f&ae)===0?t:null;t=t.parent}return null}function Et(e){var t,n=b;J(_r(e));try{e.f&=~pe,\$t(e),t=_n(e)}finally{J(n)}return t}function Wt(e){var t=Et(e);if(e.equals(t)||(E?.is_fork||(e.v=t),e.wv=dn()),!Ne)if(z!==null)(Pe()||E?.is_fork)&&z.set(e,t);else{var n=(e.f&K)===0?X:A;R(e,n)}}let ct=new Set;const ue=new Map;let Qt=!1;function ge(e,t){var n={f:0,v:e,reactions:null,equals:Vt,rv:0,wv:0};return n}function Y(e,t){const n=ge(e);return cn(n),n}function pr(e,t=!1,n=!0){const r=ge(e);return t||(r.equals=jt),r}function U(e,t,n=!1){_!==null&&(!Z||(_.f&At)!==0)&&Bt()&&(_.f&(x|re|bt|At))!==0&&!ne?.includes(e)&&Kn();let r=n?Te(t):t;return ke(e,r)}function ke(e,t){if(!e.equals(t)){var n=e.v;Ne?ue.set(e,t):ue.set(e,n),e.v=t;var r=Q.ensure();r.capture(e,n),(e.f&x)!==0&&((e.f&M)!==0&&Et(e),R(e,(e.f&K)!==0?A:X)),e.wv=dn(),Zt(e,M),b!==null&&(b.f&A)!==0&&(b.f&(ie|we))===0&&(H===null?Or([e]):H.push(e)),!r.is_fork&&ct.size>0&&!Qt&&br()}return t}function br(){Qt=!1;var e=he;Xe(!0);const t=Array.from(ct);try{for(const n of t)(n.f&A)!==0&&R(n,X),Ve(n)&&Ue(n)}finally{Xe(e)}ct.clear()}function Me(e){U(e,e.v+1)}function Zt(e,t){var n=e.reactions;if(n!==null)for(var r=n.length,s=0;s<r;s++){var i=n[s],a=i.f,f=(a&M)===0;if(f&&R(i,t),(a&x)!==0){var l=i;z?.delete(l),(a&pe)===0&&(a&K&&(i.f|=pe),Zt(l,X))}else f&&((a&re)!==0&&te!==null&&te.add(i),be(i))}}function Te(e){if(typeof e!="object"||e===null||ft in e)return e;const t=In(e);if(t!==Dn&&t!==Fn)return e;var n=new Map,r=Pt(e),s=Y(0),i=_e,a=f=>{if(_e===i)return f();var l=_,o=_e;F(null),Ct(i);var u=f();return F(l),Ct(o),u};return r&&n.set("length",Y(e.length)),new Proxy(e,{defineProperty(f,l,o){(!("value"in o)||o.configurable===!1||o.enumerable===!1||o.writable===!1)&&zn();var u=n.get(l);return u===void 0?u=a(()=>{var v=Y(o.value);return n.set(l,v),v}):U(u,o.value,!0),!0},deleteProperty(f,l){var o=n.get(l);if(o===void 0){if(l in f){const u=a(()=>Y(S));n.set(l,u),Me(s)}}else U(o,S),Me(s);return!0},get(f,l,o){if(l===ft)return e;var u=n.get(l),v=l in f;if(u===void 0&&(!v||Ie(f,l)?.writable)&&(u=a(()=>{var h=Te(v?f[l]:S),c=Y(h);return c}),n.set(l,u)),u!==void 0){var d=w(u);return d===S?void 0:d}return Reflect.get(f,l,o)},getOwnPropertyDescriptor(f,l){var o=Reflect.getOwnPropertyDescriptor(f,l);if(o&&"value"in o){var u=n.get(l);u&&(o.value=w(u))}else if(o===void 0){var v=n.get(l),d=v?.v;if(v!==void 0&&d!==S)return{enumerable:!0,configurable:!0,value:d,writable:!0}}return o},has(f,l){if(l===ft)return!0;var o=n.get(l),u=o!==void 0&&o.v!==S||Reflect.has(f,l);if(o!==void 0||b!==null&&(!u||Ie(f,l)?.writable)){o===void 0&&(o=a(()=>{var d=u?Te(f[l]):S,h=Y(d);return h}),n.set(l,o));var v=w(o);if(v===S)return!1}return u},set(f,l,o,u){var v=n.get(l),d=l in f;if(r&&l==="length")for(var h=o;h<v.v;h+=1){var c=n.get(h+"");c!==void 0?U(c,S):h in f&&(c=a(()=>Y(S)),n.set(h+"",c))}if(v===void 0)(!d||Ie(f,l)?.writable)&&(v=a(()=>Y(void 0)),U(v,Te(o)),n.set(l,v));else{d=v.v!==S;var g=a(()=>Te(o));U(v,g)}var k=Reflect.getOwnPropertyDescriptor(f,l);if(k?.set&&k.set.call(u,o),!d){if(r&&typeof l=="string"){var N=n.get("length"),p=Number(l);Number.isInteger(p)&&p>=N.v&&U(N,p+1)}Me(s)}return!0},ownKeys(f){w(s);var l=Reflect.ownKeys(f).filter(v=>{var d=n.get(v);return d===void 0||d.v!==S});for(var[o,u]of n)u.v!==S&&!(o in f)&&l.push(o);return l},setPrototypeOf(){Gn()}})}var kt,Xt,Jt,en;function gr(){if(kt===void 0){kt=window,Xt=/Firefox/.test(navigator.userAgent);var e=Element.prototype,t=Node.prototype,n=Text.prototype;Jt=Ie(t,"firstChild").get,en=Ie(t,"nextSibling").get,St(e)&&(e.__click=void 0,e.__className=void 0,e.__attributes=null,e.__style=void 0,e.__e=void 0),St(n)&&(n.__t=void 0)}}function me(e=""){return document.createTextNode(e)}function Ze(e){return Jt.call(e)}function qe(e){return en.call(e)}function m(e,t){return Ze(e)}function Ot(e,t=!1){{var n=Ze(e);return n instanceof Comment&&n.data===""?qe(n):n}}function T(e,t=1,n=!1){let r=e;for(;t--;)r=qe(r);return r}function mr(e){e.textContent=""}function tn(){return!1}function nn(e){var t=_,n=b;F(null),J(null);try{return e()}finally{F(t),J(n)}}function wr(e){b===null&&(_===null&&Yn(),Hn()),Ne&&jn()}function Er(e,t){var n=t.last;n===null?t.last=t.first=e:(n.next=e,e.prev=n,t.last=e)}function ce(e,t,n){var r=b;r!==null&&(r.f&q)!==0&&(e|=q);var s={ctx:V,deps:null,nodes:null,f:e|M|K,first:null,fn:t,last:null,next:null,parent:r,b:r&&r.b,prev:null,teardown:null,wv:0,ac:null};if(n)try{Ue(s),s.f|=pt}catch(f){throw I(s),f}else t!==null&&be(s);var i=s;if(n&&i.deps===null&&i.teardown===null&&i.nodes===null&&i.first===i.last&&(i.f&Oe)===0&&(i=i.first,(e&re)!==0&&(e&Se)!==0&&i!==null&&(i.f|=Se)),i!==null&&(i.parent=r,r!==null&&Er(i,r),_!==null&&(_.f&x)!==0&&(e&we)===0)){var a=_;(a.effects??=[]).push(i)}return s}function Pe(){return _!==null&&!Z}function yr(e){const t=ce(_t,null,!1);return R(t,A),t.teardown=e,t}function xr(e){wr();var t=b.f,n=!_&&(t&ie)!==0&&(t&pt)===0;if(n){var r=V;(r.e??=[]).push(e)}else return rn(e)}function rn(e){return ce(Ut|Un,e,!1)}function Tr(e){Q.ensure();const t=ce(we|Oe,e,!0);return(n={})=>new Promise(r=>{n.outro?de(t,()=>{I(t),r(void 0)}):(I(t),r(void 0))})}function Sr(e){return ce(bt|Oe,e,!0)}function Ar(e,t=0){return ce(_t|t,e,!0)}function Ke(e,t=[],n=[],r=[]){ur(r,t,n,s=>{ce(_t,()=>e(...s.map(w)),!0)})}function yt(e,t=0){var n=ce(re|t,e,!0);return n}function B(e){return ce(ie|Oe,e,!0)}function sn(e){var t=e.teardown;if(t!==null){const n=Ne,r=_;Nt(!0),F(null);try{t.call(null)}finally{Nt(n),F(r)}}}function ln(e,t=!1){var n=e.first;for(e.first=e.last=null;n!==null;){const s=n.ac;s!==null&&nn(()=>{s.abort(ye)});var r=n.next;(n.f&we)!==0?n.parent=null:I(n,t),n=r}}function Rr(e){for(var t=e.first;t!==null;){var n=t.next;(t.f&ie)===0&&I(t),t=n}}function I(e,t=!0){var n=!1;(t||(e.f&qt)!==0)&&e.nodes!==null&&e.nodes.end!==null&&(kr(e.nodes.start,e.nodes.end),n=!0),ln(e,t&&!n),Je(e,0),R(e,ae);var r=e.nodes&&e.nodes.t;if(r!==null)for(const i of r)i.stop();sn(e);var s=e.parent;s!==null&&s.first!==null&&fn(e),e.next=e.prev=e.teardown=e.ctx=e.deps=e.fn=e.nodes=e.ac=null}function kr(e,t){for(;e!==null;){var n=e===t?null:qe(e);e.remove(),e=n}}function fn(e){var t=e.parent,n=e.prev,r=e.next;n!==null&&(n.next=r),r!==null&&(r.prev=n),t!==null&&(t.first===e&&(t.first=r),t.last===e&&(t.last=n))}function de(e,t,n=!0){var r=[];an(e,r,!0);var s=()=>{n&&I(e),t&&t()},i=r.length;if(i>0){var a=()=>--i||s();for(var f of r)f.out(a)}else s()}function an(e,t,n){if((e.f&q)===0){e.f^=q;var r=e.nodes&&e.nodes.t;if(r!==null)for(const f of r)(f.is_global||n)&&t.push(f);for(var s=e.first;s!==null;){var i=s.next,a=(s.f&Se)!==0||(s.f&ie)!==0&&(e.f&re)!==0;an(s,t,a?n:!1),s=i}}}function xt(e){on(e,!0)}function on(e,t){if((e.f&q)!==0){e.f^=q,(e.f&A)===0&&(R(e,M),be(e));for(var n=e.first;n!==null;){var r=n.next,s=(n.f&Se)!==0||(n.f&ie)!==0;on(n,s?t:!1),n=r}var i=e.nodes&&e.nodes.t;if(i!==null)for(const a of i)(a.is_global||t)&&a.in()}}function un(e,t){if(e.nodes)for(var n=e.nodes.start,r=e.nodes.end;n!==null;){var s=n===r?null:qe(n);t.append(n),n=s}}let he=!1;function Xe(e){he=e}let Ne=!1;function Nt(e){Ne=e}let _=null,Z=!1;function F(e){_=e}let b=null;function J(e){b=e}let ne=null;function cn(e){_!==null&&(ne===null?ne=[e]:ne.push(e))}let O=null,L=0,H=null;function Or(e){H=e}let vn=1,Le=0,_e=Le;function Ct(e){_e=e}function dn(){return++vn}function Ve(e){var t=e.f;if((t&M)!==0)return!0;if(t&x&&(e.f&=~pe),(t&X)!==0){var n=e.deps;if(n!==null)for(var r=n.length,s=0;s<r;s++){var i=n[s];if(Ve(i)&&Wt(i),i.wv>e.wv)return!0}(t&K)!==0&&z===null&&R(e,A)}return!1}function hn(e,t,n=!0){var r=e.reactions;if(r!==null&&!ne?.includes(e))for(var s=0;s<r.length;s++){var i=r[s];(i.f&x)!==0?hn(i,t,!1):t===i&&(n?R(i,M):(i.f&A)!==0&&R(i,X),be(i))}}function _n(e){var t=O,n=L,r=H,s=_,i=ne,a=V,f=Z,l=_e,o=e.f;O=null,L=0,H=null,_=(o&(ie|we))===0?e:null,ne=null,Ae(e.ctx),Z=!1,_e=++Le,e.ac!==null&&(nn(()=>{e.ac.abort(ye)}),e.ac=null);try{e.f|=ot;var u=e.fn,v=u(),d=e.deps;if(O!==null){var h;if(Je(e,L),d!==null&&L>0)for(d.length=L+O.length,h=0;h<O.length;h++)d[L+h]=O[h];else e.deps=d=O;if(Pe()&&(e.f&K)!==0)for(h=L;h<d.length;h++)(d[h].reactions??=[]).push(e)}else d!==null&&L<d.length&&(Je(e,L),d.length=L);if(Bt()&&H!==null&&!Z&&d!==null&&(e.f&(x|X|M))===0)for(h=0;h<H.length;h++)hn(H[h],e);return s!==null&&s!==e&&(Le++,H!==null&&(r===null?r=H:r.push(...H))),(e.f&oe)!==0&&(e.f^=oe),v}catch(c){return zt(c)}finally{e.f^=ot,O=t,L=n,H=r,_=s,ne=i,Ae(a),Z=f,_e=l}}function Nr(e,t){let n=t.reactions;if(n!==null){var r=Nn.call(n,e);if(r!==-1){var s=n.length-1;s===0?n=t.reactions=null:(n[r]=n[s],n.pop())}}n===null&&(t.f&x)!==0&&(O===null||!O.includes(t))&&(R(t,X),(t.f&K)!==0&&(t.f^=K,t.f&=~pe),\$t(t),Je(t,0))}function Je(e,t){var n=e.deps;if(n!==null)for(var r=t;r<n.length;r++)Nr(e,n[r])}function Ue(e){var t=e.f;if((t&ae)===0){R(e,A);var n=b,r=he;b=e,he=!0;try{(t&(re|Ln))!==0?Rr(e):ln(e),sn(e);var s=_n(e);e.teardown=typeof s=="function"?s:null,e.wv=vn;var i;at&&nr&&(e.f&M)!==0&&e.deps}finally{he=r,b=n}}}function w(e){var t=e.f,n=(t&x)!==0;if(_!==null&&!Z){var r=b!==null&&(b.f&ae)!==0;if(!r&&!ne?.includes(e)){var s=_.deps;if((_.f&ot)!==0)e.rv<Le&&(e.rv=Le,O===null&&s!==null&&s[L]===e?L++:O===null?O=[e]:O.includes(e)||O.push(e));else{(_.deps??=[]).push(e);var i=e.reactions;i===null?e.reactions=[_]:i.includes(_)||i.push(_)}}}if(Ne){if(ue.has(e))return ue.get(e);if(n){var a=e,f=a.v;return((a.f&A)===0&&a.reactions!==null||bn(a))&&(f=Et(a)),ue.set(a,f),f}}else n&&(!z?.has(e)||E?.is_fork&&!Pe())&&(a=e,Ve(a)&&Wt(a),he&&Pe()&&(a.f&K)===0&&pn(a));if(z?.has(e))return z.get(e);if((e.f&oe)!==0)throw e.v;return e.v}function pn(e){if(e.deps!==null){e.f^=K;for(const t of e.deps)(t.reactions??=[]).push(e),(t.f&x)!==0&&(t.f&K)===0&&pn(t)}}function bn(e){if(e.v===S)return!0;if(e.deps===null)return!1;for(const t of e.deps)if(ue.has(t)||(t.f&x)!==0&&bn(t))return!0;return!1}function gn(e){var t=Z;try{return Z=!0,e()}finally{Z=t}}const Cr=-7169;function R(e,t){e.f=e.f&Cr|t}const Dr=["touchstart","touchmove"];function Fr(e){return Dr.includes(e)}const mn=new Set,vt=new Set;function Ir(e){for(var t=0;t<e.length;t++)mn.add(e[t]);for(var n of vt)n(e)}let Dt=null;function \$e(e){var t=this,n=t.ownerDocument,r=e.type,s=e.composedPath?.()||[],i=s[0]||e.target;Dt=e;var a=0,f=Dt===e&&e.__root;if(f){var l=s.indexOf(f);if(l!==-1&&(t===document||t===window)){e.__root=t;return}var o=s.indexOf(t);if(o===-1)return;l<=o&&(a=l)}if(i=s[a]||e.target,i!==t){Cn(e,"currentTarget",{configurable:!0,get(){return i||n}});var u=_,v=b;F(null),J(null);try{for(var d,h=[];i!==null;){var c=i.assignedSlot||i.parentNode||i.host||null;try{var g=i["__"+r];g!=null&&(!i.disabled||e.target===i)&&g.call(i,e)}catch(k){d?h.push(k):d=k}if(e.cancelBubble||c===t||c===null)break;i=c}if(d){for(let k of h)queueMicrotask(()=>{throw k});throw d}}finally{e.__root=t,delete e.currentTarget,F(u),J(v)}}}function Mr(e){var t=document.createElement("template");return t.innerHTML=e.replaceAll("<!>","\x3C!---->"),t.content}function dt(e,t){var n=b;n.nodes===null&&(n.nodes={start:e,end:t,a:null,t:null})}function ve(e,t){var n=(t&Xn)!==0,r=(t&Jn)!==0,s,i=!e.startsWith("<!>");return()=>{s===void 0&&(s=Mr(i?e:"<!>"+e),n||(s=Ze(s)));var a=r||Xt?document.importNode(s,!0):s.cloneNode(!0);if(n){var f=Ze(a),l=a.lastChild;dt(f,l)}else dt(a,a);return a}}function Pr(){var e=document.createDocumentFragment(),t=document.createComment(""),n=me();return e.append(t,n),dt(t,n),e}function ee(e,t){e!==null&&e.before(t)}function se(e,t){var n=t==null?"":typeof t=="object"?t+"":t;n!==(e.__t??=e.nodeValue)&&(e.__t=n,e.nodeValue=n+"")}function Lr(e,t){return Ur(e,t)}const Ee=new Map;function Ur(e,{target:t,anchor:n,props:r={},events:s,context:i,intro:a=!0}){gr();var f=new Set,l=v=>{for(var d=0;d<v.length;d++){var h=v[d];if(!f.has(h)){f.add(h);var c=Fr(h);t.addEventListener(h,\$e,{passive:c});var g=Ee.get(h);g===void 0?(document.addEventListener(h,\$e,{passive:c}),Ee.set(h,1)):Ee.set(h,g+1)}}};l(et(mn)),vt.add(l);var o=void 0,u=Tr(()=>{var v=n??t.appendChild(me());return ar(v,{pending:()=>{}},d=>{if(i){Ht({});var h=V;h.c=i}s&&(r.\$\$events=s),o=e(d,r)||{},i&&Yt()}),()=>{for(var d of f){t.removeEventListener(d,\$e);var h=Ee.get(d);--h===0?(document.removeEventListener(d,\$e),Ee.delete(d)):Ee.set(d,h)}vt.delete(l),v!==n&&v.parentNode?.removeChild(v)}});return qr.set(o,u),o}let qr=new WeakMap;class Vr{anchor;#e=new Map;#t=new Map;#r=new Map;#n=new Set;#a=!0;constructor(t,n=!0){this.anchor=t,this.#a=n}#s=()=>{var t=E;if(this.#e.has(t)){var n=this.#e.get(t),r=this.#t.get(n);if(r)xt(r),this.#n.delete(n);else{var s=this.#r.get(n);s&&(this.#t.set(n,s.effect),this.#r.delete(n),s.fragment.lastChild.remove(),this.anchor.before(s.fragment),r=s.effect)}for(const[i,a]of this.#e){if(this.#e.delete(i),i===t)break;const f=this.#r.get(a);f&&(I(f.effect),this.#r.delete(a))}for(const[i,a]of this.#t){if(i===n||this.#n.has(i))continue;const f=()=>{if(Array.from(this.#e.values()).includes(i)){var o=document.createDocumentFragment();un(a,o),o.append(me()),this.#r.set(i,{effect:a,fragment:o})}else I(a);this.#n.delete(i),this.#t.delete(i)};this.#a||!r?(this.#n.add(i),de(a,f,!1)):f()}}};#i=t=>{this.#e.delete(t);const n=Array.from(this.#e.values());for(const[r,s]of this.#r)n.includes(r)||(I(s.effect),this.#r.delete(r))};ensure(t,n){var r=E,s=tn();if(n&&!this.#t.has(t)&&!this.#r.has(t))if(s){var i=document.createDocumentFragment(),a=me();i.append(a),this.#r.set(t,{effect:B(()=>n(a)),fragment:i})}else this.#t.set(t,B(()=>n(this.anchor)));if(this.#e.set(r,t),s){for(const[f,l]of this.#t)f===t?r.skipped_effects.delete(l):r.skipped_effects.add(l);for(const[f,l]of this.#r)f===t?r.skipped_effects.delete(l.effect):r.skipped_effects.add(l.effect);r.oncommit(this.#s),r.ondiscard(this.#i)}else this.#s()}}function We(e,t,n=!1){var r=new Vr(e),s=n?Se:0;function i(a,f){r.ensure(a,f)}yt(()=>{var a=!1;t((f,l=!0)=>{a=!0,i(l,f)}),a||i(!1,null)},s)}function Ft(e,t){return t}function jr(e,t,n){for(var r=[],s=t.length,i,a=t.length,f=0;f<s;f++){let v=t[f];de(v,()=>{if(i){if(i.pending.delete(v),i.done.add(v),i.pending.size===0){var d=e.outrogroups;ht(et(i.done)),d.delete(i),d.size===0&&(e.outrogroups=null)}}else a-=1},!1)}if(a===0){var l=r.length===0&&n!==null;if(l){var o=n,u=o.parentNode;mr(u),u.append(o),e.items.clear()}ht(t,!l)}else i={pending:new Set(t),done:new Set},(e.outrogroups??=new Set).add(i)}function ht(e,t=!0){for(var n=0;n<e.length;n++)I(e[n],t)}var It;function Mt(e,t,n,r,s,i=null){var a=e,f=new Map,l=null,o=hr(()=>{var g=n();return Pt(g)?g:g==null?[]:et(g)}),u,v=!0;function d(){c.fallback=l,Hr(c,u,a,t,r),l!==null&&(u.length===0?(l.f&fe)===0?xt(l):(l.f^=fe,Fe(l,null,a)):de(l,()=>{l=null}))}var h=yt(()=>{u=w(o);for(var g=u.length,k=new Set,N=E,p=tn(),y=0;y<g;y+=1){var C=u[y],D=r(C,y),P=v?null:f.get(D);P?(P.v&&ke(P.v,C),P.i&&ke(P.i,y),p&&N.skipped_effects.delete(P.e)):(P=Yr(f,v?a:It??=me(),C,D,y,s,t,n),v||(P.e.f|=fe),f.set(D,P)),k.add(D)}if(g===0&&i&&!l&&(v?l=B(()=>i(a)):(l=B(()=>i(It??=me())),l.f|=fe)),!v)if(p){for(const[Ce,\$]of f)k.has(Ce)||N.skipped_effects.add(\$.e);N.oncommit(d),N.ondiscard(()=>{})}else d();w(o)}),c={effect:h,items:f,outrogroups:null,fallback:l};v=!1}function Hr(e,t,n,r,s){var i=t.length,a=e.items,f=e.effect.first,l,o=null,u=[],v=[],d,h,c,g;for(g=0;g<i;g+=1){if(d=t[g],h=s(d,g),c=a.get(h).e,e.outrogroups!==null)for(const \$ of e.outrogroups)\$.pending.delete(c),\$.done.delete(c);if((c.f&fe)!==0)if(c.f^=fe,c===f)Fe(c,null,n);else{var k=o?o.next:f;c===e.effect.last&&(e.effect.last=c.prev),c.prev&&(c.prev.next=c.next),c.next&&(c.next.prev=c.prev),le(e,o,c),le(e,c,k),Fe(c,k,n),o=c,u=[],v=[],f=o.next;continue}if((c.f&q)!==0&&xt(c),c!==f){if(l!==void 0&&l.has(c)){if(u.length<v.length){var N=v[0],p;o=N.prev;var y=u[0],C=u[u.length-1];for(p=0;p<u.length;p+=1)Fe(u[p],N,n);for(p=0;p<v.length;p+=1)l.delete(v[p]);le(e,y.prev,C.next),le(e,o,y),le(e,C,N),f=N,o=C,g-=1,u=[],v=[]}else l.delete(c),Fe(c,f,n),le(e,c.prev,c.next),le(e,c,o===null?e.effect.first:o.next),le(e,o,c),o=c;continue}for(u=[],v=[];f!==null&&f!==c;)(l??=new Set).add(f),v.push(f),f=f.next;if(f===null)continue}(c.f&fe)===0&&u.push(c),o=c,f=c.next}if(e.outrogroups!==null){for(const \$ of e.outrogroups)\$.pending.size===0&&(ht(et(\$.done)),e.outrogroups?.delete(\$));e.outrogroups.size===0&&(e.outrogroups=null)}if(f!==null||l!==void 0){var D=[];if(l!==void 0)for(c of l)(c.f&q)===0&&D.push(c);for(;f!==null;)(f.f&q)===0&&f!==e.fallback&&D.push(f),f=f.next;var P=D.length;if(P>0){var Ce=null;jr(e,D,Ce)}}}function Yr(e,t,n,r,s,i,a,f){var l=(a&Wn)!==0?(a&Zn)===0?pr(n,!1,!1):ge(n):null,o=(a&Qn)!==0?ge(s):null;return{v:l,i:o,e:B(()=>(i(t,l??n,o??s,f),()=>{e.delete(r)}))}}function Fe(e,t,n){if(e.nodes)for(var r=e.nodes.start,s=e.nodes.end,i=t&&(t.f&fe)===0?t.nodes.start:n;r!==null;){var a=qe(r);if(i.before(r),r===s)return;r=a}}function le(e,t,n){t===null?e.effect.first=n:t.next=n,n===null?e.effect.last=t:n.prev=t}function Br(e){V===null&&qn(),xr(()=>{const t=gn(e);if(typeof t=="function")return t})}const zr="5";typeof window<"u"&&((window.__svelte??={}).v??=new Set).add(zr);var Gr=ve('<div class="spinner svelte-9bibt2"></div>'),Kr=ve('<div class="card error svelte-9bibt2"><div class="h svelte-9bibt2">DATA_FETCH_RESISTANCE</div> <div class="sub svelte-9bibt2"> </div></div>'),\$r=ve('<div class="row svelte-9bibt2"><div class="font-mono text-accent svelte-9bibt2"> </div> <div class="font-mono text-green svelte-9bibt2"> </div></div>'),Wr=ve('<div class="sub svelte-9bibt2">NO_MODEL_DATA_RETURNED</div>'),Qr=ve('<tr class="svelte-9bibt2"><td class="svelte-9bibt2"><div style="font-weight: 800;" class="svelte-9bibt2"> </div> <div class="font-mono svelte-9bibt2" style="font-size: 10px; opacity: 0.5;"> </div></td><td class="font-mono text-accent svelte-9bibt2"> </td><td class="font-mono svelte-9bibt2" style="font-size: 11px;"> </td></tr>'),Zr=ve('<tr class="svelte-9bibt2"><td colspan="3" style="text-align:center; padding: 48px; opacity: 0.3;" class="svelte-9bibt2">NO_OPERATIVES_DETECTED</td></tr>'),Xr=ve('<div class="grid svelte-9bibt2"><div class="card stat-card svelte-9bibt2"><div class="h svelte-9bibt2">DAILY_THROUGHPUT</div> <div class="stat-value svelte-9bibt2"> </div> <div class="sub svelte-9bibt2">TOTAL_SESSION_REQUESTS</div></div> <div class="card svelte-9bibt2"><div class="h svelte-9bibt2">MODEL_DISTRIBUTION</div> <div class="list svelte-9bibt2"><!></div></div></div> <div class="card svelte-9bibt2" style="border-left-color: var(--rsdh-accent-green);"><div class="h svelte-9bibt2"><span class="svelte-9bibt2">ACTIVE_OPERATIVES</span> <span class="status-pill text-green status-pulsing svelte-9bibt2">LIVE_FEED</span></div> <div class="table-wrap svelte-9bibt2"><table class="table svelte-9bibt2"><thead class="svelte-9bibt2"><tr class="svelte-9bibt2"><th class="svelte-9bibt2">OPERATIVE</th><th class="svelte-9bibt2">REQ_TODAY</th><th class="svelte-9bibt2">LAST_SYNC</th></tr></thead><tbody class="svelte-9bibt2"><!><!></tbody></table></div></div>',1),Jr=ve('<main class="svelte-9bibt2"><div class="texture-overlay svelte-9bibt2"></div> <header class="svelte-9bibt2"><div class="title svelte-9bibt2"><i class="svelte-9bibt2">✦</i> RSDH ADMIN_CORE_SCAN</div> <div class="flex-row svelte-9bibt2"><!> <button class="secondary svelte-9bibt2">REFRESH_SYNC</button></div></header> <div class="content svelte-9bibt2"><!></div></main>');function ei(e,t){Ht(t,!0);let n=Y(null),r=Y(Te([])),s=Y(!0),i=Y("");const a=new URLSearchParams(window.location.search).get("token");async function f(){U(s,!0),U(i,"");try{const p=await fetch(\`/admin/api/stats?token=\${a}\`),y=await fetch(\`/admin/api/users?token=\${a}\`);if(!p.ok||!y.ok)throw new Error("UNAUTHORIZED ACCESS DETECTED");U(n,await p.json(),!0);const C=await y.json();U(r,C.users||[],!0)}catch(p){U(i,p.message||"SIGNAL LOST",!0)}finally{U(s,!1)}}Br(()=>{f()});var l=Jr(),o=T(m(l),2),u=T(m(o),2),v=m(u);{var d=p=>{var y=Gr();ee(p,y)};We(v,p=>{w(s)&&p(d)})}var h=T(v,2);h.__click=f;var c=T(o,2),g=m(c);{var k=p=>{var y=Kr(),C=T(m(y),2),D=m(C);Ke(()=>se(D,w(i))),ee(p,y)},N=p=>{var y=Xr(),C=Ot(y),D=m(C),P=T(m(D),2),Ce=m(P),\$=T(D,2),wn=T(m(\$),2),En=m(wn);{var yn=j=>{var G=Pr(),je=Ot(G);Mt(je,17,()=>Object.entries(w(n).modelUsage),Ft,(He,Ye)=>{var Be=dr(()=>Pn(w(Ye),2));let nt=()=>w(Be)[0],rt=()=>w(Be)[1];var De=\$r(),ze=m(De),it=m(ze),st=T(ze,2),lt=m(st);Ke(()=>{se(it,nt()),se(lt,rt())}),ee(He,De)}),ee(j,G)},xn=j=>{var G=Wr();ee(j,G)};We(En,j=>{w(n)?.modelUsage?j(yn):j(xn,!1)})}var Tn=T(C,2),Sn=T(m(Tn),2),An=m(Sn),Rn=T(m(An)),Tt=m(Rn);Mt(Tt,17,()=>w(r),Ft,(j,G)=>{var je=Qr(),He=m(je),Ye=m(He),Be=m(Ye),nt=T(Ye,2),rt=m(nt),De=T(He),ze=m(De),it=T(De),st=m(it);Ke(lt=>{se(Be,w(G).displayName||"ANONYMOUS"),se(rt,w(G).username),se(ze,w(G).todayRequests),se(st,lt)},[()=>new Date(w(G).lastSeen).toLocaleString()]),ee(j,je)});var kn=T(Tt);{var On=j=>{var G=Zr();ee(j,G)};We(kn,j=>{w(r).length===0&&j(On)})}Ke(()=>se(Ce,w(n)?.totalRequests||0)),ee(p,y)};We(g,p=>{w(i)?p(k):p(N,!1)})}ee(e,l),Yt()}Ir(["click"]);Lr(ei,{target:document.getElementById("app")});</script>
    <style rel="stylesheet" crossorigin>:root{--rsdh-bg: #0d0d12;--rsdh-panel-bg: rgba(18, 18, 26, .95);--rsdh-accent: #00e5ff;--rsdh-accent-green: #7cff01;--rsdh-accent-red: #ff3d00;--rsdh-text: #f5f5f7;--rsdh-text-muted: #8e8e93;--rsdh-border: rgba(255, 255, 255, .08)}body{background-color:var(--rsdh-bg);color:var(--rsdh-text);font-family:Inter,system-ui,sans-serif;margin:0;overflow-x:hidden}main.svelte-9bibt2{min-height:100vh;display:flex;flex-direction:column;position:relative}.texture-overlay.svelte-9bibt2{position:fixed;inset:0;pointer-events:none;opacity:.03;background-image:radial-gradient(circle at 2px 2px,white 1px,transparent 0);background-size:24px 24px;z-index:10}header.svelte-9bibt2{display:flex;justify-content:space-between;align-items:center;padding:24px 40px;background:linear-gradient(90deg,rgba(0,229,255,.05) 0%,transparent 100%);border-bottom:1px solid var(--rsdh-border);backdrop-filter:blur(10px);z-index:20}.title.svelte-9bibt2{font-weight:900;font-size:14px;text-transform:uppercase;letter-spacing:.2em;color:var(--rsdh-accent)}.title.svelte-9bibt2 i:where(.svelte-9bibt2){color:var(--rsdh-accent-green);font-style:normal;margin-right:8px}.content.svelte-9bibt2{flex:1;padding:40px;max-width:1200px;margin:0 auto;width:100%;z-index:20}.grid.svelte-9bibt2{display:grid;grid-template-columns:1fr 2fr;gap:24px;margin-bottom:24px}.card.svelte-9bibt2{background:#ffffff03;border:1px solid var(--rsdh-border);border-left:4px solid var(--rsdh-accent);padding:24px;position:relative;overflow:hidden}.card.error.svelte-9bibt2{border-left-color:var(--rsdh-accent-red)}.h.svelte-9bibt2{font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}.stat-value.svelte-9bibt2{font-size:48px;font-weight:900;color:var(--rsdh-accent);letter-spacing:-.02em;margin-bottom:8px}.sub.svelte-9bibt2{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--rsdh-text-muted)}.list.svelte-9bibt2{display:flex;flex-direction:column;gap:12px}.row.svelte-9bibt2{display:flex;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid var(--rsdh-border)}.table-wrap.svelte-9bibt2{overflow-x:auto}.table.svelte-9bibt2{width:100%;border-collapse:collapse}.table.svelte-9bibt2 th:where(.svelte-9bibt2){text-align:left;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;padding:12px;border-bottom:2px solid var(--rsdh-border);color:var(--rsdh-text-muted)}.table.svelte-9bibt2 td:where(.svelte-9bibt2){padding:16px 12px;border-bottom:1px solid var(--rsdh-border)}button.svelte-9bibt2{background:#fff;color:#000;border:none;border-radius:2px;padding:10px 20px;font-weight:900;font-size:10px;text-transform:uppercase;letter-spacing:.1em;cursor:pointer;transition:all .2s ease}button.svelte-9bibt2:hover{transform:translateY(-2px);box-shadow:0 4px 12px #fff3}button.secondary.svelte-9bibt2{background:transparent;color:var(--rsdh-text);border:1px solid var(--rsdh-border)}.text-accent.svelte-9bibt2{color:var(--rsdh-accent)}.text-green.svelte-9bibt2{color:var(--rsdh-accent-green)}.font-mono.svelte-9bibt2{font-family:JetBrains Mono,monospace}.status-pill.svelte-9bibt2{padding:4px 10px;font-size:9px;font-weight:900;background:#7cff011a}.flex-row.svelte-9bibt2{display:flex;align-items:center;gap:12px}.spinner.svelte-9bibt2{width:20px;height:20px;border:2px solid var(--rsdh-border);border-top-color:var(--rsdh-accent);animation:svelte-9bibt2-spin .8s linear infinite}@keyframes svelte-9bibt2-spin{to{transform:rotate(360deg)}}.status-pulsing.svelte-9bibt2{animation:svelte-9bibt2-pulse 2s infinite}@keyframes svelte-9bibt2-pulse{0%{opacity:1}50%{opacity:.4}to{opacity:1}}</style>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`;
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
