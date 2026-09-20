import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getPromptOverride } from "../_shared/prompts.ts";

// AI Match: paste a description, get the last 30 days' posts ranked 1-10.
//
//   bench sales  paste a consultant's hotlist  -> ranked jobs     (target: "jobs")
//   vendors      paste a job description       -> ranked hotlist  (target: "hotlist")
//
// Two stages. Retrieval embeds the description and pulls the nearest posts by
// cosine similarity (ai_match_jobs / ai_match_hotlist, which return the same
// row shape the feed cards render). Ranking then has Cloudflare Workers AI
// (via the profilepush-social-job-parser worker) score each of those
// candidates 1-10 with a one-line reason; similarity alone is a poor
// judge of things like visa or experience fit, which is what recruiters care
// about most.
//
// Costs 1 credit per match returned (RESULT_LIMIT of them). The full amount is
// taken up front, so a run that cannot be paid for is refused rather than
// half-delivered, and whatever isn't returned — a thin window, a failed run —
// is refunded. The caller only pays for matches actually delivered.
//
// Every run also publishes what was pasted as a post of the user's own: a
// bench-sales consultant becomes a hotlist post, a vendor's job becomes a job
// post. It uses the same extraction and create RPCs as the Post form, so the
// result is indistinguishable from a manual post, and it never blocks or fails
// the match itself.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FEATURE_KEY = "ai_match_run";
const WINDOW_DAYS = 30;
// Scored pool vs. what is returned. The model still judges 60 candidates so
// the top of the list is genuinely the best of the window; only the top
// RESULT_LIMIT are returned, and each returned match costs a credit.
const CANDIDATE_LIMIT = 60;
const RESULT_LIMIT = 10;
const CREDITS_PER_RESULT = 1;
const MIN_DESCRIPTION_CHARS = 40;
const MAX_DESCRIPTION_CHARS = 8000;
// Hotlists aren't embedded on insert (they arrive through several different
// write paths), so each vendor run first embeds whatever in the window is
// still missing one. At ~24 new hotlists a day that is normally one small
// batch; the cap stops an unexpected backlog from stalling a user's request.
const CATCH_UP_LIMIT = 200;
const BACKLOG_BATCH_LIMIT = 500;
const EMBEDDING_DIMENSIONS = 768;
// Scoring runs on Cloudflare Workers AI through the social-job-parser worker's
// /ai-match-score route, like the app's other worker-backed AI features. The
// first entry is the worker's own MATCH_MODEL default; if it fails a chunk,
// that chunk is retried on the next, so a run stays on Workers AI throughout.
const WORKER_SCORING_MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/qwen/qwen3-30b-a3b-fp8"];
const SCORING_CHUNK_SIZE = 10;
// Every outbound call is time-boxed. Without this a single hung request held
// the function until the platform's 150s idle timeout killed it — and a killed
// function never reaches its refund, so the user lost the credit. The scoring
// budget leaves ample room under 150s for retrieval and the refund path.
const EMBEDDING_TIMEOUT_MS = 15_000;
const SCORING_BUDGET_MS = 60_000;
const SCORING_CALL_TIMEOUT_MS = 25_000;

