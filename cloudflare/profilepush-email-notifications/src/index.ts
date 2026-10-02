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
  // Where open images and tracked links point (this worker, on our domain).
  TRACKING_BASE_URL: string;
  // Secret in the GMass webhook URLs (bounces, blocks) that call /gmass-webhook.
  GMASS_WEBHOOK_TOKEN: string;
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
  // Set on emails written and sent from Admin > Emails > Compose.
  campaignId?: string;
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

// ── Morning brief ───────────────────────────────────────────────────────────
// The weekday email that replaced the generic digest: what's new for this
// person (requirements matching their consultants, consultants matching their
// requirements, posts from people they subscribe to), today's market, and one
// way back into the app. get_morning_brief picks the people and their
// matches; get_market_brief is the same for everyone. Recently active people
// get it every weekday, everyone else on Mondays only, and Android app users
// are left out (they get push).
type BriefItem = {
  kind: "job" | "hotlist";
  id: string;
  title: string | null;
  location?: string | null;
  rate_min?: number | null;
  rate_max?: number | null;
  visa?: string | null;
  experience?: number | null;
  name?: string | null;
};

type BriefRecipient = {
  user_id: string;
  account_id: string;
  email: string;
  first_name: string | null;
  persona: string | null;
  recently_active: boolean;
  consultant_count: number;
  requirement_count: number;
  match_kind: "job" | "hotlist" | null;
  match_total: number;
  matches: BriefItem[];
  followed_total: number;
  followed: BriefItem[];
};

type MarketBrief = {
  jobs_24h: number;
  hotlists_24h: number;
  top_roles: Array<{ role: string; jobs_30d: number; avg_rate: number | null }>;
  latest_jobs: BriefItem[];
  latest_hotlists: BriefItem[];
};

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.profilepush.app";

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function rateText(min?: number | null, max?: number | null): string {
  const lo = Number(min) || 0;
  const hi = Number(max) || 0;
  if (lo && hi && lo !== hi) return `$${lo}–${hi}/hr`;
  if (lo || hi) return `$${lo || hi}/hr`;
  return "";
}

function itemDetails(item: BriefItem): string {
  const parts = item.kind === "hotlist"
    ? [item.experience ? `${item.experience} yrs` : "", item.visa ?? "", item.location ?? "", rateText(item.rate_min, item.rate_max)]
    : [item.location ?? "", rateText(item.rate_min, item.rate_max)];
  return parts.map((p) => p.trim()).filter(Boolean).join(" · ");
}

// "your consultant" / "your 3 consultants".
function yourCount(n: number, one: string, many: string): string {
  return n === 1 ? `your ${one}` : `your ${n.toLocaleString("en-US")} ${many}`;
}

