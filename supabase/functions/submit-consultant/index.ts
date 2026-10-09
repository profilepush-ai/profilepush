import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidAccessToken, sendViaGmail, type GmailAttachment } from "../_shared/gmail.ts";

// Submits one consultant (the user's own hotlist post) to one requirement:
//   { action: "preview", account_id, subject_id, job_id }            -> { subject, body, duplicate }
//   { action: "send", account_id, subject_id, job_id, request_id,
//     subject?, body? }                                               -> { ok, conversation_id }
// The email is built from the consultant's profile; the resume on file is
// attached. Sent from the user's Gmail, 1 credit, within the daily cap, and
// never twice to the same requirement for the same consultant.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const str = (v: unknown, max = 10_000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const firstName = (name: string) => {
  const f = name.trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'-]{1,20}$/.test(f) ? f[0].toUpperCase() + f.slice(1).toLowerCase() : "";
};

type Hotlist = {
  id: string; role_title: string | null; years_experience: number | null; core_skills: string[] | null;
  visa_type: string | null; locations: string[] | null; work_type: string | null;
  hourly_rate_min: number | null; hourly_rate_max: number | null; availability: string | null; candidate_summary: string | null;
};
type Job = {
  id: string; job_title: string | null; location: string | null; poster_email: string | null; posted_by_name: string | null;
  company_name: string | null; post_source: string | null; vendor_id: string | null;
};

