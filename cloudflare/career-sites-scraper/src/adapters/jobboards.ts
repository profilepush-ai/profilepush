import { stripHtml, UA, type Budget } from "../http";
import type { Adapter, CareerJob, ListingItem } from "../types";
import { guessEmploymentType, parsePay, parseUsLocation, positive } from "../util";

// Job boards (Adzuna, Jooble): many employers per listing, read through each
// board's API with our key. Unlike a firm's own site they are never listed in
// full, so every page is marked partial and a run never closes jobs; the
// matcher only looks at the last 7 days anyway.

export type BoardKeys = { ADZUNA_APP_ID?: string; ADZUNA_APP_KEY?: string; JOOBLE_API_KEY?: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const int = (v: unknown, dflt: number, max: number) => Math.min(max, Math.max(1, Math.round(Number(v) || dflt)));

// Licensed APIs: no robots.txt check, but still counted against the budget.
async function apiFetch(url: string, budget: Budget, init: RequestInit = {}): Promise<Response> {
  if (!budget.take()) throw new Error("subrequest budget exhausted");
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res;
}

function withPay(job: CareerJob, text: string): CareerJob {
  if (job.pay_min == null) {
    const pay = parsePay(text);
    if (pay.min != null) Object.assign(job, { pay_min: pay.min, pay_max: pay.max, pay_unit: pay.unit, currency: "USD" });
  }
  return job;
}

// Adzuna US search, newest first. config: { what?, what_exclude?, category?
// (default it-jobs), max_days_old? (default 3), pages? (default 3) }.
// The free key allows a few hundred calls a day: 3 pages an hour fits.
export function adzuna(slug: string, cfg: Record<string, unknown>, keys: BoardKeys): Adapter {
  return {
    slug,
    alwaysComplete: false,
    async *list(budget: Budget) {
      if (!keys.ADZUNA_APP_ID || !keys.ADZUNA_APP_KEY) throw new Error("ADZUNA_APP_ID / ADZUNA_APP_KEY not set");
      const pages = int(cfg.pages, 3, 10);
      for (let page = 1; page <= pages; page++) {
        const q = new URLSearchParams({
          app_id: keys.ADZUNA_APP_ID, app_key: keys.ADZUNA_APP_KEY,
          results_per_page: "50", sort_by: "date", contract: "1",
          max_days_old: String(int(cfg.max_days_old, 3, 30)),
          category: str(cfg.category) || "it-jobs",
        });
        if (str(cfg.what)) q.set("what", str(cfg.what));
        if (str(cfg.what_exclude)) q.set("what_exclude", str(cfg.what_exclude));
        const d = await (await apiFetch(`https://api.adzuna.com/v1/api/jobs/us/search/${page}?${q}`, budget)).json() as { count?: number; results?: Array<Record<string, unknown>> };
        const items: ListingItem[] = [];
        for (const j of d.results ?? []) {
          const area = Array.isArray((j.location as Record<string, unknown>)?.area) ? (j.location as { area: unknown[] }).area.map(str) : [];
          const title = stripHtml(str(j.title));
          const description = stripHtml(str(j.description));
          // area: ["US", state, county, city]
          const state = area[1] || null;
          const city = area[3] || (area.length === 3 ? area[2] : null) || null;
          const predicted = str(j.salary_is_predicted) === "1";
          const lo = predicted ? null : positive(j.salary_min);
          const hi = predicted ? null : positive(j.salary_max);
          const job: CareerJob = {
            source_id: str(j.id),
            url: str(j.redirect_url),
            title,
            company: str((j.company as Record<string, unknown>)?.display_name) || null,
            via: "Adzuna",
            city, state, country: "US",
            remote: /\bremote\b/i.test(`${title} ${description}`),
            employment_type: str(j.contract_type) === "permanent" ? "FULL_TIME" : "CONTRACTOR",
            date_posted: str(j.created).slice(0, 10) || null,
            pay_min: lo, pay_max: hi ?? lo,
            pay_unit: lo == null ? null : lo < 500 ? "HOUR" : "YEAR",
            currency: lo == null ? null : "USD",
            description,
          };
          if (!job.source_id || !job.url || !job.title) continue;
          items.push({ id: job.source_id, url: job.url, title, job: withPay(job, description) });
        }
        yield { items, partial: true, total: d.count };
        if ((d.results ?? []).length < 50) return;
      }
    },
  };
}

// Jooble search, newest first. config: { keywords (default "contract"),
// location (default "USA"), host (default jooble.org), days? (default 3),
// pages? (default 3) }.
export function jooble(slug: string, cfg: Record<string, unknown>, keys: BoardKeys): Adapter {
  return {
    slug,
    alwaysComplete: false,
    async *list(budget: Budget) {
      if (!keys.JOOBLE_API_KEY) throw new Error("JOOBLE_API_KEY not set");
      const host = str(cfg.host) || "jooble.org";
      const pages = int(cfg.pages, 3, 10);
      const since = new Date(Date.now() - int(cfg.days, 3, 30) * 86_400_000).toISOString().slice(0, 10);
      for (let page = 1; page <= pages; page++) {
        const res = await apiFetch(`https://${host}/api/${encodeURIComponent(keys.JOOBLE_API_KEY)}`, budget, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keywords: str(cfg.keywords) || "contract",
            location: str(cfg.location) || "USA",
            page: String(page),
            ResultOnPage: "50",
            datecreatedfrom: since,
          }),
        });
        const d = await res.json() as { totalCount?: number; jobs?: Array<Record<string, unknown>> };
        const items: ListingItem[] = [];
        for (const j of d.jobs ?? []) {
          const loc = parseUsLocation(str(j.location));
          if (loc.nonUs) continue;
          const title = stripHtml(str(j.title));
          const description = stripHtml(str(j.snippet));
          const type = str(j.type);
          const job: CareerJob = {
            source_id: str(j.id),
            url: str(j.link),
            title,
            company: str(j.company) || null,
            via: "Jooble",
            city: loc.city, state: loc.state, country: loc.country ?? "US", remote: loc.remote || /\bremote\b/i.test(title),
            employment_type: /contract|temp/i.test(type) ? "CONTRACTOR" : /full|perm/i.test(type) ? "FULL_TIME" : guessEmploymentType(`${title} ${description}`),
            date_posted: str(j.updated).slice(0, 10) || null,
            description,
          };
          if (!job.source_id || !job.url || !job.title) continue;
          items.push({ id: job.source_id, url: job.url, title, job: withPay(job, `${str(j.salary)} ${description}`) });
        }
        yield { items, partial: true, total: d.totalCount };
        if ((d.jobs ?? []).length < 50) return;
      }
    },
  };
}
