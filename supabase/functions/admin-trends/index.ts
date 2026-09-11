import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { password, days } = await req.json();
    if (password !== ADMIN_PASSWORD) {
      return new Response(
        JSON.stringify({ error: "Invalid password" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [dailyResult, cohortsResult] = await Promise.all([
      supabase.rpc("get_admin_daily_trends", { p_days: typeof days === "number" ? days : 30 }),
      supabase.rpc("get_admin_weekly_retention_cohorts", { p_weeks: 12 }),
    ]);

    if (dailyResult.error) {
      return new Response(
        JSON.stringify({ error: dailyResult.error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (cohortsResult.error) {
      return new Response(
        JSON.stringify({ error: cohortsResult.error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ...dailyResult.data, ...cohortsResult.data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
