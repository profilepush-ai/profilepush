export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  TRIGGER_WEBHOOK_TOKEN: string;
  WORKER_AUTH_TOKEN: string;
  UNSUBSCRIBE_SECRET: string;
  APP_BASE_URL: string;
  WORKER_BASE_URL: string;
  EMAIL_WORKER_URL: string;
  EMAIL_WORKER_AUTH_TOKEN: string;
  BACKFILL_BATCH_SIZE: string;
  EMAIL_WORKER?: Fetcher;
}

// Cloudflare rejects/rate-limits a Worker calling another Worker's
// *.workers.dev route directly over the public network (error 1042; this
// codebase hit and fixed the identical issue in vendor-mail-worker). Prefer
// the service binding, which routes internally; fall back to the raw URL
// only if the binding isn't configured (e.g. local dev).
function fetchEmailWorkerSend(env: Env, init: RequestInit): Promise<Response> {
  if (env.EMAIL_WORKER) {
    return env.EMAIL_WORKER.fetch("https://email-worker.internal/send", init);
  }
  return fetch(`${env.EMAIL_WORKER_URL}/send`, init);
}

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

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function buildUnsubscribeUrl(env: Env, email: string): Promise<string> {
  const sig = await hmacHex(env.UNSUBSCRIBE_SECRET, email);
  const url = new URL("/unsubscribe", env.WORKER_BASE_URL);
  url.searchParams.set("email", email);
  url.searchParams.set("sig", sig);
  return url.toString();
}

// Brand palette (from public/favicon.svg / src/components/Logo.tsx):
// yellow #facc15, orange #f97316, blue #2563eb, ink #0f172a.
function renderOutreachEmail(
  jobsCount: number,
  hotlistCount: number,
  topRoles: TopRole[],
  unsubscribeUrl: string,
  appBaseUrl: string,
) {
  const base = appBaseUrl.replace(/\/$/, "");
  const jobsUrl = `${base}/jobs`;
  const hotlistUrl = `${base}/hotlist`;
  const signupUrl = `${base}/signup`;
  const logoUrl = `${base}/favicon.svg`;

  const topRoleNames = topRoles.slice(0, 3).map((r) => r.target_role);
  const subject = `🔥 ${jobsCount} New Jobs & ${hotlistCount} Hotlist Consultants — Live on ProfilePush`;
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

  const text = `ProfilePush — The IT Staffing Market, Live

We track thousands of IT staffing job posts and bench sales updates daily. Here's what's happening right now:

${jobsCount} new job${jobsCount === 1 ? "" : "s"} added in the last 24 hours: ${jobsUrl}
${hotlistCount} new hotlist profile${hotlistCount === 1 ? "" : "s"} added in the last 24 hours: ${hotlistUrl}

Top in-demand roles:
${roleLinesText}

Sign Up Free: ${signupUrl}

---
You're receiving this because we found your contact info on a public job or bench sales post. Don't want these? Unsubscribe: ${unsubscribeUrl}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ProfilePush — The IT Staffing Market, Live</title>
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
              <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.3;">The IT Staffing Market, Live</h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 28px;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">We track thousands of IT staffing job posts and bench sales updates daily — free to browse.</p>
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
              <a href="${signupUrl}" style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; border-radius: 6px;">Sign Up Free</a>
            </td>
          </tr>

          <tr>
            <td style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                You're receiving this because we found your contact info on a public job or bench sales post.<br>
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

async function emailHasAccount(env: Env, email: string): Promise<boolean> {
  const response = await supabaseRequest(env, "rpc/email_has_account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ check_email: email }),
  });
  if (!response.ok) {
    throw new Error(`email_has_account failed: HTTP ${response.status}`);
  }
  return await response.json<boolean>();
}

async function claimEmailSend(env: Env, email: string): Promise<boolean> {
  const response = await supabaseRequest(env, "rpc/claim_market_stats_email_send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_email: email }),
  });
  if (!response.ok) {
    throw new Error(`claim_market_stats_email_send failed: HTTP ${response.status}`);
  }
  const rows = await response.json<{ claimed: boolean }[]>();
  return rows[0]?.claimed === true;
}

type OutreachResult = { sent: boolean; email: string; source?: string; reason?: string };

// Shared by both the real-time webhook and the backfill cron — the claim
// happens before the send attempt, which is what makes the atomic dedup
// guarantee meaningful. If the send call fails after a successful claim,
// that address's daily slot is burned with no retry until a future new row
// arrives for them; acceptable for best-effort marketing mail.
async function processOutreachCandidate(env: Env, rawEmail: string, source: string): Promise<OutreachResult> {
  const email = (rawEmail ?? "").trim().toLowerCase();
  // Some scraped poster_email/bench_sales_recruiter_email values contain
  // multiple comma-joined addresses (e.g. "a@x.com,b@x.com") — reject those
  // here rather than let the looser \S+ shape slip one through as a single
  // garbled "recipient". The claim RPC uses the same stricter shape as a
  // second line of defense.
  if (!/^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(email)) return { sent: false, email, source, reason: "invalid_email" };

  if (await emailHasAccount(env, email)) return { sent: false, email, source, reason: "has_account" };

  const claimed = await claimEmailSend(env, email);
  if (!claimed) return { sent: false, email, source, reason: "already_sent_or_unsubscribed" };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [jobsCount, hotlistCount, topRoles] = await Promise.all([
    countSince(env, "radar_match_results", since),
    countSince(env, "radar_match_hotlist", since),
    fetchTopRoles(env),
  ]);

  const unsubscribeUrl = await buildUnsubscribeUrl(env, email);
  const { subject, text, html } = renderOutreachEmail(jobsCount, hotlistCount, topRoles, unsubscribeUrl, env.APP_BASE_URL);

  const sendResponse = await fetchEmailWorkerSend(env, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.EMAIL_WORKER_AUTH_TOKEN}` },
    body: JSON.stringify({ to: email, subject, html, text }),
  });

  if (!sendResponse.ok) {
    console.error("market-stats-outreach: /send failed", sendResponse.status, await sendResponse.text().catch(() => ""));
    return { sent: false, email, source, reason: "send_failed" };
  }

  return { sent: true, email, source };
}

