import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type RawPost = Record<string, unknown>;

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return "";
}

function toIsoDate(value: unknown): string | null {
  if (typeof value === "number") {
    const date = new Date(value > 9_999_999_999 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return toIsoDate(objectValue.timestamp ?? objectValue.date ?? objectValue.seconds);
  }
  return null;
}

function isLikelyStaffingPost(content: string): boolean {
  const text = content.toLowerCase();
  const signals = [
    "hiring", "opening", "position", "role", "requirements", "experience", "c2c", "w2",
    "contract", "full-time", "onsite", "remote", "hybrid", "rate", "resume", "skills",
    "hotlist", "bench", "consultant", "availability", "available", "submission",
  ];
  let hits = 0;
  for (const signal of signals) {
    if (text.includes(signal)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

function extractPostId(url: string): string {
  return url.match(/urn:li:groupPost:\d+-(\d+)/i)?.[1]
    ?? url.match(/(?:activity|urn:li:activity)[:-](\d+)/i)?.[1]
    ?? "";
}

async function generatedPostId(post: RawPost, groupId: string, content: string): Promise<string> {
  const input = `${groupId}\n${firstString(post.linkedinUrl, post.post_url, post.url)}\n${content}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return `gen_${Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function normalizePost(post: RawPost, groupId: string): Promise<Record<string, unknown> | null> {
  const content = firstString(post.text, post.content, post.post_content, post.description);
  if (content.length < 80 || !isLikelyStaffingPost(content)) return null;

  const postUrl = firstString(post.linkedinUrl, post.post_url, post.url, post.postUrl, post["post URL"]);
  const postId = firstString(post.id, post.post_id, post.postId)
    || extractPostId(postUrl)
    || await generatedPostId(post, groupId, content);
  const author = post.author && typeof post.author === "object" ? post.author as Record<string, unknown> : {};

  return {
    post_id: postId,
    group_id: groupId,
    platform: "linkedin",
    post_content: content,
    posted_by_name: firstString(post.owner_name, post.authorName, post.posted_by_name, author.name, typeof post.author === "string" ? post.author : ""),
    posted_at: toIsoDate(post.timestamp) ?? toIsoDate(post.postedAt) ?? toIsoDate(post.posted_at) ?? toIsoDate(post.time),
    profile_link: firstString(post.owner_profile_url, post.authorLinkedinUrl, post.authorProfileUrl, post.profile_link, author.linkedinUrl),
    post_url: postUrl,
    job_title: firstString(post.job_title, post.title),
    company_name: firstString(post.company_name, post.company),
    location: asString(post.location),
    employment_type: asString(post.employment_type),
    seniority_level: asString(post.seniority_level),
    job_description: content,
    salary_range: asString(post.salary_range),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const expectedToken = (Deno.env.get("BACKFILL_SOCIAL_HOTLIST_TOKEN") ?? "").trim();
  const actualToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!expectedToken || actualToken !== expectedToken) return respond({ error: "Unauthorized" }, 401);

  const startedAt = new Date().toISOString();
  try {
    const body = await request.json().catch(() => ({})) as { limit?: unknown; offset?: unknown };
    const requestedLimit = Number(body.limit ?? 50);
    const requestedOffset = Number(body.offset ?? 0);
    const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 50;
    const offset = Number.isInteger(requestedOffset) ? Math.max(0, Math.min(999, requestedOffset)) : 0;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: logs, error: logsError } = await supabase
      .from("linkedin_groups_posts")
      .select("group_id,raw_post,scraped_at")
      .order("scraped_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (logsError) return respond({ error: logsError.message }, 500);

    const normalized = await Promise.all((logs ?? []).map((log) => normalizePost(log.raw_post as RawPost, asString(log.group_id))));
    const accepted = normalized.filter((row): row is Record<string, unknown> => row !== null);
    const uniqueRows = [...new Map(accepted.map((row) => [`${row.platform}:${row.post_id}`, row])).values()];
    const batches = chunk(uniqueRows, 10);
    const receiverResults: Array<Record<string, unknown>> = [];

    for (const wave of chunk(batches, 5)) {
      const results = await Promise.all(wave.map(async (items) => {
        const response = await fetch(`${supabaseUrl}/functions/v1/receive-social-job`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
            "Apikey": serviceRoleKey,
          },
          body: JSON.stringify(items),
        });
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok) throw new Error(`receive-social-job ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
        return payload;
      }));
      receiverResults.push(...results);
    }

    const insertedCandidates = receiverResults.reduce((sum, result) => sum + Number(result.hotlist_candidates_inserted ?? 0), 0);
    const insertedJobs = receiverResults.reduce((sum, result) => sum + Number(result.inserted ?? 0), 0);
    const skipped = receiverResults.flatMap((result) => Array.isArray(result.skipped) ? result.skipped : []);

    const sourcePostIds = uniqueRows.map((row) => asString(row.post_id)).filter(Boolean);
    const verificationRows: Array<Record<string, unknown>> = [];
    for (let from = 0; from < Math.max(insertedCandidates, 1); from += 1000) {
      const { data, error } = await supabase
        .from("social_hotlist")
        .select("id,platform,source_post_id,candidate_index,role_title,bench_sales_recruiter_name,bench_sales_recruiter_email,bench_sales_recruiter_phone,bench_sales_company_name,created_at")
        .eq("platform", "linkedin")
        .in("source_post_id", sourcePostIds.length > 0 ? sourcePostIds : ["__none__"])
        .order("created_at", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(`verification query failed: ${error.message}`);
      verificationRows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }

    const bySource = new Map<string, Array<Record<string, unknown>>>();
    for (const row of verificationRows) {
      const key = `${row.platform}:${row.source_post_id}`;
      bySource.set(key, [...(bySource.get(key) ?? []), row]);
    }
    const recruiterKey = (row: Record<string, unknown>) => JSON.stringify([
      row.bench_sales_recruiter_name,
      row.bench_sales_recruiter_email,
      row.bench_sales_recruiter_phone,
      row.bench_sales_company_name,
    ]);
    const multiConsultantPosts = [...bySource.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([source, rows]) => ({
        source,
        candidate_cards: rows.length,
        roles: rows.map((row) => row.role_title),
        recruiter_details_identical: new Set(rows.map(recruiterKey)).size === 1,
        recruiter_name: rows[0]?.bench_sales_recruiter_name,
        recruiter_email: rows[0]?.bench_sales_recruiter_email,
        recruiter_company: rows[0]?.bench_sales_company_name,
      }));

    return respond({
      success: true,
      raw_record_offset: offset,
      requested_raw_records: limit,
      raw_records_loaded: logs?.length ?? 0,
      staffing_posts_after_gate: accepted.length,
      unique_posts_replayed: uniqueRows.length,
      duplicate_snapshots_removed: accepted.length - uniqueRows.length,
      job_posts_upserted: insertedJobs,
      hotlist_candidate_cards_upserted: insertedCandidates,
      hotlist_candidate_cards_verified: verificationRows.length,
      hotlist_source_posts_verified: bySource.size,
      multi_consultant_source_posts: multiConsultantPosts.length,
      all_multi_consultant_recruiter_details_identical: multiConsultantPosts.every((post) => post.recruiter_details_identical),
      multi_consultant_samples: multiConsultantPosts.slice(0, 10),
      skipped_count: skipped.length,
      skipped_samples: skipped.slice(0, 20),
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Social hotlist backfill failed", error);
    return respond({ error: (error as Error).message, started_at: startedAt }, 500);
  }
});