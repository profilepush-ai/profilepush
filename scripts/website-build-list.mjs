#!/usr/bin/env node
// Fills / refreshes Admin > Websites > Build list (table website_build_list):
// every company domain we know, its current website checked, and a priority.
//
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/website-build-list.mjs \
//     [--csv vendors.csv --csv bench-sales.csv] [--checks results.jsonl]
//
// --csv     extra contact lists (columns include "email" and "company")
// --checks  reuse website-check results (JSON lines from a previous run)
//           instead of fetching every site again; missing domains are checked.
// Re-running never touches a row's status or notes.

import { readFileSync, existsSync, appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = name => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'https://nhwqcqzvotgdngtxulwi.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error('Set SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const FREE = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'live.com', 'protonmail.com', 'proton.me', 'ymail.com', 'rediffmail.com', 'msn.com', 'me.com', 'zoho.com', 'mail.com', 'gmx.com', 'yahoo.co.in', 'googlemail.com', 'zohomail.in', 'zohomail.com', 'yandex.com', 'qq.com', '163.com']);
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/;

// 1. Domains from the database, with activity.
const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/website_build_list_sources`, { method: 'POST', headers: H, body: '{}' });
if (!res.ok) { console.error('website_build_list_sources', res.status, await res.text()); process.exit(1); }
const rows = new Map((await res.json()).map(r => [r.domain, { ...r, company: null }]));

// 2. Contact lists.
for (const file of opt('csv')) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const head = lines.shift().split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
  const ei = head.indexOf('email'), ci = head.indexOf('company');
  for (const line of lines) {
    const cells = [...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map(m => (m[1] ?? m[2] ?? '').trim());
    const email = (cells[ei] || '').toLowerCase();
    const d = email.split('@')[1];
    if (!d || !DOMAIN.test(d) || FREE.has(d) || /\.(edu|gov)$/.test(d)) continue;
    const row = rows.get(d) ?? { domain: d, sources: [], hotlist_posts: 0, job_posts: 0, is_user: false, user_persona: null, company: null };
    const tag = /bench/i.test(file) ? 'bench_csv' : 'vendor_csv';
    if (!row.sources.includes(tag)) row.sources.push(tag);
    if (!row.company && cells[ci]) row.company = cells[ci].slice(0, 200);
    rows.set(d, row);
  }
}
console.log('domains', rows.size);

// 3. Website checks (reused where available).
const checks = new Map();
const checksFile = opt('checks')[0];
if (checksFile && existsSync(checksFile)) {
  for (const l of readFileSync(checksFile, 'utf8').split('\n').filter(Boolean)) { const c = JSON.parse(l); checks.set(c.domain, c); }
}
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const KW = /staffing|consultant|bench|c2c|corp[- ]to[- ]corp|recruit|placement|h-?1b|talent|contract[- ]to[- ]hire|it services|it solutions/gi;
async function get(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: ctl.signal });
    const body = (r.headers.get('content-type') || '').includes('html') ? (await r.text()).slice(0, 400000) : '';
    return { status: r.status, url: r.url, body };
  } catch { return { status: 0, url, body: '' }; } finally { clearTimeout(t); }
}
async function check(d) {
  let r = await get(`https://${d}`);
  if (r.status !== 200) { const h = await get(`http://${d}`); if (h.status === 200 || r.status === 0) r = h; }
  const text = r.body.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
  const words = text.split(/\s+/).filter(w => /[a-z]/i.test(w)).length;
  const title = (r.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  let final_host = ''; try { final_host = new URL(r.url).hostname.replace(/^www\./, ''); } catch { /* keep empty */ }
  const parked = /domain (is )?for sale|buy this domain|parked|hugedomains|coming soon|under construction|account suspended|default web page|it works!/i.test(`${title} ${text.slice(0, 2000)}`);
  return { domain: d, status: r.status, final_host, words, title, staffing: (text.match(KW) || []).length, parked };
}
const todo = [...rows.keys()].filter(d => !checks.has(d));
console.log('checking', todo.length, 'sites');
let i = 0;
await Promise.all(Array.from({ length: 32 }, async () => {
  while (i < todo.length) {
    const d = todo[i++]; const c = await check(d); checks.set(d, c);
    if (checksFile) appendFileSync(checksFile, JSON.stringify(c) + '\n');
  }
}));

// 4. Score and save.
const entries = [];
for (const r of rows.values()) {
  const c = checks.get(r.domain) ?? { status: 0, words: 0, title: '', staffing: 0, parked: false, final_host: '' };
  const site_status = c.status !== 200 ? 'dead' : c.parked ? 'parked' : c.words < 150 ? 'thin' : 'ok';
  const benchy = r.hotlist_posts > 0 || r.sources.includes('bench_csv') || r.user_persona === 'bench_sales';
  const vendory = r.job_posts > 0 || r.sources.includes('vendor_csv') || r.sources.includes('social_vendors') || r.user_persona === 'vendor';
  const side = benchy && vendory ? 'both' : benchy ? 'bench' : vendory ? 'vendor' : 'other';
  // Buildable sites first; then signed-up users, bench sales firms, activity,
  // how staffing-focused the site is, and how much content it has.
  const priority = (site_status === 'ok' ? 1000 : site_status === 'thin' ? 150 : 0)
    + (r.is_user ? (r.user_persona === 'bench_sales' ? 700 : 450) : 0)
    + (side === 'bench' ? 300 : side === 'both' ? 220 : 0)
    + Math.min(400, r.hotlist_posts * 8) + Math.min(200, r.job_posts * 2)
    + Math.min(150, c.staffing * 3) + Math.min(50, Math.floor(c.words / 50));
  const title = (c.title || '').replace(/&#?[a-z0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  entries.push({
    domain: r.domain,
    company: r.company || (title ? title.split(/\s[|–—-]\s/)[0].slice(0, 120) : null),
    side, is_user: !!r.is_user, user_persona: r.user_persona ?? null,
    hotlist_posts: Number(r.hotlist_posts) || 0, job_posts: Number(r.job_posts) || 0, sources: r.sources,
    site_status, http_status: c.status || null, final_host: c.final_host || null, words: c.words || 0,
    title: title || null, staffing_score: c.staffing || 0, priority,
    checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
}
for (let k = 0; k < entries.length; k += 500) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/website_build_list?on_conflict=domain`, {
    method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(entries.slice(k, k + 500)),
  });
  if (!r.ok) { console.error('upsert', r.status, await r.text()); process.exit(1); }
}

// 5. Mark domains that already have a demo as built (only if still "todo").
const sitesRes = await fetch(`${SUPABASE_URL}/rest/v1/websites?select=slug`, { headers: H });
const slugs = new Set((await sitesRes.json()).map(s => s.slug));
const builtDomains = entries.map(e => e.domain).filter(d => slugs.has(d.replace(/[^a-z0-9]+/g, '-')));
for (let k = 0; k < builtDomains.length; k += 100) {
  const list = builtDomains.slice(k, k + 100).map(d => `"${d}"`).join(',');
  await fetch(`${SUPABASE_URL}/rest/v1/website_build_list?domain=in.(${list})&status=eq.todo`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'built', updated_at: new Date().toISOString() }),
  });
}
const by = s => entries.filter(e => e.site_status === s).length;
console.log(`saved ${entries.length}: ok ${by('ok')}, thin ${by('thin')}, parked ${by('parked')}, dead ${by('dead')}; marked built ${builtDomains.length}`);
