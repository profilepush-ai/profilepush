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

const IDEA_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      label:           { type: "STRING" },
      keyword:         { type: "STRING" },
      location:        { type: "STRING" },
      jobTypes:        { type: "ARRAY", items: { type: "STRING" } },
      experienceLevel: { type: "STRING" },
      rationale:       { type: "STRING" },
    },
    required: ["label", "keyword", "location", "jobTypes", "experienceLevel", "rationale"],
  },
};

const DEFAULT_INSTRUCTIONS =
  "You are a job search strategist. Based on the candidate profile below, generate exactly 8 diverse and creative job search filter combinations they should try. Each idea should target a distinct angle: different job titles, industries, seniority levels, or specialisations.";

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
    const { profile_id } = body;

    if (!profile_id) throw new Error("profile_id is required");

    // Resolve user/account (non-fatal)
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

    // Fetch profile
    const { data: profile, error: profileErr } = await supabase
      .from("profiles").select("*").eq("id", profile_id).single();
    if (profileErr || !profile) throw new Error(`Profile not found: ${profileErr?.message ?? "no row"}`);

    const experience = Array.isArray(profile.experience) ? profile.experience : [];
    const education  = Array.isArray(profile.education)  ? profile.education  : [];

    const expLines = experience.slice(0, 5).map((e: Record<string, string>) =>
      `- ${e.title ?? ""} at ${e.company ?? ""} (${e.start_date ?? ""}–${e.current ? "Present" : (e.end_date ?? "")}): ${(e.description ?? "").slice(0, 200)}`
    ).join("\n") || "No experience listed";

    const eduLines = education.slice(0, 3).map((e: Record<string, string>) =>
      `- ${e.degree ?? ""} in ${e.field ?? ""} from ${e.institution ?? ""} (${e.end_year ?? ""})`
    ).join("\n") || "No education listed";

    const promptOverride = await getPromptOverride(supabase, "generate-search-ideas");
    const instructions = promptOverride?.userPrompt?.trim() || DEFAULT_INSTRUCTIONS;

    const prompt = `${instructions}

CANDIDATE PROFILE:
Name: ${profile.candidate_name ?? ""}
Target Role: ${profile.target_role ?? ""}
Location: ${profile.city || profile.location || ""}${profile.state ? ", " + profile.state : ""}
Years Experience: ${profile.years_experience ?? "Unknown"}
Core Skills: ${profile.core_skills ?? ""}
Work Type Preference: ${profile.work_type || "Any"}
Preferred Locations: ${profile.preferred_locations || "Any"}

EXPERIENCE:
${expLines}

EDUCATION:
${eduLines}

Rules:
- "label": short title max 5 words
- "keyword": exact job title or search keyword
- "location": city/state or empty string for remote roles
- "jobTypes": array using only: "Full-time", "Part-time", "Contract", "Internship", "Remote"
- "experienceLevel": one of "Entry level", "Mid level", "Senior level", "Executive", or empty string ""
- "rationale": one sentence why this angle fits the candidate`;

    const geminiPayload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: IDEA_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

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
        usedModel = model;
        break;
      } catch (err) {
        await recordCircuitFailure(supabase, "gemini", model);
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (!geminiBody) throw new Error(lastError);

    const parts = ((geminiBody?.candidates as Record<string, unknown>[])?.[0]
      ?.content?.parts ?? []) as Record<string, unknown>[];
    const answerPart = parts.find(p => !p.thought) ?? parts[0] ?? {};
    const rawText: string = (answerPart.text as string) ?? "";

    let ideas: unknown[];
    try {
      // Find JSON array bounds in case of extra whitespace
      const start = rawText.indexOf("[");
      const end   = rawText.lastIndexOf("]");
      const slice = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText.trim();
      ideas = JSON.parse(slice);
    } catch {
      throw new Error(`Failed to parse AI response: ${rawText.slice(0, 200)}`);
    }

    if (!Array.isArray(ideas) || ideas.length === 0) {
      throw new Error("AI returned no ideas");
    }

    // Log usage (fire-and-forget — never fail the request)
    try {
      const usage = (geminiBody?.usageMetadata ?? {}) as Record<string, number>;
      const promptTokens     = usage.promptTokenCount     ?? 0;
      const completionTokens = usage.candidatesTokenCount ?? 0;
      const costUsd          = computeCost(usedModel, promptTokens, completionTokens);
      await supabase.from("api_usage_log").insert({
        user_id:           userId,
        account_id:        accountId,
        function_name:     "generate-search-ideas",
        provider:          "gemini",
        model:             usedModel,
        prompt_tokens:     promptTokens,
        completion_tokens: completionTokens,
        total_tokens:      usage.totalTokenCount ?? 0,
        cost_usd:          costUsd,
        metadata:          { profile_id },
      });
    } catch { /* non-fatal */ }

    return new Response(JSON.stringify({ ideas }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
