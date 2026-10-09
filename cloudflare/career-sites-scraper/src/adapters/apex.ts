import { politeFetch, stripHtml, type Budget } from "../http";
import { jobPostingFromHtml, normalizeJobPosting } from "../jsonld";
import type { Adapter, CareerJob, ListingItem } from "../types";
import { CA_PROVINCES, guessEmploymentType, parsePay } from "../util";

// /search-results-usa (server-rendered table, newest first; rows= is honoured,
// page= needs a session) -> each /job/<id>_usa/ page's JSON-LD JobPosting.
// The sitemap's job URLs are stale, so the search listing is the source.
const HOST = "https://www.apexsystems.com";
const ROW_RE = /<tr[^>]*>\s*<td><a href="(\/job\/[^"]+)"[^>]*job-title-link">([\s\S]*?)<\/a><\/td>\s*<td[^>]*><a[^>]*>([\s\S]*?)<\/a><\/td>\s*<td[^>]*><a[^>]*>([\s\S]*?)<\/a><\/td>\s*<td><a[^>]*>([\s\S]*?)<\/a><\/td>/g;

type Extra = { title: string; city: string | null; state: string | null; date_posted: string | null };

function mdy(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

export const apex: Adapter = {
  slug: "apex",
  // The whole list is one request, so every run reads all of it.
  alwaysComplete: true,
  async *list(budget: Budget) {
    const rows = 5000;
    const url = `${HOST}/search-results-usa?keyword=&location=&remote=&sort=lastposteddesc&rows=${rows}&page=1`;
    const html = await (await politeFetch(url, budget)).text();
    const items: ListingItem[] = [];
    const seen = new Set<string>();
    for (const m of html.matchAll(ROW_RE)) {
      const id = m[1].match(/\/job\/(\d+)_/)?.[1];
      if (!id || seen.has(id)) continue;
      const state = stripHtml(m[4]) || null;
      if (state && CA_PROVINCES.has(state.toUpperCase())) continue;
      seen.add(id);
      const extra: Extra = { title: stripHtml(m[2]), city: stripHtml(m[3]) || null, state, date_posted: mdy(stripHtml(m[5])) };
      items.push({ id, url: HOST + m[1], title: extra.title, extra });
    }
    yield { items };
  },
  async detail(item, budget) {
    const extra = item.extra as Extra;
    const jp = jobPostingFromHtml(await (await politeFetch(item.url, budget)).text());
    const job: CareerJob = jp
      ? normalizeJobPosting(item.id, item.url, jp)
      : { source_id: item.id, url: item.url, title: extra.title, city: extra.city, state: extra.state, country: "US", description: "" };
    const country = (job.country ?? "US").toUpperCase();
    if (!["US", "USA"].includes(country)) return { ...job, country };
    job.country = "US";
    job.city ??= extra.city;
    job.state ??= extra.state;
    job.date_posted ??= extra.date_posted;
    const desc = (job.description ?? "").replace(/\\n/g, "\n");
    job.description = desc;
    if (/\bremote\b/i.test(`${job.title} ${job.city ?? ""}`) || /location\s*:\s*(?:100%\s*)?remote/i.test(desc.slice(0, 600))) job.remote = true;
    if (job.pay_min == null) {
      const pay = parsePay(desc);
      if (pay.min != null) Object.assign(job, { pay_min: pay.min, pay_max: pay.max, pay_unit: pay.unit, currency: "USD" });
    }
    job.employment_type ||= guessEmploymentType(desc);
    return job;
  },
};
