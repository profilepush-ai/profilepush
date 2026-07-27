import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  computeCost, geminiUrl, fetchWithRetry,
  isCircuitOpen, recordCircuitSuccess, recordCircuitFailure,
  enqueueJob,
} from "../_shared/llm-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-From-Queue",
};

const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
  const fromQueue = req.headers.get("X-From-Queue") === "true";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json();
    const {
      profile_id,
      linkedin_job_id, dice_job_id, indeed_job_id, monster_job_id, careerbuilder_job_id,
      account_id: bodyAccountId = null,
    } = body;

    if (!profile_id || (!linkedin_job_id && !dice_job_id && !indeed_job_id && !monster_job_id && !careerbuilder_job_id)) {
      throw new Error("profile_id and one job id are required");
    }

    const source  = linkedin_job_id ? "linkedin" : dice_job_id ? "dice" : indeed_job_id ? "indeed" : monster_job_id ? "monster" : "careerbuilder";
    const jobId   = linkedin_job_id ?? dice_job_id ?? indeed_job_id ?? monster_job_id ?? careerbuilder_job_id;
    const jobCol  = source === "linkedin" ? "linkedin_job_id" : source === "dice" ? "dice_job_id" : source === "indeed" ? "indeed_job_id" : source === "monster" ? "monster_job_id" : "careerbuilder_job_id";

    // Check cache
    const { data: cached } = await supabase
      .from("job_match_scores")
      .select("*")
      .eq("profile_id", profile_id)
      .eq(jobCol, jobId)
      .maybeSingle();

    if (cached) {
      return new Response(JSON.stringify({ ...cached, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve user/account
    let userId: string | null = null;
    let accountId: string | null = bodyAccountId;
    const authHeader = req.headers.get("Authorization");
    if (authHeader && !accountId) {
      try {
        const userClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data: { user } } = await userClient.auth.getUser();
        userId = user?.id ?? null;
        if (userId) {
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

    // Credit guard — reject if account has no balance
    if (accountId && !fromQueue) {
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

    // Fetch profile
    const { data: profile, error: profileErr } = await supabase
      .from("profiles").select("*").eq("id", profile_id).single();
    if (profileErr || !profile) throw new Error("Profile not found");

    // Fetch job
    const jobTable = source === "linkedin" ? "linkedin_jobs" : source === "dice" ? "dice_jobs" : source === "indeed" ? "indeed_jobs" : source === "monster" ? "monster_jobs" : "careerbuilder_jobs";
    const { data: job, error: jobErr } = await supabase
      .from(jobTable).select("*").eq("id", jobId).single();
    if (jobErr || !job) throw new Error("Job not found");

    const experience = Array.isArray(profile.experience) ? profile.experience : [];
    const education  = Array.isArray(profile.education)  ? profile.education  : [];

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

    const prompt = `You are an expert technical recruiter evaluating a candidate's fit for a job listing.

CANDIDATE PROFILE:
- Name: ${profile.candidate_name ?? "Unknown"}
- Target Role: ${profile.target_role ?? "Not specified"}
- Priority Skills (MOST IMPORTANT - match these first): ${profile.priority_skills ?? profile.core_skills ?? "Not specified"}
- All Skills: ${profile.core_skills ?? "Not specified"}
- Years of Experience: ${profile.years_experience ?? "Unknown"}
- Visa Status: ${profile.visa_status ?? "Not specified"}
- Work Authorization: ${profile.work_authorization ?? "Not specified"}
- Work Type: ${profile.work_type ?? "Not specified"}
- Preferred Locations: ${profile.preferred_locations ?? "Not specified"}
- Hourly Rate: ${profile.desired_salary_min ?? "?"} - ${profile.desired_salary_max ?? "?"}/hr
- Relocation Open: ${profile.relocation_open ? "Yes" : "No"}
- Work History:
${expSummary}
- Education: ${eduSummary}

SCORING INSTRUCTIONS:
- Weight Priority Skills heavily (35% of score). If the job requires most of the candidate's priority skills, score higher.
- Work Authorization compatibility (10% of score): If the candidate's work authorization (C2C, W2, 1099) does not match the job's employment type or contracting model, deduct points. For example, a W2-only candidate is a poor fit for a C2C-only role.
- The remaining 55% covers role alignment, experience level, location/visa fit, and salary compatibility.
- A candidate missing more than half of their priority skills from the job requirements should score below 60.

JOB DETAILS:
- Title: ${job.job_title ?? job.title ?? "Unknown"}
- Company: ${job.company_name ?? "Unknown"}
- Location: ${job.location ?? job.location_display ?? "Not specified"}
- Seniority Level: ${job.seniority_level ?? job.work_setting ?? "Not specified"}
- Employment Type: ${job.employment_type ?? "Not specified"}
- Job Description:
${(job.job_description ?? "").slice(0, 2000)}

Return ONLY a valid JSON object (no markdown):
{
  "score": <integer 0-100>,
  "summary": "<1 sentence, max 20 words, describing overall fit>",
  "strengths": ["<3-5 words>"],
  "gaps": ["<3-5 words>"],
  "optimization_points": [
    "<specific actionable instruction for the resume rewrite, referencing actual candidate skills vs job requirements, max 25 words>",
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

    // ── Try each Gemini model in order ─────────────────────────────────────────
    let geminiBody: Record<string, unknown> | null = null;
    let usedModel = "";
    let lastError = "All LLM providers unavailable";

    for (const model of GEMINI_MODELS) {
      if (await isCircuitOpen(supabase, "gemini", model)) continue;

      try {
        const res = await fetchWithRetry(
          geminiUrl(model, GEMINI_API_KEY),
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiPayload) },
        );

        if (!res.ok) {
          const errText = await res.text();
          await recordCircuitFailure(supabase, "gemini", model);
          lastError = `Gemini ${model} error ${res.status}: ${errText.slice(0, 200)}`;
          continue;
        }

        await recordCircuitSuccess(supabase, "gemini", model);
        geminiBody = await res.json() as Record<string, unknown>;
        usedModel  = model;
        break;
      } catch (err) {
        await recordCircuitFailure(supabase, "gemini", model);
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    // ── All models failed ──────────────────────────────────────────────────────
    if (!geminiBody) {
      if (fromQueue) throw new Error(`All LLM providers failed: ${lastError}`);

      const queuePayload = { profile_id, [jobCol]: jobId, account_id: accountId };
      let jobQueueId: string | null = null;
      try { jobQueueId = await enqueueJob(supabase, "score-job-match", queuePayload, accountId, userId); }
      catch { /* enqueue failure — fall through to surface original error */ }

      if (jobQueueId) {
        return new Response(JSON.stringify({ queued: true, job_id: jobQueueId }), {
          status: 202,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      throw new Error(lastError);
    }

    // ── Parse result ───────────────────────────────────────────────────────────
    // Thinking models return [{thought:true, text:"..."}, {text:"<answer>"}]
    // Find the first part that is NOT a thinking part
    const parts = ((geminiBody?.candidates as Record<string, unknown>[])?.[0]
      ?.content?.parts ?? []) as Record<string, unknown>[];
    const answerPart = parts.find(p => !p.thought) ?? parts[0] ?? {};
    const rawText: string = (answerPart.text as string) ?? "";

    const jsonStart = rawText.indexOf("{");
    const jsonEnd   = rawText.lastIndexOf("}");
    const jsonText  = jsonStart !== -1 && jsonEnd !== -1
      ? rawText.slice(jsonStart, jsonEnd + 1)
      : rawText.trim();

    let parsed: { score: number; summary: string; strengths: string[]; gaps: string[]; optimization_points: string[] };
    try { parsed = JSON.parse(jsonText); }
    catch { throw new Error(`Failed to parse Gemini response: ${rawText.slice(0, 200)}`); }

    const score  = Math.min(100, Math.max(0, Math.round(Number(parsed.score) || 0)));
    const result = {
      profile_id,
      [jobCol]: jobId,
      score,
      summary:             String(parsed.summary ?? ""),
      strengths:           Array.isArray(parsed.strengths)           ? parsed.strengths.slice(0, 5)           : [],
      gaps:                Array.isArray(parsed.gaps)                ? parsed.gaps.slice(0, 5)                : [],
      optimization_points: Array.isArray(parsed.optimization_points) ? parsed.optimization_points.slice(0, 3) : [],
    };

    const { data: saved } = await supabase
      .from("job_match_scores")
      .upsert(result, { onConflict: `profile_id,${jobCol}` })
      .select()
      .single();

    // Log usage (fire-and-forget)
    try {
      const usage = (geminiBody?.usageMetadata ?? {}) as Record<string, number>;
      const promptTokens     = usage.promptTokenCount     ?? 0;
      const completionTokens = usage.candidatesTokenCount ?? 0;
      const costUsd          = computeCost(usedModel, promptTokens, completionTokens);

      await supabase.from("api_usage_log").insert({
        user_id:           userId,
        account_id:        accountId,
        function_name:     "score-job-match",
        provider:          "gemini",
        model:             usedModel,
        prompt_tokens:     promptTokens,
        completion_tokens: completionTokens,
        total_tokens:      usage.totalTokenCount ?? 0,
        cost_usd:          costUsd,
        metadata:          { profile_id, job_source: source, job_id: jobId },
      });
    } catch { /* logging must never break the main response */ }

    return new Response(JSON.stringify({ ...(saved ?? result), cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
