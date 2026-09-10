# Market Stats Outreach Worker

Turns scraped job/hotlist posters into signups. Whenever a new row lands in `radar_match_results` (job_source='social') or `radar_match_hotlist`, a Postgres trigger calls this worker in real time with the poster's email and the underlying post's id (sourced from `social_jobs.poster_email`/`job_id` or `social_hotlist.bench_sales_recruiter_email`/`hotlist_id`). If that email doesn't already belong to a platform account, it's enqueued onto a Cloudflare Queue; a consumer then computes how many profiles on the *other* side of the marketplace match that post (hotlist profiles matching a job, or jobs matching a hotlist post), drafts a short personalized pitch with Workers AI, and sends it via GMass — the same mailbox/integration already used by the registered-user daily digest.

It also backfills the existing backlog of poster emails via its own cron, using the same queue, paced by the warmup-ramp cap below so a large backlog can't spike volume all at once.

## Depends on

`profilepush-email-notifications`'s `/send` endpoint — this worker resolves recipients and renders the email, then queues delivery through the existing digest worker (GMass transactional API) rather than duplicating email-sending logic. The call goes through a `[[services]]` binding (`EMAIL_WORKER` in `wrangler.toml`), not a raw `fetch()` to the other worker's `.workers.dev` URL — Cloudflare rejects Worker-to-Worker fetches over the public route (error 1042; this codebase hit and fixed the identical issue in `vendor-mail-worker`).

Postgres RPCs and a dedup table (`supabase/migrations/20260814090000_create_market_stats_outreach_table.sql`, `..._rpcs.sql`, `..._triggers.sql`, plus the cross-match additions below):
- `email_has_account(check_email)` — skips anyone who already has a platform account or a pending team invite (`account_members.invited_email`).
- `claim_market_stats_email_send(p_email)` — atomically claims the once-per-UTC-day send slot for an email, permanently blocks unsubscribed addresses, and enforces the GMass-mailbox warmup ramp (below). This is what prevents duplicate sends when the same poster appears on many rows, and what protects GMass sending reputation from a volume spike — the exact mechanism that matters here since this stream shares a mailbox with the daily digest.
- `count_matching_hotlist_profiles_for_job(p_job_id, p_window_days)` / `count_matching_jobs_for_hotlist(p_hotlist_id, p_window_days)` — text/skills-overlap heuristics (no embedding column exists on `social_hotlist`) computing the cross-match count the pitch leads with (`supabase/migrations/20260909100000_add_market_stats_outreach_match_count_rpcs.sql`).
- `get_market_stats_outreach_backfill_batch(p_limit)` — returns the next batch of never-before-contacted poster emails for the backfill cron, each with a representative `job_id`/`hotlist_id` so the queue consumer has a post to compute a match count and pitch against.

A sibling function `claim_market_stats_email_send_instantly` and its `instantly_daily_send_cap` config key exist in the database from an earlier, abandoned attempt to move this stream's delivery to Instantly/Smartlead — unused by this worker, left in place rather than dropped (same precedent as the pre-warmup flat cap before it).

## Daily send cap (GMass mailbox warmup ramp)

This stream shares its send mailbox with the registered-user daily digest — see `supabase/migrations/20260825130000_market_stats_outreach_warmup_ramp.sql` for why a flat cap wasn't enough (a real incident: 138 sends in one day through a 2-day-old mailbox tripped a Google sending-limit throttle). `claim_market_stats_email_send` enforces a ramp tied to `market_stats_outreach_config`'s `warmup_start_date`/`warmup_initial_cap`/`warmup_daily_growth`/`warmup_duration_days`/`steady_state_cap` keys (steady-state ceiling: 150/day, shared across the real-time webhook and the backfill cron). Tune any of these without a redeploy:

```bash
curl -X POST "$SUPABASE_URL/rest/v1/market_stats_outreach_config?on_conflict=key" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d '{"key":"steady_state_cap","value":"<new-limit>"}'
```

Once the cap is hit for the day, both the webhook and the cron start getting `claimed = false` for every candidate and simply retry those same candidates once the next UTC day starts, no data lost.

## One-time setup

No new Cloudflare Queue setup is needed if it already exists (`market-stats-outreach-leads` / `market-stats-outreach-leads-dlq`) — this worker's queue is for async cross-match + AI-drafting compute, independent of which vendor ultimately sends the email:

```bash
npx wrangler queues create market-stats-outreach-leads
npx wrangler queues create market-stats-outreach-leads-dlq
```

The `AFTER INSERT` triggers need the shared webhook token so they can authenticate into this worker. The token lives in `public.market_stats_outreach_config` (RLS-enabled, no grants to `authenticated`/`anon`; the `SECURITY DEFINER` trigger functions bypass RLS as the table owner). Set it once via the service role (never commit the actual token value to a migration file):

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

`TRIGGER_WEBHOOK_TOKEN` guards `POST /webhook/outreach` and must equal the `market_stats_outreach_config.webhook_token` value above — it's a separate token from `WORKER_AUTH_TOKEN` (which guards the manual/admin endpoints) so a leak of one doesn't expose the other. `UNSUBSCRIBE_SECRET` signs unsubscribe links keyed on the raw email address — it is **not** shared with `profilepush-email-notifications`'s secret of the same name (separate worker, separate secret store). `EMAIL_WORKER_AUTH_TOKEN` must be set to the **same value** as `profilepush-email-notifications`'s own `WORKER_AUTH_TOKEN` secret (which is also what `supabase/functions/send-welcome-email`'s `EMAIL_WORKER_TOKEN` secret must match) — that's the credential its `/send` endpoint checks.

## Deploy

```bash
npx supabase db push
cd cloudflare/market-stats-outreach
npx wrangler deploy
```

There is no GitHub Actions auto-deploy for this worker (only `supabase/**` changes auto-deploy via `.github/workflows/supabase-deploy.yml`) — deploy manually after every change, same as `profilepush-email-notifications`.

## Smoke test

1. `POST /run-backfill-batch` with `{"limit": 5, "dry_run": true}` (Bearer `WORKER_AUTH_TOKEN`) — returns the next 5 backfill candidates with **zero side effects** (no claim, no enqueue). Safe to run repeatedly to sanity-check candidate selection.
2. `POST /test-outreach` with `{"to": "<a real address you control>", "source": "job", "job_id": "<a real social_jobs id>"}` (Bearer `WORKER_AUTH_TOKEN`) — defaults to `dry_run: true`: runs the has-account check, claim, cross-match count, and AI draft, and returns the rendered email (subject/html/text) **without sending it**. Pass `"dry_run": false` to actually send via GMass.
3. Confirm the email lands, the AI-drafted pitch reads correctly, and the unsubscribe link works — clicking it should set `unsubscribed = true` on `market_stats_email_sends` for that email and permanently block future claims.
4. To exercise the real-time trigger end-to-end: insert a test row into `social_jobs` (poster_email you control, not in `auth.users`), then insert a matching `radar_match_results` row with `job_source='social'` and that `job_id`. Check `select * from net._http_response order by created desc limit 5;` for a `200` from `/webhook/outreach`, then `wrangler tail` to confirm the queue consumer picked up and processed the message, and confirm the email arrives.
5. Not exempt from the daily cap — to resend the same test address during iterative testing, delete that email's row from `market_stats_email_sends` first.
6. Before letting the backfill cron run unattended: `POST /run-backfill-batch` with a small real batch (e.g. `{"limit": 3}`, no `dry_run`) and verify a few real candidates enqueue and send correctly first.
