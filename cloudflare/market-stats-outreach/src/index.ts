export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  TRIGGER_WEBHOOK_TOKEN: string;
  WORKER_AUTH_TOKEN: string;
  UNSUBSCRIBE_SECRET: string;
  APP_BASE_URL: string;
  WORKER_BASE_URL: string;
  BACKFILL_BATCH_SIZE: string;
  OUTREACH_PAUSED: string;
  PARSER_MODEL: string;
  AI: Ai;
  LEAD_QUEUE: Queue<LeadMessage>;
  EMAIL_WORKER_URL: string;
  EMAIL_WORKER_AUTH_TOKEN: string;
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

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type Source = "job" | "hotlist";

interface LeadMessage {
  message_id: string;
  enqueued_at: string;
  source: Source;
  email: string;
  job_id?: string;
  hotlist_id?: string;
  radar_match_id?: string;
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

async function buildUnsubscribeUrl(env: Env, email: string): Promise<string> {
  const sig = await hmacHex(env.UNSUBSCRIBE_SECRET, email);
  const url = new URL("/unsubscribe", env.WORKER_BASE_URL);
  url.searchParams.set("email", email);
  url.searchParams.set("sig", sig);
  return url.toString();
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

// Some scraped poster_email/bench_sales_recruiter_email values contain
// multiple comma-joined addresses (e.g. "a@x.com,b@x.com") — this shape is
// intentionally looser than a full RFC validator, matching the shape the
// claim RPCs themselves enforce as a second line of defense.
function isValidEmailShape(email: string): boolean {
  return /^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(email);
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

// Uses the original GMass-mailbox-warmup-ramp-aware claim function (not the
// flat-cap sibling written for the abandoned Instantly/Smartlead attempt) —
// this stream is back on the same shared GMass mailbox as the digest, so the
// warmup ramp's protection is exactly what's needed here again.
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

interface LeadContext {
  roleTitle: string;
  skills: string[];
  location: string;
}

async function fetchJobContext(env: Env, jobId: string): Promise<LeadContext | null> {
  const response = await supabaseRequest(
    env,
    `social_jobs?id=eq.${encodeURIComponent(jobId)}&select=job_title,extracted_role_normalized,extracted_skills,location&limit=1`,
  );
  if (!response.ok) throw new Error(`fetch social_jobs failed: HTTP ${response.status}`);
  const rows = await response.json<{ job_title?: string; extracted_role_normalized?: string; extracted_skills?: unknown; location?: string }[]>();
  const row = rows[0];
  if (!row) return null;
  const skills = Array.isArray(row.extracted_skills) ? row.extracted_skills.map((s) => String(s)) : [];
  return {
    roleTitle: (row.extracted_role_normalized || row.job_title || "").trim(),
    skills,
    location: (row.location || "").trim(),
  };
}

async function fetchHotlistContext(env: Env, hotlistId: string): Promise<LeadContext | null> {
  const response = await supabaseRequest(
    env,
    `social_hotlist?id=eq.${encodeURIComponent(hotlistId)}&select=role_title,core_skills,locations&limit=1`,
  );
  if (!response.ok) throw new Error(`fetch social_hotlist failed: HTTP ${response.status}`);
  const rows = await response.json<{ role_title?: string; core_skills?: string[]; locations?: string[] }[]>();
  const row = rows[0];
  if (!row) return null;
  return {
    roleTitle: (row.role_title || "").trim(),
    skills: Array.isArray(row.core_skills) ? row.core_skills : [],
    location: Array.isArray(row.locations) && row.locations.length > 0 ? row.locations[0] : "",
  };
}

async function countMatchingHotlistProfilesForJob(env: Env, jobId: string): Promise<number> {
  const response = await supabaseRequest(env, "rpc/count_matching_hotlist_profiles_for_job", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_job_id: jobId }),
  });
  if (!response.ok) throw new Error(`count_matching_hotlist_profiles_for_job failed: HTTP ${response.status}`);
  return await response.json<number>();
}

