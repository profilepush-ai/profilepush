export interface Env {
  AI: Ai;
  HOTLIST_IMAGES: R2Bucket;
  WORKER_AUTH_TOKEN?: string;
  // Second accepted token, additive to WORKER_AUTH_TOKEN — lets a new caller
  // (job-application-screening) authenticate without needing to know or
  // rotate the original shared secret every other caller already uses.
  SCREENING_WORKER_TOKEN?: string;
  PARSER_MODEL?: string;
  PARSER_VISION_MODEL?: string;
  WHISPER_MODEL?: string;
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

type ChatDraftDetail = { label: string; value: string };
type ChatDraftMessage = { direction: "outbound" | "inbound"; text: string };

type GenerateChatMessageRequest = {
  title?: string;
  isHotlist?: boolean;
  details?: ChatDraftDetail[];
  recentMessages?: ChatDraftMessage[];
  instruction?: string;
};

const CHAT_DRAFT_SYSTEM_PROMPT = "You write short, natural in-app chat messages between staffing recruiters and bench sales vendors. This is always recruiter-to-recruiter business outreach about a job requirement or an available consultant — never a candidate interview and never a question about the recipient's own skills or background. Be concise, professional, and specific to the context given. Never use markdown, a subject line, or a signature block. Respond with only the message text.";

type ScreeningTurn = { question: string; answer: string };

type GenerateScreeningQuestionRequest = {
  resumeSummary?: string;
  jobTitle?: string;
  jobDescription?: string;
  priorTurns?: ScreeningTurn[];
  forceConclude?: boolean;
  maxTurns?: number;
};

type ParseResumeTextRequest = {
  resumeText?: string;
  systemPrompt?: string;
  userPrompt?: string;
};

const SCREENING_QUESTION_SYSTEM_PROMPT = "You are an AI recruiter conducting a short, adaptive video screening interview for a staffing job requirement. Ask ONE focused, specific question at a time to verify the candidate genuinely has the experience their resume claims and that they fit this specific job's requirements — dig into specifics (a real example, a number, a tool, a decision they made) rather than generic questions a rehearsed answer could dodge. Each new question should build on what the candidate just said, not repeat ground already covered. Keep every question to one or two sentences, plain spoken language (this will be read aloud/answered on camera), no markdown. Respond with strict JSON only.";

function buildScreeningQuestionPrompt(
  resumeSummary: string,
  jobTitle: string,
  jobDescription: string,
  priorTurns: ScreeningTurn[],
  maxTurns: number,
  forceConclude: boolean,
) {
  const historyBlock = priorTurns.length > 0
    ? priorTurns.map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer.slice(0, 1500)}`).join("\n\n")
    : "(This is the first question — no answers yet.)";

  const header = `JOB: ${jobTitle || "Untitled role"}
JOB REQUIREMENTS: ${(jobDescription || "Not specified").slice(0, 3000)}

CANDIDATE RESUME SUMMARY: ${(resumeSummary || "Not available").slice(0, 3000)}

INTERVIEW SO FAR (${priorTurns.length} of up to ${maxTurns} questions asked):
${historyBlock}`;

  if (forceConclude) {
    return `${header}

The interview has reached its question limit and MUST end now — you do not have the option to ask another question.

Return ONLY valid JSON in exactly this shape, no markdown, no explanation:
{"done": true, "summary": string (3-5 sentences, an honest, specific assessment of the candidate's fit for this job based on their answers — call out both strengths and any red flags or vague answers), "score": number (0-100 fit score)}`;
  }

  return `${header}

${priorTurns.length >= maxTurns - 1
    ? "This is the LAST question or the interview should now be wrapped up — if you have enough to assess fit, set done=true and write a short summary + score instead of another question."
    : "Ask the next question."}

Return ONLY valid JSON in exactly one of these two shapes, no markdown, no explanation:
{"done": false, "question": string}
or, only once you have enough answers to judge fit (never before at least 2 answered questions):
{"done": true, "summary": string (3-5 sentences, an honest, specific assessment of the candidate's fit for this job based on their answers — call out both strengths and any red flags or vague answers), "score": number (0-100 fit score)}`;
}

function buildChatDraftPrompt(
  title: string,
  isHotlist: boolean,
  details: ChatDraftDetail[],
  recentMessages: ChatDraftMessage[],
  instruction: string,
) {
  const detailLines = details.length > 0
    ? details.map((d) => `${d.label}: ${d.value}`).join(", ")
    : "Not specified";
  const historyBlock = recentMessages.length > 0
    ? recentMessages.map((m) => `${m.direction === "outbound" ? "Me" : "Them"}: ${m.text.slice(0, 500)}`).join("\n")
    : "(No messages yet — this will be the opening message.)";
  const goal = isHotlist
    ? `"Me" has a client requirement and wants to REQUEST this consultant: ask whether they're still available, and ask the recipient (the bench recruiter who posted them) to share their updated resume and current rate.`
    : `"Me" is a recruiter who wants to SUBMIT a candidate for this job: state that they have a strong-fit consultant ready, and ask what's needed to submit — e.g. resume format, rate expectations, or visa requirement.`;

  return `${isHotlist ? "CONSULTANT" : "JOB"}: ${title || "this opportunity"}
KEY DETAILS: ${detailLines}

CONVERSATION SO FAR:
${historyBlock}
${instruction ? `\nSPECIFIC INSTRUCTION FROM THE USER: ${instruction}` : ""}

GOAL: ${goal}
${recentMessages.length > 0 ? "Continue the conversation naturally toward this goal, referencing what was just discussed." : "Write the opening message toward this goal."}
Keep it to ONE short sentence, under 25 words, plain text, no greeting placeholders like [Name]. Do not ask the recipient about their own experience, skills, or background — they are the poster/vendor, not a candidate. Do not open with throat-clearing like "I'm reaching out about...", "I wanted to touch base regarding...", or "I hope this finds you well" — start directly with the ask itself, e.g. "Is ${title || "this role"} still open?" or "Is this consultant still available?".

Message:`;
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

const RESUME_PARSE_SYSTEM_PROMPT =
  "You are an expert ATS data extraction engine. Your objective is to parse raw, " +
  "unstructured resume text and extract the candidate's information into a strict JSON object. " +
  "Output ONLY valid JSON matching the exact schema requested, no markdown, no explanation. " +
  "If a specific piece of information cannot be found, return an empty string for string fields, " +
  "0 for the years_experience field, and an empty array for array fields. " +
  "Do not guess, hallucinate, or infer data that is not explicitly written, except for 'target_role' " +
  "which should be inferred from the most recent job title or career summary objective. " +
  "For core_skills, extract all distinct technical skills, tools, languages, frameworks, and " +
  "certifications mentioned anywhere in the resume. " +
  "IMPORTANT: candidate_name is almost always the very first line of the resume (a person's " +
  "full name, not a section heading) — extract it even if no explicit 'Name:' label is present. " +
  "Similarly, always scan for an Education section (institution, degree, field of study) and a " +
  "Work Experience/Employment section (company, job title, dates) even when they aren't the first " +
  "thing in the document — these are core resume sections, not optional details.";

const RESUME_PARSE_DEFAULT_USER_PROMPT = `Extract the candidate profile from the resume text below into exactly this JSON shape (all keys required):
{"candidate_name": string, "target_role": string, "location": string, "city": string, "state": string, "zip_code": string, "country": string, "phone": string, "email": string, "linkedin_url": string, "github_url": string, "portfolio_url": string, "years_experience": number, "core_skills": string[], "education": [{"institution": string, "degree": string, "field": string, "start_year": string, "end_year": string, "gpa": string}], "experience": [{"company": string, "title": string, "location": string, "start_date": string, "end_date": string, "current": boolean, "description": string}]}`;

// Bracket/string-aware scanner mirroring recoverTruncatedJsonArray, but for a
// single top-level object — resume parsing returns one object, not an array,
// so a truncated response (model hit max_tokens mid-object) needs its own
// recovery: find the last fully-closed nested value before the cut, then
// close the top-level object there instead of discarding the whole response.
function recoverTruncatedJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in model output");

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
      if (depth === 1 && (char === "}" || char === "]")) lastCompleteEnd = i;
      if (depth === 0) { lastCompleteEnd = i; break; }
    }
  }

  if (lastCompleteEnd === -1) throw new Error("No complete field found in model output");
  return JSON.parse(`${text.slice(start, lastCompleteEnd + 1)}}`);
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Workers AI has no equivalent of Gemini's responseSchema enforcement, so the
// model can omit fields or use the wrong type — normalize to the exact shape
// every caller of parse-resume (ProfilesDirectory.tsx, process-job-application)
// already relies on, rather than passing whatever the model happened to return.
function normalizeResumeFields(parsed: Record<string, unknown>): Record<string, unknown> {
  const education = Array.isArray(parsed.education) ? parsed.education : [];
  const experience = Array.isArray(parsed.experience) ? parsed.experience : [];
  const coreSkills = Array.isArray(parsed.core_skills)
    ? (parsed.core_skills as unknown[]).map(asStr).filter(Boolean)
    : [];

  return {
    candidate_name: asStr(parsed.candidate_name),
    target_role: asStr(parsed.target_role),
    location: asStr(parsed.location),
    city: asStr(parsed.city),
    state: asStr(parsed.state),
    zip_code: asStr(parsed.zip_code),
    country: asStr(parsed.country),
    phone: asStr(parsed.phone),
    email: asStr(parsed.email),
    linkedin_url: asStr(parsed.linkedin_url),
    github_url: asStr(parsed.github_url),
    portfolio_url: asStr(parsed.portfolio_url),
    years_experience: Number.isFinite(Number(parsed.years_experience)) ? Math.max(0, Math.round(Number(parsed.years_experience))) : 0,
    core_skills: coreSkills,
    education: education.map((e) => {
      const entry = (e ?? {}) as Record<string, unknown>;
      return {
        institution: asStr(entry.institution), degree: asStr(entry.degree), field: asStr(entry.field),
        start_year: asStr(entry.start_year), end_year: asStr(entry.end_year), gpa: asStr(entry.gpa),
      };
    }),
    experience: experience.map((e) => {
      const entry = (e ?? {}) as Record<string, unknown>;
      return {
        company: asStr(entry.company), title: asStr(entry.title), location: asStr(entry.location),
        start_date: asStr(entry.start_date), end_date: asStr(entry.end_date),
        current: entry.current === true, description: asStr(entry.description),
      };
    }),
  };
}

