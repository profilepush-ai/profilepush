import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Atomically claim the next pending job
  const { data: rows, error: claimErr } = await supabase.rpc("claim_next_llm_job");
  if (claimErr) {
    return new Response(JSON.stringify({ error: claimErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const job = Array.isArray(rows) ? rows[0] : null;
  if (!job) {
    return new Response(JSON.stringify({ processed: 0, message: "Queue empty" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const fnUrl  = `${SUPABASE_URL}/functions/v1/${job.type}`;
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "X-From-Queue":  "true",
  };

  let res: Response;
  try {
    headers["Content-Type"] = "application/json";
    if (job.type === "parse-resume") {
      // Call parse-resume in JSON mode with the stored base64 payload
      res = await fetch(fnUrl, {
        method:  "POST",
        headers,
        body: JSON.stringify({
          base64_pdf: job.payload.base64_pdf,
          filename:   job.payload.filename ?? "resume.pdf",
        }),
      });
    } else {
      // score-job-match / rewrite-resume: replay the original payload
      res = await fetch(fnUrl, {
        method:  "POST",
        headers,
        body: JSON.stringify(job.payload),
      });
    }
  } catch (fetchErr) {
    const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    await markJobFailed(supabase, job, errMsg);
    return new Response(JSON.stringify({ processed: 0, error: errMsg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const resultBody = await res.json().catch(() => ({}));

  if (res.ok && !resultBody.error) {
    // Success — store result and mark completed
    await supabase.from("llm_job_queue").update({
      status:       "completed",
      result:       resultBody,
      provider_used: resultBody.model ?? null,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);

    return new Response(JSON.stringify({ processed: 1, job_id: job.id, type: job.type }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Failure — retry or dead-letter
  await markJobFailed(supabase, job, resultBody.error ?? `HTTP ${res.status}`);
  return new Response(
    JSON.stringify({ processed: 0, job_id: job.id, error: resultBody.error }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

async function markJobFailed(
  supabase: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
  errorMsg: string,
) {
  const attempts    = job.attempts as number;
  const maxAttempts = job.max_attempts as number;

  if (attempts >= maxAttempts) {
    await supabase.from("llm_job_queue")
      .update({ status: "dead", error: errorMsg })
      .eq("id", job.id);
  } else {
    // Exponential backoff: 30s, 60s, 120s, 240s …
    const delayMs = Math.pow(2, attempts - 1) * 30_000;
    await supabase.from("llm_job_queue").update({
      status:        "pending",
      error:         errorMsg,
      process_after: new Date(Date.now() + delayMs).toISOString(),
    }).eq("id", job.id);
  }
}
