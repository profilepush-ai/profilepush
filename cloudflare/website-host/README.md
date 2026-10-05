# website-host

Serves Website Modernization sites (see `supabase/migrations/20261005170000_websites_hosting.sql`).

- `GET` any path: the site's single page. Demos, showcase examples and sites
  whose plan has lapsed get a "Claim this website", "Example website" or
  "paused" bar plus `noindex`.
- `POST api/submit`: a form enquiry (multipart). Saves to
  `website_submissions`, stores a résumé (PDF/DOC/DOCX, 10 MB max) in the
  private `website-resumes` bucket, and emails an alert through
  `profilepush-email-notifications`. Live sites only; 5 posts a minute per
  visitor per site; a filled `_gotcha` field is silently dropped.

## Addresses

| What | URL |
|---|---|
| Demos and live sites | `https://site.profilepush.ai/<slug>/`, slug = the firm's domain (`3sbc.com` → `3sbc-com`) |
| Customer domains | any hostname connected from ProfilePush → Website → Domain (Cloudflare for SaaS) |
| Testing | `https://profilepush-website-host.profilepush-ai.workers.dev/<slug>/` |

`site.profilepush.ai/` itself redirects to `profilepush.ai/websites`.

## Analytics and reports

- `POST api/collect`: pageviews and CTA clicks from the injected tracker,
  60 per minute per visitor. Bots are ignored. No cookies: a visitor is a
  SHA-256 of a secret salt, the day, the site, IP and user agent.
- Cron `0 2 * * *`: yesterday's numbers for every live site with the daily
  report on, emailed to its notify list (or account members).

## Custom domains (one-time setup)

Customer domains reach this Worker through Cloudflare for SaaS on a zone you
control. Use a separate zone from profilepush.ai (for example a cheap
`profilepush-sites.com`) so the catch-all route below can't intercept the app:

1. Add the zone to Cloudflare and enable **SSL/TLS → Custom Hostnames**.
2. DNS: a proxied `AAAA customers 100::` record. Set it as the fallback origin.
3. Add a Worker route `*/*` on that zone to `profilepush-website-host`.
4. Supabase function secrets: `CF_SAAS_ZONE_ID`, `CF_SAAS_API_TOKEN`
   (Custom Hostnames + SSL edit on that zone) and
   `SITES_CNAME_TARGET=customers.<that zone>`.

Customers then add a CNAME to `SITES_CNAME_TARGET` (plus the TXT records the
Domain tab shows) and HTTPS is issued automatically.

## Deploy

```sh
cd cloudflare/website-host
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put WORKER_AUTH_TOKEN   # same value as the email worker's
wrangler secret put ANALYTICS_SALT      # any long random string
wrangler deploy
```

## Publish a site

Usually from Admin → Website Demos (`/admin/websites`), which crawls the
firm's site, writes the content with Claude and renders a template. From the
command line:

```sh
# a hand-built page
SUPABASE_SERVICE_ROLE_KEY=... node scripts/website-publish.mjs \
  --file site.html --name "Cerf IT" --source-url https://www.cerfits.com
# content JSON in a template (meridian | atlas)
SUPABASE_SERVICE_ROLE_KEY=... node scripts/website-publish.mjs \
  --content 3sbc-com.json --template atlas --source-url http://www.3sbc.com
```

Hand-built pages must post forms to the relative path `api/submit` with an
`enquiry_type` field (a goal id: `candidate`, `consultant`, `employer`,
`partner`, `training`; anything else is stored as a general contact).
