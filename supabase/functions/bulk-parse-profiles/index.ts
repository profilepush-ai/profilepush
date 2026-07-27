import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  computeCost, geminiUrl, fetchWithRetry,
  isCircuitOpen, recordCircuitSuccess, recordCircuitFailure,
} from "../_shared/llm-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      candidate_name:      { type: "STRING" },
      target_role:         { type: "STRING" },
      location:            { type: "STRING" },
      city:                { type: "STRING" },
      state:               { type: "STRING" },
      country:             { type: "STRING" },
      phone:               { type: "STRING" },
      email:               { type: "STRING" },
      linkedin_url:        { type: "STRING" },
      core_skills:         { type: "STRING" },
      years_experience:    { type: "INTEGER" },
      visa_status:         { type: "STRING" },
      work_type:           { type: "STRING" },
      work_authorization:  { type: "STRING" },
      preferred_locations: { type: "STRING" },
      desired_salary_min:  { type: "INTEGER" },
      desired_salary_max:  { type: "INTEGER" },
      relocation_open:     { type: "BOOLEAN" },
      availability:        { type: "STRING" },
      tax_terms:           { type: "STRING" },
      priority_skills:     { type: "STRING" },
    },
    required: ["candidate_name"],
  },
};

const SYSTEM_INSTRUCTION =
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
Parse ALL rows — do not skip any. If a row has minimal info, still create a profile with whatever is available.`;

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) return jsonError("GEMINI_API_KEY secret is not configured", 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

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

    const body = await req.json().catch(() => ({}));
    const rawText: string = body.spreadsheet_text ?? "";
    if (!rawText.trim()) return jsonError("Missing spreadsheet_text in request body");

    const geminiPayload = {
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{
        parts: [{
          text: `Parse the following spreadsheet data (tab-separated, first row is headers) into an array of candidate profile objects. Return ALL candidates.\n\n--- SPREADSHEET DATA ---\n${rawText}\n--- END ---`,
        }],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    };

    let geminiData: Record<string, unknown> | null = null;
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
        geminiData = await res.json() as Record<string, unknown>;
        usedModel = model;
        break;
      } catch (err) {
        await recordCircuitFailure(supabase, "gemini", model);
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (!geminiData) {
      return jsonError(`AI parsing failed: ${lastError}`, 503);
    }

    const rawContent = (geminiData?.candidates as Record<string, unknown>[])?.[0]
      ?.content as Record<string, unknown>;
    const text: string = (rawContent?.parts as Record<string, unknown>[])?.[0]?.text as string ?? "";

    if (!text) return jsonError("AI returned no content", 502);

    // Log usage
    try {
      const usage = (geminiData?.usageMetadata ?? {}) as Record<string, number>;
      const promptTokens     = usage.promptTokenCount     ?? 0;
      const completionTokens = usage.candidatesTokenCount ?? 0;
      const totalTokens      = usage.totalTokenCount      ?? 0;
      const costUsd          = computeCost(usedModel, promptTokens, completionTokens);

      await supabase.from("api_usage_log").insert({
        user_id:           userId,
        account_id:        accountId,
        function_name:     "bulk-parse-profiles",
        provider:          "gemini",
        model:             usedModel,
        prompt_tokens:     promptTokens,
        completion_tokens: completionTokens,
        total_tokens:      totalTokens,
        cost_usd:          costUsd,
      });
    } catch { /* logging must never break response */ }

    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { return jsonError("AI response was not valid JSON", 502); }

    if (!Array.isArray(parsed)) {
      return jsonError("AI response was not an array of profiles", 502);
    }

    return new Response(JSON.stringify({ profiles: parsed, count: parsed.length }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
});
