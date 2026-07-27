import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EmbeddingRequest {
  type: "profile" | "job";
  id: string;
  table?: string;
}

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
    const body: EmbeddingRequest | EmbeddingRequest[] = await req.json();
    const requests = Array.isArray(body) ? body : [body];

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const item of requests) {
      try {
        let text = "";

        if (item.type === "profile") {
          const { data: profile } = await supabase
            .from("profiles")
            .select("candidate_name, target_role, core_skills, years_experience, visa_status, work_type, preferred_locations, desired_salary_min, desired_salary_max, relocation_open, work_authorization, priority_skills")
            .eq("id", item.id)
            .maybeSingle();

          if (!profile) {
            results.push({ id: item.id, success: false, error: "Profile not found" });
            continue;
          }

          text = buildProfileText(profile);

          const embedding = await generateGeminiEmbedding(text, GEMINI_API_KEY);
          if (!embedding) {
            results.push({ id: item.id, success: false, error: "Gemini embedding generation failed" });
            continue;
          }

          const { error } = await supabase
            .from("profiles")
            .update({ profile_embedding: JSON.stringify(embedding) })
            .eq("id", item.id);

          if (error) {
            results.push({ id: item.id, success: false, error: error.message });
          } else {
            results.push({ id: item.id, success: true });
          }
        } else if (item.type === "job") {
          const table = item.table;
          if (!table) {
            results.push({ id: item.id, success: false, error: "table is required for job type" });
            continue;
          }

          const locationCol = ["indeed_jobs", "monster_jobs", "careerbuilder_jobs"].includes(table)
            ? "location_display"
            : "location";

          const { data: job } = await supabase
            .from(table)
            .select(`job_title, job_description, ${locationCol}, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max`)
            .eq("id", item.id)
            .maybeSingle();

          if (!job) {
            results.push({ id: item.id, success: false, error: "Job not found" });
            continue;
          }

          text = buildJobText(job, locationCol);

          const embedding = await generateGeminiEmbedding(text, GEMINI_API_KEY);
          if (!embedding) {
            results.push({ id: item.id, success: false, error: "Gemini embedding generation failed" });
            continue;
          }

          const { error } = await supabase
            .from(table)
            .update({ job_embedding: JSON.stringify(embedding) })
            .eq("id", item.id);

          if (error) {
            results.push({ id: item.id, success: false, error: error.message });
          } else {
            results.push({ id: item.id, success: true });
          }
        }
      } catch (err) {
        results.push({ id: item.id, success: false, error: (err as Error).message });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function buildProfileText(profile: Record<string, unknown>): string {
  const parts: string[] = [];

  if (profile.target_role) parts.push(`Target Role: ${profile.target_role}`);
  if (profile.core_skills) parts.push(`Core Skills: ${profile.core_skills}`);
  if (profile.priority_skills) parts.push(`Priority Skills: ${profile.priority_skills}`);
  if (profile.years_experience) parts.push(`Experience: ${profile.years_experience} years`);
  if (profile.visa_status) parts.push(`Visa Status: ${profile.visa_status}`);
  if (profile.work_authorization) parts.push(`Work Authorization: ${profile.work_authorization}`);
  if (profile.work_type) parts.push(`Work Type Preference: ${profile.work_type}`);
  if (profile.preferred_locations) parts.push(`Preferred Locations: ${profile.preferred_locations}`);
  if (profile.desired_salary_min || profile.desired_salary_max) {
    parts.push(`Desired Rate: $${profile.desired_salary_min ?? '?'}-$${profile.desired_salary_max ?? '?'}/hr`);
  }
  if (profile.relocation_open) parts.push(`Open to Relocation: Yes`);

  return parts.join(". ");
}

function buildJobText(job: Record<string, unknown>, locationCol: string): string {
  const parts: string[] = [];

  if (job.job_title) parts.push(`Job Title: ${job.job_title}`);

  const skills = job.extracted_skills;
  if (skills) {
    const skillsStr = Array.isArray(skills) ? skills.join(", ") : String(skills);
    if (skillsStr) parts.push(`Required Skills: ${skillsStr}`);
  }

  if (job.extracted_experience_years != null) {
    parts.push(`Required Experience: ${job.extracted_experience_years} years`);
  }

  const visaTypes = job.extracted_visa_types;
  if (visaTypes) {
    const visaStr = Array.isArray(visaTypes) ? visaTypes.join(", ") : String(visaTypes);
    if (visaStr) parts.push(`Visa Types: ${visaStr}`);
  }

  if (job.extracted_hourly_rate_min || job.extracted_hourly_rate_max) {
    parts.push(`Rate: $${job.extracted_hourly_rate_min ?? '?'}-$${job.extracted_hourly_rate_max ?? '?'}/hr`);
  }

  const location = job[locationCol];
  if (location) parts.push(`Location: ${location}`);

  const desc = (job.job_description as string) ?? "";
  if (desc) parts.push(`Description: ${desc.slice(0, 1500)}`);

  return parts.join(". ");
}

async function generateGeminiEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data?.embedding?.values ?? null;
  } catch {
    return null;
  }
}
