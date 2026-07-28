import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Receives Apify webhook callbacks for scheduled job scrapes and stores
 * results directly into the job board tables — no user interaction needed.
 *
 * Apify scheduler webhook URL format (one URL per board/task):
 *   https://<project>.supabase.co/functions/v1/receive-apify-webhook?board=dice&secret=WEBHOOK_SECRET
 *
 * Supported boards: dice | indeed | linkedin | monster | careerbuilder
 *
 * Apify must be configured with eventTypes: ACTOR.RUN.SUCCEEDED
 * The function fetches the actor run input to determine keyword/location,
 * then maps the dataset items to the correct table schema.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN") ?? "";

// ── Item mappers ─────────────────────────────────────────────────────────────

function asIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function mapDiceItem(j: Record<string, unknown>, searchId: string) {
  return {
    search_id: searchId,
    dice_id: (j.guid as string) ?? (j.dice_id as string) ?? null,
    job_url: (j.url as string) ?? (j.detailsPageUrl as string) ?? null,
    job_title: (j.title as string) ?? null,
    company_name: (j.company as string) ?? (j.companyName as string) ?? null,
    company_page_url: (j.companyPageUrl as string) ?? null,
    company_logo_url: (j.companyLogoUrl as string) ?? null,
    location: (j.location as string) ?? null,
    salary_range: (j.salary as string) ?? null,
    employment_type: (j.employmentType as string) ?? null,
    work_setting: (j.workSetting as string) ?? null,
    easy_apply: (j.easyApply as boolean) ?? false,
    willing_to_sponsor: (j.willingToSponsor as boolean) ?? false,
    summary: (j.summary as string) ?? null,
    posted: (j.posted as string) ?? (j.postedDate as string) ?? null,
    job_description: (j.description_text as string) ?? null,
    raw_payload: j,
  };
}

