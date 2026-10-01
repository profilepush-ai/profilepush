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
  MARKET_STATS_AUTH_TOKEN: string;
  UNSUBSCRIBE_SECRET: string;
  APP_BASE_URL: string;
  WORKER_BASE_URL: string;
  DIGEST_NOTIFY_TOKEN: string;
  // "ses" sends the user lane through Amazon SES; "gmass" puts it back on
  // GMass (rollback switch). The outreach lane is always GMass.
  EMAIL_PROVIDER: string;
  AWS_SES_REGION: string;
  AWS_SES_ACCESS_KEY_ID: string;
  AWS_SES_SECRET_ACCESS_KEY: string;
  SES_FROM_EMAIL: string;
  SES_FROM_NAME: string;
  SES_REPLY_TO: string;
  // Secret in the SNS subscription URL that delivers SES events to /ses-events.
  SES_EVENTS_TOKEN: string;
}

// Two lanes that never share a sender. "user" is email to people who signed
// up (digest, credit reminders, welcome, signup alerts) and goes through
// Amazon SES on mail.profilepush.ai. "outreach" is email to people who aren't
// users yet (market-stats pitches, "X subscribed to you" for unclaimed
// publishers); SES's terms forbid unsolicited email, so it stays on GMass.
type EmailLane = "user" | "outreach";

type EmailJob = {
  to: string;
  subject: string;
  html: string;
  text: string;
  lane?: EmailLane;
  // What kind of email this is, for Admin > Emails: digest, low_credits,
  // welcome, signup_alert, screening_invite, subscriber_notice,
  // outreach_pitch or other.
  category?: string;
  // Set on bulk email (digest, reminders) to add one-click unsubscribe
  // headers (RFC 8058), which Gmail and Outlook require from bulk senders.
  // Left off personal notifications so they read as one-to-one email.
  unsubscribeUrl?: string;
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
  return { to: recipient.email, subject, text, html, lane: "user", category: "digest", unsubscribeUrl };
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

// ── "X subscribed to you" for unclaimed publishers ──────────────────────────
// A publisher who isn't on ProfilePush yet can't get an in-app notification,
// so each new subscriber is emailed to them straight away, by name, with a
// link to claim the profile by signing up with that address. A trigger on
// publisher_follows calls /publisher-subscribed; claim_subscriber_email
// decides whether to send (unclaimed, not unsubscribed, not already told
// about this subscriber) and records it. Claimed publishers are notified
// in-app by follow_publisher instead.
type SubscriberEmail = {
  email: string;
  slug: string;
  post_noun: "requirements" | "hotlists";
  subscriber_name: string;
  subscriber_company: string | null;
  subscriber_count: number;
};

async function buildPublisherUnsubscribeUrl(env: Env, email: string): Promise<string> {
  const sig = await hmacHex(env.UNSUBSCRIBE_SECRET, `publisher:${email}`);
  const url = new URL("/unsubscribe-publisher", env.WORKER_BASE_URL);
  url.searchParams.set("e", email);
  url.searchParams.set("sig", sig);
  return url.toString();
}

function renderSubscriberEmail(row: SubscriberEmail, claimUrl: string, unsubscribeUrl: string, appBaseUrl: string): EmailJob {
  const base = appBaseUrl.replace(/\/$/, "");
  const logoUrl = `${base}/favicon.svg`;
  const who = row.subscriber_company ? `${row.subscriber_name} from ${row.subscriber_company}` : row.subscriber_name;
  const subject = `${row.subscriber_name} subscribed to you on ProfilePush`;
  const detail = `${who} will see your new ${row.post_noun} the moment you post them.`;
  const countLine = row.subscriber_count > 1 ? `You have ${row.subscriber_count} subscribers on ProfilePush.` : "";

  const text = `${subject}

${detail}${countLine ? `\n${countLine}` : ""}

Claim your profile and never miss an update: ${claimUrl}
Sign up with ${row.email} and the profile is yours straight away.

---
Don't want these emails? Unsubscribe: ${unsubscribeUrl}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(detail)}</div>
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
            <td style="padding-bottom: 8px;">
              <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.3;">${escapeHtml(subject)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 28px;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">${escapeHtml(detail)}${countLine ? `<br>${escapeHtml(countLine)}` : ""}</p>
            </td>
          </tr>
          <tr>
            <td align="left" style="padding-bottom: 12px;">
              <a href="${claimUrl}" style="display: inline-block; padding: 12px 28px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; border-radius: 6px;">Claim your profile</a>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 32px;">
              <p style="margin: 0; font-size: 13px; color: #64748b;">Never miss an update. Sign up with ${escapeHtml(row.email)} and the profile is yours straight away.</p>
            </td>
          </tr>
          <tr>
            <td style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
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

  // Unclaimed publishers aren't users yet, so this is outreach-lane email.
  return { to: row.email, subject, text, html, lane: "outreach", category: "subscriber_notice", unsubscribeUrl };
}

// Called by the email_unclaimed_publisher_after_follow trigger (pg_net), which
// authenticates with the service role key — the same key this worker holds.
async function handlePublisherSubscribed(request: Request, env: Env): Promise<Response> {
  if (!timingSafeEqual(getBearerToken(request), env.SUPABASE_SERVICE_ROLE_KEY)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const body = await request.json<{ publisher_id?: unknown; follower_account_id?: unknown }>();
  const publisherId = typeof body.publisher_id === "string" ? body.publisher_id : "";
  const followerAccountId = typeof body.follower_account_id === "string" ? body.follower_account_id : "";
  if (!publisherId || !followerAccountId) return jsonResponse({ error: "publisher_id and follower_account_id are required" }, 400);

  const response = await supabaseRequest(env, "rpc/claim_subscriber_email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_publisher_id: publisherId, p_follower_account_id: followerAccountId }),
  });
  if (!response.ok) {
    throw new Error(`claim_subscriber_email HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const row = (await response.json<SubscriberEmail[]>())[0];
  if (!row) return jsonResponse({ sent: false });

  const base = env.APP_BASE_URL.replace(/\/$/, "");
  const claimUrl = `${base}/signup?email=${encodeURIComponent(row.email)}`;
  const job = renderSubscriberEmail(row, claimUrl, await buildPublisherUnsubscribeUrl(env, row.email), env.APP_BASE_URL);
  await env.EMAIL_QUEUE.send(job);
  return jsonResponse({ sent: true }, 202);
}

async function handleUnsubscribePublisher(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const email = (url.searchParams.get("e") ?? "").trim().toLowerCase();
  const sig = url.searchParams.get("sig") ?? "";
  const expected = await hmacHex(env.UNSUBSCRIBE_SECRET, `publisher:${email}`);
  if (!email || !timingSafeEqual(sig, expected)) {
    return new Response("Invalid or expired unsubscribe link.", { status: 400, headers: { "Content-Type": "text/plain" } });
  }
  const response = await supabaseRequest(env, "rpc/publisher_email_opt_out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_email: email }),
  });
  if (!response.ok) {
    return new Response("Something went wrong. Please try again later.", { status: 500, headers: { "Content-Type": "text/plain" } });
  }
  await logUnsubscribe(env, "subscriber_notice", null, email);
  return new Response("You've been unsubscribed from ProfilePush subscriber emails.", { status: 200, headers: { "Content-Type": "text/plain" } });
}

