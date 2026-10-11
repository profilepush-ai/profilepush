import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { embedTexts, hotlistText, jobText, toVector } from "../_shared/embeddings.ts";

// Fills embeddings_cf with Cloudflare vectors for jobs and consultant posts
// that don't have one yet, newest first. Internal accounts only.
//   POST { kind: "job" | "hotlist", limit?: number (max 500), shard?: "0-3" }
//   -> { embedded, left }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const respond = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return respond({ error: "Unauthorized" }, 401);
  const { data: member } = await admin.from("account_members").select("accounts(is_internal)")
    .eq("user_id", user.id).eq("status", "active").order("created_at").limit(1).maybeSingle();
  if (!(member as { accounts?: { is_internal?: boolean } } | null)?.accounts?.is_internal) return respond({ error: "Internal accounts only." }, 403);

  const body = await req.json().catch(() => ({})) as { kind?: string; limit?: number; shard?: string };
  const kind = body.kind === "hotlist" ? "hotlist" : "job";
  const limit = Math.min(Math.max(Number(body.limit) || 300, 1), 500);
  try {
    const { data: ids, error: idErr } = await admin.rpc("embeddings_cf_todo", { p_kind: kind, p_limit: limit, p_shard: body.shard ?? null });
    if (idErr) throw idErr;
    const todo = (ids ?? []).map((r: { id: string }) => r.id);
    if (todo.length === 0) return respond({ embedded: 0, left: 0 });
    const { data: rows, error } = kind === "job"
      ? await admin.from("social_jobs").select("id, job_title, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max, location, job_description, post_content").in("id", todo)
      : await admin.from("social_hotlist").select("id, role_title, core_skills, years_experience, visa_type, hourly_rate_min, hourly_rate_max, locations, employment_type, raw_post_content").in("id", todo);
    if (error) throw error;
    const list = (rows ?? []) as Record<string, unknown>[];
    const vectors = await embedTexts(list.map((r) => (kind === "job" ? jobText(r) : hotlistText(r))));
    const { error: upErr } = await admin.from("embeddings_cf").upsert(list.map((r, i) => ({ post_id: r.id, kind, embedding: toVector(vectors[i]) })));
    if (upErr) throw upErr;
    return respond({ embedded: list.length });
  } catch (error) {
    console.error("embed-backfill", error);
    return respond({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
