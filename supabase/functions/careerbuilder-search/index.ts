import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { DAILY_USAGE_WINDOW_MS, FREE_PLAN_DAILY_SEARCH_LIMIT, buildUsageLimitError, getIsPaidPlan, isUsageAllowed } from "../_shared/usage-limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") ?? "";
const APIFY_ACTOR = "parseforge~careerbuilder-scraper";
const MAX_JOBS = 25;
const COST_MULTIPLIER = 4;
const MAX_CONCURRENT = 20;

const DATE_MAP: Record<string, string> = {
  "Any time":       "",
  "Last 24 hours":  "1",
  "Last week":      "7",
  "Last month":     "30",
};

function toLocationSlug(loc: string): string {
  const parts = loc.trim().split(",");
  const city = parts[0].trim().toLowerCase().replace(/\s+/g, "-");
  const state = parts[1] ? parts[1].trim().toLowerCase() : "";
  return state ? `${city},${state}` : city;
}

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
      keyword = "",
      location = "",
      date_posted = "Any time",
      account_id = null,
      user_id = null,
      max_results = MAX_JOBS,
    } = body;

    const effectiveMax = Math.min(Math.max(Number(max_results) || MAX_JOBS, 1), 200);

    const isPaidPlan = await getIsPaidPlan(supabase, account_id ?? null);

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

      if (!isPaidPlan) {
        const sinceIso = new Date(Date.now() - DAILY_USAGE_WINDOW_MS).toISOString();
        const { data: usageRows, error: usageError } = await supabase
          .from("api_usage_log")
          .select("created_at")
          .eq("account_id", account_id)
          .eq("function_name", "careerbuilder-search")
          .gte("created_at", sinceIso);

        if (usageError) throw usageError;

        const currentCount = (usageRows ?? []).length;
        if (!isUsageAllowed(currentCount, FREE_PLAN_DAILY_SEARCH_LIMIT)) {
          return new Response(JSON.stringify({ error: buildUsageLimitError(FREE_PLAN_DAILY_SEARCH_LIMIT, "job finder searches") }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const { data: runningCount } = await supabase.rpc("get_running_scrape_count");
    if ((runningCount ?? 0) >= MAX_CONCURRENT) {
      const { data: queued } = await supabase.from("scrape_queue").insert({
        board: "careerbuilder",
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
      }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: queueEntry } = await supabase.from("scrape_queue").insert({
      board: "careerbuilder",
      status: "running",
      request_body: body,
      account_id: account_id ?? null,
      user_id: user_id ?? null,
      position: 0,
      started_at: new Date().toISOString(),
    }).select().single();

    const normalizedKeyword = (keyword as string).trim().toLowerCase();
    const normalizedLocation = (location as string).trim().toLowerCase();
    const cbDatePosted = DATE_MAP[date_posted as string] ?? "";

    const { data: searchRecord, error: searchErr } = await supabase
      .from("careerbuilder_job_searches")
      .insert({
        keyword: normalizedKeyword,
        location: normalizedLocation,
        date_posted: (date_posted as string),
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
      keywords: (keyword as string).trim(),
      location: toLocationSlug(location as string),
      datePosted: cbDatePosted,
      includeDetails: false,
      maxItems: effectiveMax,
      proxyConfiguration: { useApifyProxy: true },
      remoteOnly: false,
      jobType: "",
      radius: 30,
      maxConcurrency: 5,
      requestDelayMs: 200,
    };

    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs?token=${APIFY_TOKEN}&waitForFinish=90`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apifyInput) },
    );

    if (!runRes.ok) {
      const errText = await runRes.text();
      await supabase.from("careerbuilder_job_searches").update({ status: "failed" }).eq("id", searchRecord.id);
      if (queueEntry) await supabase.from("scrape_queue").update({ status: "failed", error_message: errText, completed_at: new Date().toISOString() }).eq("id", queueEntry.id);
      throw new Error(`Apify error ${runRes.status}: ${errText}`);
    }

    const runBody = await runRes.json();
    const run = runBody.data;

    await supabase.from("careerbuilder_job_searches").update({ apify_run_id: run.id }).eq("id", searchRecord.id);

    if (run.status !== "SUCCEEDED") {
      await supabase.from("careerbuilder_job_searches").update({ status: run.status === "FAILED" ? "failed" : "timeout" }).eq("id", searchRecord.id);
      if (queueEntry) await supabase.from("scrape_queue").update({ status: "failed", error_message: `Apify ${run.status}`, completed_at: new Date().toISOString() }).eq("id", queueEntry.id);
      throw new Error(`Apify run ended with status ${run.status} (id: ${run.id})`);
    }

    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${APIFY_TOKEN}&limit=${effectiveMax}&clean=true`,
    );
    const items: Record<string, unknown>[] = itemsRes.ok ? await itemsRes.json() : [];

    if (items.length > 0) {
      const rows = items.map((j) => {
        const city = (j.addressLocality as string) || null;
        const state = (j.addressRegion as string) || null;
        const locationDisplay = city && state ? `${city}, ${state}` : (j.location as string) || null;
        const skills = Array.isArray(j.skills) ? j.skills : [];
        const benefits = Array.isArray(j.benefits) ? j.benefits : [];

        return {
          search_id: searchRecord.id,
          cb_key: (j.jobId as string) ?? null,
          job_url: (j.jobUrl as string) || null,
          apply_url: (j.applyUrl as string) || null,
          job_title: (j.title as string) || null,
          company_name: (j.company as string) || null,
          location_city: city,
          location_state: state,
          location_display: locationDisplay,
          salary_display: (j.salaryFormatted as string) || null,
          salary_currency: (j.salaryCurrency as string) || null,
          salary_unit: (j.salaryBaseType as string) || null,
          employment_type: (j.employmentType as string) || null,
          is_remote: (j.isRemote as boolean) ?? false,
          is_promoted: (j.isPromoted as boolean) ?? false,
          date_published: (j.datePosted as string) ? new Date(j.datePosted as string).toISOString() : null,
          date_recency: (j.dateRecency as string) || null,
          short_description: (j.shortDescription as string) || null,
          job_description: (j.description as string) || null,
          skills,
          benefits_list: benefits,
          occupational_category: (j.occupationalCategory as string) || null,
          raw_payload: j,
        };
      });

      const { data: inserted, error: insertErr } = await supabase.from("careerbuilder_jobs").insert(rows).select("id");
      if (insertErr) {
        await supabase.from("careerbuilder_job_searches").update({ status: "failed" }).eq("id", searchRecord.id);
        if (queueEntry) await supabase.from("scrape_queue").update({ status: "failed", error_message: insertErr.message, completed_at: new Date().toISOString() }).eq("id", queueEntry.id);
        throw new Error(`Failed to save jobs: ${insertErr.message}`);
      }

      if (inserted && inserted.length > 0) {
        const embeddingPayload = inserted.map((r: { id: string }) => ({ type: "job", id: r.id, table: "careerbuilder_jobs" }));
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

    await supabase.from("careerbuilder_job_searches").update({
      status: "completed", total_jobs: items.length, compute_units: computeUnits, cost_usd: costUsd, completed_at: new Date().toISOString(),
    }).eq("id", searchRecord.id);

    if (queueEntry) await supabase.from("scrape_queue").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", queueEntry.id);

    try {
      await supabase.from("api_usage_log").insert({
        account_id: searchRecord.account_id ?? null, user_id: searchRecord.user_id ?? null,
        function_name: "careerbuilder-search", provider: "apify", model: APIFY_ACTOR,
        compute_units: computeUnits, cost_usd: costUsd, total_tokens: 0,
        metadata: { search_id: searchRecord.id, total_jobs: items.length },
      });
    } catch (logErr) { console.error("Usage log failed:", logErr); }

    const { data: finalSearch } = await supabase.from("careerbuilder_job_searches").select("*").eq("id", searchRecord.id).single();
    const { data: savedJobs } = await supabase.from("careerbuilder_jobs").select("*").eq("search_id", searchRecord.id).order("created_at", { ascending: true });

    return new Response(
      JSON.stringify({ search: finalSearch, jobs: savedJobs ?? [], cached: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