type Target = "jobs" | "hotlist";
type Emit = (event: Record<string, unknown>) => void;
type FeedRow = Record<string, unknown> & { lead_id: string; similarity: number };

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function jsonError(message: string, status = 400, code?: string) {
  return json({ error: message, ...(code ? { code } : {}) }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const openAiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  // Must match generate-embedding exactly: the query is compared against
  // vectors it produced, and different models' spaces aren't comparable.
  const embeddingModel = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  // Maintenance: embed the hotlist backlog in bounded batches. Idempotent — it
  // only touches rows with no embedding, so once caught up a call is a single
  // count query — and it spends no credits, so it isn't gated on a user.
  if (body?.mode === "embed_backlog") {
    if (!openAiKey) return jsonError("OPENAI_API_KEY not configured", 500);
    try {
      const embedded = await embedMissingHotlists(supabaseAdmin, openAiKey, embeddingModel, BACKLOG_BATCH_LIMIT);
      const embeddedJobs = await embedMissingJobs(supabaseAdmin, openAiKey, embeddingModel, BACKLOG_BATCH_LIMIT);
      const remaining = await countMissingHotlists(supabaseAdmin);
      return json({ ok: true, embedded, embedded_jobs: embeddedJobs, remaining });
    } catch (error) {
      return jsonError((error as Error).message, 500);
    }
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonError("Unauthorized", 401);
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  let userId: string;
  try {
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return jsonError("Unauthorized", 401);
    userId = user.id;
  } catch {
    return jsonError("Unauthorized", 401);
  }

  const { data: membership } = await supabaseAdmin
    .from("account_members")
    .select("account_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) return jsonError("Account not found", 404);
  const accountId = membership.account_id as string;

  const target: Target | null = body?.target === "jobs" || body?.target === "hotlist" ? body.target : null;
  if (!target) return jsonError("target must be 'jobs' or 'hotlist'");
  const description = String(body?.description ?? "").trim().slice(0, MAX_DESCRIPTION_CHARS);
  if (description.length < MIN_DESCRIPTION_CHARS) {
    return jsonError(`Paste a fuller description — at least ${MIN_DESCRIPTION_CHARS} characters.`, 400, "description_too_short");
  }

  // Ids the caller already has from a previous run on this same text. They are
  // re-delivered (a rematch shows the old matches alongside the new ones) but
  // not re-charged: the first run paid for them.
  const seenIds = Array.isArray(body?.seen_ids)
    ? new Set((body.seen_ids as unknown[]).map((value) => String(value)).filter(Boolean).slice(0, 100))
    : new Set<string>();

  // OpenAI stays for embeddings only: the stored job vectors were made with
  // it, and a query embedded by any other model wouldn't be comparable.
  const workerUrl = (Deno.env.get("CLOUDFLARE_WORKER_URL") ?? "").trim().replace(/\/$/, "");
  const workerToken = (Deno.env.get("CLOUDFLARE_WORKER_TOKEN") ?? "").trim();
  if (!openAiKey || !workerUrl) return jsonError("AI Match is not configured", 500);

  const maxCharge = RESULT_LIMIT * CREDITS_PER_RESULT;
  const { data: chargeRows, error: chargeError } = await userClient.rpc("consume_feature_credit", {
    p_account_id: accountId,
    p_amount: maxCharge,
    p_feature: FEATURE_KEY,
    p_metadata: { target, description_chars: description.length, max_results: RESULT_LIMIT },
  });
  const charge = Array.isArray(chargeRows) ? chargeRows[0] as { success: boolean; message: string } : null;
  if (chargeError || !charge?.success) {
    return jsonError(charge?.message ?? chargeError?.message ?? "Insufficient credits", 402, "insufficient_credits");
  }

  // Anything charged for but not delivered goes back.
  const refund = (amount = maxCharge) => amount <= 0
    ? Promise.resolve()
    : supabaseAdmin
      .rpc("refund_feature_credit", { p_account_id: accountId, p_amount: amount, p_feature: FEATURE_KEY })
      .then(() => {}, () => {});

  // Publish the pasted description as the user's own post, concurrently with
  // the match so it adds no wait. Awaited before responding so the UI can say
  // it happened; its failure is reported, never thrown.
  const postPromise = logPostOutcome(autoPostDescription({
    supabaseAdmin,
    userClient,
    supabaseUrl,
    authHeader,
    accountId,
    // What was pasted, which is the opposite kind to what is being searched.
    kind: target === "jobs" ? "hotlist" : "job",
    description,
    openAiKey,
    embeddingModel,
  }).catch((error) => ({ status: "failed" as const, reason: (error as Error).message.slice(0, 200) })));

  // The work, reporting progress as it goes. A run takes ~13s, so the caller
  // gets real counts (candidates found, how many scored) rather than a spinner.
  const executeRun = async (emit: Emit) => {
    emit({ phase: "preparing" });
    if (target === "hotlist") {
      await embedMissingHotlists(supabaseAdmin, openAiKey, embeddingModel, CATCH_UP_LIMIT);
    } else {
      await embedMissingJobs(supabaseAdmin, openAiKey, embeddingModel, CATCH_UP_LIMIT);
    }

    emit({ phase: "searching" });
    const [queryEmbedding] = await embedTexts([description], openAiKey, embeddingModel);
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: candidateRows, error: matchError } = await supabaseAdmin.rpc(
      target === "jobs" ? "ai_match_jobs" : "ai_match_hotlist",
      { p_embedding: JSON.stringify(queryEmbedding), p_since: since, p_limit: CANDIDATE_LIMIT },
    );
    if (matchError) throw new Error(`Match search failed: ${matchError.message}`);

    const candidates = (candidateRows ?? []) as FeedRow[];
    emit({ phase: "found", found: candidates.length });
    if (candidates.length === 0) {
      await refund();
      return { ok: true, results: [], refunded: true, credits_charged: 0, post: await postPromise };
    }

    emit({ phase: "scoring", scored: 0, total: candidates.length });
    const { scores, usedModel, usage } = await scoreCandidates(
      supabaseAdmin, workerUrl, workerToken, target, description, candidates,
      (scored) => emit({ phase: "scoring", scored, total: candidates.length }),
    );
    logUsage(supabaseAdmin, userId, accountId, usedModel, usage);

    const results = candidates
      .map((row, index) => {
        const scored = scores.get(index);
        return scored ? { ...row, ai_score: scored.score, ai_reason: scored.reason } : null;
      })
      .filter((row): row is FeedRow & { ai_score: number; ai_reason: string } => row !== null)
      // Score first; similarity breaks ties so equal scores keep the order the
      // retrieval step thought was closest.
      .sort((a, b) => (b.ai_score - a.ai_score) || (b.similarity - a.similarity))
      .slice(0, RESULT_LIMIT);

    if (results.length === 0) {
      await refund();
      return { ok: true, results: [], refunded: true, credits_charged: 0, post: await postPromise };
    }

    // A thin window can yield fewer than RESULT_LIMIT, and a rematch re-returns
    // matches the caller already paid for; charge only for what is both
    // delivered and new to them. The hold is still RESULT_LIMIT because how
    // many are new isn't known until scoring ends — the rest goes back here.
    const freshResults = results.filter((row) => !seenIds.has(String(row.lead_id)));
    const creditsCharged = freshResults.length * CREDITS_PER_RESULT;
    await refund(maxCharge - creditsCharged);

    return {
      ok: true,
      results,
      window_days: WINDOW_DAYS,
      credits_charged: creditsCharged,
      new_count: freshResults.length,
      post: await postPromise,
    };
  };

  // Streamed as newline-delimited JSON: one object per progress event, the
  // last carrying the results. Plain JSON stays available for any caller that
  // doesn't ask to stream.
  if (body?.stream === true) {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        async start(controller) {
          const emit: Emit = (event) => {
            try {
              controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
            } catch {
              // Client hung up mid-run; the work still finishes and settles
              // the credits.
            }
          };
          try {
            emit({ phase: "done", ...(await executeRun(emit)) });
          } catch (error) {
            await refund();
            await postPromise;
            emit({ phase: "error", error: (error as Error).message });
          } finally {
            controller.close();
          }
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } },
    );
  }

  try {
    return json(await executeRun(() => {}));
  } catch (error) {
    await refund();
    // Let the post settle rather than abandoning it mid-write.
    await postPromise;
    return jsonError((error as Error).message, 502);
  }
});

