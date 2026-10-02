import { createClient } from "npm:@supabase/supabase-js@2.49.1";

// Admin > Feedback: every rating and comment from the post-submit prompt,
// with the average and the 1-5 breakdown. Same admin password as admin-stats.
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
    const { password } = await req.json();
    if (password !== ADMIN_PASSWORD) return respond({ error: "Invalid password" }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await supabase.rpc("admin_feedback_report");
    if (error) return respond({ error: error.message }, 500);
    return respond({ report: data });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});
