/**
 * AI Prompts Registry
 *
 * Central registry of all AI prompts used across the ProfilePush platform.
 * This powers the "AI Prompts" console in the Admin dashboard so engineers
 * can audit every prompt, its location, model, and purpose.
 */

export type PromptSource = 'supabase-function' | 'cloudflare-worker';

export interface AiPromptEntry {
  id: string;
  name: string;
  description: string;
  source: PromptSource;
  location: string;
  /** Function/route or handler name */
  handler: string;
  /** Model or model-setting used (if known) */
  model: string;
  /** The role/system instruction (if any) */
  systemPrompt?: string;
  /** The user prompt template (may contain placeholders) */
  userPrompt: string;
  /** Whether the prompt produces JSON output */
  jsonOutput: boolean;
  /** Sampling temperature used for this call (if explicitly set) */
  temperature?: number;
  /** Max output/completion tokens for this call (if explicitly set) */
  maxTokens?: number;
  /** Notes / caveats */
  notes?: string;
  /** Date the source file was last modified (YYYY-MM-DD), from git history */
  lastUpdated?: string;
}

export const AI_PROMPTS_REGISTRY: AiPromptEntry[] = [
  // ─── Supabase Edge Functions (Gemini) ───────────────────────────────
  {
    id: 'parse-resume',
    name: 'Parse Resume → JSON',
    description: 'Extracts a candidate profile from uploaded resume text or documents into strict JSON.',
    source: 'supabase-function',
    location: 'supabase/functions/parse-resume/index.ts',
    handler: 'parseResumeHandler',
    model: 'Gemini (gemini-2.x-flash lineage)',
    systemPrompt:
      'You are an expert ATS data extraction engine. Your objective is to parse raw, unstructured resume content and extract the candidate\u2019s information into a strict JSON format.',
    userPrompt:
      'Extract the candidate profile from the attached resume according to your system instructions and strict JSON schema.',
    jsonOutput: true,
    temperature: 0.1,
    notes: 'Supports PDF, DOCX, and plain-text resume input.',
    lastUpdated: '2026-07-27',
  },
  {
    id: 'bulk-parse-profiles',
    name: 'Bulk Parse Profiles (Sheet/Excel)',
    description: 'Parses every row of tabular bench-candidate data (Google Sheet / Excel) into structured candidate profiles.',
    source: 'supabase-function',
    location: 'supabase/functions/bulk-parse-profiles/index.ts',
    handler: 'bulkParseHandler',
    model: 'Gemini (gemini-2.x-flash lineage)',
    systemPrompt:
      `You are an expert HR/staffing data extraction engine. You receive raw tabular data (copied from a Google Sheet or Excel) representing bench candidates. Your job is to parse EVERY row into a structured candidate profile object.

Rules:
- Each row is one candidate. Output one object per row in the array.
- Map column data intelligently to the correct fields regardless of exact column header names.
- "candidate_name" = full name of the candidate/consultant.
- "target_role" = their role/title/technology/designation (e.g. "Java Developer", "React Frontend Engineer"). Infer from skills if not explicit.
- "core_skills" = comma-separated list of all technical skills, tools, languages, frameworks mentioned.
- "priority_skills" = the top 3-5 most important skills for their target role, comma-separated.
- "visa_status" = immigration status (H1B, GC, USC, OPT, CPT, H4 EAD, L1, L2, TN, etc.).
- "work_authorization" = employment/engagement type (C2C, W2, 1099, Full-time, Contract, etc.).
- "work_type" = Remote, Onsite, Hybrid, or combination.
- "preferred_locations" = cities/states they are open to work in, comma-separated.
- "desired_salary_min" and "desired_salary_max" = hourly rate or annual salary numbers only (no symbols). If a single rate is given, use it for both min and max.
- "years_experience" = total years of experience as integer.
- "relocation_open" = true if they mention willingness to relocate.
- "tax_terms" = C2C, W2, 1099, or combination.
- "availability" = when they can start (Immediate, 2 weeks, specific date, etc.).
- "location", "city", "state", "country" = current location fields.
- "phone" = phone number.
- "email" = email address.
- "linkedin_url" = LinkedIn profile URL.

If data for a field is not present in the row, return empty string for text, 0 for integers, false for booleans.
Parse ALL rows — do not skip any. If a row has minimal info, still create a profile with whatever is available.`,
    userPrompt:
      'Parse the following spreadsheet data (tab-separated, first row is headers) into an array of candidate profile objects. Return ALL candidates.',
    jsonOutput: true,
    temperature: 0.1,
    lastUpdated: '2026-07-27',
  },
  {
    id: 'rewrite-resume',
    name: 'Rewrite Resume',
    description: 'Rewrites a candidate\u2019s resume tailored to a target job as clean, ATS-optimized plain text.',
    source: 'supabase-function',
    location: 'supabase/functions/rewrite-resume/index.ts',
    handler: 'rewriteResumeHandler',
    model: 'Gemini (gemini-2.x-flash lineage)',
    userPrompt:
      "You are an expert resume writer. Rewrite the candidate's resume tailored specifically for the job below.\nProduce a complete, professional, ATS-optimized resume in clean plain text (no markdown symbols like **, ##, or --).\nUse clear section headers in ALL CAPS followed by a line of dashes.\nKeep it to 1-2 pages worth of content. Quantify achievements where possible. Mirror keywords from the job description.",
    jsonOutput: false,
    temperature: 0.4,
    maxTokens: 2048,
    lastUpdated: '2026-07-27',
  },
  {
    id: 'rewrite-field',
    name: 'Rewrite Resume Field',
    description: 'Rewrites a single resume section (e.g. summary, experience) tailored to a target job.',
    source: 'supabase-function',
    location: 'supabase/functions/rewrite-field/index.ts',
    handler: 'rewriteFieldHandler',
    model: 'Gemini (gemini-2.x-flash lineage)',
    userPrompt: 'Be concise, professional, and ATS-optimized. Use plain text — no markdown symbols.',
    jsonOutput: false,
    temperature: 0.5,
    maxTokens: 1024,
    notes: 'The opening sentence ("Rewrite ONLY the {field} section...") is generated in code and not editable here; this text is appended as style/quality guidance. Supports batch rewriting of multiple fields.',
    lastUpdated: '2026-07-27',
  },
  {
    id: 'suggest-priority-skills',
    name: 'Suggest Priority Skills',
    description: 'Suggests exactly 5 high-priority skills for a candidate profile to improve placement chances.',
    source: 'supabase-function',
    location: 'supabase/functions/suggest-priority-skills/index.ts',
    handler: 'suggestSkillsHandler',
    model: 'Gemini (gemini-2.x-flash lineage)',
    userPrompt:
      "You are a technical recruiter expert. Given a candidate's profile, suggest exactly 5 high-priority skills that would best match job postings and increase placement chances.",
    jsonOutput: false,
    lastUpdated: '2026-07-27',
  },
  {
    id: 'generate-search-ideas',
    name: 'Generate Search Ideas',
    description: 'Generates 8 diverse job search filter combinations for a candidate.',
    source: 'supabase-function',
    location: 'supabase/functions/generate-search-ideas/index.ts',
    handler: 'generateSearchIdeasHandler',
    model: 'Gemini (gemini-2.x-flash lineage)',
    userPrompt:
      'You are a job search strategist. Based on the candidate profile below, generate exactly 8 diverse and creative job search filter combinations they should try. Each idea should target a distinct angle: different job titles, industries, seniority levels, or specialisations.',
    jsonOutput: false,
    temperature: 0.8,
    maxTokens: 8192,
    lastUpdated: '2026-07-27',
  },
  {
    id: 'dashboard-summary',
    name: 'Dashboard Summary',
    description: 'Analyzes recruiter metrics and answers with exactly 5 bullet points (optionally answering a custom question).',
    source: 'supabase-function',
    location: 'supabase/functions/dashboard-summary/index.ts',
    handler: 'dashboardSummaryHandler',
    model: 'Gemini (gemini-2.x-flash lineage)',
    userPrompt:
      'You are a recruitment operations analyst. Analyze the metrics below and respond with EXACTLY 5 bullet points.\n\nRules:\n- Exactly 5 lines, each starting with "• "\n- Each point: one short sentence, max 10 words\n- Total response under 50 words\n- Be specific — use the actual numbers\n- Focus on what matters most: health, gaps, wins, risks, next action\n- If the user asked a question, answer it within the same 5-point format',
    jsonOutput: false,
    temperature: 0.7,
    maxTokens: 1024,
    notes: 'Supports an optional custom user question appended to the prompt.',
    lastUpdated: '2026-07-27',
  },
  {
    id: 'score-job-match',
    name: 'Score Job Match',
    description: 'Evaluates a candidate\u2019s fit for a job listing and returns a match score with breakdown.',
    source: 'supabase-function',
    location: 'supabase/functions/score-job-match/index.ts',
    handler: 'scoreJobMatchHandler',
    model: 'Gemini (gemini-2.x-flash lineage)',
    userPrompt: "You are an expert technical recruiter evaluating a candidate's fit for a job listing.",
    jsonOutput: true,
    temperature: 0.2,
    maxTokens: 4096,
    lastUpdated: '2026-07-31',
  },
  {
    id: 'bench-match-extract',
    name: 'Bench Match — Extract Job',
    description: 'Extracts structured data from a job description.',
    source: 'supabase-function',
    location: 'supabase/functions/bench-match/index.ts',
    handler: 'benchMatchExtract',
    model: 'Gemini (gemini-2.x-flash lineage)',
    userPrompt: 'You are an expert recruiter. Extract structured data from this job description.',
    jsonOutput: true,
    temperature: 0.1,
    maxTokens: 2048,
    lastUpdated: '2026-07-29',
  },
  {
    id: 'bench-match-score',
    name: 'Bench Match — Score Candidate',
    description: 'Evaluates a candidate\u2019s fit for a job listing and returns a score breakdown.',
    source: 'supabase-function',
    location: 'supabase/functions/bench-match/index.ts',
    handler: 'benchMatchScore',
    model: 'Gemini (gemini-2.x-flash lineage)',
    userPrompt: "You are an expert technical recruiter evaluating a candidate's fit for a job listing.",
    jsonOutput: true,
    temperature: 0.2,
    maxTokens: 4096,
    lastUpdated: '2026-07-29',
  },
  {
    id: 'bench-match-rank',
    name: 'Bench Match — Rank Top 20',
    description: 'Ranks candidates by fit for a job and returns the TOP 20 best matches.',
    source: 'supabase-function',
    location: 'supabase/functions/bench-match/index.ts',
    handler: 'benchMatchRank',
    model: 'Gemini (gemini-2.x-flash lineage)',
    userPrompt: 'You are an expert recruiter. Rank these candidates by fit for the job below. Return the TOP 20 best matches.',
    jsonOutput: true,
    temperature: 0.2,
    maxTokens: 4096,
    lastUpdated: '2026-07-29',
  },
  {
    id: 'radar-match',
    name: 'Radar Match — Extract Role Fields',
    description: 'Extracts structured role fields from each job posting for radar matching.',
    source: 'supabase-function',
    location: 'supabase/functions/radar-match/index.ts',
    handler: 'radarMatchExtract',
    model: 'Gemini (gemini-2.x-flash lineage)',
    userPrompt: 'Extract structured fields from each job posting.',
    jsonOutput: true,
    temperature: 0.1,
    notes: 'The per-field extraction schema and the trailing "Return ONLY a JSON array" directive are generated in code and not editable here.',
    lastUpdated: '2026-08-09',
  },
  {
    id: 'radar-enrich',
    name: 'Radar Enrich — Extract Job Data',
    description: 'Extracts structured data from job postings for enrichment.',
    source: 'supabase-function',
    location: 'supabase/functions/radar-enrich/index.ts',
    handler: 'radarEnrichHandler',
    model: 'Gemini (gemini-2.x-flash lineage)',
    userPrompt: 'Extract structured data from these job postings.',
    jsonOutput: true,
    temperature: 0.1,
    notes: 'The per-field JSON schema and the trailing "Return ONLY the JSON array" directive are generated in code and not editable here.',
    lastUpdated: '2026-07-27',
  },

  // ─── Cloudflare Workers (Workers AI / Llama) ────────────────────────
  {
    id: 'cf-job-classify',
    name: 'CF — Classify Job/Consultant Post',
    description: 'Classifies a social post into job demand, hotlist supply, or other.',
    source: 'cloudflare-worker',
    location: 'cloudflare/social-job-parser/src/index.ts',
    handler: 'POST /classify',
    model: '@cf/meta/llama-3.1-8b-instruct-fp8',
    systemPrompt:
      'You route staffing-industry social posts into job demand, hotlist supply, or other. Respond with strict JSON only.',
    userPrompt:
      `Classify each social-media post into exactly one category. Return ONLY valid JSON, no markdown.
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
- "Senior Java developer open to work; contact me" describing one person's own resume => other, not hotlist.`,
    jsonOutput: true,
    temperature: 0.1,
    maxTokens: 2000,
    notes: 'The trailing field-list sentence ("Preserve post_id exactly. Include: ...") and POSTS data are generated in code and not editable here.',
    lastUpdated: '2026-08-12',
  },
  {
    id: 'cf-job-extract',
    name: 'CF — Extract Job Fields',
    description: 'Classifies a post as a genuine job and extracts structured job fields.',
    source: 'cloudflare-worker',
    location: 'cloudflare/social-job-parser/src/index.ts',
    handler: 'POST /extract-job',
    model: '@cf/meta/llama-3.1-8b-instruct-fp8',
    systemPrompt:
      'You classify genuine job openings and extract structured fields. Be conservative and respond with strict JSON only.',
    userPrompt:
      `Classify each input as a genuine job posting and extract structured fields. Return ONLY valid JSON, no markdown.
Return one result per input job and preserve job_id from input. If a field is unknown, use null (or [] for arrays).
Set is_job_posting=true only when the text advertises a specific open role with enough actionable details to apply. Reject resumes, candidate marketing, generic staffing promotions, discussions, event posts, news, and vague hiring claims.`,
    jsonOutput: true,
    temperature: 0.1,
    maxTokens: 3500,
    notes: 'The trailing field-list sentence ("For each job include: ...") and JOBS data are generated in code and not editable here.',
    lastUpdated: '2026-08-12',
  },
  {
    id: 'cf-hotlist-extract',
    name: 'CF — Extract Hotlist Consultants',
    description: 'Extracts every distinct available consultant advertised in a hotlist post.',
    source: 'cloudflare-worker',
    location: 'cloudflare/social-job-parser/src/index.ts',
    handler: 'POST /extract-hotlist',
    model: '@cf/meta/llama-3.1-8b-instruct-fp8',
    systemPrompt:
      'You extract available consultants from bench sales hotlists. Preserve each distinct candidate and respond with strict JSON only.',
    userPrompt:
      `Verify the post is supply-side candidate marketing, then extract every distinct available consultant or candidate advertised in each hotlist post. Return ONLY valid JSON, no markdown.
Return one result per input post and preserve post_id exactly. Do not combine candidates. Do not invent names or details.
Set is_hotlist=true only when the author explicitly represents available consultants/candidates and is seeking requirements or opportunities for them. Set is_hotlist=false for open jobs seeking candidates, even when they mention C2C, visas, experience, locations, or multiple roles. When false, return candidates=[].
Determine whether the post advertises one consultant or multiple consultants before extracting:
- One advertised consultant => consultant_count=1, post_scope="single", and exactly one candidates item.
- Multiple advertised consultants => consultant_count equals the number of distinct advertised consultant entries, post_scope="multiple", and exactly one candidates item per entry.
- Never combine separate list entries into one candidate. If two consultants have the same role title but different experience, visa, location, name, or other attributes, preserve them as separate candidates.
- Do not split one consultant into multiple candidates merely because multiple skills or preferred locations are listed.
- Recruiter name, email, phone, and company describe the post owner and must be returned once at the result level, never guessed separately per candidate.`,
    jsonOutput: true,
    temperature: 0.1,
    maxTokens: 4096,
    notes: 'The trailing field-list sentences ("For each result include: ...") and HOTLIST POSTS data are generated in code and not editable here.',
    lastUpdated: '2026-08-12',
  },
  {
    id: 'cf-queue-job-classify',
    name: 'CF — Queue Job Classify',
    description: 'Classifies a queue message as a genuine job posting and extracts structured fields.',
    source: 'cloudflare-worker',
    location: 'cloudflare/social-job-queue-consumer/src/index.ts',
    handler: 'buildPrompt(queueMessage)',
    model: '@cf/meta/llama-3.1-8b-instruct-fp8',
    systemPrompt: 'You classify genuine job openings and extract structured fields. Be conservative and respond with strict JSON only.',
    userPrompt:
      'Classify this input as a genuine job posting and extract structured fields. Return ONLY valid JSON, no markdown.\nPreserve job_id exactly as provided. If a field is unknown, use null (or [] for arrays).\nSet is_job_posting=true only when the text advertises a specific open role with enough actionable details to apply. Reject resumes, candidate marketing, generic staffing promotions, discussions, event posts, news, and vague hiring claims.\nInclude: job_id, is_job_posting (boolean), confidence (0 to 1), rejection_reason (string or null), role_title, company_name, core_skills (array max 12), years_experience (number or null), visa_types (array), employment_type (C2C/W2/Full-time/Contract/Any), work_type (Remote/Hybrid/Onsite/Unknown), locations (array), hourly_rate_min (number or null), hourly_rate_max (number or null).',
    jsonOutput: true,
    temperature: 0.1,
    maxTokens: 1200,
    lastUpdated: '2026-08-13',
  },
  {
    id: 'cf-ask-vendor-email',
    name: 'CF — Ask Vendor Email (Missing Details)',
    description: 'Writes a short, transactional email to a vendor asking for missing job details.',
    source: 'cloudflare-worker',
    location: 'cloudflare/social-job-queue-consumer/src/index.ts',
    handler: 'handleAskVendorEmailCopy (missing_details)',
    model: '@cf/meta/llama-3.1-8b-instruct-fp8',
    systemPrompt:
      'You are a fast-paced, highly transactional IT bench sales recruiter. Your goal is to write a strictly text-based, plain-text email to a vendor asking for missing details about a job they just posted. Rules: Zero Fluff, Extreme Brevity (<40 words), The Hook, The Ask, Tone: Casual/urgent/professional. Return strict JSON with "subject" and "email_content".',
    userPrompt:
      'Job Title: {jobTitle}\nJob Location: {jobLocation}\nVendor Name: {vendorName}\nMissing Detail to Ask For: {missingDataType}\nSender Name: {recruiterFirstName}',
    jsonOutput: true,
    temperature: 0.4,
    maxTokens: 250,
    notes: 'Enforced <40 words. Invoked from the ask-ai-vendor-email edge function.',
    lastUpdated: '2026-08-13',
  },
  {
    id: 'cf-ask-resume-email',
    name: 'CF — Ask Resume Email',
    description: 'Writes a short, transactional email to a bench sales recruiter requesting a consultant\u2019s resume.',
    source: 'cloudflare-worker',
    location: 'cloudflare/social-job-queue-consumer/src/index.ts',
    handler: 'handleAskVendorEmailCopy (resume)',
    model: '@cf/meta/llama-3.1-8b-instruct-fp8',
    systemPrompt:
      'You are a fast-paced, highly transactional IT bench sales recruiter. Your goal is to write a strictly text-based, plain-text email to a fellow bench-sales recruiter asking them to share the resume/CV of a specific consultant… Rules: Zero Fluff, Extreme Brevity (<40 words), The Hook, The Ask, Tone: Casual/urgent/professional. Return strict JSON with "subject" and "email_content".',
    userPrompt:
      'Consultant Role: {jobTitle}\nRecruiter Name: {vendorName}\nSender Name: {recruiterFirstName}',
    jsonOutput: true,
    temperature: 0.4,
    maxTokens: 250,
    notes: 'Enforced <40 words.',
    lastUpdated: '2026-08-13',
  },
  {
    id: 'cf-vendor-reply',
    name: 'CF — Process Vendor Reply',
    description: 'Privacy-cleans a vendor email reply and extracts explicit job details (verified answers).',
    source: 'cloudflare-worker',
    location: 'cloudflare/social-job-queue-consumer/src/index.ts',
    handler: 'handleVendorReply',
    model: '@cf/meta/llama-3.1-8b-instruct-fp8',
    systemPrompt:
      'Privacy-clean vendor replies without changing their meaning, and extract explicit job details. Never infer facts. Return strict JSON only.',
    userPrompt:
      "Process this vendor email reply and return strict JSON only, without markdown.\nCreate display_text containing only the vendor's substantive reply. Remove greetings, signatures, names, email addresses, company or agency names, contact details, email headers, disclaimers, and quoted prior messages. Preserve the original wording, order, intent, facts, and tone of the remaining reply. Do not summarize, infer, add facts, or rewrite beyond the minimum grammar needed after removals.\nAlso extract only explicitly stated job details. Use null or [] when absent. Do not infer or guess. Include: display_text, confidence (0 to 1), experience_years, employment_type, work_type, visa_types, locations, skills, hourly_rate_min, hourly_rate_max, salary_range.",
    jsonOutput: true,
    temperature: 0,
    maxTokens: 1200,
    notes: 'Confidence threshold 0.75. The trailing "originally requested fields" line and email data (subject/from/body) are generated in code and not editable here.',
    lastUpdated: '2026-08-13',
  },
  {
    id: 'cf-hotlist-vendor-reply',
    name: 'CF — Process Hotlist Vendor Reply',
    description: 'Privacy-cleans a vendor email reply to a hotlist Ask request into a display-only summary.',
    source: 'cloudflare-worker',
    location: 'cloudflare/social-job-queue-consumer/src/index.ts',
    handler: 'handleHotlistVendorReply',
    model: '@cf/meta/llama-3.1-8b-instruct-fp8',
    systemPrompt: 'Privacy-clean vendor replies without changing their meaning. Return strict JSON only.',
    userPrompt:
      "Process this vendor email reply and return strict JSON only, without markdown.\nCreate display_text containing only the vendor's substantive reply. Remove greetings, signatures, names, email addresses, company or agency names, contact details, email headers, disclaimers, and quoted prior messages. Preserve the original wording, order, intent, facts, and tone of the remaining reply. Do not summarize, infer, add facts, or rewrite beyond the minimum grammar needed after removals.\nReturn strict JSON with exactly one key: \"display_text\".",
    jsonOutput: true,
    temperature: 0,
    maxTokens: 800,
    notes: 'The Subject/From/Email data lines are generated in code and not editable here.',
    lastUpdated: '2026-08-13',
  },
];

export const AI_PROMPT_TOTAL = AI_PROMPTS_REGISTRY.length;

export function getAiPromptCountBySource() {
  return AI_PROMPTS_REGISTRY.reduce(
    (acc, entry) => {
      acc[entry.source] = (acc[entry.source] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<PromptSource, number>>,
  );
}