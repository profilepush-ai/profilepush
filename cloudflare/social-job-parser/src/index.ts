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

type ParserRoute = "classify" | "extract-job" | "extract-hotlist";

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

function buildJobPrompt(jobs: JobInput[]) {
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

function buildClassificationPrompt(jobs: JobInput[]) {
  const blocks = jobs
    .map((job, index) => `[Post ${index}] (id: ${job.id})\n${(job.description ?? "").slice(0, 4000)}`)
    .join("\n---\n");

  return `Classify each social-media post into exactly one category. Return ONLY valid JSON, no markdown.
Decide by the direction of the staffing transaction, not by isolated keywords:
- Use post_type="job" for DEMAND: the author has an open client requirement or position and wants resumes, candidates, referrals, applications, or submissions for it.
- Use post_type="hotlist" for SUPPLY: the author explicitly says they represent, employ, market, or have available consultants/candidates and wants client requirements or contract opportunities for those people.
Use post_type="other" for resumes, discussions, news, events, promotions, and content that is neither demand for candidates nor supply of available candidates.

Strict rules:
1. Words such as "hiring", "requirement", "C2C", "contract", "submission", role names, hashtags, email addresses, and staffing-company language do NOT determine the category by themselves.
2. A list of required skills, experience, visa eligibility, location, rate, or work arrangement for an OPEN POSITION is a job, not a hotlist.
3. A list of distinct people or available resources where role + years of experience + visa/status + current location are candidate attributes is a hotlist.
4. "I have candidates/consultants", "our bench", "available resources", "updated hotlist", "please share your requirements", and "open to new projects/opportunities" are strong hotlist evidence only when they describe the author's represented inventory.
5. "We are hiring", "urgent requirement", "send resumes", "submit candidates", "looking for a consultant", and "position open" are strong job evidence.
6. Ignore incidental or promotional hashtags such as #Hiring, #Recruitment, #Jobs, #Hotlist, and #C2C when the prose clearly establishes the opposite direction.
7. If a post genuinely contains both open requirements and available consultants, classify it as job unless the primary body is clearly an inventory list of represented, currently available consultants.
8. Never classify a post as hotlist merely because it accepts C2C candidates or mentions visa types.

Examples:
- "Urgent Java Developer requirement. 8+ years, H1B okay, Dallas. Send resumes" => job.
- "Hiring multiple consultants: Java, QA, BA. Please submit suitable candidates" => job.
- "I have Java and QA consultants on my bench, immediately available. Please share C2C requirements" => hotlist.
- "Updated hotlist: Salesforce Developer - 6 years - OPT - TX; .NET Developer - 10 years - H1B - TX" => hotlist, even if it ends with #Hiring.
- "Senior Java developer open to work; contact me" describing one person's own resume => other, not hotlist.

Preserve post_id exactly. Include: post_id, post_type (job/hotlist/other), confidence (0 to 1), reason.

POSTS:
${blocks}

Return ONLY valid JSON array:`;
}

function buildHotlistPrompt(jobs: JobInput[]) {
  const blocks = jobs
    .map((job, index) => `[Post ${index}] (id: ${job.id})\n${(job.description ?? "").slice(0, 3500)}`)
    .join("\n---\n");

  return `Verify the post is supply-side candidate marketing, then extract every distinct available consultant or candidate advertised in each hotlist post. Return ONLY valid JSON, no markdown.
Return one result per input post and preserve post_id exactly. Do not combine candidates. Do not invent names or details.
Set is_hotlist=true only when the author explicitly represents available consultants/candidates and is seeking requirements or opportunities for them. Set is_hotlist=false for open jobs seeking candidates, even when they mention C2C, visas, experience, locations, or multiple roles. When false, return candidates=[].
Determine whether the post advertises one consultant or multiple consultants before extracting:
- One advertised consultant => consultant_count=1, post_scope="single", and exactly one candidates item.
- Multiple advertised consultants => consultant_count equals the number of distinct advertised consultant entries, post_scope="multiple", and exactly one candidates item per entry.
- Never combine separate list entries into one candidate. If two consultants have the same role title but different experience, visa, location, name, or other attributes, preserve them as separate candidates.
- Do not split one consultant into multiple candidates merely because multiple skills or preferred locations are listed.
- Recruiter name, email, phone, and company describe the post owner and must be returned once at the result level, never guessed separately per candidate.
For each result include: post_id, is_hotlist (boolean), confidence (0 to 1), rejection_reason (string or null), consultant_count (integer), post_scope (single/multiple), bench_sales_recruiter_name, bench_sales_recruiter_email, bench_sales_recruiter_phone, bench_sales_company_name, and candidates.
Each candidates item must include: candidate_index (zero-based), candidate_name, role_title, core_skills (array max 12), years_experience (number or null), visa_type, employment_type (C2C/W2/Full-time/Contract/Any), work_type (Remote/Hybrid/Onsite/Unknown), locations (array), hourly_rate_min (number or null), hourly_rate_max (number or null), availability, and candidate_summary.
Use null for unknown scalar values and [] for unknown arrays. Candidate summary must only restate facts explicitly present in the post.

HOTLIST POSTS:
${blocks}

Return ONLY valid JSON array:`;
}

// The model occasionally gets cut off mid-output on large batches (hits max_tokens
// before finishing the JSON array). Recover whatever complete elements precede the
// truncation point instead of discarding the entire batch on a parse error.
function recoverTruncatedJsonArray(text: string): unknown[] {
  const start = text.indexOf("[");
  if (start === -1) throw new Error("No JSON array found in model output");

  let depth = 0;
  let inString = false;
  let escape = false;
  let lastCompleteEnd = -1;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (depth === 1 && char === "}") lastCompleteEnd = i;
      if (depth === 0) { lastCompleteEnd = i; break; }
    }
  }

  if (lastCompleteEnd === -1) throw new Error("No complete JSON element found in model output");
  return JSON.parse(`${text.slice(start, lastCompleteEnd + 1)}]`);
}

