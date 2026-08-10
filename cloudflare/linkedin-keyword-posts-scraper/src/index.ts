export interface Env {
  KEYWORD_SCRAPE_QUEUE: Queue<KeywordScrapeJob>;
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

async function fetchActiveKeywords(env: Env): Promise<KeywordRow[]> {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/linkedin_keywords?select=id,keyword&is_active=eq.true&order=keyword.asc&limit=${MAX_KEYWORDS_PER_REQUEST}`,
    { headers: serviceHeaders(env) },
  );
  if (!response.ok) throw new Error(`LinkedIn keywords query ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const rows = await response.json<KeywordRow[]>();
  return rows.filter((row) => row.id && row.keyword?.trim());
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
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/linkedin_keyword_posts?on_conflict=scrape_run_id,keyword_id,harvest_page,item_index`,
    {
      method: "POST",
      headers: { ...serviceHeaders(env, true), Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(posts.map((post, itemIndex) => ({
        scrape_run_id: job.scrapeRunId,
        keyword_id: job.keywordId,
        harvest_page: job.page,
        item_index: itemIndex,
        raw_post: post,
      }))),
    },
  );
  if (!response.ok) throw new Error(`Keyword post log ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

async function deliverPosts(env: Env, job: KeywordScrapeJob, posts: Array<Record<string, unknown>>): Promise<void> {
  if (posts.length === 0) return;
  const response = await fetch(env.PROCESSOR_WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.PROCESSOR_WORKER_TOKEN ? { Authorization: `Bearer ${env.PROCESSOR_WORKER_TOKEN}` } : {}),
    },
    body: JSON.stringify({ keywordId: job.keywordId, posts }),
  });
  if (!response.ok) throw new Error(`Processor Worker ${response.status}: ${(await response.text()).slice(0, 500)}`);
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
  const remaining = Math.max(0, job.maxPostsPerKeyword - job.postsDelivered);
  const selected = posts.slice(0, remaining);
  await deliverPosts(env, job, selected);
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
    if (request.method === "GET") return jsonResponse({ status: "ok" });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    if (!isAuthorized(request, env.WORKER_AUTH_TOKEN)) return jsonResponse({ error: "Unauthorized" }, 401);

    try {
      const payload = await request.json<ScrapeRequest>();
      const activeKeywords = await fetchActiveKeywords(env);
      const requestedIds = new Set((Array.isArray(payload.keywordIds) ? payload.keywordIds : []).map(String));
      const selected = requestedIds.size > 0
        ? activeKeywords.filter((row) => requestedIds.has(row.id))
        : activeKeywords;
      const jobs = buildInitialJobs(selected, payload);
      await enqueueJobs(env.KEYWORD_SCRAPE_QUEUE, jobs);
      return jsonResponse({ success: true, keywordsQueued: jobs.length }, 202);
    } catch (error) {
      return jsonResponse({ error: (error as Error).message }, 400);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const config = await fetchScraperConfig(env);
    if (!await claimScheduledRun(env, config)) {
      console.log(JSON.stringify({ event: "scheduled_keyword_scrape_skipped", enabled: config.is_enabled }));
      return;
    }
    const keywords = await fetchActiveKeywords(env);
    const jobs = buildInitialJobs(keywords, {
      postedLimit: config.posted_limit,
      sortBy: config.sort_by,
      maxPostsPerKeyword: config.max_posts_per_keyword,
      maxPages: config.max_pages,
    });
    await enqueueJobs(env.KEYWORD_SCRAPE_QUEUE, jobs);
    console.log(JSON.stringify({ event: "scheduled_keywords_queued", keywords: jobs.length }));
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