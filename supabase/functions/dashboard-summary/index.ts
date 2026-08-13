import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { computeCost, geminiUrl, fetchWithRetry } from "../_shared/llm-router.ts";
import { getPromptOverride } from "../_shared/prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

const DEFAULT_INSTRUCTIONS = `You are a recruitment operations analyst. Analyze the metrics below and respond with EXACTLY 5 bullet points.

Rules:
- Exactly 5 lines, each starting with "• "
- Each point: one short sentence, max 10 words
- Total response under 50 words
- Be specific — use the actual numbers
- Focus on what matters most: health, gaps, wins, risks, next action
- If the user asked a question, answer it within the same 5-point format`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { bench, jobs, comms, date_label, custom_prompt } = await req.json();

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

    const metricsText = `
BENCH ACTIVITY (Period: ${date_label}):
- Total Candidates: ${bench.total}
- Pipeline: New(${bench.stages?.New ?? 0}), Assigned(${bench.stages?.Assigned ?? 0}), Sourcing(${bench.stages?.Sourcing ?? 0}), Submitted(${bench.stages?.Submitted ?? 0}), Placed(${bench.stages?.Placed ?? 0}), Lost(${bench.stages?.Lost ?? 0})
- Profiles Added This Period: ${bench.period_profiles_added}
- Resumes Uploaded: ${bench.resumes_uploaded}
- Resumes Rewritten: ${bench.resumes_rewritten}
- Status Changes: ${bench.period_status_changes}

JOB ACTIVITY (Period: ${date_label}):
- Jobs Added: ${jobs.total_saved}
- Applied: ${jobs.applied}
- Apply Rate: ${jobs.apply_rate_pct}%
- Match Scores Run: ${jobs.match_scores}
- Jobs with Rewritten Resume: ${jobs.jobs_with_rewrite}
- Board Breakdown: ${JSON.stringify(jobs.board_breakdown ?? {})}

COMMUNICATIONS & SUBMISSIONS (Period: ${date_label}):
- Emails Sent: ${comms.emails_sent}
- Resumes Generated: ${comms.resumes_generated}
- Resume Rewrites: ${comms.resumes_rewritten}
- Submissions: ${comms.total_submissions}
`;

    const userQuestion = custom_prompt?.trim()
      ? `\n\nUser question: ${custom_prompt}`
      : "";

    const promptOverride = await getPromptOverride(supabase, "dashboard-summary");
    const instructions = promptOverride?.userPrompt?.trim() || DEFAULT_INSTRUCTIONS;

    const prompt = `${instructions}

Period: ${date_label}
${metricsText}${userQuestion}

Respond with exactly 5 bullet points. Nothing else.`;

    let geminiBody: Record<string, unknown> | null = null;
    let usedModel = "";
    let lastError = "Unknown error";

    for (const model of GEMINI_MODELS) {
      try {
        const res = await fetchWithRetry(geminiUrl(model, GEMINI_API_KEY), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024,
              thinkingConfig: { thinkingBudget: 0 },
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
      } catch (e) {
        lastError = String(e);
        continue;
      }
    }

    if (!geminiBody) {
      return new Response(JSON.stringify({ error: `All models failed. Last: ${lastError}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parts = ((geminiBody?.candidates as Record<string, unknown>[])?.[0]
      ?.content?.parts ?? []) as Record<string, unknown>[];
    const answerPart = parts.find(p => !p.thought) ?? parts[0] ?? {};
    const summary = ((answerPart.text as string) ?? "").trim();

    if (!summary) {
      return new Response(JSON.stringify({ error: "AI returned empty summary" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log usage (fire-and-forget)
    try {
      const usage = (geminiBody?.usageMetadata ?? {}) as Record<string, number>;
      const promptTokens     = usage.promptTokenCount     ?? 0;
      const completionTokens = usage.candidatesTokenCount ?? 0;
      const costUsd          = computeCost(usedModel, promptTokens, completionTokens);
      await supabase.from("api_usage_log").insert({
        user_id:           userId,
        account_id:        accountId,
        function_name:     "dashboard-summary",
        provider:          "gemini",
        model:             usedModel,
        prompt_tokens:     promptTokens,
        completion_tokens: completionTokens,
        total_tokens:      usage.totalTokenCount ?? 0,
        cost_usd:          costUsd,
        metadata:          { date_label, has_custom_prompt: !!custom_prompt?.trim() },
      });
    } catch { /* non-fatal */ }

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
