// Ticks on the weekly experiment list in the admin Charts briefing.
//
// Deliberately tiny: list the current week's ticks, toggle one. The list of
// experiments itself lives in the UI, keyed by a stable string, so rewording a
// suggestion never orphans the record of having tried it.
//
// Password-gated like every other admin-* function, and on the service-role
// key so the table can stay closed to anon and authenticated entirely.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Monday of the ISO week containing the date, in UTC. Computed here rather
// than in the browser so that two managers in different timezones tick the
// same week.
function weekStart(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: 0 = Sunday. Shift so Monday is the first day.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const payload = await req.json();
    if (payload.password !== ADMIN_PASSWORD) return jsonResponse({ error: "Invalid password" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const week = typeof payload.week_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.week_start)
      ? payload.week_start
      : weekStart();

    const action = String(payload.action ?? "list");

    if (action === "list") {
      const { data, error } = await supabase
        .from("admin_weekly_experiments")
        .select("experiment_key, tried, note, updated_at")
        .eq("week_start", week);
      if (error) throw new Error(error.message);
      return jsonResponse({ week_start: week, ticks: data ?? [] });
    }

    if (action === "toggle") {
      const key = String(payload.experiment_key ?? "").trim();
      if (!key) return jsonResponse({ error: "experiment_key is required" }, 400);
      const tried = payload.tried !== false;

      // Upsert on the unique (week, key) pair: ticking twice is the same as
      // ticking once, and unticking is a value rather than a delete so the
      // record of someone having looked at it survives.
      const { error } = await supabase
        .from("admin_weekly_experiments")
        .upsert(
          { week_start: week, experiment_key: key, tried, note: payload.note ?? null, updated_at: new Date().toISOString() },
          { onConflict: "week_start,experiment_key" },
        );
      if (error) throw new Error(error.message);
      return jsonResponse({ ok: true, week_start: week, experiment_key: key, tried });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