type BackfillCandidate = { email: string; source: string };

async function fetchBackfillBatch(env: Env, limit: number): Promise<BackfillCandidate[]> {
  const response = await supabaseRequest(env, "rpc/get_market_stats_outreach_backfill_batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_limit: limit }),
  });
  if (!response.ok) {
    throw new Error(`get_market_stats_outreach_backfill_batch failed: HTTP ${response.status}`);
  }
  return await response.json<BackfillCandidate[]>();
}

async function runBackfillBatch(
  env: Env,
  limit: number,
  dryRun: boolean,
): Promise<{ candidates: BackfillCandidate[]; results: OutreachResult[] }> {
  const candidates = await fetchBackfillBatch(env, limit);
  if (dryRun) return { candidates, results: [] };

  const results: OutreachResult[] = [];
  for (const candidate of candidates) {
    results.push(await processOutreachCandidate(env, candidate.email, candidate.source));
  }
  return { candidates, results };
}

async function handleWebhookOutreach(request: Request, env: Env): Promise<Response> {
  if (getBearerToken(request) !== env.TRIGGER_WEBHOOK_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
  const body = await request.json<{ source?: unknown; poster_email?: unknown }>();
  const source = typeof body.source === "string" ? body.source : "unknown";
  const posterEmail = typeof body.poster_email === "string" ? body.poster_email : "";
  const result = await processOutreachCandidate(env, posterEmail, source);
  return jsonResponse(result);
}

async function handleRunBackfillBatch(request: Request, env: Env): Promise<Response> {
  if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
  const body = await request.json<{ limit?: unknown; dry_run?: unknown }>().catch(() => ({} as { limit?: unknown; dry_run?: unknown }));
  const limit = typeof body.limit === "number" ? body.limit : Number(env.BACKFILL_BATCH_SIZE || "25");
  const dryRun = body.dry_run === true;
  const { candidates, results } = await runBackfillBatch(env, limit, dryRun);
  const sent = results.filter((r) => r.sent).length;
  return jsonResponse({ candidates, sent, skipped: results.length - sent, dryRun });
}

async function handleTestOutreach(request: Request, env: Env): Promise<Response> {
  if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
  const body = await request.json<{ to?: unknown; source?: unknown }>();
  const to = typeof body.to === "string" ? body.to.trim() : "";
  const source = typeof body.source === "string" ? body.source : "job";
  if (!to) return jsonResponse({ error: "to is required" }, 400);
  const result = await processOutreachCandidate(env, to, source);
  return jsonResponse(result);
}

async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const sig = url.searchParams.get("sig") ?? "";
  const expectedSig = await hmacHex(env.UNSUBSCRIBE_SECRET, email);
  if (!/^\S+@\S+\.\S+$/.test(email) || !timingSafeEqual(sig, expectedSig)) {
    return new Response("Invalid or expired unsubscribe link.", { status: 400, headers: { "Content-Type": "text/plain" } });
  }

  const response = await supabaseRequest(env, "market_stats_email_sends?on_conflict=email", {
    method: "POST",
    headers: { ...serviceHeaders(env, true), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      email,
      unsubscribed: true,
      unsubscribed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    return new Response("Something went wrong. Please try again later.", { status: 500, headers: { "Content-Type": "text/plain" } });
  }

  return new Response(
    "You've been unsubscribed from ProfilePush market update emails.",
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
      if (pathname === "/webhook/outreach") return await handleWebhookOutreach(request, env);
      if (pathname === "/run-backfill-batch") return await handleRunBackfillBatch(request, env);
      if (pathname === "/test-outreach") return await handleTestOutreach(request, env);
      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error("market-stats-outreach request failed", error);
      return jsonResponse({ error: (error as Error).message }, 500);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      const limit = Number(env.BACKFILL_BATCH_SIZE || "25");
      const { candidates, results } = await runBackfillBatch(env, limit, false);
      if (candidates.length === 0) {
        console.log("market-stats-outreach: backfill drained, nothing to send");
        return;
      }
      const sent = results.filter((r) => r.sent).length;
      console.log(`market-stats-outreach: backfill batch processed ${candidates.length} candidates, ${sent} sent`);
    } catch (error) {
      console.error("market-stats-outreach: backfill cron run failed", error);
      throw error;
    }
  },
};
