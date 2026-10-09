import { politeFetch, type Budget } from "../http";
import { jobPostingFromHtml, normalizeJobPosting } from "../jsonld";
import type { Adapter } from "../types";

// Sitemap index -> /job/JP-xxxx/ pages -> JSON-LD JobPosting on each page.
const INDEX = "https://careers.teksystems.com/us/en/sitemap_index.xml";
const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);

export const teksystems: Adapter = {
  slug: "teksystems",
  alwaysComplete: true,
  async *list(budget: Budget) {
    const index = await (await politeFetch(INDEX, budget)).text();
    const items: Array<{ id: string; url: string }> = [];
    for (const sitemap of locs(index)) {
      const xml = await (await politeFetch(sitemap, budget)).text();
      for (const url of locs(xml)) {
        const m = url.match(/\/job\/([^/]+)\//);
        if (m) items.push({ id: m[1], url });
      }
    }
    yield { items };
  },
  async detail(item, budget) {
    const jp = jobPostingFromHtml(await (await politeFetch(item.url, budget)).text());
    return jp ? normalizeJobPosting(item.id, item.url, jp) : null;
  },
};
