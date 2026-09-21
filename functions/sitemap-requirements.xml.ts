// Sitemap for the generated requirement pages, built from live inventory.
//
// Driven by get_public_page_index rather than a hardcoded list, so a page only
// appears once it has enough listings to be worth crawling, and drops out when
// the inventory dries up. A hardcoded sitemap rots into a list of 404s, which
// is worse for the domain than having no sitemap at all.

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

type IndexRow = { role: string; state: string; listings: number };

// Matches the threshold used when deciding which templates are viable: below
// this a page looks thin, and thin pages drag the whole domain.
const MIN_LISTINGS = 20;

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
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
    rows = [];
  }

  const today = new Date().toISOString().slice(0, 10);
  const urls: string[] = [];
  const roleHubs = new Set<string>();

  for (const row of rows) {
    if (!row.role || !row.state) continue;
    roleHubs.add(row.role);
    urls.push(
      `<url><loc>https://profilepush.ai/c2c-requirements/${row.role}/${row.state.toLowerCase()}</loc>` +
      `<lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`,
    );
  }

  // Hubs carry the internal linking, so they rank above the leaves.
  for (const role of roleHubs) {
    urls.push(
      `<url><loc>https://profilepush.ai/c2c-requirements/${role}</loc>` +
      `<lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`,
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=7200",
    },
  });
};
