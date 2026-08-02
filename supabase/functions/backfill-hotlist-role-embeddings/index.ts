import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json().catch(() => ({}));
    const accountId = typeof body.account_id === "string" ? body.account_id : null;
    const limit = Math.min(Math.max(Number(body.limit ?? 500), 1), 5000);

    let query = supabase
      .from("hotlist_ai_roles")
      .select("id")
      .is("role_embedding", null)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (accountId) {
      query = query.eq("account_id", accountId);
    }

    const { data, error } = await query;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = (data ?? []) as Array<{ id: string }>;
    if (rows.length === 0) {
      return new Response(JSON.stringify({ success: true, queued: 0, message: "No roles pending embedding." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = rows.map((row) => ({ type: "role", id: row.id }));

    const embedRes = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Apikey": serviceRoleKey,
      },
      body: JSON.stringify(payload),
    });

    const embedJson = await embedRes.json().catch(() => ({}));

    return new Response(JSON.stringify({
      success: embedRes.ok,
      requested: rows.length,
      result: embedJson,
    }), {
      status: embedRes.ok ? 200 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
