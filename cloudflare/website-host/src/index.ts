// Website Modernization hosting. Serves every customer site from one Worker:
// demos and live sites at https://site.profilepush.ai/<slug>/ (the slug is
// the firm's domain, e.g. 3sbc-com), and customers' own domains (Cloudflare
// for SaaS custom hostnames that fall back to this Worker).
//
// - Live sites (claimed, plan running) are served as published.
// - Demos and lapsed sites get a banner and noindex; their forms don't
//   accept enquiries.
// - Forms post multipart data to "api/submit" (relative, so it works under
//   /<slug>/ and on a custom domain). Submissions go to website_submissions,
//   résumés to the private website-resumes bucket, and an alert email to the
//   site's notify_emails (or the account's members).
// - Every page gets a small tracker that beacons to "api/collect":
//   pageviews and clicks on calls to action. No cookies; a visitor is a
//   salted daily hash. Demo traffic is stored but kept out of the owner's
//   analytics (the admin page uses it to see which firms opened their demo).
// - A daily cron emails each live site's owners yesterday's numbers.
// - Live portal: every page gets a widget that reads "api/live" and, when
//   there is something to show, opens a drawer of the firm's current
//   ProfilePush job posts and bench consultants. Live Website plan: the
//   account's own posts. Unclaimed demos: a preview from posts sent from
//   the firm's email domain. Otherwise nothing renders.

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  APP_BASE_URL: string;
  SITE_HOST: string;
  SITE_CACHE_SECONDS: string;
  ANALYTICS_SALT: string;
  WORKER_AUTH_TOKEN: string;
  EMAIL_WORKER: Fetcher;
  SUBMIT_LIMITER: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  COLLECT_LIMITER: { limit(opts: { key: string }): Promise<{ success: boolean }> };
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
  showcase: boolean;
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

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

