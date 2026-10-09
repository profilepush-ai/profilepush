import { politeFetch, stripHtml, type Budget } from "../http";
import type { Adapter, CareerJob } from "../types";
import { US_STATES, positive } from "../util";

// pyramidci.com careers -> Sprockets job board. The board's own public GraphQL
// query, newest first, 200 per page.
const API = "https://production-api.sprockets.ai/graphql";
const BOARD = "https://jobs.sprockets.ai/en-US/pyramidinc/jobs/";
const QUERY = `query GetJobsForBoard($identifier: String!, $page: Int, $itemsPer: Int, $sortBy: JobBoardSortEnum) {
  jobBoardPostingPaginated(identifier: $identifier, page: $page, itemsPer: $itemsPer, sortBy: $sortBy) {
    totalCount
    nodes { id jobDescription employmentType workplaceType wageMin wageMax wageInterval postedAt
      group { name location { name address { city state fullAddress } } } }
  }
}`;
const UNIT: Record<string, string> = { hourly: "HOUR", annually: "YEAR", weekly: "WEEK", monthly: "MONTH", daily: "DAY" };

type Node = Record<string, unknown> & { id: string };

function toJob(n: Node): CareerJob {
  const group = (n.group ?? {}) as { name?: string; location?: { address?: { city?: string; state?: string } } };
  const addr = group.location?.address ?? {};
  const state = (addr.state ?? "").trim().toUpperCase() || null;
  const desc = stripHtml(n.jobDescription as string);
  const min = positive(n.wageMin);
  const max = positive(n.wageMax);
  return {
    source_id: n.id,
    url: BOARD + n.id,
    title: (group.name ?? "").trim(),
    city: addr.city ?? null,
    state,
    country: state && US_STATES.has(state) ? "US" : null,
    remote: n.workplaceType === "remote" || /\bremote\b/i.test(desc.slice(0, 300)),
    // The board labels every posting full_time, even six-month contracts, so
    // contract or not is decided from the description.
    employment_type: null,
    date_posted: String(n.postedAt ?? "").slice(0, 10) || null,
    pay_min: min,
    pay_max: max,
    pay_unit: UNIT[String(n.wageInterval)] ?? ((n.wageInterval as string) || null),
    currency: min || max ? "USD" : null,
    description: desc.slice(0, 8000),
  };
}

export const pyramid: Adapter = {
  slug: "pyramid",
  alwaysComplete: false,
  async *list(budget: Budget, full: boolean) {
    const per = full ? 200 : 50;
    for (let page = 1; page <= 50; page++) {
      const res = await politeFetch(API, budget, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Sprockets-App": "job-board-app" },
        body: JSON.stringify({ query: QUERY, variables: { identifier: "pyramidinc", page, itemsPer: per, sortBy: "newest" } }),
      });
      const d = await res.json() as { data?: { jobBoardPostingPaginated?: { totalCount: number; nodes: Node[] } }; errors?: unknown };
      if (d.errors) throw new Error(`graphql: ${JSON.stringify(d.errors).slice(0, 200)}`);
      const p = d.data?.jobBoardPostingPaginated;
      const nodes = p?.nodes ?? [];
      if (nodes.length === 0) return;
      yield { items: nodes.map(toJob).filter((j) => j.country === "US").map((job) => ({ id: job.source_id, url: job.url, job })) };
      if (page * per >= (p?.totalCount ?? 0)) return;
    }
  },
};
