import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Lets a user paste the free-text "hotlist"/job post they already write for
// LinkedIn or WhatsApp groups and auto-fills the Post form fields from it,
// instead of asking them to type ~15 fields by hand.
//
// This is a thin proxy onto the existing profilepush-social-job-parser
// Cloudflare Worker (Workers AI, same infra the scraper pipeline already
// uses for job/hotlist extraction) rather than a direct Gemini call — reuses
// CLOUDFLARE_WORKER_URL/CLOUDFLARE_WORKER_TOKEN, already configured for
// predict-match and receive-social-job. The worker's /extract-job and
// /extract-hotlist routes are built for batches of *scraped* posts; a
// user-typed single post is sent through the same routes as a one-item
// batch, then the response is unwrapped/remapped into the flat shape the
// Post form expects.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

type JobExtractResult = {
  role_title?: string;
  company_name?: string;
  core_skills?: string[];
  years_experience?: number | null;
  visa_types?: string[];
  employment_type?: string;
  work_type?: string;
  locations?: string[];
  hourly_rate_min?: number | null;
  hourly_rate_max?: number | null;
};

type HotlistCandidate = {
  candidate_name?: string;
  role_title?: string;
  core_skills?: string[];
  years_experience?: number | null;
  visa_type?: string;
  employment_type?: string;
  work_type?: string;
  locations?: string[];
  hourly_rate_min?: number | null;
  hourly_rate_max?: number | null;
  availability?: string;
  candidate_summary?: string;
};

type HotlistExtractResult = {
  bench_sales_recruiter_name?: string;
  candidates?: HotlistCandidate[];
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

  const body = await req.json().catch(() => ({}));
  const kind = body?.kind === "hotlist" ? "hotlist" : body?.kind === "job" ? "job" : null;
  const text = String(body?.text ?? "").trim();
  if (!kind) return jsonError("kind must be 'job' or 'hotlist'");
  if (!text) return jsonError("text is required");
  if (text.length > 8000) return jsonError("text is too long");

  const authHeader = req.headers.get("Authorization");
  let userId: string | null = null;
  if (authHeader) {
    try {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id ?? null;
    } catch { /* treated as unauthorized below */ }
  }
  if (!userId) return jsonError("Unauthorized", 401);

  const workerUrl = (Deno.env.get("CLOUDFLARE_WORKER_URL") ?? "").trim();
  const workerToken = (Deno.env.get("CLOUDFLARE_WORKER_TOKEN") ?? "").trim();
  if (!workerUrl) return jsonError("Extraction service is not configured", 500);

  const route = kind === "job" ? "extract-job" : "extract-hotlist";

  let workerResponse: Response;
  try {
    workerResponse = await fetch(`${workerUrl.replace(/\/$/, "")}/${route}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
      },
      body: JSON.stringify({
        jobs: [{ id: "draft", title: "", description: text, location: "" }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    return jsonError(`Could not reach extraction service: ${(error as Error).message}`, 503);
  }

  const workerPayload = await workerResponse.json().catch(() => ({} as Record<string, unknown>));
  if (!workerResponse.ok) {
    return jsonError(String(workerPayload?.error ?? `Extraction service HTTP ${workerResponse.status}`), 502);
  }

  const results = Array.isArray(workerPayload?.results) ? workerPayload.results : [];
  if (results.length === 0) {
    return jsonError("Could not extract any fields from that text — try adding more detail", 422);
  }

  if (kind === "job") {
    const r = results[0] as JobExtractResult;
    const fields = {
      job_title: r.role_title ?? "",
      company_name: r.company_name ?? "",
      location: Array.isArray(r.locations) && r.locations.length > 0 ? r.locations[0] : "",
      employment_type: r.employment_type ?? "",
      seniority_level: "",
      salary_range: "",
      job_description: "",
      skills: Array.isArray(r.core_skills) ? r.core_skills : [],
      experience_years: r.years_experience ?? 0,
      visa_types: Array.isArray(r.visa_types) ? r.visa_types : [],
      hourly_rate_min: r.hourly_rate_min ?? 0,
      hourly_rate_max: r.hourly_rate_max ?? 0,
    };
    return new Response(JSON.stringify({ ok: true, fields }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const r = results[0] as HotlistExtractResult;
  const candidate = Array.isArray(r.candidates) && r.candidates.length > 0 ? r.candidates[0] : {};
  const fields = {
    role_title: candidate.role_title ?? "",
    candidate_name: candidate.candidate_name ?? "",
    core_skills: Array.isArray(candidate.core_skills) ? candidate.core_skills : [],
    years_experience: candidate.years_experience ?? 0,
    visa_type: candidate.visa_type ?? "",
    employment_type: candidate.employment_type ?? "",
    work_type: candidate.work_type ?? "",
    locations: Array.isArray(candidate.locations) ? candidate.locations : [],
    hourly_rate_min: candidate.hourly_rate_min ?? 0,
    hourly_rate_max: candidate.hourly_rate_max ?? 0,
    availability: candidate.availability ?? "",
    candidate_summary: candidate.candidate_summary ?? "",
  };
  return new Response(JSON.stringify({ ok: true, fields }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});
