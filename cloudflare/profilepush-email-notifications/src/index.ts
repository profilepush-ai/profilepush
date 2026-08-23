export interface Env {
  EMAIL_QUEUE: Queue<EmailJob>;
  GMASS_API_KEY: string;
  GMASS_FROM_EMAIL: string;
  GMASS_FROM_NAME: string;
  GMASS_WARMUP_START_DATE: string;
  EMAIL_SENDING_PAUSED: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WORKER_AUTH_TOKEN: string;
  UNSUBSCRIBE_SECRET: string;
  APP_BASE_URL: string;
  WORKER_BASE_URL: string;
  DIGEST_NOTIFY_TOKEN: string;
}

type EmailJob = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getBearerToken(request: Request): string {
  const [scheme, token] = (request.headers.get("Authorization") ?? "").split(" ");
  return scheme?.toLowerCase() === "bearer" ? (token ?? "").trim() : "";
}

function serviceHeaders(env: Env, json = false): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

async function supabaseRequest(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(env), ...(init.headers ?? {}) },
  });
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

// Cloudflare Queues caps sendBatch() at 100 messages AND 256KB combined per
// call. Digest emails are full HTML pages, so message count alone isn't a
// safe chunk boundary — a batch of well under 100 rich emails can still blow
// past the size cap. Chunk by both, with headroom below the 256KB ceiling.
const MAX_BATCH_MESSAGES = 100;
const MAX_BATCH_BYTES = 200_000;