// Two posts that read the same (title and details) show once.
function distinctItems(list: BriefItem[]): BriefItem[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    const key = `${(item.title ?? "").toLowerCase()}|${itemDetails(item).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function itemUrl(base: string, item: BriefItem): string {
  return `${base}/${item.kind === "hotlist" ? "hotlist" : "job"}/${item.id}`;
}

function briefSubject(r: BriefRecipient, market: MarketBrief): string {
  if (r.match_total > 0 && r.match_kind === "job") {
    return `${plural(r.match_total, "new requirement matches", "new requirements match")} ${yourCount(r.consultant_count, "consultant", "consultants")}`;
  }
  if (r.match_total > 0 && r.match_kind === "hotlist") {
    return `${plural(r.match_total, "new consultant matches", "new consultants match")} ${r.requirement_count === 1 ? "your requirement" : "your requirements"}`;
  }
  if (r.followed_total > 0) return `${plural(r.followed_total, "new post", "new posts")} from people you subscribe to`;
  return r.persona === "vendor"
    ? `${plural(market.hotlists_24h, "new consultant", "new consultants")} on the bench today`
    : `${plural(market.jobs_24h, "new requirement", "new requirements")} on ProfilePush today`;
}

function renderMorningBrief(r: BriefRecipient, market: MarketBrief, unsubscribeUrl: string, appBaseUrl: string): EmailJob {
  const base = appBaseUrl.replace(/\/$/, "");
  const isVendor = r.match_kind === "hotlist" || (r.match_kind === null && r.persona === "vendor");
  const hasOwnPosts = isVendor ? r.requirement_count > 0 : r.consultant_count > 0;
  const subject = briefSubject(r, market);
  const greeting = r.first_name ? `Hi ${r.first_name},` : "Hi,";

  // The main list: their matches, or else today's newest posts for their side.
  const personal = r.match_total > 0;
  const items = distinctItems(personal ? r.matches : (isVendor ? market.latest_hotlists : market.latest_jobs));
  const listTitle = personal
    ? (r.match_kind === "job" ? "Top matches for your consultants" : "Top matches for your requirements")
    : (isVendor ? "New on the bench today" : "New requirements today");
  const seeAllUrl = personal
    ? `${base}${r.match_kind === "job" ? "/posts/hotlist" : "/posts/jobs"}`
    : `${base}${isVendor ? "/feed/hotlist" : "/feed/jobs"}`;
  const seeAllLabel = personal && r.match_total > items.length ? `See all ${r.match_total.toLocaleString("en-US")} matches` : "Open ProfilePush";

  const headline = personal
    ? { number: r.match_total, label: r.match_kind === "job" ? `new ${r.match_total === 1 ? "requirement matches" : "requirements match"} ${yourCount(r.consultant_count, "consultant", "consultants")} today` : `new ${r.match_total === 1 ? "consultant matches" : "consultants match"} ${r.requirement_count === 1 ? "your requirement" : "your requirements"} today` }
    : isVendor
      ? { number: market.hotlists_24h, label: "new consultants on the bench today" }
      : { number: market.jobs_24h, label: "new requirements posted today" };

  const nudge = hasOwnPosts ? null : isVendor
    ? { text: "Post your open requirements and we'll match bench consultants to them every morning.", label: "Post a requirement", url: `${base}/posts/jobs` }
    : { text: "Add your consultants and we'll match new requirements to them every morning.", label: "Add consultants", url: `${base}/posts/hotlist` };

  const row = (item: BriefItem, extra = "") => `
          <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
              <a href="${itemUrl(base, item)}" style="font-size: 15px; font-weight: 700; color: #0f172a; text-decoration: none;">${escapeHtml(item.title || (item.kind === "hotlist" ? "Consultant" : "Requirement"))}</a>
              <div style="font-size: 13px; color: #64748b; margin-top: 2px;">${escapeHtml([extra, itemDetails(item)].filter(Boolean).join(" · ") || "View details")}</div>
            </td>
          </tr>`;

  const followedHtml = r.followed_total > 0 ? `
          <tr><td style="padding: 24px 0 4px;"><div style="font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b;">From people you subscribe to · ${r.followed_total.toLocaleString("en-US")} new</div></td></tr>
          ${r.followed.map((item) => row(item, item.name ?? "")).join("")}` : "";

  const roles = market.top_roles.filter((t) => t.role);
  const marketHtml = roles.length > 0 ? `
          <tr>
            <td style="padding: 24px 0 0;">
              <div style="background: #f8fafc; border-radius: 8px; padding: 16px;">
                <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; margin-bottom: 8px;">Most requested this month</div>
                ${roles.map((t) => `<div style="font-size: 14px; color: #1e293b; padding: 3px 0;"><b>${escapeHtml(t.role)}</b> · ${Number(t.jobs_30d).toLocaleString("en-US")} requirements${t.avg_rate ? ` · avg $${t.avg_rate}/hr` : ""}</div>`).join("")}
                <div style="font-size: 13px; color: #64748b; margin-top: 8px;">Today: ${Number(market.jobs_24h).toLocaleString("en-US")} requirements and ${Number(market.hotlists_24h).toLocaleString("en-US")} consultants posted.</div>
              </div>
            </td>
          </tr>` : "";

  const nudgeHtml = nudge ? `
          <tr>
            <td style="padding: 24px 0 0;">
              <div style="border: 1px solid #dbeafe; background: #eff6ff; border-radius: 8px; padding: 16px;">
                <div style="font-size: 14px; color: #1e3a8a; line-height: 1.5;">${escapeHtml(nudge.text)}</div>
                <a href="${nudge.url}" style="display: inline-block; margin-top: 10px; font-size: 14px; font-weight: 700; color: #2563eb; text-decoration: none;">${escapeHtml(nudge.label)} →</a>
              </div>
            </td>
          </tr>` : "";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(items[0]?.title ? `Top: ${items[0].title}${itemDetails(items[0]) ? ` · ${itemDetails(items[0])}` : ""}` : subject)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 32px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px;">
          <tr>
            <td style="padding-bottom: 24px;">
              <img src="${base}/favicon.svg" width="24" height="24" alt="" style="vertical-align: middle; border-radius: 6px;" />
              <span style="font-size: 16px; font-weight: 800; color: #0f172a; vertical-align: middle; margin-left: 8px;">ProfilePush</span>
            </td>
          </tr>
          <tr><td style="padding-bottom: 6px;"><p style="margin: 0; font-size: 14px; color: #334155;">${escapeHtml(greeting)}</p></td></tr>
          <tr>
            <td style="padding-bottom: 18px;">
              <div style="font-size: 40px; font-weight: 800; color: #2563eb; line-height: 1.1;">${Number(headline.number).toLocaleString("en-US")}</div>
              <div style="font-size: 15px; color: #334155; margin-top: 2px;">${escapeHtml(headline.label)}</div>
            </td>
          </tr>
          <tr><td style="padding-bottom: 4px;"><div style="font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b;">${escapeHtml(listTitle)}</div></td></tr>
          ${items.map((item) => row(item)).join("")}
          <tr>
            <td style="padding: 20px 0 0;">
              <a href="${seeAllUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; border-radius: 6px;">${escapeHtml(seeAllLabel)}</a>
            </td>
          </tr>
          ${followedHtml}
          ${nudgeHtml}
          ${marketHtml}
          <tr>
            <td style="padding: 24px 0 0;">
              <p style="margin: 0; font-size: 13px; color: #64748b;">Get matches as a notification the moment they're posted: <a href="${PLAY_STORE_URL}" style="color: #2563eb;">install the Android app</a>.</p>
            </td>
          </tr>
          <tr>
            <td style="border-top: 1px solid #f1f5f9; padding-top: 16px; margin-top: 24px; text-align: center;">
              <p style="margin: 16px 0 0; font-size: 12px; color: #94a3b8;">
                Your ProfilePush brief, every weekday morning.
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

  const lines = (list: BriefItem[], extra?: (i: BriefItem) => string) =>
    list.map((i) => `- ${i.title ?? ""}${[extra?.(i) ?? "", itemDetails(i)].filter(Boolean).length ? ` (${[extra?.(i) ?? "", itemDetails(i)].filter(Boolean).join(" · ")})` : ""}: ${itemUrl(base, i)}`).join("\n");
  const text = `${greeting}

${Number(headline.number).toLocaleString("en-US")} ${headline.label}.

${listTitle}:
${lines(items)}

${seeAllLabel}: ${seeAllUrl}
${r.followed_total > 0 ? `\nFrom people you subscribe to (${r.followed_total} new):\n${lines(r.followed, (i) => i.name ?? "")}\n` : ""}${nudge ? `\n${nudge.text} ${nudge.url}\n` : ""}${roles.length ? `\nMost requested this month:\n${roles.map((t) => `- ${t.role}: ${t.jobs_30d} requirements${t.avg_rate ? `, avg $${t.avg_rate}/hr` : ""}`).join("\n")}\n` : ""}
Get matches as a notification: ${PLAY_STORE_URL}

---
Your ProfilePush brief, every weekday morning. Unsubscribe: ${unsubscribeUrl}`;

  return { to: r.email, subject, html, text, lane: "user", category: "morning_brief", unsubscribeUrl };
}

async function fetchMorningBrief(env: Env): Promise<{ recipients: BriefRecipient[]; market: MarketBrief }> {
  const call = async (fn: string) => {
    const response = await supabaseRequest(env, `rpc/${fn}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!response.ok) throw new Error(`${fn} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return response.json();
  };
  const [recipients, market] = await Promise.all([call("get_morning_brief"), call("get_market_brief")]);
  return { recipients: recipients as BriefRecipient[], market: market as MarketBrief };
}

// New hotlists get their embeddings when someone runs AI Match on hotlists.
// Run that catch-up first so vendors' matches include today's consultants.
async function embedNewPosts(env: Env): Promise<void> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/functions/v1/ai-match`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, apikey: env.SUPABASE_ANON_KEY },
      body: JSON.stringify({ mode: "embed_backlog" }),
      signal: AbortSignal.timeout(150_000),
    });
    console.log("embed_backlog", response.status, (await response.text()).slice(0, 200));
  } catch (error) {
    console.error("embed_backlog failed", error);
  }
}

