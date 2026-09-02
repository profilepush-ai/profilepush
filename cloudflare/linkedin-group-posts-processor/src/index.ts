export interface Env {
  SUPABASE_WEBHOOK_URL: string;
  SUPABASE_WEBHOOK_TOKEN?: string;
  WORKER_AUTH_TOKEN?: string;
}

type RawPost = Record<string, unknown>;

type ProcessorPayload = {
  groupId?: unknown;
  group_id?: unknown;
  keywordId?: unknown;
  keyword_id?: unknown;
  posts?: RawPost[];
  scrapedPosts?: RawPost[];
  items?: RawPost[];
  data?: RawPost[];
};

type SocialJobRow = {
  post_id: string;
  group_id: string;
  platform: string;
  post_content: string;
  posted_by_name: string;
  posted_at: string;
  profile_link: string;
  post_url: string;
  job_title: string;
  company_name: string;
  location: string;
  employment_type: string;
  seniority_level: string;
  job_description: string;
  salary_range: string;
  source_keyword_id?: string;
  image_urls: string[];
  avatar_url: string;
};

// Each post is classified individually (not batched into one prompt) because
// batching multiple posts into a single AI call was losing context between
// them. Sequential single-post calls were previously the only way to keep
// that isolation, but that serializes a whole page of posts one at a time —
// running a small pool of them concurrently keeps the same per-post
// isolation while cutting wall-clock time roughly by the pool size.
const CLASSIFY_CONCURRENCY = 3;
const MAX_POSTS_PER_REQUEST = 200;

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
  return results;
}

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
  if (new URL(request.url).hostname === "processor.internal") return true;
  const expected = (expectedToken ?? "").trim();
  return expected.length === 0 || getBearerToken(request) === expected;
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

function extractGroupId(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, "");
    if (["groupid", "sourcegroupid", "communityid", "group"].includes(normalizedKey)) {
      return asString(candidate);
    }
  }
  return "";
}

export function extractPostId(url: string): string {
  const groupPostMatch = url.match(/urn:li:groupPost:\d+-(\d+)/i);
  if (groupPostMatch) return groupPostMatch[1];
  const activityMatch = url.match(/(?:activity|urn:li:activity)[:-](\d+)/i);
  return activityMatch?.[1] ?? "";
}

function toIsoDate(value: unknown): string | null {
  if (typeof value === "number") {
    const milliseconds = value > 9_999_999_999 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim() && !value.includes("[object")) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return toIsoDate(objectValue.timestamp ?? objectValue.date ?? objectValue.seconds);
  }
  return null;
}

