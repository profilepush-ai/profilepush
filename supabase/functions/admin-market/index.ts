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
    const action = String(body?.action ?? "list_leaderboard");

    // Market Pulse's own data (pulse_directory_30d_snapshot / pulse_directory_30d
    // / get_pulse_persona_leaderboard) is intentionally left untouched by this
    // function — it's still read directly by PulsePage.tsx (/feed) for its
    // "Market Pulse Insight" boxes. This admin panel is a read-only window onto
    // the same data, not a migration of it.
    if (action === "list_leaderboard") {
      const { data, error } = await supabase
        .from("pulse_directory_30d")
        .select("rank, target_role, active_watchers, unique_jobs, unique_vendors, unique_hotlists, avg_rate, refreshed_at")
        .order("rank", { ascending: true });
      if (error) return respond({ error: error.message }, 500);
      return respond({ roles: data ?? [] });
    }

    if (action === "force_refresh") {
      const { data, error } = await supabase.rpc("refresh_pulse_directory_30d_snapshot", { p_force: true });
      if (error) return respond({ error: error.message }, 500);
      return respond({ refreshed_at: data });
    }

    return respond({ error: "Unsupported action" }, 400);
  } catch (error) {
    return respond({ error: (error as Error).message }, 500);
  }
});