function parseModelText(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch (parseError) {
    try {
      return recoverTruncatedJsonArray(trimmed);
    } catch {
      throw parseError;
    }
  }
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

      const pathname = new URL(req.url).pathname.replace(/\/+$/, "");
      const route: ParserRoute = pathname === "/classify"
        ? "classify"
        : pathname === "/extract-hotlist"
          ? "extract-hotlist"
          : "extract-job";
      const prompt = (body.prompt ?? "").trim() || (route === "classify"
        ? buildClassificationPrompt(jobs)
        : route === "extract-hotlist"
          ? buildHotlistPrompt(jobs)
          : buildJobPrompt(jobs));
      const model = (env.PARSER_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8").trim();
      const systemContent = route === "classify"
        ? "You route staffing-industry social posts into job demand, hotlist supply, or other. Respond with strict JSON only."
        : route === "extract-hotlist"
          ? "You extract available consultants from bench sales hotlists. Preserve each distinct candidate and respond with strict JSON only."
          : "You classify genuine job openings and extract structured fields. Be conservative and respond with strict JSON only.";

      // Hotlist posts can carry several candidates per post, which needs materially
      // more output room than a single job or a bare classification does.
      const maxTokens = route === "extract-hotlist" ? 4096 : route === "extract-job" ? 3500 : 2000;

      let aiResult: unknown;
      let aiError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          aiResult = await env.AI.run(model, {
            messages: [
              {
                role: "system",
                content: systemContent,
              },
              {
                role: "user",
                content: prompt,
              },
            ],
            temperature: 0.1,
            max_tokens: maxTokens,
          });
          aiError = undefined;
          break;
        } catch (error) {
          aiError = error;
        }
      }
      if (aiError) throw aiError;

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