// ── Low credits: daily nudge to the 500-credit pack ─────────────────────────
// Owners of accounts under half their credits (50 on the free plan, half the
// last pack on a paid one), active in the last 30 days, once a day at most.
// get_low_credit_upgrade_recipients does the choosing, including skipping
// anyone who unsubscribed from this email.
type LowCreditRecipient = { account_id: string; user_id: string; email: string; name: string; balance: number | string; threshold: number | string };

async function buildLowCreditUnsubscribeUrl(env: Env, userId: string, accountId: string): Promise<string> {
  const sig = await hmacHex(env.UNSUBSCRIBE_SECRET, `low_credits:${userId}:${accountId}`);
  const url = new URL("/unsubscribe-low-credits", env.WORKER_BASE_URL);
  url.searchParams.set("uid", userId);
  url.searchParams.set("aid", accountId);
  url.searchParams.set("sig", sig);
  return url.toString();
}

function renderLowCreditEmail(r: LowCreditRecipient, buyUrl: string, unsubscribeUrl: string, appBaseUrl: string): EmailJob {
  const base = appBaseUrl.replace(/\/$/, "");
  const logoUrl = `${base}/favicon.svg`;
  const left = Math.max(0, Math.floor(Number(r.balance) || 0));
  const first = (r.name || "").trim().split(/\s+/)[0] || "";
  const greeting = first ? `Hi ${escapeHtml(first)},` : "Hi,";
  const subject = left === 0
    ? "You're out of credits. Your AI copilot has stopped."
    : `Only ${left} credits left. Keep your AI copilot working.`;
  const lead = left === 0
    ? "Your AI copilot can't match, draft or send until you top up."
    : `You have ${left} credits left. Every AI Match, AI Submit and email sent uses them.`;

  const text = `${first ? `Hi ${first},` : "Hi,"}

${lead}

Top up 500 credits for ₹500 to keep matching, drafting and sending, and hit this week's submission goals.

Get 500 credits: ${buyUrl}

---
Don't want these reminders? Unsubscribe: ${unsubscribeUrl}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(lead)}</div>
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
            <td style="padding-bottom: 6px;">
              <p style="margin: 0; font-size: 14px; color: #334155;">${greeting}</p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 6px;">
              <div style="font-size: 44px; font-weight: 800; color: ${left === 0 ? "#dc2626" : "#d97706"}; line-height: 1;">${left}</div>
              <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-top: 4px;">credits left</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 0 24px;">
              <p style="margin: 0; font-size: 14px; color: #334155; line-height: 1.5;">${escapeHtml(lead)} Top up 500 credits for ₹500 to keep matching, drafting and sending, and hit this week's submission goals.</p>
            </td>
          </tr>
          <tr>
            <td align="left" style="padding-bottom: 32px;">
              <a href="${buyUrl}" style="display: inline-block; padding: 12px 28px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; border-radius: 6px;">Get 500 credits · ₹500</a>
            </td>
          </tr>
          <tr>
            <td style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                <a href="${unsubscribeUrl}" style="color: #94a3b8; text-decoration: underline;">Unsubscribe from credit reminders</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { to: r.email, subject, text, html, lane: "user", category: "low_credits", unsubscribeUrl };
}

async function runLowCreditEmails(env: Env): Promise<{ emailed: number }> {
  const response = await supabaseRequest(env, "rpc/get_low_credit_upgrade_recipients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`get_low_credit_upgrade_recipients HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const recipients = await response.json<LowCreditRecipient[]>();
  if (recipients.length === 0) return { emailed: 0 };

  const base = env.APP_BASE_URL.replace(/\/$/, "");
  // Opens the Buy Credits dialog straight away (BillingPage handles openPlan=1).
  const buyUrl = `${base}/billing?openPlan=1`;
  const jobs: EmailJob[] = [];
  for (const r of recipients) {
    jobs.push(renderLowCreditEmail(r, buyUrl, await buildLowCreditUnsubscribeUrl(env, r.user_id, r.account_id), env.APP_BASE_URL));
  }
  for (const chunk of chunkEmailJobsForQueue(jobs)) {
    await env.EMAIL_QUEUE.sendBatch(chunk.map((job) => ({ body: job })));
  }
  const marked = await supabaseRequest(env, "rpc/mark_low_credit_emails_sent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_rows: recipients.map((r) => ({ account_id: r.account_id, balance: r.balance })) }),
  });
  if (!marked.ok) console.error("mark_low_credit_emails_sent failed", marked.status, await marked.text().catch(() => ""));
  return { emailed: jobs.length };
}

