// Website Modernization hosting. Serves every customer site from one Worker,
// chosen by hostname (<slug>.<SITES_DOMAIN> or a customer's own domain), or
// by path on workers.dev (/s/<slug>/) for testing.
//
// - Live sites (claimed, plan running) are served as published.
// - Demos and lapsed sites get a banner and noindex; their forms don't
//   accept enquiries.
// - Forms post multipart data to "api/submit" (relative, so it works in both
//   host and path mode). Submissions go to website_submissions, résumés to
//   the private website-resumes bucket, and an alert email to the site's
//   notify_emails (or the account's members).

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  APP_BASE_URL: string;
  SITES_DOMAIN: string;
  SITE_CACHE_SECONDS: string;
  WORKER_AUTH_TOKEN: string;
  EMAIL_WORKER: Fetcher;
  SUBMIT_LIMITER: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

type Site = {
  id: string;
  slug: string;
  name: string;
  html: string;
  status: string;
  live: boolean;
  claimed: boolean;
  claim_token: string;
  demo_expired: boolean;
  alert_emails: string[];
};

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const RESUME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const MAX_FIELDS = 40;
const MAX_FIELD_CHARS = 4000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function supabaseHeaders(env: Env, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, ...extra };
}

// Which site a request is for, and the path within it.
function resolve(url: URL, env: Env): { slug: string | null; host: string | null; path: string; base: string } | null {
  const host = url.hostname.toLowerCase();
  const pathMode = url.pathname.match(/^\/s\/([a-z0-9][a-z0-9-]{1,62})(\/.*)?$/);
  if (host.endsWith('.workers.dev') || host === 'localhost' || host === '127.0.0.1') {
    if (!pathMode) return null;
    return { slug: pathMode[1], host: null, path: pathMode[2] ?? '', base: `/s/${pathMode[1]}/` };
  }
  if (env.SITES_DOMAIN && host.endsWith(`.${env.SITES_DOMAIN}`)) {
    const slug = host.slice(0, -(env.SITES_DOMAIN.length + 1));
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return null;
    return { slug, host: null, path: url.pathname, base: '/' };
  }
  return { slug: null, host, path: url.pathname, base: '/' };
}

async function loadSite(env: Env, ctx: ExecutionContext, slug: string | null, host: string | null): Promise<Site | null> {
  const cacheKey = new Request(`https://website-host.internal/site/${slug ? `s/${slug}` : `h/${host}`}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    const cached = await hit.json<{ site: Site | null }>();
    return cached.site;
  }
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/website_for_request`, {
    method: 'POST',
    headers: supabaseHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ p_slug: slug, p_host: host }),
  });
  if (!res.ok) throw new Error(`website_for_request ${res.status}: ${await res.text()}`);
  const rows = await res.json<Site[]>();
  const site = rows[0] ?? null;
  const ttl = Math.max(0, Number(env.SITE_CACHE_SECONDS) || 60);
  ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify({ site }), { headers: { 'Cache-Control': `max-age=${ttl}` } })));
  return site;
}

