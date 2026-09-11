import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";
const ADMIN_POST_OUTREACH_WORKER_URL = "https://profilepush-admin-post-outreach.profilepush-ai.workers.dev";

type Kind = "job" | "hotlist";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleList(
  supabase: ReturnType<typeof createClient>,
  kind: Kind,
  startDate: string | null,
  endDate: string | null,
  limit: number,
  offset: number,
) {
  // Deduped by the poster's own profile link (one row per profile, most
  // recent post kept) — the same recruiter/vendor frequently posts the
  // identical req or consultant across several groups.
  const rpc = kind === "job" ? "get_admin_job_posts_page" : "get_admin_hotlist_posts_page";
  const { data, error } = await supabase.rpc(rpc, {
    p_start_date: startDate,
    p_end_date: endDate,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);

  const rawRows = (data ?? []) as Array<Record<string, unknown>>;
  const rows = rawRows.map((row) => ({
    id: row.id,
    post_url: row.post_url,
    content: row.content,
    title: row.title,
    company: row.company,
    created_at: row.created_at,
  }));
  const total = rawRows[0]?.total_count ?? 0;

  return { rows, total };
}

// Thin proxies to the admin-post-outreach Cloudflare Worker, which owns the
// actual Workers AI drafting + Cloudflare Queue processing. Authenticated by
// possession of the Supabase service-role key — this function already has
// it via its own Deno env (standard for every Supabase Edge Function), and
// the worker independently holds the same value as its own secret, so no
// new shared secret needs provisioning on either side.
async function callOutreachWorker(path: string, serviceRoleKey: string, body: unknown) {
  const response = await fetch(`${ADMIN_POST_OUTREACH_WORKER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `admin-post-outreach worker HTTP ${response.status}`);
  return payload;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { password, action } = body;

    if (password !== ADMIN_PASSWORD) {
      return jsonResponse({ error: "Invalid password" }, 401);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

    const kind: Kind = body.kind === "hotlist" ? "hotlist" : "job";

    if (action === "list") {
      const limit = typeof body.limit === "number" ? Math.min(body.limit, 50) : 50;
      const offset = typeof body.offset === "number" ? body.offset : 0;
      const result = await handleList(supabase, kind, body.start_date ?? null, body.end_date ?? null, limit, offset);
      return jsonResponse(result);
    }

    if (action === "generate_comments") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === "string") : [];
      if (ids.length === 0) return jsonResponse({ error: "ids is required" }, 400);
      if (ids.length > 50) return jsonResponse({ error: "Bulk generate is limited to 50 posts at a time" }, 400);
      const result = await callOutreachWorker("/generate-comments", serviceRoleKey, { kind, ids });
      return jsonResponse(result);
    }

    if (action === "comment_status") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === "string") : [];
      if (ids.length === 0) return jsonResponse({ results: [] });
      const result = await callOutreachWorker("/comment-status", serviceRoleKey, { ids });
      return jsonResponse(result);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
