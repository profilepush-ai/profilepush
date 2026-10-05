// Demo generator: reads a firm's current website and writes SiteContent for
// a template, using only what the site says. Called by admin-websites.
//
// Writing runs on Claude Fable 5.1 (Anthropic's most capable model). The
// JSON shape is given in the system prompt and the reply is parsed and
// checked here: the full schema is too large for strict structured outputs
// (the API rejects its compiled grammar).

import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { GOAL_IDS } from './goals.ts';
import type { SiteContent } from './render.ts';

const MODEL = 'claude-fable-5-1';
const UA = 'Mozilla/5.0 (compatible; ProfilePushSiteReader/1.0; +https://profilepush.ai/websites)';
const PAGE_KEYWORDS = /about|who|what|service|solution|career|job|candidate|employer|client|training|course|process|why|industr|contact|partner|vendor/i;

export type Crawl = {
  url: string;
  host: string;
  pages: { url: string; title: string; text: string }[];
  colors: string[];
  emails: string[];
  phones: string[];
};

// Only public web hosts: this runs server side, so refuse anything that
// could reach internal addresses.
export function assertPublicUrl(raw: string): URL {
  const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) websites.');
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') ||
      /^(\d+\.){3}\d+$/.test(h) || h.includes(':')) {
    throw new Error('Enter the public website address, like example.com.');
  }
  return u;
}

async function fetchPage(url: string): Promise<{ url: string; html: string } | null> {
  const tries = [url];
  // Plenty of old sites only answer on plain http (or only on https).
  if (url.startsWith('https://')) tries.push(url.replace('https://', 'http://'));
  for (const u of tries) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('html')) continue;
      const html = (await res.text()).slice(0, 600_000);
      return { url: res.url || u, html };
    } catch { /* try the next scheme */ }
  }
  return null;
}

const decode = (s: string) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function pageText(html: string): { title: string; text: string } {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim());
  const body = html
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const lines = decode(body).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 2);
  // Drop lines repeated across the page (menus, footers).
  const seen = new Set<string>();
  const kept = lines.filter(l => (seen.has(l) ? false : (seen.add(l), true)));
  return { title, text: kept.join('\n').slice(0, 7000) };
}

function sameSiteLinks(html: string, base: URL): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
      if (/\.(pdf|jpe?g|png|gif|svg|css|js|zip|docx?|xml)$/i.test(u.pathname)) continue;
      if (/login|logout|admin|wp-|cart|privacy|terms/i.test(u.pathname)) continue;
      u.hash = '';
      out.add(u.toString());
    } catch { /* ignore */ }
  }
  return [...out];
}