// Records who has the mobile app (from OneSignal) before the brief picks its
// recipients, so app users get push instead of this email.
async function syncAppInstalls(env: Env): Promise<void> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/functions/v1/sync-app-installs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, apikey: env.SUPABASE_ANON_KEY },
      body: JSON.stringify({ token: env.DIGEST_NOTIFY_TOKEN }),
      signal: AbortSignal.timeout(120_000),
    });
    console.log("sync-app-installs", response.status, (await response.text()).slice(0, 200));
  } catch (error) {
    console.error("sync-app-installs failed", error);
  }
}

async function runMorningBrief(env: Env, now = new Date()): Promise<{ emailed: number; skipped: number; reason?: string }> {
  // The cron fires at 13:30 UTC, morning in the US. Weekends are quiet (job
  // inflow drops from ~600 a day to ~40), so the brief is weekdays only.
  const weekday = now.getUTCDay();
  if (weekday === 0 || weekday === 6) return { emailed: 0, skipped: 0, reason: "weekend" };
  await Promise.all([embedNewPosts(env), syncAppInstalls(env)]);
  const { recipients, market } = await fetchMorningBrief(env);
  const jobs: EmailJob[] = [];
  let skipped = 0;
  for (const r of recipients) {
    // People who haven't visited in 30 days get it on Mondays only.
    if (!r.recently_active && weekday !== 1) { skipped += 1; continue; }
    jobs.push(renderMorningBrief(r, market, await buildUnsubscribeUrl(env, r.user_id, r.account_id), env.APP_BASE_URL));
  }
  for (const chunk of chunkEmailJobsForQueue(jobs)) {
    await env.EMAIL_QUEUE.sendBatch(chunk.map((job) => ({ body: job })));
  }
  return { emailed: jobs.length, skipped };
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
): Promise<{ jobsCount: number; hotlistCount: number; recipients: number }> {
  // The digest email was replaced by the morning brief (runMorningBrief);
  // this keeps the in-app bell and push digest.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [jobsCount, hotlistCount, allRecipients] = await Promise.all([
    countSince(env, "radar_match_results", since),
    countSince(env, "radar_match_hotlist", since),
    fetchRecipients(env),
  ]);

  try {
    await notifyInAppAndPush(env, allRecipients, jobsCount, hotlistCount);
  } catch (error) {
    // In-app/push notification is best-effort.
    console.error("notifyInAppAndPush threw", error);
  }

  return { jobsCount, hotlistCount, recipients: allRecipients.length };
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

// ── Weekly results ──────────────────────────────────────────────────────────
// Fridays: each active user's last 7 days (emails sent to vendors, AI drafts,
// AI Match runs, new subscribers, and how many new posts matched their own
// consultants or requirements), with one way back in and a top-up prompt
// when credits are low. get_weekly_results picks the people and the numbers
// and leaves out anyone with nothing to report.
type WeeklyResult = {
  user_id: string;
  account_id: string;
  email: string;
  first_name: string | null;
  persona: string | null;
  credits_balance: number | string;
  emails_sent: number;
  drafts: number;
  ai_match_runs: number;
  new_subscribers: number;
  matches: number;
  match_kind: "job" | "hotlist" | null;
  consultant_count: number;
  requirement_count: number;
};

async function buildWeeklyUnsubscribeUrl(env: Env, userId: string, accountId: string): Promise<string> {
  const sig = await hmacHex(env.UNSUBSCRIBE_SECRET, `weekly_results:${userId}:${accountId}`);
  const url = new URL("/unsubscribe-weekly", env.WORKER_BASE_URL);
  url.searchParams.set("uid", userId);
  url.searchParams.set("aid", accountId);
  url.searchParams.set("sig", sig);
  return url.toString();
}

