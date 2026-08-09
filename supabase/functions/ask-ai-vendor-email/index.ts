import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const CRM_WEBHOOK_URL = "https://services.leadconnectorhq.com/hooks/48XyGfN1WxneooOcHGHn/webhook-trigger/5acdf9f6-c8e2-44ea-91be-163a46cf83fd";
const ASK_VENDOR_AI_URL = "https://profilepush-social-job-queue-consumer.profilepush-ai.workers.dev/ask-vendor-email-copy";
const ASK_AI_COST = 0.01;
const SENDER_NAME_TOKEN = "{{sender_name}}";

function respond(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asString(value: unknown, maxLength = 10_000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function asVendorName(value: unknown) {
  const name = asString(value, 200);
  return /^(vendor contact|unknown poster|unknown|n\/a)$/i.test(name) ? "" : name;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toSharedDraft(value: string, senderName: string) {
  return value.replace(new RegExp(escapeRegExp(senderName), "g"), SENDER_NAME_TOKEN);
}

function hydrateSharedDraft(value: unknown, senderName: string, maxLength: number) {
  return asString(value, maxLength).replaceAll(SENDER_NAME_TOKEN, senderName);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return respond({ error: "Unauthorized" }, 401);

    const body = await req.json() as Record<string, unknown>;
    const action = asString(body.action, 20);
    const requestId = asString(body.request_id, 100);
    const accountId = asString(body.account_id, 100);
    const jobId = asString(body.job_id, 100);
    const missingDetails = Array.isArray(body.missing_details)
      ? body.missing_details.map((item) => asString(item, 100)).filter(Boolean).slice(0, 20)
      : [];
    const missingDetailsKey = JSON.stringify(
      [...new Set(missingDetails.map((detail) => detail.toLowerCase()))].sort(),
    );

    if (!['preview', 'send'].includes(action) || !accountId || !jobId || missingDetails.length === 0) {
      return respond({ error: "Job and missing details are required" }, 400);
    }
    if (action === 'send' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return respond({ error: "A valid request ID is required" }, 400);
    }

    const { data: membership } = await supabaseAdmin
      .from("account_members")
      .select("account_id")
      .eq("account_id", accountId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!membership) return respond({ error: "Account access denied" }, 403);

    const { data: account, error: accountError } = await supabaseAdmin
      .from("accounts")
      .select("id, name, owner_id")
      .eq("id", accountId)
      .maybeSingle();
    if (accountError || !account) return respond({ error: "Account not found" }, 404);

    const { data: job, error: jobError } = await supabaseAdmin
      .from("social_jobs")
      .select("id, vendor_id, platform, posted_by_name, poster_email, job_title, company_name, location, post_content")
      .eq("id", jobId)
      .maybeSingle();
    if (jobError || !job) return respond({ error: "Job not found" }, 404);

    const vendorEmail = asString(job.poster_email, 320).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(vendorEmail)) {
      return respond({ error: "This job does not have a valid vendor email" }, 400);
    }

    const { data: vendor } = job.vendor_id
      ? await supabaseAdmin
        .from("social_vendors")
        .select("name")
        .eq("id", job.vendor_id)
        .maybeSingle()
      : { data: null };
    const vendorName = asVendorName(vendor?.name) || asVendorName(job.posted_by_name);
    const vendorDisplayName = vendorName || vendorEmail;

    const requesterName = asString(user.user_metadata?.full_name ?? user.user_metadata?.name, 200)
      || user.email?.split("@")[0]
      || "Recruiter";
    const requesterFirstName = requesterName.split(/\s+/)[0] || "Recruiter";
    const requesterPhone = asString(user.phone ?? user.user_metadata?.phone, 50) || null;

    let emailSubject = asString(body.email_subject, 300);
    let emailContent = asString(body.email_content, 2_000);
    if (action === 'preview') {
      const { data: cachedDraft, error: cachedDraftError } = await supabaseAdmin
        .from("pulse_ask_ai_drafts")
        .select("email_subject, email_content_template")
        .eq("job_id", jobId)
        .eq("missing_details_key", missingDetailsKey)
        .maybeSingle();
      if (cachedDraftError) throw cachedDraftError;

      if (cachedDraft) {
        emailSubject = hydrateSharedDraft(cachedDraft.email_subject, requesterFirstName, 300);
        emailContent = hydrateSharedDraft(cachedDraft.email_content_template, requesterFirstName, 2_000);
        return respond({
          ok: true,
          preview: true,
          cached: true,
          vendor_name: vendorDisplayName,
          vendor_email: vendorEmail,
          missing_details: missingDetails,
          email_subject: emailSubject,
          email_content: emailContent,
        });
      }

      const askVendorAiToken = Deno.env.get("ASK_VENDOR_AI_TOKEN")?.trim();
      if (!askVendorAiToken) return respond({ error: "Could not generate the vendor request" }, 503);

      try {
        const aiResponse = await fetch(ASK_VENDOR_AI_URL, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${askVendorAiToken}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            job_title: asString(job.job_title, 500) || "Open role",
            job_location: asString(job.location, 500) || "Not specified",
            vendor_name: vendorName || "there",
            missing_data_type: missingDetails.join(", "),
            bench_recruiter_first_name: requesterFirstName,
          }),
        });
        const aiPayload = await aiResponse.json().catch(() => null) as Record<string, unknown> | null;
        emailSubject = asString(aiPayload?.subject, 300);
        emailContent = asString(aiPayload?.email_content, 2_000);
        if (!aiResponse.ok || !emailSubject || !emailContent || /profilepush/i.test(`${emailSubject}\n${emailContent}`)) {
          throw new Error(`Ask Vendor AI HTTP ${aiResponse.status}`);
        }
      } catch (error) {
        console.error("Could not generate Ask Vendor email", error);
        return respond({ error: "Could not generate the vendor request" }, 502);
      }

      const { error: draftInsertError } = await supabaseAdmin
        .from("pulse_ask_ai_drafts")
        .upsert({
          job_id: jobId,
          missing_details: missingDetails,
          missing_details_key: missingDetailsKey,
          email_subject: toSharedDraft(emailSubject, requesterFirstName),
          email_content_template: toSharedDraft(emailContent, requesterFirstName),
          updated_at: new Date().toISOString(),
        }, { onConflict: "job_id,missing_details_key" });
      if (draftInsertError) {
        console.error("Could not save shared Ask Vendor draft", draftInsertError);
        return respond({ error: "Could not save the generated vendor request" }, 500);
      }

      return respond({
        ok: true,
        preview: true,
        cached: false,
        vendor_name: vendorDisplayName,
        vendor_email: vendorEmail,
        missing_details: missingDetails,
        email_subject: emailSubject,
        email_content: emailContent,
      });
    }

    const emailWordCount = emailContent.split(/\s+/).filter(Boolean).length;
    if (!emailSubject || !emailContent || emailWordCount >= 40 || /profilepush/i.test(`${emailSubject}\n${emailContent}`)) {
      return respond({ error: "Approved email must be under 40 words and cannot mention ProfilePush" }, 400);
    }

    const { error: requestInsertError } = await supabaseAdmin
      .from("pulse_ask_ai_requests")
      .insert({
        request_id: requestId,
        account_id: accountId,
        user_id: user.id,
        job_id: jobId,
        status: "processing",
        missing_details: missingDetails,
      });

    if (requestInsertError) {
      if (requestInsertError.code !== "23505") throw requestInsertError;

      const { data: existingRequest } = await supabaseAdmin
        .from("pulse_ask_ai_requests")
        .select("status, charged_amount")
        .eq("request_id", requestId)
        .eq("account_id", accountId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingRequest?.status === "completed") {
        return respond({
          ok: true,
          email_sent: true,
          charged: Number(existingRequest.charged_amount ?? ASK_AI_COST),
          vendor_name: vendorDisplayName,
          vendor_email: vendorEmail,
          missing_details: missingDetails,
        });
      }
      return respond({
        error: existingRequest?.status === "charged"
          ? "This request was charged and is awaiting delivery confirmation"
          : "This Ask AI request is already being processed",
        request_status: existingRequest?.status ?? "unknown",
      }, 409);
    }

    const { data: creditRows, error: creditError } = await supabaseUser.rpc("consume_feature_credit", {
      p_account_id: accountId,
      p_amount: ASK_AI_COST,
      p_feature: "pulse_ask_ai",
      p_metadata: { request_id: requestId, job_id: jobId, vendor_email: vendorEmail, missing_details: missingDetails },
    });
    const creditResult = Array.isArray(creditRows) ? creditRows[0] : null;
    if (creditError || !creditResult?.success) {
      await supabaseAdmin
        .from("pulse_ask_ai_requests")
        .update({ status: "failed", error_message: creditError?.message ?? creditResult?.message ?? "Credit charge failed", updated_at: new Date().toISOString() })
        .eq("request_id", requestId);
      return respond({ error: creditResult?.message ?? creditError?.message ?? "Could not charge Ask AI credits" }, 402);
    }

    const { error: chargedStatusError } = await supabaseAdmin
      .from("pulse_ask_ai_requests")
      .update({ status: "charged", charged_amount: ASK_AI_COST, updated_at: new Date().toISOString() })
      .eq("request_id", requestId);
    if (chargedStatusError) {
      const { error: refundError } = await supabaseAdmin.rpc("refund_feature_credit", {
        p_account_id: accountId,
        p_amount: ASK_AI_COST,
        p_feature: "pulse_ask_ai_state_failed",
      });
      console.error("Could not persist Ask AI charged state", chargedStatusError, refundError);
      return respond({ error: refundError ? "Could not start the request; contact support about the credit charge" : "Could not start the request; the credit charge was refunded" }, 500);
    }

    const refundWebhookFailure = async (webhookError: string) => {
      console.error("Ask AI CRM webhook failed", webhookError);
      const { error: refundError } = await supabaseAdmin.rpc("refund_feature_credit", {
        p_account_id: accountId,
        p_amount: ASK_AI_COST,
        p_feature: "pulse_ask_ai_webhook_failed",
      });
      await supabaseAdmin
        .from("pulse_ask_ai_requests")
        .update({
          status: refundError ? "failed" : "refunded",
          error_message: refundError ? `${webhookError}; refund failed: ${refundError.message}` : webhookError,
          updated_at: new Date().toISOString(),
        })
        .eq("request_id", requestId);
      return respond({ error: refundError ? "Could not send the request; contact support about the credit charge" : "Could not send the request; the credit charge was refunded" }, 502);
    };

    let webhookResponse: Response;
    try {
      webhookResponse = await fetch(CRM_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          action: "Ask Vendor",
          event: "ask_ai.vendor_email",
          request_id: requestId,
          job_id: job.id,
          timestamp: new Date().toISOString(),
          platform: "profilepush",
          account_id: account.id,
          owner_id: account.owner_id,
          user_id: user.id,
          full_name: requesterName,
          business_name: asString(account.name, 300),
          email: user.email ?? null,
          phone: requesterPhone,
          requester_name: requesterName,
          requester_email: user.email ?? null,
          vendor_id: job.vendor_id,
          vendor_name: vendorDisplayName,
          vendor_email: vendorEmail,
          job: {
            id: job.id,
            title: asString(job.job_title, 500),
            company: asString(job.company_name, 500),
            location: asString(job.location, 500),
            platform: asString(job.platform, 100),
            details: asString(job.post_content, 10_000),
          },
          missing_details: missingDetails,
          email_subject: emailSubject,
          email_content: emailContent,
          credit_charge: ASK_AI_COST,
        }),
      });
    } catch (error) {
      return await refundWebhookFailure(`CRM webhook request failed: ${(error as Error).message}`);
    }

    const webhookResponseText = (await webhookResponse.text()).slice(0, 2_000);
    if (!webhookResponse.ok) {
      return await refundWebhookFailure(`CRM webhook HTTP ${webhookResponse.status}: ${webhookResponseText.slice(0, 300)}`);
    }

    const { error: completedStatusError } = await supabaseAdmin
      .from("pulse_ask_ai_requests")
      .update({
        status: "completed",
        delivery_http_status: webhookResponse.status,
        delivery_response: webhookResponseText || null,
        delivered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("request_id", requestId);
    if (completedStatusError) {
      console.error("Ask AI email sent but completion state could not be persisted", requestId, completedStatusError);
    }

    return respond({
      ok: true,
      email_sent: true,
      charged: ASK_AI_COST,
      vendor_name: vendorDisplayName,
      vendor_email: vendorEmail,
      missing_details: missingDetails,
    });
  } catch (error) {
    console.error("ask-ai-vendor-email error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});