import { politeFetch, stripHtml, type Budget } from "../http";
import type { Adapter, CareerJob, ListingItem } from "../types";
import { guessEmploymentType, parsePay, parseUsLocation, ymd } from "../util";

// JobDiva public candidate portals (www2.jobdiva.com/portal/?a=...). We make
// the calls the portal's own script makes: an anonymous guest token (auth/a,
// with the static header from the public bundle; no user credentials), the
// job list (listall + getmore, 200 at a time) and job details.
const BASE = "https://ws.jobdiva.com/candPortal/rest/";
const GUEST = "Basic YXhlbG9uOmF4ZWxvbg==";
const PAGE = 200;

type Job = Record<string, unknown> & { id: number | string; title?: string; postDate?: number };
type Session = Record<string, string>;

async function session(a: string, budget: Budget): Promise<Session> {
  const res = await politeFetch(`${BASE}auth/a`, budget, { headers: { Authorization: GUEST, portalID: "1", a, compid: "0" } });
  const t = await res.json() as { portalID: number | string; token: string };
  return { portalID: String(t.portalID), token: t.token, a };
}

function toJob(slug: string, a: string, j: Job, d: Record<string, unknown> | null): CareerJob | null {
  const det = d ?? {};
  const ml = (det.mainLocation ?? {}) as Record<string, string>;
  const locText = (j.location as string) || [ml.city, ml.state].filter(Boolean).join(", ");
  let loc = parseUsLocation(locText);
  if (ml.state && !loc.state) {
    const fromState = parseUsLocation(ml.state);
    loc = { ...fromState, city: loc.city ?? ml.city ?? null };
  }
  const mlCountry = (ml.country ?? "").toUpperCase();
  if (loc.nonUs || !["", "US", "USA", "UNITED STATES"].includes(mlCountry)) return null;
  const desc = stripHtml((det.jobDescription ?? j.jobDescription ?? "") as string).replace(/\r/g, "").slice(0, 8000);
  let remote = loc.remote || /location\s*[:-]+\s*(?:100%\s*)?remote/i.test(desc.slice(0, 600)) || det.workingRemote === 1 || j.workingRemote === 1;
  const rate = (det.payRate ?? j.payRate) as string | undefined;
  const freq = (det.payFrequency ?? j.payFrequency) as string | undefined;
  let pay = rate ? parsePay(`pay ${rate}${freq ? ` per ${freq}` : ""}`) : { min: null, max: null, unit: null };
  if (pay.min == null) pay = parsePay(desc);
  return {
    source_id: String(j.id),
    url: `https://www2.jobdiva.com/portal/?a=${a}&compid=0#/jobs/${j.id}`,
    title: String(j.title ?? "").trim(),
    city: loc.city,
    state: loc.state,
    country: loc.country ?? (loc.state ? "US" : null),
    remote: Boolean(remote),
    employment_type: ((det.positionType ?? j.positionType) as string) || guessEmploymentType(desc),
    date_posted: ymd((j.postDate ?? det.postDate) as number),
    pay_min: pay.min,
    pay_max: pay.max,
    pay_unit: pay.unit,
    currency: pay.min != null ? "USD" : null,
    description: desc,
  };
}

export function jobdivaAdapter(slug: string, portalKey: string): Adapter {
  let sess: Session | null = null;
  return {
    slug,
    // The whole list is ~6-15 requests, so every run reads all of it.
    alwaysComplete: true,
    async *list(budget: Budget) {
      sess = await session(portalKey, budget);
      const first = await (await politeFetch(`${BASE}job/listall?portaltype=1&count=${PAGE}`, budget, { headers: sess })).json() as { total: number; data: Job[] };
      const jobs: Job[] = [...first.data];
      const getMore = async (lo: number, hi: number) => {
        const r = await (await politeFetch(`${BASE}job/getmore?from=${lo}&to=${hi}&count=${first.total}&portaltype=1`, budget, { headers: sess! })).json() as { data?: Job[] };
        return r.data ?? [];
      };
      let partial = false;
      for (let lo = PAGE + 1; lo <= first.total; lo += PAGE) {
        const hi = Math.min(lo + PAGE - 1, first.total);
        try {
          jobs.push(...await getMore(lo, hi));
        } catch {
          // One bad record makes its whole range fail (HTTP 400): retry the
          // range in small chunks and skip only the chunk that still fails.
          for (let a2 = lo; a2 <= hi; a2 += 20) {
            try {
              jobs.push(...await getMore(a2, Math.min(a2 + 19, hi)));
            } catch {
              partial = true;
            }
          }
        }
      }
      jobs.sort((x, y) => Number(y.postDate ?? 0) - Number(x.postDate ?? 0));
      const items: ListingItem[] = jobs.map((j) => ({
        id: String(j.id),
        url: `https://www2.jobdiva.com/portal/?a=${portalKey}&compid=0#/jobs/${j.id}`,
        title: String(j.title ?? "").trim(),
        extra: j,
      }));
      yield { items, partial };
    },
    async detail(item, budget) {
      const j = item.extra as Job;
      let d: Record<string, unknown> | null = null;
      try {
        sess ??= await session(portalKey, budget);
        const r = await (await politeFetch(`${BASE}job/getdetailbyjobid/${item.id}?compid=0`, budget, { headers: sess })).json() as { job?: Record<string, unknown> };
        d = r.job ?? null;
      } catch {
        // Some detail pages 404; the listing description is used instead.
      }
      return toJob(slug, portalKey, j, d) ?? { source_id: item.id, url: item.url, title: String(j.title ?? ""), country: "non-US" };
    },
  };
}

export const diverselynx = jobdivaAdapter("diverselynx", "9xjdnw687b7a7nvvdyut936kpjlgy0023blrozaecads0pdnwppcswnaaku8ji2g");
export const mindlance = jobdivaAdapter("mindlance", "7fjdnw91pq69jlvngz1gp518iugamw00c66623tmx447r7e3lkr3gqqpqjhpy8mo");
