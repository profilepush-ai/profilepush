export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  PARSER_MODEL: string;
  AI: Ai;
  COMMENT_QUEUE: Queue<CommentJob>;
}

type Kind = "job" | "hotlist";
interface CommentJob {
  post_id: string;
  kind: Kind;
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

// Authorized purely by possession of the Supabase service-role key — the
// same key the calling admin-posts edge function already has via its own
// Deno env, and the same key this worker independently holds as a secret.
// No new shared secret needs provisioning on either side.
function isAuthorized(request: Request, env: Env): boolean {
  const token = getBearerToken(request).trim();
  return !!token && token === env.SUPABASE_SERVICE_ROLE_KEY.trim();
}

function serviceHeaders(env: Env, json = false): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

async function supabaseRequest(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(env), ...(init.headers ?? {}) },
  });
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function fetchPostContent(env: Env, kind: Kind, postId: string): Promise<string | null> {
  const table = kind === "job" ? "social_jobs" : "social_hotlist";
  const contentCol = kind === "job" ? "post_content" : "raw_post_content";
  const response = await supabaseRequest(env, `${table}?id=eq.${postId}&select=${contentCol}&limit=1`);
  if (!response.ok) throw new Error(`fetch ${table} failed: HTTP ${response.status}`);
  const rows = await response.json<Record<string, string>[]>();
  return rows[0]?.[contentCol] ?? null;
}

async function countMatching(env: Env, kind: Kind, postId: string): Promise<number> {
  const rpc = kind === "job" ? "count_matching_hotlist_profiles_for_job" : "count_matching_jobs_for_hotlist";
  const param = kind === "job" ? "p_job_id" : "p_hotlist_id";
  const response = await supabaseRequest(env, `rpc/${rpc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [param]: postId }),
  });
  if (!response.ok) throw new Error(`${rpc} failed: HTTP ${response.status}`);
  return await response.json<number>();
}

// Validates against the SPECIFIC matching count given, not just "contains a
// digit somewhere" — smaller models (llama-3.1-8b) will happily echo an
// unrelated number already present in the source post content instead of
// the count they were told to use, which passes a looser digit check but
// produces a misleading comment.
function normalizeComment(raw: string, link: string, matchingCount: number): string | null {
  const comment = raw.trim().replace(/^```[a-z]*\s*/i, "").replace(/```$/i, "").replace(/^["'`]|["'`]$/g, "").trim();
  const wordCount = comment.split(/\s+/).filter(Boolean).length;
  if (!comment) return null;
  if (wordCount > 30) return null;
  if (!comment.includes(String(matchingCount))) return null;
  if (!comment.includes(link)) return null;
  return comment;
}

function fallbackComment(kind: Kind, matchingCount: number, link: string): string {
  return kind === "job"
    ? `${matchingCount} matching consultants already available for this exact role. See them free: ${link}`
    : `${matchingCount} matching job requirements posted for this exact profile right now. Check them: ${link}`;
}

const JOB_COMMENT_PROMPT = `You write short, punchy LinkedIn comments (under 30 words) on job requirement posts, designed to grab the poster's attention. Always lead with or include the exact number given (matching consultant profiles already available) — this is the core hook. Urgent, direct, no fluff, no greetings, no hashtags. End with exactly the link given. Never mention any product/company name. Return ONLY the comment text, nothing else — no quotes, no explanation.`;

const HOTLIST_COMMENT_PROMPT = `You write short, punchy LinkedIn comments (under 30 words) on bench-sales consultant posts, designed to grab the poster's attention. Always lead with or include the exact number given (matching job requirements already available) — this is the core hook. Urgent, direct, no fluff, no greetings, no hashtags. End with exactly the link given. Never mention any product/company name. Return ONLY the comment text, nothing else — no quotes, no explanation.`;

async function draftComment(env: Env, kind: Kind, postContent: string, matchingCount: number): Promise<string> {
  const link = kind === "job" ? "https://profilepush.ai/vendors" : "https://profilepush.ai/bench-sales";
  const systemPrompt = kind === "job" ? JOB_COMMENT_PROMPT : HOTLIST_COMMENT_PROMPT;
  const userPrompt = `Post content: ${postContent.slice(0, 800)}\n\nMatching count: ${matchingCount}\nLink to end with: ${link}`;

  try {
    const aiResult = await env.AI.run(env.PARSER_MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 100,
    });
    const raw = String((aiResult as Record<string, unknown>)?.response ?? "");
    const normalized = normalizeComment(raw, link, matchingCount);
    if (normalized) return normalized;
    throw new Error("AI comment failed validation");
  } catch (error) {
    console.error("draftComment failed, using fallback", error);
    return fallbackComment(kind, matchingCount, link);
  }
}

