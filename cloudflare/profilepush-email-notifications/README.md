# Email Notifications Worker

General-purpose Mailgun email sender for ProfilePush, backed by a Cloudflare Queue. Its first (and currently only) producer is its own daily cron trigger, which sends every signed-up user a digest of jobs and hotlist profiles added in the last 24 hours — by email, and (via `notify-daily-digest`) as an in-app bell notification and push notification too. The `/send` endpoint is a generic entry point so future notification types (from Supabase functions or elsewhere) can queue an email without a new worker.

## Depends on

`supabase/functions/notify-daily-digest` — a small Supabase function this worker calls after queueing the digest emails. It inserts one `notifications` row per recipient (bell dropdown) and forwards each to the existing `send-push-notification` → `push-notification-worker` → OneSignal/FCM pipeline. It's fire-and-forget from this worker's perspective — a failure there never blocks the email send.

## One-time resources

```bash
npx wrangler queues create email-notifications
npx wrangler queues create email-notifications-dlq
```

## Worker secrets

Run these commands from this directory. Enter values only at Wrangler's prompt.

```bash
npx wrangler secret put MAILGUN_API_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put WORKER_AUTH_TOKEN
npx wrangler secret put UNSUBSCRIBE_SECRET
npx wrangler secret put DIGEST_NOTIFY_TOKEN
```

`WORKER_AUTH_TOKEN` guards `POST /send` and `POST /test-digest` — generate a random value and keep it for any future producer. `UNSUBSCRIBE_SECRET` signs one-click unsubscribe links — generate a separate random value; do not reuse `WORKER_AUTH_TOKEN`. `DIGEST_NOTIFY_TOKEN` must be set to the **same** value as the Supabase secret of the same name (`npx supabase secrets set DIGEST_NOTIFY_TOKEN=<value>`) — it authorizes this worker's calls into `notify-daily-digest`.

Note the `notify-daily-digest` call authenticates two different ways at once: `Authorization: Bearer <SUPABASE_ANON_KEY>` satisfies Supabase's gateway-level JWT check (it just needs any validly-signed JWT), while the actual authorization is the `token` field in the request body, checked against `DIGEST_NOTIFY_TOKEN` server-side. `SUPABASE_ANON_KEY` is a plain `[vars]` entry in `wrangler.toml`, not a secret — it's the same public key already shipped in the frontend bundle.

## Deploy

```bash
npx supabase db push
cd cloudflare/profilepush-email-notifications
npx wrangler deploy
```

## Mailgun configuration

Sends from `alerts@alerts.profilepush.ai` via the `alerts.profilepush.ai` sending domain (set as `MAILGUN_DOMAIN`/`MAILGUN_FROM_ADDRESS` in `wrangler.toml`). That domain must show "Verified" in Mailgun's Sending → Domains dashboard (SPF/DKIM/tracking DNS records all green) before real sends will succeed.

## Smoke test

1. `POST /test-digest` with `{"to": "<a real recipient email>"}` (Bearer `WORKER_AUTH_TOKEN`) sends the real, fully-rendered digest to one recipient immediately and reports `{sent, notified, jobsCount, hotlistCount}` — the fastest way to check the whole pipeline (email + bell + push) without waiting for the cron.
2. Confirm the email lands (check spam folder — freshly verified domains are often filtered for the first few days), a `notifications` row appears with `type = 'daily_digest'`, and `send-push-notification` reports a successful enqueue.
3. Click the unsubscribe link in the test email; confirm it returns a plain confirmation page and that `notification_preferences` gets a `daily_digest` row with `email_enabled = false` for that user.
4. `npx wrangler dev --test-scheduled` to exercise the full cron path (all recipients) before relying on the 7pm IST trigger; re-run and confirm the unsubscribed address from step 3 is excluded.

Do not log or expose `MAILGUN_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `UNSUBSCRIBE_SECRET`. The `/unsubscribe` link deliberately requires no login — its safety depends entirely on the HMAC signature being unguessable, so treat `UNSUBSCRIBE_SECRET` as sensitive as any other credential.
