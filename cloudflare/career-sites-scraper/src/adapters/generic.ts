import { politeFetch, stripHtml, type Budget } from "../http";
import { jobPostingFromHtml, normalizeJobPosting } from "../jsonld";
import type { Adapter, CareerJob, ListingItem } from "../types";
import { guessEmploymentType, parsePay, parseUsLocation, positive } from "../util";
import { jobdivaAdapter } from "./jobdiva";
import { adzuna, jooble, type BoardKeys } from "./jobboards";

// Adapters configured from /admin (career_sites.kind + config), no code needed.

export type SiteConfig = { slug: string; kind: string; config: Record<string, unknown> };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
// <loc> values, plain or wrapped in CDATA (Hays).
const locs = (xml: string) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)\s*(?:\]\]>)?\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));

function withTextFields(job: CareerJob): CareerJob {
  const desc = job.description ?? "";
  if (job.pay_min == null) {
    const pay = parsePay(desc);
    if (pay.min != null) Object.assign(job, { pay_min: pay.min, pay_max: pay.max, pay_unit: pay.unit, currency: "USD" });
  }
  job.employment_type ||= guessEmploymentType(desc);
  return job;
}

// Short, fixed-length id for a job page path (long paths in lookups made the
// request URL too long, and commas in them broke it).
async function pathId(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

// Job sitemap (or sitemap index) -> pages whose URL contains `url_contains`
// -> schema.org JobPosting on each page. The last path segment is used as the
// title for triage when it reads like one.
export function sitemapJsonld(slug: string, cfg: Record<string, unknown>): Adapter {
  const sitemap = str(cfg.sitemap_url);
  const contains = str(cfg.url_contains) || "/job";
  return {
    slug,
    alwaysComplete: true,
    async *list(budget: Budget) {
      const urls: string[] = [];
      const first = await (await politeFetch(sitemap, budget)).text();
      const top = locs(first);
      if (/<sitemapindex/i.test(first)) {
        for (const child of top.slice(0, 30)) urls.push(...locs(await (await politeFetch(child, budget)).text()));
      } else {
        urls.push(...top);
      }
      const items: ListingItem[] = [];
      const seen = new Set<string>();
      for (const url of urls) {
        if (!url.includes(contains)) continue;
        const path = new URL(url).pathname.replace(/\/+$/, "");
        const id = await pathId(path.slice(-120));
        if (seen.has(id)) continue;
        seen.add(id);
        const last = decodeURIComponent(path.split("/").pop() ?? "");
        const title = /[a-z]{3}/i.test(last) ? last.replace(/[-_]+/g, " ").replace(/\b\d{4,}\b/g, "").trim() : undefined;
        items.push({ id, url, title: title || undefined });
      }
      yield { items };
    },
    async detail(item, budget) {
      const jp = jobPostingFromHtml(await (await politeFetch(item.url, budget)).text());
      return jp ? withTextFields(normalizeJobPosting(item.id, item.url, jp)) : null;
    },
  };
}

// Greenhouse public job board API: one request returns every job with content.
export function greenhouse(slug: string, cfg: Record<string, unknown>): Adapter {
  const board = str(cfg.board);
  return {
    slug,
    alwaysComplete: true,
    async *list(budget: Budget) {
      const d = await (await politeFetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`, budget)).json() as { jobs?: Array<Record<string, unknown>> };
      const items: ListingItem[] = [];
      for (const j of d.jobs ?? []) {
        const loc = parseUsLocation(str((j.location as Record<string, unknown>)?.name));
        if (loc.nonUs) continue;
        const job = withTextFields({
          source_id: String(j.id),
          url: str(j.absolute_url),
          title: str(j.title),
          city: loc.city, state: loc.state, country: loc.country, remote: loc.remote,
          employment_type: null,
          date_posted: str(j.first_published ?? j.updated_at).slice(0, 10) || null,
          description: stripHtml(str(j.content)).slice(0, 8000),
        });
        items.push({ id: job.source_id, url: job.url, job });
      }
      yield { items };
    },
  };
}

// Lever public postings API: one request returns every posting.
export function lever(slug: string, cfg: Record<string, unknown>): Adapter {
  const company = str(cfg.company);
  const UNIT: Record<string, string> = { "per-hour-wage": "HOUR", "per-year-salary": "YEAR", "per-month-salary": "MONTH", "per-day-wage": "DAY", "per-week-salary": "WEEK" };
  return {
    slug,
    alwaysComplete: true,
    async *list(budget: Budget) {
      const d = await (await politeFetch(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`, budget)).json() as Array<Record<string, unknown>>;
      const items: ListingItem[] = [];
      for (const p of Array.isArray(d) ? d : []) {
        const cat = (p.categories ?? {}) as Record<string, string>;
        const loc = parseUsLocation(cat.location ?? "");
        if (loc.nonUs) continue;
        const sal = (p.salaryRange ?? {}) as Record<string, unknown>;
        const job = withTextFields({
          source_id: str(p.id),
          url: str(p.hostedUrl),
          title: str(p.text),
          city: loc.city, state: loc.state, country: loc.country,
          remote: loc.remote || p.workplaceType === "remote",
          employment_type: cat.commitment || null,
          date_posted: p.createdAt ? new Date(Number(p.createdAt)).toISOString().slice(0, 10) : null,
          pay_min: positive(sal.min), pay_max: positive(sal.max),
          pay_unit: UNIT[str(sal.interval)] ?? null, currency: str(sal.currency) || null,
          description: str(p.descriptionPlain).slice(0, 8000),
        });
        items.push({ id: job.source_id, url: job.url, job });
      }
      yield { items };
    },
  };
}

