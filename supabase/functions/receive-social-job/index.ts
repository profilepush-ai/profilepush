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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const EMAIL_IN_TEXT_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const MIN_JOB_CONTENT_LENGTH = 80;
const MIN_AI_CONFIDENCE = 0.8;

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
    if (!posterEmail) {
      errors.push(`${platform}:${postId} rejected: valid poster email is required`);
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

async function classifySocialJobs(
  workerUrl: string,
  workerToken: string,
  rows: Array<Record<string, unknown>>,
): Promise<{ accepted: Array<Record<string, unknown>>; rejected: string[]; error?: string }> {
  if (!workerUrl) return { accepted: [], rejected: [], error: "CLOUDFLARE_WORKER_URL is not set" };
  if (rows.length === 0) return { accepted: [], rejected: [] };

  const jobs = rows.map((row) => ({
    id: `${asString(row.platform)}:${asString(row.post_id)}`,
    title: asString(row.job_title),
    description: asString(row.post_content),
    location: asString(row.location),
  }));

  try {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerToken ? { "Authorization": `Bearer ${workerToken}` } : {}),
      },
      body: JSON.stringify({ jobs }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { accepted: [], rejected: [], error: `Cloudflare classifier HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 240)}` };
    }

    const results = Array.isArray(payload?.results)
      ? payload.results as Array<Record<string, unknown>>
      : [];
    const resultById = new Map(results.map((result) => [asString(result.job_id), result]));
    const accepted: Array<Record<string, unknown>> = [];
    const rejected: string[] = [];

    for (const row of rows) {
      const rowId = `${asString(row.platform)}:${asString(row.post_id)}`;
      const result = resultById.get(rowId);
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
          || (!result ? "classifier returned no result" : "AI confidence or job details below threshold");
        rejected.push(`${rowId} rejected: ${reason}`);
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

    return { accepted, rejected };
  } catch (error) {
    return { accepted: [], rejected: [], error: `Cloudflare classifier failed: ${(error as Error).message}` };
  }
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

    const classification = await classifySocialJobs(
      CLOUDFLARE_WORKER_URL,
      CLOUDFLARE_WORKER_TOKEN,
      rows,
    );
    if (classification.error) {
      await logSocialJobPayload(
        async (payload) => supabase.from("social_job_payload_logs").insert(payload),
        body,
        rows,
        [...errors, classification.error],
        0,
        "classifier_error",
      );
      return respond({ error: classification.error }, 502);
    }

    const normalizedRows = classification.accepted;
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
    const rejectionErrors = [...errors, ...classification.rejected];

    await logSocialJobPayload(
      async (payload) => supabase.from("social_job_payload_logs").insert(payload),
      body,
      normalizedRows,
      rejectionErrors,
      normalizedRows.length,
      normalizedRows.length > 0 ? "accepted" : "rejected",
    );

    if (normalizedRows.length === 0) {
      return respond({ success: true, inserted: 0, ids: [], enqueued_count: 0, skipped: rejectionErrors });
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
      ids: insertedIds,
      enqueued_count: queueResult.accepted,
      enqueue_error: queueResult.error ?? null,
      skipped: rejectionErrors,
    });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});
