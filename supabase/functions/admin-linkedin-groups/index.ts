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

function normalizeGroupId(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const input = String(value).trim();
  return input.match(/linkedin\.com\/groups\/(\d+)/i)?.[1] ?? input;
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
      const [groupsResult, configResult, statsResult] = await Promise.all([
        supabase
          .from("linkedin_groups")
          .select("group_id,group_name,is_active,last_scraped_at,created_at,updated_at")
          .order("group_id", { ascending: true })
          .limit(1000),
        supabase
          .from("linkedin_scraper_config")
          .select("is_enabled,max_pages,max_posts_per_group,posted_limit,sort_by,schedule_interval_hours,last_scheduled_at,updated_at")
          .eq("id", true)
          .single(),
        supabase.rpc("get_linkedin_group_performance_stats", {
          p_start: statsStart,
          p_end: statsEnd,
        }),
      ]);
      if (groupsResult.error) return respond({ error: groupsResult.error.message }, 500);
      if (configResult.error) return respond({ error: configResult.error.message }, 500);
      if (statsResult.error) return respond({ error: statsResult.error.message }, 500);
      const statsByGroup = new Map((statsResult.data ?? []).map((row) => [row.group_id, row]));
      const groups = (groupsResult.data ?? []).map((group) => ({
        ...group,
        scraped_posts_count: Number(statsByGroup.get(group.group_id)?.scraped_posts_count ?? 0),
        social_jobs_count: Number(statsByGroup.get(group.group_id)?.social_jobs_count ?? 0),
        radar_results_count: Number(statsByGroup.get(group.group_id)?.radar_results_count ?? 0),
      }));
      return respond({ groups, config: configResult.data });
    }

    if (action === "update_config") {
      const config = {
        is_enabled: body?.is_enabled,
        max_pages: Number(body?.max_pages),
        max_posts_per_group: Number(body?.max_posts_per_group),
        posted_limit: String(body?.posted_limit ?? ""),
        sort_by: String(body?.sort_by ?? ""),
        schedule_interval_hours: Number(body?.schedule_interval_hours),
        updated_at: new Date().toISOString(),
      };
      if (typeof config.is_enabled !== "boolean") return respond({ error: "is_enabled must be boolean" }, 400);
      if (!Number.isInteger(config.max_pages) || config.max_pages < 1 || config.max_pages > 20) return respond({ error: "max_pages must be between 1 and 20" }, 400);
      if (!Number.isInteger(config.max_posts_per_group) || config.max_posts_per_group < 1 || config.max_posts_per_group > 1000) return respond({ error: "max_posts_per_group must be between 1 and 1000" }, 400);
      if (!["24h", "week", "month"].includes(config.posted_limit)) return respond({ error: "Invalid posted_limit" }, 400);
      if (!["date", "relevance"].includes(config.sort_by)) return respond({ error: "Invalid sort_by" }, 400);
      if (!Number.isInteger(config.schedule_interval_hours) || config.schedule_interval_hours < 1 || config.schedule_interval_hours > 24) return respond({ error: "schedule_interval_hours must be between 1 and 24" }, 400);

      const { data, error } = await supabase
        .from("linkedin_scraper_config")
        .update(config)
        .eq("id", true)
        .select("is_enabled,max_pages,max_posts_per_group,posted_limit,sort_by,schedule_interval_hours,last_scheduled_at,updated_at")
        .single();
      if (error) return respond({ error: error.message }, 400);
      return respond({ success: true, config: data });
    }

    if (action === "set_scheduler_enabled") {
      if (typeof body?.is_enabled !== "boolean") return respond({ error: "is_enabled must be boolean" }, 400);
      const { data, error } = await supabase
        .from("linkedin_scraper_config")
        .update({ is_enabled: body.is_enabled, updated_at: new Date().toISOString() })
        .eq("id", true)
        .select("is_enabled,max_pages,max_posts_per_group,posted_limit,sort_by,schedule_interval_hours,last_scheduled_at,updated_at")
        .single();
      if (error) return respond({ error: error.message }, 400);
      return respond({ success: true, config: data });
    }

    if (action === "trigger_scrape") {
      const { data: config, error: configError } = await supabase
        .from("linkedin_scraper_config")
        .select("max_pages,max_posts_per_group,posted_limit,sort_by")
        .eq("id", true)
        .single();
      if (configError) return respond({ error: configError.message }, 500);

      const scraperUrl = (Deno.env.get("LINKEDIN_GROUP_SCRAPER_URL") ?? "").trim();
      const scraperToken = (Deno.env.get("LINKEDIN_GROUP_SCRAPER_TOKEN") ?? "").trim();
      if (!scraperUrl || !scraperToken) return respond({ error: "LinkedIn scraper trigger is not configured" }, 500);

      const scraperResponse = await fetch(scraperUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${scraperToken}`,
        },
        body: JSON.stringify({
          maxPages: config.max_pages,
          maxPostsPerGroup: config.max_posts_per_group,
          postedLimit: config.posted_limit,
          sortBy: config.sort_by,
        }),
      });
      const result = await scraperResponse.json().catch(() => ({}));
      if (!scraperResponse.ok) {
        return respond({ error: result?.error ?? `Scraper returned HTTP ${scraperResponse.status}` }, 502);
      }
      return respond({ success: true, ...result }, 202);
    }

    const groupId = normalizeGroupId(body?.group_id);
    if (!/^\d+$/.test(groupId)) return respond({ error: "A numeric LinkedIn group ID is required" }, 400);

    if (action === "create") {
      const groupName = typeof body?.group_name === "string" ? body.group_name.trim() : "";
      const { error } = await supabase.from("linkedin_groups").insert({
        group_id: groupId,
        group_name: groupName || null,
      });
      if (error) return respond({ error: error.message }, 400);
      return respond({ success: true, group_id: groupId }, 201);
    }

    if (action === "set_active") {
      if (typeof body?.is_active !== "boolean") return respond({ error: "is_active must be boolean" }, 400);
      const { error } = await supabase
        .from("linkedin_groups")
        .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
        .eq("group_id", groupId);
      if (error) return respond({ error: error.message }, 400);
      return respond({ success: true, group_id: groupId, is_active: body.is_active });
    }

    if (action === "delete") {
      const { error } = await supabase.from("linkedin_groups").delete().eq("group_id", groupId);
      if (error) return respond({ error: error.message }, 400);
      return respond({ success: true, group_id: groupId });
    }

    return respond({ error: "Unsupported action" }, 400);
  } catch (error) {
    return respond({ error: (error as Error).message }, 500);
  }
});
