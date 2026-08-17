export interface Env {
  GROUP_SCRAPE_QUEUE: Queue<GroupScrapeJob>;
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
  force?: boolean;
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

function fetchProcessor(env: Env, init: RequestInit): Promise<Response> {
  if (env.PROCESSOR_WORKER) {
    return env.PROCESSOR_WORKER.fetch("https://processor.internal", init);
  }
  return fetch(env.PROCESSOR_WORKER_URL, init);
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

async function getSourcePostId(post: Record<string, unknown>, groupId: string): Promise<string> {
  const explicitId = firstString(post.id, post.post_id, post.postId);
  if (explicitId) return explicitId;

  const postUrl = firstString(post.linkedinUrl, post.post_url, post.url, post.postUrl, post["post URL"]);
  const urlId = extractPostId(postUrl);
  if (urlId) return urlId;

  const content = firstString(post.text, post.content, post.post_content, post.description);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${groupId}\n${postUrl}\n${content}`),
  );
  return `gen_${Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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

async function claimGroupsForScrape(
  env: Env,
  groups: string[],
  intervalHours: number,
  force = false,
): Promise<string[]> {
  if (groups.length === 0) return [];
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/claim_linkedin_groups_for_scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      p_group_ids: groups,
      p_interval_hours: intervalHours,
      p_force: force,
    }),
  });
  if (!response.ok) {
    throw new Error(`LinkedIn group claim ${response.status}: ${(await response.text()).slice(0, 500)}`);
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
  const minimumIntervalMinutes = Math.max(1, config.schedule_interval_hours * 60 - 5);
  if (Date.now() - lastRun < minimumIntervalMinutes * 60 * 1000) return false;
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
  const observedAt = new Date().toISOString();
  const identifiedPosts = await Promise.all(posts.map(async (post, itemIndex) => ({
    source_post_id: await getSourcePostId(post, job.group),
    scrape_run_id: job.scrapeRunId,
    group_id: job.group,
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

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/upsert_linkedin_group_posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ p_posts: [...uniquePosts.values()] }),
  });
  if (!response.ok) {
    throw new Error(`LinkedIn post log ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
}

async function markPostsDelivery(
  env: Env,
  sourcePostIds: string[],
  status: "delivered" | "not_selected" | "failed",
  error?: string,
): Promise<void> {
  if (sourcePostIds.length === 0) return;
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mark_linkedin_group_posts_delivery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      p_source_post_ids: sourcePostIds,
      p_status: status,
      p_error: error ?? null,
    }),
  });
  if (!response.ok) throw new Error(`Group delivery status ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

async function logScrapeRun(
  env: Env,
  job: GroupScrapeJob,
  postsFetched: number,
  uniquePostsSeen: number,
  harvestCost: number | null,
): Promise<void> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_linkedin_group_scrape_run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      p_scrape_run_id: job.scrapeRunId,
      p_group_id: job.group,
      p_page: job.page,
      p_posts_fetched: postsFetched,
      p_unique_posts_seen: uniquePostsSeen,
      p_harvest_cost: harvestCost,
    }),
  });
  if (!response.ok) {
    throw new Error(`LinkedIn scrape run log ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
}

async function deliverPosts(
  env: Env,
  groupId: string,
  posts: Array<Record<string, unknown>>,
): Promise<void> {
  if (posts.length === 0) return;
  const response = await fetchProcessor(env, {
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

// Bounds how much of the failed-delivery backlog one scheduled run will retry.
// Retries that keep failing (e.g. a downstream outage) must never be able to
// consume the whole run's resource budget and starve the actual new-group
// scrape below — that starvation is what silently zeroed out every scheduled
// run once the backlog grew large enough.
const MAX_RETRY_ROWS_PER_RUN = 40;

// A post stuck failing after this many delivery attempts is almost certainly
// permanently broken (bad content, not a transient outage) — stop retrying
// it so it doesn't keep eating into MAX_RETRY_ROWS_PER_RUN forever.
const MAX_DELIVERY_ATTEMPTS = 6;

async function retryFailedDeliveries(env: Env): Promise<number> {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/linkedin_groups_posts?select=group_id,source_post_id,raw_post&delivery_status=eq.failed&delivery_attempts=lt.${MAX_DELIVERY_ATTEMPTS}&order=last_seen_at.asc&limit=${MAX_RETRY_ROWS_PER_RUN}`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!response.ok) throw new Error(`Failed group delivery query ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const rows = await response.json<Array<{ group_id: string; source_post_id: string; raw_post: Record<string, unknown> }>>();
  const byGroup = new Map<string, typeof rows>();
  for (const row of rows) byGroup.set(row.group_id, [...(byGroup.get(row.group_id) ?? []), row]);

  let delivered = 0;
  for (const [groupId, groupRows] of byGroup) {
    for (const chunk of chunkArray(groupRows, RETRY_DELIVERY_CHUNK_SIZE)) {
      try {
        await deliverPosts(env, groupId, chunk.map((row) => row.raw_post));
        await markPostsDelivery(env, chunk.map((row) => row.source_post_id), "delivered");
        delivered += chunk.length;
      } catch (error) {
        // Per-chunk isolation: one stuck chunk must never block the remaining
        // chunks (same group or others), nor the rest of the scheduled run.
        await markPostsDelivery(env, chunk.map((row) => row.source_post_id), "failed", (error as Error).message).catch(() => {});
        console.error(`Retry delivery chunk failed for group ${groupId}: ${(error as Error).message}`);
      }
    }
  }
  return delivered;
}

async function processScrapeJob(job: GroupScrapeJob, env: Env): Promise<void> {
  const result = await fetchHarvestPage(job, env);
  const posts = Array.isArray(result.elements) ? result.elements : [];
  await logScrapedPosts(env, job, posts);
  const sourcePostIds = await Promise.all(posts.map((post) => getSourcePostId(post, job.group)));
  const remaining = Math.max(0, job.maxPostsPerGroup - job.postsDelivered);
  const selected = posts.slice(0, remaining);
  const selectedSourcePostIds = sourcePostIds.slice(0, selected.length);
  const notSelectedSourcePostIds = sourcePostIds.slice(selected.length);
  await markPostsDelivery(env, notSelectedSourcePostIds, "not_selected");
  // Deliver in the same small chunks retryFailedDeliveries() uses, instead of
  // the whole page (up to maxPostsPerGroup) in one request — a single
  // oversized request can exceed the processor's own execution budget and
  // strand the entire page, where a stuck chunk here only strands itself
  // (and gets picked up by the next scheduled retry pass).
  for (const chunkIndexes of chunkArray(selected.map((_, i) => i), RETRY_DELIVERY_CHUNK_SIZE)) {
    const postsChunk = chunkIndexes.map((i) => selected[i]);
    const idsChunk = chunkIndexes.map((i) => selectedSourcePostIds[i]);
    try {
      await deliverPosts(env, job.group, postsChunk);
      await markPostsDelivery(env, idsChunk, "delivered");
    } catch (error) {
      await markPostsDelivery(env, idsChunk, "failed", (error as Error).message);
      console.error(`Delivery chunk failed for group ${job.group}: ${(error as Error).message}`);
    }
  }
  await logScrapeRun(env, job, posts.length, new Set(sourcePostIds).size, result.cost ?? null);

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
      const activeGroups = await fetchActiveGroups(env);
      const requestedGroups = normalizeGroups(Array.isArray(payload.groups) ? payload.groups : []);
      const activeGroupSet = new Set(activeGroups);
      const selectedGroups = requestedGroups.length > 0
        ? requestedGroups.filter((group) => activeGroupSet.has(group))
        : activeGroups;
      const claimedGroups = await claimGroupsForScrape(
        env,
        selectedGroups,
        config.schedule_interval_hours,
        payload.force === true,
      );
      if (claimedGroups.length === 0) {
        return jsonResponse({
          success: true,
          groupsQueued: 0,
          groupsSkippedAsRecentlyScraped: selectedGroups.length,
          inactiveOrUnknownGroups: requestedGroups.filter((group) => !activeGroupSet.has(group)),
        }, 202);
      }
      const jobs = buildInitialJobs({ ...payload, groups: claimedGroups });
      await enqueueJobs(env.GROUP_SCRAPE_QUEUE, jobs);
      return jsonResponse({
        success: true,
        groupsQueued: jobs.length,
        groupsSkippedAsRecentlyScraped: selectedGroups.length - claimedGroups.length,
        inactiveOrUnknownGroups: requestedGroups.filter((group) => !activeGroupSet.has(group)),
      }, 202);
    } catch (error) {
      return jsonResponse({ error: (error as Error).message }, 400);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    // Claiming and queueing new groups runs first and is fully guarded —
    // a failed-delivery backlog that can't be retried successfully (e.g. a
    // downstream outage) must never be able to consume the run's resource
    // budget before this point and silently zero out every scheduled run,
    // which is what happened when the retry pass ran first, unguarded.
    try {
      await verifyProcessorAccess(env);
    } catch (error) {
      console.error(`Processor preflight failed: ${(error as Error).message}`);
    }
    try {
      const config = await fetchScraperConfig(env);
      if (!await claimScheduledRun(env, config)) {
        console.log(JSON.stringify({ event: "scheduled_scrape_skipped", enabled: config.is_enabled }));
      } else {
        const groups = await fetchActiveGroups(env);
        const claimedGroups = await claimGroupsForScrape(env, groups, config.schedule_interval_hours);
        if (claimedGroups.length === 0) {
          console.log(JSON.stringify({ event: "scheduled_scrape_skipped", reason: "no_groups_due" }));
        } else {
          const jobs = buildInitialJobs({
            groups: claimedGroups,
            postedLimit: config.posted_limit,
            sortBy: config.sort_by,
            maxPostsPerGroup: config.max_posts_per_group,
            maxPages: config.max_pages,
          });
          await enqueueJobs(env.GROUP_SCRAPE_QUEUE, jobs);
          console.log(JSON.stringify({
            event: "scheduled_groups_queued",
            groups: jobs.length,
            groupsSkippedAsRecentlyScraped: groups.length - claimedGroups.length,
          }));
        }
      }
    } catch (error) {
      console.error(`Scheduled group scrape errored: ${(error as Error).message}`);
    }
    try {
      const retriedPosts = await retryFailedDeliveries(env);
      if (retriedPosts > 0) console.log(JSON.stringify({ event: "failed_group_deliveries_retried", posts: retriedPosts }));
    } catch (error) {
      console.error(`Failed delivery retry errored: ${(error as Error).message}`);
    }
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
