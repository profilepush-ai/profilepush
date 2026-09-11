import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";
const OPENAI_MODEL = "gpt-4o-mini";
const MAX_COMMENT_BATCH = 40;

type Kind = "job" | "hotlist";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleList(
  supabase: ReturnType<typeof createClient>,
  kind: Kind,
  startDate: string | null,
  endDate: string | null,
  limit: number,
  offset: number,
) {
  const table = kind === "job" ? "social_jobs" : "social_hotlist";
  const columns = kind === "job"
    ? "id, post_url, post_content, job_title, company_name, created_at, posted_at"
    : "id, post_url, raw_post_content, role_title, bench_sales_company_name, created_at, posted_at";

  let query = supabase
    .from(table)
    .select(columns, { count: "exact" })
    .eq("post_source", "linkedin_scrape")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (startDate) query = query.gte("created_at", startDate);
  if (endDate) query = query.lte("created_at", endDate);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    post_url: row.post_url,
    content: kind === "job" ? row.post_content : row.raw_post_content,
    title: kind === "job" ? row.job_title : row.role_title,
    company: kind === "job" ? row.company_name : row.bench_sales_company_name,
    created_at: row.created_at,
  }));

  return { rows, total: count ?? rows.length };
}

function normalizeComment(raw: string, link: string): string | null {
  const comment = raw.trim().replace(/^["'`]|["'`]$/g, "");
  const wordCount = comment.split(/\s+/).filter(Boolean).length;
  if (!comment) return null;
  if (wordCount > 30) return null;
  if (!/\d/.test(comment)) return null;
  if (!comment.includes(link)) return null;
  return comment;
}

function fallbackComment(kind: Kind, matchingCount: number, link: string): string {
  return kind === "job"
    ? `${matchingCount} matching consultants already available for this exact role. See them free: ${link}`
    : `${matchingCount} matching job requirements posted for this exact profile right now. Check them: ${link}`;
}

async function draftComment(
  openaiKey: string,
  kind: Kind,
  postContent: string,
  matchingCount: number,
): Promise<string> {
  const link = kind === "job" ? "https://profilepush.ai/vendors" : "https://profilepush.ai/bench-sales";
  const systemPrompt = kind === "job"
    ? `You write short, punchy LinkedIn comments (under 30 words) on job requirement posts, designed to grab the poster's attention. Always lead with or include the exact number given (matching consultant profiles already available) — this is the core hook. Urgent, direct, no fluff, no greetings. End with exactly this link: ${link}. Never mention any product/company name. Return ONLY the comment text, nothing else.`
    : `You write short, punchy LinkedIn comments (under 30 words) on bench-sales consultant posts, designed to grab the poster's attention. Always lead with or include the exact number given (matching job requirements already available) — this is the core hook. Urgent, direct, no fluff, no greetings. End with exactly this link: ${link}. Never mention any product/company name. Return ONLY the comment text, nothing else.`;
  const userPrompt = `Post content: ${postContent.slice(0, 800)}\n\nMatching count: ${matchingCount}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 100,
      }),
    });
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const payload = await response.json();
    const raw = payload?.choices?.[0]?.message?.content ?? "";
    const normalized = normalizeComment(raw, link);
    if (normalized) return normalized;
    throw new Error("AI comment failed validation");
  } catch (err) {
    console.error("draftComment failed, using fallback", err);
    return fallbackComment(kind, matchingCount, link);
  }
}

async function handleGenerateComments(
  supabase: ReturnType<typeof createClient>,
  openaiKey: string,
  kind: Kind,
  ids: string[],
) {
  const boundedIds = ids.slice(0, MAX_COMMENT_BATCH);
  const table = kind === "job" ? "social_jobs" : "social_hotlist";
  const contentCol = kind === "job" ? "post_content" : "raw_post_content";
  const countRpc = kind === "job" ? "count_matching_hotlist_profiles_for_job" : "count_matching_jobs_for_hotlist";
  const countParam = kind === "job" ? "p_job_id" : "p_hotlist_id";

  const { data: posts, error } = await supabase
    .from(table)
    .select(`id, ${contentCol}`)
    .in("id", boundedIds);
  if (error) throw new Error(error.message);

  const results = [];
  // Small sequential-ish concurrency to stay well under OpenAI rate limits
  // and Edge Function CPU time, rather than firing all at once.
  const CONCURRENCY = 5;
  const queue = [...(posts ?? [])];
  async function worker() {
    while (queue.length > 0) {
      const post = queue.shift();
      if (!post) continue;
      const postId = post.id as string;
      const content = String((post as Record<string, unknown>)[contentCol] ?? "");
      const { data: countData, error: countError } = await supabase.rpc(countRpc, { [countParam]: postId });
      const matchingCount = countError ? 0 : (countData as number) ?? 0;
      const comment = await draftComment(openaiKey, kind, content, matchingCount);
      results.push({ id: postId, comment, matching_count: matchingCount });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  return { results };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { password, action } = body;
    if (password !== ADMIN_PASSWORD) {
      return jsonResponse({ error: "Invalid password" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const kind: Kind = body.kind === "hotlist" ? "hotlist" : "job";

    if (action === "list") {
      const limit = typeof body.limit === "number" ? Math.min(body.limit, 200) : 50;
      const offset = typeof body.offset === "number" ? body.offset : 0;
      const result = await handleList(supabase, kind, body.start_date ?? null, body.end_date ?? null, limit, offset);
      return jsonResponse(result);
    }

    if (action === "generate_comments") {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);
      const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === "string") : [];
      if (ids.length === 0) return jsonResponse({ error: "ids is required" }, 400);
      const result = await handleGenerateComments(supabase, openaiKey, kind, ids);
      return jsonResponse(result);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
