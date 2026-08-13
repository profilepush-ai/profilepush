import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  computeCost, geminiUrl, fetchWithRetry,
  isCircuitOpen, recordCircuitSuccess, recordCircuitFailure,
  enqueueJob,
} from "../_shared/llm-router.ts";
import { getPromptOverride } from "../_shared/prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-From-Queue",
};

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

const DEFAULT_INSTRUCTIONS = `You are an expert resume writer. Rewrite the candidate's resume tailored specifically for the job below.
Produce a complete, professional, ATS-optimized resume in clean plain text (no markdown symbols like **, ##, or --).
Use clear section headers in ALL CAPS followed by a line of dashes.
Keep it to 1-2 pages worth of content. Quantify achievements where possible. Mirror keywords from the job description.`;

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
    const { profile_id, wishlisted_job_id, account_id: bodyAccountId = null, custom_job_description = "" } = body;

    if (!profile_id || !wishlisted_job_id) {
      throw new Error("profile_id and wishlisted_job_id are required");
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

    // Fetch wishlisted job
    const { data: wjob, error: wjobErr } = await supabase
      .from("wishlisted_jobs").select("*").eq("id", wishlisted_job_id).single();
    if (wjobErr || !wjob) throw new Error("Wishlisted job not found");

    // Try to get job description from the source table (or use custom JD if provided)
    let jobDescription = "";
    if (custom_job_description) {
      jobDescription = (custom_job_description as string).slice(0, 3000);
    } else {
      const sourceJobId = wjob.source_job_id as string | null;
      const board = (wjob.board as string ?? "").toLowerCase();
      if (sourceJobId) {
        const tableMap: Record<string, string> = {
          linkedin: "linkedin_jobs",
          dice: "dice_jobs",
          indeed: "indeed_jobs",
          monster: "monster_jobs",
          careerbuilder: "careerbuilder_jobs",
        };
        const tbl = tableMap[board];
        if (tbl) {
          const { data: srcJob } = await supabase.from(tbl).select("job_description").eq("id", sourceJobId).maybeSingle();
          if (srcJob?.job_description) jobDescription = (srcJob.job_description as string).slice(0, 3000);
        }
      }
    }

    const experience = Array.isArray(profile.experience) ? profile.experience : [];
    const education  = Array.isArray(profile.education)  ? profile.education  : [];

    const expText = experience.length > 0
      ? experience.map((e: Record<string, string>) =>
          `${e.title ?? ""} at ${e.company ?? ""} (${e.start_date ?? ""}–${e.current ? "Present" : (e.end_date ?? "")})\n${e.location ? `Location: ${e.location}\n` : ""}${e.description ?? ""}`
        ).join("\n\n")
      : "No prior experience listed.";

    const eduText = education.length > 0
      ? education.map((e: Record<string, string>) =>
          `${e.degree ?? ""} in ${e.field ?? ""}, ${e.institution ?? ""} (${e.start_year ?? ""}–${e.end_year ?? ""})`
        ).join("\n")
      : "No education listed.";

    const promptOverride = await getPromptOverride(supabase, "rewrite-resume");
    const instructions = promptOverride?.userPrompt?.trim() || DEFAULT_INSTRUCTIONS;

    const prompt = `${instructions}

=== TARGET JOB ===
Title: ${wjob.job_title}
Company: ${wjob.company}
Location: ${wjob.location || "Not specified"}
${jobDescription ? `\nJob Description:\n${jobDescription}` : ""}

=== CANDIDATE ===
Name: ${profile.candidate_name}
Email: ${profile.email || ""}
Phone: ${profile.phone || ""}
LinkedIn: ${profile.linkedin_url || ""}
Location: ${profile.location || profile.city || ""}

TARGET ROLE: ${profile.target_role}
YEARS OF EXPERIENCE: ${profile.years_experience ?? "N/A"}
SKILLS: ${profile.core_skills || ""}

WORK EXPERIENCE:
${expText}

EDUCATION:
${eduText}

Output ONLY the resume text — no explanations, no preamble. Start directly with the candidate's name.`;

    const geminiPayload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
      },
    };

    // Try each model in order
    let resumeText = "";
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
        const geminiBody = await res.json() as Record<string, unknown>;
        resumeText = ((geminiBody?.candidates as Record<string, unknown>[])?.[0]
          ?.content?.parts?.[0]?.text as string ?? "").trim();
        usedModel = model;

        // Log usage
        try {
          const usage = (geminiBody?.usageMetadata ?? {}) as Record<string, number>;
          const promptTokens     = usage.promptTokenCount     ?? 0;
          const completionTokens = usage.candidatesTokenCount ?? 0;
          const costUsd          = computeCost(usedModel, promptTokens, completionTokens);
          await supabase.from("api_usage_log").insert({
            user_id:           userId,
            account_id:        accountId,
            function_name:     "rewrite-resume",
            provider:          "gemini",
            model:             usedModel,
            prompt_tokens:     promptTokens,
            completion_tokens: completionTokens,
            total_tokens:      usage.totalTokenCount ?? 0,
            cost_usd:          costUsd,
            metadata:          { profile_id, wishlisted_job_id },
          });
        } catch { /* non-fatal */ }

        break;
      } catch (err) {
        await recordCircuitFailure(supabase, "gemini", model);
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    // All models failed — queue the job
    if (!resumeText) {
      if (fromQueue) throw new Error(`All LLM providers failed: ${lastError}`);

      const queuePayload = { profile_id, wishlisted_job_id, account_id: accountId };
      let jobQueueId: string | null = null;
      try { jobQueueId = await enqueueJob(supabase, "rewrite-resume" as "score-job-match", queuePayload, accountId, userId); }
      catch { /* fall through */ }

      if (jobQueueId) {
        // Mark wishlisted_job with the queue job id
        await supabase.from("wishlisted_jobs")
          .update({ rewrite_job_id: jobQueueId })
          .eq("id", wishlisted_job_id);

        return new Response(JSON.stringify({ queued: true, job_id: jobQueueId }), {
          status: 202,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      throw new Error(lastError);
    }

    if (!resumeText) throw new Error("LLM returned empty response");

    // Upload the resume as a .txt file to storage
    const fileName  = `${profile.candidate_name.replace(/\s+/g, "_")}_${wjob.job_title.replace(/\s+/g, "_")}_rewritten.txt`;
    const storagePath = `${profile_id}/rewritten/${Date.now()}-${fileName}`;
    const fileBytes   = new TextEncoder().encode(resumeText);

    const { error: uploadErr } = await supabase.storage
      .from("resumes")
      .upload(storagePath, fileBytes, { contentType: "text/plain; charset=utf-8", upsert: true });

    let fileUrl: string | null = null;
    if (!uploadErr) {
      const { data: urlData } = supabase.storage.from("resumes").getPublicUrl(storagePath);
      fileUrl = urlData.publicUrl;
    }

    // Insert resume_files record
    const { data: resumeFile } = await supabase.from("resume_files").insert({
      profile_id,
      file_name: fileName,
      file_url:  fileUrl,
      category:  "rewritten",
    }).select().single();

    // Update wishlisted_job with download URL
    await supabase.from("wishlisted_jobs").update({
      rewrite_file_url:  fileUrl,
      rewrite_file_name: fileName,
      rewrite_job_id:    null,
    }).eq("id", wishlisted_job_id);

    // Log activity
    await supabase.from("activity_logs").insert({
      profile_id,
      event_type:  "resume_rewritten",
      description: `Resume rewritten for "${wjob.job_title}" at ${wjob.company}`,
    });

    return new Response(JSON.stringify({
      success: true,
      file_url:  fileUrl,
      file_name: fileName,
      resume_file_id: (resumeFile as Record<string, unknown>)?.id ?? null,
    }), {
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
