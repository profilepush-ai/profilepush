// The visitor's country, from Cloudflare (two letters, e.g. "IN", "US"), so
// the app can show prices in rupees in India and dollars elsewhere.
export const onRequestGet = ({ request }: { request: Request & { cf?: { country?: string } } }) =>
  new Response(JSON.stringify({ country: request.cf?.country ?? null }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=3600' },
  });