// ---------------------------------------------------------------------------
// Embeddings

async function embedTexts(texts: string[], apiKey: string, model: string): Promise<number[][]> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: texts, dimensions: EMBEDDING_DIMENSIONS }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    });
    if (res.ok) {
      const payload = await res.json() as { data?: Array<{ index: number; embedding: number[] }> };
      const rows = [...(payload.data ?? [])].sort((a, b) => a.index - b.index);
      if (rows.length !== texts.length) throw new Error("Embedding response was incomplete");
      return rows.map((row) => row.embedding);
    }
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`Embedding request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
  }
  throw new Error("Embedding service unavailable");
}

// Mirrors generate-embedding's buildJobText field-for-field, so a hotlist and a
// job describing the same work land near each other in vector space.
function buildHotlistText(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (row.role_title) parts.push(`Job Title: ${row.role_title}`);
  const skills = Array.isArray(row.core_skills) ? (row.core_skills as string[]).join(", ") : "";
  if (skills) parts.push(`Required Skills: ${skills}`);
  if (row.years_experience != null) parts.push(`Required Experience: ${row.years_experience} years`);
  if (row.visa_type) parts.push(`Visa Types: ${row.visa_type}`);
  if (row.hourly_rate_min || row.hourly_rate_max) {
    parts.push(`Rate: $${row.hourly_rate_min ?? "?"}-$${row.hourly_rate_max ?? "?"}/hr`);
  }
  const locations = Array.isArray(row.locations) ? (row.locations as string[]).join(", ") : "";
  if (locations) parts.push(`Location: ${locations}`);
  if (row.employment_type) parts.push(`Employment Type: ${row.employment_type}`);
  const content = String(row.raw_post_content ?? "");
  if (content) parts.push(`Description: ${content.slice(0, 1500)}`);
  return parts.join("\n") || String(row.role_title ?? "Consultant");
}

function windowStartIso() {
  return new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// Mirrors generate-embedding's buildJobText. Needed because only *scraped*
// jobs are embedded on arrival (receive-social-job); jobs posted in the app go
// through create_user_job_post and never were, which made every vendor-posted
// job invisible to AI Match.
function buildJobText(row: Record<string, unknown>): string {
  const list = (value: unknown) => Array.isArray(value) ? (value as unknown[]).map(String).join(", ") : "";
  const parts: string[] = [];
  if (row.job_title) parts.push(`Job Title: ${row.job_title}`);
  const skills = list(row.extracted_skills);
  if (skills) parts.push(`Required Skills: ${skills}`);
  if (row.extracted_experience_years != null) parts.push(`Required Experience: ${row.extracted_experience_years} years`);
  const visas = list(row.extracted_visa_types);
  if (visas) parts.push(`Visa Types: ${visas}`);
  if (row.extracted_hourly_rate_min || row.extracted_hourly_rate_max) {
    parts.push(`Rate: $${row.extracted_hourly_rate_min ?? "?"}-$${row.extracted_hourly_rate_max ?? "?"}/hr`);
  }
  if (row.location) parts.push(`Location: ${row.location}`);
  const description = String(row.job_description || row.post_content || "");
  if (description) parts.push(`Description: ${description.slice(0, 1500)}`);
  return parts.join("\n") || String(row.job_title ?? "Job");
}

async function embedMissingJobs(
  admin: SupabaseClient,
  apiKey: string,
  model: string,
  limit: number,
): Promise<number> {
  const since = windowStartIso();
  const { data, error } = await admin
    .from("social_jobs")
    .select("id, job_title, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max, location, job_description, post_content")
    .is("job_embedding", null)
    .is("hidden_at", null)
    .or(`posted_at.gte.${since},created_at.gte.${since}`)
    .limit(limit);
  if (error) throw new Error(`Could not read jobs to embed: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return 0;
  const embeddings = await embedTexts(rows.map(buildJobText), apiKey, model);
  for (let start = 0; start < rows.length; start += 25) {
    await Promise.all(rows.slice(start, start + 25).map((row, offset) => admin
      .from("social_jobs")
      .update({ job_embedding: JSON.stringify(embeddings[start + offset]) })
      .eq("id", row.id)));
  }
  return rows.length;
}

