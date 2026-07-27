import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Webhook endpoint to receive social media job posts and store them in social_jobs.
 *
 * URL: https://<project>.supabase.co/functions/v1/receive-social-job
 *
 * Auth: pass ?secret=<SOCIAL_WEBHOOK_SECRET> as a query param.
 * The SOCIAL_WEBHOOK_SECRET env var must match.
 *
 * Accepts POST with JSON body (single object or array of objects):
 * {
 *   post_id: string (required) — unique identifier of the post on the platform
 *   platform: string (required) — e.g. "linkedin", "twitter", "facebook"
 *   post_content: string (required) — full text of the job post
 *   posted_by_name?: string — recruiter / poster name
 *   posted_at?: string — ISO timestamp of when the post was published
 *   profile_link?: string — link to poster's profile
 *   poster_email?: string — recruiter's email
 *   poster_phone?: string — recruiter's phone
 *   post_url?: string — direct URL to the post
 *   job_title?: string — extracted job title
 *   company_name?: string — extracted company name
 *   location?: string — extracted location
 *   employment_type?: string — full-time, contract, C2C, etc.
 *   seniority_level?: string — senior, mid, junior
 *   job_description?: string — cleaned job description (falls back to post_content)
 *   salary_range?: string — salary/rate as text
 *   account_id?: string — optional account scope
 * }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {

    const body = await req.json();
    const items: Array<Record<string, unknown>> = Array.isArray(body) ? body : [body];

    if (items.length === 0) {
      return respond({ error: "Empty payload" }, 400);
    }

    // Validate required fields
    for (const item of items) {
      if (!item.post_id || !item.platform || !item.post_content) {
        return respond(
          { error: "Each item requires: post_id, platform, post_content" },
          400
        );
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    function safeTimestamp(val: unknown): string | null {
      if (!val) return null;
      if (typeof val === "string") {
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d.toISOString();
      }
      if (typeof val === "number") return new Date(val).toISOString();
      if (typeof val === "object" && val !== null) {
        const obj = val as Record<string, unknown>;
        if (obj.seconds) return new Date(Number(obj.seconds) * 1000).toISOString();
        if (obj.$date) return new Date(String(obj.$date)).toISOString();
      }
      return null;
    }

    const rows = items.map((item) => ({
      post_id: String(item.post_id),
      platform: String(item.platform).toLowerCase(),
      post_content: String(item.post_content),
      posted_by_name: String(item.posted_by_name ?? ""),
      posted_at: safeTimestamp(item.posted_at),
      profile_link: String(item.profile_link ?? ""),
      poster_email: String(item.poster_email ?? ""),
      poster_phone: String(item.poster_phone ?? ""),
      post_url: String(item.post_url ?? ""),
      job_title: String(item.job_title ?? ""),
      company_name: String(item.company_name ?? ""),
      location: String(item.location ?? ""),
      employment_type: String(item.employment_type ?? ""),
      seniority_level: String(item.seniority_level ?? ""),
      job_description: String(item.job_description ?? item.post_content),
      salary_range: String(item.salary_range ?? ""),
      account_id: item.account_id ? String(item.account_id) : null,
    }));

    const { data, error } = await supabase
      .from("social_jobs")
      .upsert(rows, { onConflict: "post_id,platform", ignoreDuplicates: false })
      .select("id, post_id, platform");

    if (error) {
      return respond({ error: error.message }, 500);
    }

    // Generate embeddings for newly upserted social jobs (fire-and-forget)
    if (data && data.length > 0) {
      const embeddingPayload = data.map((r: { id: string }) => ({ type: "job", id: r.id, table: "social_jobs" }));
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-embedding`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        },
        body: JSON.stringify(embeddingPayload),
      }).catch(() => {});
    }

    return respond({
      success: true,
      inserted: data?.length ?? 0,
      ids: data?.map((r: { id: string }) => r.id) ?? [],
    });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});
