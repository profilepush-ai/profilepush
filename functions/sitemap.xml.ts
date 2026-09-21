// One sitemap, every URL.
//
// This was briefly a sitemap index pointing at /sitemap-marketing.xml and
// /sitemap-requirements.xml. That is the textbook shape, but it bought us
// nothing at this size and cost us plenty: three rows in Search Console with
// three statuses, discovery credited to children so the index itself reports
// zero pages forever, and a stale "Couldn't fetch" on one child that survived
// the fix because Google had no reason to re-read that URL.
//
// At ~320 URLs a single file is far inside the 50,000 / 50MB limit, so the
// split was solving a problem we do not have. One URL to submit, one status to
// read, one thing to check.
//
// Marketing pages are hand-maintained here; requirement pages come from live
// inventory via get_public_page_index, so a page is listed only while it has
// enough listings to be worth crawling. A hardcoded list of generated pages
// rots into 404s, which hurts the domain more than omitting them would.

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

type IndexRow = { role: string; state: string; listings: number };

// A requirement page renders whenever it has at least one contactable,
// de-duplicated listing, so a threshold of 20 advertised only 163 of the 384
// pages that actually work. Ten keeps every advertised page substantive — ten
// requirements in a rolling 30 days, five of them shown — while adding 113
// that were live and simply undiscoverable. The page itself still 404s when
// it has nothing, which is what keeps this file free of dead URLs.
const MIN_LISTINGS = 10;

type MarketingEntry = {
  path: string;
  lastmod: string;
  changefreq: string;
  priority: string;
};

const MARKETING: MarketingEntry[] = [
  { path: "/", lastmod: "2026-09-09", changefreq: "weekly", priority: "1.0" },
  { path: "/vendors", lastmod: "2026-09-09", changefreq: "weekly", priority: "0.95" },
  { path: "/bench-sales", lastmod: "2026-09-09", changefreq: "weekly", priority: "0.95" },
  { path: "/how-it-works", lastmod: "2026-08-04", changefreq: "monthly", priority: "0.9" },
  { path: "/why-ai-copilot", lastmod: "2026-08-04", changefreq: "monthly", priority: "0.8" },
  { path: "/about", lastmod: "2026-08-04", changefreq: "monthly", priority: "0.8" },
  { path: "/contact", lastmod: "2026-08-04", changefreq: "monthly", priority: "0.7" },
  { path: "/book-demo", lastmod: "2026-08-04", changefreq: "monthly", priority: "0.7" },
  { path: "/vs/ceipal", lastmod: "2026-08-04", changefreq: "monthly", priority: "0.6" },
  { path: "/vs/jobright-ai", lastmod: "2026-08-04", changefreq: "monthly", priority: "0.6" },
  { path: "/vs/drivetube-ai", lastmod: "2026-08-04", changefreq: "monthly", priority: "0.6" },
  { path: "/vs/apply-nxt", lastmod: "2026-08-04", changefreq: "monthly", priority: "0.6" },
  { path: "/it-staffing-vendor-list", lastmod: "2026-08-24", changefreq: "daily", priority: "0.8" },
  { path: "/it-staffing-bench-sales-recruiters-list", lastmod: "2026-08-24", changefreq: "daily", priority: "0.8" },
  { path: "/security", lastmod: "2026-08-04", changefreq: "monthly", priority: "0.5" },
  { path: "/privacy", lastmod: "2026-08-04", changefreq: "yearly", priority: "0.4" },
  { path: "/terms", lastmod: "2026-08-04", changefreq: "yearly", priority: "0.4" },
  { path: "/cancellation-refund", lastmod: "2026-08-04", changefreq: "yearly", priority: "0.3" },
];

const url = (loc: string, lastmod: string, changefreq: string, priority: string) =>
  `  <url><loc>https://profilepush.ai${loc}</loc><lastmod>${lastmod}</lastmod>` +
  `<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;

const renderSitemap: PagesFunction<Env> = async ({ env }) => {
  let rows: IndexRow[] = [];
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_public_page_index`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ p_min_listings: MIN_LISTINGS }),
    });
    if (res.ok) rows = await res.json() as IndexRow[];
  } catch {
    // Degrade to the marketing pages rather than serving nothing. A sitemap
    // that is briefly short is survivable; one that is briefly empty tells
    // Google we deleted the site.
    rows = [];
  }

  const today = new Date().toISOString().slice(0, 10);
  const urls = MARKETING.map((m) => url(m.path, m.lastmod, m.changefreq, m.priority));
  const roleHubs = new Set<string>();

  for (const row of rows) {
    if (!row.role || !row.state) continue;
    roleHubs.add(row.role);
    urls.push(url(`/c2c-requirements/${row.role}/${row.state.toLowerCase()}`, today, "daily", "0.8"));
  }

  // Hubs carry the internal linking, so they rank above the leaves.
  for (const role of roleHubs) {
    urls.push(url(`/c2c-requirements/${role}`, today, "daily", "0.9"));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Short browser cache, long edge cache. An hour of browser caching meant
      // that after changing which pages are listed, the file still looked
      // unchanged when opened directly — while crawlers, which do not reuse a
      // browser cache, were already getting the new list. The CDN still
      // absorbs crawl bursts.
      "Cache-Control": "public, max-age=120, s-maxage=7200",
    },
  });
};

export const onRequestGet = renderSitemap;

export const onRequestHead: PagesFunction<Env> = async (context) => {
  const response = await renderSitemap(context);
  return new Response(null, { status: response.status, headers: response.headers });
};
