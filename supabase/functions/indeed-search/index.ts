import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") ?? "";
const APIFY_ACTOR = "kaix~indeed-scraper";
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
      keyword = "",
      location = "",
      date_posted = "Any time",
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

    const { data: runningCount } = await supabase.rpc("get_running_scrape_count");
    if ((runningCount ?? 0) >= MAX_CONCURRENT) {
      const { data: queued } = await supabase.from("scrape_queue").insert({
        board: "indeed",
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
      board: "indeed",
      status: "running",
      request_body: body,
      account_id: account_id ?? null,
      user_id: user_id ?? null,
      position: 0,
      started_at: new Date().toISOString(),
    }).select().single();

    const normalizedKeyword = (keyword as string).trim().toLowerCase();
    const normalizedLocation = (location as string).trim().toLowerCase();
    const normalizedDatePosted = (date_posted as string);

    const { data: searchRecord, error: searchErr } = await supabase
      .from("indeed_job_searches")
      .insert({
        keyword: normalizedKeyword,
        location: normalizedLocation,
        date_posted: normalizedDatePosted,
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

    // Map date_posted to fromDays param
    const fromDaysMap: Record<string, string | undefined> = {
      "last24Hours": "1",
      "last3Days": "3",
      "lastWeek": "7",
      "last14Days": "14",
      "Any time": undefined,
    };
    const fromDays = fromDaysMap[normalizedDatePosted] ?? fromDaysMap[date_posted];

    const apifyInput: Record<string, unknown> = {
      keyword: (keyword as string).trim(),
      location: (location as string).trim(),
      country: "US",
      maxItems: effectiveMax,
      searchMode: "rich",
      sort: "date",
    };
    if (fromDays) apifyInput.fromDays = fromDays;

    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs?token=${APIFY_TOKEN}&waitForFinish=120`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apifyInput) },
    );

    if (!runRes.ok) {
      const errText = await runRes.text();
      await supabase.from("indeed_job_searches").update({ status: "failed" }).eq("id", searchRecord.id);
      if (queueEntry) await supabase.from("scrape_queue").update({ status: "failed", error_message: errText, completed_at: new Date().toISOString() }).eq("id", queueEntry.id);
      throw new Error(`Apify error ${runRes.status}: ${errText}`);
    }

    const runBody = await runRes.json();
    const run = runBody.data;

    await supabase.from("indeed_job_searches").update({ apify_run_id: run.id }).eq("id", searchRecord.id);

    if (run.status !== "SUCCEEDED") {
      await supabase.from("indeed_job_searches").update({ status: run.status === "FAILED" ? "failed" : "timeout" }).eq("id", searchRecord.id);
      if (queueEntry) await supabase.from("scrape_queue").update({ status: "failed", error_message: `Apify ${run.status}`, completed_at: new Date().toISOString() }).eq("id", queueEntry.id);
      throw new Error(`Apify run ended with status ${run.status} (id: ${run.id})`);
    }

    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${APIFY_TOKEN}&limit=${effectiveMax}&clean=true`,
    );
    const items: Record<string, unknown>[] = itemsRes.ok ? await itemsRes.json() : [];

    if (items.length > 0) {
      const rows = items.map((j) => {
        const title = (j.title as Record<string, unknown>) ?? {};
        const urls = (j.urls as Record<string, unknown>) ?? {};
        const salary = (j.salary as Record<string, unknown>) ?? {};
        const company = (j.company as Record<string, unknown>) ?? {};
        const loc = (j.location as Record<string, unknown>) ?? {};
        const classification = (j.classification as Record<string, unknown>) ?? {};
        const workArrangement = (j.workArrangement as Record<string, unknown>) ?? {};
        const dates = (j.dates as Record<string, unknown>) ?? {};
        const signals = (j.signals as Record<string, unknown>) ?? {};
        const requirements = (j.requirements as Record<string, unknown>) ?? {};
        const description = (j.description as Record<string, unknown>) ?? {};
        const companyLogos = (company.logos as Record<string, unknown>) ?? {};
        const companyUrls = (company.urls as Record<string, unknown>) ?? {};

        const locationDisplay = (loc.formatted as string) || (loc.formattedShort as string) || "";
        const isRemote = Boolean(workArrangement.isRemote) || locationDisplay.toLowerCase().includes("remote");

        return {
          search_id: searchRecord.id,
          indeed_key: (j.id as string) ?? null,
          job_url: (urls.indeed as string) ?? null,
          apply_url: (urls.external as string) || (urls.apply as string) || null,
          job_title: (title.text as string) ?? null,
          company_name: (company.name as string) ?? null,
          company_page_url: (companyUrls.indeed as string) || (companyUrls.website as string) || null,
          company_logo_url: (companyLogos.square as string) || (companyLogos.rectangular as string) || null,
          location_city: (loc.city as string) || null,
          location_state: (loc.state as string) || null,
          location_display: locationDisplay || null,
          salary_display: (salary.text as string) || null,
          salary_min: (salary.min as number) ?? null,
          salary_max: (salary.max as number) ?? null,
          salary_unit: (salary.period as string) || null,
          salary_currency: (salary.currency as string) || null,
          employment_type: (classification.jobType as string) || null,
          is_remote: isRemote,
          is_urgent: Boolean(signals.isUrgentHire),
          date_published: (dates.posted as string) || (dates.onIndeed as string) || null,
          job_description: (description.html as string) || (description.text as string) || null,
          benefits: j.benefits ?? {},
          attributes: classification.attributes ?? {},
          occupations: classification.occupations ?? {},
          raw_payload: j,
        };
      });

      const { error: insertErr } = await supabase.from("indeed_jobs").insert(rows);
      if (insertErr) {
        await supabase.from("indeed_job_searches").update({ status: "failed" }).eq("id", searchRecord.id);
        if (queueEntry) await supabase.from("scrape_queue").update({ status: "failed", error_message: insertErr.message, completed_at: new Date().toISOString() }).eq("id", queueEntry.id);
        throw new Error(`Failed to save jobs: ${insertErr.message}`);
      }
    }

    const usage = (run.usage ?? {}) as Record<string, number>;
    const computeUnits: number = (usage.ACTOR_COMPUTE_UNITS ?? run.stats?.computeUnits) || 0;
    const proxyGb: number = usage.PROXY_RESIDENTIAL_TRANSFER_GBYTES ?? 0;
    const breakdownCost = computeUnits * 0.25 + proxyGb * 8;
    const apifyCost: number = breakdownCost > 0 ? breakdownCost : ((run.usageTotalUsd as number) ?? 0);
    const costUsd = apifyCost * COST_MULTIPLIER;

    await supabase.from("indeed_job_searches").update({
      status: "completed", total_jobs: items.length, compute_units: computeUnits, cost_usd: costUsd, completed_at: new Date().toISOString(),
    }).eq("id", searchRecord.id);

    if (queueEntry) await supabase.from("scrape_queue").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", queueEntry.id);

    try {
      await supabase.from("api_usage_log").insert({
        account_id: searchRecord.account_id ?? null, user_id: searchRecord.user_id ?? null,
        function_name: "indeed-search", provider: "apify", model: APIFY_ACTOR,
        compute_units: computeUnits, cost_usd: costUsd, total_tokens: 0,
        metadata: { search_id: searchRecord.id, total_jobs: items.length },
      });
    } catch (logErr) { console.error("Usage log failed:", logErr); }

    const { data: finalSearch } = await supabase.from("indeed_job_searches").select("*").eq("id", searchRecord.id).single();
    const { data: savedJobs } = await supabase.from("indeed_jobs").select("*").eq("search_id", searchRecord.id).order("created_at", { ascending: true });

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