function renderWeeklyResults(r: WeeklyResult, unsubscribeUrl: string, appBaseUrl: string, now = new Date()): EmailJob {
  const base = appBaseUrl.replace(/\/$/, "");
  const credits = Math.max(0, Math.floor(Number(r.credits_balance) || 0));
  const isVendor = r.match_kind === "hotlist" || (r.match_kind === null && r.persona === "vendor");
  const start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const range = `${start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  const matchNoun = isVendor ? "consultants matched your requirements" : "requirements matched your consultants";

  const subject = r.emails_sent > 0
    ? `Your week: ${plural(r.emails_sent, "email", "emails")} to vendors${r.matches > 0 ? `, ${r.matches.toLocaleString("en-US")} new matches` : ""}`
    : r.matches > 0
      ? `${r.matches.toLocaleString("en-US")} new ${matchNoun} this week`
      : "Your week on ProfilePush";

  const stats: Array<[string, number]> = [
    ["Emails to vendors", r.emails_sent],
    ["AI drafts written", r.drafts],
    ["AI Match runs", r.ai_match_runs],
    ["New subscribers", r.new_subscribers],
  ];

  const matchLine = r.matches > 0
    ? (r.emails_sent > 0
      ? `${r.matches.toLocaleString("en-US")} new ${matchNoun} this week, and you emailed ${plural(r.emails_sent, "vendor", "vendors")}. Keep going: each one is a submission waiting to happen.`
      : `${r.matches.toLocaleString("en-US")} new ${matchNoun} this week, and none of them heard from you yet.`)
    : (isVendor ? r.requirement_count === 0 : r.consultant_count === 0)
      ? (isVendor ? "Post your open requirements and we'll match bench consultants to them every morning." : "Add your consultants and we'll match new requirements to them every morning.")
      : "";
  const matchUrl = `${base}${isVendor ? "/posts/jobs" : "/posts/hotlist"}`;
  const matchCta = r.matches > 0 ? "See your matches" : (isVendor ? "Post a requirement" : "Add consultants");
  const lowCredits = credits < 100;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(matchLine || subject)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 32px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px;">
          <tr>
            <td style="padding-bottom: 24px;">
              <img src="${base}/favicon.svg" width="24" height="24" alt="" style="vertical-align: middle; border-radius: 6px;" />
              <span style="font-size: 16px; font-weight: 800; color: #0f172a; vertical-align: middle; margin-left: 8px;">ProfilePush</span>
            </td>
          </tr>
          <tr><td style="padding-bottom: 4px;"><p style="margin: 0; font-size: 14px; color: #334155;">${escapeHtml(r.first_name ? `Hi ${r.first_name},` : "Hi,")}</p></td></tr>
          <tr><td style="padding-bottom: 18px;"><p style="margin: 0; font-size: 20px; font-weight: 800; color: #0f172a;">Your week on ProfilePush</p><p style="margin: 2px 0 0; font-size: 13px; color: #64748b;">${escapeHtml(range)}</p></td></tr>
          <tr>
            <td style="padding-bottom: 20px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  ${stats.map(([label, value]) => `<td width="25%" style="padding: 12px 6px; background: #f8fafc; border-radius: 8px; text-align: center; border: 4px solid #ffffff;"><div style="font-size: 24px; font-weight: 800; color: ${value > 0 ? "#2563eb" : "#94a3b8"};">${Number(value).toLocaleString("en-US")}</div><div style="font-size: 11px; color: #64748b; margin-top: 2px;">${escapeHtml(label)}</div></td>`).join("")}
                </tr>
              </table>
            </td>
          </tr>
          ${matchLine ? `<tr><td style="padding-bottom: 16px;"><p style="margin: 0; font-size: 15px; line-height: 1.55; color: #1e293b;">${escapeHtml(matchLine)}</p></td></tr>` : ""}
          <tr>
            <td style="padding-bottom: 24px;">
              <a href="${matchUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; border-radius: 6px;">${escapeHtml(matchCta)}</a>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 8px;">
              <div style="background: ${lowCredits ? "#fff7ed" : "#f8fafc"}; border-radius: 8px; padding: 14px 16px; font-size: 14px; color: #1e293b;">
                <b>${credits.toLocaleString("en-US")} credits left.</b>
                ${lowCredits ? ` Top up from ₹249 to keep matching and sending next week. <a href="${base}/billing?openPlan=1" style="color: #2563eb; font-weight: 700;">Top up</a>` : ""}
              </div>
            </td>
          </tr>
          <tr>
            <td style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center;">
              <p style="margin: 16px 0 0; font-size: 12px; color: #94a3b8;">Your ProfilePush week, every Friday. <a href="${unsubscribeUrl}" style="color: #94a3b8; text-decoration: underline;">Unsubscribe</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${r.first_name ? `Hi ${r.first_name},` : "Hi,"}

Your week on ProfilePush (${range}):
${stats.map(([label, value]) => `- ${label}: ${value}`).join("\n")}
${matchLine ? `\n${matchLine}\n` : ""}
${matchCta}: ${matchUrl}

${credits} credits left.${lowCredits ? ` Top up from ₹249: ${base}/billing?openPlan=1` : ""}

---
Your ProfilePush week, every Friday. Unsubscribe: ${unsubscribeUrl}`;

  return { to: r.email, subject, html, text, lane: "user", category: "weekly_results", unsubscribeUrl };
}

async function runWeeklyResults(env: Env, force = false, now = new Date()): Promise<{ emailed: number; reason?: string }> {
  if (!force && now.getUTCDay() !== 5) return { emailed: 0, reason: "not Friday" };
  const response = await supabaseRequest(env, "rpc/get_weekly_results", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!response.ok) throw new Error(`get_weekly_results HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const rows = await response.json<WeeklyResult[]>();
  const jobs: EmailJob[] = [];
  for (const r of rows) {
    jobs.push(renderWeeklyResults(r, await buildWeeklyUnsubscribeUrl(env, r.user_id, r.account_id), env.APP_BASE_URL, now));
  }
  for (const chunk of chunkEmailJobsForQueue(jobs)) {
    await env.EMAIL_QUEUE.sendBatch(chunk.map((job) => ({ body: job })));
  }
  return { emailed: jobs.length };
}

async function handleUnsubscribeWeekly(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("uid") ?? "";
  const accountId = url.searchParams.get("aid") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  const expected = await hmacHex(env.UNSUBSCRIBE_SECRET, `weekly_results:${userId}:${accountId}`);
  if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(accountId) || !timingSafeEqual(sig, expected)) {
    return new Response("Invalid or expired unsubscribe link.", { status: 400, headers: { "Content-Type": "text/plain" } });
  }
  const response = await supabaseRequest(env, "notification_preferences?on_conflict=user_id,notif_type", {
    method: "POST",
    headers: { ...serviceHeaders(env, true), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, account_id: accountId, notif_type: "weekly_results", email_enabled: false }),
  });
  if (!response.ok) {
    return new Response("Something went wrong. Please try again later.", { status: 500, headers: { "Content-Type": "text/plain" } });
  }
  await logUnsubscribe(env, "weekly_results", userId, null);
  return new Response("You've been unsubscribed from the ProfilePush weekly summary.", { status: 200, headers: { "Content-Type": "text/plain" } });
}

// ── Daily "X subscribed to you" for unclaimed publishers ────────────────────
// Once a day, each unclaimed publisher with new subscribers gets one plain
// email naming them, with a one-tap claim link (claim-profile signs them in
// and lands them on their profile), a link to their public profile, and
// links to remove the profile or stop these emails. These people aren't
// users, so it's outreach lane (GMass), never SES.
type SubscriberDigest = {
  publisher_id: string;
  email: string;
  slug: string;
  display_name: string;
  post_noun: "requirements" | "hotlists";
  new_count: number;
  total_count: number;
  new_names: string[];
  new_follower_ids: string[];
};

async function buildRemoveProfileUrl(env: Env, email: string): Promise<string> {
  const sig = await hmacHex(env.UNSUBSCRIBE_SECRET, `remove-profile:${email}`);
  const url = new URL("/remove-profile", env.WORKER_BASE_URL);
  url.searchParams.set("e", email);
  url.searchParams.set("sig", sig);
  return url.toString();
}

async function createClaimUrl(env: Env, publisherId: string): Promise<string | null> {
  const response = await supabaseRequest(env, "rpc/create_profile_claim_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_publisher_id: publisherId }),
  });
  if (!response.ok) return null;
  const token = await response.json<string | null>();
  return token ? `${env.SUPABASE_URL}/functions/v1/claim-profile?t=${token}` : null;
}

