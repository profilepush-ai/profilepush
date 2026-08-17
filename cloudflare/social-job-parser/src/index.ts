export interface Env {
  AI: Ai;
  HOTLIST_IMAGES: R2Bucket;
  WORKER_AUTH_TOKEN?: string;
  PARSER_MODEL?: string;
  PARSER_VISION_MODEL?: string;
  HOTLIST_IMAGES_PUBLIC_BASE_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

type JobInput = {
  id: string;
  title: string;
  description: string;
  location: string;
  image_urls?: string[];
};

type ParserRequest = {
  jobs?: JobInput[];
  prompt?: string;
};

type ParserRoute = "classify" | "extract-job" | "extract-hotlist";

type PredictMatchJobContext = {
  skills?: string;
  exp?: string;
  visa?: string;
  workType?: string;
  location?: string;
  employmentType?: string;
};

type PredictMatchRequest = {
  roleTitle?: string;
  jobContext?: PredictMatchJobContext;
  consultantText?: string;
};

const PREDICT_MATCH_SYSTEM_PROMPT = "You are a staffing-industry submission-acceptance predictor. Estimate the likelihood a vendor will ACCEPT this candidate submission for this job, based purely on how well the candidate's background matches the job's stated requirements. Be honest and conservative, not encouraging. Respond with strict JSON only.";

function buildPredictMatchPrompt(roleTitle: string, jobContext: PredictMatchJobContext, consultantText: string) {
  return `Estimate the SUBMISSION ACCEPTANCE SCORE (0-100): the likelihood a vendor accepts this candidate submission, based purely on how well the CONSULTANT TEXT matches the JOB REQUIREMENTS below. Do not consider anything outside these fields.
Weigh categories as: Skills max 35, Experience max 20, Visa max 15, Work Type max 10, Location max 10, Employment Type max 10 (total 100).
For each category return earned (integer, 0 to its max) and a short note (max 12 words) explaining the match or gap. If a job requirement field is "Not specified", award full points for that category and note "Not specified".
Return ONLY valid JSON in this exact shape, no markdown, no explanation:
{"score": number, "verdict": string, "categories": [{"label": string, "earned": number, "max": number, "note": string}]}
The verdict must be one short punchy phrase (max 8 words) about submission acceptance chances, reflecting the score band: 80-100 "highly likely to be accepted", 60-79 "good chance of acceptance", 40-59 "moderate chance, gaps to address", 0-39 "unlikely to be accepted".

JOB: ${roleTitle || "Untitled role"}
Skills required: ${jobContext.skills || "Not specified"}
Experience required: ${jobContext.exp || "Not specified"}
Visa requirement: ${jobContext.visa || "Not specified"}
Work type: ${jobContext.workType || "Not specified"}
Location: ${jobContext.location || "Not specified"}
Employment type: ${jobContext.employmentType || "Not specified"}

CONSULTANT TEXT:
${consultantText.slice(0, 4000)}

Return ONLY the JSON object:`;
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes("429") || message.includes("rate limit") || message.includes("too many requests");
}

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

const DEFAULT_JOB_EXTRACT_INSTRUCTIONS = `Classify each input as a genuine job posting and extract structured fields. Return ONLY valid JSON, no markdown.
Return one result per input job and preserve job_id from input. If a field is unknown, use null (or [] for arrays).
Set is_job_posting=true only when the text advertises a specific open role with enough actionable details to apply. Reject resumes, candidate marketing, generic staffing promotions, discussions, event posts, news, and vague hiring claims.`;

const JOB_EXTRACT_FIELDS = "For each job include: job_id, is_job_posting (boolean), confidence (0 to 1), rejection_reason (string or null), role_title, company_name, core_skills (array max 12), years_experience (number or null), visa_types (array), employment_type (C2C/W2/Full-time/Contract/Any), work_type (Remote/Hybrid/Onsite/Unknown), locations (array), hourly_rate_min (number or null), hourly_rate_max (number or null).";

function buildJobPrompt(jobs: JobInput[], instructions: string) {
  const blocks = jobs
    .map((job, index) => {
      const safeDescription = (job.description ?? "").slice(0, 1500);
      return `[Job ${index}] (id: ${job.id})\nTitle: ${job.title}\nLocation: ${job.location}\nDescription: ${safeDescription}`;
    })
    .join("\n---\n");

  return `${instructions}
${JOB_EXTRACT_FIELDS}

JOBS:
${blocks}

Return ONLY valid JSON array:`;
}

const DEFAULT_CLASSIFY_INSTRUCTIONS = `Classify each social-media post into exactly one category. Return ONLY valid JSON, no markdown.
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
- "Senior Java developer open to work; contact me" describing one person's own resume => other, not hotlist.`;

const CLASSIFY_FIELDS = "Preserve post_id exactly. Include: post_id, post_type (job/hotlist/other), confidence (0 to 1), reason.";

function buildClassificationPrompt(jobs: JobInput[], instructions: string) {
  const blocks = jobs
    .map((job, index) => `[Post ${index}] (id: ${job.id})\n${(job.description ?? "").slice(0, 4000)}`)
    .join("\n---\n");

  return `${instructions}

${CLASSIFY_FIELDS}

POSTS:
${blocks}

Return ONLY valid JSON array:`;
}

const DEFAULT_HOTLIST_EXTRACT_INSTRUCTIONS = `Verify the post is supply-side candidate marketing, then extract every distinct available consultant or candidate advertised in each hotlist post. Return ONLY valid JSON, no markdown.
Return one result per input post and preserve post_id exactly. Do not combine candidates. Do not invent names or details.
Set is_hotlist=true only when the author explicitly represents available consultants/candidates and is seeking requirements or opportunities for them. Set is_hotlist=false for open jobs seeking candidates, even when they mention C2C, visas, experience, locations, or multiple roles. When false, return candidates=[].
Determine whether the post advertises one consultant or multiple consultants before extracting:
- One advertised consultant => consultant_count=1, post_scope="single", and exactly one candidates item.
- Multiple advertised consultants => consultant_count equals the number of distinct advertised consultant entries, post_scope="multiple", and exactly one candidates item per entry.
- Never combine separate list entries into one candidate. If two consultants have the same role title but different experience, visa, location, name, or other attributes, preserve them as separate candidates.
- Do not split one consultant into multiple candidates merely because multiple skills or preferred locations are listed.
- Recruiter name, email, phone, and company describe the post owner and must be returned once at the result level, never guessed separately per candidate.`;

const HOTLIST_EXTRACT_FIELDS = `For each result include: post_id, is_hotlist (boolean), confidence (0 to 1), rejection_reason (string or null), consultant_count (integer), post_scope (single/multiple), bench_sales_recruiter_name, bench_sales_recruiter_email, bench_sales_recruiter_phone, bench_sales_company_name, and candidates.
Each candidates item must include: candidate_index (zero-based), candidate_name, role_title, core_skills (array max 12), years_experience (number or null), visa_type, employment_type (C2C/W2/Full-time/Contract/Any), work_type (Remote/Hybrid/Onsite/Unknown), locations (array), hourly_rate_min (number or null), hourly_rate_max (number or null), availability, and candidate_summary.
Use null for unknown scalar values and [] for unknown arrays. Candidate summary must only restate facts explicitly present in the post.`;

function buildHotlistPrompt(jobs: JobInput[], instructions: string) {
  const blocks = jobs
    .map((job, index) => `[Post ${index}] (id: ${job.id})\n${(job.description ?? "").slice(0, 3500)}`)
    .join("\n---\n");

  return `${instructions}
${HOTLIST_EXTRACT_FIELDS}

HOTLIST POSTS:
${blocks}

Return ONLY valid JSON array:`;
}

// Bench sales hotlists are frequently posted as a table screenshot rather than
// (or in addition to) plain text, so the real candidate list only exists in the
// image. Cap images per post to bound Workers AI cost/latency on a single request.
const MAX_HOTLIST_IMAGES_PER_POST = 3;

const HOTLIST_IMAGE_EXTRACT_PROMPT = `This image is a screenshot of a bench sales hotlist table listing available consultants. Read every row and extract each distinct consultant as one JSON object.
Each item must include: candidate_index (zero-based, in row order), candidate_name, role_title, core_skills (array max 12), years_experience (number or null), visa_type, employment_type (C2C/W2/Full-time/Contract/Any), work_type (Remote/Hybrid/Onsite/Unknown), locations (array), hourly_rate_min (number or null), hourly_rate_max (number or null), availability, and candidate_summary.
Use null for unknown scalar values and [] for unknown arrays. Only include rows that clearly represent a distinct consultant/candidate. Do not invent rows that are not visible in the image. If the image is not a consultant/candidate table, return [].
Do not explain your reasoning, do not describe the image, do not use markdown code fences. Your entire response must be a single JSON array and nothing else, starting with [ and ending with ].`;

async function extractCandidatesFromImages(
  env: Env,
  imageUrls: string[],
): Promise<{ candidates: unknown[]; sourceImageUrls: string[] }> {
  const model = (env.PARSER_VISION_MODEL ?? "@cf/meta/llama-3.2-11b-vision-instruct").trim();
  const publicBaseUrl = (env.HOTLIST_IMAGES_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

  // Vision calls are the slowest step in the pipeline — running a post's
  // (at most 3) images concurrently instead of sequentially keeps a
  // multi-image post from multiplying its own latency by image count.
  const perImageResults = await Promise.all(
    imageUrls.slice(0, MAX_HOTLIST_IMAGES_PER_POST).map(async (imageUrl) => {
      try {
        const imageResponse = await fetch(imageUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; ProfilePushBot/1.0; +https://profilepush.ai)" },
        });
        if (!imageResponse.ok) return { candidates: [] as unknown[], sourceImageUrl: null as string | null };
        const bytes = new Uint8Array(await imageResponse.arrayBuffer());

        const key = `hotlist/${crypto.randomUUID()}.jpg`;
        await env.HOTLIST_IMAGES.put(key, bytes, {
          httpMetadata: { contentType: imageResponse.headers.get("content-type") ?? "image/jpeg" },
        });
        const sourceImageUrl = publicBaseUrl ? `${publicBaseUrl}/${key}` : null;

        const visionResult = await env.AI.run(model, {
          image: [...bytes],
          prompt: HOTLIST_IMAGE_EXTRACT_PROMPT,
          max_tokens: 4096,
          temperature: 0,
        });
        const rawText = (visionResult as Record<string, unknown>)?.response ?? visionResult;
        const parsed = parseModelText(rawText);
        const rows = Array.isArray(parsed) ? parsed : [];
        return { candidates: rows, sourceImageUrl };
      } catch (error) {
        console.error(`Hotlist image extraction failed for ${imageUrl}: ${(error as Error).message}`);
        return { candidates: [] as unknown[], sourceImageUrl: null as string | null };
      }
    }),
  );

  const candidates = perImageResults.flatMap((result) => result.candidates);
  const sourceImageUrls = perImageResults
    .map((result) => result.sourceImageUrl)
    .filter((url): url is string => url !== null);

  return { candidates, sourceImageUrls };
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

type PromptOverride = { systemPrompt?: string | null; userPrompt?: string | null };

const promptCache = new Map<string, { value: PromptOverride | null; expiresAt: number }>();
const PROMPT_CACHE_TTL_MS = 60_000;

async function getPromptOverride(env: Env, promptKey: string): Promise<PromptOverride | null> {
  const supabaseUrl = (env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) return null;

  const cached = promptCache.get(promptKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/ai_prompts?prompt_key=eq.${encodeURIComponent(promptKey)}&select=system_prompt,user_prompt&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
      },
    );
    if (!response.ok) return null;
    const rows = await response.json() as Array<{ system_prompt: string | null; user_prompt: string | null }>;
    const value: PromptOverride | null = rows[0]
      ? { systemPrompt: rows[0].system_prompt, userPrompt: rows[0].user_prompt }
      : null;
    promptCache.set(promptKey, { value, expiresAt: Date.now() + PROMPT_CACHE_TTL_MS });
    return value;
  } catch {
    return null;
  }
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

    if (new URL(req.url).pathname.replace(/\/+$/, "") === "/predict-match") {
      try {
        const body = (await req.json()) as PredictMatchRequest;
        const consultantText = (body.consultantText ?? "").trim();
        if (!consultantText) {
          return jsonResponse({ error: "consultantText is required" }, 400);
        }
        const roleTitle = (body.roleTitle ?? "").trim();
        const jobContext = body.jobContext ?? {};
        const model = (env.PARSER_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8").trim();
        const prompt = buildPredictMatchPrompt(roleTitle, jobContext, consultantText);

        let aiResult: unknown;
        let aiError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            aiResult = await env.AI.run(model, {
              messages: [
                { role: "system", content: PREDICT_MATCH_SYSTEM_PROMPT },
                { role: "user", content: prompt },
              ],
              temperature: 0.2,
              max_tokens: 800,
            });
            aiError = undefined;
            break;
          } catch (error) {
            aiError = error;
            if (attempt < 2 && isRateLimitError(error)) {
              await sleep(1000 * (attempt + 1));
              continue;
            }
            break;
          }
        }
        if (aiError) throw aiError;

        const rawText = (aiResult as Record<string, unknown>)?.response ?? aiResult;
        const parsed = parseModelText(rawText) as Record<string, unknown>;
        const categoriesRaw = Array.isArray(parsed?.categories) ? parsed.categories : [];
        const categories = categoriesRaw.map((item) => {
          const record = item as Record<string, unknown>;
          const max = Number(record.max) || 0;
          const earnedRaw = Number(record.earned);
          const earned = Number.isFinite(earnedRaw) ? Math.max(0, Math.min(max, earnedRaw)) : 0;
          return {
            label: String(record.label ?? "").trim() || "Category",
            earned,
            max,
            note: String(record.note ?? "").trim().slice(0, 160),
          };
        });
        const scoreFromCategories = categories.reduce((sum, category) => sum + category.earned, 0);
        const parsedScore = Number(parsed?.score);
        const score = Number.isFinite(parsedScore) ? Math.max(0, Math.min(100, Math.round(parsedScore))) : scoreFromCategories;
        const verdict = String(parsed?.verdict ?? "").trim()
          || (score >= 80 ? "Strong match" : score >= 60 ? "Good match" : score >= 40 ? "Moderate match" : "Weak match");

        return jsonResponse({ score, verdict, categories });
      } catch (error) {
        return jsonResponse({ error: (error as Error).message }, 500);
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
      const promptKey = route === "classify" ? "cf-job-classify" : route === "extract-hotlist" ? "cf-hotlist-extract" : "cf-job-extract";
      const override = await getPromptOverride(env, promptKey);

      const defaultSystemContent = route === "classify"
        ? "You route staffing-industry social posts into job demand, hotlist supply, or other. Respond with strict JSON only."
        : route === "extract-hotlist"
          ? "You extract available consultants from bench sales hotlists. Preserve each distinct candidate and respond with strict JSON only."
          : "You classify genuine job openings and extract structured fields. Be conservative and respond with strict JSON only.";
      const defaultInstructions = route === "classify"
        ? DEFAULT_CLASSIFY_INSTRUCTIONS
        : route === "extract-hotlist"
          ? DEFAULT_HOTLIST_EXTRACT_INSTRUCTIONS
          : DEFAULT_JOB_EXTRACT_INSTRUCTIONS;

      const systemContent = override?.systemPrompt?.trim() || defaultSystemContent;
      const instructions = override?.userPrompt?.trim() || defaultInstructions;

      const prompt = (body.prompt ?? "").trim() || (route === "classify"
        ? buildClassificationPrompt(jobs, instructions)
        : route === "extract-hotlist"
          ? buildHotlistPrompt(jobs, instructions)
          : buildJobPrompt(jobs, instructions));
      const model = (env.PARSER_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8").trim();

      // Hotlist posts can carry several candidates per post, which needs materially
      // more output room than a single job or a bare classification does.
      const maxTokens = route === "extract-hotlist" ? 4096 : route === "extract-job" ? 3500 : 2000;

      let aiResult: unknown;
      let aiError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
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
          if (attempt < 2 && isRateLimitError(error)) {
            await sleep(1000 * (attempt + 1));
            continue;
          }
          break;
        }
      }
      if (aiError) throw aiError;

      const rawText = (aiResult as Record<string, unknown>)?.response ?? aiResult;
      const parsed = parseModelText(rawText);
      const results = normalizeRows(parsed, jobs);

      if (results.length === 0) {
        return jsonResponse({ error: "Model returned no usable extraction rows", raw: rawText }, 422);
      }

      // Bench hotlists are often posted as a table screenshot with little or no
      // candidate detail in the text body, so the image is the authoritative
      // source when present — it replaces (rather than merges with) text-derived
      // candidates to avoid duplicating/hallucinating entries across the two.
      if (route === "extract-hotlist") {
        for (const result of results) {
          const job = jobs.find((candidate) => candidate.id === result.job_id);
          const imageUrls = job?.image_urls ?? [];
          if (imageUrls.length === 0 || result.is_hotlist === false) continue;

          const { candidates: imageCandidates, sourceImageUrls } = await extractCandidatesFromImages(env, imageUrls);
          if (imageCandidates.length === 0) continue;

          const reindexed = imageCandidates.map((candidate, index) => ({
            ...(candidate as Record<string, unknown>),
            candidate_index: index,
          }));
          result.candidates = reindexed;
          result.consultant_count = reindexed.length;
          result.post_scope = reindexed.length === 1 ? "single" : "multiple";
          result.source_image_urls = sourceImageUrls;
          if (result.is_hotlist == null) result.is_hotlist = true;
          if (result.confidence == null || Number(result.confidence) === 0) result.confidence = 0.9;
        }
      }

      return jsonResponse({ results });
    } catch (error) {
      return jsonResponse({ error: (error as Error).message }, 500);
    }
  },
};
