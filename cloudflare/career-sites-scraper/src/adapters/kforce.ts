import { politeFetch, stripHtml, type Budget } from "../http";
import type { Adapter, CareerJob } from "../types";
import { US_STATES, positive } from "../util";

// The search index kforce.com/find-work/search-jobs/ queries from the browser,
// with the public query key shipped in the site's script. Newest first.
const URL_ = "https://kforcewebeast.search.windows.net/indexes/kforcewebjobentity/docs/search?api-version=2016-09-01";
const KEY = "1603E4DC4C87A8E41D6BBDE4EEA4EFB7";
const UNITS: Record<string, string> = { hours: "HOUR", hour: "HOUR", years: "YEAR", year: "YEAR", weeks: "WEEK", months: "MONTH", days: "DAY" };

type Doc = Record<string, unknown> & { Id: string };

function toJob(j: Doc): CareerJob {
  const desc = [stripHtml((j.ResponsibilitiesHtml ?? j.Responsibilities) as string), stripHtml((j.SkillsHtml ?? j.Skills) as string)]
    .filter(Boolean).join("\n\n");
  const min = positive(j.SalaryMin);
  const max = positive(j.SalaryMax);
  const unitText = String(j.SalaryText ?? "").trim().toLowerCase();
  return {
    source_id: String(j.ReferenceCode ?? j.Id),
    url: `https://www.kforce.com/find-work/search-jobs/#/detail/${j.Id}/`,
    title: String(j.Title ?? "").trim(),
    city: (j.City as string) || null,
    state: (j.State as string) || null,
    country: "US",
    remote: j.Remote === "Full",
    employment_type: (j.TypeCode as string) || null,
    date_posted: String(j.PostDate ?? "").slice(0, 10) || null,
    pay_min: min,
    pay_max: max,
    pay_unit: min || max ? UNITS[unitText] ?? (unitText || null) : null,
    currency: min || max ? "USD" : null,
    description: desc.slice(0, 8000),
  };
}

export const kforce: Adapter = {
  slug: "kforce",
  alwaysComplete: false,
  async *list(budget: Budget, full: boolean) {
    const top = full ? 1000 : 100;
    for (let skip = 0; skip < 6000; skip += top) {
      const res = await politeFetch(URL_, budget, {
        method: "POST",
        headers: { "api-key": KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ search: "*", count: true, orderby: "PostDate desc", skip, top }),
      });
      const d = await res.json() as { value?: Doc[]; "@odata.count"?: number };
      const docs = d.value ?? [];
      if (docs.length === 0) return;
      const items = docs
        .filter((j) => US_STATES.has(String(j.State ?? "").toUpperCase()))
        .map((j) => { const job = toJob(j); return { id: job.source_id, url: job.url, job }; });
      yield { items, total: d["@odata.count"] };
      if (skip + docs.length >= (d["@odata.count"] ?? 0)) return;
    }
  },
};