function parseResumeModelText(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") throw new Error("Model returned a non-string response");
  const trimmed = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed);
  } catch (parseError) {
    parsed = recoverTruncatedJsonObject(trimmed);
  }
  return normalizeResumeFields(parsed);
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
    const expectedScreening = (env.SCREENING_WORKER_TOKEN ?? "").trim();
    if (expected) {
      const actual = getBearerToken(req);
      if (!actual || (actual !== expected && (!expectedScreening || actual !== expectedScreening))) {
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

    if (new URL(req.url).pathname.replace(/\/+$/, "") === "/generate-chat-message") {
      try {
        const body = (await req.json()) as GenerateChatMessageRequest;
        const title = (body.title ?? "").trim().slice(0, 300);
        const isHotlist = Boolean(body.isHotlist);
        const details = Array.isArray(body.details) ? body.details.slice(0, 10) : [];
        const recentMessages = Array.isArray(body.recentMessages) ? body.recentMessages.slice(-8) : [];
        const instruction = (body.instruction ?? "").trim().slice(0, 300);

        const prompt = buildChatDraftPrompt(title, isHotlist, details, recentMessages, instruction);
        const model = (env.PARSER_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8").trim();

        let aiResult: unknown;
        let aiError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            aiResult = await env.AI.run(model, {
              messages: [
                { role: "system", content: CHAT_DRAFT_SYSTEM_PROMPT },
                { role: "user", content: prompt },
              ],
              temperature: 0.4,
              max_tokens: 120,
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
        const message = String(rawText ?? "").replace(/^```[\s\S]*?```$/g, "").trim().slice(0, 1200);
        if (!message) return jsonResponse({ error: "Model returned an empty message" }, 422);

        return jsonResponse({ message });
      } catch (error) {
        return jsonResponse({ error: (error as Error).message }, 500);
      }
    }

    if (new URL(req.url).pathname.replace(/\/+$/, "") === "/generate-screening-question") {
      try {
        const body = (await req.json()) as GenerateScreeningQuestionRequest;
        const jobTitle = (body.jobTitle ?? "").trim().slice(0, 300);
        const jobDescription = (body.jobDescription ?? "").trim();
        const resumeSummary = (body.resumeSummary ?? "").trim();
        const priorTurns = Array.isArray(body.priorTurns) ? body.priorTurns.slice(0, 10) : [];
        const maxTurns = Math.min(6, Math.max(2, Number(body.maxTurns) || 5));
        const forceConclude = Boolean(body.forceConclude);

        const prompt = buildScreeningQuestionPrompt(resumeSummary, jobTitle, jobDescription, priorTurns, maxTurns, forceConclude);
        const model = (env.PARSER_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8").trim();

        let aiResult: unknown;
        let aiError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            aiResult = await env.AI.run(model, {
              messages: [
                { role: "system", content: SCREENING_QUESTION_SYSTEM_PROMPT },
                { role: "user", content: prompt },
              ],
              temperature: 0.5,
              max_tokens: 500,
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
        const parsed = parseModelText(rawText) as { done?: boolean; question?: string; summary?: string; score?: number };

        // forceConclude means the turn cap has been reached — the interview
        // ends here no matter what the model returned, so it can never run
        // past maxTurns even if the model ignores the "must end now" prompt.
        if (parsed?.done || forceConclude) {
          const summary = String(parsed?.summary ?? "").trim().slice(0, 2000)
            || "The candidate completed the screening, but an automatic summary could not be generated.";
          const score = Math.max(0, Math.min(100, Math.round(Number(parsed?.score) || 0)));
          return jsonResponse({ done: true, summary, score });
        }

        const question = String(parsed?.question ?? "").trim().slice(0, 500);
        if (!question) return jsonResponse({ error: "Model returned an empty question" }, 422);
        return jsonResponse({ done: false, question });
      } catch (error) {
        return jsonResponse({ error: (error as Error).message }, 500);
      }
    }

    if (new URL(req.url).pathname.replace(/\/+$/, "") === "/transcribe-screening-audio") {
      try {
        const buffer = await req.arrayBuffer();
        if (buffer.byteLength === 0) return jsonResponse({ error: "Empty audio" }, 400);

        const model = (env.WHISPER_MODEL ?? "@cf/openai/whisper-large-v3-turbo").trim();
        // This model's input schema wants audio as a base64 string, not a raw
        // byte array/binary (confirmed empirically — the array/binary shapes
        // both 400 with a schema type-mismatch error). Encoded via a manual
        // byte loop rather than String.fromCharCode(...bytes) to avoid a
        // call-stack blowup on larger clips.
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64Audio = btoa(binary);

        let aiResult: unknown;
        let aiError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            aiResult = await env.AI.run(model, { audio: base64Audio });
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

        const text = String((aiResult as Record<string, unknown>)?.text ?? "").trim();
        return jsonResponse({ text });
      } catch (error) {
        return jsonResponse({ error: (error as Error).message }, 500);
      }
    }

    if (new URL(req.url).pathname.replace(/\/+$/, "") === "/parse-resume-text") {
      try {
        const body = (await req.json()) as ParseResumeTextRequest;
        const resumeText = (body.resumeText ?? "").trim().slice(0, 20000);
        if (!resumeText) return jsonResponse({ error: "resumeText is required" }, 400);

        const systemPrompt = (body.systemPrompt ?? "").trim() || RESUME_PARSE_SYSTEM_PROMPT;
        const userPrompt = (body.userPrompt ?? "").trim() || RESUME_PARSE_DEFAULT_USER_PROMPT;
        const model = (env.PARSER_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8").trim();

        let aiResult: unknown;
        let aiError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            aiResult = await env.AI.run(model, {
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `${userPrompt}\n\n--- RESUME TEXT ---\n${resumeText}\n--- END ---` },
              ],
              temperature: 0.1,
              max_tokens: 3000,
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
        let parsed: Record<string, unknown>;
        try {
          parsed = parseResumeModelText(rawText);
        } catch (error) {
          return jsonResponse({ error: `Model returned invalid JSON: ${(error as Error).message}` }, 502);
        }

        return jsonResponse(parsed);
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
