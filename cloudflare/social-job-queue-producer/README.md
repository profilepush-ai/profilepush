# Social Job Queue Producer Worker

HTTP producer for Cloudflare Queue messages used by async social job parsing.

## What it does

- Accepts `POST` with `{ jobs: [...] }`
- Validates required job payload fields
- Publishes messages to Cloudflare Queue `social-job-parse`

## Required request format

```json
{
  "jobs": [
    {
      "job_id": "uuid",
      "post_id": "platform_post_id",
      "platform": "linkedin",
      "title": "Java Developer",
      "description": "...",
      "location": "Remote"
    }
  ]
}
```

## Setup

1. Create queues:

```bash
cd cloudflare/social-job-queue-producer
npx wrangler queues create social-job-parse
npx wrangler queues create social-job-parse-dlq
```

2. Set auth secret:

```bash
npx wrangler secret put WORKER_AUTH_TOKEN
```

3. Deploy:

```bash
npx wrangler deploy
```

## Supabase function env vars

Set these in Supabase for `receive-social-job`:

- `CLOUDFLARE_QUEUE_PRODUCER_URL` (this worker URL)
- `CLOUDFLARE_QUEUE_PRODUCER_TOKEN` (same value as `WORKER_AUTH_TOKEN`)
