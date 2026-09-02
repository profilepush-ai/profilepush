import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getBearerToken(request: Request): string {
  const header = request.headers.get("Authorization") ?? "";
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? (token ?? "").trim() : "";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const EMAIL_IN_TEXT_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const MIN_JOB_CONTENT_LENGTH = 80;
const MIN_AI_CONFIDENCE = 0.8;

type HotlistExtraction = {
  source: Record<string, unknown>;
  classificationConfidence: number;
  result: Record<string, unknown>;
};

function extractEmail(explicitValue: unknown, content: string): string {
  const explicit = asString(explicitValue).trim().toLowerCase();
  if (EMAIL_PATTERN.test(explicit)) return explicit;
  return content.match(EMAIL_IN_TEXT_PATTERN)?.[0]?.toLowerCase() ?? "";
}

function asIsoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.seconds === "number") return new Date(obj.seconds * 1000).toISOString();
    if (obj.$date) return new Date(String(obj.$date)).toISOString();
  }
  return null;
}

function normalizeSocialJobItems(items: Array<Record<string, unknown>>) {
  const rows: Array<Record<string, unknown>> = [];
  const errors: string[] = [];

  for (const item of items) {
    const postId = asString(item.post_id ?? item.external_id ?? item.id ?? item.postId).trim();
    const platform = asString(item.platform ?? item.source ?? item.provider).trim().toLowerCase();
    const postContent = asString(item.post_content ?? item.body ?? item.description ?? item.content).trim();
    const posterEmail = extractEmail(item.poster_email ?? item.email ?? item.posterEmail, postContent);
    const sourceKeywordId = asString(item.source_keyword_id ?? item.sourceKeywordId).trim();

    if (!postId || !platform || !postContent) {
      errors.push("Each item requires: post_id, platform, post_content");
      continue;
    }
    if (postContent.length < MIN_JOB_CONTENT_LENGTH) {
      errors.push(`${platform}:${postId} rejected: job content is too short`);
      continue;
    }

    rows.push({
      post_id: postId,
      platform,
      group_id: asString(item.group_id ?? item.groupId ?? item.source_group_id ?? item.sourceGroupId ?? item.group ?? item.community_id).trim(),
      post_content: postContent,
      posted_by_name: asString(item.posted_by_name ?? item.poster_name ?? item.recruiter_name),
      posted_at: asIsoOrNull(item.posted_at ?? item.created_at ?? item.timestamp),
      profile_link: asString(item.profile_link ?? item.profileUrl ?? item.profile_url),
      avatar_url: asString(item.avatar_url ?? item.avatarUrl),
      poster_email: posterEmail,
      poster_phone: asString(item.poster_phone ?? item.phone ?? item.posterPhone),
      post_url: asString(item.post_url ?? item.url ?? item.postUrl),
      job_title: asString(item.job_title ?? item.title ?? item.role),
      company_name: asString(item.company_name ?? item.company ?? item.companyName),
      location: asString(item.location ?? item.work_location ?? item.workLocation),
      employment_type: asString(item.employment_type ?? item.employmentType),
      seniority_level: asString(item.seniority_level ?? item.seniorityLevel),
      job_description: asString(item.job_description ?? item.description ?? item.body ?? item.post_content),
      salary_range: asString(item.salary_range ?? item.salaryRange),
      image_urls: asStringArray(item.image_urls ?? item.imageUrls),
      account_id: item.account_id ? String(item.account_id) : null,
      _source_keyword_id: UUID_PATTERN.test(sourceKeywordId) ? sourceKeywordId : null,
    });
  }

  return { rows, errors };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => asString(item).trim()).filter(Boolean)
    : [];
}