async function upsertResult(
  env: Env,
  postId: string,
  kind: Kind,
  fields: { comment?: string; matching_count?: number; status: "done" | "failed" },
): Promise<void> {
  const response = await supabaseRequest(env, "admin_post_comments?on_conflict=post_id", {
    method: "POST",
    headers: { ...serviceHeaders(env, true), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      post_id: postId,
      kind,
      generated_at: new Date().toISOString(),
      ...fields,
    }),
  });
  if (!response.ok) throw new Error(`upsert admin_post_comments failed: HTTP ${response.status}`);
}

async function handleGenerateComments(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) return jsonResponse({ error: "Unauthorized" }, 401);
  const body = await request.json<{ kind?: unknown; ids?: unknown }>();
  const kind: Kind = body.kind === "hotlist" ? "hotlist" : "job";
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  const boundedIds = ids.slice(0, 200);

  for (const chunk of chunkArray(boundedIds, 100)) {
    // Cloudflare Queue sendBatch currently supports up to 100 messages per request.
    await env.COMMENT_QUEUE.sendBatch(chunk.map((id) => ({ body: { post_id: id, kind } satisfies CommentJob })));
  }

  return jsonResponse({ enqueued: boundedIds.length });
}

async function handleCommentStatus(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) return jsonResponse({ error: "Unauthorized" }, 401);
  const body = await request.json<{ ids?: unknown }>();
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  if (ids.length === 0) return jsonResponse({ results: [] });

  const response = await supabaseRequest(
    env,
    `admin_post_comments?post_id=in.(${ids.join(",")})&select=post_id,comment,matching_count,status`,
  );
  if (!response.ok) throw new Error(`fetch admin_post_comments failed: HTTP ${response.status}`);
  const rows = await response.json();
  return jsonResponse({ results: rows });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    try {
      if (request.method === "GET") return jsonResponse({ status: "ok" });
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
      if (pathname === "/generate-comments") return await handleGenerateComments(request, env);
      if (pathname === "/comment-status") return await handleCommentStatus(request, env);
      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error("admin-post-outreach request failed", error);
      return jsonResponse({ error: (error as Error).message }, 500);
    }
  },

  async queue(batch: MessageBatch<CommentJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const { post_id, kind } = message.body;
        const content = await fetchPostContent(env, kind, post_id);
        if (!content) {
          // Post no longer exists / content missing — nothing useful to
          // retry towards, acknowledge and move on.
          message.ack();
          continue;
        }
        const matchingCount = await countMatching(env, kind, post_id);
        if (matchingCount <= 0) {
          // A "0 matches" comment has nothing real to hook on — skip AI
          // drafting entirely rather than let the model fabricate a claim.
          await upsertResult(env, post_id, kind, { comment: undefined, matching_count: 0, status: "done" });
          message.ack();
          continue;
        }
        const comment = await draftComment(env, kind, content, matchingCount);
        await upsertResult(env, post_id, kind, { comment, matching_count: matchingCount, status: "done" });
        message.ack();
      } catch (error) {
        console.error("admin-post-outreach queue job failed", error);
        message.retry();
      }
    }
  },
};
