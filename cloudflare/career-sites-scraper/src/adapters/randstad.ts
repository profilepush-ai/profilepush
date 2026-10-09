import { politeFetch, stripHtml, type Budget } from "../http";
import type { Adapter, CareerJob } from "../types";
import { US_STATES, US_STATE_NAMES, readJsonObject, ymd } from "../util";

// /jobs/page-N/ embeds window.__ROUTE_DATA__ with 30 full records per page,
// newest first. robots.txt wildcards (/jobs/*,*/, /jobs/mvp/) are honoured by politeFetch.
const BASE = "https://www.randstadusa.com/jobs/";
const UNITS: Record<string, string> = { "per hour": "HOUR", "per year": "YEAR", "per annum": "YEAR", "per week": "WEEK", "per month": "MONTH", "per day": "DAY" };
const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATE_NAMES).map(([k, v]) => [v.toLowerCase(), k]));

type Hit = Record<string, unknown>;

async function page(n: number, budget: Budget): Promise<{ hits: Hit[]; totalSize: number }> {
  const html = await (await politeFetch(n === 1 ? BASE : `${BASE}page-${n}/`, budget)).text();
  const marker = "window.__ROUTE_DATA__ = ";
  const i = html.indexOf(marker);
  if (i < 0) throw new Error("route data not found");
  const data = readJsonObject(html, i + marker.length) as { searchResults: { hits: Hit[]; totalSize: number } };
  return data.searchResults;
}

function toJob(x: Hit): CareerJob {
  const loc = (x.jobLocation ?? {}) as Record<string, string>;
  const st = loc.stateAbbreviation || STATE_BY_NAME[(loc.state ?? "").toLowerCase()] || loc.state || null;
  const sal = (x.salary ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const p of [x.summary, ...((x.responsibilities as unknown[]) ?? []), ...((x.qualifications as unknown[]) ?? []), ...((x.skills as unknown[]) ?? [])]) {
    const t = typeof p === "string" ? stripHtml(p) : "";
    if (t && !parts.includes(t)) parts.push(t);
  }
  const lo = (sal.min ?? sal.fixed ?? null) as number | null;
  const hi = (sal.max ?? sal.fixed ?? null) as number | null;
  return {
    source_id: String(x.atsReference ?? x.id),
    url: String(x.detailsUrl),
    title: String(x.title ?? "").trim(),
    city: loc.city ?? null,
    state: st,
    country: st && US_STATES.has(st) ? "US" : null,
    remote: Boolean(x.isRemote),
    // `type` is contract/perm (Temporary, Contract, Temp to Perm, Permanent).
    employment_type: [x.type, x.employmentType].filter(Boolean).join(", ") || null,
    date_posted: ymd(x.createdDate as number),
    pay_min: lo,
    pay_max: hi,
    pay_unit: UNITS[String(sal.type ?? "").toLowerCase()] ?? ((sal.type as string) || null),
    currency: lo != null ? ((sal.currency as string) ?? "USD") : null,
    description: (parts.join("\n") || stripHtml(x.description as string)).slice(0, 8000),
  };
}

export const randstad: Adapter = {
  slug: "randstad",
  alwaysComplete: false,
  async *list(budget: Budget) {
    const first = await page(1, budget);
    const perPage = first.hits.length || 30;
    const pages = Math.ceil(first.totalSize / perPage);
    for (let n = 1; n <= Math.min(pages, 250); n++) {
      const hits = n === 1 ? first.hits : (await page(n, budget)).hits;
      if (hits.length === 0) return;
      const items = hits.map(toJob)
        .filter((j) => j.country === "US" && j.url)
        .map((job) => ({ id: job.source_id, url: job.url, job }));
      yield { items };
    }
  },
};
