# Pulse Feed Cache Worker

Cloudflare Worker + KV cache for the /jobs feed (Pulse data).

## What it does

- Reads pulse feed rows from Supabase RPC `get_pulse_social_feed`
- Caches feed payloads in Cloudflare KV by `(hours, limit)` key
- Returns cached rows in milliseconds from edge locations
- Supports forced refresh via `?refresh=1`

## Setup

1. Create KV namespaces:

```bash
cd cloudflare/pulse-feed-cache
npx wrangler kv namespace create PULSE_FEED_CACHE
npx wrangler kv namespace create PULSE_FEED_CACHE --preview
```

2. Copy the returned IDs into `wrangler.toml`:

- `id`
- `preview_id`

3. Set worker secrets:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put WORKER_AUTH_TOKEN
```

4. Deploy:

```bash
npx wrangler deploy
```

## Runtime knobs

- `CACHE_TTL_SECONDS` in `wrangler.toml` (default 90)
- Query params:
  - `hours` (default 24, max 720)
  - `limit` (default 5000, max 5000)
  - `refresh=1` to bypass KV read and refresh cache

## Frontend env vars

Set these in the web app env:

- `VITE_PULSE_CACHE_WORKER_URL` (worker URL)
- `VITE_PULSE_CACHE_WORKER_TOKEN` (same token as `WORKER_AUTH_TOKEN`)

When these are missing, the app falls back to direct Supabase RPC reads.
