import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { computeCost, geminiUrl, fetchWithRetry } from "../_shared/llm-router.ts";
import { getPromptOverride } from "../_shared/prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];

const DEFAULT_INSTRUCTIONS =
  "You are a technical recruiter expert. Given a candidate's profile, suggest exactly 5 high-priority skills that would best match job postings and increase placement chances.";

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
    const { target_role, core_skills, experience_summary } = await req.json();

    if (!target_role && !core_skills) {
      return new Response(JSON.stringify({ error: "target_role or core_skills required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve user/account for credit guard and usage logging
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

    // Credit guard — reject if account has no balance
    if (accountId) {
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

    const promptOverride = await getPromptOverride(supabase, "suggest-priority-skills");
    const instructions = promptOverride?.userPrompt?.trim() || DEFAULT_INSTRUCTIONS;

    const prompt = `${instructions}

Candidate profile:
- Target Role: ${target_role || "Not specified"}
- Core Skills: ${core_skills || "Not specified"}
- Experience Summary: ${experience_summary || "Not provided"}

Return a JSON array of exactly 5 skill strings. Each skill should be a specific, marketable technical or professional skill (e.g. "React", "AWS Lambda", "Python", "CI/CD", "Agile").
Only return the JSON array, no explanation.`;

    let geminiBody: Record<string, unknown> | null = null;
    let usedModel = "";
    let lastError = "All models failed";

    for (const model of GEMINI_MODELS) {
      const res = await fetchWithRetry(geminiUrl(model, GEMINI_API_KEY), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: { type: "STRING" },
              minItems: 5,
              maxItems: 5,
            },
          },
        }),
      });

      if (!res.ok) {
        lastError = `Model ${model} returned ${res.status}`;
        continue;
      }

      geminiBody = await res.json() as Record<string, unknown>;
      usedModel = model;
      break;
    }

    if (!geminiBody) throw new Error(lastError);

    const text = geminiBody?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
    const skills: string[] = JSON.parse(text as string);

    // Log usage (fire-and-forget)
    try {
      const usage = (geminiBody?.usageMetadata ?? {}) as Record<string, number>;
      const promptTokens     = usage.promptTokenCount     ?? 0;
      const completionTokens = usage.candidatesTokenCount ?? 0;
      const costUsd          = computeCost(usedModel, promptTokens, completionTokens);
      await supabase.from("api_usage_log").insert({
        user_id:           userId,
        account_id:        accountId,
        function_name:     "suggest-priority-skills",
        provider:          "gemini",
        model:             usedModel,
        prompt_tokens:     promptTokens,
        completion_tokens: completionTokens,
        total_tokens:      usage.totalTokenCount ?? 0,
        cost_usd:          costUsd,
        metadata:          { target_role, core_skills },
      });
    } catch { /* non-fatal */ }

    return new Response(JSON.stringify({ skills }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
