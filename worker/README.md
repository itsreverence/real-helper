# RSDH Proxy Worker

Cloudflare Worker that proxies OpenRouter API calls for the RealSports Draft Helper userscript.

## Why?

- Hides the OpenRouter API key from the userscript (friends don't need their own keys)
- Centralizes billing to your OpenRouter account
- Provides a single point for rate limiting and logging

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Add Secrets

```bash
# Your OpenRouter API key
npx wrangler secret put OPENROUTER_API_KEY
# Enter: sk-or-v1-xxxxx...

# Shared secret for userscript auth (make up a random string)
npx wrangler secret put RSDH_SHARED_SECRET
# Enter: any-random-secret-string-here
```

### 4. Deploy

```bash
npm run deploy
```

After deploying, you'll get a URL like:
```
https://rsdh-proxy.<your-subdomain>.workers.dev
```

### 5. Update Userscript

In `userscript-svelte/src/core/constants.ts`, update:

```typescript
export const PROXY_ENDPOINT = "https://rsdh-proxy.<your-subdomain>.workers.dev/chat";
export const PROXY_SECRET = "your-secret-from-step-3";
```

Then rebuild: `bun run build:userscript`

## Local Development

Create a `.dev.vars` file (git-ignored):

```
OPENROUTER_API_KEY=sk-or-v1-xxxxx
RSDH_SHARED_SECRET=test-secret
```

Run locally:

```bash
npm run dev
```

Test with curl:

```bash
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -H "X-RSDH-Auth: test-secret" \
  -d '{"model":"google/gemini-2.5-flash","messages":[{"role":"user","content":"Hi"}]}'
```

## Cost

- **Cloudflare Workers**: Free tier includes 100,000 requests/day
- **OpenRouter**: Billed to your account based on model usage
