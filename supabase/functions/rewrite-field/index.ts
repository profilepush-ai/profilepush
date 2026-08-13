import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  computeCost, geminiUrl, fetchWithRetry,
  isCircuitOpen, recordCircuitSuccess, recordCircuitFailure,
} from "../_shared/llm-router.ts";
import { getPromptOverride } from "../_shared/prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];

const DEFAULT_INSTRUCTIONS = "Be concise, professional, and ATS-optimized. Use plain text — no markdown symbols.";

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
    const {
      profile_id,
      wishlisted_job_id,
      field,           // "summary" | "skills" | "experience_description"
      current_value,   // current text of the field
      context,         // optional: e.g. "Software Engineer at Acme" for exp descriptions
      job_description, // full job description text
    } = body;

    if (!profile_id || !field) {
      throw new Error("profile_id and field are required");
    }

    // Resolve user/account for usage logging
    let userId: string | null = null;
    let accountId: string | null = null;
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

    const fromQueue = req.headers.get("X-From-Queue") === "true";

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

    // Fetch profile for context
    const { data: profile, error: profileErr } = await supabase
      .from("profiles").select("*").eq("id", profile_id).single();
    if (profileErr || !profile) throw new Error("Profile not found");

    // Fetch job description from wishlisted job if not provided
    let jdText = job_description as string ?? "";
    if (!jdText && wishlisted_job_id) {
      const { data: wjob } = await supabase
        .from("wishlisted_jobs").select("*").eq("id", wishlisted_job_id).maybeSingle();
      if (wjob) {
        const srcId = wjob.source_job_id as string | null;
        const board = (wjob.board as string ?? "").toLowerCase();
        if (srcId) {
          const tableMap: Record<string, string> = {
            linkedin: "linkedin_jobs", dice: "dice_jobs", indeed: "indeed_jobs",
            monster: "monster_jobs", careerbuilder: "careerbuilder_jobs",
          };
          const tbl = tableMap[board];
          if (tbl) {
            const { data: srcJob } = await supabase.from(tbl).select("job_description").eq("id", srcId).maybeSingle();
            if (srcJob?.job_description) jdText = (srcJob.job_description as string).slice(0, 2000);
          }
        }
        if (!jdText) jdText = `${wjob.job_title} at ${wjob.company}`;
      }
    }

    const fieldLabel = field === "summary" ? "professional summary"
      : field === "skills" ? "technical skills list"
      : "job experience description";

    const originalValue = (current_value as string) ?? "";
    const contextNote   = (context as string) ?? "";

    const promptOverride = await getPromptOverride(supabase, "rewrite-field");
    const instructions = promptOverride?.userPrompt?.trim() || DEFAULT_INSTRUCTIONS;

    const prompt = `You are an expert resume writer. Rewrite ONLY the ${fieldLabel} section below, tailored specifically for the target job. ${instructions}

CANDIDATE:
Name: ${profile.candidate_name}
Target Role: ${profile.target_role}
Years of Experience: ${profile.years_experience ?? "N/A"}
Core Skills: ${profile.core_skills ?? ""}
${contextNote ? `Position Context: ${contextNote}` : ""}

TARGET JOB DESCRIPTION:
${jdText.slice(0, 1500)}

CURRENT ${fieldLabel.toUpperCase()}:
${originalValue}

Output ONLY the rewritten ${fieldLabel} text — no labels, no explanations, no preamble.`;

    const geminiPayload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 1024,
      },
    };

    let resultText = "";
    let usedModel  = "";
    let lastError  = "All LLM providers unavailable";

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

        // Handle thinking-model response structure
        const parts = ((geminiBody?.candidates as Record<string, unknown>[])?.[0]
          ?.content?.parts ?? []) as Record<string, unknown>[];
        const answerPart = parts.find(p => !p.thought) ?? parts[0] ?? {};
        resultText = ((answerPart.text as string) ?? "").trim();
        usedModel  = model;

        // Log usage
        try {
          const usage = (geminiBody?.usageMetadata ?? {}) as Record<string, number>;
          const promptTokens     = usage.promptTokenCount     ?? 0;
          const completionTokens = usage.candidatesTokenCount ?? 0;
          const costUsd          = computeCost(usedModel, promptTokens, completionTokens);
          await supabase.from("api_usage_log").insert({
            user_id:           userId,
            account_id:        accountId,
            function_name:     "rewrite-field",
            provider:          "gemini",
            model:             usedModel,
            prompt_tokens:     promptTokens,
            completion_tokens: completionTokens,
            total_tokens:      usage.totalTokenCount ?? 0,
            cost_usd:          costUsd,
            metadata:          { profile_id, field, wishlisted_job_id },
          });
        } catch { /* non-fatal */ }

        break;
      } catch (err) {
        await recordCircuitFailure(supabase, "gemini", model);
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (!resultText) throw new Error(lastError);

    return new Response(JSON.stringify({ result: resultText }), {
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