// Workday career site (https://<tenant>.wdN.myworkdayjobs.com/<lang>/<site>):
// the public JSON the site itself calls. Newest first, 20 per page.
export function workday(slug: string, cfg: Record<string, unknown>): Adapter {
  const u = new URL(str(cfg.url));
  const tenant = u.hostname.split(".")[0];
  const parts = u.pathname.split("/").filter(Boolean);
  const site = parts.find((p) => !/^[a-z]{2}-[A-Z]{2}$/.test(p)) ?? "";
  const api = `https://${u.hostname}/wday/cxs/${tenant}/${site}`;
  return {
    slug,
    alwaysComplete: false,
    async *list(budget: Budget, full: boolean) {
      for (let offset = 0; offset < (full ? 5000 : 2000); offset += 20) {
        const res = await politeFetch(`${api}/jobs`, budget, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: "" }),
        });
        const d = await res.json() as { total?: number; jobPostings?: Array<Record<string, unknown>> };
        const posts = d.jobPostings ?? [];
        if (posts.length === 0) return;
        yield {
          items: posts.map((p) => ({
            id: str(p.externalPath).split("/").pop() || str(p.externalPath),
            url: `https://${u.hostname}${u.pathname.replace(/\/+$/, "")}${str(p.externalPath)}`,
            title: str(p.title),
            extra: p,
          })),
          total: d.total,
        };
        if (offset + posts.length >= (d.total ?? 0)) return;
      }
    },
    async detail(item, budget) {
      const p = item.extra as Record<string, unknown>;
      const d = await (await politeFetch(`${api}${str(p.externalPath)}`, budget, { headers: { Accept: "application/json" } })).json() as { jobPostingInfo?: Record<string, unknown> };
      const info = d.jobPostingInfo ?? {};
      const country = str((info.country as Record<string, unknown>)?.descriptor);
      const loc = parseUsLocation(str(info.location) || str(p.locationsText));
      return withTextFields({
        source_id: item.id,
        url: str(info.externalUrl) || item.url,
        title: str(info.title) || str(p.title),
        city: loc.city, state: loc.state,
        country: country ? (/united states/i.test(country) ? "US" : country) : loc.country,
        remote: loc.remote,
        employment_type: str(info.timeType) || null,
        date_posted: str(info.startDate).slice(0, 10) || null,
        description: stripHtml(str(info.jobDescription)).slice(0, 8000),
      });
    },
  };
}

export function buildAdapter(site: SiteConfig, builtins: Record<string, Adapter>, keys: BoardKeys = {}): Adapter {
  const cfg = site.config ?? {};
  switch (site.kind) {
    case "builtin": {
      const a = builtins[site.slug];
      if (!a) throw new Error(`no built-in adapter for ${site.slug}`);
      return a;
    }
    case "sitemap_jsonld": return sitemapJsonld(site.slug, cfg);
    case "jobdiva": return jobdivaAdapter(site.slug, str(cfg.portal_key));
    case "greenhouse": return greenhouse(site.slug, cfg);
    case "lever": return lever(site.slug, cfg);
    case "workday": return workday(site.slug, cfg);
    case "adzuna": return adzuna(site.slug, cfg, keys);
    case "jooble": return jooble(site.slug, cfg, keys);
    default: throw new Error(`unknown kind ${site.kind}`);
  }
}
