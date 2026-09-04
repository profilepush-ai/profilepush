import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Called by the frontend right after submit_job_application() inserts a
// job_applications row. Does the async follow-up work that couldn't live in
// a plain SQL RPC: parse the resume (parse-resume), generate the first
// screening question (Workers AI, via the social-job-parser Cloudflare
// Worker's /generate-screening-question route), and email the candidate
// their screening link. Runs with the service role — writes directly to
// job_applications/job_application_screening_turns rather than through an
// RPC, same as receive-social-job does for its own tables.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const APP_BASE_URL = "https://profilepush.ai";
const MAX_SCREENING_TURNS = 5;

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function buildResumeSummary(parsed: Record<string, unknown> | null): string {
  if (!parsed) return "";
  const lines: string[] = [];
  if (parsed.candidate_name) lines.push(`Name: ${parsed.candidate_name}`);
  if (parsed.target_role) lines.push(`Target role: ${parsed.target_role}`);
  if (parsed.years_experience) lines.push(`Years of experience: ${parsed.years_experience}`);
  if (Array.isArray(parsed.core_skills) && parsed.core_skills.length > 0) {
    lines.push(`Core skills: ${(parsed.core_skills as string[]).join(", ")}`);
  }
  if (Array.isArray(parsed.experience)) {
    for (const entry of parsed.experience as Array<Record<string, unknown>>) {
      const title = asString(entry.title);
      const company = asString(entry.company);
      const description = asString(entry.description);
      if (!title && !company) continue;
      lines.push(`- ${title || "Role"} at ${company || "a company"}${description ? `: ${description.slice(0, 300)}` : ""}`);
    }
  }
  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Verify the caller has a real session (any active recruiter can trigger
    // processing for an application they just created) without trusting a
    // client-supplied user id.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({})) as { applicationId?: string };
    const applicationId = asString(body.applicationId).trim();
    if (!applicationId) return respond({ error: "applicationId is required" }, 400);

    const { data: application, error: appError } = await supabase
      .from("job_applications")
      .select("id, social_job_id, candidate_name, candidate_email, resume_url, status, resume_parsed_json")
      .eq("id", applicationId)
      .maybeSingle();
    if (appError) return respond({ error: appError.message }, 500);
    if (!application) return respond({ error: "Application not found" }, 404);
    if (application.status !== "submitted") {
      return respond({ ok: true, skipped: "already processed" });
    }

    const { data: job, error: jobError } = await supabase
      .from("social_jobs")
      .select("job_title, job_description, post_content, company_name")
      .eq("id", application.social_job_id)
      .maybeSingle();
    if (jobError) return respond({ error: jobError.message }, 500);

    const jobTitle = asString(job?.job_title) || "this role";
    const jobDescription = asString(job?.job_description) || asString(job?.post_content);

    // The Apply modal parses the resume itself (to derive candidate
    // name/email before submitting) and passes the result straight into
    // submit_job_application — reuse it here rather than parsing again.
    let resumeParsed: Record<string, unknown> | null =
      (application.resume_parsed_json as Record<string, unknown> | null) ?? null;

    if (!resumeParsed) {
      // Fallback for applications submitted without a pre-parsed resume —
      // best-effort; a parse failure shouldn't block sending the candidate
      // their screening link.
      try {
        const resumeResponse = await fetch(application.resume_url);
        if (resumeResponse.ok) {
          const resumeBlob = await resumeResponse.blob();
          const filename = application.resume_url.split("/").pop() || "resume.pdf";
          const formData = new FormData();
          formData.append("resume", resumeBlob, filename);
          const parseResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/parse-resume`, {
            method: "POST",
            body: formData,
          });
          if (parseResponse.ok) {
            const parsed = await parseResponse.json();
            // parse-resume returns 202 {queued:true, job_id} when every LLM
            // provider was temporarily unavailable and it fell back to a
            // background queue instead of parsing inline — that stub has none
            // of the real resume fields, so treat it the same as "no parse"
            // rather than storing it as if it were the parsed resume.
            if (parsed && !parsed.queued) resumeParsed = parsed;
          } else {
            console.error("process-job-application: parse-resume failed", parseResponse.status, await parseResponse.text());
          }
        }
      } catch (error) {
        console.error("process-job-application: resume fetch/parse errored", error);
      }
    }

    if (resumeParsed && !application.resume_parsed_json) {
      await supabase.from("job_applications").update({ resume_parsed_json: resumeParsed }).eq("id", applicationId);
    }

    const resumeSummary = buildResumeSummary(resumeParsed) || `Candidate name: ${application.candidate_name}`;

    const workerUrl = (Deno.env.get("CLOUDFLARE_WORKER_URL") ?? "").trim();
    const workerToken = (Deno.env.get("CLOUDFLARE_WORKER_TOKEN") ?? "").trim();
    if (!workerUrl) return respond({ error: "Screening question service is not configured" }, 500);

    const questionResponse = await fetch(`${workerUrl.replace(/\/$/, "")}/generate-screening-question`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
      },
      body: JSON.stringify({
        resumeSummary,
        jobTitle,
        jobDescription,
        priorTurns: [],
        maxTurns: MAX_SCREENING_TURNS,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const questionPayload = await questionResponse.json().catch(() => ({})) as { question?: string; error?: string };
    if (!questionResponse.ok || !questionPayload.question) {
      return respond({ error: questionPayload.error || "Could not generate the first screening question" }, 502);
    }

    const { error: turnError } = await supabase.from("job_application_screening_turns").insert({
      application_id: applicationId,
      turn_index: 0,
      question_text: questionPayload.question,
    });
    if (turnError) return respond({ error: turnError.message }, 500);

    const { data: applicationRow, error: tokenError } = await supabase
      .from("job_applications")
      .select("screening_token")
      .eq("id", applicationId)
      .single();
    if (tokenError || !applicationRow) return respond({ error: tokenError?.message || "Could not load screening token" }, 500);

    await supabase.from("job_applications").update({ status: "screening_sent" }).eq("id", applicationId);

    // Email the candidate their screening link — best-effort, same as the
    // resume parse: an email failure shouldn't fail the whole request, since
    // the application + first question already exist and can be resent.
    try {
      const emailWorkerUrl = (Deno.env.get("EMAIL_WORKER_URL") ?? "").trim();
      const emailWorkerToken = (Deno.env.get("EMAIL_WORKER_TOKEN") ?? "").trim();
      if (emailWorkerUrl && emailWorkerToken && application.candidate_email) {
        const screeningUrl = `${APP_BASE_URL}/screen/${applicationRow.screening_token}`;
        const candidateFirstName = (application.candidate_name || "").trim().split(/\s+/)[0] || "";
        const greeting = candidateFirstName ? `Hi ${candidateFirstName},` : "Hi,";
        const subject = `Quick video screening for ${jobTitle}`;
        const text = `${greeting}\n\nYou've been submitted for "${jobTitle}"${job?.company_name ? ` at ${job.company_name}` : ""}. Before this moves forward, please complete a short video screening — a few quick questions, answered on camera, no account needed:\n\n${screeningUrl}\n\nIt takes just a few minutes.\n\n— ProfilePush`;
        const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
          <p>${greeting}</p>
          <p>You've been submitted for <strong>${jobTitle}</strong>${job?.company_name ? ` at ${job.company_name}` : ""}. Before this moves forward, please complete a short video screening — a few quick questions, answered on camera, no account needed.</p>
          <p><a href="${screeningUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;">Start screening</a></p>
          <p style="color:#64748b;font-size:12px;">It takes just a few minutes.</p>
        </body></html>`;

        const sendResponse = await fetch(`${emailWorkerUrl.replace(/\/$/, "")}/send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${emailWorkerToken}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({ to: application.candidate_email, subject, html, text }),
        });
        if (!sendResponse.ok) {
          console.error("process-job-application: email send failed", sendResponse.status, await sendResponse.text());
        }
      }
    } catch (error) {
      console.error("process-job-application: email send errored", error);
    }

    return respond({ ok: true });
  } catch (error) {
    console.error("process-job-application error", error);
    return respond({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