function mapIndeedItem(j: Record<string, unknown>, searchId: string) {
  const locationObj = (j.location && typeof j.location === "object" && !Array.isArray(j.location))
    ? j.location as Record<string, unknown>
    : {};
  const employer = (j.employer && typeof j.employer === "object" && !Array.isArray(j.employer))
    ? j.employer as Record<string, unknown>
    : {};
  const parentEmployer = (j.parentEmployer && typeof j.parentEmployer === "object" && !Array.isArray(j.parentEmployer))
    ? j.parentEmployer as Record<string, unknown>
    : {};
  const baseSalary = (j.baseSalary && typeof j.baseSalary === "object" && !Array.isArray(j.baseSalary))
    ? j.baseSalary as Record<string, unknown>
    : {};
  const description = (j.description && typeof j.description === "object" && !Array.isArray(j.description))
    ? j.description as Record<string, unknown>
    : {};
  const attributes = (j.attributes && typeof j.attributes === "object" && !Array.isArray(j.attributes))
    ? j.attributes as Record<string, unknown>
    : {};
  const benefits = (j.benefits && typeof j.benefits === "object" && !Array.isArray(j.benefits))
    ? j.benefits as Record<string, unknown>
    : {};
  const occupations = (j.occupations && typeof j.occupations === "object" && !Array.isArray(j.occupations))
    ? j.occupations as Record<string, unknown>
    : {};
  const employerAttributes = (j.employerAttributes && typeof j.employerAttributes === "object" && !Array.isArray(j.employerAttributes))
    ? j.employerAttributes as Record<string, unknown>
    : {};

  const title = typeof j.title === "string"
    ? j.title
    : ((j.title as Record<string, unknown> | undefined)?.text as string | undefined) ?? null;
  const city = (locationObj.city as string) || null;
  const state = (locationObj.admin1Code as string) || null;
  const locationDisplay = [city, state].filter(Boolean).join(", ") || null;

  const salaryMin = typeof baseSalary.min === "number" ? baseSalary.min : null;
  const salaryMax = typeof baseSalary.max === "number" ? baseSalary.max : null;
  const salaryUnit = (baseSalary.unitOfWork as string) || null;
  const salaryCurrency = (baseSalary.currencyCode as string) || null;
  const salaryDisplay = salaryMin != null || salaryMax != null
    ? `${salaryMin ?? salaryMax}${salaryMin != null && salaryMax != null ? ` - ${salaryMax}` : ""}${salaryCurrency ? ` ${salaryCurrency}` : ""}${salaryUnit ? `/${salaryUnit}` : ""}`
    : null;

  const employmentType = (() => {
    const types = j.jobTypes;
    if (types && typeof types === "object" && !Array.isArray(types)) {
      const values = Object.values(types as Record<string, unknown>).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      if (values.length > 0) return values[0];
    }
    const values = Object.values(employerAttributes).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    return values[0] ?? null;
  })();

  const hasRemoteAttribute = Object.values(attributes).some((value) =>
    typeof value === "string" && value.toLowerCase().includes("remote")
  );
  const isRemote = hasRemoteAttribute || (locationDisplay ?? "").toLowerCase().includes("remote");

  const datePublished = asIsoOrNull(j.datePublished);
  const dateOnIndeed = asIsoOrNull(j.dateOnIndeed);
  const expirationDate = asIsoOrNull(j.expirationDate);

  return {
    search_id: searchId,
    indeed_key: (j.key as string) || (j.id as string) || null,
    ref_num: (j.refNum as string) || null,
    language: (j.language as string) || null,
    job_url: (j.url as string) || null,
    apply_url: (j.jobUrl as string) || null,
    job_title: title,
    company_name: (employer.name as string) || null,
    company_page_url: (employer.companyPageUrl as string) || null,
    company_logo_url: (employer.logoUrl as string) || null,
    location_city: city,
    location_state: state,
    location_display: locationDisplay,
    location_country: (locationObj.countryName as string) || null,
    location_country_code: (locationObj.countryCode as string) || null,
    location_admin1_code: (locationObj.admin1Code as string) || null,
    location_postal_code: (locationObj.postalCode as string) || null,
    location_latitude: typeof locationObj.latitude === "number" ? locationObj.latitude : null,
    location_longitude: typeof locationObj.longitude === "number" ? locationObj.longitude : null,
    salary_display: salaryDisplay,
    salary_min: salaryMin,
    salary_max: salaryMax,
    salary_unit: salaryUnit,
    salary_currency: salaryCurrency,
    employment_type: employmentType,
    is_remote: isRemote,
    is_urgent: Boolean(j.isUrgentHire),
    is_repost: typeof j.isRepost === "boolean" ? j.isRepost : null,
    is_latest_post: typeof j.isLatestPost === "boolean" ? j.isLatestPost : null,
    is_placement: typeof j.isPlacement === "boolean" ? j.isPlacement : null,
    is_high_volume_hiring: typeof j.isHighVolumeHiring === "boolean" ? j.isHighVolumeHiring : null,
    is_expired: typeof j.expired === "boolean" ? j.expired : null,
    date_published: datePublished || dateOnIndeed,
    date_on_indeed: dateOnIndeed,
    expiration_date: expirationDate,
    job_description: (description.html as string) || (description.text as string) || null,
    benefits,
    attributes,
    occupations,
    employer_payload: employer,
    parent_employer_payload: parentEmployer,
    raw_payload: j,
  };
}

function mapLinkedInItem(j: Record<string, unknown>, searchId: string) {
  return {
    search_id: searchId,
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
  };
}

function mapMonsterItem(j: Record<string, unknown>, searchId: string) {
  const posting = (j.jobPosting as Record<string, unknown>) ?? {};
  const apply = (j.apply as Record<string, unknown>) ?? {};
  const org = (posting.hiringOrganization as Record<string, unknown>) ?? {};
  const baseSalary = (posting.baseSalary as Record<string, unknown>) ?? {};
  const salaryValue = (baseSalary.value as Record<string, unknown>) ?? {};
  const locations = Array.isArray(posting.jobLocation) ? posting.jobLocation as Record<string, unknown>[] : [];
  const firstLoc = (locations[0]?.address as Record<string, unknown>) ?? {};
  const city = (firstLoc.addressLocality as string) || null;
  const state = (firstLoc.addressRegion as string) || null;
  const empTypes = posting.employmentType as unknown[];
  const titleStr = (posting.title as string) ?? "";
  const isRemote = titleStr.toLowerCase().includes("remote") ||
    (city ?? "").toLowerCase().includes("remote") ||
    (state ?? "").toLowerCase().includes("remote");
  const empType = Array.isArray(empTypes) && empTypes.length > 0
    ? String(empTypes[0]).replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
    : null;

  return {
    search_id: searchId,
    monster_key: (j.jobId as string) ?? null,
    apply_url: (apply.applyUrl as string) || null,
    job_title: titleStr || null,
    company_name: (org.name as string) || null,
    company_logo_url: (org.logo as string) || null,
    location_city: city,
    location_state: state,
    location_display: city && state ? `${city}, ${state}` : city ?? state ?? null,
    salary_min: salaryValue.minValue != null ? Number(salaryValue.minValue) : null,
    salary_max: salaryValue.maxValue != null ? Number(salaryValue.maxValue) : null,
    salary_unit: (salaryValue.unitText as string) || null,
    salary_currency: (baseSalary.currency as string) || null,
    employment_type: empType,
    is_remote: isRemote,
    date_published: (posting.datePosted as string) ? new Date(posting.datePosted as string).toISOString() : null,
    date_recency: (j.dateRecency as string) || null,
    job_description: (posting.description as string) || null,
    raw_payload: j,
  };
}

