# Social Job Queue Consumer Worker

Queue consumer that parses social jobs with Cloudflare Workers AI parser and writes to Supabase `radar_match_results`.

## What it does

- Consumes messages from `social-job-parse`
- Calls parser worker (`profilepush-social-job-parser`)
- Upserts extraction rows to `radar_match_results`
- Marks `social_jobs.extracted_at`

## Setup

1. Ensure producer queue exists:

```bash
# Run in producer folder once
npx wrangler queues create social-job-parse
npx wrangler queues create social-job-parse-dlq
```

2. Set required secrets:

```bash
cd cloudflare/social-job-queue-consumer
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put PARSER_WORKER_URL
npx wrangler secret put PARSER_WORKER_TOKEN
```

3. Deploy:

```bash
npx wrangler deploy
```

## Queue behavior

Configured in `wrangler.toml`:

- `max_batch_size = 10`
- `max_batch_timeout = 5`
- `max_retries = 5`
- `dead_letter_queue = social-job-parse-dlq`
