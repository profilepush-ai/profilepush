export interface Env {
  KEYWORD_SCRAPE_QUEUE: Queue<KeywordScrapeJob>;
  PROCESSOR_WORKER?: Fetcher;
  HARVEST_API_KEY: string;
  PROCESSOR_WORKER_URL: string;
  PROCESSOR_WORKER_TOKEN?: string;
  WORKER_AUTH_TOKEN?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

type PostedLimit = "24h" | "week" | "month";
type SortBy = "date" | "relevance";

type KeywordRow = {
  id: string;
  keyword: string;
};

type KeywordScrapeJob = {
  scrapeRunId: string;
  keywordId: string;
  keyword: string;
  page: number;
  paginationToken?: string;
  postedLimit: PostedLimit;
  sortBy: SortBy;
  maxPostsPerKeyword: number;
  maxPages: number;
  postsDelivered: number;
};

type ScrapeRequest = {
  keywordIds?: unknown[];
  postedLimit?: PostedLimit;
  sortBy?: SortBy;
  maxPostsPerKeyword?: number;
  maxPages?: number;
  force?: boolean;
};

type ScraperConfig = {
  is_enabled: boolean;
  max_pages: number;
  max_posts_per_keyword: number;
  posted_limit: PostedLimit;
  sort_by: SortBy;
  schedule_interval_hours: number;
  last_scheduled_at: string | null;
};

type HarvestResponse = {
  elements?: Array<Record<string, unknown>>;
  pagination?: {
    totalPages?: number;
    paginationToken?: string | null;
  };
  cost?: number;
};

const DEFAULT_POSTED_LIMIT: PostedLimit = "24h";
const DEFAULT_SORT_BY: SortBy = "relevance";
const DEFAULT_MAX_POSTS = 100;
const DEFAULT_MAX_PAGES = 1;
const MAX_KEYWORDS_PER_REQUEST = 1000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getBearerToken(request: Request): string {
  const [scheme, token] = (request.headers.get("Authorization") ?? "").split(" ");
  return scheme?.toLowerCase() === "bearer" ? (token ?? "").trim() : "";
}

function isAuthorized(request: Request, expectedToken?: string): boolean {
  const expected = (expectedToken ?? "").trim();
  return expected.length === 0 || getBearerToken(request) === expected;
}

function serviceHeaders(env: Env, json = false): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

function fetchProcessor(env: Env, init: RequestInit): Promise<Response> {
  if (env.PROCESSOR_WORKER) {
    return env.PROCESSOR_WORKER.fetch("https://processor.internal", init);
  }
  return fetch(env.PROCESSOR_WORKER_URL, init);
}

function asString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return "";
}

function extractPostId(url: string): string {
  return url.match(/urn:li:groupPost:\d+-(\d+)/i)?.[1]
    ?? url.match(/(?:activity|urn:li:activity)[:-](\d+)/i)?.[1]
    ?? "";
}

