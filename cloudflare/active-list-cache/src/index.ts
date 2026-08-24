export interface Env {
  ACTIVE_LIST_CACHE: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WORKER_AUTH_TOKEN?: string;
  CACHE_TTL_SECONDS?: string;
}

type ContactRpcRow = {
  contact_email: string;
  contact_name: string | null;
  last_active_at: string;
  role_titles: string[] | null;
  post_count: number | null;
};

type PublicContact = {
  name: string;
  email: string;
  last_active_at: string;
  role_titles: string;
  post_count: number;
};

type CachePayload = {
  rows: PublicContact[];
  refreshed_at: string;
  total_count_30d: number | null;
};

const PUBLIC_ROW_CAP = 100;

const ROUTES: Record<string, string> = {
  vendors: "get_active_list_vendor_contacts_24h",
  recruiters: "get_active_list_recruiter_contacts_24h",
};

// 30 days — the count RPCs skip the row RPCs' LATERAL joins (no per-contact
// facet arrays to build), so a wider window costs nothing extra and gives
// visitors a real "how much more is there" number the free/gated 100-row
// preview can't show on its own.
const COUNT_HOURS_BACK = 720;

const COUNT_ROUTES: Record<string, string> = {
  vendors: "get_active_list_vendor_contact_count",
  recruiters: "get_active_list_recruiter_contact_count",
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

async function fetchContactsFromSupabase(env: Env, rpcName: string): Promise<PublicContact[]> {
  const rpcUrl = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${rpcName}`;
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    },
    // 7 days — wide enough that both categories reliably have 100+ contacts
    // to pick the "most recently active" top 100 from (24h alone was often
    // short of 100, especially on the smaller of the two categories).
    body: JSON.stringify({ p_hours_back: 168 }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase RPC failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const rows = (await response.json()) as ContactRpcRow[];
  return rows.slice(0, PUBLIC_ROW_CAP).map((row) => ({
    name: row.contact_name ?? "",
    email: row.contact_email,
    last_active_at: row.last_active_at,
    role_titles: (row.role_titles ?? []).join(", "),
    post_count: row.post_count ?? 0,
  }));
}

// PostgREST serializes a scalar-returning (non-TABLE) RPC's result as the
// bare JSON value, e.g. the response body is literally `2847` — not an
// array or object, unlike the row-returning RPCs above.
async function fetchContactCount(env: Env, rpcName: string): Promise<number | null> {
  const rpcUrl = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${rpcName}`;
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ p_hours_back: COUNT_HOURS_BACK }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase count RPC failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const value = await response.json();
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) ? count : null;
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
    const routeKey = url.pathname.replace(/^\/+/, "");
    const rpcName = ROUTES[routeKey];
    if (!rpcName) {
      return jsonResponse({ error: "Not found. Use /vendors or /recruiters." }, 404);
    }

    const forceRefresh = url.searchParams.get("refresh") === "1";
    const ttlSeconds = Math.max(60, Number.parseInt(env.CACHE_TTL_SECONDS ?? "3600", 10) || 3600);
    // v2: payload gained total_count_30d — bumped so a stale v1 entry never
    // gets read back as if it had the new field (it would just be missing,
    // silently, for up to ttlSeconds after deploy otherwise).
    const cacheKey = `active-list:${routeKey}:v2`;

    if (!forceRefresh) {
      const cachedRaw = await env.ACTIVE_LIST_CACHE.get(cacheKey);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw) as CachePayload;
          if (Array.isArray(cached.rows)) {
            return jsonResponse(
              { rows: cached.rows, refreshed_at: cached.refreshed_at, total_count_30d: cached.total_count_30d ?? null, cached: true },
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
      const [rows, totalCount30d] = await Promise.all([
        fetchContactsFromSupabase(env, rpcName),
        fetchContactCount(env, COUNT_ROUTES[routeKey]),
      ]);
      const payload: CachePayload = { rows, refreshed_at: new Date().toISOString(), total_count_30d: totalCount30d };
      try {
        await env.ACTIVE_LIST_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: ttlSeconds });
      } catch (error) {
        console.warn(`Active list cache write skipped: ${(error as Error).message}`);
      }
      return jsonResponse({ ...payload, cached: false }, 200, { "X-Cache-Status": "MISS" });
    } catch (error) {
      const cachedRaw = await env.ACTIVE_LIST_CACHE.get(cacheKey);
      if (cachedRaw) {
        try {
          const stale = JSON.parse(cachedRaw) as CachePayload;
          if (Array.isArray(stale.rows)) {
            return jsonResponse(
              { rows: stale.rows, refreshed_at: stale.refreshed_at, total_count_30d: stale.total_count_30d ?? null, cached: true, warning: "Returned stale cache due to upstream error" },
              200,
              { "X-Cache-Status": "STALE" },
            );
          }
        } catch {
          // fall through to error response
        }
      }
      return jsonResponse({ error: (error as Error).message }, 500);
    }
  },
};
