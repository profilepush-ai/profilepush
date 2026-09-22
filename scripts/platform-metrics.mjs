// Platform engagement report, straight from the admin-stats function.
//
//   node scripts/platform-metrics.mjs                    last 30 days
//   node scripts/platform-metrics.mjs --since 2026-09-20 also split before/after that date
//   node scripts/platform-metrics.mjs --days 7 --json    raw rows for ad-hoc analysis
//
// Credentials come from .env.local, which is gitignored — nothing secret is
// typed into a terminal, pasted into a chat, or committed. Add one line:
//
//   ADMIN_STATS_PASSWORD=<the admin dashboard password>
//
// admin-stats is read-only and returns one aggregated row per account, so this
// never touches production data and cannot write anything.
import { readFileSync } from 'node:fs';

const readEnv = (file) => {
  const out = {};
  try {
    for (const line of readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* file is optional */ }
  return out;
};

const env = { ...readEnv('.env.local'), ...readEnv('.dev.vars'), ...process.env };
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
const PASSWORD = env.ADMIN_STATS_PASSWORD;

if (!PASSWORD) {
  console.error('Missing ADMIN_STATS_PASSWORD.\nAdd it to .env.local (gitignored):\n\n  ADMIN_STATS_PASSWORD=<admin dashboard password>\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const days = Number(argOf('--days') ?? 30);
const since = argOf('--since');
const asJson = args.includes('--json');

const iso = (d) => new Date(d).toISOString();
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

const fetchWindow = async (startDate) => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-stats`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANON}`,
      apikey: ANON,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: PASSWORD, start_date: startDate }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`admin-stats ${res.status}: ${body.error ?? ''}`);
  return body.stats ?? [];
};

const windowStart = iso(Date.now() - days * 86_400_000);
const all = await fetchWindow(windowStart);

if (asJson) {
  console.log(JSON.stringify(all, null, 2));
  process.exit(0);
}

const sum = (rows, key) => rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);
const any = (rows, key) => rows.filter((r) => (Number(r[key]) || 0) > 0).length;
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');

// ── signups ───────────────────────────────────────────────────────────────
const newAccounts = all.filter((r) => r.created_at >= windowStart);
const byDay = {};
for (const r of newAccounts) byDay[dayKey(r.created_at)] = (byDay[dayKey(r.created_at)] || 0) + 1;

console.log(`\n=== Signups, last ${days} days ===`);
console.log(`total: ${newAccounts.length}   (platform total: ${all.length})`);
const dayKeys = Object.keys(byDay).sort();
const peak = Math.max(1, ...Object.values(byDay));
for (const d of dayKeys) {
  console.log(`  ${d}  ${String(byDay[d]).padStart(3)}  ${'█'.repeat(Math.round((byDay[d] / peak) * 40))}`);
}

// ── engagement ────────────────────────────────────────────────────────────
const report = (label, rows) => {
  if (!rows.length) return console.log(`\n${label}: no accounts`);
  console.log(`\n=== ${label} (${rows.length} accounts) ===`);
  const table = [
    ['signed in at all', any(rows, 'session_count'), sum(rows, 'session_count')],
    ['active 2+ days', rows.filter((r) => (r.active_days || 0) >= 2).length, sum(rows, 'active_days')],
    ['ran AI Match', any(rows, 'ai_match_runs_count'), sum(rows, 'ai_match_runs_count')],
    ['posted (jobs)', any(rows, 'job_posts_count'), sum(rows, 'job_posts_count')],
    ['posted (hotlist)', any(rows, 'hotlist_posts_count'), sum(rows, 'hotlist_posts_count')],
    ['previewed a post', any(rows, 'job_previews_count') + any(rows, 'hotlist_previews_count'), sum(rows, 'job_previews_count') + sum(rows, 'hotlist_previews_count')],
    ['used AI pitch/request', any(rows, 'ai_pitches_count') + any(rows, 'ai_requests_count'), sum(rows, 'ai_pitches_count') + sum(rows, 'ai_requests_count')],
    ['chatted', any(rows, 'chats_count'), sum(rows, 'chats_count')],
    ['downloaded a list', any(rows, 'vendor_downloads_count') + any(rows, 'recruiter_downloads_count'), sum(rows, 'vendor_downloads_count') + sum(rows, 'recruiter_downloads_count')],
    ['connected Gmail', rows.filter((r) => r.gmail_connected).length, null],
  ];
  console.log('  action                    accounts   share    events');
  for (const [name, accts, events] of table) {
    console.log(`  ${name.padEnd(24)} ${String(accts).padStart(6)}  ${pct(accts, rows.length).padStart(6)}  ${events === null ? '' : String(events).padStart(7)}`);
  }
  const mins = Math.round(sum(rows, 'active_seconds') / 60);
  console.log(`  total active time: ${mins} min across ${sum(rows, 'session_count')} sessions`);
};

report(`All accounts active in last ${days} days`, all);
report(`Accounts created in last ${days} days`, newAccounts);

// ── AI Match cut ──────────────────────────────────────────────────────────
if (since) {
  const cutoff = iso(since);
  const before = all.filter((r) => r.created_at < cutoff);
  const after = all.filter((r) => r.created_at >= cutoff);
  console.log(`\n\n######## Split at ${dayKey(cutoff)} ########`);
  report(`Signed up BEFORE ${dayKey(cutoff)}`, before);
  report(`Signed up ON/AFTER ${dayKey(cutoff)}`, after);
}

const matchers = all.filter((r) => (r.ai_match_runs_count || 0) > 0);
const nonMatchers = all.filter((r) => !(r.ai_match_runs_count || 0));
console.log('\n\n######## Did AI Match pull people deeper in? ########');
report('Accounts that ran AI Match', matchers);
report('Accounts that did not', nonMatchers);

if (matchers.length) {
  console.log(`\nAI Match totals: ${sum(matchers, 'ai_match_runs_count')} runs, ${sum(matchers, 'ai_match_matches_count')} matches charged, across ${matchers.length} accounts`);
  console.log('NOTE: runs are counted from the credit ledger. Runs that charged but');
  console.log('failed to post, and runs refunded by the old first-post bonus, distort');
  console.log('this number — treat it as approximate until those are reconciled.');
}
console.log('');