function renderSubscriberDigest(d: SubscriberDigest, urls: { claim: string; profile: string; remove: string; unsubscribe: string }): EmailJob {
  const first = (d.display_name || "").trim().split(/\s+/)[0] || "";
  const names = d.new_names.filter(Boolean);
  // "Priya (Acme)", "Priya and Ravi", "Priya, Ravi and 3 others".
  const rest = (n: number) => `${n} ${n === 1 ? "other" : "others"}`;
  const who = names.length === 0
    ? `${d.new_count} ${d.new_count === 1 ? "recruiter" : "recruiters"}`
    : d.new_count === 1 ? names[0]
    : names.length === 1 ? `${names[0]} and ${rest(d.new_count - 1)}`
    : d.new_count === 2 ? `${names[0]} and ${names[1]}`
    : `${names[0]}, ${names[1]} and ${rest(d.new_count - 2)}`;
  const leadName = names[0] ? names[0].replace(/\s*\(.*\)$/, "") : "Recruiters";
  const subject = names.length === 0
    ? `${who} subscribed to your ${d.post_noun} on ProfilePush`
    : d.new_count === 1
    ? `${leadName} subscribed to your ${d.post_noun} on ProfilePush`
    : `${leadName} and ${d.new_count - 1} ${d.new_count - 1 === 1 ? "other" : "others"} subscribed to your ${d.post_noun}`;
  const line1 = `${who} subscribed to your ${d.post_noun} on ProfilePush. They'll see your new ${d.post_noun} as soon as you post them.`;
  const line2 = d.total_count > d.new_count ? `You now have ${d.total_count} subscribers.` : "";
  const claimLine = "Claim your profile to see who subscribes, get matches for your posts every morning, and reply in one click. It's free and takes one tap, no password.";

  const text = `${first ? `Hi ${first},` : "Hi,"}

${line1}${line2 ? `\n${line2}` : ""}

${claimLine}
Claim your profile: ${urls.claim}

Your profile: ${urls.profile}

---
Not you, or don't want a profile? Remove my profile: ${urls.remove}
Stop these emails: ${urls.unsubscribe}`;

  const p = (t: string) => `<p style="margin: 0 0 14px; font-size: 15px; line-height: 1.55; color: #1e293b;">${t}</p>`;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(subject)}</title></head>
<body style="margin: 0; padding: 24px 20px; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 520px;">
    ${p(escapeHtml(first ? `Hi ${first},` : "Hi,"))}
    ${p(`${escapeHtml(line1)}${line2 ? `<br>${escapeHtml(line2)}` : ""}`)}
    ${p(escapeHtml(claimLine))}
    <p style="margin: 0 0 20px;"><a href="${urls.claim}" style="display: inline-block; padding: 11px 22px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; border-radius: 6px;">Claim your profile</a></p>
    ${p(`<a href="${urls.profile}" style="color: #2563eb;">See your profile</a>`)}
    <p style="margin: 24px 0 0; font-size: 12px; color: #94a3b8; line-height: 1.6;">
      ProfilePush, the AI copilot for vendors and bench sales recruiters.<br>
      Not you, or don't want a profile? <a href="${urls.remove}" style="color: #94a3b8;">Remove my profile</a> · <a href="${urls.unsubscribe}" style="color: #94a3b8;">Stop these emails</a>
    </p>
  </div>
</body>
</html>`;
  return { to: d.email, subject, html, text, lane: "outreach", category: "subscriber_notice", unsubscribeUrl: urls.unsubscribe };
}

async function runSubscriberDigests(env: Env): Promise<{ emailed: number }> {
  const response = await supabaseRequest(env, "rpc/get_pending_subscriber_digests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_limit: 300 }),
  });
  if (!response.ok) throw new Error(`get_pending_subscriber_digests HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const rows = await response.json<SubscriberDigest[]>();
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  const jobs: EmailJob[] = [];
  const sent: Array<{ publisher_id: string; follower_ids: string[] }> = [];
  for (const d of rows) {
    const profile = `${base}/profile/${encodeURIComponent(d.slug)}`;
    const claim = (await createClaimUrl(env, d.publisher_id)) ?? `${base}/signup?email=${encodeURIComponent(d.email)}`;
    jobs.push(renderSubscriberDigest(d, {
      claim,
      profile,
      remove: await buildRemoveProfileUrl(env, d.email),
      unsubscribe: await buildPublisherUnsubscribeUrl(env, d.email),
    }));
    sent.push({ publisher_id: d.publisher_id, follower_ids: d.new_follower_ids });
  }
  for (const chunk of chunkEmailJobsForQueue(jobs)) {
    await env.EMAIL_QUEUE.sendBatch(chunk.map((job) => ({ body: job })));
  }
  if (sent.length > 0) {
    const marked = await supabaseRequest(env, "rpc/mark_subscriber_digests_sent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_rows: sent }),
    });
    if (!marked.ok) console.error("mark_subscriber_digests_sent failed", marked.status, await marked.text().catch(() => ""));
  }
  return { emailed: jobs.length };
}

async function handleRemoveProfile(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const email = (url.searchParams.get("e") ?? "").trim().toLowerCase();
  const sig = url.searchParams.get("sig") ?? "";
  const expected = await hmacHex(env.UNSUBSCRIBE_SECRET, `remove-profile:${email}`);
  if (!email || !timingSafeEqual(sig, expected)) {
    return new Response("Invalid or expired link.", { status: 400, headers: { "Content-Type": "text/plain" } });
  }
  const response = await supabaseRequest(env, "rpc/remove_publisher_profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_email: email }),
  });
  if (!response.ok) {
    return new Response("Something went wrong. Please try again later.", { status: 500, headers: { "Content-Type": "text/plain" } });
  }
  await logUnsubscribe(env, "profile_removed", null, email);
  return new Response("Your ProfilePush profile has been removed, and we won't email you about it again.", { status: 200, headers: { "Content-Type": "text/plain" } });
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
  sendId: string = crypto.randomUUID(),
  engagementTracked = false,
): Promise<void> {
  try {
    const response = await supabaseRequest(env, "email_sends", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        id: sendId,
        engagement_tracked: engagementTracked,
        category: job.category ?? "other",
        lane: job.lane ?? "user",
        provider: providerFor(env, job),
        to_email: job.to,
        subject: job.subject.slice(0, 300),
        status,
        provider_message_id: messageId,
        campaign_id: job.campaignId ?? null,
        // The content as written, before tracking, so viewing it in Admin >
        // Emails > Conversations never counts as the recipient opening it.
        body_text: job.text ? job.text.slice(0, 50_000) : null,
        body_html: job.html ? job.html.slice(0, 200_000) : null,
        error: error ? String((error as Error).message ?? error).slice(0, 500) : null,
      }),
    });
    if (!response.ok) console.error("email_sends insert failed", response.status, await response.text().catch(() => ""));
  } catch (err) {
    console.error("email_sends insert threw", err);
  }
}

