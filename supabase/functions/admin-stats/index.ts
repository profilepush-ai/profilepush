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
    const { password, start_date, end_date } = await req.json();
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

    // Fetch all accounts
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, name, credits_balance, is_trial, created_at")
      .order("created_at", { ascending: false });

    if (!accounts || accounts.length === 0) {
      return new Response(
        JSON.stringify({ accounts: [], stats: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accountIds = accounts.map((a: any) => a.id);

    // Helper to apply date filter on a query builder
    function withDateRange(query: any, dateCol = "created_at") {
      if (start_date) query = query.gte(dateCol, start_date);
      if (end_date) query = query.lte(dateCol, end_date);
      return query;
    }

    // Parallel queries — members/profiles/vendors/clients are totals (not date-filtered)
    // Time-based stats (searches, credits, API calls, etc.) are date-filtered
    const [
      membersRes,
      profilesRes,
      vendorsRes,
      clientsRes,
      submissionsRes,
      linkedinSearchRes,
      diceSearchRes,
      indeedSearchRes,
      monsterSearchRes,
      cbSearchRes,
      creditsUsedRes,
      apiUsageRes,
      rewriteRes,
      scoreRes,
    ] = await Promise.all([
      // Totals (not date-filtered)
      supabase.from("account_members").select("account_id").in("account_id", accountIds),
      supabase.from("profiles").select("account_id").in("account_id", accountIds),
      supabase.from("vendors").select("account_id").in("account_id", accountIds),
      supabase.from("clients").select("account_id").in("account_id", accountIds),
      // Date-filtered
      withDateRange(supabase.from("submissions").select("account_id").in("account_id", accountIds)),
      withDateRange(supabase.from("linkedin_job_searches").select("account_id").in("account_id", accountIds)),
      withDateRange(supabase.from("dice_job_searches").select("account_id").in("account_id", accountIds)),
      withDateRange(supabase.from("indeed_job_searches").select("account_id").in("account_id", accountIds)),
      withDateRange(supabase.from("monster_job_searches").select("account_id").in("account_id", accountIds)),
      withDateRange(supabase.from("careerbuilder_job_searches").select("account_id").in("account_id", accountIds)),
      withDateRange(supabase.from("credit_transactions").select("account_id, amount").in("account_id", accountIds).lt("amount", 0)),
      withDateRange(supabase.from("api_usage_log").select("account_id, function_name").in("account_id", accountIds)),
      withDateRange(supabase.from("api_usage_log").select("account_id").in("account_id", accountIds).eq("function_name", "rewrite-resume")),
      withDateRange(supabase.from("api_usage_log").select("account_id").in("account_id", accountIds).eq("function_name", "score-job-match")),
    ]);

    function countBy(rows: any[] | null): Record<string, number> {
      const map: Record<string, number> = {};
      if (!rows) return map;
      for (const r of rows) {
        const key = r.account_id;
        if (key) map[key] = (map[key] || 0) + 1;
      }
      return map;
    }

    function sumBy(rows: any[] | null, field: string): Record<string, number> {
      const map: Record<string, number> = {};
      if (!rows) return map;
      for (const r of rows) {
        const key = r.account_id;
        if (key) map[key] = (map[key] || 0) + Math.abs(r[field] || 0);
      }
      return map;
    }

    const memberCounts = countBy(membersRes.data);
    const profileCounts = countBy(profilesRes.data);
    const submissionCounts = countBy(submissionsRes.data);
    const vendorCounts = countBy(vendorsRes.data);
    const clientCounts = countBy(clientsRes.data);
    const linkedinCounts = countBy(linkedinSearchRes.data);
    const diceCounts = countBy(diceSearchRes.data);
    const indeedCounts = countBy(indeedSearchRes.data);
    const monsterCounts = countBy(monsterSearchRes.data);
    const cbCounts = countBy(cbSearchRes.data);
    const creditsUsed = sumBy(creditsUsedRes.data, "amount");
    const apiCounts = countBy(apiUsageRes.data);
    const rewriteCounts = countBy(rewriteRes.data);
    const scoreCounts = countBy(scoreRes.data);

    // Wishlisted jobs via profile_id -> profiles.account_id
    const { data: fullProfiles } = await supabase
      .from("profiles")
      .select("id, account_id")
      .in("account_id", accountIds);

    const profileToAccount: Record<string, string> = {};
    if (fullProfiles) {
      for (const p of fullProfiles) {
        profileToAccount[p.id] = p.account_id;
      }
    }

    let wjQuery = supabase.from("wishlisted_jobs").select("profile_id");
    wjQuery = withDateRange(wjQuery);
    const { data: wjData } = await wjQuery;

    const wishlistCounts: Record<string, number> = {};
    if (wjData) {
      for (const w of wjData) {
        const acctId = profileToAccount[w.profile_id];
        if (acctId) wishlistCounts[acctId] = (wishlistCounts[acctId] || 0) + 1;
      }
    }

    const stats = accounts.map((a: any) => ({
      id: a.id,
      name: a.name,
      created_at: a.created_at,
      credits_balance: a.credits_balance ?? 0,
      is_trial: a.is_trial,
      users: memberCounts[a.id] || 0,
      candidates: profileCounts[a.id] || 0,
      submissions: submissionCounts[a.id] || 0,
      vendors: vendorCounts[a.id] || 0,
      clients: clientCounts[a.id] || 0,
      job_searches: (linkedinCounts[a.id] || 0) + (diceCounts[a.id] || 0) + (indeedCounts[a.id] || 0) + (monsterCounts[a.id] || 0) + (cbCounts[a.id] || 0),
      credits_used: creditsUsed[a.id] || 0,
      api_calls: apiCounts[a.id] || 0,
      resume_rewrites: rewriteCounts[a.id] || 0,
      match_scores: scoreCounts[a.id] || 0,
      wishlisted_jobs: wishlistCounts[a.id] || 0,
    }));

    return new Response(
      JSON.stringify({ stats }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
