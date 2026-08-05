import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

async function extractWithGemini(jobs: Array<{ id: string; title: string; description: string; location: string }>, apiKey: string) {
  const jobTexts = jobs.map((j, idx) => `[Job ${idx}] (id: ${j.id})
Title: ${j.title}
Location: ${j.location}
Description: ${j.description.slice(0, 1500)}`).join("\n---\n");

  const prompt = `Extract structured fields from each job posting. For each job return:
- role_title: actual role title
- core_skills: array of required technical skills (max 12)
- years_experience: minimum years required (number or null)
- visa_types: accepted visa types e.g. ["H1B","GC","USC","EAD","OPT"] (empty array if not mentioned)
- employment_type: e.g. "C2C","W2","Full-time","Contract","Any"
- work_type: "Remote"|"Hybrid"|"Onsite"|"Unknown"
- locations: array of work locations
- hourly_rate_min: min hourly rate USD (number or null)
- hourly_rate_max: max hourly rate USD (number or null)

JOBS:
${jobTexts}

Return ONLY a JSON array:
[{"job_id":"uuid","role_title":"...","core_skills":[],"years_experience":null,"visa_types":[],"employment_type":"...","work_type":"...","locations":[],"hourly_rate_min":null,"hourly_rate_max":null}]`;

  const models = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: "application/json" } }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : (parsed.results ?? []);
    } catch { continue; }
  }
  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json();
    const items: Array<Record<string, unknown>> = Array.isArray(body) ? body : [body];
    if (items.length === 0) return respond({ error: "Empty payload" }, 400);

    for (const item of items) {
      if (!item.post_id || !item.platform || !item.post_content) {
        return respond({ error: "Each item requires: post_id, platform, post_content" }, 400);
      }
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

    function safeTimestamp(val: unknown): string | null {
      if (!val) return null;
      if (typeof val === "string") { const d = new Date(val); return isNaN(d.getTime()) ? null : d.toISOString(); }
      if (typeof val === "number") return new Date(val).toISOString();
      if (typeof val === "object" && val !== null) {
        const obj = val as Record<string, unknown>;
        if (obj.seconds) return new Date(Number(obj.seconds) * 1000).toISOString();
        if (obj.$date) return new Date(String(obj.$date)).toISOString();
      }
      return null;
    }

    const rows = items.map((item) => ({
      post_id: String(item.post_id),
      platform: String(item.platform).toLowerCase(),
      post_content: String(item.post_content),
      posted_by_name: String(item.posted_by_name ?? ""),
      posted_at: safeTimestamp(item.posted_at),
      profile_link: String(item.profile_link ?? ""),
      poster_email: String(item.poster_email ?? ""),
      poster_phone: String(item.poster_phone ?? ""),
      post_url: String(item.post_url ?? ""),
      job_title: String(item.job_title ?? ""),
      company_name: String(item.company_name ?? ""),
      location: String(item.location ?? ""),
      employment_type: String(item.employment_type ?? ""),
      seniority_level: String(item.seniority_level ?? ""),
      job_description: String(item.job_description ?? item.post_content),
      salary_range: String(item.salary_range ?? ""),
      account_id: item.account_id ? String(item.account_id) : null,
    }));

    const { data, error } = await supabase
      .from("social_jobs")
      .upsert(rows, { onConflict: "post_id,platform", ignoreDuplicates: false })
      .select("id, post_id, platform");

    if (error) return respond({ error: error.message }, 500);
    if (!data || data.length === 0) return respond({ success: true, inserted: 0, ids: [] });

    const insertedIds = data.map((r: { id: string }) => r.id);

    // Build job objects for Gemini — use the in-memory data to avoid a re-fetch.
    const jobsForExtraction = data.map((r: { id: string }, idx: number) => ({
      id: r.id,
      title: rows[idx]?.job_title ?? "",
      description: rows[idx]?.job_description ?? "",
      location: rows[idx]?.location ?? "",
    }));

    // Call Gemini synchronously — inline extraction, no radar-match delegation.
    let extractionSaved = 0;
    if (GEMINI_API_KEY && jobsForExtraction.length > 0) {
      try {
        const extracted = await extractWithGemini(jobsForExtraction, GEMINI_API_KEY);
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

          if (!matchErr) extractionSaved = matchRows.length;
          else console.error("radar_match_results upsert error:", matchErr.message);
        }
      } catch (geminiErr) {
        console.error("Gemini extraction error:", geminiErr);
      }
    }

    // Fire embedding generation in the background — non-critical.
    const embeddingPromise = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-embedding`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
      body: JSON.stringify(insertedIds.map((id: string) => ({ type: "job", id, table: "social_jobs" }))),
    }).catch((err) => console.error("embedding error:", err));

    (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(embeddingPromise);

    return respond({ success: true, inserted: data.length, ids: insertedIds, extraction_saved: extractionSaved });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});
