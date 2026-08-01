import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let requestBody: Record<string, unknown> = {};
    try {
      requestBody = await req.json();
    } catch {
      requestBody = {};
    }

    const requestedRoleId = typeof requestBody.role_id === "string" ? requestBody.role_id : null;

    if (requestedRoleId) {
      const { data: role, error: roleError } = await supabase
        .from("hotlist_ai_roles")
        .select("*")
        .eq("id", requestedRoleId)
        .maybeSingle();

      if (roleError) {
        throw roleError;
      }

      const { data: matchRows, error: matchRowsError } = await supabase
        .from("hotlist_ai_matches")
        .select("*")
        .eq("role_id", requestedRoleId)
        .order("score", { ascending: false })
        .limit(20);

      if (matchRowsError) {
        throw matchRowsError;
      }

      return new Response(JSON.stringify({ role, matches: (matchRows ?? []) as Array<Record<string, unknown>> }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles, error: rolesError } = await supabase
      .from("hotlist_ai_roles")
      .select("*")
      .order("created_at", { ascending: false });

    if (rolesError) {
      throw rolesError;
    }

    const roleIds = (roles ?? []).map((role: Record<string, unknown>) => String(role.id));
    let matches: Array<Record<string, unknown>> = [];

    if (roleIds.length > 0) {
      const { data: matchRows, error: matchRowsError } = await supabase
        .from("hotlist_ai_matches")
        .select("role_id")
        .in("role_id", roleIds);

      if (matchRowsError) {
        throw matchRowsError;
      }

      matches = (matchRows ?? []) as Array<Record<string, unknown>>;
    }

    const matchCounts = new Map<string, number>();
    for (const matchRow of matches) {
      const roleId = String(matchRow.role_id ?? "");
      if (!roleId) continue;
      matchCounts.set(roleId, (matchCounts.get(roleId) ?? 0) + 1);
    }

    const responsePayload = (roles ?? []).map((role: Record<string, unknown>) => ({
      ...role,
      match_count: matchCounts.get(String(role.id)) ?? Number(role.match_count ?? 0),
    }));

    return new Response(JSON.stringify({ roles: responsePayload }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