function mapCareerBuilderItem(j: Record<string, unknown>, searchId: string) {
  const city = (j.addressLocality as string) || null;
  const state = (j.addressRegion as string) || null;
  const locationDisplay = city && state ? `${city}, ${state}` : (j.location as string) || null;

  return {
    search_id: searchId,
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
    skills: Array.isArray(j.skills) ? j.skills : [],
    benefits_list: Array.isArray(j.benefits) ? j.benefits : [],
    occupational_category: (j.occupationalCategory as string) || null,
    raw_payload: j,
  };
}

// ── Board config ─────────────────────────────────────────────────────────────

type Board = "dice" | "indeed" | "linkedin" | "monster" | "careerbuilder";

const BOARD_TABLES: Record<Board, { searchTable: string; jobsTable: string }> = {
  dice:          { searchTable: "dice_job_searches",          jobsTable: "dice_jobs" },
  indeed:        { searchTable: "indeed_job_searches",        jobsTable: "indeed_jobs" },
  linkedin:      { searchTable: "linkedin_job_searches",      jobsTable: "linkedin_jobs" },
  monster:       { searchTable: "monster_job_searches",       jobsTable: "monster_jobs" },
  careerbuilder: { searchTable: "careerbuilder_job_searches", jobsTable: "careerbuilder_jobs" },
};

function extractSearchParams(board: Board, input: Record<string, unknown>): Record<string, unknown> {
  switch (board) {
    case "dice":
      return {
        keyword: String(input.keyword ?? "").trim().toLowerCase(),
        location: String(input.location ?? "").trim().toLowerCase(),
        posted_date: String(input.posted_date ?? "24h"),
      };
    case "indeed":
      return {
        keyword: String(input.title ?? input.keyword ?? input.position ?? "").trim().toLowerCase(),
        location: String(input.location ?? "").trim().toLowerCase(),
        date_posted: String(input.datePosted ?? "Any time"),
      };
    case "linkedin":
      return {
        job_title: String(input.job_title ?? "").trim().toLowerCase(),
        location: String(input.location ?? "").trim().toLowerCase(),
        posted_within: String(input.posted_within ?? "Any Time"),
        experience_level: String(input.experience_level ?? ""),
        employment_type: String(input.employment_type ?? ""),
        work_arrangement: String(input.work_arrangement ?? ""),
      };
    case "monster":
      return {
        keyword: String(input.query ?? input.keyword ?? "").trim().toLowerCase(),
        location: String(input.address ?? input.location ?? "").trim().toLowerCase(),
      };
    case "careerbuilder":
      return {
        keyword: String(input.keywords ?? input.keyword ?? "").trim().toLowerCase(),
        location: String(input.location ?? "").trim().toLowerCase(),
        date_posted: "Any time",
      };
  }
}

