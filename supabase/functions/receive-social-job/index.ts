import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { normalizeSocialJobItems } from "../../../src/lib/social-job-ingestion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function extractWithGemini(jobs: Array<{ id: string; title: string; description: string; location: string }>, apiKey: string): Promise<{ results: Record<string, unknown>[]; error?: string }> {
  if (!apiKey) return { results: [], error: "GEMINI_API_KEY is not set" };

  const jobTexts = jobs.map((j, idx) => `[Job ${idx}] (id: ${j.id})
Title: ${j.title}
Location: ${j.location}
Description: ${j.description.slice(0, 1500)}`).join("\n---\n");

  const prompt = `Extract structured fields from each job posting. Return ONLY a raw JSON array, no markdown.
For each job: job_id (from input), role_title, core_skills (array max 12), years_experience (number or null), visa_types (array), employment_type (C2C/W2/Full-time/Contract/Any), work_type (Remote/Hybrid/Onsite/Unknown), locations (array), hourly_rate_min (number or null), hourly_rate_max (number or null).

JOBS:
${jobTexts}

Return ONLY valid JSON array:`;

  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
  let lastError = "No models succeeded";
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1 } }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        lastError = `${model} HTTP ${res.status}: ${errBody.slice(0, 200)}`;
        continue;
      }
      const data = await res.json();
      let text = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
      if (!text) { lastError = `${model}: empty response`; continue; }
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(text);
      return { results: Array.isArray(parsed) ? parsed : (parsed.results ?? []) };
    } catch (e) { lastError = `${model}: ${(e as Error).message}`; continue; }
  }
  return { results: [], error: lastError };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json();
    const items: Array<Record<string, unknown>> = Array.isArray(body) ? body : [body];
    if (items.length === 0) return respond({ error: "Empty payload" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
    const { rows, errors } = normalizeSocialJobItems(items);
    const normalizedRows = rows.map((row) => ({
      ...row,
      posted_at: row.posted_at,
    }));

    await supabase.from("social_job_payload_logs").insert({
      function_name: "receive-social-job",
      source: body?.source ?? null,
      payload: body,
      normalized_rows: normalizedRows,
      errors,
      inserted_count: normalizedRows.length,
      status: rows.length > 0 ? "received" : "rejected",
    });

    if (rows.length === 0) {
      return respond({ error: errors[0] ?? "Each item requires: post_id, platform, post_content" }, 400);
    }

    const { data, error } = await supabase
      .from("social_jobs")
      .upsert(normalizedRows, { onConflict: "post_id,platform", ignoreDuplicates: false })
      .select("id, post_id, platform");

    if (error) return respond({ error: error.message }, 500);
    if (!data || data.length === 0) return respond({ success: true, inserted: 0, ids: [], errors });

    const insertedIds = data.map((r: { id: string }) => r.id);

    // Build job objects for Gemini — use the in-memory data to avoid a re-fetch.
    const jobsForExtraction = data.map((r: { id: string }, idx: number) => ({
      id: r.id,
      title: normalizedRows[idx]?.job_title ?? "",
      description: normalizedRows[idx]?.job_description ?? "",
      location: normalizedRows[idx]?.location ?? "",
    }));

    // Call Gemini synchronously — inline extraction, no radar-match delegation.
    let extractionSaved = 0;
    let extractionError: string | null = null;
    if (GEMINI_API_KEY && jobsForExtraction.length > 0) {
      try {
        const { results: extracted, error: geminiError } = await extractWithGemini(jobsForExtraction, GEMINI_API_KEY);
        if (geminiError) extractionError = geminiError;
        if (extracted.length > 0) {
          const matchRows = extracted.map((e: Record<string, unknown>) => {
            const jobInput = jobsForExtraction.find(j => j.id === String(e.job_id ?? "")) ?? jobsForExtraction[0];
            const rateStr = (e.hourly_rate_min != null || e.hourly_rate_max != null)
              ? `$${e.hourly_rate_min ?? "?"}–$${e.hourly_rate_max ?? "?"}/hr`
              : "Not specified";
            return {
              profile_id: null,
              job_source: "social",
              job_id: String(e.job_id ?? jobInput.id),
              final_average_score: 0,
              score_breakdown: {
                role_match: { score: 0, candidate_value: "", job_value: String(e.role_title ?? jobInput.title ?? "Not specified"), rule: "Job role title" },
                skills_match: { score: 0, candidate_value: "", job_value: Array.isArray(e.core_skills) ? (e.core_skills as string[]).join(", ") : "Not specified", rule: "Required skills" },
                experience_match: { score: 0, candidate_value: "", job_value: e.years_experience != null ? `${e.years_experience}+ years` : "Not specified", rule: "Required experience" },
                visa_match: { score: 0, candidate_value: "", job_value: Array.isArray(e.visa_types) && (e.visa_types as string[]).length ? (e.visa_types as string[]).join(", ") : "Not specified", rule: "Visa requirements" },
                work_type_match: { score: 0, candidate_value: "", job_value: String(e.work_type ?? "Not specified"), rule: "Work arrangement" },
                location_match: { score: 0, candidate_value: "", job_value: Array.isArray(e.locations) && (e.locations as string[]).length ? (e.locations as string[]).join(", ") : jobInput.location || "Not specified", rule: "Location" },
                rate_match: { score: 0, candidate_value: "", job_value: rateStr, rule: "Hourly rate" },
              },
              ai_notes: "extraction_only",
              disqualified: false,
              disqualify_reason: null,
              job_title: jobInput.title || null,
              role_title: String(e.role_title ?? jobInput.title ?? ""),
              core_skills: Array.isArray(e.core_skills) ? e.core_skills as string[] : [],
              years_experience: typeof e.years_experience === "number" ? e.years_experience : null,
              visa_types: Array.isArray(e.visa_types) ? e.visa_types as string[] : [],
              employment_type: String(e.employment_type ?? ""),
              work_type: String(e.work_type ?? ""),
              locations: Array.isArray(e.locations) ? e.locations as string[] : [],
              hourly_rate_min: typeof e.hourly_rate_min === "number" ? e.hourly_rate_min : null,
              hourly_rate_max: typeof e.hourly_rate_max === "number" ? e.hourly_rate_max : null,
              relocation_required: false,
              extracted_fields: e,
            };
          });

          const { error: matchErr } = await supabase
            .from("radar_match_results")
            .upsert(matchRows, { onConflict: "job_id,job_source", ignoreDuplicates: false });

          if (!matchErr) {
            extractionSaved = matchRows.length;
            await supabase.from("social_jobs").update({ extracted_at: new Date().toISOString() }).in("id", matchRows.map(r => r.job_id));
          } else console.error("radar_match_results upsert error:", matchErr.message);
        }
      } catch (geminiErr) {
        console.error("Gemini extraction error:", geminiErr);
        extractionError = (geminiErr as Error).message;
      }
    }

    // Fire embedding generation in the background — non-critical.
    const embeddingPromise = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-embedding`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
      body: JSON.stringify(insertedIds.map((id: string) => ({ type: "job", id, table: "social_jobs" }))),
    }).catch((err) => console.error("embedding error:", err));

    (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(embeddingPromise);

    return respond({ success: true, inserted: data.length, ids: insertedIds, extraction_saved: extractionSaved, extraction_error: extractionError, skipped: errors });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});
