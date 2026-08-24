# Active List Cache Worker

Cloudflare Worker + KV cache fronting the two public "Active List" SEO landing pages (`/it-staffing-vendor-list`, `/it-staffing-bench-sales-recruiters-list`). Serves scraped contacts from the last 7 days, capped at the top 100 most-recently-active per list. Emails are masked by the frontend's `ActiveListTable` (`maskEmails` prop), not by this worker — it still returns the real address, same as the authenticated path.

## What it does

- Reads from Supabase RPCs `get_active_list_vendor_contacts_24h` / `get_active_list_recruiter_contacts_24h` using the **service-role key** (these RPCs are `service_role`-only — they return unscoped, platform-wide PII, so they're deliberately not grantable to `anon`/`authenticated`, unlike `pulse-feed-cache`'s RPC).
- Caches each list's payload in KV, capped at 100 rows server-side before caching — the cap is enforced here, not client-side, so the full dataset never crosses the wire to an unauthenticated caller. Queries a 7-day window (not just 24h) so both categories reliably have 100+ contacts to pick the top 100 from.
- `GET /vendors` and `GET /recruiters` — each its own cache key/TTL.
- Supports forced refresh via `?refresh=1`, and serves stale cache on upstream failure.

There is deliberately **no client-side fallback to direct Supabase** if this worker is unreachable (unlike `pulse-feed-cache`) — that fallback only works there because its RPC is safe to call with the anon key. Ours isn't, so the public pages should show an error state instead of falling back.

## Setup

KV namespace already created (`ACTIVE_LIST_CACHE`, ids in `wrangler.toml`). Set secrets:

```bash
cd cloudflare/active-list-cache
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put WORKER_AUTH_TOKEN   # optional — anti-abuse token, not a real per-user auth boundary
```

Deploy:

```bash
npx wrangler deploy
```

## Runtime knobs

- `CACHE_TTL_SECONDS` in `wrangler.toml` (default 3600 — hourly; this data doesn't need to be fresher than that)
- `?refresh=1` bypasses the KV read

## Frontend env vars

- `VITE_ACTIVE_LIST_WORKER_URL` (worker URL, required — no fallback)
- `VITE_ACTIVE_LIST_WORKER_TOKEN` (optional, only if `WORKER_AUTH_TOKEN` is set)
