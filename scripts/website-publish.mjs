#!/usr/bin/env node
// Publishes a Website Modernization site and prints its demo and claim links.
// Demos live at https://site.profilepush.ai/<slug>/, where the slug is the
// firm's domain (3sbc.com → 3sbc-com).
//
// A hand-built page:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/website-publish.mjs \
//     --file "/path/to/index.html" --name "Cerf IT" --source-url https://www.cerfits.com [--showcase]
//
// Generated content in a template (meridian | atlas):
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/website-publish.mjs \
//     --content 3sbc-com.json --template atlas --source-url http://www.3sbc.com
//
// Optional: --slug <slug> (default from --source-url), --claim-email a@x.com,b@y.com,
// --showcase (feature as an example on profilepush.ai/websites).
// Re-running for the same slug updates the page and keeps everything else.

import { readFileSync } from 'node:fs';
import { renderSite } from '../supabase/functions/_shared/website-templates/render.ts';

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const next = argv[i + 1];
  args[argv[i].slice(2)] = next && !next.startsWith('--') ? (i++, next) : 'true';
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'https://nhwqcqzvotgdngtxulwi.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_BASE = 'https://site.profilepush.ai';
const APP_BASE = 'https://profilepush.ai';

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

if (!KEY) fail('Set SUPABASE_SERVICE_ROLE_KEY.');
if (!args.file && !args.content) fail('Pass --file <page.html>, or --content <content.json> with --template.');

const host = args['source-url'] ? new URL(/^https?:\/\//.test(args['source-url']) ? args['source-url'] : `https://${args['source-url']}`).hostname.replace(/^www\./, '') : null;
const slug = (args.slug ?? (host ? host.replace(/[^a-z0-9]+/gi, '-') : '')).toLowerCase().replace(/^-+|-+$/g, '');
if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) fail('Pass --source-url (or --slug) so the site gets an address.');

let html, content = null, template = null, name = args.name;
if (args.content) {
  content = JSON.parse(readFileSync(args.content, 'utf8'));
  template = args.template ?? 'meridian';
  html = renderSite(template, content);
  name ??= content.company_name;
} else {
  html = readFileSync(args.file, 'utf8');
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const body = await res.text();
  if (!res.ok) fail(`${init.method ?? 'GET'} ${path} → ${res.status} ${body}`);
  return body ? JSON.parse(body) : null;
}

const [existing] = await rest(`websites?slug=eq.${encodeURIComponent(slug)}&select=id`);
const fields = { html, template, content, updated_at: new Date().toISOString() };
if (args.showcase) fields.showcase = args.showcase !== 'false';

let site;
if (existing) {
  [site] = await rest(`websites?id=eq.${existing.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(fields) });
  console.log(`Updated ${site.slug}.`);
} else {
  if (!name) fail('--name is required for a new hand-built site.');
  [site] = await rest('websites', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      ...fields,
      slug,
      name,
      source_url: args['source-url'] ?? null,
      claim_domain: host,
      claim_emails: args['claim-email'] ? String(args['claim-email']).toLowerCase().split(',').map(s => s.trim()).filter(Boolean) : [],
    }),
  });
  console.log(`Created ${site.slug}.`);
}

console.log(`Site:  ${SITE_BASE}/${site.slug}/`);
if (!site.account_id) console.log(`Claim: ${APP_BASE}/claim/${site.claim_token}`);
