export interface Env {
  AI: Ai;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
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
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
  return `Extract structured fields from this job posting. Return ONLY valid JSON, no markdown.
Preserve job_id exactly as provided. If a field is unknown, use null (or [] for arrays).
Include: job_id, role_title, core_skills (array max 12), years_experience (number or null), visa_types (array), employment_type (C2C/W2/Full-time/Contract/Any), work_type (Remote/Hybrid/Onsite/Unknown), locations (array), hourly_rate_min (number or null), hourly_rate_max (number or null).

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

function normalizeSingleParsedResult(parsed: unknown, message: QueueMessageBody): ParserResult {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model output is not a JSON object");
  }
  const obj = { ...(parsed as Record<string, unknown>) };
  if (!obj.job_id) obj.job_id = message.job_id;
  return obj;
}

async function parseWithWorkersAi(env: Env, message: QueueMessageBody): Promise<ParserResult> {
  const model = (env.PARSER_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8").trim();
  const prompt = buildPrompt(message);

  const aiResult = await env.AI.run(model, {
    messages: [
      {
        role: "system",
        content: "You extract structured job fields and must respond with strict JSON only.",
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
  const row = toRadarMatchRow(parsed, message);
  await upsertRadarMatch(env, row);
  await markJobExtracted(env, message.job_id);
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (req.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

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
