import { Budget } from "./http";
import type { Adapter, CareerJob, ListingItem } from "./types";
import { teksystems } from "./adapters/teksystems";
import { judge } from "./adapters/judge";
import { apex } from "./adapters/apex";
import { kforce } from "./adapters/kforce";
import { randstad } from "./adapters/randstad";
import { insightglobal } from "./adapters/insightglobal";
import { pyramid } from "./adapters/pyramid";
import { diverselynx, mindlance } from "./adapters/jobdiva";
import { buildAdapter, type SiteConfig } from "./adapters/generic";

interface Env {
  SUPABASE_URL: string;
  CAREER_SITES_SECRET: string;
  RUN_TOKEN?: string;
  ENABLED_PRIMES: string;
  FULL_SYNC_HOUR_UTC: string;
  MAX_NEW_PER_RUN: string;
  SCRAPE_QUEUE: Queue<ScrapeMessage>;
  // Job board API keys (wrangler secret put); a board without its key fails its run.
  ADZUNA_APP_ID?: string;
  ADZUNA_APP_KEY?: string;
  JOOBLE_API_KEY?: string;
}

type Site = SiteConfig & { name?: string; max_new_per_run?: number; enabled?: boolean };
type ScrapeMessage = { prime: string; full: boolean; site?: Site };

const ADAPTERS: Record<string, Adapter> = { teksystems, judge, apex, kforce, randstad, insightglobal, pyramid, diverselynx, mindlance };
// Outbound fetches to job sites per invocation (one prime per invocation);
// the calls to Supabase come on top, inside the platform limit of 1,000.
const SUBREQUEST_BUDGET = 650;
const UPSERT_BATCH = 4;

