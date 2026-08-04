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
  const startedAtMs = Date.now();
  let runLogId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : null;

    if (action === "abort") {
      const runLogIdToAbort = typeof body.run_log_id === "string" ? body.run_log_id : null;
      if (!runLogIdToAbort) {
        return respond({ error: "run_log_id is required for abort action" }, 400);
      }

      const aborted = await abortHotlistMatchRun(supabase, runLogIdToAbort);
      if (!aborted) {
        return respond({ error: "Run not found or not running" }, 404);
      }

      return respond({
        message: "Abort requested",
        status: "aborted",
        run_log_id: runLogIdToAbort,
      });
    }

    const roleIdFilter = typeof body.role_id === "string" ? body.role_id : null;
    const socialJobIds = Array.isArray(body.social_job_ids)
      ? body.social_job_ids.filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
      : [];

    const triggerSource = typeof body.trigger_source === "string"
      ? body.trigger_source
      : (body.force_run === true && body.frequency_filter)
        ? "scheduled_cron"
        : roleIdFilter
          ? "manual_scoped"
          : "manual_all";
    const jobWindowHours = triggerSource === "manual_all" || triggerSource === "manual_scoped" ? 24 : 168;

    const { data: insertedRunLog } = await supabase
      .from("hotlist_match_runs")
      .insert({
        trigger_source: triggerSource,
        trigger_payload: body,
        account_id: null,
        role_id: roleIdFilter,
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    runLogId = (insertedRunLog?.id as string | undefined) ?? null;

    const result = await matchAllActiveRoles(
      supabase,
      supabaseUrl,
      serviceRoleKey,
      roleIdFilter,
      jobWindowHours,
      socialJobIds,
      runLogId,
    );
    const runStatus = typeof result.status === "string" ? result.status : "success";
    const runErrorMessage = typeof result.error_message === "string" ? result.error_message : null;

    if (runLogId) {
      const { data: currentRun } = await supabase
        .from("hotlist_match_runs")
        .select("status, error_message")
        .eq("id", runLogId)
        .maybeSingle();

      const existingStatus = typeof currentRun?.status === "string" ? currentRun.status : "running";
      const wasAborted = existingStatus === "aborted";
      const existingError = typeof currentRun?.error_message === "string" ? currentRun.error_message : null;

      await supabase
        .from("hotlist_match_runs")
        .update({
          roles_found: Number(result.roles_found ?? 0),
          profiles_processed: Number(result.profiles_processed ?? 0),
          total_matched: Number(result.total_matched ?? 0),
          status: wasAborted ? "aborted" : runStatus,
          error_message: wasAborted
            ? (existingError || runErrorMessage || "Run aborted by admin")
            : runErrorMessage,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAtMs,
        })
        .eq("id", runLogId);
    }

    return respond({
      ...result,
      mode: "direct_hotlist_roles",
      watch_schedule_gate_bypassed: true,
      run_log_id: runLogId,
    });
  } catch (err) {
    if (runLogId) {
      const { data: currentRun } = await supabase
        .from("hotlist_match_runs")
        .select("status")
        .eq("id", runLogId)
        .maybeSingle();

      if (currentRun?.status !== "aborted") {
        await supabase
          .from("hotlist_match_runs")
          .update({
            status: "error",
            error_message: (err as Error).message,
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startedAtMs,
          })
          .eq("id", runLogId);
      }
    }

    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

const HOTLIST_RETENTION_DAYS = 15;

function isHotlistEligible(profile: Record<string, unknown>, now = new Date()): boolean {
  const createdAt = profile.created_at ? new Date(profile.created_at as string) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return true;
  const ageDays = (now.getTime() - createdAt.getTime()) / 86_400_000;
  return ageDays <= HOTLIST_RETENTION_DAYS;
}

async function runFullPipeline(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
  schedule: Record<string, unknown>,
): Promise<{ id: string; status: string; jobs_matched: number }> {
  const scheduleId = schedule.id as string;
  const accountId = schedule.account_id as string;
  const profileId = schedule.profile_id as string | null;
  const boards = (schedule.boards as string[]) ?? [];
  const startTime = Date.now();

  // Create a run record
  const { data: run } = await supabase.from("watch_schedule_runs").insert({
    schedule_id: scheduleId,
    account_id: accountId,
    status: "running",
    jobs_fetched: 0,
    jobs_matched: 0,
    boards_searched: boards,
    duration_ms: 0,
    started_at: new Date().toISOString(),
  }).select().single();

  const runId = run?.id ?? null;

  // Update schedule status to scraping
  await supabase.from("watch_schedules").update({
    run_status: "scraping",
    current_run_id: runId,
    last_run_at: new Date().toISOString(),
  }).eq("id", scheduleId);

  let targetProfileIds: string[] = [];
  if (profileId) {
    targetProfileIds = [profileId];
  } else {
    // Load profiles from hotlist table
    const { data: hotlistRows, error: hotlistErr } = await supabase
      .from("hotlist")
      .select("profile_id")
      .eq("account_id", accountId);

    if (hotlistErr) {
      await finishRun(supabase, scheduleId, runId, "error", 0, 0, startTime, `Failed to load hotlist: ${hotlistErr.message}`);
      return { id: scheduleId, status: "error", jobs_matched: 0 };
    }

    const hotlistProfileIds = (hotlistRows ?? []).map((row) => row.profile_id as string).filter(Boolean);

    // Also load profiles linked to active hotlist_ai_roles
    const { data: aiRoles } = await supabase
      .from("hotlist_ai_roles")
      .select("target_role")
      .eq("account_id", accountId)
      .eq("is_active", true);

    let aiRoleProfileIds: string[] = [];
    if (aiRoles && aiRoles.length > 0) {
      const roleNames = aiRoles.map((r) => r.target_role as string).filter(Boolean);
      // Find matching profiles by target_role for this account
      const { data: roleProfiles } = await supabase
        .from("profiles")
        .select("id, target_role")
        .eq("account_id", accountId)
        .in("target_role", roleNames);

      aiRoleProfileIds = (roleProfiles ?? []).map((p) => p.id as string).filter(Boolean);
    }

    const candidateIds = Array.from(new Set([...hotlistProfileIds, ...aiRoleProfileIds]));
    targetProfileIds = candidateIds;
  }

  if (targetProfileIds.length === 0) {
    await finishRun(supabase, scheduleId, runId, "error", 0, 0, startTime, "No hotlist candidates found");
    return { id: scheduleId, status: "error", jobs_matched: 0 };
  }

  const { data: profileRows, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, created_at, candidate_name, target_role, preferred_locations, city, state")
    .in("id", targetProfileIds);

  if (profilesErr) {
    await finishRun(supabase, scheduleId, runId, "error", 0, 0, startTime, `Failed to load profiles: ${profilesErr.message}`);
    return { id: scheduleId, status: "error", jobs_matched: 0 };
  }

  const profiles = (profileRows ?? []).filter((profile) => isHotlistEligible(profile as Record<string, unknown>));
  if (profiles.length === 0) {
    await finishRun(supabase, scheduleId, runId, "error", 0, 0, startTime, "No eligible hotlist profiles found for watch run");
    return { id: scheduleId, status: "error", jobs_matched: 0 };
  }

  const expiredProfileIds = (profileRows ?? [])
    .filter((profile) => !isHotlistEligible(profile as Record<string, unknown>))
    .map((profile) => profile.id as string)
    .filter(Boolean);

  if (expiredProfileIds.length > 0) {
    await supabase.from("hotlist").delete().in("profile_id", expiredProfileIds).eq("account_id", accountId);
  }

  // ── Skip Part 1: Scraping is now handled by apify-scraper-scheduler ──
  // Jobs are read directly from social_jobs for this trigger path.

  // ── Step 2: Transition to matching ──
  await supabase.from("watch_schedules").update({ run_status: "matching" }).eq("id", scheduleId);

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceRoleKey}`,
  };

  // ── Step 3: Run radar-match ──
  let jobsMatched = 0;
  let jobsFetched = 0;
  let runStatus: "success" | "partial" | "error" = "success";
  let errorMsg: string | null = null;
  let successfulProfiles = 0;

  for (const profileRow of profiles) {
    const currentProfileId = profileRow.id as string;
    const role = (profileRow.target_role as string) ?? "";
    if (!role) continue;

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/radar-match`, {
        method: "POST",
        headers,
        body: JSON.stringify({ profile_id: currentProfileId, account_id: accountId }),
      });

      const result = await res.json();
      const matched = result.matched ?? 0;
      const fetched = matched + (result.skipped ?? 0);
      jobsMatched += matched;
      jobsFetched += fetched;

      if (!res.ok || result.error) {
        runStatus = runStatus === "success" ? "partial" : runStatus;
        errorMsg = result.error ?? `HTTP ${res.status}`;
      } else {
        successfulProfiles += 1;
      }
    } catch (err) {
      runStatus = runStatus === "success" ? "partial" : runStatus;
      errorMsg = (err as Error).message;
    }
  }

  if (successfulProfiles === 0) {
    runStatus = "error";
    if (!errorMsg) errorMsg = "All candidate matching attempts failed";
  }

  // ── Step 4: Finish run ──
  await finishRun(supabase, scheduleId, runId, runStatus, jobsFetched, jobsMatched, startTime, errorMsg);

  // Send notification on success
  if (runStatus === "success") {
    const watchContext = profileId
      ? (profiles.find((p) => p.id === profileId)?.candidate_name as string | undefined) ?? "your candidate"
      : `${successfulProfiles} hotlist candidate${successfulProfiles === 1 ? "" : "s"}`;

    await supabase.from("notifications").insert({
      account_id: accountId,
      type: "watch_complete",
      title: "Watch Schedule Complete",
      body: jobsMatched > 0
        ? `Found ${jobsMatched} matching jobs for ${watchContext}. Check the Job Watch AI results.`
        : `No new matching jobs found for ${watchContext} this run.`,
      link: "/job-watch-ai",
      read: false,
    });
  }

  return { id: scheduleId, status: runStatus, jobs_matched: jobsMatched };
}