function isLikelyStaffingPost(value: string): boolean {
  const text = value.toLowerCase();
  if (!text.trim()) return false;
  const signals = [
    "hiring", "opening", "position", "role", "requirements", "experience",
    "c2c", "w2", "contract", "full-time", "onsite", "remote", "hybrid",
    "rate", "resume", "skills", "hotlist", "bench", "consultant",
    "availability", "available", "marketing", "open roles", "share requirements",
  ];
  let hits = 0;
  for (const signal of signals) {
    if (text.includes(signal)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

function extractImageUrls(post: RawPost): string[] {
  const images = post.postImages ?? post.images ?? post.media;
  if (!Array.isArray(images)) return [];
  return images
    .map((image) => (image && typeof image === "object" ? asString((image as Record<string, unknown>).url) : asString(image)))
    .filter(Boolean);
}

function getAuthor(post: RawPost): { name: string; profileUrl: string; avatarUrl: string } {
  const author = post.author && typeof post.author === "object"
    ? post.author as Record<string, unknown>
    : {};
  // HarvestAPI's documented shape is author.avatar = { url, width, height,
  // expiresAt } — but that's not something we can pin down from a fixture in
  // this repo, so fall back to a few plausible alternate shapes/key names
  // rather than assuming the one we found in their docs is exact and final.
  const avatarObject = author.avatar && typeof author.avatar === "object"
    ? author.avatar as Record<string, unknown>
    : {};
  return {
    name: firstString(
      post.owner_name,
      post.authorName,
      post.posted_by_name,
      author.name,
      typeof post.author === "string" ? post.author : "",
    ),
    profileUrl: firstString(
      post.owner_profile_url,
      post.authorLinkedinUrl,
      post.authorProfileUrl,
      post.profile_link,
      author.linkedinUrl,
    ),
    avatarUrl: firstString(
      avatarObject.url,
      author.avatarUrl,
      author.pictureUrl,
      author.profilePictureUrl,
      author.imageUrl,
      typeof author.avatar === "string" ? author.avatar : "",
    ),
  };
}

async function generatedPostId(post: RawPost, sourceId: string, content: string): Promise<string> {
  const input = `${sourceId}\n${firstString(post.linkedinUrl, post.post_url, post.url)}\n${content}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return `gen_${Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function normalizePost(post: RawPost, globalGroupId: string, keywordId: string): Promise<SocialJobRow | null> {
  const content = firstString(post.text, post.content, post.post_content, post.description);
  if (!isLikelyStaffingPost(content)) return null;

  const postUrl = firstString(post.linkedinUrl, post.post_url, post.url, post.postUrl, post["post URL"]);
  const explicitPostId = firstString(post.id, post.post_id, post.postId);
  const postId = explicitPostId || extractPostId(postUrl) || await generatedPostId(post, globalGroupId || keywordId, content);
  const groupId = extractGroupId(post) || globalGroupId;
  const author = getAuthor(post);
  const postedAt = toIsoDate(post.timestamp)
    ?? toIsoDate(post.postedAt)
    ?? toIsoDate(post.posted_at)
    ?? toIsoDate(post.time)
    ?? new Date().toISOString();

  return {
    post_id: postId,
    group_id: groupId,
    platform: "linkedin",
    post_content: content,
    posted_by_name: author.name,
    posted_at: postedAt,
    profile_link: author.profileUrl,
    avatar_url: author.avatarUrl,
    post_url: postUrl,
    job_title: firstString(post.job_title, post.title),
    company_name: firstString(post.company_name, post.company),
    location: asString(post.location),
    employment_type: asString(post.employment_type),
    seniority_level: asString(post.seniority_level),
    job_description: content,
    salary_range: asString(post.salary_range),
    image_urls: extractImageUrls(post),
    ...(keywordId ? { source_keyword_id: keywordId } : {}),
  };
}

function extractPosts(payload: unknown): { groupId: string; keywordId: string; posts: RawPost[] } {
  if (Array.isArray(payload)) return { groupId: "", keywordId: "", posts: payload as RawPost[] };
  if (!payload || typeof payload !== "object") return { groupId: "", keywordId: "", posts: [] };

  const objectPayload = payload as ProcessorPayload;
  const posts = objectPayload.posts
    ?? objectPayload.scrapedPosts
    ?? objectPayload.items
    ?? objectPayload.data
    ?? [];
  return {
    groupId: firstString(objectPayload.groupId, objectPayload.group_id, extractGroupId(objectPayload)),
    keywordId: firstString(objectPayload.keywordId, objectPayload.keyword_id),
    posts: Array.isArray(posts) ? posts : [],
  };
}

async function sendBatch(env: Env, rows: SocialJobRow[]): Promise<number> {
  const response = await fetch(env.SUPABASE_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.SUPABASE_WEBHOOK_TOKEN
        ? { Authorization: `Bearer ${env.SUPABASE_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    throw new Error(`Supabase webhook ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const result = await response.json<Record<string, unknown>>().catch(() => ({}));
  return Number(result.enqueued_count ?? 0);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "HEAD") {
      return isAuthorized(request, env.WORKER_AUTH_TOKEN)
        ? new Response(null, { status: 204 })
        : new Response(null, { status: 401 });
    }
    if (request.method === "GET") return jsonResponse({ status: "ok" });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    if (!isAuthorized(request, env.WORKER_AUTH_TOKEN)) return jsonResponse({ error: "Unauthorized" }, 401);

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const { groupId, keywordId, posts } = extractPosts(payload);
    if (posts.length === 0) return jsonResponse({ error: "posts array is required" }, 400);
    if (posts.length > MAX_POSTS_PER_REQUEST) {
      return jsonResponse({ error: `A maximum of ${MAX_POSTS_PER_REQUEST} posts is allowed` }, 413);
    }

    try {
      const normalized = await Promise.all(posts.map((post) => normalizePost(post, groupId, keywordId)));
      const acceptedRows = normalized.filter((row): row is SocialJobRow => row !== null);
      const rows = [...new Map(
        acceptedRows.map((row) => [`${row.platform}:${row.post_id}`, row]),
      ).values()];
      const enqueuedCounts = await runWithConcurrency(rows, CLASSIFY_CONCURRENCY, (row) => sendBatch(env, [row]));
      const enqueued = enqueuedCounts.reduce((sum, count) => sum + count, 0);

      return jsonResponse({
        success: true,
        received: posts.length,
        accepted: rows.length,
        filtered: posts.length - acceptedRows.length,
        duplicates: acceptedRows.length - rows.length,
        enqueued,
      });
    } catch (error) {
      console.error(`Post processing failed: ${(error as Error).message}`);
      return jsonResponse({ error: (error as Error).message }, 502);
    }
  },
};
