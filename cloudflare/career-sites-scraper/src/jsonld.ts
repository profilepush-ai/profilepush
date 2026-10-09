import { stripHtml } from "./http";
import type { CareerJob } from "./types";

type Obj = Record<string, unknown>;

const isJobPosting = (x: unknown) => {
  const t = (x as Obj | null)?.["@type"];
  return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
};

// A JobPosting anywhere in a JSON-LD value: top level, in @graph or arrays,
// or nested under another object (Robert Half: WebPage.mainEntity).
function findJobPosting(x: unknown, depth = 0): Obj | null {
  if (!x || typeof x !== "object" || depth > 4) return null;
  if (isJobPosting(x)) return x as Obj;
  for (const v of Array.isArray(x) ? x : Object.values(x as Obj)) {
    const found = findJobPosting(v, depth + 1);
    if (found) return found;
  }
  return null;
}

// The schema.org JobPosting embedded as JSON-LD in a page, or null. When a page
// has several, the one with a location wins (Deloitte's first is internal).
export function jobPostingFromHtml(html: string): Obj | null {
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let fallback: Obj | null = null;
  for (const m of html.matchAll(re)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const found = findJobPosting(data);
    if (!found) continue;
    if (found.jobLocation) return found;
    fallback ??= found;
  }
  return fallback;
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