async function getSourcePostId(post: Record<string, unknown>, keywordId: string): Promise<string> {
  const explicitId = firstString(post.id, post.post_id, post.postId);
  if (explicitId) return explicitId;

  const postUrl = firstString(post.linkedinUrl, post.post_url, post.url, post.postUrl, post["post URL"]);
  const urlId = extractPostId(postUrl);
  if (urlId) return urlId;

  const content = firstString(post.text, post.content, post.post_content, post.description);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${keywordId}\n${postUrl}\n${content}`),
  );
  return `gen_${Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function fetchActiveKeywords(env: Env): Promise<KeywordRow[]> {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/linkedin_keywords?select=id,keyword&is_active=eq.true&order=keyword.asc&limit=${MAX_KEYWORDS_PER_REQUEST}`,
    { headers: serviceHeaders(env) },
  );
  if (!response.ok) throw new Error(`LinkedIn keywords query ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const rows = await response.json<KeywordRow[]>();
  return rows.filter((row) => row.id && row.keyword?.trim());
}

async function claimKeywordsForScrape(
  env: Env,
  keywordIds: string[],
  intervalHours: number,
  force = false,
): Promise<string[]> {
  if (keywordIds.length === 0) return [];
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/claim_linkedin_keywords_for_scrape`, {
    method: "POST",
    headers: serviceHeaders(env, true),
    body: JSON.stringify({
      p_keyword_ids: keywordIds,
      p_interval_hours: intervalHours,
      p_force: force,
    }),
  });
  if (!response.ok) throw new Error(`LinkedIn keyword claim ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const rows = await response.json<Array<{ id?: unknown }>>();
  return rows.map((row) => asString(row.id)).filter(Boolean);
}

async function fetchScraperConfig(env: Env): Promise<ScraperConfig> {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/linkedin_keyword_scraper_config?select=*&id=eq.true`,
    { headers: serviceHeaders(env) },
  );
  if (!response.ok) throw new Error(`Keyword scraper config query ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const rows = await response.json<ScraperConfig[]>();
  if (!rows[0]) throw new Error("LinkedIn keyword scraper config is missing");
  return rows[0];
}

async function verifyProcessorAccess(env: Env): Promise<void> {
  const response = await fetchProcessor(env, {
    method: "HEAD",
    headers: env.PROCESSOR_WORKER_TOKEN
      ? { Authorization: `Bearer ${env.PROCESSOR_WORKER_TOKEN}` }
      : {},
  });
  if (!response.ok) throw new Error(`Processor Worker preflight failed (${response.status})`);
}

async function claimScheduledRun(env: Env, config: ScraperConfig): Promise<boolean> {
  if (!config.is_enabled) return false;
  const lastRun = config.last_scheduled_at ? new Date(config.last_scheduled_at).getTime() : 0;
  if (Date.now() - lastRun < config.schedule_interval_hours * 60 * 60 * 1000) return false;
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/linkedin_keyword_scraper_config?id=eq.true`, {
    method: "PATCH",
    headers: { ...serviceHeaders(env, true), Prefer: "return=minimal" },
    body: JSON.stringify({ last_scheduled_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Keyword scraper config update ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return true;
}

function parseBoundedInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(parsed)));
}

function buildInitialJobs(keywords: KeywordRow[], payload: ScrapeRequest): KeywordScrapeJob[] {
  if (keywords.length === 0) return [];
  const postedLimit: PostedLimit = ["24h", "week", "month"].includes(payload.postedLimit ?? "")
    ? payload.postedLimit!
    : DEFAULT_POSTED_LIMIT;
  const sortBy: SortBy = ["date", "relevance"].includes(payload.sortBy ?? "")
    ? payload.sortBy!
    : DEFAULT_SORT_BY;
  const maxPostsPerKeyword = parseBoundedInteger(payload.maxPostsPerKeyword, DEFAULT_MAX_POSTS, 1000);
  const maxPages = parseBoundedInteger(payload.maxPages, DEFAULT_MAX_PAGES, 20);

  return keywords.map((row) => ({
    scrapeRunId: crypto.randomUUID(),
    keywordId: row.id,
    keyword: row.keyword.trim(),
    page: 1,
    postedLimit,
    sortBy,
    maxPostsPerKeyword,
    maxPages,
    postsDelivered: 0,
  }));
}

async function enqueueJobs(queue: Queue<KeywordScrapeJob>, jobs: KeywordScrapeJob[]): Promise<void> {
  for (let index = 0; index < jobs.length; index += 100) {
    await queue.sendBatch(jobs.slice(index, index + 100).map((body) => ({ body })));
  }
}

async function fetchHarvestPage(job: KeywordScrapeJob, env: Env): Promise<HarvestResponse> {
  const params = new URLSearchParams({
    search: job.keyword,
    postedLimit: job.postedLimit,
    scrapePostedLimit: "24h",
    sortBy: job.sortBy,
    page: String(job.page),
  });
  if (job.paginationToken) params.set("paginationToken", job.paginationToken);
  const response = await fetch(`https://api.harvestapi.io/linkedin/post-search?${params}`, {
    headers: { "X-API-Key": env.HARVEST_API_KEY },
  });
  if (!response.ok) throw new Error(`HarvestAPI ${response.status} for keyword ${job.keyword}: ${(await response.text()).slice(0, 500)}`);
  return response.json<HarvestResponse>();
}

