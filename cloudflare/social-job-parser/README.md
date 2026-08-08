# social-job-parser worker

Cloudflare Worker that runs Workers AI extraction for social job payload parsing.

## Purpose

This worker receives an array of jobs and returns normalized extraction rows for:
- role_title
- core_skills
- years_experience
- visa_types
- employment_type
- work_type
- locations
- hourly_rate_min
- hourly_rate_max

It is called by the Supabase Edge Function receive-social-job when CLOUDFLARE_WORKER_URL is configured.

## Required worker bindings/secrets

- AI binding in wrangler.toml (already configured as AI)
- WORKER_AUTH_TOKEN secret
- PARSER_MODEL variable (defaults to @cf/meta/llama-3.1-8b-instruct-fp8)

Set secret:

wrangler secret put WORKER_AUTH_TOKEN

## Local development

wrangler dev

## Deploy

wrangler deploy

## Supabase function secrets

Set in Supabase project:

- CLOUDFLARE_WORKER_URL=https://<your-worker>.workers.dev
- CLOUDFLARE_WORKER_TOKEN=<same token as WORKER_AUTH_TOKEN>

Optional fallback:

- GEMINI_API_KEY can remain configured for fallback if worker is unavailable.
