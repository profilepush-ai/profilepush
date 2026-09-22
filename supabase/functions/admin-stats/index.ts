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
      .select("id, name, owner_id, credits_balance, is_trial, active_persona, created_at")
      .order("created_at", { ascending: false });

    if (!accounts || accounts.length === 0) {
      return new Response(
        JSON.stringify({ accounts: [], stats: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accountIds = accounts.map((a: any) => a.id);
    // Persona per account, so the daily buckets below can be split without a
    // second pass over the accounts array for every row.
    const accountPersona: Record<string, string | null> = {};
    for (const a of accounts) accountPersona[a.id] = a.active_persona ?? null;

    // Helper to apply date filter on a query builder
    function withDateRange(query: any, dateCol = "created_at") {
      if (start_date) query = query.gte(dateCol, start_date);
      if (end_date) query = query.lte(dateCol, end_date);
      return query;
    }

    const [
      membersRes,
      activityRes,
      searchesRes,
      postsJobsRes,
      postsHotlistRes,
      previewsRes,
      aiPitchesRes,
      aiRequestsRes,
      aiMatchRes,
      gmailRes,
      chatsRes,
      vendorDownloadsRes,
      recruiterDownloadsRes,
    ] = await Promise.all([
      supabase
        .from("account_members")
        .select("account_id, user_id, invited_email, display_name, role, status, created_at")
        .in("account_id", accountIds)
        .eq("status", "active"),
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
          .select("account_id, created_at")
          .in("account_id", accountIds)
      ),
      // Posts, tracked separately for Jobs vs Hotlist.
      withDateRange(
        supabase
          .from("social_jobs")
          .select("created_by_account_id, created_at")
          .in("created_by_account_id", accountIds)
          .eq("post_source", "user_post")
      ),
      withDateRange(
        supabase
          .from("social_hotlist")
          .select("created_by_account_id, created_at")
          .in("created_by_account_id", accountIds)
          .eq("post_source", "user_post")
      ),
      // Previews: the Preview action on a Pulse card (view the original
      // post). lead_id doesn't carry a job/hotlist flag itself, so this is
      // split further below by cross-referencing which table each lead_id
      // belongs to.
      withDateRange(
        supabase
          .from("pulse_lead_actions")
          .select("account_id, lead_id, created_at")
          .in("account_id", accountIds)
          .eq("action_type", "post_content_viewed")
      ),
      // AI Pitch (jobs) / AI Request (hotlist) are the same underlying
      // table, split by which foreign key is set.
      withDateRange(
        supabase
          .from("pulse_ask_ai_requests")
          .select("account_id, created_at")
          .in("account_id", accountIds)
          .not("job_id", "is", null)
      ),
      withDateRange(
        supabase
          .from("pulse_ask_ai_requests")
          .select("account_id, created_at")
          .in("account_id", accountIds)
          .not("hotlist_id", "is", null)
      ),
      // AI Match: api_usage_log records nothing for it (ai-match logs
      // cost_usd 0 because Workers AI bills per neuron, and nothing else
      // writes that table), so the credit ledger is the only record of a run.
      // One row per run; the amount is the number of matches charged, since
      // AI Match bills one credit per match delivered.
      withDateRange(
        supabase
          .from("credit_transactions")
          .select("account_id, amount, created_at")
          .in("account_id", accountIds)
          .eq("type", "usage")
          .like("description", "%ai_match_run%")
      ),
      // Gmail: which accounts have connected a mailbox, and which address.
      // Not date-ranged — a connection is current state, not an event in the
      // window, so a range filter would make it vanish from older ranges.
      supabase
        .from("gmail_integrations")
        .select("account_id, gmail_address, status, last_synced_at")
        .in("account_id", accountIds),
      // Chats: messages sent on an in-app user_post conversation.
      withDateRange(
        supabase
          .from("post_chat_messages")
          .select("sender_account_id, created_at")
          .in("sender_account_id", accountIds)
      ),
      // Active List downloads: one row per download action (see
      // active_list_downloads / check_and_log_active_list_download), split
      // by download_type the same way AI Pitch/Request splits by which
      // foreign key is set.
      withDateRange(
        supabase
          .from("active_list_downloads")
          .select("account_id, created_at")
          .in("account_id", accountIds)
          .eq("download_type", "vendors")
      ),
      withDateRange(
        supabase
          .from("active_list_downloads")
          .select("account_id, created_at")
          .in("account_id", accountIds)
          .eq("download_type", "recruiters")
      ),
    ]);

    function countBy(rows: any[] | null, key = "account_id"): Record<string, number> {
      const map: Record<string, number> = {};
      if (!rows) return map;
      for (const r of rows) {
        const id = r[key];
        if (id) map[id] = (map[id] || 0) + 1;
      }
      return map;
    }

    const searchesCounts = countBy(searchesRes.data);
    const postsJobsCounts = countBy(postsJobsRes.data, "created_by_account_id");
    const postsHotlistCounts = countBy(postsHotlistRes.data, "created_by_account_id");
    const aiPitchesCounts = countBy(aiPitchesRes.data);
    const aiRequestsCounts = countBy(aiRequestsRes.data);
    const aiMatchRunCounts = countBy(aiMatchRes.data);
    // Matches delivered, not runs: a run that returned three matches cost
    // three credits, and a rematch only charges for the new ones.
    const aiMatchMatchCounts: Record<string, number> = {};
    for (const row of aiMatchRes.data ?? []) {
      const id = (row as { account_id?: string }).account_id;
      if (!id) continue;
      aiMatchMatchCounts[id] = (aiMatchMatchCounts[id] || 0) + Math.abs(Number((row as { amount?: number }).amount ?? 0));
    }
    // Only a live connection counts: a revoked or errored row means the
    // mailbox is not actually sending any more.
    const gmailByAccount: Record<string, { address: string; status: string }> = {};
    for (const row of gmailRes.data ?? []) {
      const r = row as { account_id?: string; gmail_address?: string; status?: string };
      if (!r.account_id) continue;
      gmailByAccount[r.account_id] = { address: r.gmail_address ?? "", status: r.status ?? "" };
    }
    const chatsCounts = countBy(chatsRes.data, "sender_account_id");
    const vendorDownloadsCounts = countBy(vendorDownloadsRes.data);
    const recruiterDownloadsCounts = countBy(recruiterDownloadsRes.data);

    // Split previews by looking up which table each previewed lead_id
    // actually belongs to.
    const previewLeadIds = Array.from(new Set(
      (previewsRes.data ?? []).map((r: any) => r.lead_id).filter(Boolean)
    ));
    const [previewJobIdsRes, previewHotlistIdsRes] = previewLeadIds.length
      ? await Promise.all([
          supabase.from("social_jobs").select("id").in("id", previewLeadIds),
          supabase.from("social_hotlist").select("id").in("id", previewLeadIds),
        ])
      : [{ data: [] as any[] }, { data: [] as any[] }];
    const previewJobIdSet = new Set((previewJobIdsRes.data ?? []).map((r: any) => r.id));
    const previewHotlistIdSet = new Set((previewHotlistIdsRes.data ?? []).map((r: any) => r.id));

    const jobPreviewsCounts: Record<string, number> = {};
    const hotlistPreviewsCounts: Record<string, number> = {};
    for (const row of previewsRes.data ?? []) {
      if (!row.account_id) continue;
      if (previewJobIdSet.has(row.lead_id)) {
        jobPreviewsCounts[row.account_id] = (jobPreviewsCounts[row.account_id] || 0) + 1;
      } else if (previewHotlistIdSet.has(row.lead_id)) {
        hotlistPreviewsCounts[row.account_id] = (hotlistPreviewsCounts[row.account_id] || 0) + 1;
      }
    }

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
        active_persona: a.active_persona ?? null,
        credits_balance: a.credits_balance ?? 0,
        searches_count: searchesCounts[a.id] || 0,
        job_posts_count: postsJobsCounts[a.id] || 0,
        hotlist_posts_count: postsHotlistCounts[a.id] || 0,
        job_previews_count: jobPreviewsCounts[a.id] || 0,
        hotlist_previews_count: hotlistPreviewsCounts[a.id] || 0,
        ai_pitches_count: aiPitchesCounts[a.id] || 0,
        ai_requests_count: aiRequestsCounts[a.id] || 0,
        ai_match_runs_count: aiMatchRunCounts[a.id] || 0,
        ai_match_matches_count: aiMatchMatchCounts[a.id] || 0,
        gmail_connected: gmailByAccount[a.id]?.status === "connected",
        // One readable cell: the mailbox, with the status appended when it is
        // anything other than live. A revoked connection still matters — the
        // user connected once and it stopped working — so it is shown rather
        // than blanked.
        gmail_address: gmailByAccount[a.id]
          ? (gmailByAccount[a.id].status === "connected"
            ? gmailByAccount[a.id].address
            : `${gmailByAccount[a.id].address} (${gmailByAccount[a.id].status})`)
          : null,
        chats_count: chatsCounts[a.id] || 0,
        vendor_downloads_count: vendorDownloadsCounts[a.id] || 0,
        recruiter_downloads_count: recruiterDownloadsCounts[a.id] || 0,
        account_age_days: Math.max(0, Math.floor((Date.now() - Date.parse(a.created_at)) / 86_400_000)),
        session_count: activity?.session_count ?? 0,
        active_seconds: activity?.active_seconds ?? 0,
        active_days: activity?.active_days.size ?? 0,
        last_activity_at: activity?.last_activity_at ?? null,
        last_logged_in: authUser?.last_sign_in_at ?? null,
        is_trial: a.is_trial,
      };
    });

    // ── Daily series, for the charts tab ─────────────────────────────────
    //
    // The per-account rows above answer "how much in this range"; a trend
    // needs "how much on each day", which no amount of summing can recover
    // once the timestamps are dropped. So the same rows are bucketed a second
    // time by UTC day and by the account's persona.
    //
    // UTC because created_at is stored in UTC and every range filter above
    // compares against it in UTC — bucketing locally would put a 23:30 event
    // on the wrong day and make the chart disagree with the table.
    type PersonaKey = "vendor" | "bench_sales" | "none";
    const personaOf = (accountId: string): PersonaKey => {
      const persona = accountPersona[accountId];
      return persona === "vendor" || persona === "bench_sales" ? persona : "none";
    };

    const daily: Record<string, Record<PersonaKey, Record<string, number>>> = {};
    const bucket = (dateValue: unknown, accountId: unknown, metric: string, amount = 1) => {
      if (!dateValue || !accountId) return;
      const date = String(dateValue).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const persona = personaOf(String(accountId));
      daily[date] ??= { vendor: {}, bench_sales: {}, none: {} };
      daily[date][persona][metric] = (daily[date][persona][metric] ?? 0) + amount;
    };

    for (const a of accounts) bucket(a.created_at, a.id, "signups");
    for (const r of searchesRes.data ?? []) bucket(r.created_at, r.account_id, "searches");
    for (const r of postsJobsRes.data ?? []) bucket(r.created_at, r.created_by_account_id, "job_posts");
    for (const r of postsHotlistRes.data ?? []) bucket(r.created_at, r.created_by_account_id, "hotlist_posts");
    for (const r of previewsRes.data ?? []) bucket(r.created_at, r.account_id, "previews");
    for (const r of aiPitchesRes.data ?? []) bucket(r.created_at, r.account_id, "ai_pitches");
    for (const r of aiRequestsRes.data ?? []) bucket(r.created_at, r.account_id, "ai_requests");
    for (const r of chatsRes.data ?? []) bucket(r.created_at, r.sender_account_id, "chats");
    for (const r of vendorDownloadsRes.data ?? []) bucket(r.created_at, r.account_id, "downloads");
    for (const r of recruiterDownloadsRes.data ?? []) bucket(r.created_at, r.account_id, "downloads");
    // Matches delivered, not runs: the charge amount is the number of matches.
    for (const r of aiMatchRes.data ?? []) {
      bucket(r.created_at, r.account_id, "ai_matches", Math.abs(Number(r.amount ?? 0)));
      bucket(r.created_at, r.account_id, "ai_match_runs");
    }
    // Daily active users: one row per account per day is exactly what this
    // table holds, so the row count for a day IS the active-account count.
    for (const r of activityRes.data ?? []) {
      bucket(r.activity_date, r.account_id, "active_users");
      bucket(r.activity_date, r.account_id, "sessions", Number(r.session_count ?? 0));
    }

    const dailySeries = Object.keys(daily).sort().map((date) => ({
      date,
      vendor: daily[date].vendor,
      bench_sales: daily[date].bench_sales,
      none: daily[date].none,
    }));

    return new Response(
      JSON.stringify({ stats, daily: dailySeries }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