async function finishRun(
  supabase: ReturnType<typeof createClient>,
  scheduleId: string,
  runId: string | null,
  status: string,
  jobsFetched: number,
  jobsMatched: number,
  startTime: number,
  errorMessage: string | null,
) {
  const durationMs = Date.now() - startTime;

  if (runId) {
    await supabase.from("watch_schedule_runs").update({
      status,
      jobs_fetched: jobsFetched,
      jobs_matched: jobsMatched,
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
    }).eq("id", runId);
  }

  await supabase.from("watch_schedules").update({
    run_status: "idle",
    current_run_id: null,
  }).eq("id", scheduleId);
}

function isScheduleDue(lastRun: Date | null, frequency: string, now: Date): boolean {
  if (!lastRun) return true;
  const diffMs = now.getTime() - lastRun.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  switch (frequency) {
    case "hourly": return diffHours >= 1;
    case "3_hours": return diffHours >= 3;
    case "twice_daily": return diffHours >= 12;
    case "daily": return diffHours >= 24;
    case "weekly": return diffHours >= 168;
    default: return diffHours >= 24;
  }
}

function extractRadarMatchResultFromStream(rawText: string): { matched: number; error: string | null; done: boolean } {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let matched = 0;
  let error: string | null = null;
  let done = false;

  for (const line of lines) {
    try {
      const payload = JSON.parse(line) as Record<string, unknown>;
      if (payload.type === "done") {
        matched = Number(payload.matched ?? 0);
        done = true;
      }
      if (payload.type === "error" && typeof payload.error === "string") {
        error = payload.error;
      }
      if (typeof payload.error === "string") {
        error = payload.error;
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }

  if (!done && !error) {
    error = "radar-match stream ended before done event";
  }

  return { matched, error, done };
}

async function matchAllActiveRoles(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
  roleIdFilter: string | null,
  jobWindowHours: number,
  socialJobIds: string[],
  runLogId: string | null,
): Promise<Record<string, unknown>> {
  // Load all active hotlist_ai_roles directly.
  let rolesQuery = supabase
    .from("hotlist_ai_roles")
    .select("id, target_role, priority_skills")
    .eq("is_active", true);

  if (roleIdFilter) {
    rolesQuery = rolesQuery.eq("id", roleIdFilter);
  }

  const { data: roles, error: rolesErr } = await rolesQuery;

  if (rolesErr || !roles || roles.length === 0) {
    return {
      message: "No active hotlist_ai_roles found",
      status: "error",
      error_message: "No active hotlist_ai_roles found",
      profiles_processed: 0,
      total_matched: 0,
      roles_found: 0,
    };
  }

  const roleNames = Array.from(new Set(roles.map((r) => r.target_role as string).filter(Boolean)));
  if (roleNames.length === 0) {
    return {
      message: "No active roles with target_role found",
      status: "error",
      error_message: "Active roles are missing target_role values",
      profiles_processed: 0,
      total_matched: 0,
      roles_found: roles.length,
    };
  }

  let totalMatched = 0;
  let rolesProcessed = 0;
  let rolesFailed = 0;
  let firstFailureReason: string | null = null;
  const processedRoleIds: string[] = [];

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceRoleKey}`,
  };

  for (const role of roles) {
    if (runLogId) {
      const aborted = await isHotlistMatchRunAborted(supabase, runLogId);
      if (aborted) {
        return {
          message: "Role match run aborted",
          status: "aborted",
          error_message: "Run aborted by admin",
          roles_failed: rolesFailed,
          first_failure_reason: firstFailureReason,
          profiles_processed: rolesProcessed,
          roles_processed: rolesProcessed,
          total_matched: totalMatched,
          roles_found: roles.length,
        };
      }
    }

    const roleId = role.id as string;
    const targetRoleRaw = (role.target_role as string | null) ?? "";
    const targetRole = targetRoleRaw.trim();
    if (!targetRole) continue;

    let roleMatches = 0;

    try {
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => abortController.abort("radar-match timeout"), 300000);

      const res = await fetch(`${supabaseUrl}/functions/v1/radar-match`, {
        method: "POST",
        headers,
        signal: abortController.signal,
        body: JSON.stringify({
          role_id: roleId,
          source_scope: "social_only",
          bypass_plan_limits: true,
          vector_similarity_threshold: 0.5,
          min_score: 0,
          job_window_hours: jobWindowHours,
          social_job_ids: socialJobIds,
        }),
      });
      clearTimeout(timeoutHandle);

      const raw = await res.text();
      const parsed = extractRadarMatchResultFromStream(raw);
      if (!res.ok || parsed.error) {
        rolesFailed += 1;
        if (!firstFailureReason) {
          firstFailureReason = parsed.error ?? `radar-match failed with HTTP ${res.status}`;
        }
        continue;
      }

      roleMatches = parsed.matched;
    } catch (err) {
      rolesFailed += 1;
      if (!firstFailureReason) {
        firstFailureReason = (err as Error).message || "radar-match request failed";
      }
      continue;
    }

    totalMatched += roleMatches;
    rolesProcessed += 1;
    processedRoleIds.push(roleId);

    await supabase
      .from("hotlist_ai_roles")
      .update({
        last_result_summary: `${roleMatches} radar matches saved`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", roleId);
  }

  if (processedRoleIds.length > 0) {
    await supabase
      .from("hotlist_ai_roles")
      .update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .in("id", processedRoleIds);
  }

  return {
    message: "Role match run complete (social_jobs via radar-match)",
    status: rolesProcessed > 0 ? "success" : "error",
    error_message: firstFailureReason ?? (rolesProcessed > 0 ? null : "No roles were processed successfully"),
    roles_failed: rolesFailed,
    first_failure_reason: firstFailureReason,
    profiles_processed: rolesProcessed,
    roles_processed: rolesProcessed,
    total_matched: totalMatched,
    roles_found: roles.length,
  };
}

async function isHotlistMatchRunAborted(
  supabase: ReturnType<typeof createClient>,
  runLogId: string,
): Promise<boolean> {
  const { data: row } = await supabase
    .from("hotlist_match_runs")
    .select("status")
    .eq("id", runLogId)
    .maybeSingle();
  return row?.status === "aborted";
}

async function abortHotlistMatchRun(
  supabase: ReturnType<typeof createClient>,
  runLogId: string,
): Promise<boolean> {
  const { data: current } = await supabase
    .from("hotlist_match_runs")
    .select("id, status, started_at")
    .eq("id", runLogId)
    .maybeSingle();

  if (!current || current.status !== "running") {
    return false;
  }

  const startedAt = typeof current.started_at === "string" ? new Date(current.started_at).getTime() : Date.now();
  const durationMs = Math.max(0, Date.now() - (Number.isFinite(startedAt) ? startedAt : Date.now()));

  await supabase
    .from("hotlist_match_runs")
    .update({
      status: "aborted",
      error_message: "Run aborted by admin",
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
    })
    .eq("id", runLogId)
    .eq("status", "running");

  return true;
}

function respond(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
