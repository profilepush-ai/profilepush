# Market Stats Outreach Worker

Turns scraped job/hotlist posters into signups. Whenever a new row lands in `radar_match_results` (job_source='social') or `radar_match_hotlist`, a Postgres trigger calls this worker in real time with the poster's email (sourced from `social_jobs.poster_email` / `social_hotlist.bench_sales_recruiter_email`). If that email doesn't already belong to a platform account, and hasn't been emailed today, this worker sends them the same market-stats content as the daily digest — jobs count, hotlist count, top roles — with a "Sign Up Free" CTA instead of "Login".

It also backfills the existing backlog of poster emails via its own cron, using the same send pipeline, paced in batches and capped by a global daily send limit (see "Daily send cap" below) so a large backlog can't spike volume all at once.

## Depends on

`profilepush-email-notifications`'s `/send` endpoint — this worker resolves recipients and renders the email, then queues delivery through the existing digest worker (GMass transactional API — this project has no Mailgun dependency anywhere anymore, including in this worker or the digest worker it calls) rather than duplicating queue/DLQ logic. No email-provider credentials or Cloudflare Queue live in this worker. The call goes through a `[[services]]` binding (`EMAIL_WORKER` in `wrangler.toml`), not a raw `fetch()` to the other worker's `.workers.dev` URL — Cloudflare rejects Worker-to-Worker fetches over the public route (error 1042; this codebase hit and fixed the identical issue in `vendor-mail-worker`).

Two new Postgres RPCs and a dedup table (`supabase/migrations/20260814090000_create_market_stats_outreach_table.sql`, `..._rpcs.sql`, `..._triggers.sql`):
- `email_has_account(check_email)` — skips anyone who already has a platform account.
- `claim_market_stats_email_send(p_email)` — atomically claims the once-per-UTC-day send slot for an email, permanently blocks unsubscribed addresses, and enforces the global daily send cap below. This is what prevents duplicate sends when the same poster appears on many rows, and what protects GMass sending reputation from a volume spike.
- `get_market_stats_outreach_backfill_batch(p_limit)` — returns the next batch of never-before-contacted poster emails for the backfill cron.

## Daily send cap

This stream targets cold, never-consented scraped poster emails — a much higher spam-complaint risk than the registered-user daily digest (which has its own GMass warmup ramp inside `profilepush-email-notifications`). `claim_market_stats_email_send` enforces a global daily ceiling, shared across the real-time webhook and the backfill cron, read from `market_stats_outreach_config` (`key = 'daily_send_cap'`, default `60`) — tune it without a redeploy:

```bash
curl -X POST "$SUPABASE_URL/rest/v1/market_stats_outreach_config?on_conflict=key" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d '{"key":"daily_send_cap","value":"<new-limit>"}'
```

Once the cap is hit for the day, both the webhook and the cron start getting `claimed = false` for every candidate (indistinguishable in the response from "already sent today" — check `market_stats_email_sends` count for the day if you need to tell them apart) and simply retry those same candidates once the next UTC day starts, no data lost.

## One-time setup

No new Cloudflare Queue is needed. The `AFTER INSERT` triggers need the shared webhook token so they can authenticate into this worker. Unlike older crons in this project (which use `app.supabase_url`/`app.service_role_key` database settings), this project's `postgres` role turned out not to be a superuser — `alter database ... set app.xxx` fails with a permission error — so the token instead lives in a small internal table, `public.market_stats_outreach_config` (RLS-enabled, no grants to `authenticated`/`anon`; the `SECURITY DEFINER` trigger functions bypass RLS as the table owner). Set it once via the service role (never commit the actual token value to a migration file):

```bash
curl -X POST "$SUPABASE_URL/rest/v1/market_stats_outreach_config?on_conflict=key" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d '{"key":"webhook_token","value":"<TRIGGER_WEBHOOK_TOKEN value below>"}'
```

The worker's own URL is hardcoded directly in the trigger functions (not sensitive, no config table entry needed for it).

## Worker secrets

Run these commands from this directory. Enter values only at Wrangler's prompt.

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put TRIGGER_WEBHOOK_TOKEN
npx wrangler secret put WORKER_AUTH_TOKEN
npx wrangler secret put UNSUBSCRIBE_SECRET
npx wrangler secret put EMAIL_WORKER_AUTH_TOKEN
```

`TRIGGER_WEBHOOK_TOKEN` guards `POST /webhook/outreach` and must equal the `app.market_stats_webhook_token` database setting above — it's a separate token from `WORKER_AUTH_TOKEN` (which guards the manual/admin endpoints) so a leak of one doesn't expose the other. `UNSUBSCRIBE_SECRET` signs unsubscribe links keyed on the raw email address — generate a fresh random value; it is **not** shared with `profilepush-email-notifications`'s secret of the same name (separate worker, separate secret store). `EMAIL_WORKER_AUTH_TOKEN` must be set to the **same value** as `profilepush-email-notifications`'s own `WORKER_AUTH_TOKEN` secret — that's the credential its `/send` endpoint checks.

## Deploy

```bash
npx supabase db push
cd cloudflare/market-stats-outreach
npx wrangler deploy
```

There is no GitHub Actions auto-deploy for this worker (only `supabase/**` changes auto-deploy via `.github/workflows/supabase-deploy.yml`) — deploy manually after every change, same as `profilepush-email-notifications`.

## Backfill pacing

`BACKFILL_BATCH_SIZE` (`wrangler.toml` `[vars]`, default 25) and the cron cadence (`wrangler.toml` `[triggers] crons`, default every 30 minutes) control how fast the existing backlog of poster emails drains, bounded overall by the daily send cap above regardless of how high these are set. Both are safe to tune without touching SQL — the backfill RPC's anti-join against `market_stats_email_sends` is the cursor, so no candidate is ever skipped or re-sent across runs regardless of batch size or frequency. Watch GMass's sending dashboard (bounce/complaint rate) after enabling the cron; lower `daily_send_cap` if either climbs.

## Smoke test

1. `POST /run-backfill-batch` with `{"limit": 5, "dry_run": true}` (Bearer `WORKER_AUTH_TOKEN`) — returns the next 5 backfill candidates with **zero side effects** (no claim, no send). Safe to run repeatedly to sanity-check candidate selection.
2. `POST /test-outreach` with `{"to": "<a real address you control>"}` (Bearer `WORKER_AUTH_TOKEN`) — runs the real pipeline (has-account check, daily claim, render, send) against one address. Not exempt from the daily cap — to resend during iterative testing, delete that email's row from `market_stats_email_sends` first.
3. Confirm the email lands, the stats/top-roles match current data, and the unsubscribe link works — clicking it should set `unsubscribed = true` on `market_stats_email_sends` for that email and permanently block future claims.
4. To exercise the real-time trigger end-to-end: insert a test row into `social_jobs` (poster_email you control, not in `auth.users`), then insert a matching `radar_match_results` row with `job_source='social'` and that `job_id`. Check `select * from net._http_response order by created desc limit 5;` for a `200` from `/webhook/outreach`, and confirm the email arrives.
5. Before letting the backfill cron run unattended: `POST /run-backfill-batch` with a small real batch (e.g. `{"limit": 3}`, no `dry_run`) and verify the result end-to-end on real addresses first.
