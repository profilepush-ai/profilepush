import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") ?? "";
const APIFY_ACTOR = "valig~indeed-jobs-scraper";
const MAX_JOBS = 25;
const COST_MULTIPLIER = 4;
const MAX_CONCURRENT = 20;

const FROM_DAYS_MAP: Record<string, string | undefined> = {
  "Any time": undefined,
  "Last 24 hours": "1",
  "Last week": "7",
  "Last month": "14",
  "last24Hours": "1",
  "last3Days": "3",
  "lastWeek": "7",
  "last14Days": "14",
};

function extractIndeedTitlePhrases(keyword: string): string[] {
  const match = keyword.match(/title:\((.*)\)/i);
  if (!match) return [];

  const inner = match[1] ?? "";
  const quoted = Array.from(inner.matchAll(/"([^"]+)"/g))
    .map((entry) => entry[1]?.trim() ?? "")
    .filter(Boolean);

  if (quoted.length > 0) return quoted;

  return inner
    .split(/\bor\b/i)
    .map((part) => part.replace(/[()]/g, " ").trim())
    .filter(Boolean);
}

function normalizeKeywordForApify(keyword: string): string {
  const phrases = extractIndeedTitlePhrases(keyword);
  if (phrases.length > 0) {
    // Apify actor expects plain keyword text; send the primary phrase.
    return phrases[0] ?? keyword;
  }
  return keyword;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asTimestampOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toEmploymentType(jobTypes: unknown, employerAttributes: Record<string, unknown>): string | null {
  if (jobTypes && typeof jobTypes === "object" && !Array.isArray(jobTypes)) {
    const values = Object.values(jobTypes as Record<string, unknown>).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    if (values.length > 0) return values[0] ?? null;
  }
  const employerValues = Object.values(employerAttributes).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return employerValues[0] ?? null;
}

function toSalaryDisplay(baseSalary: Record<string, unknown>): string | null {
  const min = asNumber(baseSalary.min);
  const max = asNumber(baseSalary.max);
  const unit = typeof baseSalary.unitOfWork === "string" ? baseSalary.unitOfWork : "";
  const currency = typeof baseSalary.currencyCode === "string" ? baseSalary.currencyCode : "";

  if (min == null && max == null) return null;
  const bounds = min != null && max != null
    ? `${min} - ${max}`
    : `${min ?? max}`;
  const suffix = [currency, unit].filter(Boolean).join("/");
  return suffix ? `${bounds} ${suffix}` : bounds;
}

function toIndeedTitleText(item: Record<string, unknown>): string {
  if (typeof item.title === "string") return item.title;
  const titleObj = asRecord(item.title);
  const nested = titleObj.text;
  return typeof nested === "string" ? nested : "";
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
      job_type = "",
      remote = "",
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

    const fromDays = FROM_DAYS_MAP[normalizedDatePosted] ?? FROM_DAYS_MAP[date_posted];
    const normalizedJobType = String(job_type).trim().toLowerCase();
    const normalizedRemote = String(remote).trim().toLowerCase();

    const apifyKeyword = normalizeKeywordForApify((keyword as string).trim());
    const apifyInput: Record<string, unknown> = {
      title: apifyKeyword,
      location: (location as string).trim(),
      country: "us",
      limit: effectiveMax,
    };
    if (fromDays) apifyInput.datePosted = fromDays;
    if (normalizedJobType) apifyInput.jobType = normalizedJobType;
    if (normalizedRemote) apifyInput.remote = normalizedRemote;

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
        const locationObj = asRecord(j.location);
        const employer = asRecord(j.employer);
        const parentEmployer = asRecord(j.parentEmployer);
        const baseSalary = asRecord(j.baseSalary);
        const description = asRecord(j.description);
        const benefits = asRecord(j.benefits);
        const attributes = asRecord(j.attributes);
        const occupations = asRecord(j.occupations);
        const employerAttributes = asRecord(j.employerAttributes);

        const locationCity = typeof locationObj.city === "string" ? locationObj.city : null;
        const locationState = typeof locationObj.admin1Code === "string" ? locationObj.admin1Code : null;
        const locationDisplay = [locationCity, locationState].filter(Boolean).join(", ");
        const titleText = toIndeedTitleText(j) || null;
        const isRemote = locationDisplay.toLowerCase().includes("remote") ||
          Object.values(attributes).some((v) => typeof v === "string" && v.toLowerCase().includes("remote"));
        const salaryMin = asNumber(baseSalary.min);
        const salaryMax = asNumber(baseSalary.max);
        const salaryUnit = typeof baseSalary.unitOfWork === "string" ? baseSalary.unitOfWork : null;
        const salaryCurrency = typeof baseSalary.currencyCode === "string" ? baseSalary.currencyCode : null;
        const salaryDisplay = toSalaryDisplay(baseSalary);

        return {
          search_id: searchRecord.id,
          indeed_key: (j.key as string) || (j.id as string) || null,
          ref_num: (j.refNum as string) || null,
          language: (j.language as string) || null,
          job_url: (j.url as string) || null,
          apply_url: (j.jobUrl as string) || null,
          job_title: titleText,
          company_name: (employer.name as string) || null,
          company_page_url: (employer.companyPageUrl as string) || null,
          company_logo_url: (employer.logoUrl as string) || null,
          location_city: locationCity,
          location_state: locationState,
          location_display: locationDisplay || null,
          location_country: (locationObj.countryName as string) || null,
          location_country_code: (locationObj.countryCode as string) || null,
          location_admin1_code: (locationObj.admin1Code as string) || null,
          location_postal_code: (locationObj.postalCode as string) || null,
          location_latitude: asNumber(locationObj.latitude),
          location_longitude: asNumber(locationObj.longitude),
          salary_display: salaryDisplay,
          salary_min: salaryMin,
          salary_max: salaryMax,
          salary_unit: salaryUnit,
          salary_currency: salaryCurrency,
          employment_type: toEmploymentType(j.jobTypes, employerAttributes),
          is_remote: isRemote,
          is_urgent: Boolean(j.isUrgentHire),
          is_repost: asBooleanOrNull(j.isRepost),
          is_latest_post: asBooleanOrNull(j.isLatestPost),
          is_placement: asBooleanOrNull(j.isPlacement),
          is_high_volume_hiring: asBooleanOrNull(j.isHighVolumeHiring),
          is_expired: asBooleanOrNull(j.expired),
          date_published: asTimestampOrNull(j.datePublished) || asTimestampOrNull(j.dateOnIndeed),
          date_on_indeed: asTimestampOrNull(j.dateOnIndeed),
          expiration_date: asTimestampOrNull(j.expirationDate),
          job_description: (description.html as string) || (description.text as string) || null,
          benefits,
          attributes,
          occupations,
          employer_payload: employer,
          parent_employer_payload: parentEmployer,
          raw_payload: j,
        };
      });

      const { data: inserted, error: insertErr } = await supabase.from("indeed_jobs").insert(rows).select("id");
      if (insertErr) {
        await supabase.from("indeed_job_searches").update({ status: "failed" }).eq("id", searchRecord.id);
        if (queueEntry) await supabase.from("scrape_queue").update({ status: "failed", error_message: insertErr.message, completed_at: new Date().toISOString() }).eq("id", queueEntry.id);
        throw new Error(`Failed to save jobs: ${insertErr.message}`);
      }

      if (inserted && inserted.length > 0) {
        const embeddingPayload = inserted.map((r: { id: string }) => ({ type: "job", id: r.id, table: "indeed_jobs" }));
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