async function countMatchingJobsForHotlist(env: Env, hotlistId: string): Promise<number> {
  const response = await supabaseRequest(env, "rpc/count_matching_jobs_for_hotlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_hotlist_id: hotlistId }),
  });
  if (!response.ok) throw new Error(`count_matching_jobs_for_hotlist failed: HTTP ${response.status}`);
  return await response.json<number>();
}

// What was sent, for logs and dry runs.
interface PitchAngle {
  subject: string;
  hook: string;
}

// The poster's public profile, if they have one we can still email.
type OutreachProfile = { id: string; slug: string; display_name: string };

function publisherEmailKey(email: string): string {
  return email.split(",")[0].trim().toLowerCase();
}

async function fetchOutreachProfile(env: Env, email: string): Promise<OutreachProfile | null> {
  const response = await supabaseRequest(
    env,
    `publisher_profiles?email=eq.${encodeURIComponent(publisherEmailKey(email))}&select=id,slug,display_name,claimed_account_id,removed_at,email_opted_out&limit=1`,
  );
  if (!response.ok) throw new Error(`fetch publisher_profiles failed: HTTP ${response.status}`);
  const row = (await response.json<Array<OutreachProfile & { claimed_account_id: string | null; removed_at: string | null; email_opted_out: boolean }>>())[0];
  if (!row || row.claimed_account_id || row.removed_at || row.email_opted_out) return null;
  return { id: row.id, slug: row.slug, display_name: row.display_name };
}

// The claim link carries the post this email is about, so claiming opens
// AI Match on it.
async function createClaimUrl(env: Env, publisherId: string, lead?: { kind: "job" | "hotlist"; id: string }): Promise<string | null> {
  const response = await supabaseRequest(env, "rpc/create_profile_claim_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_publisher_id: publisherId, p_lead_kind: lead?.kind ?? null, p_lead_id: lead?.id ?? null }),
  });
  if (!response.ok) return null;
  const token = await response.json<string | null>();
  return token ? `${env.SUPABASE_URL}/functions/v1/claim-profile?t=${token}` : null;
}

async function buildRemoveProfileUrl(env: Env, email: string): Promise<string> {
  const sig = await hmacHex(env.UNSUBSCRIBE_SECRET, `remove-profile:${email}`);
  const url = new URL("/remove-profile", env.WORKER_BASE_URL);
  url.searchParams.set("e", email);
  url.searchParams.set("sig", sig);
  return url.toString();
}

// A short, personal email about the reader's own post: how many matches it
// has on ProfilePush right now, and a one-tap claim of their profile to see
// them. Plain layout, one button. Never says where their posts came from.
function renderOutreachEmail(
  input: { source: Source; context: LeadContext; matchingCount: number; profile: OutreachProfile },
  urls: { claim: string; profile: string; remove: string; unsubscribe: string },
) {
  const first = (input.profile.display_name || "").trim().split(/\s+/)[0] || "";
  const role = input.context.roleTitle || (input.source === "job" ? "recent" : "bench");
  const n = input.matchingCount;
  const isJob = input.source === "job";
  const subject = isJob
    ? `${n} bench ${n === 1 ? "consultant matches" : "consultants match"} your ${role} requirement`
    : `${n} open ${n === 1 ? "requirement matches" : "requirements match"} your ${role} consultant`;
  const line1 = isJob
    ? `Your ${role} requirement${input.context.location ? ` (${input.context.location})` : ""} matches ${n} bench ${n === 1 ? "consultant" : "consultants"} on ProfilePush right now.`
    : `Your ${role} consultant matches ${n} open ${n === 1 ? "requirement" : "requirements"} on ProfilePush right now.`;
  const line2 = `Your ProfilePush profile already shows your recent posts. Claim it (free, one tap, no password) to see ${n === 1 ? "this match" : "these matches"} and reach ${isJob ? "their recruiters" : "the vendors"} in one click.`;
  const cta = n === 1 ? "See the match" : `See the ${n} matches`;

  const text = `${first ? `Hi ${first},` : "Hi,"}

${line1}

${line2}

${cta}: ${urls.claim}

---
ProfilePush, the AI copilot for vendors and bench sales recruiters.
Not you, or don't want a profile? Remove my profile: ${urls.remove}
Unsubscribe: ${urls.unsubscribe}`;

  const p = (t: string) => `<p style="margin: 0 0 14px; font-size: 15px; line-height: 1.55; color: #1e293b;">${t}</p>`;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(subject)}</title></head>
