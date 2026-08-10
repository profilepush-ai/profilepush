export interface Env {
  GROUP_SCRAPE_QUEUE: Queue<GroupScrapeJob>;
  HARVEST_API_KEY: string;
  PROCESSOR_WORKER_URL: string;
  PROCESSOR_WORKER_TOKEN?: string;
  WORKER_AUTH_TOKEN?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

type PostedLimit = "24h" | "week" | "month";
type SortBy = "date" | "relevance";

type GroupScrapeJob = {
  scrapeRunId: string;
  group: string;
  page: number;
  paginationToken?: string;
  postedLimit: PostedLimit;
  sortBy: SortBy;
  maxPostsPerGroup: number;
  maxPages: number;
  postsDelivered: number;
};

type ScrapeRequest = {
  groups?: unknown[];
  postedLimit?: PostedLimit;
  sortBy?: SortBy;
  maxPostsPerGroup?: number;
  maxPages?: number;
};

type ScraperConfig = {
  is_enabled: boolean;
  max_pages: number;
  max_posts_per_group: number;
  posted_limit: PostedLimit;
  sort_by: SortBy;
  schedule_interval_hours: number;
  last_scheduled_at: string | null;
};

type HarvestResponse = {
  elements?: Array<Record<string, unknown>>;
  pagination?: {
    totalPages?: number;
    pageNumber?: number;
    paginationToken?: string | null;
  };
  cost?: number;
};

const DEFAULT_POSTED_LIMIT: PostedLimit = "24h";
const DEFAULT_SORT_BY: SortBy = "date";
const DEFAULT_MAX_POSTS = 100;
const DEFAULT_MAX_PAGES = 1;
const MAX_GROUPS_PER_REQUEST = 1000;

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

function normalizeGroup(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const input = String(value).trim();
  if (!input) return null;
  const match = input.match(/linkedin\.com\/groups\/(\d+)/i);
  if (match) return match[1];
  return /^\d+$/.test(input) ? input : null;
}

function normalizeGroups(values: unknown[]): string[] {
  return [...new Set(values.map(normalizeGroup).filter((value): value is string => Boolean(value)))];
}

async function fetchActiveGroups(env: Env): Promise<string[]> {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/linkedin_groups?select=group_id&is_active=eq.true&order=group_id.asc&limit=${MAX_GROUPS_PER_REQUEST}`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`LinkedIn groups query ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const rows = await response.json<Array<{ group_id?: unknown }>>();
  return normalizeGroups(rows.map((row) => row.group_id));
}

async function fetchScraperConfig(env: Env): Promise<ScraperConfig> {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/linkedin_scraper_config?select=*&id=eq.true`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } },
  );
  if (!response.ok) throw new Error(`Scraper config query ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const rows = await response.json<ScraperConfig[]>();
  if (!rows[0]) throw new Error("LinkedIn scraper config is missing");
  return rows[0];
}

async function claimScheduledRun(env: Env, config: ScraperConfig): Promise<boolean> {
  if (!config.is_enabled) return false;
  const lastRun = config.last_scheduled_at ? new Date(config.last_scheduled_at).getTime() : 0;
  if (Date.now() - lastRun < config.schedule_interval_hours * 60 * 60 * 1000) return false;
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/linkedin_scraper_config?id=eq.true`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ last_scheduled_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Scraper config update ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return true;
}

async function markGroupScraped(env: Env, groupId: string): Promise<void> {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/linkedin_groups?group_id=eq.${encodeURIComponent(groupId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        last_scraped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`LinkedIn group update ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
}

function parseMaxPosts(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_POSTS;
  return Math.min(1000, Math.max(1, Math.floor(parsed)));
}

function parseMaxPages(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_PAGES;
  return Math.min(20, Math.max(1, Math.floor(parsed)));
}

function buildInitialJobs(payload: ScrapeRequest): GroupScrapeJob[] {
  const groups = normalizeGroups(Array.isArray(payload.groups) ? payload.groups : []);
  if (groups.length === 0) throw new Error("groups must contain at least one LinkedIn group URL or numeric ID");
  if (groups.length > MAX_GROUPS_PER_REQUEST) throw new Error(`A maximum of ${MAX_GROUPS_PER_REQUEST} groups is allowed`);

  const postedLimit: PostedLimit = ["24h", "week", "month"].includes(payload.postedLimit ?? "")
    ? payload.postedLimit!
    : DEFAULT_POSTED_LIMIT;
  const sortBy: SortBy = ["date", "relevance"].includes(payload.sortBy ?? "")
    ? payload.sortBy!
    : DEFAULT_SORT_BY;
  const maxPostsPerGroup = parseMaxPosts(payload.maxPostsPerGroup);
  const maxPages = parseMaxPages(payload.maxPages);

  return groups.map((group) => ({
    scrapeRunId: crypto.randomUUID(),
    group,
    page: 1,
    postedLimit,
    sortBy,
    maxPostsPerGroup,
    maxPages,
    postsDelivered: 0,
  }));
}

async function enqueueJobs(queue: Queue<GroupScrapeJob>, jobs: GroupScrapeJob[]): Promise<void> {
  for (let index = 0; index < jobs.length; index += 100) {
    await queue.sendBatch(jobs.slice(index, index + 100).map((body) => ({ body })));
  }
}

async function fetchHarvestPage(job: GroupScrapeJob, env: Env): Promise<HarvestResponse> {
  const params = new URLSearchParams({
    group: job.group,
    postedLimit: job.postedLimit,
    scrapePostedLimit: "24h",
    sortBy: job.sortBy,
    page: String(job.page),
  });
  if (job.paginationToken) params.set("paginationToken", job.paginationToken);

  const response = await fetch(`https://api.harvestapi.io/linkedin/post-search?${params}`, {
    headers: { "X-API-Key": env.HARVEST_API_KEY },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`HarvestAPI ${response.status} for group ${job.group}: ${detail}`);
  }
  return response.json<HarvestResponse>();
}

async function logScrapedPosts(
  env: Env,
  job: GroupScrapeJob,
  posts: Array<Record<string, unknown>>,
): Promise<void> {
  if (posts.length === 0) return;
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/linkedin_groups_posts?on_conflict=scrape_run_id,group_id,harvest_page,item_index`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(posts.map((post, itemIndex) => ({
        scrape_run_id: job.scrapeRunId,
        group_id: job.group,
        harvest_page: job.page,
        item_index: itemIndex,
        raw_post: post,
      }))),
    },
  );
  if (!response.ok) {
    throw new Error(`LinkedIn post log ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
}

async function deliverPosts(
  env: Env,
  groupId: string,
  posts: Array<Record<string, unknown>>,
): Promise<void> {
  if (posts.length === 0) return;
  const response = await fetch(env.PROCESSOR_WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.PROCESSOR_WORKER_TOKEN
        ? { Authorization: `Bearer ${env.PROCESSOR_WORKER_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({ groupId, posts }),
  });
  if (!response.ok) {
    throw new Error(`Processor Worker ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
}

async function processScrapeJob(job: GroupScrapeJob, env: Env): Promise<void> {
  const result = await fetchHarvestPage(job, env);
  const posts = Array.isArray(result.elements) ? result.elements : [];
  await logScrapedPosts(env, job, posts);
  const remaining = Math.max(0, job.maxPostsPerGroup - job.postsDelivered);
  const selected = posts.slice(0, remaining);
  await deliverPosts(env, job.group, selected);

  const postsDelivered = job.postsDelivered + selected.length;
  const pagination = result.pagination ?? {};
  const hasAnotherPage = typeof pagination.totalPages === "number"
    ? job.page < pagination.totalPages
    : posts.length > 0;

  if (job.page < job.maxPages && postsDelivered < job.maxPostsPerGroup && hasAnotherPage && posts.length > 0) {
    await env.GROUP_SCRAPE_QUEUE.send({
      ...job,
      page: job.page + 1,
      paginationToken: pagination.paginationToken ?? undefined,
      postsDelivered,
    });
  } else {
    await markGroupScraped(env, job.group);
  }

  console.log(JSON.stringify({
    event: "group_page_delivered",
    group: job.group,
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
      const activeGroups = await fetchActiveGroups(env);
      const requestedGroups = normalizeGroups(Array.isArray(payload.groups) ? payload.groups : []);
      const activeGroupSet = new Set(activeGroups);
      const selectedGroups = requestedGroups.length > 0
        ? requestedGroups.filter((group) => activeGroupSet.has(group))
        : activeGroups;
      const jobs = buildInitialJobs({ ...payload, groups: selectedGroups });
      await enqueueJobs(env.GROUP_SCRAPE_QUEUE, jobs);
      return jsonResponse({
        success: true,
        groupsQueued: jobs.length,
        inactiveOrUnknownGroups: requestedGroups.filter((group) => !activeGroupSet.has(group)),
      }, 202);
    } catch (error) {
      return jsonResponse({ error: (error as Error).message }, 400);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const config = await fetchScraperConfig(env);
    if (!await claimScheduledRun(env, config)) {
      console.log(JSON.stringify({ event: "scheduled_scrape_skipped", enabled: config.is_enabled }));
      return;
    }
    const groups = await fetchActiveGroups(env);
    const jobs = buildInitialJobs({
      groups,
      postedLimit: config.posted_limit,
      sortBy: config.sort_by,
      maxPostsPerGroup: config.max_posts_per_group,
      maxPages: config.max_pages,
    });
    await enqueueJobs(env.GROUP_SCRAPE_QUEUE, jobs);
    console.log(JSON.stringify({ event: "scheduled_groups_queued", groups: jobs.length }));
  },

  async queue(batch: MessageBatch<GroupScrapeJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processScrapeJob(message.body, env);
        message.ack();
      } catch (error) {
        console.error(`Group scrape failed: ${(error as Error).message}`);
        message.retry();
      }
    }
  },
};