async function logUnsubscribe(env: Env, category: string, userId: string | null, email: string | null, campaignId: string | null = null): Promise<void> {
  try {
    await supabaseRequest(env, "email_unsubscribes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ category, user_id: userId, email, campaign_id: campaignId }),
    });
  } catch (err) {
    console.error("email_unsubscribes insert threw", err);
  }
}

// ── Domain check for email to non-users ─────────────────────────────────────
// Addresses read out of posts sometimes have a typo'd or glued-on ending
// ("x.comkey", "x.om") or a domain that no longer exists, and those bounce.
// Before any outreach-lane email the domain must have a mail server (an MX
// record, or an address record as the fallback mail host), checked with
// Cloudflare's DNS over HTTPS and cached in email_domain_checks for 30 days.
// A DNS hiccup counts as "accepts mail" so a lookup failure never drops email.
async function domainAcceptsMail(env: Env, email: string): Promise<boolean> {
  const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
  if (!domain || !domain.includes(".")) return false;

  const cached = await supabaseRequest(env, `email_domain_checks?domain=eq.${encodeURIComponent(domain)}&select=accepts_mail,checked_at&limit=1`);
  if (cached.ok) {
    const row = (await cached.json<Array<{ accepts_mail: boolean; checked_at: string }>>())[0];
    if (row && Date.now() - new Date(row.checked_at).getTime() < 30 * 24 * 60 * 60 * 1000) return row.accepts_mail;
  }

  const lookup = async (type: "MX" | "A"): Promise<"yes" | "no" | "unknown"> => {
    try {
      const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return "unknown";
      const answer = await response.json<{ Status: number; Answer?: Array<{ type: number }> }>();
      if (answer.Status === 3) return "no"; // NXDOMAIN: the domain doesn't exist
      if (answer.Status !== 0) return "unknown";
      return (answer.Answer ?? []).some((a) => a.type === (type === "MX" ? 15 : 1)) ? "yes" : "no";
    } catch {
      return "unknown";
    }
  };

  const mx = await lookup("MX");
  const result = mx === "yes" ? "yes" : mx === "unknown" ? "unknown" : await lookup("A");
  if (result === "unknown") return true;
  const accepts = result === "yes";
  await supabaseRequest(env, "email_domain_checks?on_conflict=domain", {
    method: "POST",
    headers: { ...serviceHeaders(env, true), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ domain, accepts_mail: accepts, checked_at: new Date().toISOString() }),
  }).catch(() => undefined);
  return accepts;
}

// ── GMass verification and bounces (outreach lane) ──────────────────────────
// Before the first email to someone who isn't a user, GMass's free verifier
// checks the address (cached per address in email_verifications). Invalid,
// Malformed and NoMxRecord are never sent; Unknown (catch-all domains) and
// anything the verifier can't answer still go. Addresses GMass reports as
// bounced or blocked (its webhooks call /gmass-webhook) land in
// email_suppressions and are never emailed again.
const UNSENDABLE_STATUSES = new Set(["Invalid", "Malformed", "NoMxRecord"]);

