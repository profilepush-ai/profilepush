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

const EMBEDDING_BATCH_SIZE = Math.max(Number(Deno.env.get("EMBEDDING_BATCH_SIZE") ?? "10"), 1);
const EMBEDDING_BATCH_DELAY_MS = Math.max(Number(Deno.env.get("EMBEDDING_BATCH_DELAY_MS") ?? "250"), 0);
const OPENAI_MAX_RETRIES = Math.max(Number(Deno.env.get("OPENAI_EMBEDDING_MAX_RETRIES") ?? "4"), 0);
const OPENAI_RETRY_BASE_MS = Math.max(Number(Deno.env.get("OPENAI_EMBEDDING_RETRY_BASE_MS") ?? "500"), 100);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const OPENAI_EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body: EmbeddingRequest | EmbeddingRequest[] = await req.json();
    const requests = Array.isArray(body) ? body : [body];
    const queue = [...requests];

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    while (queue.length > 0) {
      const batch = queue.splice(0, EMBEDDING_BATCH_SIZE);

      for (const item of batch) {
        const result = await processEmbeddingRequest(item, supabase, OPENAI_API_KEY, OPENAI_EMBEDDING_MODEL);
        results.push(result);
      }

      if (queue.length > 0 && EMBEDDING_BATCH_DELAY_MS > 0) {
        await sleep(EMBEDDING_BATCH_DELAY_MS);
      }
    }

    return new Response(JSON.stringify({
      results,
      meta: {
        requested: requests.length,
        batch_size: EMBEDDING_BATCH_SIZE,
        batch_delay_ms: EMBEDDING_BATCH_DELAY_MS,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processEmbeddingRequest(
  item: EmbeddingRequest,
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  model: string,
): Promise<{ id: string; success: boolean; error?: string }> {
  try {
    let text = "";

    if (item.type === "profile") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("candidate_name, target_role, core_skills, years_experience, visa_status, work_type, preferred_locations, desired_salary_min, desired_salary_max, relocation_open, work_authorization, priority_skills")
        .eq("id", item.id)
        .maybeSingle();

      if (!profile) {
        return { id: item.id, success: false, error: "Profile not found" };
      }

      text = buildProfileText(profile);

      const embeddingResult = await generateOpenAIEmbedding(text, apiKey, model);
      if (!embeddingResult.embedding) {
        return { id: item.id, success: false, error: embeddingResult.error ?? "OpenAI embedding generation failed" };
      }

      const { error } = await supabase
        .from("profiles")
        .update({ profile_embedding: JSON.stringify(embeddingResult.embedding) })
        .eq("id", item.id);

      return error
        ? { id: item.id, success: false, error: error.message }
        : { id: item.id, success: true };
    }

    if (item.type === "job") {
      const table = item.table;
      if (!table) {
        return { id: item.id, success: false, error: "table is required for job type" };
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
        return { id: item.id, success: false, error: "Job not found" };
      }

      text = buildJobText(job, locationCol);

      const embeddingResult = await generateOpenAIEmbedding(text, apiKey, model);
      if (!embeddingResult.embedding) {
        return { id: item.id, success: false, error: embeddingResult.error ?? "OpenAI embedding generation failed" };
      }

      const { error } = await supabase
        .from(table)
        .update({ job_embedding: JSON.stringify(embeddingResult.embedding) })
        .eq("id", item.id);

      return error
        ? { id: item.id, success: false, error: error.message }
        : { id: item.id, success: true };
    }

    return { id: item.id, success: false, error: `Unsupported embedding request type: ${String((item as { type?: string }).type)}` };
  } catch (err) {
    return { id: item.id, success: false, error: (err as Error).message };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (!retryAfterHeader) return null;

  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.round(seconds * 1000);
  }

  const retryDateMs = Date.parse(retryAfterHeader);
  if (!Number.isNaN(retryDateMs)) {
    const delta = retryDateMs - Date.now();
    return delta > 0 ? delta : null;
  }

  return null;
}

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

async function generateOpenAIEmbedding(
  text: string,
  apiKey: string,
  model: string,
): Promise<{ embedding: number[] | null; error?: string }> {
  for (let attempt = 0; attempt <= OPENAI_MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: text,
          dimensions: 768,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const embedding = data?.data?.[0]?.embedding;

        if (!Array.isArray(embedding)) {
          return { embedding: null, error: "OpenAI embeddings response missing data[0].embedding" };
        }

        return { embedding };
      }

      const errText = await res.text();
      const shouldRetry = res.status === 429 || res.status >= 500;
      if (!shouldRetry || attempt === OPENAI_MAX_RETRIES) {
        return { embedding: null, error: `OpenAI embeddings API ${res.status}: ${errText}` };
      }

      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
      const backoffMs = Math.min(OPENAI_RETRY_BASE_MS * (2 ** attempt), 10000);
      const jitterMs = Math.floor(Math.random() * 200);
      await sleep((retryAfterMs ?? backoffMs) + jitterMs);
    } catch (err) {
      if (attempt === OPENAI_MAX_RETRIES) {
        return { embedding: null, error: (err as Error).message };
      }

      const backoffMs = Math.min(OPENAI_RETRY_BASE_MS * (2 ** attempt), 10000);
      const jitterMs = Math.floor(Math.random() * 200);
      await sleep(backoffMs + jitterMs);
    }
  }

  return { embedding: null, error: "OpenAI embedding generation failed after retries" };
}
