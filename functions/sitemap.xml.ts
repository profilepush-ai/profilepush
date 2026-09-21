// /sitemap.xml is a sitemap index, not a list of pages.
//
// It used to be a static file holding the 18 marketing URLs, while the ~300
// generated requirement pages lived in a second file most people never knew
// to open. Anyone checking coverage looked at /sitemap.xml, saw 18, and
// concluded the rest was missing.
//
// An index is the standard way to express this: one URL to submit to Search
// Console, and both children are discovered from it. The marketing list keeps
// living as a hand-maintained static file, now at /sitemap-marketing.xml.

const CHILDREN = [
  "https://profilepush.ai/sitemap-marketing.xml",
  "https://profilepush.ai/sitemap-requirements.xml",
];

const render = () => {
  const today = new Date().toISOString().slice(0, 10);
  const body = CHILDREN.map(
    (loc) => `  <sitemap><loc>${loc}</loc><lastmod>${today}</lastmod></sitemap>`,
  ).join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>`,
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        // Short in the browser so a change is visible when you check it;
        // longer at the edge, where crawl bursts land.
        "Cache-Control": "public, max-age=120, s-maxage=7200",
      },
    },
  );
};

export const onRequestGet: PagesFunction = async () => render();
export const onRequestHead: PagesFunction = async () => {
  const r = render();
  return new Response(null, { status: r.status, headers: r.headers });
};