<body style="margin: 0; padding: 24px 20px; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 520px;">
    ${p(escapeHtml(first ? `Hi ${first},` : "Hi,"))}
    ${p(escapeHtml(line1))}
    ${p(escapeHtml(line2))}
    <p style="margin: 0 0 20px;"><a href="${urls.claim}" style="display: inline-block; padding: 11px 22px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; border-radius: 6px;">${escapeHtml(cta)}</a></p>
    <p style="margin: 24px 0 0; font-size: 12px; color: #94a3b8; line-height: 1.6;">
      ProfilePush, the AI copilot for vendors and bench sales recruiters.<br>
      Not you, or don't want a profile? <a href="${urls.remove}" style="color: #94a3b8;">Remove my profile</a> · <a href="${urls.unsubscribe}" style="color: #94a3b8;">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

async function sendLeadToGmass(
  env: Env,
  params: { email: string; subject: string; text: string; html: string },
): Promise<void> {
  const { subject, text, html } = params;

  const response = await fetchEmailWorkerSend(env, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.EMAIL_WORKER_AUTH_TOKEN}` },
    // Outreach lane: these people aren't users, so this must never go through SES.
    body: JSON.stringify({ to: params.email, subject, html, text, lane: "outreach", category: "outreach_pitch" }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GMass /send failed: HTTP ${response.status} ${body.slice(0, 300)}`);
  }
}

type ProcessResult =
  | { status: "sent"; email: string; source: Source; matchingCount: number; pitch: PitchAngle }
  | { status: "skipped"; email: string; source: Source; reason: string };

// Shared by the queue consumer and the dry-run test route. The claim happens
// before drafting/sending, which is what makes the atomic dedup guarantee
// meaningful — if the GMass send fails after a successful claim, that
// address's daily slot is burned with no retry until a future new row
// arrives for them; acceptable for best-effort marketing mail.
async function processLead(
  env: Env,
  input: { email: string; source: Source; jobId?: string; hotlistId?: string },
  options: { dryRun: boolean },
): Promise<ProcessResult & { dryRunPayload?: unknown }> {
  const email = input.email.trim().toLowerCase();
  const source = input.source;

  if (!isValidEmailShape(email)) return { status: "skipped", email, source, reason: "invalid_email" };
  if (await emailHasAccount(env, email)) return { status: "skipped", email, source, reason: "has_account" };
  // Every email links to the poster's profile, so no profile, no email.
  const profile = await fetchOutreachProfile(env, email);
  if (!profile) return { status: "skipped", email, source, reason: "no_profile_or_opted_out" };

  if (!options.dryRun) {
    // Checked before the claim so a paused run never burns a claim slot —
    // those slots should still be available once outreach resumes.
    if (env.OUTREACH_PAUSED === "true") return { status: "skipped", email, source, reason: "outreach_paused" };
    const claimed = await claimEmailSend(env, email);
    if (!claimed) return { status: "skipped", email, source, reason: "already_sent_or_unsubscribed_or_capped" };
  }

  const context = source === "job"
    ? input.jobId ? await fetchJobContext(env, input.jobId) : null
    : input.hotlistId ? await fetchHotlistContext(env, input.hotlistId) : null;
  if (!context) return { status: "skipped", email, source, reason: "post_not_found" };

  const matchingCount = source === "job"
    ? await countMatchingHotlistProfilesForJob(env, input.jobId as string)
    : await countMatchingJobsForHotlist(env, input.hotlistId as string);

  // A "we found 0 matches for you" pitch has negative value — skip rather
  // than send a claim that undercuts the product's credibility.
  if (matchingCount <= 0) return { status: "skipped", email, source, reason: "no_matches" };

  const base = env.APP_BASE_URL.replace(/\/$/, "");
  const profileUrl = `${base}/profile/${encodeURIComponent(profile.slug)}`;
  const urls = {
    claim: options.dryRun
      ? `${base}/claim-preview`
      : (await createClaimUrl(env, profile.id, source === "job"
        ? (input.jobId ? { kind: "job", id: input.jobId } : undefined)
        : (input.hotlistId ? { kind: "hotlist", id: input.hotlistId } : undefined))) ?? profileUrl,
    profile: profileUrl,
    remove: await buildRemoveProfileUrl(env, email),
    unsubscribe: await buildUnsubscribeUrl(env, email),
  };
  const rendered = renderOutreachEmail({ source, context, matchingCount, profile }, urls);
  const pitch = { subject: rendered.subject, hook: rendered.text.split("\n")[2] ?? "" } as PitchAngle;

  if (options.dryRun) {
    return { status: "sent", email, source, matchingCount, pitch, dryRunPayload: { to: email, ...rendered } };
  }

  await sendLeadToGmass(env, { email, ...rendered });
  return { status: "sent", email, source, matchingCount, pitch };
}

