import { politeFetch, stripHtml, type Budget } from "../http";
import type { Adapter, CareerJob, ListingItem } from "../types";
import { US_STATES, positive } from "../util";

// The same-origin JSON API the /jobs app calls for anonymous visitors:
//   /all/jobs?page=N&size=50&sort=postedDate,desc   listing (newest first)
//   /all/jobs/{requisitionId}                        description
// No country field: India/Canada jobs are dropped by state, title and city.
const BASE = "https://insightglobal.com/all/jobs";
const HEADERS = { Accept: "application/json" };
const NON_US_CITY = /chennai|coimbatore|madurai|panaji|goa|bangal|bengal|hyderabad|pune|mumbai|delhi|noida|gurgaon|gurugram|kolkata|toronto|vancouver|montreal|mexico|manila/i;
const UNIT: Record<string, string> = { Hourly: "HOUR", Annually: "YEAR", Weekly: "WEEK", Monthly: "MONTH", Daily: "DAY" };

type Listing = Record<string, unknown> & { requisitionId: string; jobTitle?: string; workAddress?: Record<string, string> };

function isUs(j: Listing): boolean {
  const a = j.workAddress ?? {};
  return US_STATES.has((a.administrativeArea ?? "").toUpperCase())
    && !/\bINTL\b|\bIndia\b|\bCanada\b/.test(j.jobTitle ?? "")
    && !NON_US_CITY.test(a.locality ?? "");
}

export const insightglobal: Adapter = {
  slug: "insightglobal",
  alwaysComplete: false,
  async *list(budget: Budget) {
    for (let page = 1; page <= 200; page++) {
      const res = await politeFetch(`${BASE}?page=${page}&size=50&sort=postedDate,desc`, budget, { headers: HEADERS });
      const d = await res.json() as { jobs?: Listing[]; pageMetadata?: { totalPages?: number } };
      const jobs = d.jobs ?? [];
      if (jobs.length === 0) return;
      const items: ListingItem[] = jobs.filter(isUs).map((j) => ({
        id: String(j.requisitionId),
        url: `https://insightglobal.com/jobs/search/all/all?jobId=${j.requisitionId}`,
        title: String(j.jobTitle ?? "").trim(),
        extra: j,
      }));
      yield { items };
      if (page >= (d.pageMetadata?.totalPages ?? 0)) return;
    }
  },
  async detail(item, budget): Promise<CareerJob> {
    const listing = item.extra as Listing;
    const d = await (await politeFetch(`${BASE}/${item.id}`, budget, { headers: HEADERS })).json() as Record<string, unknown>;
    // The listing wins: the single-job endpoint reports "Contract" for every job.
    const j = { ...d, ...listing } as Record<string, unknown>;
    const a = (j.workAddress ?? {}) as Record<string, string>;
    const pr = (j.payRate ?? {}) as Record<string, unknown>;
    const min = positive(pr.min);
    const max = positive(pr.max);
    return {
      source_id: item.id,
      url: item.url,
      title: String(j.jobTitle ?? "").trim(),
      city: a.locality ?? null,
      state: (a.administrativeArea ?? "").toUpperCase() || null,
      country: "US",
      remote: Boolean(j.workRemote),
      employment_type: (j.jobType as string) ?? null,
      date_posted: String(j.postedDate ?? "").slice(0, 10) || null,
      pay_min: min,
      pay_max: max,
      pay_unit: UNIT[String(pr.type)] ?? ((pr.type as string) || null),
      currency: min || max ? ((pr.currency as string) ?? "USD") : null,
      description: stripHtml(j.descriptionHtml as string).slice(0, 8000),
    };
  },
};