// Which site a request is for, and the path within it. On site.profilepush.ai
// (and workers.dev, for testing) the first path segment is the slug.
function resolve(url: URL, env: Env): { slug: string | null; host: string | null; path: string; base: string } | 'home' | null {
  const host = url.hostname.toLowerCase();
  if (host === env.SITE_HOST || host.endsWith('.workers.dev') || host === 'localhost' || host === '127.0.0.1') {
    const m = url.pathname.match(/^\/([^/]+)(\/.*)?$/);
    if (!m) return 'home';
    const slug = m[1].toLowerCase();
    if (!SLUG.test(slug)) return null;
    return { slug, host: null, path: m[2] ?? '', base: `/${slug}/` };
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
  const btn = (href: string, label: string) => `<a href="${href}" class="ppb-btn">${label}</a>`;
  // Short text always; the longer sentence only where there's room.
  const [short, long, action] = site.showcase && !site.claimed
    ? ['Example website', ' built with ProfilePush', btn(`${env.APP_BASE_URL}/websites`, 'Get yours →')]
    : site.claimed
    ? ['Website paused', '. The plan has ended.', btn(`${env.APP_BASE_URL}/website`, 'Renew →')]
    : [`Demo for ${escapeHtml(site.name)}`, ' · forms are off until claimed', btn(claimUrl, 'Claim this website →')];
  // A compact pill, the same on every template. Sets --pp-banner so a
  // template's own bottom bar can sit above it.
  return `<style>
:root{--pp-banner:64px}
.ppb{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:10px;max-width:calc(100% - 24px);padding:7px 7px 7px 16px;border-radius:999px;background:rgba(15,23,42,.92);color:#fff;font:600 13px/1.3 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.ppb-t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ppb-dot{width:7px;height:7px;border-radius:50%;background:#3b82f6;flex:none;box-shadow:0 0 0 3px rgba(59,130,246,.3)}
.ppb-btn{flex:none;background:#fff;color:#0f172a;border-radius:999px;padding:8px 14px;font-weight:700;text-decoration:none;white-space:nowrap}
@media (max-width:640px){.ppb-long{display:none}.ppb{font-size:12px;bottom:10px}}
</style><div class="ppb" role="region" aria-label="Demo notice"><span class="ppb-dot" aria-hidden="true"></span><span class="ppb-t">${short}<span class="ppb-long">${long}</span></span>${action}</div>`;
}

async function serveSite(site: Site, base: string, env: Env): Promise<Response> {
  let html = site.html;
  // Under site.profilepush.ai the site lives in /<slug>/; a <base> keeps its
  // relative links (api/submit, api/collect) inside that folder.
  if (base !== '/') html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`);
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${TRACKER}${LIVE_WIDGET}</body>`) : html + TRACKER + LIVE_WIDGET;
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

const KINDS = ['candidate', 'consultant', 'employer', 'partner', 'training'] as const;
type Kind = typeof KINDS[number] | 'contact';

// enquiry_type is the goal id (generated sites) or a label (hand-built ones).
function kindOf(enquiryType: string): Kind {
  const t = enquiryType.toLowerCase().trim();
  if ((KINDS as readonly string[]).includes(t)) return t as Kind;
  if (t.startsWith('cand')) return 'candidate';
  if (t.startsWith('partner') || t.startsWith('vendor')) return 'partner';
  if (t.startsWith('employ') || t.startsWith('hir') || t.startsWith('client')) return 'employer';
  if (t.startsWith('consult')) return 'consultant';
  if (t.startsWith('train') || t.startsWith('course')) return 'training';
  return 'contact';
}

const KIND_LABEL: Record<Kind, string> = {
  candidate: 'candidate', consultant: 'consultant program', employer: 'hiring', partner: 'partner', training: 'training', contact: 'contact',
};

// Beacons pageviews and CTA clicks to api/collect. Plain ES5, no cookies.
const TRACKER = `<script>(function(){try{
var u="api/collect";function s(d){var b=JSON.stringify(d);if(navigator.sendBeacon&&navigator.sendBeacon(u,new Blob([b],{type:"application/json"})))return;fetch(u,{method:"POST",body:b,keepalive:true,headers:{"Content-Type":"application/json"}}).catch(function(){})}
window.ppTrack=function(t,l){if(t==="cta")s({t:"cta",l:String(l||"").slice(0,60)})};
s({t:"pageview",p:location.pathname,r:document.referrer});
document.addEventListener("click",function(e){var el=e.target&&e.target.closest&&e.target.closest("[data-path],[data-mode],[data-track]");if(el)s({t:"cta",l:(el.getAttribute("data-path")||el.getAttribute("data-mode")||el.getAttribute("data-track")||"").slice(0,60)})},true);
}catch(e){}})();</script>`;

// Live portal feed, cached at the edge for 10 minutes per site.
async function handleLive(env: Env, ctx: ExecutionContext, site: Site): Promise<Response> {
  const cacheKey = new Request(`https://website-host.internal/live/${site.id}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  let body = hit ? await hit.text() : null;
  if (body === null) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/website_live_feed`, {
      method: 'POST',
      headers: supabaseHeaders(env, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_website_id: site.id }),
    });
    if (!res.ok) {
      console.error('website_live_feed', res.status, await res.text());
      return json({ mode: 'off' });
    }
    body = await res.text();
    ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: { 'Cache-Control': 'max-age=600' } })));
  }
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
}

