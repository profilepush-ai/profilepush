#!/usr/bin/env node
// Publishes a Website Modernization site (creates the demo, or updates its
// HTML) and prints its demo and claim links.
//
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/website-publish.mjs \
//     --file "/path/to/index.html" --name "Cerf IT" --slug cerfits \
//     --source-url https://www.cerfits.com --claim-domain cerfits.com \
//     [--claim-email venkat.m@cerfits.com] [--demo-request <uuid>]
//
// A new site gets a random suffix on its slug (cerfits-x7k2) so demo links
// can't be guessed. Re-running with the full slug (--slug cerfits-x7k2)
// updates that site's HTML and leaves everything else as is.

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]]);
    return acc;
  }, []),
);

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'https://nhwqcqzvotgdngtxulwi.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_BASE = process.env.WEBSITE_HOST_URL ?? 'https://profilepush-website-host.profilepush-ai.workers.dev';
const SITES_DOMAIN = process.env.SITES_DOMAIN ?? '';
const APP_BASE = 'https://profilepush.ai';

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

if (!KEY) fail('Set SUPABASE_SERVICE_ROLE_KEY.');
if (!args.file || !args.slug) fail('--file and --slug are required (and --name for a new site).');

const html = readFileSync(args.file, 'utf8');
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const body = await res.text();
  if (!res.ok) fail(`${init.method ?? 'GET'} ${path} → ${res.status} ${body}`);
  return body ? JSON.parse(body) : null;
}

const slug = String(args.slug).toLowerCase();
const [existing] = await rest(`websites?slug=eq.${encodeURIComponent(slug)}&select=id,slug,claim_token`);

let site;
if (existing) {
  [site] = await rest(`websites?id=eq.${existing.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ html, updated_at: new Date().toISOString() }),
  });
  console.log(`Updated ${site.slug}.`);
} else {
  if (!args.name) fail('--name is required for a new site.');
  const newSlug = `${slug}-${randomBytes(3).toString('hex').slice(0, 4)}`;
  [site] = await rest('websites', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      slug: newSlug,
      name: args.name,
      html,
      source_url: args['source-url'] ?? null,
      claim_domain: args['claim-domain']?.toLowerCase() ?? null,
      claim_emails: args['claim-email'] ? String(args['claim-email']).toLowerCase().split(',').map(s => s.trim()) : [],
      demo_request_id: args['demo-request'] ?? null,
    }),
  });
  console.log(`Created ${site.slug}.`);
}

const demoUrl = SITES_DOMAIN ? `https://${site.slug}.${SITES_DOMAIN}/` : `${WORKER_BASE}/s/${site.slug}/`;
console.log(`Demo:  ${demoUrl}`);
console.log(`Claim: ${APP_BASE}/claim/${site.claim_token}`);