function chunkEmailJobsForQueue(jobs: EmailJob[]): EmailJob[][] {
  const chunks: EmailJob[][] = [];
  let current: EmailJob[] = [];
  let currentBytes = 0;
  for (const job of jobs) {
    const jobBytes = new TextEncoder().encode(JSON.stringify(job)).length;
    if (current.length > 0 && (current.length >= MAX_BATCH_MESSAGES || currentBytes + jobBytes > MAX_BATCH_BYTES)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(job);
    currentBytes += jobBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function countSince(env: Env, table: string, since: string): Promise<number> {
  const response = await supabaseRequest(
    env,
    `${table}?select=id&created_at=gte.${encodeURIComponent(since)}`,
    { method: "HEAD", headers: { Prefer: "count=exact" } },
  );
  const range = response.headers.get("content-range") ?? "";
  const total = range.split("/")[1];
  return total ? Number(total) : 0;
}

type TopRole = { target_role: string; unique_jobs: number };

async function fetchTopRoles(env: Env): Promise<TopRole[]> {
  const response = await supabaseRequest(
    env,
    "pulse_directory_30d?select=target_role,unique_jobs&order=rank.asc&limit=10",
  );
  if (!response.ok) return [];
  return await response.json<TopRole[]>();
}

type DigestRecipient = { user_id: string; email: string; account_id: string };

async function fetchRecipients(env: Env): Promise<DigestRecipient[]> {
  const response = await supabaseRequest(env, "rpc/get_daily_digest_recipients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`Failed to load digest recipients: HTTP ${response.status}`);
  }
  return await response.json<DigestRecipient[]>();
}

async function buildUnsubscribeUrl(env: Env, userId: string, accountId: string): Promise<string> {
  const sig = await hmacHex(env.UNSUBSCRIBE_SECRET, `${userId}:${accountId}`);
  const url = new URL("/unsubscribe", env.WORKER_BASE_URL);
  url.searchParams.set("uid", userId);
  url.searchParams.set("aid", accountId);
  url.searchParams.set("sig", sig);
  return url.toString();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Brand palette (from public/favicon.svg / src/components/Logo.tsx):
// yellow #facc15, orange #f97316, blue #2563eb, ink #0f172a.
function renderDigestEmail(
  jobsCount: number,
  hotlistCount: number,
  topRoles: TopRole[],
  unsubscribeUrl: string,
  appBaseUrl: string,
) {
  const base = appBaseUrl.replace(/\/$/, "");
  const jobsUrl = `${base}/jobs`;
  const hotlistUrl = `${base}/hotlist`;
  const loginUrl = `${base}/signin`;
  const logoUrl = `${base}/favicon.svg`;

  const topRoleNames = topRoles.slice(0, 3).map((r) => r.target_role);
  const subject = `🔥 ${jobsCount} New Jobs & ${hotlistCount} Hotlist Consultants (Today's Digest)`;
  const preheader = topRoleNames.length > 0
    ? `Top roles added today: ${topRoleNames.join(", ")}...`
    : `${jobsCount} new jobs and ${hotlistCount} hotlist profiles in the last 24 hours.`;

  const rolePillsHtml = topRoles.length > 0
    ? topRoles.map((r) =>
        `<span style="padding: 4px 10px; border-radius: 4px; border: 1px solid #e2e8f0; display: inline-block; margin: 3px 6px 3px 0; font-size: 12px; color: #334155;">${escapeHtml(r.target_role)} <strong>(${r.unique_jobs})</strong></span>`,
      ).join("")
    : `<span style="font-size: 13px; color: #64748b;">No role activity yet.</span>`;

  const roleLinesText = topRoles.length > 0
    ? topRoles.map((r) => `- ${r.target_role} (${r.unique_jobs})`).join("\n")
    : "No role activity yet.";

  const text = `ProfilePush — Today's Market Activity

${jobsCount} new job${jobsCount === 1 ? "" : "s"} added in the last 24 hours: ${jobsUrl}
${hotlistCount} new hotlist profile${hotlistCount === 1 ? "" : "s"} added in the last 24 hours: ${hotlistUrl}

Top in-demand roles:
${roleLinesText}

Login & Browse: ${loginUrl}

---
Don't want these emails? Unsubscribe: ${unsubscribeUrl}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ProfilePush Daily Update</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(preheader)}</div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 32px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 480px;">

          <tr>
            <td style="padding-bottom: 28px;">
              <img src="${logoUrl}" width="24" height="24" alt="" style="vertical-align: middle; border-radius: 6px;" />
              <span style="font-size: 16px; font-weight: 800; color: #0f172a; vertical-align: middle; margin-left: 8px;">ProfilePush</span>
            </td>
          </tr>

          <tr>
            <td style="padding-bottom: 4px;">
              <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.3;">Today's Market Activity</h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 28px;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">New requirements and available consultants added in the last 24 hours.</p>
            </td>
          </tr>

          <tr>
            <td style="padding-bottom: 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="50%" style="vertical-align: top;">
                    <div style="font-size: 36px; font-weight: 800; color: #2563eb; line-height: 1;">${jobsCount}</div>
                    <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-top: 4px;">New Jobs</div>
                    <a href="${jobsUrl}" style="display: inline-block; margin-top: 10px; font-size: 13px; font-weight: 700; color: #2563eb; text-decoration: none;">Browse &rarr;</a>
                  </td>
                  <td width="50%" style="vertical-align: top;">
                    <div style="font-size: 36px; font-weight: 800; color: #f97316; line-height: 1;">${hotlistCount}</div>
                    <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-top: 4px;">Hotlist Profiles</div>
                    <a href="${hotlistUrl}" style="display: inline-block; margin-top: 10px; font-size: 13px; font-weight: 700; color: #f97316; text-decoration: none;">View &rarr;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding-bottom: 32px; border-top: 1px solid #f1f5f9; padding-top: 24px;">
              <div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 10px;">🔥 Top In-Demand Roles</div>
              <div style="font-size: 13px; color: #475569; line-height: 2;">${rolePillsHtml}</div>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding-bottom: 28px;">
              <a href="${loginUrl}" style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; border-radius: 6px;">Login &amp; Browse</a>
            </td>
          </tr>

          <tr>
            <td style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                You are receiving this digest based on your ProfilePush alert settings.<br>
                <a href="${unsubscribeUrl}" style="color: #94a3b8; text-decoration: underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

async function buildDigestJob(
  env: Env,
  recipient: DigestRecipient,
  jobsCount: number,
  hotlistCount: number,
  topRoles: TopRole[],
): Promise<EmailJob> {
  const unsubscribeUrl = await buildUnsubscribeUrl(env, recipient.user_id, recipient.account_id);
  const { subject, text, html } = renderDigestEmail(jobsCount, hotlistCount, topRoles, unsubscribeUrl, env.APP_BASE_URL);
  return { to: recipient.email, subject, text, html };
}

async function notifyInAppAndPush(env: Env, recipients: DigestRecipient[], jobsCount: number, hotlistCount: number): Promise<void> {
  // Authorization carries the anon key so Supabase's gateway-level JWT check
  // passes (it just needs a validly-signed JWT, any role); the function's own
  // authorization is the "token" field in the body, checked against
  // DIGEST_NOTIFY_TOKEN — same split used by this project's other
  // custom-auth functions (JWT for the gateway, app-level token in the body).
  const response = await fetch(`${env.SUPABASE_URL}/functions/v1/notify-daily-digest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      apikey: env.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      token: env.DIGEST_NOTIFY_TOKEN,
      recipients: recipients.map((r) => ({ user_id: r.user_id, account_id: r.account_id })),
      jobs_count: jobsCount,
      hotlist_count: hotlistCount,
    }),
  });
  if (!response.ok) {
    console.error("notify-daily-digest failed", response.status, await response.text().catch(() => ""));
  }
}

