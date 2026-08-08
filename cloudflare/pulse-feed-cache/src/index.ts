export interface Env {
  PULSE_FEED_CACHE: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  WORKER_AUTH_TOKEN?: string;
  CACHE_TTL_SECONDS?: string;
}

type PulseSocialFeedRpcRow = {
  lead_id: string;
  profile_id: string | null;
  match_created_at: string;
  final_average_score: number | null;
  score_breakdown: Record<string, unknown> | null;
  platform: string;
  posted_by_name: string;
  poster_email: string;
  poster_phone: string;
  social_created_at: string;
  posted_at: string | null;
  job_title: string;
  company_name: string;
  location: string;
  post_content: string;
  extracted_role_normalized: string | null;
  employment_type: string;
  seniority_level: string;
  salary_range: string;
  extracted_skills: string[] | null;
  extracted_experience_years: number | null;
  extracted_visa_types: string[] | null;
  extracted_hourly_rate_min: number | null;
  extracted_hourly_rate_max: number | null;
  role_title?: string | null;
  core_skills?: string[] | null;
  years_experience?: number | null;
  visa_types?: string[] | null;
  employment_type_status?: string | null;
  work_type?: string | null;
  locations?: string[] | null;
  hourly_rate_min?: number | null;
  hourly_rate_max?: number | null;
  relocation_required?: boolean | null;
};

type CachePayload = {
  rows: PulseSocialFeedRpcRow[];
  refreshed_at: string;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=30",
      ...extraHeaders,
    },
  });
}

function getBearerToken(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return "";
  return token.trim();
}

function parsePositiveInt(raw: string | null, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeHours(raw: string | null) {
  const hours = parsePositiveInt(raw, 24);
  return Math.max(1, Math.min(24 * 30, hours));
}

function normalizeLimit(raw: string | null) {
  const limit = parsePositiveInt(raw, 5000);
  return Math.max(100, Math.min(5000, limit));
}

async function fetchPulseRowsFromSupabase(env: Env, hours: number, limit: number): Promise<PulseSocialFeedRpcRow[]> {
  const since = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
  const rpcUrl = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/get_pulse_social_feed`;

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.SUPABASE_ANON_KEY}`,
      "apikey": env.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      p_since: since,
      p_limit: limit,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase RPC failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? (payload as PulseSocialFeedRpcRow[]) : [];
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (req.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const expected = (env.WORKER_AUTH_TOKEN ?? "").trim();
    if (expected) {
      const actual = getBearerToken(req);
      if (!actual || actual !== expected) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
    }

    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const hours = normalizeHours(url.searchParams.get("hours"));
    const limit = normalizeLimit(url.searchParams.get("limit"));
    const ttlSeconds = Math.max(60, parsePositiveInt(env.CACHE_TTL_SECONDS ?? null, 90));
    const cacheKey = `pulse-feed:v1:h${hours}:l${limit}`;

    let stalePayload: CachePayload | null = null;

    if (!forceRefresh) {
      const cachedRaw = await env.PULSE_FEED_CACHE.get(cacheKey);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw) as CachePayload;
          if (Array.isArray(cached.rows)) {
            return jsonResponse(
              { rows: cached.rows, cached: true, refreshed_at: cached.refreshed_at },
              200,
              { "X-Cache-Status": "HIT" },
            );
          }
        } catch {
          // Ignore invalid cache and continue to refresh.
        }
      }
    }

    try {
      const rows = await fetchPulseRowsFromSupabase(env, hours, limit);
      const payload: CachePayload = {
        rows,
        refreshed_at: new Date().toISOString(),
      };
      await env.PULSE_FEED_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: ttlSeconds });
      return jsonResponse(
        { ...payload, cached: false },
        200,
        { "X-Cache-Status": "MISS" },
      );
    } catch (error) {
      if (!stalePayload) {
        const cachedRaw = await env.PULSE_FEED_CACHE.get(cacheKey);
        if (cachedRaw) {
          try {
            stalePayload = JSON.parse(cachedRaw) as CachePayload;
          } catch {
            stalePayload = null;
          }
        }
      }

      if (stalePayload?.rows) {
        return jsonResponse(
          {
            rows: stalePayload.rows,
            cached: true,
            refreshed_at: stalePayload.refreshed_at,
            warning: "Returned stale cache due to upstream error",
          },
          200,
          { "X-Cache-Status": "STALE" },
        );
      }

      return jsonResponse({ error: (error as Error).message }, 500);
    }
  },
};