async function logScrapedPosts(env: Env, job: KeywordScrapeJob, posts: Array<Record<string, unknown>>): Promise<void> {
  if (posts.length === 0) return;
  const observedAt = new Date().toISOString();
  const identifiedPosts = await Promise.all(posts.map(async (post, itemIndex) => ({
    source_post_id: await getSourcePostId(post, job.keywordId),
    scrape_run_id: job.scrapeRunId,
    keyword_id: job.keywordId,
    harvest_page: job.page,
    item_index: itemIndex,
    raw_post: post,
    observed_at: observedAt,
    seen_increment: 1,
  })));
  const uniquePosts = new Map<string, typeof identifiedPosts[number]>();
  for (const post of identifiedPosts) {
    const existing = uniquePosts.get(post.source_post_id);
    uniquePosts.set(post.source_post_id, {
      ...post,
      seen_increment: (existing?.seen_increment ?? 0) + 1,
    });
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/upsert_linkedin_keyword_posts`, {
    method: "POST",
    headers: serviceHeaders(env, true),
    body: JSON.stringify({ p_posts: [...uniquePosts.values()] }),
  });
  if (!response.ok) throw new Error(`Keyword post log ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

async function markPostsDelivery(
  env: Env,
  keywordId: string,
  sourcePostIds: string[],
  status: "delivered" | "not_selected" | "failed",
  error?: string,
): Promise<void> {
  if (sourcePostIds.length === 0) return;
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mark_linkedin_keyword_posts_delivery`, {
    method: "POST",
    headers: serviceHeaders(env, true),
    body: JSON.stringify({
      p_keyword_id: keywordId,
      p_source_post_ids: sourcePostIds,
      p_status: status,
      p_error: error ?? null,
    }),
  });
  if (!response.ok) throw new Error(`Keyword delivery status ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

async function logScrapeRun(
  env: Env,
  job: KeywordScrapeJob,
  postsFetched: number,
  uniquePostsSeen: number,
  harvestCost: number | null,
): Promise<void> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_linkedin_keyword_scrape_run`, {
    method: "POST",
    headers: serviceHeaders(env, true),
    body: JSON.stringify({
      p_scrape_run_id: job.scrapeRunId,
      p_keyword_id: job.keywordId,
      p_page: job.page,
      p_posts_fetched: postsFetched,
      p_unique_posts_seen: uniquePostsSeen,
      p_harvest_cost: harvestCost,
    }),
  });
  if (!response.ok) throw new Error(`LinkedIn keyword scrape run log ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

async function deliverPosts(env: Env, job: KeywordScrapeJob, posts: Array<Record<string, unknown>>): Promise<void> {
  if (posts.length === 0) return;
  const response = await fetchProcessor(env, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.PROCESSOR_WORKER_TOKEN ? { Authorization: `Bearer ${env.PROCESSOR_WORKER_TOKEN}` } : {}),
    },
    body: JSON.stringify({ keywordId: job.keywordId, posts }),
  });
  if (!response.ok) throw new Error(`Processor Worker ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

// Cap how many posts go to the processor in one request. A single request
// carrying a large backlog (e.g. after an outage) can exceed the processor's
// own execution time and hang without ever returning a response — which,
// left unbounded, can strand that same backlog on every future retry too.
const RETRY_DELIVERY_CHUNK_SIZE = 5;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function retryFailedDeliveries(env: Env): Promise<number> {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/linkedin_keyword_posts?select=keyword_id,source_post_id,raw_post&delivery_status=eq.failed&order=last_seen_at.asc&limit=200`,
    { headers: serviceHeaders(env) },
  );
  if (!response.ok) throw new Error(`Failed keyword delivery query ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const rows = await response.json<Array<{ keyword_id: string; source_post_id: string; raw_post: Record<string, unknown> }>>();
  const byKeyword = new Map<string, typeof rows>();
  for (const row of rows) byKeyword.set(row.keyword_id, [...(byKeyword.get(row.keyword_id) ?? []), row]);

  let delivered = 0;
  for (const [keywordId, keywordRows] of byKeyword) {
    const retryJob = { keywordId } as KeywordScrapeJob;
    for (const chunk of chunkArray(keywordRows, RETRY_DELIVERY_CHUNK_SIZE)) {
      try {
        await deliverPosts(env, retryJob, chunk.map((row) => row.raw_post));
        await markPostsDelivery(env, keywordId, chunk.map((row) => row.source_post_id), "delivered");
        delivered += chunk.length;
      } catch (error) {
        // Per-chunk isolation: one stuck chunk must never block the remaining
        // chunks (same keyword or others), nor the rest of the scheduled run.
        await markPostsDelivery(env, keywordId, chunk.map((row) => row.source_post_id), "failed", (error as Error).message).catch(() => {});
        console.error(`Retry delivery chunk failed for keyword ${keywordId}: ${(error as Error).message}`);
      }
    }
  }
  return delivered;
}

async function markKeywordScraped(env: Env, keywordId: string): Promise<void> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/linkedin_keywords?id=eq.${encodeURIComponent(keywordId)}`, {
    method: "PATCH",
    headers: { ...serviceHeaders(env, true), Prefer: "return=minimal" },
    body: JSON.stringify({ last_scraped_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Keyword update ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

async function processScrapeJob(job: KeywordScrapeJob, env: Env): Promise<void> {
  const result = await fetchHarvestPage(job, env);
  const posts = Array.isArray(result.elements) ? result.elements : [];
  await logScrapedPosts(env, job, posts);
  const sourcePostIds = await Promise.all(posts.map((post) => getSourcePostId(post, job.keywordId)));
  const remaining = Math.max(0, job.maxPostsPerKeyword - job.postsDelivered);
  const selected = posts.slice(0, remaining);
  const selectedSourcePostIds = sourcePostIds.slice(0, selected.length);
  const notSelectedSourcePostIds = sourcePostIds.slice(selected.length);
  await markPostsDelivery(env, job.keywordId, notSelectedSourcePostIds, "not_selected");
  try {
    await deliverPosts(env, job, selected);
    await markPostsDelivery(env, job.keywordId, selectedSourcePostIds, "delivered");
  } catch (error) {
    await markPostsDelivery(env, job.keywordId, selectedSourcePostIds, "failed", (error as Error).message);
    throw error;
  }
  await logScrapeRun(env, job, posts.length, new Set(sourcePostIds).size, result.cost ?? null);
  const postsDelivered = job.postsDelivered + selected.length;
  const pagination = result.pagination ?? {};
  const hasAnotherPage = typeof pagination.totalPages === "number" ? job.page < pagination.totalPages : posts.length > 0;

  if (job.page < job.maxPages && postsDelivered < job.maxPostsPerKeyword && hasAnotherPage && posts.length > 0) {
    await env.KEYWORD_SCRAPE_QUEUE.send({
      ...job,
      page: job.page + 1,
      paginationToken: pagination.paginationToken ?? undefined,
      postsDelivered,
    });
  } else {
    await markKeywordScraped(env, job.keywordId);
  }

  console.log(JSON.stringify({
    event: "keyword_page_delivered",
    keywordId: job.keywordId,
    keyword: job.keyword,
    page: job.page,
    posts: selected.length,
    postsDelivered,
    harvestCost: result.cost ?? null,
  }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "GET") {
      try {
        await verifyProcessorAccess(env);
        return jsonResponse({ status: "ok", processor: "ok" });
      } catch (error) {
        return jsonResponse({ status: "degraded", processor: (error as Error).message }, 503);
      }
    }
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    if (!isAuthorized(request, env.WORKER_AUTH_TOKEN)) return jsonResponse({ error: "Unauthorized" }, 401);

    try {
      const payload = await request.json<ScrapeRequest>();
      await verifyProcessorAccess(env);
      const config = await fetchScraperConfig(env);
      const activeKeywords = await fetchActiveKeywords(env);
      const requestedIds = new Set((Array.isArray(payload.keywordIds) ? payload.keywordIds : []).map(String));
      const selected = requestedIds.size > 0
        ? activeKeywords.filter((row) => requestedIds.has(row.id))
        : activeKeywords;
      const claimedIds = new Set(await claimKeywordsForScrape(
        env,
        selected.map((row) => row.id),
        config.schedule_interval_hours,
        payload.force === true,
      ));
      const claimedKeywords = selected.filter((row) => claimedIds.has(row.id));
      const jobs = buildInitialJobs(claimedKeywords, payload);
      await enqueueJobs(env.KEYWORD_SCRAPE_QUEUE, jobs);
      return jsonResponse({
        success: true,
        keywordsQueued: jobs.length,
        keywordsSkippedAsRecentlyScraped: selected.length - claimedKeywords.length,
        inactiveOrUnknownKeywordIds: [...requestedIds].filter((id) => !activeKeywords.some((row) => row.id === id)),
      }, 202);
    } catch (error) {
      return jsonResponse({ error: (error as Error).message }, 400);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await verifyProcessorAccess(env);
    try {
      const retriedPosts = await retryFailedDeliveries(env);
      if (retriedPosts > 0) console.log(JSON.stringify({ event: "failed_keyword_deliveries_retried", posts: retriedPosts }));
    } catch (error) {
      console.error(`Failed delivery retry errored: ${(error as Error).message}`);
    }
    const config = await fetchScraperConfig(env);
    if (!await claimScheduledRun(env, config)) {
      console.log(JSON.stringify({ event: "scheduled_keyword_scrape_skipped", enabled: config.is_enabled }));
      return;
    }
    const keywords = await fetchActiveKeywords(env);
    const claimedIds = new Set(await claimKeywordsForScrape(
      env,
      keywords.map((row) => row.id),
      config.schedule_interval_hours,
    ));
    const claimedKeywords = keywords.filter((row) => claimedIds.has(row.id));
    if (claimedKeywords.length === 0) {
      console.log(JSON.stringify({ event: "scheduled_keyword_scrape_skipped", reason: "no_keywords_due" }));
      return;
    }
    const jobs = buildInitialJobs(claimedKeywords, {
      postedLimit: config.posted_limit,
      sortBy: config.sort_by,
      maxPostsPerKeyword: config.max_posts_per_keyword,
      maxPages: config.max_pages,
    });
    await enqueueJobs(env.KEYWORD_SCRAPE_QUEUE, jobs);
    console.log(JSON.stringify({
      event: "scheduled_keywords_queued",
      keywords: jobs.length,
      keywordsSkippedAsRecentlyScraped: keywords.length - claimedKeywords.length,
    }));
  },

  async queue(batch: MessageBatch<KeywordScrapeJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processScrapeJob(message.body, env);
        message.ack();
      } catch (error) {
        console.error(`Keyword scrape failed: ${(error as Error).message}`);
        message.retry();
      }
    }
  },
};