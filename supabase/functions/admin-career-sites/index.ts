import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// /admin -> Career Sites. Actions (all need the admin password):
//   list                         sites, per-site counts, recent runs
//   save    { site }             add or edit a site
//   toggle  { slug, enabled }    switch a site on or off
//   delete  { slug }             remove a site added from /admin (its jobs close)
//   run     { slug, full? }      queue a run now
//   test    { kind, config }     read a site's first page without storing anything
//   jobs    { slug?, category?, status?, days?, q?, offset?, limit? }  career-site jobs

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const KINDS = ["sitemap_jsonld", "jobdiva", "greenhouse", "lever", "workday", "adzuna", "jooble", "none"];

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function httpsUrl(v: string): URL | null {
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

// Accepts what an admin is likely to paste (a careers URL) and turns it into
// the config the worker needs. Returns an error message when it can't.
function normalizeConfig(kind: string, raw: Record<string, unknown>): { config?: Record<string, unknown>; error?: string } {
  if (kind === "sitemap_jsonld") {
    const u = httpsUrl(str(raw.sitemap_url));
    if (!u) return { error: "Sitemap URL must be an https URL (e.g. https://jobs.example.com/sitemap.xml)" };
    return { config: { sitemap_url: u.toString(), url_contains: str(raw.url_contains) || "/job" } };
  }
  if (kind === "jobdiva") {
    const v = str(raw.portal_key) || str(raw.url);
    const key = v.match(/[?&]a=([a-z0-9]+)/i)?.[1] ?? (/^[a-z0-9]{20,}$/i.test(v) ? v : "");
    if (!key) return { error: "Paste the JobDiva portal link (it contains ?a=...) or its portal key" };
    return { config: { portal_key: key } };
  }
  if (kind === "greenhouse") {
    const v = str(raw.board) || str(raw.url);
    const board = v.match(/greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i)?.[1] ?? (/^[a-z0-9_-]+$/i.test(v) ? v : "");
    if (!board) return { error: "Paste the Greenhouse board link (boards.greenhouse.io/<company>) or the board name" };
    return { config: { board: board.toLowerCase() } };
  }
  if (kind === "lever") {
    const v = str(raw.company) || str(raw.url);
    const company = v.match(/lever\.co\/([a-z0-9_-]+)/i)?.[1] ?? (/^[a-z0-9_-]+$/i.test(v) ? v : "");
    if (!company) return { error: "Paste the Lever link (jobs.lever.co/<company>) or the company name" };
    return { config: { company: company.toLowerCase() } };
  }
  if (kind === "workday") {
    const u = httpsUrl(str(raw.url));
    if (!u || !/\.myworkdayjobs\.com$/i.test(u.hostname) || u.pathname.split("/").filter(Boolean).length === 0) {
      return { error: "Paste the Workday careers link (https://<company>.wd5.myworkdayjobs.com/<site>)" };
    }
    return { config: { url: `${u.origin}${u.pathname.replace(/\/+$/, "")}` } };
  }
  // Job boards: a search, read with our API key (a worker secret).
  if (kind === "adzuna") {
    const category = str(raw.category) || "it-jobs";
    if (!/^[a-z-]+$/.test(category)) return { error: "Adzuna category looks like it-jobs or healthcare-nursing-jobs" };
    return { config: { category, ...(str(raw.what) ? { what: str(raw.what).slice(0, 200) } : {}) } };
  }
  if (kind === "jooble") {
    return { config: { keywords: str(raw.keywords).slice(0, 200) || "contract", location: str(raw.location).slice(0, 100) || "USA" } };
  }
  return { error: "Unknown site type" };
}

async function callWorker(path: string, body?: unknown) {
  const base = (Deno.env.get("CAREER_SITES_WORKER_URL") ?? "").replace(/\/+$/, "");
  const token = Deno.env.get("CAREER_SITES_RUN_TOKEN") ?? "";
  if (!base || !token) throw new Error("Worker URL or run token is not configured");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Worker HTTP ${res.status}`);
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  const body = await req.json().catch(() => ({}));
  const adminPassword = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";
  if (body?.password !== adminPassword) return respond({ error: "Invalid password" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    switch (body.action) {
      case "list": {
        const [sites, overview, runs] = await Promise.all([
          supabase.from("career_sites").select("*").order("name"),
          supabase.rpc("career_sites_overview"),
          (() => {
            let q = supabase.from("career_site_runs").select("*").order("started_at", { ascending: false }).limit(200);
            if (str(body.slug)) q = q.eq("slug", str(body.slug));
            return q;
          })(),
        ]);
        const err = sites.error ?? overview.error ?? runs.error;
        if (err) return respond({ error: err.message }, 500);
        return respond({
          sites: sites.data,
          overview: overview.data,
          runs: runs.data,
          schedule: { cron: "Every hour at :05 UTC", fullSyncHourUtc: 6 },
        });
      }

      case "save": {
        const s = (body.site ?? {}) as Record<string, unknown>;
        const name = str(s.name);
        if (!name) return respond({ error: "Name is required" }, 400);
        const existing = str(s.slug)
          ? (await supabase.from("career_sites").select("slug, kind").eq("slug", str(s.slug)).maybeSingle()).data
          : null;
        const kind = existing?.kind === "builtin" ? "builtin" : str(s.kind);
        let config: Record<string, unknown> = {};
        if (kind !== "builtin" && kind !== "none") {
          if (!KINDS.includes(kind)) return respond({ error: "Choose a site type" }, 400);
          const normalized = normalizeConfig(kind, (s.config ?? {}) as Record<string, unknown>);
          if (normalized.error) return respond({ error: normalized.error }, 400);
          config = normalized.config!;
        }
        const slug = existing?.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
        if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) return respond({ error: "Name must contain letters or numbers" }, 400);
        if (!existing) {
          const { data: clash } = await supabase.from("career_sites").select("slug").eq("slug", slug).maybeSingle();
          if (clash) return respond({ error: `A site named "${slug}" already exists` }, 400);
        }
        const careersUrl = str(s.careers_url);
        const maxNew = Math.min(300, Math.max(1, Math.round(Number(s.max_new_per_run) || 60)));
        const row: Record<string, unknown> = {
          slug, name, kind, careers_url: careersUrl && httpsUrl(careersUrl) ? careersUrl : null,
          enabled: s.enabled !== false, max_new_per_run: maxNew, notes: str(s.notes) || null, updated_at: new Date().toISOString(),
        };
        if (kind !== "builtin") row.config = config;
        // A site with no supported feed can be listed but never runs.
        if (kind === "none") row.enabled = false;
        const { data, error } = await supabase.from("career_sites").upsert(row, { onConflict: "slug" }).select().single();
        if (error) return respond({ error: error.message }, 500);
        return respond({ site: data });
      }

      // Career-site jobs for the Career Jobs tab, newest first.
      case "jobs": {
        const limit = Math.min(200, Math.max(1, Math.round(Number(body.limit) || 100)));
        const offset = Math.max(0, Math.round(Number(body.offset) || 0));
        let q = supabase.from("social_jobs")
          .select("id, post_id, posted_by_name, job_title, location, employment_type, salary_range, job_category, post_status, posted_at, created_at, post_url, extracted_skills, extracted_visa_types", { count: "exact" })
          .eq("post_source", "career_site");
        const slug = str(body.slug);
        if (slug) q = q.like("post_id", `${slug}:%`);
        if (body.category === "IT") q = q.or("job_category.is.null,job_category.neq.Non-IT");
        if (body.category === "Non-IT") q = q.eq("job_category", "Non-IT");
        if (body.status === "open" || body.status === "closed") q = q.eq("post_status", body.status);
        const days = Number(body.days);
        if (days > 0) q = q.gte("posted_at", new Date(Date.now() - days * 86_400_000).toISOString());
        const term = str(body.q).replace(/[%,()"\\]/g, " ").trim();
        if (term) q = q.or(`job_title.ilike."%${term}%",location.ilike."%${term}%"`);
        const { data, count, error } = await q.order("posted_at", { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);
        if (error) return respond({ error: error.message }, 500);
        return respond({ jobs: data, total: count ?? 0 });
      }

      case "toggle": {
        const { error } = await supabase.from("career_sites")
          .update({ enabled: Boolean(body.enabled), updated_at: new Date().toISOString() }).eq("slug", str(body.slug));
        if (error) return respond({ error: error.message }, 500);
        return respond({ ok: true });
      }

      case "delete": {
        const slug = str(body.slug);
        const { data: site } = await supabase.from("career_sites").select("kind").eq("slug", slug).maybeSingle();
        if (!site) return respond({ error: "Unknown site" }, 404);
        if (site.kind === "builtin") return respond({ error: "Built-in sites can be switched off, not deleted" }, 400);
        // Its jobs would never be refreshed or closed again: close them now.
        await supabase.from("social_jobs").update({ post_status: "closed" }).eq("post_source", "career_site").like("post_id", `${slug}:%`);
        await supabase.from("career_site_jobs").delete().eq("prime", slug);
        const { error } = await supabase.from("career_sites").delete().eq("slug", slug);
        if (error) return respond({ error: error.message }, 500);
        return respond({ ok: true });
      }

      case "run": {
        const slug = str(body.slug);
        const { data: site } = await supabase.from("career_sites").select("kind").eq("slug", slug).maybeSingle();
        if (site?.kind === "none") return respond({ error: "This site needs an adapter before it can run" }, 400);
        return respond(await callWorker(`/run?prime=${encodeURIComponent(slug)}${body.full ? "&full=1" : ""}`));
      }

      case "test": {
        const kind = str(body.kind);
        if (kind === "builtin" || kind === "none") return respond({ error: "This site type can't be tested" }, 400);
        const normalized = normalizeConfig(kind, (body.config ?? {}) as Record<string, unknown>);
        if (normalized.error) return respond({ error: normalized.error }, 400);
        return respond(await callWorker("/test", { kind, config: normalized.config }));
      }

      default:
        return respond({ error: "Unknown action" }, 400);
    }
  } catch (error) {
    return respond({ error: (error as Error).message }, 500);
  }
});