function page(title: string, message: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a;font:16px/1.6 system-ui,sans-serif;padding:24px}main{max-width:440px;text-align:center}h1{font-size:24px;margin:0 0 8px}p{color:#64748b;margin:0}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${message}</p></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

// The bar shown on demos and lapsed sites. Inline styles only, so it looks
// the same on any template.
function banner(site: Site, env: Env): string {
  const claimUrl = `${env.APP_BASE_URL}/claim/${encodeURIComponent(site.claim_token)}`;
  const text = site.claimed
    ? `This website is paused. <a href="${env.APP_BASE_URL}/website" style="color:#fff;font-weight:700;text-decoration:underline">Renew the plan</a> to bring it back.`
    : `Demo prepared for <b>${escapeHtml(site.name)}</b> by ProfilePush. Forms are switched off until it's claimed. <a href="${claimUrl}" style="color:#0f172a;background:#fff;border-radius:999px;padding:6px 14px;font-weight:700;text-decoration:none;margin-left:8px;white-space:nowrap">Claim this website →</a>`;
  return `<div role="region" aria-label="Demo notice" style="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px;padding:12px 16px;border-radius:16px;background:#2563eb;color:#fff;font:600 14px/1.5 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.35);text-align:center">${text}</div>`;
}

async function serveSite(site: Site, base: string, env: Env): Promise<Response> {
  let html = site.html;
  // Path mode serves the site under /s/<slug>/; a <base> keeps its relative
  // links (api/submit, assets) inside that folder.
  if (base !== '/') html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`);
  const headers: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
  if (site.live) {
    headers['Cache-Control'] = 'public, max-age=60';
  } else {
    html = html.replace(/<head([^>]*)>/i, `<head$1><meta name="robots" content="noindex,nofollow">`);
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${banner(site, env)}</body>`) : html + banner(site, env);
    headers['Cache-Control'] = 'no-store';
    headers['X-Robots-Tag'] = 'noindex, nofollow';
  }
  return new Response(html, { headers });
}

function kindOf(enquiryType: string): 'candidate' | 'partner' | 'contact' {
  const t = enquiryType.toLowerCase();
  if (t.startsWith('cand')) return 'candidate';
  if (t.startsWith('partner') || t.startsWith('vendor')) return 'partner';
  return 'contact';
}

async function uploadResume(env: Env, siteId: string, file: File): Promise<{ path: string; filename: string } | { error: string }> {
  if (file.size === 0) return { error: 'empty' };
  if (file.size > MAX_RESUME_BYTES) return { error: 'Résumé must be 10 MB or smaller.' };
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const contentType = RESUME_TYPES[ext];
  if (!contentType) return { error: 'Résumé must be a PDF, DOC or DOCX file.' };
  const path = `${siteId}/${crypto.randomUUID()}.${ext}`;
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/website-resumes/${path}`, {
    method: 'POST',
    headers: supabaseHeaders(env, { 'Content-Type': contentType, 'x-upsert': 'false' }),
    body: await file.arrayBuffer(),
  });
  if (!res.ok) throw new Error(`resume upload ${res.status}: ${await res.text()}`);
  return { path, filename: file.name.slice(0, 200) };
}

async function sendAlert(env: Env, site: Site, kind: string, fields: Record<string, string>, hasResume: boolean): Promise<void> {
  const recipients = (site.alert_emails ?? []).filter(e => /^\S+@\S+\.\S+$/.test(e)).slice(0, 10);
  if (recipients.length === 0 || !env.WORKER_AUTH_TOKEN) return;
  const label = kind === 'candidate' ? 'candidate' : kind === 'partner' ? 'partner' : 'contact';
  const who = fields.name || fields.company || fields.email || 'Someone';
  const rows = Object.entries(fields)
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#64748b;vertical-align:top;white-space:nowrap">${escapeHtml(k.replace(/_/g, ' '))}</td><td style="padding:6px 0;color:#0f172a">${escapeHtml(v).replace(/\n/g, '<br>')}</td></tr>`)
    .join('');
  const html = `<div style="font:15px/1.6 system-ui,sans-serif;color:#0f172a;max-width:560px">
<p style="margin:0 0 4px;color:#64748b">${escapeHtml(site.name)} website</p>
<h2 style="margin:0 0 16px;font-size:20px">New ${label} enquiry from ${escapeHtml(who)}</h2>
<table style="border-collapse:collapse;font-size:14px">${rows}</table>
${hasResume ? '<p style="margin:16px 0 0">A résumé is attached to this enquiry in ProfilePush.</p>' : ''}
<p style="margin:24px 0 0"><a href="${env.APP_BASE_URL}/website" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:10px">View in ProfilePush</a></p>
</div>`;
  const text = `New ${label} enquiry from ${who}\n\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nView it: ${env.APP_BASE_URL}/website`;
  await Promise.all(recipients.map(to => env.EMAIL_WORKER.fetch('https://email-worker/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.WORKER_AUTH_TOKEN}` },
    body: JSON.stringify({ to, subject: `New ${label} enquiry: ${who} (${site.name} website)`, html, text, category: 'website_enquiry' }),
  }).catch(err => console.error('alert send failed', err))));
}