function hexColors(css: string): string[] {
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    // Skip greys, near-white and near-black: we want the brand colours.
    if (max - min < 40 || max < 50 || min > 225) continue;
    counts.set(`#${h}`, (counts.get(`#${h}`) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 6);
}

export async function crawlSite(rawUrl: string, maxPages = 12): Promise<Crawl> {
  const start = assertPublicUrl(rawUrl);
  const home = await fetchPage(start.toString());
  if (!home) throw new Error(`Could not load ${start.hostname}. Check the address.`);
  const base = new URL(home.url);

  // Two levels: many old sites open on a splash page that links to the real
  // home page, so follow the links found on the first pages too.
  const seen = new Set([home.url, start.toString()]);
  const rank = (links: string[]) => links
    .filter(l => !seen.has(l))
    .sort((a, b) => Number(PAGE_KEYWORDS.test(b)) - Number(PAGE_KEYWORDS.test(a)));
  const all = [home];
  let frontier = [home];
  for (let depth = 0; depth < 2 && all.length < maxPages; depth++) {
    const next = rank([...new Set(frontier.flatMap(p => sameSiteLinks(p.html, base)))]).slice(0, maxPages - all.length);
    next.forEach(l => seen.add(l));
    frontier = (await Promise.all(next.map(fetchPage))).filter((p): p is { url: string; html: string } => !!p);
    all.push(...frontier);
  }

  // Colours: theme-color, inline styles and the first couple of stylesheets.
  let css = all.map(p => (p.html.match(/<style[\s\S]*?<\/style>|style="[^"]*"/gi) ?? []).join(' ')).join(' ');
  const theme = home.html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)/i)?.[1];
  const sheets = [...home.html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)/gi)]
    .map(m => { try { return new URL(m[1], base).toString(); } catch { return ''; } })
    .filter(u => u && !/bootstrap|font-awesome|fonts\.googleapis|cdn/i.test(u))
    .slice(0, 2);
  for (const s of sheets) {
    try {
      const r = await fetch(s, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (r.ok) css += ' ' + (await r.text()).slice(0, 300_000);
    } catch { /* ignore */ }
  }
  const colors = [...new Set([...(theme && /^#[0-9a-f]{6}$/i.test(theme) ? [theme.toLowerCase()] : []), ...hexColors(css)])];

  const pages = all.map(p => ({ url: p.url, ...pageText(p.html) }));
  const allText = pages.map(p => p.text).join('\n') + ' ' + all.map(p => p.html.match(/mailto:[^"']+/gi)?.join(' ') ?? '').join(' ');
  const emails = [...new Set((allText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/gi) ?? []).map(e => e.toLowerCase()))].slice(0, 5);
  const phones = [...new Set(allText.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g) ?? [])].slice(0, 3);

  return { url: home.url, host: base.hostname.replace(/^www\./, ''), pages, colors, emails, phones };
}

// The JSON shape Claude must return: every key present (empty string /
// empty array when the site doesn't say). Sent as text in the system prompt.
const str = { type: 'string' };
const obj = (props: Record<string, unknown>) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
const arr = (items: unknown) => ({ type: 'array', items });
const titleText = obj({ title: str, text: str });

const SCHEMA = obj({
  company_name: str,
  legal_name: str,
  logo_text: str,
  theme: obj({ primary: str, secondary: str }),
  seo: obj({ title: str, description: str }),
  hero: obj({ eyebrow: str, title: str, sub: str }),
  goals_title: str,
  goals: arr(obj({
    id: { type: 'string', enum: GOAL_IDS },
    audience: str, cta: str, card_title: str, card_text: str,
    section_title: str, section_text: str, points: arr(titleText),
  })),
  highlights: arr(obj({ value: str, label: str })),
  about: titleText,
  nav_services_label: str,
  services_title: str,
  services_intro: str,
  services: arr(titleText),
  industries_title: str,
  industries: arr(obj({ name: str })),
  process_title: str,
  process: arr(titleText),
  testimonials_title: str,
  testimonials: arr(obj({ quote: str, name: str, role: str })),
  faq: arr(obj({ q: str, a: str })),
  enquire: obj({ eyebrow: str, title: str, text: str }),
  skill_options: arr(str),
  course_options: arr(str),
  contact: obj({ email: str, phone: str, address: str }),
  badges: arr(str),
  footer_blurb: str,
});

const FIELD_GUIDE = `Field guide:
- company_name as the site writes it; legal_name only if shown (else ""); logo_text = short brand name for the logo (e.g. "3SBC").
- theme.primary / theme.secondary: "#rrggbb", chosen from the colours found on the site.
- seo.title ≤ 60 chars, seo.description ≤ 155 chars.
- hero: eyebrow ≤ 40 chars, title ≤ 60 chars and punchy, sub ≤ 220 chars.
- goals: 2 or 3, most important first. audience = 1–2 words ("Consultants"), cta = 2–4 words ("Hire talent"), card_text ≤ 110, section_text ≤ 260, 3–4 points each (text ≤ 110).
- highlights: 0–4, only facts stated on the site.
- about.text ≤ 500 chars. nav_services_label: "Services" or "Solutions".
- services: 3–9 (text ≤ 140). industries: 0–10. process: 0–6 steps (text ≤ 140).
- testimonials: 0–4 verbatim excerpts (≤ 240 chars) with the name shown on the site; role "" if not shown.
- faq: 3–6, answered only from site facts.
- skill_options: 6–14 technologies/skills the site mentions. course_options: only if the site sells training, else [].
- contact: from the site; "" when missing. badges: certifications stated on the site (E-Verify, MBE, ISO…), else [].
- footer_blurb ≤ 160 chars.`;

const RULES = `You are rewriting a staffing / IT services firm's existing website into the content for a modern single-page site.

Goals you can choose (pick the 2–3 that match what this business actually earns from):
- candidate: job seekers applying for roles the firm fills
- consultant: people joining a consultant / bench / training-to-placement program (marketing, visa sponsorship, projects)
- employer: companies that want to hire through the firm
- partner: vendors, subvendors, implementation partners
- training: people enquiring about courses the firm sells

Hard rules:
- Use ONLY facts found in the website text below. Rewrite for clarity and modern tone, but never invent clients, numbers, awards, certifications, locations, years, people or quotes.
- If the site doesn't state something, leave it out (empty array or omit). Don't pad.
- Drop filler such as encyclopedia-style technology descriptions, broken placeholders ("content need to be added"), and outdated dated news.
- Testimonials must be verbatim excerpts with the name shown on the site.
- Plain, confident, specific language. No hype words like "cutting-edge", "world-class", "synergy".
- theme colours must come from the colour list provided; primary = the strongest brand colour.
- Fill every field of the schema; use "" or [] where the site says nothing.
- Reply with the JSON object only: no code fences, no text before or after it.`;

async function generateOnce(crawl: Crawl, apiKey: string): Promise<SiteContent> {
  const client = new Anthropic({ apiKey });
  const source = crawl.pages.map(p => `### ${p.title || p.url}\nURL: ${p.url}\n${p.text}`).join('\n\n');
  const userText = `Website: ${crawl.url}
Colours found (most used first): ${crawl.colors.join(', ') || 'none — choose a calm blue and a complementary accent'}
Emails found: ${crawl.emails.join(', ') || 'none'}
Phones found: ${crawl.phones.join(', ') || 'none'}

Website text:
${source}`;

  // Streaming keeps a long generation clear of HTTP timeouts. fallbacks:
  // "default" re-runs the request on Anthropic's recommended model if Fable
  // declines it.
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high' },
    system: `${RULES}\n\nJSON schema of the reply:\n${JSON.stringify(SCHEMA)}\n\n${FIELD_GUIDE}`,
    messages: [{ role: 'user', content: userText }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') throw new Error('Claude declined to write this site. Try again or check the source website.');
  if (message.stop_reason === 'max_tokens') throw new Error('The generated content was cut off. Try again.');
  const text = message.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  let content: SiteContent;
  try {
    // Tolerate a stray code fence or a sentence around the object.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    content = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text) as SiteContent;
  } catch {
    throw new Error('Claude returned content that could not be read. Try again.');
  }
  content.goals = (content.goals ?? []).filter(g => (GOAL_IDS as string[]).includes(g.id)).slice(0, 3);
  if (!content.company_name || !content.hero?.title || content.goals.length === 0) {
    throw new Error('The generated content was incomplete. Try again.');
  }
  return content;
}

// One retry: the reply is occasionally not valid JSON.
export async function generateContent(crawl: Crawl, apiKey: string): Promise<SiteContent> {
  try {
    return await generateOnce(crawl, apiKey);
  } catch (err) {
    if (err instanceof Error && /declined|cut off/.test(err.message)) throw err;
    return await generateOnce(crawl, apiKey);
  }
}

// Demo address slug from the firm's domain: 3sbc.com → 3sbc-com.
export function slugForHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'site';
}