async function handleUnsubscribeLowCredits(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("uid") ?? "";
  const accountId = url.searchParams.get("aid") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  const expected = await hmacHex(env.UNSUBSCRIBE_SECRET, `low_credits:${userId}:${accountId}`);
  const uuidPattern = /^[0-9a-f-]{36}$/i;
  if (!uuidPattern.test(userId) || !uuidPattern.test(accountId) || !timingSafeEqual(sig, expected)) {
    return new Response("Invalid or expired unsubscribe link.", { status: 400, headers: { "Content-Type": "text/plain" } });
  }
  const response = await supabaseRequest(env, "notification_preferences?on_conflict=user_id,notif_type", {
    method: "POST",
    headers: { ...serviceHeaders(env, true), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, account_id: accountId, notif_type: "low_credits", email_enabled: false }),
  });
  if (!response.ok) {
    return new Response("Something went wrong. Please try again later.", { status: 500, headers: { "Content-Type": "text/plain" } });
  }
  await logUnsubscribe(env, "low_credits", userId, null);
  return new Response("You've been unsubscribed from ProfilePush credit reminders.", { status: 200, headers: { "Content-Type": "text/plain" } });
}

async function handleRunLowCreditEmails(request: Request, env: Env): Promise<Response> {
  if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
  return jsonResponse(await runLowCreditEmails(env));
}