async function outreachBlockReason(env: Env, email: string): Promise<string | null> {
  const address = email.trim().toLowerCase();
  const suppressed = await supabaseRequest(env, `email_suppressions?email=eq.${encodeURIComponent(address)}&select=reason&limit=1`);
  if (suppressed.ok) {
    const row = (await suppressed.json<Array<{ reason: string }>>())[0];
    if (row) return `Earlier ${row.reason} (GMass); not sent`;
  }
  if (!(await domainAcceptsMail(env, address))) return "No mail server for this domain; not sent";

  const cached = await supabaseRequest(env, `email_verifications?email=eq.${encodeURIComponent(address)}&select=status,sendable&limit=1`);
  if (cached.ok) {
    const row = (await cached.json<Array<{ status: string; sendable: boolean }>>())[0];
    if (row) return row.sendable ? null : `Address failed verification (${row.status}); not sent`;
  }
  try {
    const response = await fetch(`https://verify.gmass.co/verify?email=${encodeURIComponent(address)}&key=${encodeURIComponent(env.GMASS_API_KEY)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null; // verifier unavailable: don't hold the email back
    const result = await response.json<{ Success?: boolean; Valid?: boolean; Status?: string }>();
    if (result.Success === false || !result.Status) return null;
    const sendable = !UNSENDABLE_STATUSES.has(result.Status);
    await supabaseRequest(env, "email_verifications?on_conflict=email", {
      method: "POST",
      headers: { ...serviceHeaders(env, true), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ email: address, status: result.Status, sendable, checked_at: new Date().toISOString() }),
    }).catch(() => undefined);
    return sendable ? null : `Address failed verification (${result.Status}); not sent`;
  } catch {
    return null;
  }
}

// GMass calls this for bounces and blocks: one URL per event, e.g.
// /gmass-webhook?token=...&event=bounce and ...&event=block. The payload
// format isn't documented in detail, so every address in it (other than our
// own) is taken, and the raw call is kept in gmass_webhook_events.
async function handleGmassWebhook(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!env.GMASS_WEBHOOK_TOKEN || !timingSafeEqual(token, env.GMASS_WEBHOOK_TOKEN)) return jsonResponse({ error: "Unauthorized" }, 401);
  const event = (url.searchParams.get("event") ?? "bounce").toLowerCase() === "block" ? "block" : "bounce";

  let payload: unknown = null;
  let raw = "";
  if (request.method === "POST") {
    raw = await request.text();
    try { payload = JSON.parse(raw); } catch { payload = Object.fromEntries(new URLSearchParams(raw)); }
  } else {
    payload = Object.fromEntries(url.searchParams);
  }
  const own = new Set([env.GMASS_FROM_EMAIL, env.SES_FROM_EMAIL].map((e) => (e ?? "").toLowerCase()));
  const found = [...new Set((JSON.stringify(payload ?? raw).match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [])
    .map((e) => e.toLowerCase()))]
    .filter((e) => !own.has(e) && !e.endsWith("@profilepush.ai") && !e.endsWith("@mail.profilepush.ai") && !e.endsWith("@gmass.co"));

  await supabaseRequest(env, "gmass_webhook_events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ event, emails: found, payload: typeof payload === "object" ? payload : { raw } }),
  }).catch(() => undefined);

  if (found.length > 0) {
    const response = await supabaseRequest(env, "rpc/record_gmass_bounces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_emails: found, p_reason: event }),
    });
    if (!response.ok) return jsonResponse({ error: `record_gmass_bounces HTTP ${response.status}` }, 500);
  }
  return jsonResponse({ recorded: found.length, event });
}

// ── Open and click tracking ─────────────────────────────────────────────────
// Every email gets an id before it's sent. Its links go through
// /c/<id> (signed, so the redirect can't be pointed anywhere else) and a 1x1
// image loads /o/<id>.gif; both record on email_sends. Unsubscribe links are
// left alone. Opens are approximate (Apple Mail and some scanners load images
// on their own); clicks are the reliable signal.
const TRANSPARENT_GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const SEND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function clickSignature(env: Env, sendId: string, url: string): Promise<string> {
  return (await hmacHex(env.UNSUBSCRIBE_SECRET, `click:${sendId}:${url}`)).slice(0, 32);
}

async function addTracking(env: Env, job: EmailJob, sendId: string): Promise<EmailJob | null> {
  if (!job.html || !env.TRACKING_BASE_URL) return null;
  const base = env.TRACKING_BASE_URL.replace(/\/$/, "");
  let html = job.html;
  const hrefs = [...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))];
  for (const href of hrefs) {
    const url = href.replace(/&amp;/g, "&");
    if (url === job.unsubscribeUrl || /\/unsubscribe/.test(url)) continue;
    const tracked = `${base}/c/${sendId}?u=${encodeURIComponent(url)}&s=${await clickSignature(env, sendId, url)}`;
    html = html.split(`href="${href}"`).join(`href="${tracked.replace(/&/g, "&amp;")}"`);
  }
  const pixel = `<img src="${base}/o/${sendId}.gif" width="1" height="1" alt="" style="display: block; width: 1px; height: 1px; border: 0;" />`;
  html = html.includes("</body>") ? html.replace("</body>", `${pixel}</body>`) : `${html}${pixel}`;
  return { ...job, html };
}

// Sends one job with tracking and logs it under its id.
async function sendTracked(env: Env, job: EmailJob): Promise<string | null> {
  const sendId = crypto.randomUUID();
  const tracked = await addTracking(env, job, sendId);
  const messageId = await sendEmail(env, tracked ?? job);
  await logSend(env, job, "sent", messageId, undefined, sendId, tracked !== null);
  return messageId;
}

function recordEngagement(env: Env, fn: "record_email_open" | "record_email_click", sendId: string): Promise<unknown> {
  return supabaseRequest(env, `rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_id: sendId }),
  }).catch((err) => console.error(fn, "failed", err));
}

function handleOpen(env: Env, ctx: ExecutionContext, sendId: string): Response {
  ctx.waitUntil(recordEngagement(env, "record_email_open", sendId));
  return new Response(TRANSPARENT_GIF, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, private" },
  });
}

