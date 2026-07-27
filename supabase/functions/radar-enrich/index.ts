import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];

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
    const { job_ids, source } = await req.json();
    if (!job_ids || !source) throw new Error("job_ids and source are required");

    const table = source === "linkedin" ? "linkedin_jobs" : source === "dice" ? "dice_jobs" : source === "indeed" ? "indeed_jobs" : source === "monster" ? "monster_jobs" : "careerbuilder_jobs";

    const { data: jobs, error: jobErr } = await supabase
      .from(table)
      .select("id, job_title, job_description, location")
      .in("id", job_ids)
      .eq("radar_enriched", false);

    if (jobErr) throw jobErr;
    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ enriched: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let enrichedCount = 0;
    const batchSize = 5;

    for (let i = 0; i < jobs.length; i += batchSize) {
      const batch = jobs.slice(i, i + batchSize);
      const prompt = `Extract structured data from these job postings. For each job, return a JSON array with objects:
{
  "job_id": "uuid",
  "extracted_skills": ["skill1", "skill2"],
  "extracted_experience_years": number or null,
  "extracted_tax_terms": ["W2", "C2C", "1099"] or [],
  "extracted_visa_types": ["H1B", "GC", "USC"] or [],
  "extracted_hourly_rate_min": number or null,
  "extracted_hourly_rate_max": number or null,
  "extracted_role_normalized": "normalized job title"
}

Jobs:
${batch.map(j => `ID: ${j.id}\nTitle: ${j.job_title}\nLocation: ${j.location}\nDescription: ${(j.job_description ?? "").slice(0, 1000)}`).join("\n---\n")}

Return ONLY the JSON array.`;

      for (const model of GEMINI_MODELS) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
            }),
          });
          if (!res.ok) continue;
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) continue;

          const parsed = JSON.parse(text);
          const results = Array.isArray(parsed) ? parsed : [parsed];

          for (const r of results) {
            const { error: updateErr } = await supabase
              .from(table)
              .update({
                extracted_skills: r.extracted_skills ?? [],
                extracted_experience_years: r.extracted_experience_years ?? null,
                extracted_tax_terms: r.extracted_tax_terms ?? [],
                extracted_visa_types: r.extracted_visa_types ?? [],
                extracted_hourly_rate_min: r.extracted_hourly_rate_min ?? null,
                extracted_hourly_rate_max: r.extracted_hourly_rate_max ?? null,
                extracted_role_normalized: r.extracted_role_normalized ?? null,
                radar_enriched: true,
              })
              .eq("id", r.job_id);

            if (!updateErr) enrichedCount++;
          }
          break;
        } catch {
          continue;
        }
      }
    }

    return new Response(JSON.stringify({ enriched: enrichedCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