// The live portal widget: a tab on the right edge that opens a drawer with
// Jobs and Bench lists. Shadow DOM so it looks the same on every template;
// text only via textContent. Renders nothing when the feed is off or empty.
const LIVE_WIDGET = `<script>(function(){try{
var APP="https://profilepush.ai";
fetch("api/live").then(function(r){return r.json()}).then(function(d){
if(!d||d.mode==="off")return;var jobs=d.jobs||[],hot=d.hotlist||[];jobs=uniq(jobs,function(j){return (j.title+"|"+j.location+"|"+j.type).toLowerCase()});if(!jobs.length&&!hot.length)return;
var host=document.createElement("div");host.setAttribute("data-pp-live","");document.body.appendChild(host);
var root=host.attachShadow?host.attachShadow({mode:"open"}):host;
var st=document.createElement("style");st.textContent=${JSON.stringify(`
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.tab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147483646;writing-mode:vertical-rl;background:#0f172a;color:#fff;border:1px solid rgba(255,255,255,.15);border-right:0;border-radius:12px 0 0 12px;padding:14px 9px;font:700 12px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:-6px 8px 30px rgba(0,0,0,.25)}
.tab:hover{padding-right:12px}
.dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:p 2s infinite}
@keyframes p{70%{box-shadow:0 0 0 8px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.scrim{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:2147483646;opacity:0;pointer-events:none;transition:opacity .25s}
.panel{position:fixed;top:0;right:0;height:100%;width:min(440px,100%);background:#fff;color:#0f172a;z-index:2147483647;transform:translateX(100%);transition:transform .3s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;box-shadow:-20px 0 60px rgba(0,0,0,.25)}
.open .scrim{opacity:1;pointer-events:auto}.open .panel{transform:none}
.hd{padding:20px 20px 12px;border-bottom:1px solid #e2e8f0}
.k{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#16a34a}
.h{font-size:20px;font-weight:800;margin:6px 0 2px}
.s{font-size:13px;color:#64748b;margin:0}
.x{position:absolute;top:14px;right:14px;width:36px;height:36px;border-radius:50%;border:1px solid #e2e8f0;background:#fff;font-size:20px;line-height:1;cursor:pointer;color:#334155}
.tabs{display:flex;gap:6px;margin-top:14px}
.tb{flex:1;padding:9px 10px;border-radius:10px;border:1px solid #e2e8f0;background:#f8fafc;font-size:13px;font-weight:700;color:#475569;cursor:pointer}
.tb[aria-selected=true]{background:#0f172a;border-color:#0f172a;color:#fff}
.list{flex:1;overflow:auto;padding:12px 16px 24px;display:flex;flex-direction:column;gap:10px}
.it{display:block;text-decoration:none;color:inherit;border:1px solid #e2e8f0;border-radius:14px;padding:14px;transition:border-color .15s,transform .15s}
.it:hover{border-color:#0f172a;transform:translateY(-1px)}
.t{font-size:15px;font-weight:700;margin:0 0 4px}
.m{font-size:12.5px;color:#64748b;margin:0 0 8px}
.chips{display:flex;flex-wrap:wrap;gap:5px}
.c{font-size:11.5px;font-weight:600;background:#f1f5f9;color:#334155;border-radius:999px;padding:3px 9px}
.ft{padding:12px 16px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#94a3b8;text-align:center}
.ft a{color:#64748b}
@media (prefers-reduced-motion:reduce){.dot{animation:none}.panel,.scrim,.it{transition:none}}
@media (max-width:640px){.tab{padding:12px 7px;font-size:11px}}
`)};root.appendChild(st);
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function ago(s){var d=Math.max(0,Math.round((Date.now()-new Date(s).getTime())/864e5));return d<1?"Today":d<2?"Yesterday":d+" days ago"}
function arr(v){return (Array.isArray(v)?v:(v?[v]:[])).filter(ok)}
function ok(v){return v!=null&&!/^(|unknown|n\\/?a|none|null|-|tbd|not specified)$/i.test(String(v).trim())}
function av(v){return !ok(v)?"":/^(yes|y|true|immediate(ly)?)$/i.test(String(v).trim())?"Available now":/^(no|n|false)$/i.test(String(v).trim())?"":String(v)}
function meta(parts,when){return parts.filter(ok).concat([ago(when)]).join(" · ")}
function chips(title,list){var seen={};seen[String(title).toLowerCase()]=1;return list.filter(function(c){c=String(c).trim();var k=c.toLowerCase();if(!ok(c)||seen[k])return false;seen[k]=1;return true})}
function uniq(a,key){var m={};return a.filter(function(x){var k=key(x);if(m[k])return false;m[k]=1;return true})}
var preview=d.mode==="preview";
var wrap=el("div");root.appendChild(wrap);
var tab=el("button","tab");tab.type="button";tab.setAttribute("aria-label","Open live openings");tab.appendChild(el("span","dot"));tab.appendChild(el("span",null,"Live · "+(jobs.length+hot.length)));wrap.appendChild(tab);
var scrim=el("div","scrim");wrap.appendChild(scrim);
var panel=el("aside","panel");panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");panel.setAttribute("aria-label","Live openings");wrap.appendChild(panel);
var hd=el("div","hd");panel.appendChild(hd);
var k=el("div","k");k.appendChild(el("span","dot"));k.appendChild(el("span",null,preview?"Preview of Live Website":"Live · updated automatically"));hd.appendChild(k);
hd.appendChild(el("p","h","Current openings"));
hd.appendChild(el("p","s","Posted in the last 45 days"));
var x=el("button","x","×");x.type="button";x.setAttribute("aria-label","Close");panel.appendChild(x);
var tabs=el("div","tabs");tabs.setAttribute("role","tablist");hd.appendChild(tabs);
var list=el("div","list");panel.appendChild(list);
var ft=el("div","ft");ft.appendChild(document.createTextNode("Powered by "));var pa=el("a",null,"ProfilePush");pa.href=APP;pa.target="_blank";pa.rel="noopener";ft.appendChild(pa);panel.appendChild(ft);
function item(href,title,meta,chips){var a=el("a","it");a.href=href;a.target="_blank";a.rel="noopener";a.appendChild(el("p","t",title));if(meta)a.appendChild(el("p","m",meta));var c=el("div","chips");chips.filter(Boolean).slice(0,6).forEach(function(s){c.appendChild(el("span","c",String(s)))});a.appendChild(c);return a}
function show(which){list.textContent="";Array.prototype.forEach.call(tabs.children,function(b){b.setAttribute("aria-selected",b.getAttribute("data-k")===which?"true":"false")});
if(which==="jobs")jobs.forEach(function(j){list.appendChild(item(APP+"/job/"+j.id,j.title,meta([j.location,j.type],j.posted_at),chips(j.title,arr(j.skills)).slice(0,4).concat(j.experience?[j.experience+"+ yrs"]:[])))});
else hot.forEach(function(h){list.appendChild(item(APP+"/hotlist/"+h.id,h.title,meta([arr(h.locations).slice(0,2).join(", "),av(h.availability)],h.posted_at),(h.experience?[h.experience+" yrs"]:[]).concat(chips(h.title,arr(h.visa).concat(arr(h.work_type),arr(h.skills))).slice(0,5))))});
list.scrollTop=0}
[["jobs","Jobs",jobs.length],["bench","Bench",hot.length]].forEach(function(t){if(!t[2])return;var b=el("button","tb",t[1]+" ("+t[2]+")");b.type="button";b.setAttribute("role","tab");b.setAttribute("data-k",t[0]);b.onclick=function(){show(t[0])};tabs.appendChild(b)});
function open(){wrap.className="open";show(jobs.length?"jobs":"bench");x.focus();if(window.ppTrack)window.ppTrack("cta","live-portal")}
function close(){wrap.className="";tab.focus()}
tab.onclick=open;scrim.onclick=close;x.onclick=close;document.addEventListener("keydown",function(e){if(e.key==="Escape"&&wrap.className)close()});
}).catch(function(){})}catch(e){}})();</script>`;

function deviceOf(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  return 'desktop';
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function recordEvent(env: Env, request: Request, site: Site, type: 'pageview' | 'cta' | 'submit', fields: { label?: string; path?: string; referrer?: string }): Promise<void> {
  const ua = request.headers.get('User-Agent') ?? '';
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const day = new Date().toISOString().slice(0, 10);
  const visitor = (await sha256Hex(`${env.ANALYTICS_SALT ?? ''}|${day}|${site.id}|${ip}|${ua}`)).slice(0, 32);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/website_events`, {
    method: 'POST',
    headers: supabaseHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({
      website_id: site.id,
      type,
      label: fields.label?.slice(0, 60) || null,
      path: fields.path?.slice(0, 200) || null,
      referrer: fields.referrer?.slice(0, 200) || null,
      country: (request.headers.get('CF-IPCountry') ?? '').slice(0, 2) || null,
      device: deviceOf(ua),
      visitor,
      is_demo: !site.live,
    }),
  });
  if (!res.ok) console.error('event insert failed', res.status, await res.text());
}

async function handleCollect(request: Request, env: Env, ctx: ExecutionContext, site: Site): Promise<Response> {
  const ok = new Response(null, { status: 204 });
  const ua = request.headers.get('User-Agent') ?? '';
  if (/bot|crawl|spider|slurp|preview|headless/i.test(ua)) return ok;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await env.COLLECT_LIMITER.limit({ key: `${site.id}:${ip}` });
  if (!success) return ok;
  const text = await request.text();
  if (text.length > 2048) return ok;
  let body: { t?: string; l?: string; p?: string; r?: string };
  try { body = JSON.parse(text); } catch { return ok; }
  if (body.t !== 'pageview' && body.t !== 'cta') return ok;
  let referrer = '';
  try {
    const host = body.r ? new URL(body.r).hostname.replace(/^www\./, '') : '';
    const own = new URL(request.url).hostname.replace(/^www\./, '');
    referrer = host && host !== own ? host : '';
  } catch { /* not a URL: treat as direct */ }
  ctx.waitUntil(recordEvent(env, request, site, body.t, { label: body.l, path: body.p, referrer }));
  return ok;
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
  const label = KIND_LABEL[kind as Kind] ?? 'contact';
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
  ctx.waitUntil(recordEvent(env, request, site, 'submit', { label: kind }));
  return json({ ok: true });
}

type DailyReport = {
  website_id: string;
  name: string;
  recipients: string[];
  report: {
    date: string;
    visitors: number;
    pageviews: number;
    cta_clicks: number;
    enquiries: Record<string, number>;
    referrers: { name: string; count: number }[];
  };
};

// Yesterday's numbers for each live site, to its owners. Sites with no
// visits and no enquiries get no email.
async function sendDailyReports(env: Env): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/website_daily_reports`, {
    method: 'POST',
    headers: supabaseHeaders(env, { 'Content-Type': 'application/json' }),
    body: '{}',
  });
  if (!res.ok) throw new Error(`website_daily_reports ${res.status}: ${await res.text()}`);
  const rows = await res.json<DailyReport[]>();
  for (const row of rows) {
    const r = row.report;
    const enquiries = Object.values(r.enquiries ?? {}).reduce((a, b) => a + b, 0);
    if (!r.visitors && !enquiries) continue;
    const recipients = (row.recipients ?? []).filter(e => /^\S+@\S+\.\S+$/.test(e)).slice(0, 10);
    if (!recipients.length) continue;
    const stat = (n: number, l: string) => `<td style="padding:14px 16px;background:#f5f7fb;border-radius:12px;text-align:center"><div style="font-size:24px;font-weight:800;color:#0f172a">${n}</div><div style="font-size:12px;color:#64748b">${l}</div></td>`;
    const byKind = Object.entries(r.enquiries ?? {}).map(([k, n]) => `${n} ${escapeHtml(KIND_LABEL[k as Kind] ?? k)}`).join(', ');
    const sources = (r.referrers ?? []).map(x => `<li>${escapeHtml(x.name)}: ${x.count}</li>`).join('');
    const html = `<div style="font:15px/1.6 system-ui,sans-serif;color:#0f172a;max-width:560px">
<p style="margin:0;color:#64748b">${escapeHtml(row.name)} website · ${escapeHtml(r.date)}</p>
<h2 style="margin:4px 0 18px;font-size:20px">Yesterday on your website</h2>
<table style="border-collapse:separate;border-spacing:8px;margin:0 -8px"><tr>${stat(r.visitors, 'Visitors')}${stat(r.pageviews, 'Page views')}${stat(r.cta_clicks, 'Button clicks')}${stat(enquiries, 'Enquiries')}</tr></table>
${byKind ? `<p style="margin:16px 0 0">Enquiries: ${byKind}.</p>` : ''}
${sources ? `<p style="margin:16px 0 4px;font-weight:700">Where visitors came from</p><ul style="margin:0;padding-left:20px">${sources}</ul>` : ''}
<p style="margin:24px 0 0"><a href="${env.APP_BASE_URL}/website" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:10px">Open your dashboard</a></p>
<p style="margin:20px 0 0;font-size:12px;color:#94a3b8">You can turn this email off in ProfilePush → Website → Notifications.</p>
</div>`;
    const text = `${row.name} website, ${r.date}\nVisitors: ${r.visitors}\nPage views: ${r.pageviews}\nButton clicks: ${r.cta_clicks}\nEnquiries: ${enquiries}${byKind ? ` (${byKind})` : ''}\n\n${env.APP_BASE_URL}/website`;
    await Promise.all(recipients.map(to => env.EMAIL_WORKER.fetch('https://email-worker/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.WORKER_AUTH_TOKEN}` },
      body: JSON.stringify({ to, subject: `${row.name} website: ${r.visitors} visitors, ${enquiries} enquiries yesterday`, html, text, category: 'website_daily_report' }),
    }).catch(err => console.error('daily report send failed', err))));
  }
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sendDailyReports(env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const target = resolve(url, env);
    if (target === 'home') return Response.redirect(`${env.APP_BASE_URL}/websites`, 302);
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
      if (path === '/api/collect') {
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        return await handleCollect(request, env, ctx, site);
      }
      if (path === '/api/submit') {
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        return await handleSubmit(request, env, ctx, site);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);
      if (path === '/api/live') return await handleLive(env, ctx, site);
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