async function callReceiver(env: Env, body: unknown) {
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/receive-career-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.CAREER_SITES_SECRET}` },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error(`receive-career-jobs ${res.status}: ${JSON.stringify(payload).slice(0, 200)}`);
  return payload;
}

// The sites to scrape come from career_sites (managed in /admin). If that
// lookup fails, the built-in list keeps the hourly run going.
async function loadSites(env: Env, includeDisabled = false): Promise<Site[]> {
  try {
    const r = await callReceiver(env, { action: "sites", includeDisabled }) as { sites?: Site[] };
    if (Array.isArray(r.sites)) return r.sites;
  } catch (error) {
    console.error(`sites lookup failed: ${(error as Error).message}`);
  }
  return env.ENABLED_PRIMES.split(",").map((s) => s.trim()).filter((s) => ADAPTERS[s])
    .map((slug) => ({ slug, kind: "builtin", config: {} }));
}

export async function runPrime(env: Env, site: Site, full: boolean) {
  const slug = site.slug;
  const adapter = buildAdapter(site, ADAPTERS, env);
  const budget = new Budget(SUBREQUEST_BUDGET);
  const maxNew = site.max_new_per_run || Number(env.MAX_NEW_PER_RUN) || 60;
  const wantsFull = full || adapter.alwaysComplete;

  const allIds: string[] = [];
  let nonItFound = 0;
  const titleOf = (i: ListingItem) => i.title || i.job?.title;
  // IT roles are loaded first; Non-IT roles (also kept) fill the rest of the
  // per-run cap, so the IT backlog is never held up by them.
  const nonItQueue: ListingItem[] = [];
  const triage = async (items: ListingItem[]): Promise<ListingItem[]> => {
    const titled = items.filter(titleOf);
    if (titled.length === 0) return items;
    const nonIt = new Set<string>();
    for (let i = 0; i < titled.length; i += 300) {
      const chunk = titled.slice(i, i + 300);
      const r = await callReceiver(env, { action: "triage", prime: slug, items: chunk.map((x) => ({ id: x.id, url: x.url, title: titleOf(x) })) }) as { nonIt?: string[] };
      for (const id of r.nonIt ?? []) nonIt.add(id);
    }
    nonItFound += nonIt.size;
    nonItQueue.push(...items.filter((i) => nonIt.has(i.id)));
    return items.filter((i) => !nonIt.has(i.id));
  };
  const pending: ListingItem[] = [];
  let listingFinished = false;
  let partial = false;
  let closed = 0;
  let listingError: string | null = null;

  try {
    const pages = adapter.list(budget, wantsFull);
    for (;;) {
      const next = await pages.next();
      if (next.done) { listingFinished = true; break; }
      const items = next.value.items;
      partial ||= Boolean(next.value.partial);
      allIds.push(...items.map((i) => i.id));
      if (adapter.alwaysComplete) { pending.push(...items); continue; }
      const { unknown, known } = await callReceiver(env, { action: "sync", prime: slug, ids: items.map((i) => i.id), complete: false }) as { unknown: string[]; known: number };
      const isNew = new Set(unknown);
      pending.push(...await triage(items.filter((i) => isNew.has(i.id))));
      if (wantsFull) continue;
      // Newest first: once the backlog is loaded, a page with nothing new means
      // the rest is known. While it is still loading (we know well under the
      // site's total), keep paging until there are enough new candidates.
      const total = next.value.total ?? 0;
      const backfilling = total > 0 && known < 0.9 * total;
      if (!backfilling && unknown.length === 0) break;
      if (backfilling && pending.length + nonItQueue.length >= maxNew) break;
    }
  } catch (error) {
    listingError = (error as Error).message;
    console.error(`[${slug}] listing stopped: ${listingError}`);
  }

  let toProcess = pending;
  if (adapter.alwaysComplete || (wantsFull && listingFinished)) {
    const res = await callReceiver(env, { action: "sync", prime: slug, ids: allIds, complete: listingFinished && !partial }) as { unknown: string[]; closed: number };
    closed = res.closed ?? 0;
    if (adapter.alwaysComplete) {
      const isNew = new Set(res.unknown);
      toProcess = await triage(pending.filter((i) => isNew.has(i.id)));
    }
  }

  // A listing can show the same job twice while it is being paged.
  const seenIds = new Set<string>();
  toProcess = [...toProcess, ...nonItQueue].filter((i) => !seenIds.has(i.id) && Boolean(seenIds.add(i.id)));

  const batch: CareerJob[] = [];
  let accepted = 0, rejected = 0, fetched = 0, failed = 0;
  // Up to three batches are parsed at once: parsing is most of a run's time.
  const inFlight: Promise<void>[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const jobs = batch.splice(0);
    const p = (async () => {
      const r = await callReceiver(env, { action: "upsert", prime: slug, jobs }) as { accepted: number; rejected: number };
      accepted += r.accepted ?? 0;
      rejected += r.rejected ?? 0;
    })();
    inFlight.push(p);
    p.finally(() => inFlight.splice(inFlight.indexOf(p), 1)).catch(() => {});
    if (inFlight.length >= 3) await Promise.race(inFlight);
  };
  for (const item of toProcess.slice(0, maxNew)) {
    let job = item.job ?? null;
    if (!job && adapter.detail) {
      try {
        job = await adapter.detail(item, budget);
        fetched++;
      } catch (error) {
        failed++;
        if ((error as Error).message.includes("budget")) break;
        continue;
      }
      // A page without job data is recorded (as rejected) so it isn't fetched again.
      job ??= { source_id: item.id, url: item.url, title: "" };
    }
    if (!job) continue;
    batch.push(job);
    if (batch.length >= UPSERT_BATCH) await flush();
  }
  await flush();
  await Promise.all(inFlight);

  const summary = { prime: slug, full: wantsFull, listed: allIds.length, listingFinished, newFound: toProcess.length, nonItFound, processed: Math.min(toProcess.length, maxNew), fetched, failed, accepted, rejected, closed, budgetLeft: budget.remaining };
  console.log(JSON.stringify(summary));
  return { ...summary, error: listingError };
}

async function logRun(env: Env, slug: string, startedAt: string, full: boolean, s: Partial<Awaited<ReturnType<typeof runPrime>>>, error: string | null) {
  try {
    await callReceiver(env, {
      action: "run_log", prime: slug, run: {
        started_at: startedAt, full_sync: full, listed: s.listed ?? 0, new_found: s.newFound ?? 0, non_it_found: s.nonItFound ?? 0,
        processed: s.processed ?? 0, fetched: s.fetched ?? 0, failed: s.failed ?? 0, accepted: s.accepted ?? 0,
        rejected: s.rejected ?? 0, closed: s.closed ?? 0, error,
      },
    });
  } catch (e) {
    console.error(`[${slug}] run log failed: ${(e as Error).message}`);
  }
}

// Reads the first page of a site's listing and up to three jobs, without
// storing anything: lets /admin check a site before it is saved.
async function testSite(env: Env, site: Site) {
  const adapter = buildAdapter(site, ADAPTERS, env);
  const budget = new Budget(30);
  const first = await adapter.list(budget, false).next();
  const items = first.done ? [] : first.value.items;
  const samples: CareerJob[] = [];
  for (const item of items.slice(0, 3)) {
    const job = item.job ?? (adapter.detail ? await adapter.detail(item, budget).catch(() => null) : null);
    if (job) samples.push({ ...job, description: (job.description ?? "").slice(0, 300) });
  }
  return { listed: items.length, total: first.done ? 0 : first.value.total ?? null, samples };
}

export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    const full = new Date(event.scheduledTime).getUTCHours() === Number(env.FULL_SYNC_HOUR_UTC);
    const sites = await loadSites(env);
    if (sites.length > 0) await env.SCRAPE_QUEUE.sendBatch(sites.map((site) => ({ body: { prime: site.slug, full, site } })));
  },

  async queue(batch: MessageBatch<ScrapeMessage>, env: Env) {
    for (const message of batch.messages) {
      const startedAt = new Date().toISOString();
      const site = message.body.site ?? { slug: message.body.prime, kind: "builtin", config: {} };
      try {
        const summary = await runPrime(env, site, message.body.full);
        await logRun(env, site.slug, startedAt, summary.full, summary, summary.error);
        message.ack();
      } catch (error) {
        const msg = (error as Error).message;
        console.error(`[${site.slug}] failed: ${msg}`);
        await logRun(env, site.slug, startedAt, message.body.full, {}, msg);
        message.retry();
      }
    }
  },

  // POST /run?prime=<slug>[&full=1]   queue a run now
  // POST /test  {kind, config}          read a site without storing anything
  // Both need Bearer RUN_TOKEN.
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (req.method !== "POST" || !["/run", "/test"].includes(url.pathname)) return new Response("Not found", { status: 404 });
    if (!env.RUN_TOKEN || req.headers.get("Authorization") !== `Bearer ${env.RUN_TOKEN}`) return new Response("Unauthorized", { status: 401 });
    if (url.pathname === "/test") {
      const body = await req.json().catch(() => ({})) as Partial<Site>;
      try {
        return Response.json(await testSite(env, { slug: body.slug || "test", kind: String(body.kind), config: body.config ?? {} }));
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 400 });
      }
    }
    const prime = url.searchParams.get("prime") ?? "";
    const site = (await loadSites(env, true)).find((s) => s.slug === prime);
    if (!site) return Response.json({ error: "unknown site" }, { status: 400 });
    await env.SCRAPE_QUEUE.send({ prime, full: url.searchParams.get("full") === "1", site });
    return Response.json({ queued: prime });
  },
};
