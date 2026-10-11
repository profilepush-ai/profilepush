import { createClient } from "npm:@supabase/supabase-js@2.49.1";

// Account Stats for the admin dashboard. Everything is computed in one
// set-based SQL function, admin_account_stats (see its migration for what
// each number means), so this only checks the admin password and passes the
// range through.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { password, start_date, end_date, include_internal } = await req.json();
    if (password !== ADMIN_PASSWORD) return json({ error: "Invalid password" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase.rpc("admin_account_stats", {
      p_start: start_date || null,
      p_end: end_date || null,
      p_include_internal: include_internal === true,
    });
    if (error) throw new Error(error.message);

    return json(data ?? {});
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
