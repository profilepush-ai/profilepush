import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BOARD_FUNCTION_MAP: Record<string, string> = {
  linkedin: "linkedin-search",
  dice: "dice-search",
  indeed: "indeed-search",
  monster: "monster-search",
  careerbuilder: "careerbuilder-search",
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
    const forcedScheduleId = body.schedule_id ?? null;

    let query = supabase.from("watch_schedules").select("*").eq("is_active", true);
    if (forcedScheduleId) {
      query = supabase.from("watch_schedules").select("*").eq("id", forcedScheduleId);
    }
    const { data: schedules, error: schedErr } = await query;

    if (schedErr) throw new Error(`Failed to load schedules: ${schedErr.message}`);
    if (!schedules || schedules.length === 0) {
      return respond({ message: "No active schedules", triggered: 0 });
    }

    const now = new Date();
    const results: Array<{ id: string; status: string; jobs_matched: number }> = [];

    for (const schedule of schedules) {
      const isDue = forcedScheduleId || isScheduleDue(
        schedule.last_run_at ? new Date(schedule.last_run_at) : null,
        schedule.frequency,
        now,
      );
      if (!isDue) continue;

      const result = await runFullPipeline(supabase, supabaseUrl, serviceRoleKey, schedule);
      results.push(result);
    }

    return respond({ message: "Trigger complete", triggered: results.length, results });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

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
    const { data: hotlistRows, error: hotlistErr } = await supabase
      .from("hotlist")
      .select("profile_id")
      .eq("account_id", accountId);

    if (hotlistErr) {
      await finishRun(supabase, scheduleId, runId, "error", 0, 0, startTime, `Failed to load hotlist: ${hotlistErr.message}`);
      return { id: scheduleId, status: "error", jobs_matched: 0 };
    }

    targetProfileIds = Array.from(new Set((hotlistRows ?? []).map((row) => row.profile_id as string).filter(Boolean)));
  }

  if (targetProfileIds.length === 0) {
    await finishRun(supabase, scheduleId, runId, "error", 0, 0, startTime, "No hotlist candidates found");
    return { id: scheduleId, status: "error", jobs_matched: 0 };
  }

  const { data: profileRows, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, candidate_name, target_role, preferred_locations, city, state")
    .in("id", targetProfileIds);

  if (profilesErr) {
    await finishRun(supabase, scheduleId, runId, "error", 0, 0, startTime, `Failed to load profiles: ${profilesErr.message}`);
    return { id: scheduleId, status: "error", jobs_matched: 0 };
  }

  const profiles = profileRows ?? [];
  if (profiles.length === 0) {
    await finishRun(supabase, scheduleId, runId, "error", 0, 0, startTime, "No valid profiles found for watch run");
    return { id: scheduleId, status: "error", jobs_matched: 0 };
  }

  // ── Step 1: Run scrapers (await each so we know scraping is done) ──
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceRoleKey}`,
  };

  const scrapePromises = profiles.flatMap((profileRow) => {
    const jobTitle = (profileRow.target_role as string) ?? "";
    const location = (profileRow.preferred_locations as string) ?? (profileRow.city as string) ?? (profileRow.state as string) ?? "";
    if (!jobTitle) return [];

    return boards.map(async (board) => {
      const fnName = BOARD_FUNCTION_MAP[board];
      if (!fnName) return;
      try {
        const searchBody: Record<string, unknown> = {
          account_id: accountId,
          max_results: 25,
          force_refresh: false,
        };
        if (board === "linkedin") {
          searchBody.job_title = `"${jobTitle}"`;
          searchBody.location = location;
          searchBody.posted_within = "Past Week";
        } else if (board === "dice") {
          searchBody.keyword = `"${jobTitle}"`;
          searchBody.location = location;
          searchBody.posted_date = "Past week";
        } else {
          searchBody.keyword = `"${jobTitle}"`;
          searchBody.location = location;
          searchBody.date_posted = "Past week";
        }

        await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
          method: "POST",
          headers,
          body: JSON.stringify(searchBody),
        });
      } catch {
        // Individual board failure shouldn't block pipeline
      }
    });
  });

  await Promise.allSettled(scrapePromises);

  // ── Step 2: Transition to matching ──
  await supabase.from("watch_schedules").update({ run_status: "matching" }).eq("id", scheduleId);

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
    case "twice_daily": return diffHours >= 12;
    case "daily": return diffHours >= 24;
    case "weekly": return diffHours >= 168;
    default: return diffHours >= 24;
  }
}

function respond(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
