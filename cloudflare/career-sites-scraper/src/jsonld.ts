import { stripHtml } from "./http";
import type { CareerJob } from "./types";

type Obj = Record<string, unknown>;

// First schema.org JobPosting embedded as JSON-LD in a page, or null.
export function jobPostingFromHtml(html: string): Obj | null {
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const items = Array.isArray(data) ? data : (data as Obj)?.["@graph"] ?? [data];
    for (const x of items as Obj[]) {
      const t = x?.["@type"];
      if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) return x;
    }
  }
  return null;
}

const first = <T>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);
const toNum = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function normalizeJobPosting(id: string, url: string, jp: Obj): CareerJob {
  const loc = (first(jp.jobLocation as Obj | Obj[]) ?? {}) as Obj;
  const addr = (loc.address ?? {}) as Obj;
  const sal = (jp.baseSalary ?? {}) as Obj;
  const val = (typeof sal.value === "object" && sal.value ? sal.value : { value: sal.value }) as Obj;
  const et = jp.employmentType;
  const country = addr.addressCountry;
  return {
    source_id: id,
    url,
    title: stripHtml(String(jp.title ?? "")),
    city: (addr.addressLocality as string) ?? null,
    state: (addr.addressRegion as string) ?? null,
    country: typeof country === "string" ? country : ((country as Obj)?.name as string) ?? null,
    remote: jp.jobLocationType === "TELECOMMUTE",
    employment_type: Array.isArray(et) ? et.join(",") : ((et as string) ?? null),
    date_posted: String(jp.datePosted ?? "").slice(0, 10) || null,
    pay_min: toNum(val.minValue ?? val.value),
    pay_max: toNum(val.maxValue ?? val.value),
    pay_unit: (val.unitText as string) ?? null,
    currency: (sal.currency as string) ?? null,
    description: stripHtml(String(jp.description ?? "")).slice(0, 8000),
  };
}
