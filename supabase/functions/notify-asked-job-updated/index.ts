import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CRM_WEBHOOK_URL = "https://services.leadconnectorhq.com/hooks/48XyGfN1WxneooOcHGHn/webhook-trigger/074831f6-cece-4229-8d04-7f0d7cd9df06";

function respond(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asString(value: unknown, maxLength = 10_000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (req.headers.get("Authorization") !== `Bearer ${serviceRoleKey}`) {
    return respond({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const requestId = asString(body.request_id, 100);
    if (!requestId) return respond({ error: "request_id is required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);
    const { data: askRequest, error: requestError } = await supabase
      .from("pulse_ask_ai_requests")
      .select("request_id, account_id, user_id, job_id, missing_details, fulfilled_at")
      .eq("request_id", requestId)
      .eq("status", "fulfilled")
      .maybeSingle();
    if (requestError || !askRequest) return respond({ error: "Fulfilled request not found" }, 404);

    const [{ data: account }, { data: job }, { data: userResult }] = await Promise.all([
      supabase.from("accounts").select("id, name, owner_id").eq("id", askRequest.account_id).maybeSingle(),
      supabase.from("social_jobs").select("*").eq("id", askRequest.job_id).maybeSingle(),
      supabase.auth.admin.getUserById(askRequest.user_id),
    ]);
    const user = userResult?.user;
    if (!account || !job || !user?.email) return respond({ error: "Request details are incomplete" }, 422);

    const fullName = asString(user.user_metadata?.full_name ?? user.user_metadata?.name, 200)
      || user.email.split("@")[0];
    const phone = asString(user.phone ?? user.user_metadata?.phone, 50) || null;
    const title = asString(job.job_title, 500) || "Job opportunity";
    const company = asString(job.company_name, 500);
    const emailSubject = `Updated job details: ${title}${company ? ` at ${company}` : ""}`;
    const emailContent = [
      `Hi ${fullName},`,
      "",
      "The job you asked about has been updated with new details.",
      "",
      `Role: ${title}`,
      `Company: ${company || "Not specified"}`,
      `Location: ${asString(job.location, 500) || "Not specified"}`,
      `Employment type: ${asString(job.employment_type, 200) || "Not specified"}`,
      `Experience: ${job.extracted_experience_years ?? "Not specified"}`,
      `Rate: ${asString(job.salary_range, 500) || [job.extracted_hourly_rate_min, job.extracted_hourly_rate_max].filter((value) => value != null).join(" - ") || "Not specified"}`,
      `Visa: ${Array.isArray(job.extracted_visa_types) && job.extracted_visa_types.length > 0 ? job.extracted_visa_types.join(", ") : "Not specified"}`,
      `Skills: ${Array.isArray(job.extracted_skills) && job.extracted_skills.length > 0 ? job.extracted_skills.join(", ") : "Not specified"}`,
      "",
      asString(job.job_description, 10_000) || asString(job.post_content, 10_000),
      "",
      "Thanks,",
      "ProfilePush AI",
    ].join("\n");

    const webhookResponse = await fetch(CRM_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        action: "Asked Job Updated",
        event: "ask_ai.job_updated",
        request_id: askRequest.request_id,
        timestamp: new Date().toISOString(),
        platform: "profilepush",
        account_id: account.id,
        owner_id: account.owner_id,
        user_id: user.id,
        full_name: fullName,
        business_name: asString(account.name, 300),
        email: user.email,
        phone,
        requested_missing_details: askRequest.missing_details,
        fulfilled_at: askRequest.fulfilled_at,
        email_subject: emailSubject,
        email_content: emailContent,
        job: {
          id: job.id,
          title,
          company,
          location: asString(job.location, 500),
          employment_type: asString(job.employment_type, 200),
          seniority_level: asString(job.seniority_level, 200),
          salary_range: asString(job.salary_range, 500),
          experience_years: job.extracted_experience_years,
          visa_types: job.extracted_visa_types,
          hourly_rate_min: job.extracted_hourly_rate_min,
          hourly_rate_max: job.extracted_hourly_rate_max,
          skills: job.extracted_skills,
          description: asString(job.job_description, 10_000),
          original_post: asString(job.post_content, 10_000),
          post_url: asString(job.post_url, 2000),
          source_platform: asString(job.platform, 100),
          vendor_name: asString(job.posted_by_name, 200),
          vendor_email: asString(job.poster_email, 320),
          vendor_phone: asString(job.poster_phone, 50),
        },
      }),
    });

    if (!webhookResponse.ok) {
      return respond({ error: `CRM webhook HTTP ${webhookResponse.status}` }, 502);
    }

    return respond({ ok: true, request_id: requestId });
  } catch (error) {
    console.error("notify-asked-job-updated error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});