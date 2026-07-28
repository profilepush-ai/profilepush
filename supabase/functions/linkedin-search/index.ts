import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") ?? "";
const APIFY_ACTOR = "worldunboxer~rapid-linkedin-scraper";
const MAX_JOBS = 25;
const COST_MULTIPLIER = 4;
const MAX_CONCURRENT = 20;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json();
    const {
      job_title = "",
      location = "",
      posted_within = "Any Time",
      experience_level = "",
      employment_type = "",
      work_arrangement = "",
      account_id = null,
      user_id = null,
      max_results = MAX_JOBS,
    } = body;

    const effectiveMax = Math.min(Math.max(Number(max_results) || MAX_JOBS, 1), 200);

    if (account_id) {
      const { data: hasFunds } = await supabase.rpc("check_credit_balance", {
        p_account_id: account_id,
        p_min_balance: 0.001,
      });
      if (hasFunds === false) {
        return new Response(JSON.stringify({ error: "Insufficient credits. Please top up your account." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Check concurrent Apify sessions
    const { data: runningCount } = await supabase.rpc("get_running_scrape_count");
    if ((runningCount ?? 0) >= MAX_CONCURRENT) {
      // Queue the request
      const { data: queued } = await supabase.from("scrape_queue").insert({
        board: "linkedin",
        status: "queued",
        request_body: body,
        account_id: account_id ?? null,
        user_id: user_id ?? null,
        position: (runningCount ?? 0) - MAX_CONCURRENT + 1,
      }).select().single();

      const position = queued?.position ?? 1;
      return new Response(JSON.stringify({
        queued: true,
        queue_id: queued?.id ?? null,
        position,
        eta_seconds: position * 120,
        message: "We're experiencing high demand. Your search has been queued.",
      }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark as running in queue
    const { data: queueEntry } = await supabase.from("scrape_queue").insert({
      board: "linkedin",
      status: "running",
      request_body: body,
      account_id: account_id ?? null,
      user_id: user_id ?? null,
      position: 0,
      started_at: new Date().toISOString(),
    }).select().single();

    const normalizedTitle = (job_title as string).trim().toLowerCase();
    const normalizedLocation = (location as string).trim().toLowerCase();

    const { data: searchRecord, error: searchErr } = await supabase
      .from("linkedin_job_searches")
      .insert({
        job_title: normalizedTitle,
        location: normalizedLocation,
        posted_within,
        experience_level,
        employment_type,
        work_arrangement,
        account_id: account_id ?? null,
        user_id: user_id ?? null,
        status: "running",
      })
      .select()
      .single();

    if (searchErr || !searchRecord) {
      if (queueEntry) await supabase.from("scrape_queue").update({ status: "failed", error_message: "Failed to create search record" }).eq("id", queueEntry.id);
      throw new Error("Failed to create search record");
    }

    const apifyInput: Record<string, unknown> = {
      job_title: (job_title as string).trim(),
      location: (location as string).trim(),
      jobs_entries: effectiveMax,
    };
    if (posted_within && posted_within !== "Any Time") apifyInput.posted_within = posted_within;
    if (experience_level) apifyInput.experience_level = experience_level;
    if (employment_type) apifyInput.employment_type = employment_type;
    if (work_arrangement) apifyInput.work_arrangement = work_arrangement;

    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs?token=${APIFY_TOKEN}&waitForFinish=90`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apifyInput),
      },
    );

    if (!runRes.ok) {
      const errText = await runRes.text();
      await supabase.from("linkedin_job_searches").update({ status: "failed" }).eq("id", searchRecord.id);
      if (queueEntry) await supabase.from("scrape_queue").update({ status: "failed", error_message: errText, completed_at: new Date().toISOString() }).eq("id", queueEntry.id);
      throw new Error(`Apify error ${runRes.status}: ${errText}`);
    }

    const runBody = await runRes.json();
    const run = runBody.data;

    await supabase.from("linkedin_job_searches").update({ apify_run_id: run.id }).eq("id", searchRecord.id);

    if (run.status !== "SUCCEEDED") {
      await supabase
        .from("linkedin_job_searches")
        .update({ status: run.status === "FAILED" ? "failed" : "timeout" })
        .eq("id", searchRecord.id);
      if (queueEntry) await supabase.from("scrape_queue").update({ status: "failed", error_message: `Apify ${run.status}`, completed_at: new Date().toISOString() }).eq("id", queueEntry.id);
      throw new Error(`Apify run ended with status ${run.status} (id: ${run.id})`);
    }

    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${APIFY_TOKEN}&limit=${effectiveMax}&clean=true`,
    );
    const items: Record<string, unknown>[] = itemsRes.ok ? await itemsRes.json() : [];

    if (items.length > 0) {
      const rows = items.map((j) => ({
        search_id: searchRecord.id,
        job_id: (j.job_id as string) ?? null,
        job_url: (j.job_url as string) ?? null,
        apply_url: (j.apply_url as string) ?? null,
        job_title: (j.job_title as string) ?? null,
        company_name: (j.company_name as string) ?? null,
        company_url: (j.company_url as string) ?? null,
        company_logo_url: (j.company_logo_url as string) ?? null,
        location: (j.location as string) ?? null,
        time_posted: (j.time_posted as string) ?? null,
        num_applicants: j.num_applicants != null ? String(j.num_applicants) : null,
        salary_range: (j.salary_range as string) ?? null,
        job_description: (j.job_description as string) ?? null,
        seniority_level: (j.seniority_level as string) ?? null,
        employment_type: (j.employment_type as string) ?? null,
        job_function: (j.job_function as string) ?? null,
        industries: (j.industries as string) ?? null,
        easy_apply: (j.easy_apply as boolean) ?? false,
        raw_payload: j,
      }));
      const { data: inserted, error: insertErr } = await supabase.from("linkedin_jobs").insert(rows).select("id");
      if (insertErr) {
        await supabase.from("linkedin_job_searches").update({ status: "failed" }).eq("id", searchRecord.id);
        if (queueEntry) await supabase.from("scrape_queue").update({ status: "failed", error_message: insertErr.message, completed_at: new Date().toISOString() }).eq("id", queueEntry.id);
        throw new Error(`Failed to save jobs: ${insertErr.message}`);
      }

      if (inserted && inserted.length > 0) {
        const embeddingPayload = inserted.map((r: { id: string }) => ({ type: "job", id: r.id, table: "linkedin_jobs" }));
        const EMB_BATCH = 20;
        for (let i = 0; i < embeddingPayload.length; i += EMB_BATCH) {
          const batch = embeddingPayload.slice(i, i + EMB_BATCH);
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-embedding`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            },
            body: JSON.stringify(batch),
          }).catch(() => {});
        }
      }
    }

    const usage = (run.usage ?? {}) as Record<string, number>;
    const computeUnits: number = (usage.ACTOR_COMPUTE_UNITS ?? run.stats?.computeUnits) || 0;
    const proxyGb: number = usage.PROXY_RESIDENTIAL_TRANSFER_GBYTES ?? 0;
    const breakdownCost = computeUnits * 0.25 + proxyGb * 8;
    const apifyCost: number = breakdownCost > 0 ? breakdownCost : ((run.usageTotalUsd as number) ?? 0);
    const costUsd = apifyCost * COST_MULTIPLIER;

    await supabase
      .from("linkedin_job_searches")
      .update({
        status: "completed",
        total_jobs: items.length,
        compute_units: computeUnits,
        cost_usd: costUsd,
        completed_at: new Date().toISOString(),
      })
      .eq("id", searchRecord.id);

    // Mark queue entry as completed
    if (queueEntry) {
      await supabase.from("scrape_queue").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", queueEntry.id);
    }

    try {
      await supabase.from("api_usage_log").insert({
        account_id:    searchRecord.account_id ?? null,
        user_id:       searchRecord.user_id ?? null,
        function_name: "linkedin-search",
        provider:      "apify",
        model:         APIFY_ACTOR,
        compute_units: computeUnits,
        cost_usd:      costUsd,
        total_tokens:  0,
        metadata:      { search_id: searchRecord.id, total_jobs: items.length },
      });
    } catch (logErr) { console.error("Usage log failed:", logErr); }

    const { data: finalSearch } = await supabase
      .from("linkedin_job_searches")
      .select("*")
      .eq("id", searchRecord.id)
      .single();

    const { data: savedJobs } = await supabase
      .from("linkedin_jobs")
      .select("*")
      .eq("search_id", searchRecord.id)
      .order("created_at", { ascending: true });

    return new Response(
      JSON.stringify({ search: finalSearch, jobs: savedJobs ?? [], cached: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