async function processLeadMessage(env: Env, msg: LeadMessage): Promise<void> {
  const result = await processLead(
    env,
    { email: msg.email, source: msg.source, jobId: msg.job_id, hotlistId: msg.hotlist_id },
    { dryRun: false },
  );
  if (result.status === "skipped") {
    console.log(`market-stats-outreach: lead skipped (${result.reason})`, result.email);
  }
}

function isValidLeadMessage(body: unknown): body is LeadMessage {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (typeof b.email !== "string" || (b.source !== "job" && b.source !== "hotlist")) return false;
  if (b.source === "job" && typeof b.job_id !== "string") return false;
  if (b.source === "hotlist" && typeof b.hotlist_id !== "string") return false;
  return true;
}

async function handleWebhookOutreach(request: Request, env: Env): Promise<Response> {
  if (getBearerToken(request) !== env.TRIGGER_WEBHOOK_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
  const body = await request.json<{ source?: unknown; poster_email?: unknown; job_id?: unknown; hotlist_id?: unknown; radar_match_id?: unknown }>();
  const source: Source = body.source === "hotlist" ? "hotlist" : "job";
  const email = (typeof body.poster_email === "string" ? body.poster_email : "").trim().toLowerCase();
  const jobId = typeof body.job_id === "string" ? body.job_id : undefined;
  const hotlistId = typeof body.hotlist_id === "string" ? body.hotlist_id : undefined;

  if (!isValidEmailShape(email)) return jsonResponse({ enqueued: false, email, source, reason: "invalid_email" });
  if (source === "job" && !jobId) return jsonResponse({ enqueued: false, email, source, reason: "missing_job_id" });
  if (source === "hotlist" && !hotlistId) return jsonResponse({ enqueued: false, email, source, reason: "missing_hotlist_id" });
  if (await emailHasAccount(env, email)) return jsonResponse({ enqueued: false, email, source, reason: "has_account" });

  const message: LeadMessage = {
    message_id: crypto.randomUUID(),
    enqueued_at: new Date().toISOString(),
    source,
    email,
    job_id: jobId,
    hotlist_id: hotlistId,
    radar_match_id: typeof body.radar_match_id === "string" ? body.radar_match_id : undefined,
  };
  await env.LEAD_QUEUE.send(message);
  return jsonResponse({ enqueued: true, email, source });
}

interface BackfillCandidate {
  email: string;
  source: Source;
  job_id: string | null;
  hotlist_id: string | null;
}

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

async function enqueueBackfillCandidates(env: Env, candidates: BackfillCandidate[]): Promise<number> {
  let enqueued = 0;
  for (const chunk of chunkArray(candidates, 100)) {
    // Cloudflare Queue sendBatch currently supports up to 100 messages per request.
    await env.LEAD_QUEUE.sendBatch(
      chunk
        .filter((c) => (c.source === "job" ? !!c.job_id : !!c.hotlist_id))
        .map((c) => ({
          body: {
            message_id: crypto.randomUUID(),
            enqueued_at: new Date().toISOString(),
            source: c.source,
            email: c.email,
            job_id: c.job_id ?? undefined,
            hotlist_id: c.hotlist_id ?? undefined,
          } satisfies LeadMessage,
        })),
    );
    enqueued += chunk.length;
  }
  return enqueued;
}

async function runBackfillBatch(
  env: Env,
  limit: number,
  dryRun: boolean,
): Promise<{ candidates: BackfillCandidate[]; enqueued: number }> {
  const candidates = await fetchBackfillBatch(env, limit);
  if (dryRun) return { candidates, enqueued: 0 };
  const enqueued = await enqueueBackfillCandidates(env, candidates);
  return { candidates, enqueued };
}

async function handleRunBackfillBatch(request: Request, env: Env): Promise<Response> {
  if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
  const body = await request.json<{ limit?: unknown; dry_run?: unknown }>().catch(() => ({} as { limit?: unknown; dry_run?: unknown }));
  const limit = typeof body.limit === "number" ? body.limit : Number(env.BACKFILL_BATCH_SIZE || "25");
  const dryRun = body.dry_run === true;
  const { candidates, enqueued } = await runBackfillBatch(env, limit, dryRun);
  return jsonResponse({ candidates, enqueued, dryRun });
}

async function handleTestOutreach(request: Request, env: Env): Promise<Response> {
  if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
  const body = await request.json<{ to?: unknown; source?: unknown; job_id?: unknown; hotlist_id?: unknown; dry_run?: unknown }>();
  const to = typeof body.to === "string" ? body.to.trim() : "";
  const source: Source = body.source === "hotlist" ? "hotlist" : "job";
  const jobId = typeof body.job_id === "string" ? body.job_id : undefined;
  const hotlistId = typeof body.hotlist_id === "string" ? body.hotlist_id : undefined;
  const dryRun = body.dry_run !== false; // dry-run by default; only a real send when explicitly false
  if (!to) return jsonResponse({ error: "to is required" }, 400);
  if (source === "job" && !jobId) return jsonResponse({ error: "job_id is required for source=job" }, 400);
  if (source === "hotlist" && !hotlistId) return jsonResponse({ error: "hotlist_id is required for source=hotlist" }, 400);

  const result = await processLead(env, { email: to, source, jobId, hotlistId }, { dryRun });
  return jsonResponse(result);
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
  return new Response("Your ProfilePush profile has been removed, and we won't email you about it again.", { status: 200, headers: { "Content-Type": "text/plain" } });
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
      if (request.method === "GET" && pathname === "/remove-profile") return await handleRemoveProfile(request, env);
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

  async queue(batch: MessageBatch<LeadMessage>, env: Env): Promise<void> {
    const paused = env.OUTREACH_PAUSED === "true";
    for (const message of batch.messages) {
      // Held without calling GMass at all while paused, rather than retrying
      // into a mailbox that's already over its daily sending limit — see the
      // OUTREACH_PAUSED comment in wrangler.toml for why this is on.
      if (paused) {
        message.retry({ delaySeconds: 3600 });
        continue;
      }
      try {
        if (!isValidLeadMessage(message.body)) throw new Error("Lead message failed schema validation");
        await processLeadMessage(env, message.body);
        message.ack();
      } catch (error) {
        console.error("market-stats-outreach: lead queue job failed", error);
        message.retry();
      }
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      const limit = Number(env.BACKFILL_BATCH_SIZE || "25");
      const { candidates, enqueued } = await runBackfillBatch(env, limit, false);
      if (candidates.length === 0) {
        console.log("market-stats-outreach: backfill drained, nothing to enqueue");
        return;
      }
      console.log(`market-stats-outreach: backfill batch enqueued ${enqueued}/${candidates.length} candidates`);
    } catch (error) {
      console.error("market-stats-outreach: backfill cron run failed", error);
      throw error;
    }
  },
};
