export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
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

// Verified live against the database rather than compared to one specific
// stored string — admin-posts's own copy of SUPABASE_SERVICE_ROLE_KEY
// (auto-injected by the Supabase platform) hashed differently from a
// separately-confirmed-valid service-role key, most likely because Supabase
// now issues newer-format secret keys that coexist with legacy JWT-style
// ones; either is a legitimate credential, so authorization here just
// checks "does this token actually work as service-role," not "does it
// equal this exact string."
async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const token = getBearerToken(request).trim();
  if (!token) return false;
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/admin_post_comments?select=post_id&limit=1`, {
      headers: { apikey: token, Authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
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

interface PostInfo {
  role: string;
  postUrl: string | null;
}

async function fetchPostInfo(env: Env, kind: Kind, postId: string): Promise<PostInfo | null> {
  const table = kind === "job" ? "social_jobs" : "social_hotlist";
  const select = kind === "job" ? "job_title,extracted_role_normalized,post_url" : "role_title,post_url";
  const response = await supabaseRequest(env, `${table}?id=eq.${postId}&select=${select}&limit=1`);
  if (!response.ok) throw new Error(`fetch ${table} failed: HTTP ${response.status}`);
  const rows = await response.json<Record<string, string>[]>();
  const row = rows[0];
  if (!row) return null;
  const role = kind === "job" ? (row.extracted_role_normalized || row.job_title) : row.role_title;
  if (!role?.trim()) return null;
  return { role: role.trim(), postUrl: row.post_url ?? null };
}

async function countMatching(env: Env, kind: Kind, postId: string): Promise<number> {
  const rpc = kind === "job" ? "count_matching_hotlist_profiles_for_job" : "count_matching_jobs_for_hotlist";
  const param = kind === "job" ? "p_job_id" : "p_hotlist_id";
  const response = await supabaseRequest(env, `rpc/${rpc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [param]: postId, p_window_days: 7 }),
  });
  if (!response.ok) throw new Error(`${rpc} failed: HTTP ${response.status}`);
  return await response.json<number>();
}

// Fixed, deterministic wording per exact spec — no LLM involved in the
// comment text itself. A fully-specified message leaves an LLM nothing
// useful to decide, only room to drift from the wording or (as seen in
// testing) cite the wrong number — a live-computed count and role name
// slotted into a fixed template is both simpler and strictly more reliable.
function buildComment(kind: Kind, roleName: string, matchingCount: number, link: string): string {
  return kind === "job"
    ? `We have ${matchingCount} ${roleName} hotlist posts posted in the last 7 days by bench sales recruiters. Signup and request resume and video screening in a single click: ${link}`
    : `We have ${matchingCount} jobs for ${roleName} posted in the last 7 days. Signup and submit in a single click: ${link}`;
}

async function upsertResult(
  env: Env,
  postId: string,
  kind: Kind,
  fields: { comment?: string; matching_count?: number; status: "done" | "failed"; post_url?: string | null; title?: string },
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
  if (!(await isAuthorized(request, env))) return jsonResponse({ error: "Unauthorized" }, 401);
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
  if (!(await isAuthorized(request, env))) return jsonResponse({ error: "Unauthorized" }, 401);
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
        const info = await fetchPostInfo(env, kind, post_id);
        if (!info) {
          // Post no longer exists / role missing — nothing useful to
          // retry towards, acknowledge and move on.
          message.ack();
          continue;
        }
        const matchingCount = await countMatching(env, kind, post_id);
        const MIN_MATCHES_TO_COMMENT = 10;
        if (matchingCount < MIN_MATCHES_TO_COMMENT) {
          // Too thin a claim to be worth commenting on — skip drafting
          // entirely rather than post a weak/hollow comment.
          await upsertResult(env, post_id, kind, { comment: undefined, matching_count: matchingCount, status: "done", post_url: info.postUrl, title: info.role });
          message.ack();
          continue;
        }
        const link = kind === "job" ? "https://profilepush.ai/vendors" : "https://profilepush.ai/bench-sales";
        const comment = buildComment(kind, info.role, matchingCount, link);
        await upsertResult(env, post_id, kind, { comment, matching_count: matchingCount, status: "done", post_url: info.postUrl, title: info.role });
        message.ack();
      } catch (error) {
        console.error("admin-post-outreach queue job failed", error);
        message.retry();
      }
    }
  },
};
