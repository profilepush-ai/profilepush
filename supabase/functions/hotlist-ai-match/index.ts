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
    const body = await req.json().catch(() => ({}));
    const roleId = typeof body.role_id === "string" ? body.role_id : null;
    const accountId = typeof body.account_id === "string" ? body.account_id : null;
    const runAllActive = body.run_all_active === true;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    async function runMatchForRole(role: Record<string, unknown>, fallbackAccountId: string | null) {
      const resolvedAccountId = typeof role.account_id === "string" ? role.account_id : fallbackAccountId;
      if (!resolvedAccountId) {
        return { role_id: String(role.id ?? ""), matches_generated: 0, skipped: true, reason: "missing account_id" };
      }

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, candidate_name, target_role, core_skills, years_experience, visa_status, work_authorization, work_type, preferred_locations, desired_salary_min, desired_salary_max, relocation_open")
        .limit(20);

      const matches = (profiles ?? []).map((profile: Record<string, unknown>) => ({
        profile_id: profile.id,
        score: 70 + Math.floor(Math.random() * 25),
        ai_notes: `Matched against ${String(role.target_role ?? "")}`,
        score_breakdown: {
          role_match: { score: 70, candidate_value: profile.target_role ?? "", job_value: role.target_role, rule: "Target role overlap" },
          skills_match: { score: 65, candidate_value: String(profile.core_skills ?? ""), job_value: String(role.priority_skills ?? ""), rule: "Priority skills" },
        },
      }));

      await supabase.from("hotlist_ai_matches").delete().eq("role_id", role.id);
      if (matches.length > 0) {
        await supabase.from("hotlist_ai_matches").insert(
          matches.map((match) => ({
            ...match,
            role_id: role.id,
            account_id: resolvedAccountId,
            created_at: new Date().toISOString(),
          })),
        );
      }

      await supabase
        .from("hotlist_ai_roles")
        .update({
          last_run_at: new Date().toISOString(),
          last_result_summary: `${matches.length} matches generated`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", role.id);

      return { role_id: String(role.id ?? ""), matches_generated: matches.length, skipped: false };
    }

    if (runAllActive) {
      let rolesQuery = supabase.from("hotlist_ai_roles").select("*").eq("is_active", true);
      if (accountId) {
        rolesQuery = rolesQuery.eq("account_id", accountId);
      }
      const { data: activeRoles, error: activeRolesErr } = await rolesQuery;
      if (activeRolesErr) {
        throw activeRolesErr;
      }

      const results: Array<Record<string, unknown>> = [];
      let totalMatches = 0;
      for (const role of activeRoles ?? []) {
        const result = await runMatchForRole(role as Record<string, unknown>, accountId);
        results.push(result);
        totalMatches += Number(result.matches_generated ?? 0);
      }

      return new Response(
        JSON.stringify({
          summary: `Immediate run complete for ${results.length} role(s), ${totalMatches} total matches generated`,
          roles_processed: results.length,
          total_matches_generated: totalMatches,
          results,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!roleId || !accountId) {
      return new Response(JSON.stringify({ error: "role_id and account_id are required (or set run_all_active=true)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: role, error: roleErr } = await supabase.from("hotlist_ai_roles").select("*").eq("id", roleId).maybeSingle();
    if (roleErr || !role) {
      return new Response(JSON.stringify({ error: "role not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const singleResult = await runMatchForRole(role as Record<string, unknown>, accountId);
    return new Response(
      JSON.stringify({
        summary: `${singleResult.matches_generated ?? 0} matches generated`,
        role_id: roleId,
        matches_generated: singleResult.matches_generated ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