// New GMass-connected mailboxes need to build sending reputation gradually —
// mailing the full recipient list from day one risks the mailbox getting
// spam-flagged. Cap the digest EMAIL to a small, daily-growing recipient
// count for the first 30 days after GMASS_WARMUP_START_DATE; in-app bell and
// push notifications are unaffected since they carry no such reputation risk.
const WARMUP_INITIAL_CAP = 10;
const WARMUP_DAILY_GROWTH = 1.2;
const WARMUP_DURATION_DAYS = 30;

function daysSince(startDate: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000));
}

function warmupCapForDay(dayIndex: number): number {
  if (dayIndex < 0 || dayIndex >= WARMUP_DURATION_DAYS) return Infinity;
  return Math.floor(WARMUP_INITIAL_CAP * Math.pow(WARMUP_DAILY_GROWTH, dayIndex));
}

// Rotates which recipients are under the cap each day, rather than always
// emailing the same first N, so coverage spreads across the ramp period.
function selectWarmupRecipients(recipients: DigestRecipient[], cap: number, dayIndex: number): DigestRecipient[] {
  if (!Number.isFinite(cap) || recipients.length <= cap) return recipients;
  const offset = ((dayIndex * cap) % recipients.length + recipients.length) % recipients.length;
  return Array.from({ length: cap }, (_, i) => recipients[(offset + i) % recipients.length]);
}

async function runDailyDigest(
  env: Env,
): Promise<{ jobsCount: number; hotlistCount: number; recipients: number; emailedRecipients: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [jobsCount, hotlistCount, allRecipients, topRoles] = await Promise.all([
    countSince(env, "radar_match_results", since),
    countSince(env, "radar_match_hotlist", since),
    fetchRecipients(env),
    fetchTopRoles(env),
  ]);

  const dayIndex = daysSince(env.GMASS_WARMUP_START_DATE, new Date());
  const cap = warmupCapForDay(dayIndex);
  const emailRecipients = selectWarmupRecipients(allRecipients, cap, dayIndex);

  const jobs: EmailJob[] = [];
  for (const recipient of emailRecipients) {
    jobs.push(await buildDigestJob(env, recipient, jobsCount, hotlistCount, topRoles));
  }

  for (const chunk of chunkEmailJobsForQueue(jobs)) {
    await env.EMAIL_QUEUE.sendBatch(chunk.map((job) => ({ body: job })));
  }

  try {
    await notifyInAppAndPush(env, allRecipients, jobsCount, hotlistCount);
  } catch (error) {
    // In-app/push notification is best-effort — never let it block the email send path.
    console.error("notifyInAppAndPush threw", error);
  }

  return { jobsCount, hotlistCount, recipients: allRecipients.length, emailedRecipients: emailRecipients.length };
}

function sendingPaused(env: Env): boolean {
  return env.EMAIL_SENDING_PAUSED === "true";
}

async function sendGmassEmail(env: Env, job: EmailJob): Promise<void> {
  const response = await fetch("https://api.gmass.co/api/transactional", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-apikey": env.GMASS_API_KEY },
    body: JSON.stringify({
      fromEmail: env.GMASS_FROM_EMAIL,
      fromName: env.GMASS_FROM_NAME,
      to: job.to,
      subject: job.subject,
      message: job.html || job.text,
    }),
  });

  if (!response.ok) {
    const payload = await response.json<{ message?: string }>().catch(() => ({}));
    const errorMessage = payload.message ?? `GMass HTTP ${response.status}`;
    throw new Error(errorMessage);
  }
}

async function handleSendRequest(request: Request, env: Env): Promise<Response> {
  if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
  const body = await request.json<Partial<EmailJob>>();
  const to = typeof body.to === "string" ? body.to.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject : "";
  const html = typeof body.html === "string" ? body.html : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!/^\S+@\S+\.\S+$/.test(to) || !subject || (!html && !text)) {
    return jsonResponse({ error: "to, subject, and html or text are required" }, 400);
  }
  await env.EMAIL_QUEUE.send({ to, subject, html, text });
  return jsonResponse({ queued: true }, 202);
}