function buildEmail(h: Hotlist, j: Job, senderName: string, hasResume: boolean) {
  const role = (h.role_title || "consultant").trim();
  const jobTitle = (j.job_title || role).trim();
  const years = h.years_experience ? `${Math.round(Number(h.years_experience))}+ years` : "";
  const skills = (h.core_skills ?? []).filter(Boolean).slice(0, 6).join(", ");
  const location = (h.locations ?? []).filter(Boolean)[0] ?? "";
  const relocate = /relocat/i.test(h.candidate_summary ?? "") ? " (open to relocation)" : "";
  const rate = h.hourly_rate_min || h.hourly_rate_max
    ? `$${h.hourly_rate_min ?? h.hourly_rate_max}${h.hourly_rate_max && h.hourly_rate_max !== h.hourly_rate_min ? `-${h.hourly_rate_max}` : ""}/hr`
    : "";
  const greeting = firstName(j.posted_by_name ?? "") ? `Hi ${firstName(j.posted_by_name ?? "")},` : "Hi,";
  const details = [
    `- Role: ${role}${years ? `, ${years}` : ""}`,
    skills ? `- Skills: ${skills}` : "",
    h.visa_type ? `- Work authorization: ${h.visa_type}` : "",
    location ? `- Location: ${location}${relocate}` : "",
    h.work_type ? `- Work type: ${h.work_type}` : "",
    rate ? `- Rate: ${rate}` : "",
    h.availability ? `- Availability: ${h.availability}` : "",
  ].filter(Boolean);
  const lines = [
    greeting,
    "",
    `I'd like to submit my consultant for your ${jobTitle} requirement${j.location ? ` (${j.location})` : ""}.`,
    "",
    ...details,
    "",
    `${hasResume ? "Resume attached. " : ""}Available for an interview this week; happy to confirm the rate and share an RTR.`,
    "",
    "Thanks,",
    senderName,
  ];
  return {
    subject: `Submission: ${role}${years ? ` (${years})` : ""} for ${jobTitle}`.slice(0, 180),
    body: lines.join("\n"),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });

  try {
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const body = await req.json() as Record<string, unknown>;
    const action = str(body.action, 20);

    // Can this career-site job page be shown inside our page? Only jobs we
    // hold are checked (their stored URL), never an arbitrary address.
    if (action === "frame_check") {
      const jobIdToCheck = str(body.job_id, 100);
      if (!UUID.test(jobIdToCheck)) return respond({ error: "job_id is required" }, 400);
      const { data: j } = await admin.from("social_jobs").select("post_url, post_source").eq("id", jobIdToCheck).maybeSingle();
      const target = str(j?.post_url, 2000);
      if (!target || j?.post_source !== "career_site" || !/^https:\/\//.test(target)) return respond({ embeddable: false });
      try {
        const res = await fetch(target, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; ProfilePushJobsBot/1.0)" }, signal: AbortSignal.timeout(8000) });
        await res.body?.cancel();
        const xfo = (res.headers.get("x-frame-options") ?? "").toLowerCase();
        const csp = (res.headers.get("content-security-policy") ?? "").toLowerCase();
        const ancestors = csp.match(/frame-ancestors([^;]*)/)?.[1]?.trim() ?? "";
        const blocked = /deny|sameorigin/.test(xfo) || (ancestors !== "" && !/(^|\s)\*(\s|$)/.test(ancestors));
        return respond({ embeddable: res.ok && !blocked, url: res.url });
      } catch {
        return respond({ embeddable: false });
      }
    }

    const accountId = str(body.account_id, 100);
    const subjectId = str(body.subject_id, 100);
    const jobId = str(body.job_id, 100);
    if (!["preview", "send"].includes(action) || !UUID.test(accountId) || !UUID.test(subjectId) || !UUID.test(jobId)) {
      return respond({ error: "account_id, subject_id and job_id are required" }, 400);
    }

    const { data: member } = await admin.from("account_members").select("display_name")
      .eq("account_id", accountId).eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (!member) return respond({ error: "Account access denied" }, 403);

    const { data: hotlist } = await admin.from("social_hotlist")
      .select("id, role_title, years_experience, core_skills, visa_type, locations, work_type, hourly_rate_min, hourly_rate_max, availability, candidate_summary, created_by_account_id")
      .eq("id", subjectId).maybeSingle();
    if (!hotlist || hotlist.created_by_account_id !== accountId) return respond({ error: "Consultant not found" }, 404);

    const { data: job } = await admin.from("social_jobs")
      .select("id, job_title, location, poster_email, posted_by_name, company_name, post_source, vendor_id, post_status, hidden_at")
      .eq("id", jobId).maybeSingle();
    if (!job || job.hidden_at || job.post_status === "closed") return respond({ error: "This requirement is no longer open" }, 404);
    if (job.post_source === "career_site") return respond({ error: "apply_on_site", message: "Apply on the firm's site for this one" }, 400);
    const vendorEmail = str(job.poster_email).split(/[\s,;/]+/).find((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) ?? "";
    if (!vendorEmail) return respond({ error: "no_email", message: "This requirement has no email to send to" }, 400);

    const { data: duplicate } = await admin.rpc("submission_duplicate", { p_account_id: accountId, p_subject_id: subjectId, p_job_id: jobId });

    const senderName = str(member.display_name, 80) || (user.user_metadata?.full_name as string) || user.email?.split("@")[0] || "Recruiter";
    const { data: resume } = await admin.from("hotlist_resumes").select("url, file_name").eq("hotlist_id", subjectId).maybeSingle();
    const draft = buildEmail(hotlist as Hotlist, job as Job, senderName, Boolean(resume?.url));

    if (action === "preview") return respond({ ...draft, to: vendorEmail, duplicate: duplicate ?? null });

    const requestId = str(body.request_id, 100);
    if (!UUID.test(requestId)) return respond({ error: "A valid request ID is required" }, 400);
    if (duplicate) return respond({ error: "duplicate", message: duplicate }, 409);

    const subject = str(body.subject, 180) || draft.subject;
    const text = str(body.body, 5000) || draft.body;
    if (/profilepush/i.test(`${subject}\n${text}`)) return respond({ error: "The email can't mention ProfilePush" }, 400);

    // Daily cap, counted the same way as AI Submit (trial 10, paid 100).
    const { data: account } = await admin.from("accounts").select("is_trial").eq("id", accountId).maybeSingle();
    const dailyLimit = account?.is_trial === false ? 100 : 10;
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count: usedToday } = await admin.from("pulse_ask_ai_requests").select("request_id", { count: "exact", head: true })
      .eq("account_id", accountId).gte("created_at", startOfDay.toISOString());
    if ((usedToday ?? 0) >= dailyLimit) return respond({ error: "daily_limit_reached", daily_limit: dailyLimit, used_today: usedToday ?? 0 }, 429);

    let token: { accessToken: string; gmailAddress: string };
    try {
      token = await getValidAccessToken(admin, user.id);
    } catch {
      return respond({ error: "gmail_not_connected" }, 400);
    }

    const { data: chargeRows, error: chargeError } = await asUser.rpc("consume_feature_credit", {
      p_account_id: accountId, p_amount: 1, p_feature: "gmail_send",
      p_metadata: { job_id: jobId, subject_hotlist_id: subjectId, source: "submission_queue" },
    });
    const charge = Array.isArray(chargeRows) ? chargeRows[0] as { success: boolean; message: string } : null;
    if (chargeError || !charge?.success) {
      return respond({ error: "insufficient_credits", message: charge?.message ?? chargeError?.message ?? "Insufficient credits" }, 402);
    }
    let charged = true;
    const refund = async () => {
      if (!charged) return;
      charged = false;
      await admin.rpc("refund_feature_credit", { p_account_id: accountId, p_amount: 1, p_feature: "gmail_send" });
    };

    const { error: insertError } = await admin.from("pulse_ask_ai_requests").insert({
      request_id: requestId, account_id: accountId, user_id: user.id, job_id: jobId, subject_hotlist_id: subjectId,
      status: "processing", missing_details: ["submission"], send_source: "queue",
    });
    if (insertError) {
      await refund();
      if (insertError.code === "23505") return respond({ error: "This submission is already being sent" }, 409);
      throw insertError;
    }

    const fail = async (message: string) => {
      console.error("submission failed", message);
      await refund();
      await admin.from("pulse_ask_ai_requests").update({ status: "failed", error_message: message, updated_at: new Date().toISOString() }).eq("request_id", requestId);
      return respond({ error: "send_failed", message }, 502);
    };

    const { data: conversation, error: convError } = await admin.from("vendor_conversations").insert({
      request_id: requestId, account_id: accountId, user_id: user.id, job_id: jobId, subject_hotlist_id: subjectId,
      vendor_id: job.vendor_id, vendor_name: str(job.posted_by_name, 200) || null, vendor_email: vendorEmail,
      sender_name: senderName, subject, channel: "gmail",
    }).select("id").single();
    if (convError || !conversation) return await fail(`Could not create conversation: ${convError?.message ?? "unknown"}`);
    await admin.from("pulse_ask_ai_requests").update({ conversation_id: conversation.id }).eq("request_id", requestId);

    let attachment: GmailAttachment | null = null;
    const resumePrefix = `${url.replace(/\/$/, "")}/storage/v1/object/public/resumes/`;
    if (resume?.url && String(resume.url).startsWith(resumePrefix)) {
      try {
        const file = await fetch(resume.url, { signal: AbortSignal.timeout(15_000) });
        if (!file.ok) throw new Error(`HTTP ${file.status}`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength > 4 * 1024 * 1024) throw new Error("over 4 MB");
        attachment = { fileName: resume.file_name || "resume.pdf", mimeType: file.headers.get("content-type")?.split(";")[0] || "application/pdf", bytes };
      } catch (error) {
        return await fail(`Could not attach the resume: ${(error as Error).message}`);
      }
    }
    const finalText = attachment ? text : text.replace(/Resume attached\. ?/, "");

    const { data: message, error: msgError } = await admin.from("vendor_messages").insert({
      conversation_id: conversation.id, direction: "outbound", sender_type: "user",
      from_email: `${senderName.replace(/[\r\n"]/g, "")} <${token.gmailAddress}>`, to_email: vendorEmail,
      subject, text_body: finalText, channel: "gmail", status: "queued",
    }).select("id").single();
    if (msgError || !message) return await fail(`Could not record the message: ${msgError?.message ?? "unknown"}`);

    try {
      const sent = await sendViaGmail({
        attachment, accessToken: token.accessToken, fromName: senderName, fromAddress: token.gmailAddress,
        toAddress: vendorEmail, subject, textBody: finalText,
      });
      const now = new Date().toISOString();
      await admin.from("vendor_messages").update({ status: "accepted", gmail_message_id: sent.id, sent_at: now }).eq("id", message.id);
      await admin.from("vendor_conversations").update({ status: "open", gmail_thread_id: sent.threadId, last_message_at: now, updated_at: now }).eq("id", conversation.id);
    } catch (error) {
      return await fail(`Gmail send failed: ${(error as Error).message}`);
    }

    await admin.from("pulse_ask_ai_requests").update({ status: "completed", delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("request_id", requestId);
    return respond({ ok: true, conversation_id: conversation.id, to: vendorEmail, resume_attached: Boolean(attachment) });
  } catch (error) {
    console.error("submit-consultant error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
