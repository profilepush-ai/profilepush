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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const action = String(body?.action ?? "list");

    if (action === "list") {
      const statsStart = body?.stats_start ? String(body.stats_start) : null;
      const statsEnd = body?.stats_end ? String(body.stats_end) : null;
      if (statsStart && Number.isNaN(Date.parse(statsStart))) return respond({ error: "Invalid stats_start date" }, 400);
      if (statsEnd && Number.isNaN(Date.parse(statsEnd))) return respond({ error: "Invalid stats_end date" }, 400);
      if (statsStart && statsEnd && Date.parse(statsStart) >= Date.parse(statsEnd)) {
        return respond({ error: "Start date must be before end date" }, 400);
      }
      const [keywordsResult, configResult, statsResult] = await Promise.all([
        supabase
          .from("linkedin_keywords")
          .select("id,keyword,is_active,last_scraped_at,created_at,updated_at")
          .order("keyword", { ascending: true })
          .limit(1000),
        supabase
          .from("linkedin_keyword_scraper_config")
          .select("is_enabled,max_pages,max_posts_per_keyword,posted_limit,sort_by,schedule_interval_hours,last_scheduled_at,updated_at")
          .eq("id", true)
          .single(),
        supabase.rpc("get_linkedin_keyword_performance_stats", { p_start: statsStart, p_end: statsEnd }),
      ]);
      if (keywordsResult.error) return respond({ error: keywordsResult.error.message }, 500);
      if (configResult.error) return respond({ error: configResult.error.message }, 500);
      if (statsResult.error) return respond({ error: statsResult.error.message }, 500);
      const statsByKeyword = new Map((statsResult.data ?? []).map((row) => [row.keyword_id, row]));
      const keywords = (keywordsResult.data ?? []).map((keyword) => ({
        ...keyword,
        scraped_posts_count: Number(statsByKeyword.get(keyword.id)?.scraped_posts_count ?? 0),
        social_jobs_count: Number(statsByKeyword.get(keyword.id)?.social_jobs_count ?? 0),
        radar_results_count: Number(statsByKeyword.get(keyword.id)?.radar_results_count ?? 0),
      }));
      return respond({ keywords, config: configResult.data });
    }

    if (action === "update_config") {
      const config = {
        is_enabled: body?.is_enabled,
        max_pages: Number(body?.max_pages),
        max_posts_per_keyword: Number(body?.max_posts_per_keyword),
        posted_limit: String(body?.posted_limit ?? ""),
        sort_by: String(body?.sort_by ?? ""),
        schedule_interval_hours: Number(body?.schedule_interval_hours),
        updated_at: new Date().toISOString(),
      };
      if (typeof config.is_enabled !== "boolean") return respond({ error: "is_enabled must be boolean" }, 400);
      if (!Number.isInteger(config.max_pages) || config.max_pages < 1 || config.max_pages > 20) return respond({ error: "max_pages must be between 1 and 20" }, 400);
      if (!Number.isInteger(config.max_posts_per_keyword) || config.max_posts_per_keyword < 1 || config.max_posts_per_keyword > 1000) return respond({ error: "max_posts_per_keyword must be between 1 and 1000" }, 400);
      if (!["24h", "week", "month"].includes(config.posted_limit)) return respond({ error: "Invalid posted_limit" }, 400);
      if (!["date", "relevance"].includes(config.sort_by)) return respond({ error: "Invalid sort_by" }, 400);
      if (!Number.isInteger(config.schedule_interval_hours) || config.schedule_interval_hours < 1 || config.schedule_interval_hours > 24) return respond({ error: "schedule_interval_hours must be between 1 and 24" }, 400);
      const { data, error } = await supabase
        .from("linkedin_keyword_scraper_config")
        .update(config)
        .eq("id", true)
        .select("is_enabled,max_pages,max_posts_per_keyword,posted_limit,sort_by,schedule_interval_hours,last_scheduled_at,updated_at")
        .single();
      if (error) return respond({ error: error.message }, 400);
      return respond({ success: true, config: data });
    }

    if (action === "set_scheduler_enabled") {
      if (typeof body?.is_enabled !== "boolean") return respond({ error: "is_enabled must be boolean" }, 400);
      const { data, error } = await supabase
        .from("linkedin_keyword_scraper_config")
        .update({ is_enabled: body.is_enabled, updated_at: new Date().toISOString() })
        .eq("id", true)
        .select("is_enabled,max_pages,max_posts_per_keyword,posted_limit,sort_by,schedule_interval_hours,last_scheduled_at,updated_at")
        .single();
      if (error) return respond({ error: error.message }, 400);
      return respond({ success: true, config: data });
    }

    if (action === "trigger_scrape") {
      const { data: config, error: configError } = await supabase
        .from("linkedin_keyword_scraper_config")
        .select("max_pages,max_posts_per_keyword,posted_limit,sort_by")
        .eq("id", true)
        .single();
      if (configError) return respond({ error: configError.message }, 500);
      const scraperUrl = (Deno.env.get("LINKEDIN_KEYWORD_SCRAPER_URL") ?? "").trim();
      const scraperToken = (Deno.env.get("LINKEDIN_KEYWORD_SCRAPER_TOKEN") ?? "").trim();
      if (!scraperUrl || !scraperToken) return respond({ error: "LinkedIn keyword scraper trigger is not configured" }, 500);
      const scraperResponse = await fetch(scraperUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${scraperToken}` },
        body: JSON.stringify({
          maxPages: config.max_pages,
          maxPostsPerKeyword: config.max_posts_per_keyword,
          postedLimit: config.posted_limit,
          sortBy: config.sort_by,
        }),
      });
      const result = await scraperResponse.json().catch(() => ({}));
      if (!scraperResponse.ok) return respond({ error: result?.error ?? `Scraper returned HTTP ${scraperResponse.status}` }, 502);
      return respond({ success: true, ...result }, 202);
    }

    if (action === "create") {
      const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : "";
      if (keyword.length < 2 || keyword.length > 200) return respond({ error: "Keyword must be between 2 and 200 characters" }, 400);
      const { data, error } = await supabase
        .from("linkedin_keywords")
        .insert({ keyword })
        .select("id,keyword")
        .single();
      if (error) return respond({ error: error.message }, 400);
      return respond({ success: true, keyword: data }, 201);
    }

    const keywordId = typeof body?.keyword_id === "string" ? body.keyword_id.trim() : "";
    if (!keywordId) return respond({ error: "keyword_id is required" }, 400);

    if (action === "set_active") {
      if (typeof body?.is_active !== "boolean") return respond({ error: "is_active must be boolean" }, 400);
      const { error } = await supabase
        .from("linkedin_keywords")
        .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
        .eq("id", keywordId);
      if (error) return respond({ error: error.message }, 400);
      return respond({ success: true, keyword_id: keywordId, is_active: body.is_active });
    }

    if (action === "delete") {
      const { error } = await supabase.from("linkedin_keywords").delete().eq("id", keywordId);
      if (error) return respond({ error: error.message }, 400);
      return respond({ success: true, keyword_id: keywordId });
    }

    return respond({ error: "Unsupported action" }, 400);
  } catch (error) {
    return respond({ error: (error as Error).message }, 500);
  }
});