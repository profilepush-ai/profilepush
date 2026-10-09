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

interface Env {
  SUPABASE_URL: string;
  CAREER_SITES_SECRET: string;
  RUN_TOKEN?: string;
  ENABLED_PRIMES: string;
  FULL_SYNC_HOUR_UTC: string;
  MAX_NEW_PER_RUN: string;
  SCRAPE_QUEUE: Queue<ScrapeMessage>;
}

type ScrapeMessage = { prime: string; full: boolean };

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

export async function runPrime(env: Env, slug: string, full: boolean) {
  const adapter = ADAPTERS[slug];
  if (!adapter) throw new Error(`unknown prime ${slug}`);
  const budget = new Budget(SUBREQUEST_BUDGET);
  const maxNew = Number(env.MAX_NEW_PER_RUN) || 60;
  const wantsFull = full || adapter.alwaysComplete;

  const allIds: string[] = [];
  let skippedByTitle = 0;
  const titleOf = (i: ListingItem) => i.title || i.job?.title;
  // Titles that are clearly not IT are recorded by the receiver and never
  // fetched or parsed, so the per-run cap is spent on IT roles only.
  const triage = async (items: ListingItem[]): Promise<ListingItem[]> => {
    const titled = items.filter(titleOf);
    if (titled.length === 0) return items;
    const keep = new Set<string>();
    for (let i = 0; i < titled.length; i += 300) {
      const chunk = titled.slice(i, i + 300);
      const r = await callReceiver(env, { action: "triage", prime: slug, items: chunk.map((x) => ({ id: x.id, url: x.url, title: titleOf(x) })) }) as { keep: string[] };
      for (const id of r.keep ?? []) keep.add(id);
    }
    skippedByTitle += titled.length - keep.size;
    return items.filter((i) => !titleOf(i) || keep.has(i.id));
  };
  const pending: ListingItem[] = [];
  let listingFinished = false;
  let partial = false;
  let closed = 0;

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
      if (backfilling && pending.length >= maxNew) break;
    }
  } catch (error) {
    console.error(`[${slug}] listing stopped: ${(error as Error).message}`);
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

  const batch: CareerJob[] = [];
  let accepted = 0, rejected = 0, fetched = 0, failed = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const r = await callReceiver(env, { action: "upsert", prime: slug, jobs: batch.splice(0) }) as { accepted: number; rejected: number };
    accepted += r.accepted ?? 0;
    rejected += r.rejected ?? 0;
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

  const summary = { prime: slug, full: wantsFull, listed: allIds.length, listingFinished, newFound: toProcess.length + skippedByTitle, skippedByTitle, processed: Math.min(toProcess.length, maxNew), fetched, failed, accepted, rejected, closed, budgetLeft: budget.remaining };
  console.log(JSON.stringify(summary));
  return summary;
}

function enabled(env: Env) {
  return env.ENABLED_PRIMES.split(",").map((s) => s.trim()).filter((s) => ADAPTERS[s]);
}

export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    const full = new Date(event.scheduledTime).getUTCHours() === Number(env.FULL_SYNC_HOUR_UTC);
    await env.SCRAPE_QUEUE.sendBatch(enabled(env).map((prime) => ({ body: { prime, full } })));
  },

  async queue(batch: MessageBatch<ScrapeMessage>, env: Env) {
    for (const message of batch.messages) {
      try {
        await runPrime(env, message.body.prime, message.body.full);
        message.ack();
      } catch (error) {
        console.error(`[${message.body.prime}] failed: ${(error as Error).message}`);
        message.retry();
      }
    }
  },

  // Manual run for testing: POST /run?prime=teksystems&full=1 with Bearer RUN_TOKEN.
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ ok: true, primes: enabled(env) });
    if (url.pathname !== "/run" || req.method !== "POST") return new Response("Not found", { status: 404 });
    if (!env.RUN_TOKEN || req.headers.get("Authorization") !== `Bearer ${env.RUN_TOKEN}`) return new Response("Unauthorized", { status: 401 });
    const prime = url.searchParams.get("prime") ?? "";
    if (!enabled(env).includes(prime)) return Response.json({ error: "prime not enabled" }, { status: 400 });
    await env.SCRAPE_QUEUE.send({ prime, full: url.searchParams.get("full") === "1" });
    return Response.json({ queued: prime });
  },
};