function mapItem(board: Board, j: Record<string, unknown>, searchId: string): Record<string, unknown> {
  switch (board) {
    case "dice":          return mapDiceItem(j, searchId);
    case "indeed":        return mapIndeedItem(j, searchId);
    case "linkedin":      return mapLinkedInItem(j, searchId);
    case "monster":       return mapMonsterItem(j, searchId);
    case "careerbuilder": return mapCareerBuilderItem(j, searchId);
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const board = url.searchParams.get("board") as Board | null;

  if (!board || !BOARD_TABLES[board]) {
    return new Response(JSON.stringify({ error: "Missing or invalid ?board= param. Use: dice|indeed|linkedin|monster|careerbuilder" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const webhook = await req.json() as {
      eventType?: string;
      resource?: {
        id?: string;
        status?: string;
        defaultDatasetId?: string;
        defaultKeyValueStoreId?: string;
        usageTotalUsd?: number;
        usage?: Record<string, number>;
        stats?: { computeUnits?: number };
      };
    };

    // Only process successful runs
    const resource = webhook.resource ?? {};
    if (resource.status !== "SUCCEEDED") {
      return new Response(JSON.stringify({ ok: true, skipped: true, status: resource.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const runId = resource.id ?? "";
    const datasetId = resource.defaultDatasetId ?? "";
    const kvStoreId = resource.defaultKeyValueStoreId ?? "";

    // Fetch actor run input to get keyword/location
    const inputRes = await fetch(
      `https://api.apify.com/v2/key-value-stores/${kvStoreId}/records/INPUT?token=${APIFY_TOKEN}`,
    );
    const runInput: Record<string, unknown> = inputRes.ok ? await inputRes.json() : {};
    const searchParams = extractSearchParams(board, runInput);

    // Create a search record (account_id = null = system/scheduled run)
    const { searchTable, jobsTable } = BOARD_TABLES[board];
    const { data: searchRecord, error: searchErr } = await supabase
      .from(searchTable)
      .insert({
        ...searchParams,
        account_id: null,
        status: "running",
        apify_run_id: runId,
      })
      .select()
      .single();

    if (searchErr || !searchRecord) {
      throw new Error(`Failed to create search record: ${searchErr?.message}`);
    }

    // Fetch all dataset items with pagination (Apify max 1000 per page)
    const items: Record<string, unknown>[] = [];
    const PAGE_SIZE = 1000;
    let offset = 0;
    while (true) {
      const pageRes = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=${PAGE_SIZE}&offset=${offset}&clean=true`,
      );
      if (!pageRes.ok) break;
      const page: Record<string, unknown>[] = await pageRes.json();
      if (!Array.isArray(page) || page.length === 0) break;
      items.push(...page);
      if (page.length < PAGE_SIZE) break; // last page
      offset += PAGE_SIZE;
    }

    if (items.length > 0) {
      const rows = items.map((j) => mapItem(board, j, searchRecord.id));
      // Batch insert in chunks of 500 to stay under Supabase payload limits
      const BATCH_SIZE = 500;
      const insertedIds: string[] = [];
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { data: inserted, error: insertErr } = await supabase.from(jobsTable).insert(batch).select('id');
        if (insertErr) {
          await supabase.from(searchTable).update({ status: "failed" }).eq("id", searchRecord.id);
          throw new Error(`Failed to save jobs (batch ${i / BATCH_SIZE + 1}): ${insertErr.message}`);
        }
        if (inserted) insertedIds.push(...inserted.map((r: { id: string }) => r.id));
      }

      // Generate embeddings for newly inserted jobs (fire-and-forget)
      if (insertedIds.length > 0) {
        const embeddingPayload = insertedIds.map(id => ({ type: "job", id, table: jobsTable }));
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

    const usage = resource.usage ?? {};
    const computeUnits: number = (usage.ACTOR_COMPUTE_UNITS ?? resource.stats?.computeUnits) || 0;
    const proxyGb: number = usage.PROXY_RESIDENTIAL_TRANSFER_GBYTES ?? 0;
    const breakdownCost = computeUnits * 0.25 + proxyGb * 8;
    const costUsd: number = breakdownCost > 0 ? breakdownCost : (resource.usageTotalUsd ?? 0);

    await supabase.from(searchTable).update({
      status: "completed",
      total_jobs: items.length,
      compute_units: computeUnits,
      cost_usd: costUsd,
      completed_at: new Date().toISOString(),
    }).eq("id", searchRecord.id);

    try {
      await supabase.from("api_usage_log").insert({
        account_id: null,
        function_name: `${board}-search`,
        provider: "apify-scheduled",
        model: board,
        compute_units: computeUnits,
        cost_usd: costUsd,
        total_tokens: 0,
        metadata: { search_id: searchRecord.id, total_jobs: items.length, scheduled: true },
      });
    } catch (logErr) { console.error("Usage log failed:", logErr); }

    return new Response(
      JSON.stringify({ ok: true, board, search_id: searchRecord.id, total_jobs: items.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("receive-apify-webhook error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
