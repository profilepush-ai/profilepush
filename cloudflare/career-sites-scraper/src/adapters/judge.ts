import { politeFetch, stripHtml, type Budget } from "../http";
import type { Adapter, CareerJob } from "../types";

// The JSON endpoint judge.com/jobs calls (robots.txt allows admin-ajax.php).
// 20 jobs per page, newest first, full descriptions included.
const URL_ = "https://www.judge.com/wp-admin/admin-ajax.php?action=jdg_get_jobs";
const UNITS: Record<string, string> = { hourly: "HOUR", annually: "YEAR", yearly: "YEAR", weekly: "WEEK", monthly: "MONTH", daily: "DAY" };

type Hit = { jobOrderId: number; title?: string; location?: string; type?: string; opened?: number; salary?: string; description?: string; remote?: boolean };

async function page(n: number, budget: Budget): Promise<{ hits: Hit[]; total: number }> {
  const payload = {
    categories: [], countries: "USA", geo: [{ distance: "", latLong: [0], location: "" }],
    query: "", states: "", type: ["Any"], page: n, remote: false,
  };
  const res = await politeFetch(URL_, budget, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  // The endpoint returns a JSON string that itself contains JSON.
  let data: unknown = await res.json();
  if (typeof data === "string") data = JSON.parse(data);
  const d = data as { hits?: Hit[]; total?: number };
  return { hits: d.hits ?? [], total: d.total ?? 0 };
}

function salary(s: string | undefined) {
  // " $30.00 USD Hourly - $33.02 USD Hourly"  /  " $120,000.00 USD Annually"
  const parts = [...(s ?? "").matchAll(/\$?\s*([\d,]+(?:\.\d+)?)\s*([A-Z]{3})?\s*([A-Za-z]+)?/g)]
    .map((m) => ({ v: Number(m[1].replace(/,/g, "")), cur: m[2], unit: m[3] }))
    .filter((p) => p.v > 0);
  if (parts.length === 0) return { min: null, max: null, unit: null, cur: null };
  const unitWord = parts.find((p) => p.unit)?.unit?.toLowerCase();
  return { min: parts[0].v, max: parts[parts.length - 1].v, unit: unitWord ? UNITS[unitWord] ?? null : null, cur: parts.find((p) => p.cur)?.cur ?? "USD" };
}

function toJob(h: Hit): CareerJob {
  const loc = (h.location ?? "").trim();
  const i = loc.lastIndexOf(",");
  const pay = salary(h.salary);
  return {
    source_id: String(h.jobOrderId),
    url: `https://www.judge.com/jobs/details/${h.jobOrderId}/`,
    title: (h.title ?? "").trim(),
    city: i > 0 ? loc.slice(0, i).trim() : loc || null,
    state: i > 0 ? loc.slice(i + 1).trim() : null,
    country: "US",
    remote: /remote/i.test(loc),
    employment_type: h.type ?? null,
    date_posted: h.opened ? new Date(h.opened).toISOString().slice(0, 10) : null,
    pay_min: pay.min,
    pay_max: pay.max,
    pay_unit: pay.unit,
    currency: pay.cur,
    description: stripHtml(h.description).slice(0, 8000),
  };
}

export const judge: Adapter = {
  slug: "judge",
  alwaysComplete: false,
  async *list(budget: Budget) {
    let seen = 0;
    for (let n = 0; n < 300; n++) {
      const { hits, total } = await page(n, budget);
      if (hits.length === 0) return;
      yield { items: hits.map((h) => { const job = toJob(h); return { id: job.source_id, url: job.url, job }; }), total };
      seen += hits.length;
      if (seen >= total) return;
    }
  },
};