function sendingPaused(env: Env): boolean {
  return env.EMAIL_SENDING_PAUSED === "true";
}

async function sendGmassEmail(env: Env, job: EmailJob): Promise<string | null> {
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
  return null;
}

// ── Amazon SES (user lane) ──────────────────────────────────────────────────
// SESv2 SendEmail over plain fetch, signed with AWS Signature Version 4 so the
// worker needs no SDK. The key belongs to an IAM user that can only send.

// A send SES refused for good (bad address, rejected content): retrying can't
// help, so the queue drops it instead of retrying five times.
class PermanentSendError extends Error {}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)));
}

async function hmacRaw(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function sendSesEmail(env: Env, job: EmailJob): Promise<string | null> {
  const region = env.AWS_SES_REGION;
  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const headers = job.unsubscribeUrl
    ? [
        { Name: "List-Unsubscribe", Value: `<${job.unsubscribeUrl}>` },
        { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
      ]
    : undefined;
  const body = JSON.stringify({
    FromEmailAddress: `${env.SES_FROM_NAME} <${env.SES_FROM_EMAIL}>`,
    Destination: { ToAddresses: [job.to] },
    ...(env.SES_REPLY_TO ? { ReplyToAddresses: [env.SES_REPLY_TO] } : {}),
    Content: {
      Simple: {
        Subject: { Data: job.subject, Charset: "UTF-8" },
        Body: {
          ...(job.html ? { Html: { Data: job.html, Charset: "UTF-8" } } : {}),
          ...(job.text ? { Text: { Data: job.text, Charset: "UTF-8" } } : {}),
        },
        ...(headers ? { Headers: headers } : {}),
      },
    },
  });

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalRequest = [
    "POST",
    path,
    "",
    `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    await sha256Hex(body),
  ].join("\n");
  const scope = `${dateStamp}/${region}/ses/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  let signingKey = await hmacRaw(new TextEncoder().encode(`AWS4${env.AWS_SES_SECRET_ACCESS_KEY}`), dateStamp);
  for (const part of [region, "ses", "aws4_request"]) signingKey = await hmacRaw(signingKey, part);
  const signature = toHex(await hmacRaw(signingKey, stringToSign));

  const response = await fetch(`https://${host}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Amz-Date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${env.AWS_SES_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });
  if (response.ok) {
    const payload = await response.json<{ MessageId?: string }>().catch(() => ({}) as { MessageId?: string });
    return payload.MessageId ?? null;
  }

  const detail = (await response.text().catch(() => "")).slice(0, 300);
  const errorType = response.headers.get("x-amzn-ErrorType") ?? "";
  // Only a rejected message or a malformed address is final. Everything else
  // (throttling, a paused account, a bad key) retries, so a config mistake
  // holds email in the queue instead of silently dropping it.
  if (/MessageRejected|BadRequest/.test(`${errorType} ${detail}`)) {
    throw new PermanentSendError(`SES ${errorType || response.status}: ${detail}`);
  }
  throw new Error(`SES ${errorType || response.status}: ${detail}`);
}

function providerFor(env: Env, job: EmailJob): "ses" | "gmass" {
  // Jobs queued before lanes existed have no lane; they were all user email
  // except /send calls from market-stats-outreach, which now always set one.
  return (job.lane ?? "user") === "user" && env.EMAIL_PROVIDER === "ses" ? "ses" : "gmass";
}

async function sendEmail(env: Env, job: EmailJob): Promise<string | null> {
  return providerFor(env, job) === "ses" ? sendSesEmail(env, job) : sendGmassEmail(env, job);
}

// Records one send for Admin > Emails. Best-effort: a logging failure never
// fails or repeats the email itself.
async function logSend(
  env: Env,
  job: EmailJob,
  status: "sent" | "rejected" | "failed",
  messageId: string | null,
  error?: unknown,
): Promise<void> {
  try {
    const response = await supabaseRequest(env, "email_sends", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        category: job.category ?? "other",
        lane: job.lane ?? "user",
        provider: providerFor(env, job),
        to_email: job.to,
        subject: job.subject.slice(0, 300),
        status,
        provider_message_id: messageId,
        error: error ? String((error as Error).message ?? error).slice(0, 500) : null,
      }),
    });
    if (!response.ok) console.error("email_sends insert failed", response.status, await response.text().catch(() => ""));
  } catch (err) {
    console.error("email_sends insert threw", err);
  }
}

async function logUnsubscribe(env: Env, category: string, userId: string | null, email: string | null): Promise<void> {
  try {
    await supabaseRequest(env, "email_unsubscribes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ category, user_id: userId, email }),
    });
  } catch (err) {
    console.error("email_unsubscribes insert threw", err);
  }
}

// ── SES events (delivery, bounce, complaint) ────────────────────────────────
// The SES configuration set publishes events to an SNS topic, whose HTTPS
// subscription posts here with ?token=SES_EVENTS_TOKEN. The first post is a
// subscription confirmation, confirmed by visiting its SubscribeURL.
type SesEvent = {
  eventType?: string;
  notificationType?: string;
  mail?: { messageId?: string; timestamp?: string };
  bounce?: { bounceType?: string; bounceSubType?: string; timestamp?: string };
  complaint?: { timestamp?: string };
  delivery?: { timestamp?: string };
  reject?: { reason?: string };
};

async function handleSesEvents(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!env.SES_EVENTS_TOKEN || !timingSafeEqual(token, env.SES_EVENTS_TOKEN)) return jsonResponse({ error: "Unauthorized" }, 401);

  const envelope = JSON.parse(await request.text()) as { Type?: string; SubscribeURL?: string; Message?: string };
  if (envelope.Type === "SubscriptionConfirmation" && envelope.SubscribeURL) {
    const confirmUrl = new URL(envelope.SubscribeURL);
    if (confirmUrl.protocol !== "https:" || !/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(confirmUrl.hostname)) {
      return jsonResponse({ error: "Unexpected SubscribeURL" }, 400);
    }
    const confirmed = await fetch(confirmUrl.toString());
    return jsonResponse({ confirmed: confirmed.ok });
  }
  if (envelope.Type !== "Notification" || !envelope.Message) return jsonResponse({ ignored: true });

  const event = JSON.parse(envelope.Message) as SesEvent;
  const kind = event.eventType ?? event.notificationType ?? "";
  const messageId = event.mail?.messageId;
  if (!messageId || !["Delivery", "Bounce", "Complaint", "Reject"].includes(kind)) return jsonResponse({ ignored: true });

  const at = event.delivery?.timestamp ?? event.bounce?.timestamp ?? event.complaint?.timestamp ?? event.mail?.timestamp ?? new Date().toISOString();
  const detail = kind === "Bounce"
    ? [event.bounce?.bounceType, event.bounce?.bounceSubType].filter(Boolean).join(" / ")
    : kind === "Reject" ? event.reject?.reason ?? null : null;
  const response = await supabaseRequest(env, "rpc/record_email_event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_message_id: messageId, p_event: kind, p_at: at, p_detail: detail }),
  });
  // A non-2xx makes SNS retry, which is what we want if the database hiccups.
  if (!response.ok) return jsonResponse({ error: `record_email_event HTTP ${response.status}` }, 500);
  return jsonResponse({ recorded: kind });
}

// Accepts either the general admin token or market-stats-outreach's own
// dedicated token — kept independent so rotating one never risks breaking
// the other's caller (send-welcome-email also authenticates with
// WORKER_AUTH_TOKEN via its own EMAIL_WORKER_TOKEN secret).
async function handleSendRequest(request: Request, env: Env): Promise<Response> {
  const token = getBearerToken(request);
  if (token !== env.WORKER_AUTH_TOKEN && token !== env.MARKET_STATS_AUTH_TOKEN) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const body = await request.json<Partial<EmailJob>>();
  const to = typeof body.to === "string" ? body.to.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject : "";
  const html = typeof body.html === "string" ? body.html : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!/^\S+@\S+\.\S+$/.test(to) || !subject || (!html && !text)) {
    return jsonResponse({ error: "to, subject, and html or text are required" }, 400);
  }
  // market-stats-outreach mails people who aren't users, so anything sent
  // with its token, or marked outreach, never goes through SES.
  const bodyLane = (body as { lane?: unknown }).lane;
  const lane: EmailLane = token === env.MARKET_STATS_AUTH_TOKEN || bodyLane === "outreach" ? "outreach" : "user";
  const bodyCategory = (body as { category?: unknown }).category;
  const category = typeof bodyCategory === "string" && /^[a-z_]{1,40}$/.test(bodyCategory)
    ? bodyCategory
    : lane === "outreach" ? "outreach_pitch" : "other";
  await env.EMAIL_QUEUE.send({ to, subject, html, text, lane, category });
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
  await logSend(env, job, "sent", await sendEmail(env, job));

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

  await logUnsubscribe(env, "digest", userId, null);
  return new Response(
    "You've been unsubscribed from ProfilePush daily update emails.",
    { status: 200, headers: { "Content-Type": "text/plain" } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    try {
      // GET is the link in the email footer; POST is the mail app's one-click
      // unsubscribe (RFC 8058), which sends the same signed URL.
      const unsubscribe = request.method === "GET" || request.method === "POST";
      if (unsubscribe && pathname === "/unsubscribe") return await handleUnsubscribe(request, env);
      if (unsubscribe && pathname === "/unsubscribe-publisher") return await handleUnsubscribePublisher(request, env);
      if (unsubscribe && pathname === "/unsubscribe-low-credits") return await handleUnsubscribeLowCredits(request, env);
      if (request.method === "GET") return jsonResponse({ status: "ok" });
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
      if (pathname === "/send") return await handleSendRequest(request, env);
      if (pathname === "/run-digest") return await handleRunDigest(request, env);
      if (pathname === "/test-digest") return await handleTestDigest(request, env);
      if (pathname === "/publisher-subscribed") return await handlePublisherSubscribed(request, env);
      if (pathname === "/run-low-credit-emails") return await handleRunLowCreditEmails(request, env);
      if (pathname === "/ses-events") return await handleSesEvents(request, env);
      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Email notification request failed", error);
      return jsonResponse({ error: (error as Error).message }, 500);
    }
  },

  async queue(batch: MessageBatch<EmailJob>, env: Env): Promise<void> {
    const paused = sendingPaused(env);
    for (const message of batch.messages) {
      // Hold the message without calling the provider at all while paused —
      // retrying immediately would just keep hammering a blocked account.
      if (paused) {
        message.retry({ delaySeconds: 1800 });
        continue;
      }
      try {
        const messageId = await sendEmail(env, message.body);
        message.ack();
        await logSend(env, message.body, "sent", messageId);
      } catch (error) {
        console.error("Email queue job failed", message.body.to, error);
        if (error instanceof PermanentSendError) {
          message.ack();
          await logSend(env, message.body, "rejected", null, error);
        } else {
          message.retry({ delaySeconds: 60 });
          // max_retries is 5, so the sixth failed attempt is the last one.
          if (message.attempts > 5) await logSend(env, message.body, "failed", null, error);
        }
      }
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    // Three independent daily jobs share this cron: the digest, the match
    // nudge and the low-credit reminder. Each runs even if another throws, so
    // one failing never silences the rest.
    const results = await Promise.allSettled([
      runDailyDigest(env).then((result) => {
        console.log(`Daily digest: emailed ${result.emailedRecipients}/${result.recipients} recipients (${result.jobsCount} jobs, ${result.hotlistCount} hotlist profiles)`);
      }),
      runJobMatchNotifications(env),
      runLowCreditEmails(env).then((result) => {
        console.log(`Low-credit emails: sent ${result.emailed}`);
      }),
    ]);

    const failures = results.filter((result) => result.status === "rejected");
    for (const failure of failures) {
      console.error("Daily cron job failed", (failure as PromiseRejectedResult).reason);
    }
    // Surface a failure to Cloudflare's retry/alerting, but only after both
    // have had their turn.
    if (failures.length > 0) throw (failures[0] as PromiseRejectedResult).reason;
  },
};

// Asks Supabase to send the "N new jobs match your consultants" notification
// (in-app + push). All of the work — counting matches, checking preferences,
// sending — happens in the notify-job-matches edge function; this only
// triggers it on the daily schedule, the same way the digest is triggered.
async function runJobMatchNotifications(env: Env): Promise<void> {
  const response = await fetch(`${env.SUPABASE_URL}/functions/v1/notify-job-matches`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ token: env.DIGEST_NOTIFY_TOKEN }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`notify-job-matches HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  console.log(`Job match notifications: ${JSON.stringify(payload)}`);
}
