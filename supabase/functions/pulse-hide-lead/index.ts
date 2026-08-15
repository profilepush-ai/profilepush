import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Platform-wide spam moderation: profilepush.ai@gmail.com is used internally as the
// account that reviews the Pulse feed for spam/junk posts. Hiding a lead through this
// function removes it from every account's feed (via social_jobs/social_hotlist.hidden_at,
// checked by get_pulse_social_feed / get_pulse_social_feed_page / get_social_hotlist_feed_page),
// not just the caller's own view — regular users instead get a per-account "ignore"
// handled client-side via pulse_lead_actions, which this function is not involved in.
const ADMIN_EMAILS = new Set(["profilepush.ai@gmail.com"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return respond({ error: "Unauthorized" }, 401);
    if (!ADMIN_EMAILS.has((user.email ?? "").trim().toLowerCase())) {
      return respond({ error: "Only platform admins can hide a post from everyone" }, 403);
    }

    const body = await request.json<Record<string, unknown>>();
    const leadId = typeof body.lead_id === "string" ? body.lead_id.trim() : "";
    const leadType = body.lead_type === "hotlist" ? "hotlist" : "job";
    if (!/^[0-9a-f-]{36}$/i.test(leadId)) return respond({ error: "A valid lead_id is required" }, 400);

    const table = leadType === "hotlist" ? "social_hotlist" : "social_jobs";
    const { error } = await supabaseAdmin
      .from(table)
      .update({ hidden_at: new Date().toISOString() })
      .eq("id", leadId);
    if (error) throw error;

    return respond({ ok: true });
  } catch (error) {
    console.error("pulse-hide-lead error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