function asBoolean(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

function isExplicitDemandSideJobPost(content: string): boolean {
  const text = content.toLowerCase().replace(/\s+/g, " ");
  const supplySignals = [
    /\b(?:we|i) (?:have|represent|market) (?:available )?(?:candidates|consultants|resources)\b/,
    /\b(?:our|my) (?:bench|hotlist)\b/,
    /\b(?:updated|latest) hotlist\b/,
    /\b(?:bench|available) (?:candidates|consultants|resources)\b/,
    /\bplease share (?:your )?(?:open |client )?requirements\b/,
    /\bopen to (?:new )?(?:c2c |contract )?(?:opportunities|projects)\b/,
  ];
  if (supplySignals.some((pattern) => pattern.test(text))) return false;

  const applicationCtas = [
    /\b(?:please |kindly )?(?:send|share|submit) (?:your )?(?:updated |latest )?resumes?\b/,
    /\binterested candidates?\b/,
    /\bapply (?:now|today|before|at|via|here)\b/,
    /\bresume submission\b/,
    /\bwe want to hear from you\b/,
    /\bwe(?:'re| are) looking for\b/,
  ];
  if (applicationCtas.some((pattern) => pattern.test(text))) return true;

  const demandSignals = [
    /\bwe(?:'re| are) hiring\b/,
    /\bwe are looking for\b/,
    /\blooking for an? experienced\b/,
    /\burgent (?:hiring|requirement|opening)\b/,
    /\bjob requirements?\b/,
    /\bjob title\s*:/,
    /\bjd\s*:/,
    /\bjoin our (?:growing )?team\b/,
    /\binterview(?:ing)? immediately\b/,
    /\binterview process\b/,
    /\brequired (?:experience|skills|qualifications)\b/,
    /\bideal candidate\b/,
    /\bhiring manager interview\b/,
  ];
  return demandSignals.filter((pattern) => pattern.test(text)).length >= 2;
}

async function classifySocialJobs(
  workerUrl: string,
  workerToken: string,
  rows: Array<Record<string, unknown>>,
): Promise<{ accepted: Array<Record<string, unknown>>; hotlists: HotlistExtraction[]; rejected: string[]; error?: string }> {
  if (!workerUrl) return { accepted: [], hotlists: [], rejected: [], error: "CLOUDFLARE_WORKER_URL is not set" };
  if (rows.length === 0) return { accepted: [], hotlists: [], rejected: [] };

  const jobs = rows.map((row) => ({
    id: `${asString(row.platform)}:${asString(row.post_id)}`,
    title: asString(row.job_title),
    description: asString(row.post_content),
    location: asString(row.location),
    image_urls: asStringArray(row.image_urls),
  }));

  try {
    const callParser = async (route: string, routeJobs: typeof jobs) => {
      const response = await fetch(`${workerUrl.replace(/\/$/, "")}/${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(workerToken ? { "Authorization": `Bearer ${workerToken}` } : {}),
        },
        body: JSON.stringify({ jobs: routeJobs }),
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`${route} HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
      }
      return Array.isArray(payload?.results) ? payload.results as Array<Record<string, unknown>> : [];
    };

    const classifications = await callParser("classify", jobs);
    const classificationById = new Map(classifications.map((result) => [asString(result.job_id ?? result.post_id), result]));
    const jobInputs: typeof jobs = [];
    const hotlistInputs: typeof jobs = [];
    const classificationConfidenceById = new Map<string, number>();
    const rejected: string[] = [];

    for (const job of jobs) {
      const classification = classificationById.get(job.id);
      const confidence = Number(classification?.confidence ?? 0);
      const postType = asString(classification?.post_type).trim().toLowerCase();
      classificationConfidenceById.set(job.id, confidence);
      if (confidence < MIN_AI_CONFIDENCE || (postType !== "job" && postType !== "hotlist")) {
        rejected.push(`${job.id} rejected: ${asString(classification?.reason).trim() || "not a job or hotlist"}`);
      } else if (postType === "hotlist") {
        hotlistInputs.push(job);
      } else {
        jobInputs.push(job);
      }
    }

    const [jobResults, hotlistResults] = await Promise.all([
      jobInputs.length > 0 ? callParser("extract-job", jobInputs) : Promise.resolve([]),
      hotlistInputs.length > 0 ? callParser("extract-hotlist", hotlistInputs) : Promise.resolve([]),
    ]);
    const resultById = new Map(jobResults.map((result) => [asString(result.job_id), result]));
    const hotlistResultById = new Map(hotlistResults.map((result) => [asString(result.job_id ?? result.post_id), result]));
    const sourceById = new Map(rows.map((row) => [`${asString(row.platform)}:${asString(row.post_id)}`, row]));
    const accepted: Array<Record<string, unknown>> = [];
    const hotlists: HotlistExtraction[] = [];

    for (const job of jobInputs) {
      const row = sourceById.get(job.id)!;
      if (!asString(row.poster_email).trim()) {
        rejected.push(`${job.id} rejected: valid poster email is required`);
        continue;
      }
      const result = resultById.get(job.id);
      const confidence = Number(result?.confidence ?? 0);
      const roleTitle = asString(result?.role_title).trim();
      const locations = asStringArray(result?.locations);
      const coreSkills = asStringArray(result?.core_skills);
      const hasJobDetails = Boolean(
        roleTitle
        && (locations.length > 0
          || coreSkills.length > 0
          || asString(result?.employment_type).trim()
          || asString(result?.work_type).trim()),
      );

      if (!result || !asBoolean(result.is_job_posting) || confidence < MIN_AI_CONFIDENCE || !hasJobDetails) {
        const reason = asString(result?.rejection_reason).trim()
          || (!result ? "extractor returned no result" : "AI confidence or job details below threshold");
        rejected.push(`${job.id} rejected: ${reason}`);
        continue;
      }

      accepted.push({
        ...row,
        job_title: roleTitle,
        company_name: asString(result.company_name).trim() || row.company_name,
        location: locations.join(", ") || row.location,
        employment_type: asString(result.employment_type).trim() || row.employment_type,
      });
    }

    for (const job of hotlistInputs) {
      if (isExplicitDemandSideJobPost(job.description)) {
        rejected.push(`${job.id} rejected: deterministic demand-side job signals`);
        continue;
      }
      const result = hotlistResultById.get(job.id);
      const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
      if (!result || !asBoolean(result.is_hotlist) || Number(result.confidence ?? 0) < MIN_AI_CONFIDENCE || candidates.length === 0) {
        rejected.push(`${job.id} rejected: ${asString(result?.rejection_reason).trim() || "hotlist extractor did not confirm available consultants"}`);
        continue;
      }
      hotlists.push({
        source: sourceById.get(job.id)!,
        classificationConfidence: classificationConfidenceById.get(job.id) ?? 0,
        result,
      });
    }

    return { accepted, hotlists, rejected };
  } catch (error) {
    return { accepted: [], hotlists: [], rejected: [], error: `Cloudflare parser failed: ${(error as Error).message}` };
  }
}

async function persistSocialHotlists(
  supabase: ReturnType<typeof createClient>,
  extractions: HotlistExtraction[],
): Promise<number> {
  const sourceCandidateCounts: Array<{ platform: string; sourcePostId: string; candidateCount: number }> = [];
  const hotlistRows = extractions.flatMap(({ source, classificationConfidence, result }) => {
    const candidates = Array.isArray(result.candidates) ? result.candidates as Array<Record<string, unknown>> : [];
    const validCandidates = candidates.filter((candidate) => asString(candidate.role_title).trim());
    const platform = asString(source.platform);
    const sourcePostId = asString(source.post_id);
    const consultantCount = validCandidates.length;
    const recruiterDetails = {
      bench_sales_recruiter_name: asString(result.bench_sales_recruiter_name).trim() || asString(source.posted_by_name),
      bench_sales_recruiter_email: asString(result.bench_sales_recruiter_email).trim().toLowerCase() || asString(source.poster_email),
      bench_sales_recruiter_phone: asString(result.bench_sales_recruiter_phone).trim() || asString(source.poster_phone),
      bench_sales_company_name: asString(result.bench_sales_company_name).trim(),
      recruiter_profile_link: asString(source.profile_link),
      bench_sales_recruiter_avatar_url: asString(source.avatar_url),
    };
    sourceCandidateCounts.push({ platform, sourcePostId, candidateCount: consultantCount });
    const sourceImageUrls = asStringArray(result.source_image_urls);

    return validCandidates.map((candidate, candidateIndex) => {
      const roleTitle = asString(candidate.role_title).trim();
      const numericValue = (value: unknown) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
      return {
        source_post_id: sourcePostId,
        candidate_index: candidateIndex,
        consultant_count: consultantCount,
        post_scope: consultantCount === 1 ? "single" : "multiple",
        platform,
        group_id: asString(source.group_id),
        posted_at: source.posted_at ?? null,
        post_url: asString(source.post_url),
        raw_post_content: asString(source.post_content),
        source_image_urls: sourceImageUrls,
        ...recruiterDetails,
        candidate_name: asString(candidate.candidate_name),
        role_title: roleTitle,
        core_skills: asStringArray(candidate.core_skills),
        years_experience: numericValue(candidate.years_experience),
        visa_type: asString(candidate.visa_type),
        employment_type: asString(candidate.employment_type),
        work_type: asString(candidate.work_type),
        locations: asStringArray(candidate.locations),
        hourly_rate_min: numericValue(candidate.hourly_rate_min),
        hourly_rate_max: numericValue(candidate.hourly_rate_max),
        availability: asString(candidate.availability),
        candidate_summary: asString(candidate.candidate_summary),
        classification_confidence: classificationConfidence,
      };
    });
  });
  if (hotlistRows.length === 0) return 0;

  const { data, error } = await supabase
    .from("social_hotlist")
    .upsert(hotlistRows, { onConflict: "platform,source_post_id,candidate_index", ignoreDuplicates: false })
    .select("id, candidate_index, role_title, core_skills, years_experience, visa_type, employment_type, work_type, locations, hourly_rate_min, hourly_rate_max, consultant_count, post_scope");
  if (error) throw new Error(`social_hotlist upsert failed: ${error.message}`);

  for (const source of sourceCandidateCounts) {
    const { error: staleRowsError } = await supabase
      .from("social_hotlist")
      .delete()
      .eq("platform", source.platform)
      .eq("source_post_id", source.sourcePostId)
      .gte("candidate_index", source.candidateCount);
    if (staleRowsError) throw new Error(`stale social_hotlist cleanup failed: ${staleRowsError.message}`);
  }

  const radarRows = (data ?? []).map((row) => {
    const visaTypes = row.visa_type ? [row.visa_type] : [];
    const rate = row.hourly_rate_min != null || row.hourly_rate_max != null
      ? `$${row.hourly_rate_min ?? "?"}-$${row.hourly_rate_max ?? "?"}/hr`
      : "Not specified";
    const extractedFields = {
      role_title: row.role_title,
      core_skills: row.core_skills,
      years_experience: row.years_experience,
      visa_types: visaTypes,
      employment_type: row.employment_type,
      work_type: row.work_type,
      locations: row.locations,
      hourly_rate_min: row.hourly_rate_min,
      hourly_rate_max: row.hourly_rate_max,
      consultant_count: row.consultant_count,
      post_scope: row.post_scope,
    };
    return {
      hotlist_id: row.id,
      role_title: row.role_title,
      core_skills: row.core_skills,
      years_experience: row.years_experience,
      visa_types: visaTypes,
      employment_type: row.employment_type,
      work_type: row.work_type,
      locations: row.locations,
      hourly_rate_min: row.hourly_rate_min,
      hourly_rate_max: row.hourly_rate_max,
      extracted_fields: extractedFields,
      score_breakdown: {
        hotlist_source: {
          consultant_count: row.consultant_count,
          post_scope: row.post_scope,
          candidate_index: row.candidate_index,
        },
        role_match: { score: 0, candidate_value: "", job_value: row.role_title, rule: "Available consultant role" },
        skills_match: { score: 0, candidate_value: "", job_value: row.core_skills.join(", ") || "Not specified", rule: "Consultant skills" },
        experience_match: { score: 0, candidate_value: "", job_value: row.years_experience != null ? `${row.years_experience}+ years` : "Not specified", rule: "Consultant experience" },
        visa_match: { score: 0, candidate_value: "", job_value: visaTypes.join(", ") || "Not specified", rule: "Consultant visa" },
        work_type_match: { score: 0, candidate_value: "", job_value: row.work_type || "Not specified", rule: "Preferred work arrangement" },
        employment_type_match: { score: 0, candidate_value: "", job_value: row.employment_type || "Not specified", rule: "Engagement type" },
        location_match: { score: 0, candidate_value: "", job_value: row.locations.join(", ") || "Not specified", rule: "Consultant location" },
        rate_match: { score: 0, candidate_value: "", job_value: rate, rule: "Consultant rate" },
      },
    };
  });
  const { error: radarError } = await supabase
    .from("radar_match_hotlist")
    .upsert(radarRows, { onConflict: "hotlist_id", ignoreDuplicates: false });
  if (radarError) throw new Error(`radar_match_hotlist upsert failed: ${radarError.message}`);
  return data?.length ?? 0;
}

async function logSocialJobPayload(insertLog: (payload: Record<string, unknown>) => Promise<unknown>, payload: Record<string, unknown>, normalizedRows: Array<Record<string, unknown>>, errors: string[], insertedCount: number, status: string) {
  try {
    await insertLog({
      function_name: "receive-social-job",
      source: payload?.source ?? null,
      payload,
      normalized_rows: normalizedRows,
      errors,
      inserted_count: insertedCount,
      status,
    });
  } catch (error) {
    console.error("social_job_payload_logs insert failed:", error);
  }
}

type QueueExtractionJob = {
  job_id: string;
  post_id: string;
  platform: string;
  title: string;
  description: string;
  location: string;
};

async function enqueueExtractionJobs(
  producerUrl: string,
  producerToken: string,
  jobs: QueueExtractionJob[],
): Promise<{ accepted: number; error?: string }> {
  if (!producerUrl) return { accepted: 0, error: "CLOUDFLARE_QUEUE_PRODUCER_URL is not set" };
  if (jobs.length === 0) return { accepted: 0 };

  try {
    const response = await fetch(producerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(producerToken ? { "Authorization": `Bearer ${producerToken}` } : {}),
      },
      body: JSON.stringify({ jobs }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        accepted: 0,
        error: `queue producer HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`,
      };
    }

    const accepted = typeof payload?.accepted === "number" ? payload.accepted : jobs.length;
    return { accepted };
  } catch (error) {
    return { accepted: 0, error: `queue producer request failed: ${(error as Error).message}` };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const expectedToken = Deno.env.get("SOCIAL_WEBHOOK_SECRET") ?? "";
  if (!expectedToken || getBearerToken(req) !== expectedToken) {
    return respond({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await req.json();
    const items: Array<Record<string, unknown>> = Array.isArray(body) ? body : [body];
    if (items.length === 0) return respond({ error: "Empty payload" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const CLOUDFLARE_QUEUE_PRODUCER_URL = (Deno.env.get("CLOUDFLARE_QUEUE_PRODUCER_URL") ?? "").trim();
    const CLOUDFLARE_QUEUE_PRODUCER_TOKEN = (Deno.env.get("CLOUDFLARE_QUEUE_PRODUCER_TOKEN") ?? "").trim();
    const CLOUDFLARE_WORKER_URL = (Deno.env.get("CLOUDFLARE_WORKER_URL") ?? "").trim();
    const CLOUDFLARE_WORKER_TOKEN = (Deno.env.get("CLOUDFLARE_WORKER_TOKEN") ?? "").trim();
    const { rows, errors } = normalizeSocialJobItems(items);

    const sourcePostIds = [...new Set(rows.map((row) => asString(row.post_id)).filter(Boolean))];
    const [existingJobsResult, existingHotlistsResult] = sourcePostIds.length > 0
      ? await Promise.all([
        supabase
          .from("social_jobs")
          .select("post_id,platform,extracted_at")
          .in("post_id", sourcePostIds),
        supabase
          .from("social_hotlist")
          .select("source_post_id,platform")
          .in("source_post_id", sourcePostIds),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (existingJobsResult.error) return respond({ error: existingJobsResult.error.message }, 500);
    if (existingHotlistsResult.error) return respond({ error: existingHotlistsResult.error.message }, 500);

    const completedSourceKeys = new Set<string>([
      ...(existingJobsResult.data ?? [])
        .filter((row) => Boolean(row.extracted_at))
        .map((row) => `${asString(row.platform)}:${asString(row.post_id)}`),
      ...(existingHotlistsResult.data ?? [])
        .map((row) => `${asString(row.platform)}:${asString(row.source_post_id)}`),
    ]);
    const duplicateRows = rows.filter((row) => completedSourceKeys.has(`${asString(row.platform)}:${asString(row.post_id)}`));
    const rowsToClassify = rows.filter((row) => !completedSourceKeys.has(`${asString(row.platform)}:${asString(row.post_id)}`));
    const duplicateSkips = duplicateRows.map((row) => (
      `${asString(row.platform)}:${asString(row.post_id)} skipped: source post already processed`
    ));

    const classification = await classifySocialJobs(
      CLOUDFLARE_WORKER_URL,
      CLOUDFLARE_WORKER_TOKEN,
      rowsToClassify,
    );
    if (classification.error) {
      await logSocialJobPayload(
        async (payload) => supabase.from("social_job_payload_logs").insert(payload),
        body,
        rowsToClassify,
        [...errors, ...duplicateSkips, classification.error],
        0,
        "classifier_error",
      );
      return respond({ error: classification.error }, 502);
    }

    const normalizedRows = classification.accepted;
    const hotlistCandidateCount = await persistSocialHotlists(supabase, classification.hotlists);
    const acceptedPostIds = [...new Set(normalizedRows.map((row) => asString(row.post_id)).filter(Boolean))];
    const { data: existingJobs, error: existingJobsError } = acceptedPostIds.length > 0
      ? await supabase
        .from("social_jobs")
        .select("post_id,platform,group_id")
        .in("post_id", acceptedPostIds)
      : { data: [], error: null };
    if (existingJobsError) return respond({ error: existingJobsError.message }, 500);
    const existingGroupBySourceKey = new Map((existingJobs ?? []).map((row) => (
      [`${row.platform}:${row.post_id}`, asString(row.group_id)]
    )));
    const rowsForUpsert = normalizedRows.map((row) => {
      const { _source_keyword_id: _sourceKeywordId, ...databaseRow } = row;
      const sourceKey = `${asString(row.platform)}:${asString(row.post_id)}`;
      return {
        ...databaseRow,
        group_id: asString(databaseRow.group_id) || existingGroupBySourceKey.get(sourceKey) || "",
      };
    });
    const rejectionErrors = [...errors, ...duplicateSkips, ...classification.rejected];

    await logSocialJobPayload(
      async (payload) => supabase.from("social_job_payload_logs").insert(payload),
      body,
      normalizedRows,
      rejectionErrors,
      normalizedRows.length,
        normalizedRows.length > 0 || hotlistCandidateCount > 0 ? "accepted" : "rejected",
    );

    if (normalizedRows.length === 0) {
      return respond({
        success: true,
        inserted: 0,
        hotlist_candidates_inserted: hotlistCandidateCount,
        ids: [],
        enqueued_count: 0,
        duplicates_skipped: duplicateRows.length,
        skipped: rejectionErrors,
      });
    }

    const { data, error } = await supabase
      .from("social_jobs")
      .upsert(rowsForUpsert, { onConflict: "post_id,platform", ignoreDuplicates: false })
      .select("id, post_id, platform");

    if (error) return respond({ error: error.message }, 500);
    if (!data || data.length === 0) return respond({ success: true, inserted: 0, ids: [], errors });

    const insertedIds = data.map((r: { id: string }) => r.id);
    const jobBySourceKey = new Map(data.map((row: { id: string; post_id: string; platform: string }) => (
      [`${row.platform}:${row.post_id}`, row.id]
    )));
    const keywordLinks = normalizedRows.flatMap((row) => {
      const keywordId = asString(row._source_keyword_id);
      const jobId = jobBySourceKey.get(`${asString(row.platform)}:${asString(row.post_id)}`);
      return keywordId && jobId ? [{ keyword_id: keywordId, social_job_id: jobId }] : [];
    });
    if (keywordLinks.length > 0) {
      const { error: keywordLinkError } = await supabase
        .from("linkedin_keyword_social_jobs")
        .upsert(keywordLinks, { onConflict: "keyword_id,social_job_id", ignoreDuplicates: true });
      if (keywordLinkError) return respond({ error: keywordLinkError.message }, 500);
    }

    // Enqueue parsing jobs for async Cloudflare Queue processing.
    const jobsForQueue: QueueExtractionJob[] = data.map((r: { id: string; post_id: string; platform: string }) => ({
      job_id: r.id,
      post_id: r.post_id,
      platform: r.platform,
      title: asString(normalizedRows.find((row) => row.post_id === r.post_id && row.platform === r.platform)?.["job_title"]),
      description: asString(normalizedRows.find((row) => row.post_id === r.post_id && row.platform === r.platform)?.["job_description"]),
      location: asString(normalizedRows.find((row) => row.post_id === r.post_id && row.platform === r.platform)?.["location"]),
    }));

    const queueResult = await enqueueExtractionJobs(
      CLOUDFLARE_QUEUE_PRODUCER_URL,
      CLOUDFLARE_QUEUE_PRODUCER_TOKEN,
      jobsForQueue,
    );

    // Fire embedding generation in the background — non-critical.
    const embeddingPromise = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-embedding`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
      body: JSON.stringify(insertedIds.map((id: string) => ({ type: "job", id, table: "social_jobs" }))),
    }).catch((err) => console.error("embedding error:", err));

    (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(embeddingPromise);

    return respond({
      success: true,
      inserted: data.length,
      hotlist_candidates_inserted: hotlistCandidateCount,
      ids: insertedIds,
      enqueued_count: queueResult.accepted,
      duplicates_skipped: duplicateRows.length,
      enqueue_error: queueResult.error ?? null,
      skipped: rejectionErrors,
    });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});