async function handleClick(request: Request, env: Env, ctx: ExecutionContext, sendId: string): Promise<Response> {
  const url = new URL(request.url);
  const target = url.searchParams.get("u") ?? "";
  const sig = url.searchParams.get("s") ?? "";
  const valid = /^https?:\/\//.test(target) && timingSafeEqual(sig, await clickSignature(env, sendId, target));
  if (!valid) return Response.redirect(env.APP_BASE_URL, 302);
  ctx.waitUntil(recordEngagement(env, "record_email_click", sendId));
  return Response.redirect(target, 302);
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

// ── Campaigns (Admin > Emails > Compose) ────────────────────────────────────
// admin-emails picks the recipients and renders the email; this fills in each
// recipient's first name and own signed unsubscribe link, and queues them on
// the user lane (SES) with one-click unsubscribe headers. {{first_name}} and
// {{unsubscribe_url}} are the only placeholders.
type BroadcastRecipient = { user_id: string | null; account_id: string | null; email: string; first_name: string | null };

const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

async function buildAnnouncementsUnsubscribeUrl(env: Env, userId: string, accountId: string, campaignId: string | null): Promise<string> {
  const sig = await hmacHex(env.UNSUBSCRIBE_SECRET, `announcements:${userId}:${accountId}`);
  const url = new URL("/unsubscribe-announcements", env.WORKER_BASE_URL);
  url.searchParams.set("uid", userId);
  url.searchParams.set("aid", accountId);
  if (campaignId) url.searchParams.set("c", campaignId);
  url.searchParams.set("sig", sig);
  return url.toString();
}

async function handleBroadcast(request: Request, env: Env): Promise<Response> {
  if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
  const body = await request.json<{ campaign_id?: unknown; subject?: unknown; html?: unknown; text?: unknown; recipients?: unknown }>();
  const campaignId = typeof body.campaign_id === "string" && UUID_PATTERN.test(body.campaign_id) ? body.campaign_id : null;
  const subject = typeof body.subject === "string" ? body.subject : "";
  const html = typeof body.html === "string" ? body.html : "";
  const text = typeof body.text === "string" ? body.text : "";
  const recipients = Array.isArray(body.recipients) ? (body.recipients as BroadcastRecipient[]) : [];
  if (!subject || !html || recipients.length === 0) return jsonResponse({ error: "subject, html and recipients are required" }, 400);
  if (recipients.length > 1000) return jsonResponse({ error: "At most 1,000 recipients per call" }, 400);

  const appSettingsUrl = `${env.APP_BASE_URL.replace(/\/$/, "")}/account`;
  const jobs: EmailJob[] = [];
  for (const r of recipients) {
    if (typeof r?.email !== "string" || !/^\S+@\S+\.\S+$/.test(r.email)) continue;
    // A test send has no user behind it, so its link goes to account settings.
    const unsubscribeUrl = r.user_id && r.account_id && UUID_PATTERN.test(r.user_id) && UUID_PATTERN.test(r.account_id)
      ? await buildAnnouncementsUnsubscribeUrl(env, r.user_id, r.account_id, campaignId)
      : appSettingsUrl;
    const fill = (template: string, escape: boolean) => template
      .replaceAll("{{first_name}}", escape ? escapeHtml(r.first_name || "there") : (r.first_name || "there"))
      .replaceAll("{{unsubscribe_url}}", unsubscribeUrl);
    jobs.push({
      to: r.email,
      subject: fill(subject, false),
      html: fill(html, true),
      text: fill(text, false),
      lane: "user",
      category: campaignId ? "campaign" : "campaign_test",
      campaignId: campaignId ?? undefined,
      unsubscribeUrl,
    });
  }
  for (const chunk of chunkEmailJobsForQueue(jobs)) {
    await env.EMAIL_QUEUE.sendBatch(chunk.map((job) => ({ body: job })));
  }
  return jsonResponse({ queued: jobs.length }, 202);
}

async function handleUnsubscribeAnnouncements(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("uid") ?? "";
  const accountId = url.searchParams.get("aid") ?? "";
  const campaignId = url.searchParams.get("c");
  const sig = url.searchParams.get("sig") ?? "";
  const expected = await hmacHex(env.UNSUBSCRIBE_SECRET, `announcements:${userId}:${accountId}`);
  if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(accountId) || !timingSafeEqual(sig, expected)) {
    return new Response("Invalid or expired unsubscribe link.", { status: 400, headers: { "Content-Type": "text/plain" } });
  }
  const response = await supabaseRequest(env, "notification_preferences?on_conflict=user_id,notif_type", {
    method: "POST",
    headers: { ...serviceHeaders(env, true), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, account_id: accountId, notif_type: "announcements", email_enabled: false }),
  });
  if (!response.ok) {
    return new Response("Something went wrong. Please try again later.", { status: 500, headers: { "Content-Type": "text/plain" } });
  }
  await logUnsubscribe(env, "campaign", userId, null, campaignId && UUID_PATTERN.test(campaignId) ? campaignId : null);
  return new Response("You've been unsubscribed from ProfilePush announcement emails.", { status: 200, headers: { "Content-Type": "text/plain" } });
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

  // Sends that person's morning brief now, whatever the day.
  const { recipients, market } = await fetchMorningBrief(env);
  const recipient = recipients.find((r) => r.email.toLowerCase() === to);
  if (!recipient) return jsonResponse({ error: "That address isn't on the morning brief list" }, 404);
  const job = renderMorningBrief(recipient, market, await buildUnsubscribeUrl(env, recipient.user_id, recipient.account_id), env.APP_BASE_URL);
  await sendTracked(env, job);
  return jsonResponse({ sent: true, to: job.to, subject: job.subject });
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    try {
      if (request.method === "GET" && pathname === "/gmass-webhook") return await handleGmassWebhook(request, env);
      if (request.method === "GET") {
        const open = pathname.match(/^\/o\/([0-9a-f-]{36})\.gif$/i);
        if (open && SEND_ID_PATTERN.test(open[1])) return handleOpen(env, ctx, open[1]);
        const click = pathname.match(/^\/c\/([0-9a-f-]{36})$/i);
        if (click && SEND_ID_PATTERN.test(click[1])) return await handleClick(request, env, ctx, click[1]);
      }
      // GET is the link in the email footer; POST is the mail app's one-click
      // unsubscribe (RFC 8058), which sends the same signed URL.
      const unsubscribe = request.method === "GET" || request.method === "POST";
      if (unsubscribe && pathname === "/unsubscribe") return await handleUnsubscribe(request, env);
      if (unsubscribe && pathname === "/unsubscribe-publisher") return await handleUnsubscribePublisher(request, env);
      if (unsubscribe && pathname === "/unsubscribe-low-credits") return await handleUnsubscribeLowCredits(request, env);
      if (unsubscribe && pathname === "/unsubscribe-announcements") return await handleUnsubscribeAnnouncements(request, env);
      if (unsubscribe && pathname === "/unsubscribe-weekly") return await handleUnsubscribeWeekly(request, env);
      if (request.method === "GET" && pathname === "/remove-profile") return await handleRemoveProfile(request, env);
      if (request.method === "GET") return jsonResponse({ status: "ok" });
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
      if (pathname === "/send") return await handleSendRequest(request, env);
      if (pathname === "/run-digest") return await handleRunDigest(request, env);
      if (pathname === "/run-weekly-results") {
        if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
        return jsonResponse(await runWeeklyResults(env, true));
      }
      if (pathname === "/run-subscriber-digests") {
        if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
        return jsonResponse(await runSubscriberDigests(env));
      }
      if (pathname === "/run-morning-brief") {
        if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
        return jsonResponse(await runMorningBrief(env));
      }
      if (pathname === "/test-digest") return await handleTestDigest(request, env);
      if (pathname === "/publisher-subscribed") return await handlePublisherSubscribed(request, env);
      if (pathname === "/run-low-credit-emails") return await handleRunLowCreditEmails(request, env);
      if (pathname === "/ses-events") return await handleSesEvents(request, env);
      if (pathname === "/gmass-webhook") return await handleGmassWebhook(request, env);
      if (pathname === "/broadcast") return await handleBroadcast(request, env);
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
        if ((message.body.lane ?? "user") === "outreach") {
          const blocked = await outreachBlockReason(env, message.body.to);
          if (blocked) {
            message.ack();
            await logSend(env, message.body, "rejected", null, new Error(blocked));
            continue;
          }
        }
        await sendTracked(env, message.body);
        message.ack();
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
        console.log(`Daily digest (in-app and push): ${result.recipients} recipients (${result.jobsCount} jobs, ${result.hotlistCount} hotlist profiles)`);
      }),
      runMorningBrief(env).then((result) => {
        console.log(`Morning brief: emailed ${result.emailed}, skipped ${result.skipped}${result.reason ? ` (${result.reason})` : ""}`);
      }),
      runSubscriberDigests(env).then((result) => {
        console.log(`Subscriber emails to unclaimed publishers: ${result.emailed}`);
      }),
      runWeeklyResults(env).then((result) => {
        console.log(`Weekly results: emailed ${result.emailed}${result.reason ? ` (${result.reason})` : ""}`);
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