async function handleSubmit(request: Request, env: Env, ctx: ExecutionContext, site: Site): Promise<Response> {
  if (!site.live) return json({ error: 'This website is not accepting enquiries yet.' }, 403);

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await env.SUBMIT_LIMITER.limit({ key: `${site.id}:${ip}` });
  if (!success) return json({ error: 'Too many submissions. Please try again in a minute.' }, 429);

  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (contentLength > MAX_RESUME_BYTES + 512 * 1024) return json({ error: 'Submission is too large.' }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Invalid form submission.' }, 400);
  }

  // Honeypot: real visitors never fill a field named _gotcha.
  if (String(form.get('_gotcha') ?? '').trim()) return json({ ok: true });

  const fields: Record<string, string> = {};
  let resume: File | null = null;
  let count = 0;
  for (const [key, value] of form.entries()) {
    if (value instanceof File) {
      if (!resume && value.size > 0) resume = value;
      continue;
    }
    if (key.startsWith('_') || ++count > MAX_FIELDS) continue;
    const k = key.slice(0, 60);
    const v = String(value).trim().slice(0, MAX_FIELD_CHARS);
    if (!v) continue;
    fields[k] = fields[k] ? `${fields[k]}, ${v}` : v;
  }

  const email = fields.email ?? '';
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'A valid email is required.' }, 400);
  const kind = kindOf(fields.enquiry_type ?? '');
  delete fields.enquiry_type;

  let resumePath: string | null = null;
  let resumeFilename: string | null = null;
  if (resume) {
    const up = await uploadResume(env, site.id, resume);
    if ('error' in up) {
      if (up.error !== 'empty') return json({ error: up.error }, 400);
    } else {
      resumePath = up.path;
      resumeFilename = up.filename;
    }
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/website_submissions`, {
    method: 'POST',
    headers: supabaseHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({
      website_id: site.id,
      kind,
      name: (fields.name ?? '').slice(0, 200) || null,
      email: email.slice(0, 320),
      phone: (fields.phone ?? '').slice(0, 40) || null,
      data: fields,
      resume_path: resumePath,
      resume_filename: resumeFilename,
      ip_country: request.headers.get('CF-IPCountry'),
    }),
  });
  if (!res.ok) {
    console.error('submission insert failed', res.status, await res.text());
    return json({ error: 'Could not save your enquiry. Please try again.' }, 500);
  }

  ctx.waitUntil(sendAlert(env, site, kind, fields, !!resumePath));
  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const target = resolve(url, env);
    if (!target) return page('Site not found', 'There is no website at this address.', 404);

    // Path mode needs the trailing slash so relative links resolve inside it.
    if (target.base !== '/' && target.path === '') {
      return Response.redirect(`${url.origin}${target.base}${url.search}`, 301);
    }

    try {
      const site = await loadSite(env, ctx, target.slug, target.host);
      if (!site) return page('Site not found', 'There is no website at this address.', 404);
      if (site.demo_expired) return page('This demo has expired', 'Contact ProfilePush to see it again.', 410);

      const path = target.path.replace(/^\/+/, '/');
      if (path === '/api/submit') {
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        return await handleSubmit(request, env, ctx, site);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);
      if (path === '/robots.txt') {
        return new Response(site.live ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
      }
      // Single-page sites: every other path gets the page itself.
      return await serveSite(site, target.base, env);
    } catch (err) {
      console.error('website-host error', err);
      return page('Something went wrong', 'Please try again in a moment.', 500);
    }
  },
};
