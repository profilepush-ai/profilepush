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
  const table = kind === "job" ? "social_jobs" : "social_hotlist";
  const columns = kind === "job"
    ? "id, post_url, post_content, job_title, company_name, created_at, posted_at"
    : "id, post_url, raw_post_content, role_title, bench_sales_company_name, created_at, posted_at";

  let query = supabase
    .from(table)
    .select(columns, { count: "exact" })
    .eq("post_source", "linkedin_scrape")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (startDate) query = query.gte("created_at", startDate);
  if (endDate) query = query.lte("created_at", endDate);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    post_url: row.post_url,
    content: kind === "job" ? row.post_content : row.raw_post_content,
    title: kind === "job" ? row.job_title : row.role_title,
    company: kind === "job" ? row.company_name : row.bench_sales_company_name,
    created_at: row.created_at,
  }));

  return { rows, total: count ?? rows.length };
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
