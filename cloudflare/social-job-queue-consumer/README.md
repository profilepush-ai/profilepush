# Social Job Queue Consumer Worker

Queue consumer that parses social jobs with Cloudflare Workers AI parser and writes to Supabase `radar_match_results`.

## What it does

- Consumes messages from `social-job-parse`
- Calls parser worker (`profilepush-social-job-parser`)
- Upserts extraction rows to `radar_match_results`
- Marks `social_jobs.extracted_at`
- Accepts authenticated vendor email replies, extracts requested details with Workers AI, and marks the job Verified
- Generates authenticated Ask Vendor email copy with Workers AI

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
npx wrangler secret put INBOUND_REPLY_TOKEN
npx wrangler secret put ASK_VENDOR_AI_TOKEN
```

3. Deploy:

```bash
npx wrangler deploy
```

## Vendor reply webhook

Send a `POST` to the deployed worker URL with `Authorization: Bearer <INBOUND_REPLY_TOKEN>`.

```json
{
	"job_id": "Job UUID returned in the original Ask Vendor CRM payload",
	"subject": "Re: Additional details requested",
	"from_email": "vendor@example.com",
	"email_content": "The role is hybrid, $65/hr on C2C, and requires 8 years of experience."
}
```

The worker verifies that `from_email` matches the vendor attached to `job_id`, then only writes fields that were requested and explicitly present in the reply. Configure the bearer token as a request header; it is not part of the custom data payload.

## Ask Vendor email writer

The Supabase `ask-ai-vendor-email` function sends an authenticated `POST` to `/ask-vendor-email-copy` using the shared `ASK_VENDOR_AI_TOKEN`. The Worker returns a plain-text subject and email body generated from the job, missing details, vendor name, and requester's first name. Generated bodies are under 40 words and cannot mention ProfilePush.

## Queue behavior

Configured in `wrangler.toml`:

- `max_batch_size = 10`
- `max_batch_timeout = 5`
- `max_retries = 5`
- `dead_letter_queue = social-job-parse-dlq`
