# website-host

Serves Website Modernization sites (see `supabase/migrations/20261005170000_websites_hosting.sql`).

- `GET` any path: the site's single page. Demos, and sites whose plan has
  lapsed, get a "Claim this website" or "paused" banner plus `noindex`.
- `POST api/submit`: a form enquiry (multipart). Saves to
  `website_submissions`, stores a résumé (PDF/DOC/DOCX, 10 MB max) in the
  private `website-resumes` bucket, and emails an alert through
  `profilepush-email-notifications`. Live sites only; 5 posts a minute per
  visitor per site; a filled `_gotcha` field is silently dropped.

## Addresses

| Mode | URL |
|---|---|
| Testing (now) | `https://profilepush-website-host.profilepush-ai.workers.dev/s/<slug>/` |
| Sites domain | `https://<slug>.<SITES_DOMAIN>/`, once `SITES_DOMAIN` is set and routed |
| Customer domain | any hostname matching `websites.custom_domain` (Cloudflare for SaaS) |

## Deploy

```sh
cd cloudflare/website-host
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put WORKER_AUTH_TOKEN   # same value as the email worker's
wrangler deploy
```

## Publish a site

```sh
SUPABASE_SERVICE_ROLE_KEY=... node scripts/website-publish.mjs \
  --file site.html --name "Cerf IT" --slug cerfits \
  --source-url https://www.cerfits.com --claim-domain cerfits.com
```

Prints the demo link and the claim link (`/claim/<token>`). Forms in the
page must post to the relative path `api/submit` and include an
`enquiry_type` field (`Candidate`, `Partnership`, or anything else for a
general contact).
