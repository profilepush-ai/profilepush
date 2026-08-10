# Vendor Mail Worker

Cloudflare transport for ProfilePush Ask Vendor conversations. Supabase owns conversation state, Cloudflare Queues provide durable processing, R2 stores inbound payloads and attachments, and Mailgun sends and receives email for `ask.profilepush.ai`.

## One-time resources

```bash
npx wrangler r2 bucket create profilepush-vendor-mail

npx wrangler queues create vendor-mail-outbound
npx wrangler queues create vendor-mail-outbound-dlq
npx wrangler queues create vendor-mail-inbound
npx wrangler queues create vendor-mail-inbound-dlq
npx wrangler queues create vendor-reply-extraction
npx wrangler queues create vendor-reply-extraction-dlq
```

The worker's five-minute cron queues AI sanitization for pending inbound replies, including messages received before the display-text migration.

## Worker secrets

Run these commands from this directory. Enter values only at Wrangler's prompt.

```bash
npx wrangler secret put MAILGUN_API_KEY
npx wrangler secret put MAILGUN_SIGNING_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put WORKER_AUTH_TOKEN
npx wrangler secret put REPLY_PROCESSOR_TOKEN
```

`WORKER_AUTH_TOKEN` must equal the Supabase `VENDOR_MAIL_WORKER_TOKEN` secret. `REPLY_PROCESSOR_TOKEN` must equal the existing social-job Worker `INBOUND_REPLY_TOKEN` secret.

## Deploy

From the repository root:

```bash
npx supabase db push
npx supabase functions deploy ask-ai-vendor-email
npx supabase functions deploy send-vendor-message

cd cloudflare/vendor-mail-worker
npx wrangler deploy
```

Set these Supabase Edge Function secrets after the Worker URL is known:

```bash
npx supabase secrets set VENDOR_MAIL_WORKER_URL=https://profilepush-vendor-mail.profilepush-ai.workers.dev
npx supabase secrets set VENDOR_MAIL_WORKER_TOKEN=<same-random-token-used-by-worker>
```

Redeploy the Edge Functions after setting secrets.

## Mailgun configuration

Configure the receiving route:

```text
match_recipient("^reply\\+.*@ask\\.profilepush\\.ai$")
forward("https://profilepush-vendor-mail.profilepush-ai.workers.dev/mailgun/inbound")
stop()
```

Configure the Mailgun event webhook for all domain events, including accepted, delivered, temporary failure, permanent failure, opened, clicked, unsubscribed, stored, and complained events:

```text
https://profilepush-vendor-mail.profilepush-ai.workers.dev/mailgun/events
```

## Smoke test

1. Ask a controlled vendor address for details from `/jobs`.
2. Confirm the browser opens `/inbox/{conversation-id}`.
3. Confirm the initial message changes from `queued` to `accepted`, then `delivered`.
4. Reply from the vendor mailbox without changing the Reply-To address.
5. Confirm the reply appears once in `/inbox` and increments unread state when the thread is not open.
6. Confirm extracted details update only the originating Ask Vendor request and job.
7. Repeat with a second ProfilePush user contacting the same vendor and verify thread isolation.

Do not make the R2 bucket public. Queue payloads contain identifiers and message text metadata, never API keys or attachment bytes.