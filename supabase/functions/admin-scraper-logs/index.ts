import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const body = await request.json();
    const adminPassword = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";
    if (body?.password !== adminPassword) return respond({ error: "Invalid password" }, 401);

    const start = String(body?.start ?? "");
    const end = String(body?.end ?? "");
    const startTime = Date.parse(start);
    const endTime = Date.parse(end);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      return respond({ error: "Valid start and end dates are required" }, 400);
    }
    if (startTime >= endTime) return respond({ error: "Start date must be before end date" }, 400);
    if (endTime - startTime > 31 * 24 * 60 * 60 * 1000) {
      return respond({ error: "Date range cannot exceed 31 days" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await supabase.rpc("get_hourly_linkedin_scraper_pipeline_logs", {
      p_start: new Date(startTime).toISOString(),
      p_end: new Date(endTime).toISOString(),
    });
    if (error) return respond({ error: error.message }, 500);

    const rows = (data ?? []).map((row) => ({
      scraper_type: row.scraper_type,
      hour_start: row.hour_start,
      scraped_posts_count: Number(row.scraped_posts_count ?? 0),
      social_jobs_count: Number(row.social_jobs_count ?? 0),
      radar_results_count: Number(row.radar_results_count ?? 0),
      harvest_cost: Number(row.harvest_cost ?? 0),
    }));
    return respond({ rows, start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString() });
  } catch (error) {
    return respond({ error: (error as Error).message }, 500);
  }
});