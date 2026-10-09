import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Receives listings from the career-sites-scraper worker (prime vendors' own
// career sites) and stores the US IT contract ones as requirements.
//   { action: "sync", prime, ids: string[], complete: boolean }
//     -> { unknown: string[], closed: number, reopened: number }
//   { action: "upsert", prime, jobs: CareerJob[] }
//     -> { accepted: number, rejected: number }

type CareerJob = {
  source_id: string;
  url: string;
  title: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  remote?: boolean | null;
  employment_type?: string | null;
  date_posted?: string | null;
  pay_min?: number | string | null;
  pay_max?: number | string | null;
  pay_unit?: string | null;
  currency?: string | null;
  description?: string | null;
};

const PRIMES: Record<string, string> = {
  teksystems: "TEKsystems",
  judge: "Judge Group",
  kforce: "Kforce",
  pyramid: "Pyramid Consulting",
  ampcus: "Ampcus",
  insightglobal: "Insight Global",
  apex: "Apex Systems",
  randstad: "Randstad",
  diverselynx: "Diverse Lynx",
  mindlance: "Mindlance",
};

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const STATE_CODES = new Set(Object.values(STATES));

const IT_TITLE = /\b(developer|engineer|architect|devops|sre|cloud|aws|azure|gcp|data|analyst|scientist|machine learning|ml|ai|software|programmer|java|python|\.net|dotnet|c#|react|angular|node|full ?stack|front ?end|back ?end|sql|database|dba|etl|informatica|snowflake|databricks|salesforce|servicenow|sap|oracle|workday|peoplesoft|dynamics|qa|quality assurance|test(er|ing)? (engineer|analyst|lead)|automation|selenium|scrum|agile|product owner|project manager|program manager|business analyst|ba|systems? (admin|administrator|analyst|engineer)|network|security|cyber|soc|infrastructure|linux|unix|windows|vmware|citrix|help ?desk|service desk|desktop support|it support|technical support|it (manager|director|specialist|technician|analyst)|application|mainframe|cobol|sharepoint|power ?bi|tableau|bi developer|erp|crm|integration|mulesoft|api|kubernetes|docker|terraform|ios|android|mobile|ui|ux|web|tech lead|technical lead|solutions?|implementation|guidewire|pega|appian|splunk|cisco|telecom|firmware|embedded|it)\b/i;
const NON_IT_TITLE = /\b(nurse|rn|lpn|cna|physician|therapist|pharmac\w*|medical (assistant|coder|billing)|dental|warehouse|forklift|driver|cdl|machine operator|assembler|welder|electrician|plumber|hvac|mechanic|maintenance technician|janitor|custodian|cook|chef|server|cashier|retail|sales (associate|representative|rep)|customer service|call center|receptionist|administrative assistant|admin assistant|office assistant|executive assistant|data entry|accountant|accounting|bookkeeper|payroll|accounts (payable|receivable)|tax|auditor|financial analyst|loan|underwriter|claims|paralegal|attorney|legal|hr|human resources|recruiter|teacher|install(er|ation) technician|av technician|construction|civil|mechanical engineer|manufacturing|production|packag\w*|laborer|operator|quality inspector|lab technician|clinical)\b/i;
const STRONG_IT = /\b(software|developer|data engineer|cloud|devops)\b/i;
const CONTRACT_TEXT = /\b(contract|contractor|temporary|temp|c2h|contract[- ]to[- ]hire|duration|\d+\+?\s*months?)\b/i;
const PAY_PERIODS: Record<string, string> = { HOUR: "hour", DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" };

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? n : null;
}

function stateCode(job: CareerJob): string | null {
  const s = str(job.state);
  if (STATE_CODES.has(s.toUpperCase())) return s.toUpperCase();
  return STATES[s.toLowerCase()] ?? null;
}

function rejectionReason(job: CareerJob): string | null {
  const country = str(job.country).toLowerCase();
  if (country && !["us", "usa", "united states", "united states of america"].includes(country)) return "not US";
  if (!country && !stateCode(job) && !job.remote) return "not US";
  const title = str(job.title);
  if (!title) return "no title";
  if (NON_IT_TITLE.test(title) && !STRONG_IT.test(title)) return "not IT";
  if (!IT_TITLE.test(title)) return "not IT";
  const et = str(job.employment_type).toUpperCase();
  const contractType = /CONTRACT|TEMPORARY|TEMP/.test(et);
  const permanentType = /FULL[_ -]?TIME|PERMANENT|DIRECT/.test(et) && !contractType;
  if (permanentType) return "not contract";
  if (!contractType && !CONTRACT_TEXT.test(`${title} ${str(job.description).slice(0, 1500)}`)) return "not contract";
  return null;
}

function payLabel(min: number | null, max: number | null, period: string | null): string | null {
  if (min == null && max == null) return null;
  const fmt = (n: number) => (period === "year" && n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n * 100) / 100}`);
  const range = min != null && max != null && min !== max ? `${fmt(min)}–${fmt(max)}` : fmt((min ?? max)!);
  const suffix = period === "hour" ? "/hr" : period === "year" ? "/yr" : period ? `/${period}` : "";
  return `$${range}${suffix}`;
}

function postedAt(datePosted: string | null | undefined): string | null {
  const d = str(datePosted).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const ageMs = Date.now() - Date.parse(`${d}T00:00:00Z`);
  // Sites give a date, not a time: a job dated today or yesterday sorts as
  // "just now" (we see it within the hour), older ones at midday of that date.
  return ageMs < 2 * 86_400_000 ? new Date().toISOString() : `${d}T12:00:00Z`;
}

function getBearerToken(req: Request): string {
  const [scheme, token] = (req.headers.get("Authorization") ?? "").split(" ");
  return scheme?.toLowerCase() === "bearer" ? (token ?? "").trim() : "";
}

async function extract(jobs: Array<{ id: string; title: string; description: string; location: string }>) {
  const workerUrl = (Deno.env.get("CLOUDFLARE_WORKER_URL") ?? "").trim();
  const workerToken = (Deno.env.get("CLOUDFLARE_WORKER_TOKEN") ?? "").trim();
  if (!workerUrl || jobs.length === 0) return new Map<string, Record<string, unknown>>();
  try {
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/extract-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}) },
      body: JSON.stringify({ jobs }),
      signal: AbortSignal.timeout(120_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const results = Array.isArray(payload?.results) ? payload.results as Array<Record<string, unknown>> : [];
    return new Map(results.map((r) => [str(r.job_id), r]));
  } catch (error) {
    // The structured fields are enough to list and match the job; skills and
    // visa are filled in on the next parse if this one failed.
    console.error("extract-job failed:", (error as Error).message);
    return new Map<string, Record<string, unknown>>();
  }
}

Deno.serve(async (req: Request) => {
  const expected = Deno.env.get("SOCIAL_WEBHOOK_SECRET") ?? "";
  if (req.method !== "POST" || !expected || getBearerToken(req) !== expected) return respond({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const slug = str(body.prime);
  const primeName = PRIMES[slug];
  if (!primeName) return respond({ error: "unknown prime" }, 400);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (body.action === "sync") {
    const ids: string[] = [...new Set<string>((Array.isArray(body.ids) ? body.ids : []).map(String).filter(Boolean))];
    const { data: known, error } = await supabase
      .from("career_site_jobs").select("source_id, status, social_job_id").eq("prime", slug);
    if (error) return respond({ error: error.message }, 500);
    const byId = new Map((known ?? []).map((r) => [r.source_id as string, r]));
    const live = new Set(ids);
    const unknown = ids.filter((id) => !byId.has(id));
    const now = new Date().toISOString();

    // Listed again after being closed: reopen.
    const reopen = (known ?? []).filter((r) => r.status === "closed" && live.has(r.source_id));
    if (reopen.length > 0) {
      await supabase.from("career_site_jobs").update({ status: "accepted", last_seen_at: now })
        .eq("prime", slug).in("source_id", reopen.map((r) => r.source_id));
      const jobIds = reopen.map((r) => r.social_job_id).filter(Boolean);
      if (jobIds.length > 0) await supabase.from("social_jobs").update({ post_status: "open" }).in("id", jobIds);
    }

    // Gone from the site: close. Only on a complete listing, and never when the
    // listing shrank by more than half (a partial fetch must not close jobs).
    let closed = 0;
    const accepted = (known ?? []).filter((r) => r.status === "accepted");
    if (body.complete === true && ids.length > 0 && ids.length >= 0.5 * (known ?? []).filter((r) => r.status !== "closed").length) {
      const gone = accepted.filter((r) => !live.has(r.source_id));
      for (let i = 0; i < gone.length; i += 200) {
        const chunk = gone.slice(i, i + 200);
        await supabase.from("career_site_jobs").update({ status: "closed" }).eq("prime", slug).in("source_id", chunk.map((r) => r.source_id));
        const jobIds = chunk.map((r) => r.social_job_id).filter(Boolean);
        if (jobIds.length > 0) await supabase.from("social_jobs").update({ post_status: "closed" }).in("id", jobIds);
      }
      closed = gone.length;
    }
    return respond({ unknown, closed, reopened: reopen.length });
  }

  if (body.action === "upsert") {
    const jobs: CareerJob[] = (Array.isArray(body.jobs) ? body.jobs : []).slice(0, 10);
    const now = new Date().toISOString();
    const ledger: Array<Record<string, unknown>> = [];
    const candidates: CareerJob[] = [];
    for (const job of jobs) {
      if (!str(job.source_id) || !str(job.url)) continue;
      const reason = rejectionReason(job);
      if (reason) ledger.push({ prime: slug, source_id: job.source_id, url: job.url, status: "rejected", reason, last_seen_at: now });
      else candidates.push(job);
    }

    const parsed = await extract(candidates.map((job) => ({
      id: `${slug}:${job.source_id}`,
      title: str(job.title),
      description: str(job.description).slice(0, 2500),
      location: [str(job.city), stateCode(job) ?? str(job.state)].filter(Boolean).join(", "),
    })));

    const rows: Array<Record<string, unknown>> = [];
    const rowJob = new Map<string, CareerJob>();
    for (const job of candidates) {
      const postId = `${slug}:${job.source_id}`;
      const result = parsed.get(postId) ?? {};
      if (str(result.job_category) === "Non-IT") {
        ledger.push({ prime: slug, source_id: job.source_id, url: job.url, status: "rejected", reason: "not IT (parser)", last_seen_at: now });
        continue;
      }
      const state = stateCode(job);
      const location = [str(job.city), state ?? str(job.state)].filter(Boolean).join(", ") || (job.remote ? "Remote" : "");
      const period = PAY_PERIODS[str(job.pay_unit).toUpperCase()] ?? null;
      const currency = str(job.currency).toUpperCase() || "USD";
      const payMin = num(job.pay_min);
      const payMax = num(job.pay_max);
      const usdHourly = currency === "USD" && period === "hour";
      const pay = payLabel(payMin, payMax, period);
      const employment = /CONTRACT|TEMP/i.test(str(job.employment_type)) ? "Contract" : str(job.employment_type) || "Contract";
      const header = [location || null, job.remote ? "Remote" : null, employment, pay].filter(Boolean).join(" · ");
      rows.push({
        post_id: postId,
        platform: "career_site",
        post_source: "career_site",
        post_status: "open",
        posted_by_name: primeName,
        company_name: primeName,
        poster_email: "",
        post_url: job.url,
        job_title: str(job.title),
        location,
        employment_type: employment,
        salary_range: pay,
        job_description: str(job.description).slice(0, 8000),
        post_content: `${str(job.title)}\n${header}\n\n${str(job.description).slice(0, 6000)}`,
        posted_at: postedAt(job.date_posted),
        country: "US",
        job_category: "IT",
        pay_min: payMin,
        pay_max: payMax,
        pay_currency: payMin != null || payMax != null ? currency : null,
        pay_period: payMin != null || payMax != null ? period : null,
        extracted_hourly_rate_min: usdHourly ? payMin : null,
        extracted_hourly_rate_max: usdHourly ? payMax : null,
        extracted_skills: Array.isArray(result.core_skills) ? result.core_skills : [],
        extracted_experience_years: num(result.years_experience),
        extracted_visa_types: Array.isArray(result.visa_types) ? result.visa_types : [],
      });
      rowJob.set(postId, job);
    }

    let accepted = 0;
    if (rows.length > 0) {
      const { data, error } = await supabase
        .from("social_jobs")
        .upsert(rows, { onConflict: "post_id,platform", ignoreDuplicates: false })
        .select("id, post_id");
      if (error) return respond({ error: error.message }, 500);
      for (const row of data ?? []) {
        const job = rowJob.get(row.post_id as string)!;
        ledger.push({ prime: slug, source_id: job.source_id, url: job.url, status: "accepted", reason: null, social_job_id: row.id, last_seen_at: now });
      }
      accepted = data?.length ?? 0;
      const embed = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-embedding`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, Apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
        body: JSON.stringify((data ?? []).map((r) => ({ type: "job", id: r.id, table: "social_jobs" }))),
      }).catch((err) => console.error("embedding error:", err));
      (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(embed);
    }

    if (ledger.length > 0) {
      const { error } = await supabase.from("career_site_jobs").upsert(ledger, { onConflict: "prime,source_id" });
      if (error) return respond({ error: error.message }, 500);
    }
    return respond({ accepted, rejected: ledger.length - accepted });
  }

  return respond({ error: "unknown action" }, 400);
});
