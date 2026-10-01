import { createClient } from "npm:@supabase/supabase-js@2.49.1";

// Admin > Emails: every email the email worker sends, by category, with
// delivery, bounce, complaint and unsubscribe counts. Same admin password as
// admin-stats; the data comes from admin_email_report and
// admin_recent_email_sends (service role only).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const { password, action, days, category, search, limit } = await req.json();
    if (password !== ADMIN_PASSWORD) return respond({ error: "Invalid password" }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "recent") {
      const { data, error } = await supabase.rpc("admin_recent_email_sends", {
        p_limit: typeof limit === "number" ? limit : 100,
        p_category: typeof category === "string" ? category : null,
        p_search: typeof search === "string" ? search : null,
      });
      if (error) return respond({ error: error.message }, 500);
      return respond({ rows: data ?? [] });
    }

    const { data, error } = await supabase.rpc("admin_email_report", {
      p_days: typeof days === "number" && days > 0 ? Math.floor(days) : 30,
    });
    if (error) return respond({ error: error.message }, 500);
    return respond({ report: data });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});
