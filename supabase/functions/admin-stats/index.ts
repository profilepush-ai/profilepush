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
      .select("id, name, owner_id, credits_balance, is_trial, created_at")
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

    const [
      membersRes,
      watchingRes,
      vendorsRes,
      clientsRes,
      revealsRes,
      activityRes,
      searchesRes,
    ] = await Promise.all([
      supabase
        .from("account_members")
        .select("account_id, user_id, invited_email, display_name, role, status, created_at")
        .in("account_id", accountIds)
        .eq("status", "active"),
      supabase
        .from("watchlist_profiles")
        .select("account_id")
        .in("account_id", accountIds)
        .eq("is_watching", true),
      supabase.from("vendors").select("account_id").in("account_id", accountIds),
      supabase.from("clients").select("account_id").in("account_id", accountIds),
      withDateRange(
        supabase
          .from("pulse_lead_actions")
          .select("account_id")
          .in("account_id", accountIds)
          .eq("action_type", "revealed")
      ),
      (() => {
        let query = supabase
          .from("user_activity_daily")
          .select("account_id, session_count, active_seconds, activity_date, last_activity_at")
          .in("account_id", accountIds);
        if (start_date) query = query.gte("activity_date", String(start_date).slice(0, 10));
        if (end_date) query = query.lte("activity_date", String(end_date).slice(0, 10));
        return query;
      })(),
      withDateRange(
        supabase
          .from("job_search_history")
          .select("account_id")
          .in("account_id", accountIds)
      ),
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

    const watchingCounts = countBy(watchingRes.data);
    const vendorCounts = countBy(vendorsRes.data);
    const clientCounts = countBy(clientsRes.data);
    const revealsCounts = countBy(revealsRes.data);
    const searchesCounts = countBy(searchesRes.data);

    const activityByAccount: Record<string, {
      session_count: number;
      active_seconds: number;
      active_days: Set<string>;
      last_activity_at: string | null;
    }> = {};
    for (const row of activityRes.data ?? []) {
      const current = activityByAccount[row.account_id] ?? {
        session_count: 0,
        active_seconds: 0,
        active_days: new Set<string>(),
        last_activity_at: null,
      };
      current.session_count += row.session_count ?? 0;
      current.active_seconds += row.active_seconds ?? 0;
      if (row.activity_date) current.active_days.add(row.activity_date);
      if (row.last_activity_at && (!current.last_activity_at || row.last_activity_at > current.last_activity_at)) {
        current.last_activity_at = row.last_activity_at;
      }
      activityByAccount[row.account_id] = current;
    }

    const primaryMemberByAccount: Record<string, any> = {};
    for (const member of membersRes.data ?? []) {
      const priority = member.role === "owner" ? 0 : member.role === "admin" ? 1 : 2;
      const existing = primaryMemberByAccount[member.account_id];
      if (!existing) {
        primaryMemberByAccount[member.account_id] = { ...member, priority };
        continue;
      }

      const existingPriority = existing.priority ?? 99;
      const existingCreatedAt = existing.created_at ? Date.parse(existing.created_at) : Number.POSITIVE_INFINITY;
      const memberCreatedAt = member.created_at ? Date.parse(member.created_at) : Number.POSITIVE_INFINITY;
      if (priority < existingPriority || (priority === existingPriority && memberCreatedAt < existingCreatedAt)) {
        primaryMemberByAccount[member.account_id] = { ...member, priority };
      }
    }

    const userIds = Array.from(new Set(
      Object.values(primaryMemberByAccount)
        .map((member: any) => member.user_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    ));

    const authUsersById: Record<string, { email: string; last_sign_in_at: string | null; full_name: string }> = {};
    await Promise.all(userIds.map(async (userId) => {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error || !data.user) return;

      const metadata = data.user.user_metadata ?? {};
      authUsersById[userId] = {
        email: data.user.email ?? "",
        last_sign_in_at: data.user.last_sign_in_at ?? null,
        full_name: typeof metadata.full_name === "string"
          ? metadata.full_name
          : typeof metadata.name === "string"
            ? metadata.name
            : "",
      };
    }));

    const stats = accounts.map((a: any) => {
      const primaryMember = primaryMemberByAccount[a.id] ?? null;
      const authUser = primaryMember?.user_id ? authUsersById[primaryMember.user_id] : null;
      const activity = activityByAccount[a.id];

      return {
        id: a.id,
        name: a.name,
        created_at: a.created_at,
        user_name: primaryMember?.display_name || authUser?.full_name || a.name || "-",
        user_email: authUser?.email || primaryMember?.invited_email || "-",
        watching_count: watchingCounts[a.id] || 0,
        credits_balance: a.credits_balance ?? 0,
        reveals_count: revealsCounts[a.id] || 0,
        contacts_count: (vendorCounts[a.id] || 0) + (clientCounts[a.id] || 0),
        searches_count: searchesCounts[a.id] || 0,
        account_age_days: Math.max(0, Math.floor((Date.now() - Date.parse(a.created_at)) / 86_400_000)),
        session_count: activity?.session_count ?? 0,
        active_seconds: activity?.active_seconds ?? 0,
        active_days: activity?.active_days.size ?? 0,
        last_activity_at: activity?.last_activity_at ?? null,
        last_logged_in: authUser?.last_sign_in_at ?? null,
        is_trial: a.is_trial,
      };
    });

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
