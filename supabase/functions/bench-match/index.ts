import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getPromptOverride } from "../_shared/prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];

const DEFAULT_PARSE_INSTRUCTIONS = "You are an expert recruiter. Extract structured data from this job description.";
const DEFAULT_MATCH_INSTRUCTIONS = "You are an expert technical recruiter evaluating a candidate's fit for a job listing.";
const DEFAULT_RANK_INSTRUCTIONS = "You are an expert recruiter. Rank these candidates by fit for the job below. Return the TOP 20 best matches.";

function normalizeEmploymentType(value: string): string {
  const text = (value ?? "").toLowerCase().trim();
  if (!text) return "";
  if (/\b(c2c|corp[- ]to[- ]corp)\b/.test(text)) return "C2C";
  if (/\b(w2)\b/.test(text)) return "W2";
  if (/\b(1099)\b/.test(text)) return "1099";
  if (/\b(any|open to all|any employment type)\b/.test(text)) return "Any";
  return "";
}

function extractEmploymentTypeFromDescription(rawDescription: string): string {
  const text = rawDescription ?? "";
  const inferred = normalizeEmploymentType(text);
  if (inferred) return inferred;

  const match = text.match(/\b(c2c|w2|1099)\b/i);
  if (!match) return "";
  return normalizeEmploymentType(match[0]);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json();
    const { action, account_id: bodyAccountId = null } = body;

    // Resolve user/account from auth header
    let userId: string | null = null;
    let accountId: string | null = bodyAccountId;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      try {
        const userClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data: { user } } = await userClient.auth.getUser();
        userId = user?.id ?? null;
        if (userId && !accountId) {
          const { data: member } = await supabase
            .from("account_members")
            .select("account_id")
            .eq("user_id", userId)
            .limit(1)
            .maybeSingle();
          accountId = member?.account_id ?? null;
        }
      } catch { /* non-fatal */ }
    }

    // Credit guard for AI actions
    if (accountId && (action === "match" || action === "find_candidates" || action === "parse")) {
      const { data: hasFunds } = await supabase.rpc("check_credit_balance", {
        p_account_id: accountId,
        p_min_balance: 0.001,
      });
      if (hasFunds === false) {
        return new Response(JSON.stringify({ error: "Insufficient credits. Please top up your account." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (action === "parse") {
      const { raw_description } = body;
      if (!raw_description || raw_description.trim().length < 20) {
        throw new Error("Job description is too short");
      }

      const parseOverride = await getPromptOverride(supabase, "bench-match-extract");
      const parseInstructions = parseOverride?.userPrompt?.trim() || DEFAULT_PARSE_INSTRUCTIONS;

      const prompt = `${parseInstructions}

JOB DESCRIPTION:
${raw_description.slice(0, 4000)}

Return ONLY a valid JSON object (no markdown):
{
  "title": "<job title>",
  "company": "<company name or empty string if not found>",
  "location": "<location or empty string>",
  "skills": ["<skill1>", "<skill2>", ...up to 10 key skills],
  "experience_years": <integer or null>,
  "employment_type": "<C2C|W2|1099|Any or empty string>",
  "summary": "<2-3 sentence summary of the role and key requirements>"
}`;

      const geminiPayload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              title:            { type: "STRING" },
              company:          { type: "STRING" },
              location:         { type: "STRING" },
              skills:           { type: "ARRAY", items: { type: "STRING" } },
              experience_years: { type: "INTEGER", nullable: true },
              employment_type:  { type: "STRING" },
              summary:          { type: "STRING" },
            },
            required: ["title", "company", "location", "skills", "employment_type", "summary"],
          },
        },
      };

      const { parsed, usedModel, usageMetadata } = await callGeminiWithMeta(GEMINI_API_KEY, geminiPayload);
      const inferredEmploymentType = extractEmploymentTypeFromDescription(raw_description);
      const modelEmploymentType = String(parsed.employment_type ?? "").trim();
      const normalizedModelEmploymentType = normalizeEmploymentType(modelEmploymentType);

      parsed.employment_type = normalizedModelEmploymentType || inferredEmploymentType || modelEmploymentType || "";

      // Log usage
      logUsage(supabase, userId, accountId, "bench-match/parse", usedModel, usageMetadata);

      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (action === "match") {
      const { profile_id, job_post_id } = body;
      if (!profile_id || !job_post_id) throw new Error("profile_id and job_post_id required");

      // Fetch profile
      const { data: profile, error: profileErr } = await supabase
        .from("profiles").select("*").eq("id", profile_id).single();
      if (profileErr || !profile) throw new Error("Profile not found");

      // Fetch job post
      const { data: jobPost, error: jobErr } = await supabase
        .from("external_job_posts").select("*").eq("id", job_post_id).single();
      if (jobErr || !jobPost) throw new Error("Job post not found");

      const experience = Array.isArray(profile.experience) ? profile.experience : [];
      const education = Array.isArray(profile.education) ? profile.education : [];

      const expSummary = experience.length > 0
        ? experience.slice(0, 4).map((e: Record<string, string>) =>
            `${e.title ?? ""} at ${e.company ?? ""} (${e.start_date ?? ""}–${e.current ? "Present" : (e.end_date ?? "")}): ${(e.description ?? "").slice(0, 200)}`
          ).join("\n")
        : "No work history provided";

      const eduSummary = education.length > 0
        ? education.slice(0, 2).map((e: Record<string, string>) =>
            `${e.degree ?? ""} in ${e.field ?? ""} from ${e.institution ?? ""}`
          ).join(", ")
        : "No education provided";

      const matchOverride = await getPromptOverride(supabase, "bench-match-score");
      const matchInstructions = matchOverride?.userPrompt?.trim() || DEFAULT_MATCH_INSTRUCTIONS;

      const prompt = `${matchInstructions}

CANDIDATE PROFILE:
- Name: ${profile.candidate_name ?? "Unknown"}
- Target Role: ${profile.target_role ?? "Not specified"}
- Core Skills: ${profile.core_skills ?? "Not specified"}
- Years of Experience: ${profile.years_experience ?? "Unknown"}
- Visa Status: ${profile.visa_status ?? "Not specified"}
- Work Type: ${profile.work_type ?? "Not specified"}
- Preferred Locations: ${profile.preferred_locations ?? "Not specified"}
- Hourly Rate: ${profile.desired_salary_min ?? "?"} - ${profile.desired_salary_max ?? "?"}/hr
- Relocation Open: ${profile.relocation_open ? "Yes" : "No"}
- Work History:
${expSummary}
- Education: ${eduSummary}

JOB DETAILS:
- Title: ${jobPost.title || "Unknown"}
- Company: ${jobPost.company || "Unknown"}
- Location: ${jobPost.location || "Not specified"}
- Required Skills: ${(jobPost.skills || []).join(", ")}
- Experience Required: ${jobPost.experience_years ? `${jobPost.experience_years} years` : "Not specified"}
- Employment Type: ${jobPost.employment_type || "Not specified"}
- Job Description:
${(jobPost.raw_description ?? "").slice(0, 2000)}

Return ONLY a valid JSON object (no markdown):
{
  "score": <integer 0-100>,
  "summary": "<1 sentence, max 20 words, describing overall fit>",
  "strengths": ["<3-5 words>"],
  "gaps": ["<3-5 words>"],
  "optimization_points": [
    "<specific actionable instruction for the resume rewrite, max 25 words>",
    "<second specific actionable instruction, max 25 words>",
    "<third specific actionable instruction, max 25 words>"
  ]
}`;

      const geminiPayload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              score:               { type: "INTEGER" },
              summary:             { type: "STRING" },
              strengths:           { type: "ARRAY", items: { type: "STRING" } },
              gaps:                { type: "ARRAY", items: { type: "STRING" } },
              optimization_points: { type: "ARRAY", items: { type: "STRING" }, minItems: 3, maxItems: 3 },
            },
            required: ["score", "summary", "strengths", "gaps", "optimization_points"],
          },
        },
      };

      const { parsed, usedModel, usageMetadata } = await callGeminiWithMeta(GEMINI_API_KEY, geminiPayload);
      const score = Math.min(100, Math.max(0, Math.round(Number(parsed.score) || 0)));

      // Log usage
      logUsage(supabase, userId, accountId, "bench-match/match", usedModel, usageMetadata);

      return new Response(JSON.stringify({
        profile_id,
        job_post_id,
        score,
        summary: String(parsed.summary ?? ""),
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5) : [],
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 5) : [],
        optimization_points: Array.isArray(parsed.optimization_points) ? parsed.optimization_points.slice(0, 3) : [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (action === "find_candidates") {
      const { job_post_id } = body;
      if (!job_post_id) throw new Error("job_post_id required");

      // Fetch job post
      const { data: jobPost, error: jobErr } = await supabase
        .from("external_job_posts").select("*").eq("id", job_post_id).single();
      if (jobErr || !jobPost) throw new Error("Job post not found");

      // Fetch all active profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, candidate_name, target_role, core_skills, years_experience, visa_status, work_type, preferred_locations, desired_salary_min, desired_salary_max, relocation_open, experience, education")
        .order("created_at", { ascending: false })
        .limit(200);

      if (!profiles || profiles.length === 0) {
        return new Response(JSON.stringify({ candidates: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Build a batch scoring prompt
      const jobSkills = (jobPost.skills || []).join(", ");
      const candidateSummaries = profiles.slice(0, 50).map((p: Record<string, unknown>, i: number) => {
        const skills = (p.core_skills as string) || "";
        const exp = (p.years_experience as number) ?? 0;
        return `[${i}] ${p.candidate_name} | Role: ${p.target_role ?? "N/A"} | Skills: ${skills.slice(0, 150)} | Exp: ${exp}yr | Visa: ${p.visa_status ?? "N/A"} | WorkType: ${p.work_type ?? "Any"} | Locations: ${p.preferred_locations ?? "N/A"} | Rate: ${p.desired_salary_min ?? "?"}–${p.desired_salary_max ?? "?"}/hr | Relocation: ${p.relocation_open ? "Yes" : "No"}`;
      }).join("\n");

      const rankOverride = await getPromptOverride(supabase, "bench-match-rank");
      const rankInstructions = rankOverride?.userPrompt?.trim() || DEFAULT_RANK_INSTRUCTIONS;

      const prompt = `${rankInstructions}

JOB:
- Title: ${jobPost.title}
- Company: ${jobPost.company}
- Location: ${jobPost.location || "Not specified"}
- Skills needed: ${jobSkills}
- Experience: ${jobPost.experience_years ? `${jobPost.experience_years}+ years` : "Not specified"}
- Type: ${jobPost.employment_type || "Not specified"}
- Description: ${(jobPost.raw_description ?? "").slice(0, 1500)}

CANDIDATES:
${candidateSummaries}

Return ONLY a valid JSON object (no markdown):
{
  "rankings": [
    { "index": <candidate index number>, "score": <0-100>, "reason": "<one sentence why they match>" }
  ]
}

Order by score descending. Return at most 20 candidates with score > 30.`;

      const geminiPayload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              rankings: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    index:  { type: "INTEGER" },
                    score:  { type: "INTEGER" },
                    reason: { type: "STRING" },
                  },
                  required: ["index", "score", "reason"],
                },
              },
            },
            required: ["rankings"],
          },
        },
      };

      const { parsed, usedModel, usageMetadata } = await callGeminiWithMeta(GEMINI_API_KEY, geminiPayload);
      const rankings = Array.isArray(parsed.rankings) ? parsed.rankings : [];

      const candidates = rankings
        .filter((r: { index: number; score: number; reason: string }) => r.index >= 0 && r.index < profiles.length)
        .map((r: { index: number; score: number; reason: string }) => ({
          profile: profiles[r.index],
          score: Math.min(100, Math.max(0, r.score)),
          reason: r.reason,
        }));

      // Log usage
      logUsage(supabase, userId, accountId, "bench-match/find_candidates", usedModel, usageMetadata);

      return new Response(JSON.stringify({ candidates }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else {
      throw new Error(`Unknown action: ${action}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash":  { input: 0.075 / 1e6, output: 0.30 / 1e6 },
  "gemini-2.0-flash":  { input: 0.075 / 1e6, output: 0.30 / 1e6 },
  "gemini-1.5-flash":  { input: 0.075 / 1e6, output: 0.30 / 1e6 },
};

function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? PRICING["gemini-2.0-flash"]!;
  return inputTokens * p.input + outputTokens * p.output;
}

interface GeminiResult {
  parsed: Record<string, unknown>;
  usedModel: string;
  usageMetadata: Record<string, number>;
}

async function callGeminiWithMeta(apiKey: string, payload: Record<string, unknown>): Promise<GeminiResult> {
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) continue;

      const data = await res.json() as Record<string, unknown>;
      const parts = ((data?.candidates as Record<string, unknown>[])?.[0]
        ?.content?.parts ?? []) as Record<string, unknown>[];
      const answerPart = parts.find(p => !p.thought) ?? parts[0] ?? {};
      const rawText: string = (answerPart.text as string) ?? "";

      const jsonStart = rawText.indexOf("{");
      const jsonEnd = rawText.lastIndexOf("}");
      const jsonText = jsonStart !== -1 && jsonEnd !== -1
        ? rawText.slice(jsonStart, jsonEnd + 1)
        : rawText.trim();

      const parsed = JSON.parse(jsonText);
      const usageMetadata = (data.usageMetadata ?? {}) as Record<string, number>;
      return { parsed, usedModel: model, usageMetadata };
    } catch {
      continue;
    }
  }
  throw new Error("All LLM providers failed");
}

// deno-lint-ignore no-explicit-any
function logUsage(supabase: any, userId: string | null, accountId: string | null, functionName: string, model: string, usage: Record<string, number>) {
  const promptTokens = usage.promptTokenCount ?? 0;
  const completionTokens = usage.candidatesTokenCount ?? 0;
  const costUsd = computeCost(model, promptTokens, completionTokens);

  supabase.from("api_usage_log").insert({
    user_id: userId,
    account_id: accountId,
    function_name: functionName,
    provider: "gemini",
    model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: usage.totalTokenCount ?? 0,
    cost_usd: costUsd,
    metadata: { action: functionName },
  }).then(() => {}).catch(() => {});
}
