export interface Env {
  AI: Ai;
  WORKER_AUTH_TOKEN?: string;
  PARSER_MODEL?: string;
}

type JobInput = {
  id: string;
  title: string;
  description: string;
  location: string;
};

type ParserRequest = {
  jobs?: JobInput[];
  prompt?: string;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function normalizeRows(parsed: unknown, jobs: JobInput[]) {
  let rows: unknown[] = [];

  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.results)) rows = obj.results;
    else if (Array.isArray(obj.items)) rows = obj.items;
    else if (Array.isArray(obj.jobs)) rows = obj.jobs;
    else if ("job_id" in obj || "role_title" in obj || "core_skills" in obj) rows = [obj];
  }

  return rows
    .map((row, index) => {
      if (!row || typeof row !== "object") return null;
      const next = { ...(row as Record<string, unknown>) };
      if (!next.job_id) next.job_id = jobs[index]?.id ?? jobs[0]?.id ?? null;
      return next;
    })
    .filter((row): row is Record<string, unknown> => Boolean(row?.job_id));
}

function buildPrompt(jobs: JobInput[]) {
  const blocks = jobs
    .map((job, index) => {
      const safeDescription = (job.description ?? "").slice(0, 1500);
      return `[Job ${index}] (id: ${job.id})\nTitle: ${job.title}\nLocation: ${job.location}\nDescription: ${safeDescription}`;
    })
    .join("\n---\n");

  return `Classify each input as a genuine job posting and extract structured fields. Return ONLY valid JSON, no markdown.
Return one result per input job and preserve job_id from input. If a field is unknown, use null (or [] for arrays).
Set is_job_posting=true only when the text advertises a specific open role with enough actionable details to apply. Reject resumes, candidate marketing, generic staffing promotions, discussions, event posts, news, and vague hiring claims.
For each job include: job_id, is_job_posting (boolean), confidence (0 to 1), rejection_reason (string or null), role_title, company_name, core_skills (array max 12), years_experience (number or null), visa_types (array), employment_type (C2C/W2/Full-time/Contract/Any), work_type (Remote/Hybrid/Onsite/Unknown), locations (array), hourly_rate_min (number or null), hourly_rate_max (number or null).

JOBS:
${blocks}

Return ONLY valid JSON array:`;
}

function parseModelText(raw: unknown): unknown {
  if (typeof raw === "string") {
    const trimmed = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(trimmed);
  }
  return raw;
}

function getBearerToken(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return "";
  return token.trim();
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const expected = (env.WORKER_AUTH_TOKEN ?? "").trim();
    if (expected) {
      const actual = getBearerToken(req);
      if (!actual || actual !== expected) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
    }

    try {
      const body = (await req.json()) as ParserRequest;
      const jobs = Array.isArray(body.jobs) ? body.jobs : [];

      if (jobs.length === 0) {
        return jsonResponse({ error: "jobs array is required" }, 400);
      }

      const prompt = (body.prompt ?? "").trim() || buildPrompt(jobs);
      const model = (env.PARSER_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8").trim();

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
        max_tokens: 3000,
      });

      const rawText = (aiResult as Record<string, unknown>)?.response ?? aiResult;
      const parsed = parseModelText(rawText);
      const results = normalizeRows(parsed, jobs);

      if (results.length === 0) {
        return jsonResponse({ error: "Model returned no usable extraction rows", raw: rawText }, 422);
      }

      return jsonResponse({ results });
    } catch (error) {
      return jsonResponse({ error: (error as Error).message }, 500);
    }
  },
};
