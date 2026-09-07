import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { computeCost, geminiUrl, fetchWithRetry } from "../_shared/llm-router.ts";
import { getPromptOverride } from "../_shared/prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-3.6-flash"];

const DEFAULT_INSTRUCTIONS = `You are a data assistant embedded in a bench-sales recruiting platform's personal analytics dashboard. Answer the user's question using ONLY the JSON activity data provided below, which reflects their own account's real activity over the selected date range.

Rules:
- Be concise: a few short sentences, or a brief bulleted list if comparing several numbers.
- Always cite the actual numbers from the data — never invent a number that isn't present.
- The account may act as a Vendor (posts Jobs, requests Hotlist resumes) and/or a Recruiter/bench-sales (posts Hotlist listings, applies to Jobs) — refer to the correct persona's data for what's being asked.
- If the question can't be answered from the data provided, say so plainly instead of guessing.
- Do not restate the whole JSON back — extract only what's relevant to the question.`;

type VendorActivity = {
  jobs_received_funnel?: Record<string, number>;
  hotlist_sent_funnel?: Record<string, number>;
  conversations?: number;
  contacts_downloaded?: number;
  daily?: Array<Record<string, number | string>>;
} | null;

type RecruiterActivity = {
  hotlist_received_funnel?: Record<string, number>;
  jobs_applying_funnel?: Record<string, number>;
  conversations?: number;
  contacts_downloaded?: number;
  daily?: Array<Record<string, number | string>>;
} | null;

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
    const { question, days } = await req.json();
    const trimmedQuestion = String(question ?? "").trim();
    if (!trimmedQuestion) {
      return new Response(JSON.stringify({ error: "A question is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rangeDays = Math.max(1, Math.min(Number(days) || 7, 90));

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: member } = await supabase
      .from("account_members")
      .select("account_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    const accountId = member?.account_id ?? null;

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

    const [vendorResult, recruiterResult] = await Promise.all([
      userClient.rpc("get_account_vendor_activity", { p_days: rangeDays }),
      userClient.rpc("get_account_recruiter_activity", { p_days: rangeDays }),
    ]);
    const vendorActivity = (vendorResult.data ?? null) as VendorActivity;
    const recruiterActivity = (recruiterResult.data ?? null) as RecruiterActivity;

    const dataText = `
VENDOR ACTIVITY (jobs you posted, hotlist resumes you requested):
${JSON.stringify(vendorActivity ?? {}, null, 2)}

RECRUITER ACTIVITY (hotlist you posted, jobs you applied to):
${JSON.stringify(recruiterActivity ?? {}, null, 2)}
`;

    const promptOverride = await getPromptOverride(supabase, "dashboard-ai-insights");
    const instructions = promptOverride?.userPrompt?.trim() || DEFAULT_INSTRUCTIONS;

    const prompt = `${instructions}

Date range: last ${rangeDays} days
${dataText}

User question: ${trimmedQuestion}`;

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
              temperature: 0.4,
              maxOutputTokens: 512,
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
    const answer = ((answerPart.text as string) ?? "").trim();

    if (!answer) {
      return new Response(JSON.stringify({ error: "AI returned an empty answer" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const usage = (geminiBody?.usageMetadata ?? {}) as Record<string, number>;
      const promptTokens     = usage.promptTokenCount     ?? 0;
      const completionTokens = usage.candidatesTokenCount ?? 0;
      const costUsd          = computeCost(usedModel, promptTokens, completionTokens);
      await supabase.from("api_usage_log").insert({
        user_id:           user.id,
        account_id:        accountId,
        function_name:     "dashboard-ai-insights",
        provider:          "gemini",
        model:             usedModel,
        prompt_tokens:     promptTokens,
        completion_tokens: completionTokens,
        total_tokens:      usage.totalTokenCount ?? 0,
        cost_usd:          costUsd,
        metadata:          { days: rangeDays, question_length: trimmedQuestion.length },
      });
    } catch { /* non-fatal */ }

    return new Response(JSON.stringify({ answer }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