async function countMissingHotlists(admin: SupabaseClient): Promise<number> {
  const since = windowStartIso();
  const { count } = await admin
    .from("social_hotlist")
    .select("id", { count: "exact", head: true })
    .is("hotlist_embedding", null)
    .is("hidden_at", null)
    .or(`posted_at.gte.${since},created_at.gte.${since}`);
  return count ?? 0;
}

async function embedMissingHotlists(
  admin: SupabaseClient,
  apiKey: string,
  model: string,
  limit: number,
): Promise<number> {
  const since = windowStartIso();
  const { data, error } = await admin
    .from("social_hotlist")
    .select("id, role_title, core_skills, years_experience, visa_type, locations, employment_type, hourly_rate_min, hourly_rate_max, raw_post_content")
    .is("hotlist_embedding", null)
    .is("hidden_at", null)
    .or(`posted_at.gte.${since},created_at.gte.${since}`)
    .limit(limit);
  if (error) throw new Error(`Could not read hotlists to embed: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return 0;

  const embeddings = await embedTexts(rows.map(buildHotlistText), apiKey, model);
  // Writes go out in small parallel groups; one request per row keeps this on
  // the plain table API with no bulk-update RPC to maintain.
  for (let start = 0; start < rows.length; start += 25) {
    await Promise.all(rows.slice(start, start + 25).map((row, offset) => admin
      .from("social_hotlist")
      .update({ hotlist_embedding: JSON.stringify(embeddings[start + offset]) })
      .eq("id", row.id)));
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Auto-post

// Auto-posting is deliberately non-fatal, which also means a failure leaves no
// trace unless it is logged: the outcome rides back in the response, and the
// app has no reason to show it. Anything other than a new post is logged with
// its reason.
async function logPostOutcome(promise: Promise<PostOutcome>): Promise<PostOutcome> {
  const outcome = await promise;
  if (outcome.status !== "created") {
    console.error("ai-match auto-post:", JSON.stringify(outcome));
  }
  return outcome;
}

type PostOutcome =
  | { status: "created"; count: number }
  | { status: "duplicate" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

const DUPLICATE_WINDOW_DAYS = 30;

async function autoPostDescription(input: {
  supabaseAdmin: SupabaseClient;
  userClient: SupabaseClient;
  supabaseUrl: string;
  authHeader: string;
  accountId: string;
  kind: "job" | "hotlist";
  description: string;
  openAiKey: string;
  embeddingModel: string;
}): Promise<PostOutcome> {
  const { supabaseAdmin, userClient, kind, description, accountId } = input;

  // Re-running a match on the same text shouldn't post it again.
  const since = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { count: existing } = await supabaseAdmin
    .from(kind === "job" ? "social_jobs" : "social_hotlist")
    .select("id", { count: "exact", head: true })
    .eq("created_by_account_id", accountId)
    .eq("post_source", "user_post")
    .eq(kind === "job" ? "post_content" : "raw_post_content", description)
    .gte("created_at", since);
  if ((existing ?? 0) > 0) return { status: "duplicate" };

  // Same extraction the Post form's auto-fill uses (Workers AI via the parser
  // worker), called as the user so its auth rules apply unchanged.
  const extractRes = await fetch(`${input.supabaseUrl}/functions/v1/extract-post-fields`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: input.authHeader,
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    },
    body: JSON.stringify({ kind, text: description }),
    signal: AbortSignal.timeout(30_000),
  });
  const extracted = await extractRes.json().catch(() => ({})) as Record<string, unknown>;
  if (!extractRes.ok || !extracted.ok) {
    return { status: "skipped", reason: String(extracted.error ?? `extraction HTTP ${extractRes.status}`).slice(0, 200) };
  }

  // First meaningful line of what was pasted, used when the extractor finds no
  // role/job title. Without it a run silently posts nothing, which is worse
  // than a post titled with the user's own first line.
  const fallbackTitle = () => {
    const line = description
      .split("\n")
      .map((l) => l.replace(/^[\s*•\-#>]+/, "").trim())
      .find((l) => l.length >= 3 && l.length <= 120);
    return line ?? (kind === "job" ? "Job Opportunity" : "Available Consultant");
  };

  const num = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const text = (value: unknown) => String(value ?? "").trim();
  const list = (value: unknown) => Array.isArray(value) ? (value as unknown[]).map(String).map((v) => v.trim()).filter(Boolean) : [];

  let created = 0;
  let rpcError: { message: string } | null = null;

  if (kind === "job") {
    const f = (extracted.fields ?? {}) as Record<string, unknown>;
    const years = num(f.experience_years);
    const { error } = await userClient.rpc("create_user_job_post", {
      p_job_title: text(f.job_title) || fallbackTitle(),
      p_company_name: text(f.company_name),
      p_location: text(f.location),
      p_employment_type: text(f.employment_type),
      p_seniority_level: text(f.seniority_level),
      p_salary_range: text(f.salary_range),
      p_job_description: text(f.job_description),
      p_post_content: description.slice(0, 7900),
      p_skills: list(f.skills),
      p_experience_years: years == null ? null : Math.round(years),
      p_visa_types: list(f.visa_types),
      p_hourly_rate_min: num(f.hourly_rate_min),
      p_hourly_rate_max: num(f.hourly_rate_max),
      // Blank falls back to the user's login email inside the RPC.
      p_contact_email: text(f.contact_email),
      p_contact_phone: text(f.contact_phone),
    });
    rpcError = error;
    if (!error) created = 1;
  } else {
    const candidates = (Array.isArray(extracted.candidates) ? extracted.candidates : [extracted.fields ?? {}]) as Record<string, unknown>[];
    // Keep every candidate that carries anything at all; a missing role title
    // is filled in below rather than dropping the post.
    const usable = candidates.filter((c) => text(c.role_title) || text(c.candidate_name) || text(c.candidate_summary));
    if (usable.length === 0) usable.push({});
    const contactEmail = text(extracted.contact_email ?? (extracted.fields as Record<string, unknown> | undefined)?.contact_email);
    const contactPhone = text(extracted.contact_phone ?? (extracted.fields as Record<string, unknown> | undefined)?.contact_phone);
    const toCandidate = (c: Record<string, unknown>) => ({
      role_title: text(c.role_title) || fallbackTitle(),
      candidate_name: text(c.candidate_name),
      core_skills: list(c.core_skills),
      years_experience: num(c.years_experience),
      visa_type: text(c.visa_type),
      employment_type: text(c.employment_type),
      work_type: text(c.work_type),
      locations: list(c.locations),
      hourly_rate_min: num(c.hourly_rate_min),
      hourly_rate_max: num(c.hourly_rate_max),
      availability: text(c.availability),
      candidate_summary: text(c.candidate_summary),
    });

    if (usable.length > 1) {
      // A hotlist table: one post per consultant, as the Post form does.
      const { error } = await userClient.rpc("create_user_hotlist_posts_batch", {
        p_candidates: usable.map(toCandidate),
        p_post_content: description.slice(0, 7900),
        p_contact_email: contactEmail,
        p_contact_phone: contactPhone,
      });
      rpcError = error;
      if (!error) created = usable.length;
      if (error) {
        console.error("ai-match batch post failed, falling back to single:", JSON.stringify(error));
        const c = toCandidate(usable[0]);
        const single = await userClient.rpc("create_user_hotlist_post", {
          p_role_title: c.role_title,
          p_candidate_name: c.candidate_name,
          p_core_skills: c.core_skills,
          p_years_experience: c.years_experience,
          p_visa_type: c.visa_type,
          p_employment_type: c.employment_type,
          p_work_type: c.work_type,
          p_locations: c.locations,
          p_hourly_rate_min: c.hourly_rate_min,
          p_hourly_rate_max: c.hourly_rate_max,
          p_availability: c.availability,
          p_candidate_summary: c.candidate_summary,
          p_post_content: description.slice(0, 7900),
          p_contact_email: contactEmail,
          p_contact_phone: contactPhone,
        });
        rpcError = single.error;
        if (!single.error) created = 1;
      }
    } else {
      const c = toCandidate(usable[0]);
      const { error } = await userClient.rpc("create_user_hotlist_post", {
        p_role_title: c.role_title,
        p_candidate_name: c.candidate_name,
        p_core_skills: c.core_skills,
        p_years_experience: c.years_experience,
        p_visa_type: c.visa_type,
        p_employment_type: c.employment_type,
        p_work_type: c.work_type,
        p_locations: c.locations,
        p_hourly_rate_min: c.hourly_rate_min,
        p_hourly_rate_max: c.hourly_rate_max,
        p_availability: c.availability,
        p_candidate_summary: c.candidate_summary,
        p_post_content: description.slice(0, 7900),
        p_contact_email: contactEmail,
        p_contact_phone: contactPhone,
      });
      rpcError = error;
      if (!error) created = 1;
    }
  }

  if (rpcError) {
    console.error("ai-match create post RPC failed:", kind, JSON.stringify(rpcError));
    return /daily post limit/i.test(rpcError.message)
      ? { status: "skipped", reason: "daily post limit reached" }
      : { status: "failed", reason: rpcError.message.slice(0, 200) };
  }

  // Embed the new post straight away so it's findable by the other side's AI
  // Match now, rather than whenever the next catch-up happens to run.
  await (kind === "job"
    ? embedMissingJobs(supabaseAdmin, input.openAiKey, input.embeddingModel, 10)
    : embedMissingHotlists(supabaseAdmin, input.openAiKey, input.embeddingModel, Math.max(10, created)))
    .catch(() => 0);

  return { status: "created", count: created };
}

// ---------------------------------------------------------------------------
// Ranking

const DEFAULT_RANK_INSTRUCTIONS = `You are an expert US IT staffing recruiter. Score how well each candidate below fits the brief, from 1 to 10:
- 9-10: excellent — same role, core skills present, experience in range, visa/work authorization and location compatible
- 7-8: strong — right role and most key skills, minor gaps
- 5-6: partial — related role or several missing skills
- 3-4: weak — adjacent role, major gaps
- 1-2: poor — different role or disqualifying mismatch (visa, location, seniority)
Judge on substance, not keyword overlap. Treat a missing field as unknown, not as a mismatch. Score every candidate. For each, write the reason as one complete sentence of 8 to 15 words that names the specific facts behind the score — the matching or missing skills, the experience, the visa or location constraint — for example "Strong Java, Spring Boot and React match, but the role is USC-only." Never answer with a single word or a bare label.`;

function summarizeCandidate(row: FeedRow, index: number): string {
  const list = (value: unknown) => Array.isArray(value) ? (value as string[]).filter(Boolean).join(", ") : "";
  const skills = list(row.core_skills) || list(row.extracted_skills);
  const visas = list(row.visa_types) || list(row.extracted_visa_types);
  const years = row.years_experience ?? row.extracted_experience_years;
  const rateMin = row.hourly_rate_min ?? row.extracted_hourly_rate_min;
  const rateMax = row.hourly_rate_max ?? row.extracted_hourly_rate_max;
  const snippet = String(row.post_content ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
  return [
    `[${index}] ${row.job_title ?? row.role_title ?? "Untitled"}`,
    row.company_name ? `Company: ${row.company_name}` : "",
    row.location ? `Location: ${row.location}` : "",
    years != null ? `Experience: ${years} yrs` : "",
    skills ? `Skills: ${skills.slice(0, 200)}` : "",
    visas ? `Visa: ${visas}` : "",
    rateMin != null || rateMax != null ? `Rate: $${rateMin ?? "?"}-$${rateMax ?? "?"}/hr` : "",
    row.employment_type ? `Type: ${row.employment_type}` : "",
    row.work_type ? `Work: ${row.work_type}` : "",
    snippet ? `Post: ${snippet}` : "",
  ].filter(Boolean).join(" | ");
}

type ChunkScores = { scores: Map<number, { score: number; reason: string }>; usedModel: string; usage: Record<string, number> };

// Scores the shortlist in parallel chunks. One call over all 60 took 82s on
// gpt-5-mini — it reasons through every candidate in sequence — while the
// rubric makes each judgement independent, so splitting loses nothing and cuts
// latency to roughly one chunk's worth.
async function scoreCandidates(
  admin: SupabaseClient,
  workerUrl: string,
  workerToken: string,
  target: Target,
  description: string,
  candidates: FeedRow[],
  onProgress?: (scored: number) => void,
): Promise<ChunkScores> {
  const override = await getPromptOverride(admin, "ai-match-rank");
  const instructions = override?.userPrompt?.trim() || DEFAULT_RANK_INSTRUCTIONS;
  const briefLabel = target === "jobs" ? "CONSULTANT (from a bench-sales hotlist)" : "JOB OPENING";
  const candidateLabel = target === "jobs" ? "JOB OPENINGS" : "AVAILABLE CONSULTANTS";

  const chunks: Array<{ offset: number; rows: FeedRow[] }> = [];
  for (let offset = 0; offset < candidates.length; offset += SCORING_CHUNK_SIZE) {
    chunks.push({ offset, rows: candidates.slice(offset, offset + SCORING_CHUNK_SIZE) });
  }

  const deadline = Date.now() + SCORING_BUDGET_MS;
  // Chunks finish independently, so progress is reported as each lands rather
  // than jumping from 0 to done.
  let scoredSoFar = 0;
  // Indices stay global across chunks, so results merge without remapping.
  const settled = await Promise.allSettled(chunks.map(({ offset, rows }) => scoreChunk(
    workerUrl,
    workerToken,
    deadline,
    `${instructions}

${briefLabel}:
${description}

${candidateLabel}:
${rows.map((row, i) => summarizeCandidate(row, offset + i)).join("\n")}

Return ONLY JSON: {"scores":[{"index":<number>,"score":<1-10>,"reason":"<short reason>"}]} with one entry per candidate listed above.`,
    offset,
    rows.length,
  ).then((chunk) => {
    scoredSoFar += chunk.scores.size;
    onProgress?.(scoredSoFar);
    return chunk;
  })));

  const scores = new Map<number, { score: number; reason: string }>();
  const usage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
  let usedModel = "";
  const failures: string[] = [];
  for (const result of settled) {
    if (result.status === "rejected") {
      failures.push(String((result.reason as Error)?.message ?? result.reason));
      continue;
    }
    for (const [index, value] of result.value.scores) scores.set(index, value);
    usedModel ||= result.value.usedModel;
    usage.promptTokenCount += result.value.usage.promptTokenCount ?? 0;
    usage.candidatesTokenCount += result.value.usage.candidatesTokenCount ?? 0;
    usage.totalTokenCount += result.value.usage.totalTokenCount ?? 0;
  }
  // A failed chunk costs its candidates, not the run: better 40 scored results
  // than none. Only when nothing at all could be scored is it an error.
  if (scores.size === 0) throw new Error(`Could not score matches (${failures.join(" | ") || "no model responded"})`);
  return { scores, usedModel, usage };
}

async function scoreChunk(
  workerUrl: string,
  workerToken: string,
  deadline: number,
  prompt: string,
  offset: number,
  count: number,
): Promise<ChunkScores> {
  // Every model's failure is kept, not just the last: a retired model's 404
  // otherwise masks why the earlier, preferred models failed.
  const failures: string[] = [];

  // Bounded by whichever is sooner: this attempt's own limit or the shared
  // deadline. Returns null once the budget is spent, which ends the fallbacks.
  const attemptSignal = () => {
    const remaining = deadline - Date.now();
    return remaining < 2_000 ? null : AbortSignal.timeout(Math.min(SCORING_CALL_TIMEOUT_MS, remaining));
  };

  const toScores = (raw: string) => {
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { scores?: unknown[] };
    const scores = new Map<number, { score: number; reason: string }>();
    for (const entry of parsed.scores ?? []) {
      const item = entry as { index?: unknown; score?: unknown; reason?: unknown };
      const index = Number(item.index);
      const score = Math.round(Number(item.score));
      // Only this chunk's indices are accepted, so a model echoing a stray
      // number can't overwrite another chunk's result.
      if (!Number.isInteger(index) || index < offset || index >= offset + count) continue;
      if (!Number.isFinite(score)) continue;
      scores.set(index, {
        score: Math.min(10, Math.max(1, score)),
        reason: String(item.reason ?? "").trim().slice(0, 160),
      });
    }
    return scores;
  };

  for (const model of WORKER_SCORING_MODELS) {
    const signal = attemptSignal();
    if (!signal) break;
    try {
      const res = await fetch(`${workerUrl}/ai-match-score`, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
        },
        body: JSON.stringify({ prompt, model }),
      });
      const payload = await res.json().catch(() => ({})) as { text?: string; model?: string; error?: string };
      if (!res.ok || !payload.text) {
        failures.push(`${model} HTTP ${res.status}: ${String(payload.error ?? "no response").slice(0, 160)}`);
        continue;
      }
      const scores = toScores(payload.text);
      if (scores.size === 0) {
        failures.push(`${model} returned no usable scores`);
        continue;
      }
      // Workers AI bills in neurons, not tokens, so there are no token counts
      // to record; the usage log still captures which model ran.
      return { scores, usedModel: payload.model ?? model, usage: {} };
    } catch (error) {
      failures.push(`${model}: ${(error as Error).message}`);
    }
  }

  throw new Error(failures.join(" | ") || (Date.now() >= deadline ? "scoring timed out" : "no scoring model configured"));
}

function logUsage(admin: SupabaseClient, userId: string, accountId: string, model: string, usage: Record<string, number>) {
  admin.from("api_usage_log").insert({
    user_id: userId,
    account_id: accountId,
    function_name: "ai-match",
    provider: "cloudflare-workers-ai",
    model,
    prompt_tokens: usage.promptTokenCount ?? 0,
    completion_tokens: usage.candidatesTokenCount ?? 0,
    total_tokens: usage.totalTokenCount ?? 0,
    // Workers AI is billed per neuron on the Cloudflare account, not per token.
    cost_usd: 0,
    metadata: { action: "ai-match/rank" },
  }).then(() => {}, () => {});
}