// Manually runs the exact same digest send as the daily cron, for catch-up
// after a missed or failed scheduled run.
async function handleRunDigest(request: Request, env: Env): Promise<Response> {
  if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
  const result = await runDailyDigest(env);
  return jsonResponse(result);
}

// Sends a real, fully-rendered digest (real counts, real signed unsubscribe link)
// to one specific recipient immediately, bypassing the queue for synchronous
// feedback. Useful for previewing/testing before relying on the daily cron.
async function handleTestDigest(request: Request, env: Env): Promise<Response> {
  if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
  if (sendingPaused(env)) return jsonResponse({ error: "Email sending is paused" }, 503);
  const body = await request.json<{ to?: unknown }>();
  const to = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
  if (!to) return jsonResponse({ error: "to is required" }, 400);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [jobsCount, hotlistCount, recipients, topRoles] = await Promise.all([
    countSince(env, "radar_match_results", since),
    countSince(env, "radar_match_hotlist", since),
    fetchRecipients(env),
    fetchTopRoles(env),
  ]);

  const recipient = recipients.find((r) => r.email.toLowerCase() === to);
  if (!recipient) return jsonResponse({ error: "No signed-up recipient found with that email" }, 404);

  const job = await buildDigestJob(env, recipient, jobsCount, hotlistCount, topRoles);
  await sendGmassEmail(env, job);

  let notified = false;
  try {
    await notifyInAppAndPush(env, [recipient], jobsCount, hotlistCount);
    notified = true;
  } catch (error) {
    console.error("notifyInAppAndPush threw during test-digest", error);
  }

  return jsonResponse({ sent: true, notified, jobsCount, hotlistCount, to: job.to });
}

async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("uid") ?? "";
  const accountId = url.searchParams.get("aid") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  const expectedSig = await hmacHex(env.UNSUBSCRIBE_SECRET, `${userId}:${accountId}`);
  const uuidPattern = /^[0-9a-f-]{36}$/i;
  if (!uuidPattern.test(userId) || !uuidPattern.test(accountId) || !timingSafeEqual(sig, expectedSig)) {
    return new Response("Invalid or expired unsubscribe link.", { status: 400, headers: { "Content-Type": "text/plain" } });
  }

  const response = await supabaseRequest(env, "notification_preferences?on_conflict=user_id,notif_type", {
    method: "POST",
    headers: { ...serviceHeaders(env, true), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, account_id: accountId, notif_type: "daily_digest", email_enabled: false }),
  });

  if (!response.ok) {
    return new Response("Something went wrong. Please try again later.", { status: 500, headers: { "Content-Type": "text/plain" } });
  }

  return new Response(
    "You've been unsubscribed from ProfilePush daily update emails.",
    { status: 200, headers: { "Content-Type": "text/plain" } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    try {
      if (request.method === "GET" && pathname === "/unsubscribe") return await handleUnsubscribe(request, env);
      if (request.method === "GET") return jsonResponse({ status: "ok" });
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
      if (pathname === "/send") return await handleSendRequest(request, env);
      if (pathname === "/run-digest") return await handleRunDigest(request, env);
      if (pathname === "/test-digest") return await handleTestDigest(request, env);
      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Email notification request failed", error);
      return jsonResponse({ error: (error as Error).message }, 500);
    }
  },

  async queue(batch: MessageBatch<EmailJob>, env: Env): Promise<void> {
    const paused = sendingPaused(env);
    for (const message of batch.messages) {
      // Hold the message without calling GMass at all while paused — retrying
      // immediately would just keep hammering a blocked account.
      if (paused) {
        message.retry({ delaySeconds: 1800 });
        continue;
      }
      try {
        await sendGmassEmail(env, message.body);
        message.ack();
      } catch (error) {
        console.error("Email queue job failed", error);
        message.retry();
      }
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      const result = await runDailyDigest(env);
      console.log(`Daily digest: emailed ${result.emailedRecipients}/${result.recipients} recipients (${result.jobsCount} jobs, ${result.hotlistCount} hotlist profiles)`);
    } catch (error) {
      console.error("Daily digest cron run failed", error);
      throw error;
    }
  },
};
