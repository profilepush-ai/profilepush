export interface Env {
  AI: Ai;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  INBOUND_REPLY_TOKEN?: string;
  ASK_VENDOR_AI_TOKEN?: string;
  PARSER_WORKER_URL?: string;
  PARSER_WORKER_TOKEN?: string;
  PARSER_MODEL?: string;
}

type QueueMessageBody = {
  message_id?: string;
  enqueued_at?: string;
  job_id: string;
  post_id: string;
  platform: string;
  title: string;
  description: string;
  location: string;
};

type ParserResult = Record<string, unknown>;

type VendorReplyRequest = {
  job_id?: string;
  email_content?: string;
  subject?: string;
  from_email?: string;
};

type AskVendorEmailRequest = {
  job_title?: string;
  job_location?: string;
  vendor_name?: string;
  missing_data_type?: string;
  bench_recruiter_first_name?: string;
};

type AskVendorEmailCopy = {
  subject: string;
  email_content: string;
};

type RadarMatchRow = {
  profile_id: null;
  job_source: "social";
  job_id: string;
  final_average_score: number;
  score_breakdown: Record<string, unknown>;
  ai_notes: string;
  disqualified: boolean;
  disqualify_reason: null;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function buildPrompt(job: QueueMessageBody): string {
  const safeDescription = (job.description ?? "").slice(0, 1500);
  return `Classify this input as a genuine job posting and extract structured fields. Return ONLY valid JSON, no markdown.
Preserve job_id exactly as provided. If a field is unknown, use null (or [] for arrays).
Set is_job_posting=true only when the text advertises a specific open role with enough actionable details to apply. Reject resumes, candidate marketing, generic staffing promotions, discussions, event posts, news, and vague hiring claims.
Include: job_id, is_job_posting (boolean), confidence (0 to 1), rejection_reason (string or null), role_title, company_name, core_skills (array max 12), years_experience (number or null), visa_types (array), employment_type (C2C/W2/Full-time/Contract/Any), work_type (Remote/Hybrid/Onsite/Unknown), locations (array), hourly_rate_min (number or null), hourly_rate_max (number or null).

JOB:
id: ${job.job_id}
title: ${job.title}
location: ${job.location}
description: ${safeDescription}

Return ONLY valid JSON object:`;
}

function parseModelText(raw: unknown): unknown {
  if (typeof raw === "string") {
    const trimmed = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(trimmed);
  }
  return raw;
}

function normalizeAskVendorEmailCopy(raw: unknown): AskVendorEmailCopy {
  const parsed = parseModelText(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("AI response is not a JSON object");

  const source = parsed as Record<string, unknown>;
  const subject = String(source.subject ?? "").trim().replace(/^subject:\s*/i, "").slice(0, 200);
  const emailContent = String(source.email_content ?? "").trim().slice(0, 2_000);
  const wordCount = emailContent.split(/\s+/).filter(Boolean).length;
  if (!subject || !emailContent) throw new Error("AI response did not include subject and email content");
  if (wordCount >= 40) throw new Error("AI email content exceeded 40 words");
  if (/profilepush/i.test(`${subject}\n${emailContent}`)) throw new Error("AI email content included prohibited branding");

  return { subject, email_content: emailContent };
}

function getBearerToken(req: Request): string {
  const header = req.headers.get("Authorization") ?? "";
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? (token ?? "").trim() : "";
}

async function handleAskVendorEmailCopy(req: Request, env: Env): Promise<Response> {
  const expectedToken = (env.ASK_VENDOR_AI_TOKEN ?? "").trim();
  if (!expectedToken) return jsonResponse({ error: "Ask Vendor AI is not configured" }, 503);
  if (getBearerToken(req) !== expectedToken) return jsonResponse({ error: "Unauthorized" }, 401);

  const body = await req.json() as AskVendorEmailRequest;
  const jobTitle = String(body.job_title ?? "").trim().slice(0, 500);
  const jobLocation = String(body.job_location ?? "").trim().slice(0, 500) || "Not specified";
  const vendorName = String(body.vendor_name ?? "").trim().slice(0, 200) || "there";
  const missingDataType = String(body.missing_data_type ?? "").trim().slice(0, 1_000);
  const recruiterFirstName = String(body.bench_recruiter_first_name ?? "").trim().split(/\s+/)[0]?.slice(0, 100);
  if (!jobTitle || !missingDataType || !recruiterFirstName) {
    return jsonResponse({ error: "Job title, missing data type, and recruiter first name are required" }, 400);
  }

  const systemPrompt = `You are a fast-paced, highly transactional IT bench sales recruiter. Your goal is to write a strictly text-based, plain-text email to a vendor asking for missing details about a job they just posted.

Rules for the Email:
1. Zero Fluff: Do not use corporate greetings like "I hope this email finds you well" or "Good morning."
2. Extreme Brevity: Keep the entire email under 40 words.
3. The Hook: Always imply you have a candidate actively on your bench who perfectly fits the role and is ready to be submitted right now.
4. The Ask: Ask explicitly for the missing data point provided in the variables.
5. Tone: Casual, urgent, and professional. Use natural phrasing like "Hey," or "Hi [Name]," and sign off simply with the sender's name.

Generate only the email body and subject line. Do not include any explanations. Return strict JSON with exactly these keys: "subject" and "email_content".`;
  const userPrompt = `Job Title: ${jobTitle}
Job Location: ${jobLocation}
Vendor Name: ${vendorName}
Missing Detail to Ask For: ${missingDataType}
Sender Name: ${recruiterFirstName}`;
  const model = (env.PARSER_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8").trim();
  const aiResult = await env.AI.run(model, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 250,
  });
  const copy = normalizeAskVendorEmailCopy((aiResult as Record<string, unknown>)?.response ?? aiResult);
  return jsonResponse(copy);
}

function requestedDetailKeys(missingDetails: unknown): Set<string> {
  const keys = new Set<string>();
  for (const item of Array.isArray(missingDetails) ? missingDetails : []) {
    const label = String(item ?? "").trim().toLowerCase();
    if (label.includes("experience") || label === "exp") keys.add("experience_years");
    if (label.includes("employment")) keys.add("employment_type");
    if (label.includes("work type")) keys.add("work_type");
    if (label.includes("rate") || label.includes("salary") || label.includes("hourly")) keys.add("hourly_rate");
    if (label.includes("visa")) keys.add("visa_types");
    if (label.includes("location")) keys.add("locations");
    if (label.includes("skill")) keys.add("skills");
  }
  return keys;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 20)
    : [];
}

function normalizeReplyExtraction(parsed: unknown, allowedKeys: Set<string>): Record<string, unknown> {
  if (!parsed || typeof parsed !== "object") throw new Error("AI response is not a JSON object");
  const source = parsed as Record<string, unknown>;
  const confidence = Number(source.confidence ?? 0);
  if (!Number.isFinite(confidence) || confidence < 0.75) throw new Error("AI extraction confidence is too low");

  const result: Record<string, unknown> = {};
  if (allowedKeys.has("experience_years") && Number.isFinite(Number(source.experience_years))) {
    result.experience_years = Number(source.experience_years);
  }
  for (const key of ["employment_type", "work_type"] as const) {
    const value = String(source[key] ?? "").trim();
    if (allowedKeys.has(key) && value && value.toLowerCase() !== "unknown") result[key] = value;
  }
  for (const key of ["visa_types", "locations", "skills"] as const) {
    const values = stringArray(source[key]);
    if (allowedKeys.has(key) && values.length > 0) result[key] = values;
  }
  if (allowedKeys.has("hourly_rate")) {
    const minimum = source.hourly_rate_min == null ? null : Number(source.hourly_rate_min);
    const maximum = source.hourly_rate_max == null ? null : Number(source.hourly_rate_max);
    const salaryRange = String(source.salary_range ?? "").trim();
    if (minimum != null && Number.isFinite(minimum)) result.hourly_rate_min = minimum;
    if (maximum != null && Number.isFinite(maximum)) result.hourly_rate_max = maximum;
    if (salaryRange) result.salary_range = salaryRange;
    if ("hourly_rate_min" in result || "hourly_rate_max" in result || "salary_range" in result) {
      result.hourly_rate = true;
    }
  }
  return result;
}

async function supabaseJson(env: Env, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: { ...supabaseHeaders(env), ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  return payload;
}

function updatedBreakdown(existing: unknown, details: Record<string, unknown>): Record<string, unknown> {
  const breakdown = existing && typeof existing === "object" ? { ...(existing as Record<string, unknown>) } : {};
  const setJobValue = (key: string, value: string) => {
    const current = breakdown[key] && typeof breakdown[key] === "object" ? breakdown[key] as Record<string, unknown> : {};
    breakdown[key] = { ...current, job_value: value };
  };
  if (details.experience_years != null) setJobValue("experience_match", `${details.experience_years}+ years`);
  if (details.employment_type) setJobValue("employment_type_match", String(details.employment_type));
  if (details.work_type) setJobValue("work_type_match", String(details.work_type));
  if (Array.isArray(details.visa_types)) setJobValue("visa_match", details.visa_types.join(", "));
  if (Array.isArray(details.locations)) setJobValue("location_match", details.locations.join(", "));
  if (Array.isArray(details.skills)) setJobValue("skills_match", details.skills.join(", "));
  if (details.hourly_rate) {
    setJobValue("rate_match", String(details.salary_range ?? `$${details.hourly_rate_min ?? "?"}-$${details.hourly_rate_max ?? "?"}/hr`));
  }
  return breakdown;
}

async function handleVendorReply(req: Request, env: Env): Promise<Response> {
  const expectedToken = (env.INBOUND_REPLY_TOKEN ?? "").trim();
  if (!expectedToken) return jsonResponse({ error: "Inbound reply webhook is not configured" }, 503);
  if (getBearerToken(req) !== expectedToken) return jsonResponse({ error: "Unauthorized" }, 401);

  const body = await req.json() as VendorReplyRequest;
  const jobId = String(body.job_id ?? "").trim();
  const fromEmail = String(body.from_email ?? "").trim().toLowerCase();
  const emailContent = String(body.email_content ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || !/^\S+@\S+\.\S+$/.test(fromEmail) || !emailContent) {
    return jsonResponse({ error: "job_id, from_email, and email_content are required" }, 400);
  }

  const jobs = await supabaseJson(
    env,
    `social_jobs?id=eq.${encodeURIComponent(jobId)}&select=id,poster_email&limit=1`,
  ) as Array<{ id: string; poster_email: string }>;
  const job = jobs[0];
  if (!job) return jsonResponse({ error: "Job not found" }, 404);
  if (String(job.poster_email ?? "").trim().toLowerCase() !== fromEmail) {
    return jsonResponse({ error: "Sender email does not match this job's vendor" }, 403);
  }

  const requests = await supabaseJson(
    env,
    `pulse_ask_ai_requests?job_id=eq.${encodeURIComponent(jobId)}&status=eq.completed&select=request_id,job_id,missing_details`,
  ) as Array<{ request_id: string; job_id: string; missing_details: unknown }>;
  if (requests.length === 0) return jsonResponse({ error: "No pending Ask requests were found for this job" }, 404);

  const allowedKeys = requestedDetailKeys(requests.flatMap((request) => Array.isArray(request.missing_details) ? request.missing_details : []));
  if (allowedKeys.size === 0) return jsonResponse({ error: "Request has no supported missing details" }, 422);

  const prompt = `Extract only job details explicitly stated in this vendor email reply. Return strict JSON only, without markdown.
Use null or [] when absent. Do not infer or guess. Include: confidence (0 to 1), experience_years, employment_type, work_type, visa_types, locations, skills, hourly_rate_min, hourly_rate_max, salary_range.
The originally requested fields are: ${Array.from(allowedKeys).join(", ")}.
Subject: ${String(body.subject ?? "").slice(0, 500)}
From: ${fromEmail.slice(0, 320)}
Email:
${emailContent.slice(0, 12_000)}`;
  const model = (env.PARSER_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8").trim();
  const aiResult = await env.AI.run(model, {
    messages: [
      { role: "system", content: "Extract explicit job details from vendor email replies. Never infer missing facts. Return strict JSON only." },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    max_tokens: 1200,
  });
  const details = normalizeReplyExtraction(parseModelText((aiResult as Record<string, unknown>)?.response ?? aiResult), allowedKeys);
  if (Object.keys(details).length === 0) return jsonResponse({ error: "Reply did not contain any requested details" }, 422);

  const radarRows = await supabaseJson(
    env,
    `radar_match_results?job_id=eq.${encodeURIComponent(jobId)}&job_source=eq.social&select=id,score_breakdown`,
  ) as Array<{ id: string; score_breakdown: unknown }>;
  for (const radarRow of radarRows) {
    await supabaseJson(env, `radar_match_results?id=eq.${encodeURIComponent(radarRow.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ score_breakdown: updatedBreakdown(radarRow.score_breakdown, details) }),
    });
  }

  const socialPatch: Record<string, unknown> = {
    verification_status: "verified",
    verified_at: new Date().toISOString(),
    reply_extracted_details: details,
  };
  if (details.experience_years != null) socialPatch.extracted_experience_years = details.experience_years;
  if (details.employment_type) socialPatch.employment_type = details.employment_type;
  if (Array.isArray(details.visa_types)) socialPatch.extracted_visa_types = details.visa_types;
  if (Array.isArray(details.locations) && details.locations.length > 0) socialPatch.location = details.locations.join(", ");
  if (Array.isArray(details.skills)) socialPatch.extracted_skills = details.skills;
  if (details.hourly_rate_min != null) socialPatch.extracted_hourly_rate_min = details.hourly_rate_min;
  if (details.hourly_rate_max != null) socialPatch.extracted_hourly_rate_max = details.hourly_rate_max;
  if (details.salary_range) socialPatch.salary_range = details.salary_range;

  await supabaseJson(env, `social_jobs?id=eq.${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(socialPatch),
  });

  return jsonResponse({ ok: true, job_id: jobId, fulfilled_requests: requests.map((request) => request.request_id), status: "Verified", extracted_details: details });
}

function normalizeSingleParsedResult(parsed: unknown, message: QueueMessageBody): ParserResult {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model output is not a JSON object");
  }
  const obj = { ...(parsed as Record<string, unknown>) };
  if (!obj.job_id) obj.job_id = message.job_id;
  return obj;
}

function isAcceptedJobPosting(parsed: ParserResult): boolean {
  const isJobPosting = parsed.is_job_posting === true
    || (typeof parsed.is_job_posting === "string" && parsed.is_job_posting.toLowerCase() === "true");
  const confidence = Number(parsed.confidence ?? 0);
  const roleTitle = String(parsed.role_title ?? "").trim();
  const hasDetails = Boolean(
    (Array.isArray(parsed.core_skills) && parsed.core_skills.length > 0)
    || (Array.isArray(parsed.locations) && parsed.locations.length > 0)
    || String(parsed.employment_type ?? "").trim()
    || String(parsed.work_type ?? "").trim(),
  );
  return isJobPosting && confidence >= 0.8 && Boolean(roleTitle) && hasDetails;
}

async function parseWithWorkersAi(env: Env, message: QueueMessageBody): Promise<ParserResult> {
  const model = (env.PARSER_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8").trim();
  const prompt = buildPrompt(message);

  const aiResult = await env.AI.run(model, {
    messages: [
      {
        role: "system",
        content: "You classify genuine job openings and extract structured fields. Be conservative and respond with strict JSON only.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.1,
    max_tokens: 1200,
  });

  const rawText = (aiResult as Record<string, unknown>)?.response ?? aiResult;
  const parsed = parseModelText(rawText);
  return normalizeSingleParsedResult(parsed, message);
}

function isQueueMessageBody(value: unknown): value is QueueMessageBody {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["job_id", "post_id", "platform", "title", "description", "location"].every(
    (key) => typeof item[key] === "string",
  );
}

async function parseWithWorker(env: Env, message: QueueMessageBody): Promise<ParserResult> {
  if (!env.PARSER_WORKER_URL) {
    return parseWithWorkersAi(env, message);
  }

  const response = await fetch(env.PARSER_WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.PARSER_WORKER_TOKEN ? { "Authorization": `Bearer ${env.PARSER_WORKER_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      jobs: [
        {
          id: message.job_id,
          title: message.title,
          description: message.description,
          location: message.location,
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Parser worker HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  const results = Array.isArray(payload?.results) ? payload.results : [];
  if (results.length === 0) {
    return parseWithWorkersAi(env, message);
  }

  const exact = results.find((result: Record<string, unknown>) => String(result.job_id ?? "") === message.job_id);
  return (exact ?? results[0]) as ParserResult;
}

function toRadarMatchRow(parsed: ParserResult, message: QueueMessageBody): RadarMatchRow {
  const rateStr = (parsed.hourly_rate_min != null || parsed.hourly_rate_max != null)
    ? `$${parsed.hourly_rate_min ?? "?"}-$${parsed.hourly_rate_max ?? "?"}/hr`
    : "Not specified";

  const extractionSummary = {
    role_title: String(parsed.role_title ?? message.title ?? "Not specified"),
    core_skills: Array.isArray(parsed.core_skills) ? parsed.core_skills as string[] : [],
    years_experience: typeof parsed.years_experience === "number" ? parsed.years_experience : null,
    visa_types: Array.isArray(parsed.visa_types) ? parsed.visa_types as string[] : [],
    employment_type: String(parsed.employment_type ?? ""),
    work_type: String(parsed.work_type ?? ""),
    locations: Array.isArray(parsed.locations) ? parsed.locations as string[] : [],
    hourly_rate_min: typeof parsed.hourly_rate_min === "number" ? parsed.hourly_rate_min : null,
    hourly_rate_max: typeof parsed.hourly_rate_max === "number" ? parsed.hourly_rate_max : null,
  };

  return {
    profile_id: null,
    job_source: "social",
    job_id: message.job_id,
    final_average_score: 0,
    score_breakdown: {
      role_match: {
        score: 0,
        candidate_value: "",
        job_value: String(parsed.role_title ?? message.title ?? "Not specified"),
        rule: "Job role title",
      },
      skills_match: {
        score: 0,
        candidate_value: "",
        job_value: Array.isArray(parsed.core_skills) ? (parsed.core_skills as string[]).join(", ") : "Not specified",
        rule: "Required skills",
      },
      experience_match: {
        score: 0,
        candidate_value: "",
        job_value: parsed.years_experience != null ? `${parsed.years_experience}+ years` : "Not specified",
        rule: "Required experience",
      },
      visa_match: {
        score: 0,
        candidate_value: "",
        job_value: Array.isArray(parsed.visa_types) && (parsed.visa_types as string[]).length
          ? (parsed.visa_types as string[]).join(", ")
          : "Not specified",
        rule: "Visa requirements",
      },
      work_type_match: {
        score: 0,
        candidate_value: "",
        job_value: String(parsed.work_type ?? "Not specified"),
        rule: "Work arrangement",
      },
      location_match: {
        score: 0,
        candidate_value: "",
        job_value: Array.isArray(parsed.locations) && (parsed.locations as string[]).length
          ? (parsed.locations as string[]).join(", ")
          : message.location || "Not specified",
        rule: "Location",
      },
      rate_match: {
        score: 0,
        candidate_value: "",
        job_value: rateStr,
        rule: "Hourly rate",
      },
    },
    ai_notes: `extraction_only|${JSON.stringify(extractionSummary)}`,
    disqualified: false,
    disqualify_reason: null,
  };
}

function supabaseHeaders(env: Env, prefer?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    ...(prefer ? { "Prefer": prefer } : {}),
  };
}

async function upsertRadarMatch(env: Env, row: RadarMatchRow): Promise<void> {
  const baseUrl = env.SUPABASE_URL.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rest/v1/radar_match_results?on_conflict=job_id,job_source`, {
    method: "POST",
    headers: supabaseHeaders(env, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify([row]),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`radar_match_results upsert failed (${response.status}): ${text.slice(0, 240)}`);
  }
}

async function markJobExtracted(env: Env, jobId: string): Promise<void> {
  const baseUrl = env.SUPABASE_URL.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rest/v1/social_jobs?id=eq.${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: supabaseHeaders(env, "return=minimal"),
    body: JSON.stringify({ extracted_at: new Date().toISOString() }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`social_jobs update failed (${response.status}): ${text.slice(0, 240)}`);
  }
}

async function processMessage(env: Env, message: QueueMessageBody): Promise<void> {
  const parsed = await parseWithWorker(env, message);
  if (!isAcceptedJobPosting(parsed)) {
    console.warn(JSON.stringify({
      event: "social_job_rejected_by_ai",
      job_id: message.job_id,
      confidence: parsed.confidence ?? null,
      reason: parsed.rejection_reason ?? "AI confidence or job details below threshold",
    }));
    await markJobExtracted(env, message.job_id);
    return;
  }
  const row = toRadarMatchRow(parsed, message);
  await upsertRadarMatch(env, row);
  await markJobExtracted(env, message.job_id);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    const pathname = new URL(req.url).pathname;
    if (req.method === "POST" && pathname === "/ask-vendor-email-copy") {
      try {
        return await handleAskVendorEmailCopy(req, env);
      } catch (error) {
        console.error("Ask Vendor email generation failed", error);
        return jsonResponse({ error: "Could not generate vendor email copy" }, 502);
      }
    }

    if (req.method === "POST") {
      try {
        return await handleVendorReply(req, env);
      } catch (error) {
        console.error("Vendor reply webhook failed", error);
        return jsonResponse({ error: (error as Error).message }, 500);
      }
    }

    if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

    return jsonResponse({ ok: true, worker: "social-job-queue-consumer" });
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        if (!isQueueMessageBody(message.body)) {
          throw new Error("Queue message schema validation failed");
        }

        await processMessage(env, message.body);
        message.ack();
      } catch (error) {
        console.error("Queue message processing failed:", {
          id: message.id,
          error: (error as Error).message,
        });
        message.retry();
      }
    }
  },
};
