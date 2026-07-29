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
    const { action = "generate_summary", owner_email: filterEmail = null } = body;

    if (action !== "generate_summary") {
      return respond({ error: "Invalid action" }, 400);
    }

    // Get today's date (UTC)
    const today = new Date();
    const todayDateStr = today.toISOString().split("T")[0];

    // Fetch all new matches created today that are unreviewed
    // We query radar_match_results joined with profiles and accounts
    const { data: matches, error: matchErr } = await supabase
      .from("radar_match_results")
      .select(
        `
        id,
        profile_id,
        job_source,
        job_id,
        created_at,
        profiles:profile_id (
          id,
          candidate_name,
          account_id
        )
      `,
      )
      .gte("created_at", `${todayDateStr}T00:00:00Z`)
      .lt("created_at", `${todayDateStr}T23:59:59Z`);

    if (matchErr) {
      return respond({
        error: `Failed to fetch today's matches: ${matchErr.message}`,
        summaries_created: 0,
      }, 400);
    }

    if (!matches || matches.length === 0) {
      return respond({
        message: "No new unreviewed matches found today",
        summaries_created: 0,
      });
    }

    // Filter by owner email if provided (for targeted test runs)
    const filteredMatches = filterEmail
      ? (matches ?? []).filter((m) => {
          // We'll resolve this after fetching account owner emails below
          return true; // Will post-filter after account lookup
        })
      : (matches ?? []);

    // If email filter provided, get the account_id for that email
    let filterAccountId: string | null = null;
    if (filterEmail) {
      const { data: users } = await supabase.auth.admin.listUsers();
      const matchedUser = users?.users?.find((u) => u.email === filterEmail);
      if (matchedUser) {
        const { data: memberRow } = await supabase
          .from("account_members")
          .select("account_id")
          .eq("user_id", matchedUser.id)
          .eq("status", "active")
          .maybeSingle();
        filterAccountId = memberRow?.account_id ?? null;
      }
    }

    // Group matches by account_id, profile_id, candidate_name
    const summaryMap: Record<
      string,
      {
        account_id: string;
        profile_id: string;
        candidate_name: string;
        boards: Record<string, number>;
        total: number;
      }
    > = {};

    for (const match of filteredMatches) {
      const profileData = match.profiles as Record<string, unknown> | null;
      if (!profileData) continue;

      const accountId = profileData.account_id as string;
      if (filterAccountId && accountId !== filterAccountId) continue;
      const profileId = match.profile_id as string;
      const candidateName = profileData.candidate_name as string;
      const jobBoard = (match.job_source as string) || "unknown";

      const key = `${accountId}|${profileId}`;

      if (!summaryMap[key]) {
        summaryMap[key] = {
          account_id: accountId,
          profile_id: profileId,
          candidate_name: candidateName,
          boards: {},
          total: 0,
        };
      }

      summaryMap[key].boards[jobBoard] = (summaryMap[key].boards[jobBoard] || 0) + 1;
      summaryMap[key].total += 1;
    }

    // Insert summaries into daily_match_summaries table
    const summaries = Object.values(summaryMap).map((summary) => {
      const boardsArray = Object.keys(summary.boards);
      const matchSources = Object.entries(summary.boards).map(([board, count]) => ({
        board,
        count,
      }));

      return {
        account_id: summary.account_id,
        summary_date: todayDateStr,
        profile_id: summary.profile_id,
        candidate_name: summary.candidate_name,
        total_new_matches: summary.total,
        unreviewed_matches: summary.total,
        boards_represented: boardsArray,
        match_sources: matchSources,
      };
    });

    const { data: inserted, error: insertErr } = await supabase
      .from("daily_match_summaries")
      .upsert(summaries, {
        onConflict: "account_id,summary_date,profile_id",
      })
      .select();

    if (insertErr) {
      return respond({
        error: `Failed to insert summaries: ${insertErr.message}`,
        summaries_created: 0,
      }, 400);
    }

    return respond({
      message: "Daily match summaries generated successfully",
      summaries_created: inserted?.length ?? 0,
      summary_date: todayDateStr,
      total_matches: matches.length,
      unique_profiles: Object.keys(summaryMap).length,
      details: summaries,
    });
  } catch (err) {
    return respond(
      {
        error: (err as Error).message,
        summaries_created: 0,
      },
      500,
    );
  }
});

function respond(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
