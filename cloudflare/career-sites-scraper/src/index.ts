import { Budget } from "./http";
import type { Adapter, CareerJob } from "./types";
import { teksystems } from "./adapters/teksystems";
import { judge } from "./adapters/judge";

interface Env {
  SUPABASE_URL: string;
  SOCIAL_WEBHOOK_SECRET: string;
  RUN_TOKEN?: string;
  ENABLED_PRIMES: string;
  FULL_SYNC_HOUR_UTC: string;
  MAX_NEW_PER_RUN: string;
  SCRAPE_QUEUE: Queue<ScrapeMessage>;
}

type ScrapeMessage = { prime: string; full: boolean };

const ADAPTERS: Record<string, Adapter> = { teksystems, judge };
const SUBREQUEST_BUDGET = 850; // per invocation (one prime per invocation)
const UPSERT_BATCH = 4;

async function callReceiver(env: Env, body: unknown) {
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/receive-career-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.SOCIAL_WEBHOOK_SECRET}` },
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
  const pending: Array<{ id: string; url: string; job?: CareerJob }> = [];
  let listingFinished = false;
  let closed = 0;

  try {
    const pages = adapter.list(budget, wantsFull);
    for (;;) {
      const next = await pages.next();
      if (next.done) { listingFinished = true; break; }
      const items = next.value.items;
      allIds.push(...items.map((i) => i.id));
      if (adapter.alwaysComplete) { pending.push(...items); continue; }
      const { unknown } = await callReceiver(env, { action: "sync", prime: slug, ids: items.map((i) => i.id), complete: false }) as { unknown: string[] };
      const isNew = new Set(unknown);
      pending.push(...items.filter((i) => isNew.has(i.id)));
      // Newest first: a page with nothing new means the rest is known.
      if (!wantsFull && unknown.length === 0) break;
    }
  } catch (error) {
    console.error(`[${slug}] listing stopped: ${(error as Error).message}`);
  }

  let toProcess = pending;
  if (adapter.alwaysComplete || (wantsFull && listingFinished)) {
    const res = await callReceiver(env, { action: "sync", prime: slug, ids: allIds, complete: listingFinished }) as { unknown: string[]; closed: number };
    closed = res.closed ?? 0;
    if (adapter.alwaysComplete) {
      const isNew = new Set(res.unknown);
      toProcess = pending.filter((i) => isNew.has(i.id));
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

  const summary = { prime: slug, full: wantsFull, listed: allIds.length, listingFinished, newFound: toProcess.length, processed: Math.min(toProcess.length, maxNew), fetched, failed, accepted, rejected, closed, budgetLeft: budget.remaining };
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
