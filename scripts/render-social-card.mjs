// Renders a branded social card PNG from live requirement data.
//
//   node scripts/render-social-card.mjs <role> <state> <outfile> [square|landscape]
//
// Square (1080x1080) for Instagram, landscape (1200x628) for LinkedIn and
// Facebook. Instagram will not accept a text-only post at all, so the image is
// the whole post there, not decoration.
//
// Rendered with Playwright rather than satori/resvg: the same browser already
// used for the landing screenshots, real CSS, real font shaping, and what is
// on screen is exactly what ships. The production path puts this in a Worker;
// this script is what lets a card be reviewed before any of that is built.
import { chromium } from 'playwright';

const [role = 'java-developer', state = 'tx', outFile = 'card.png', shape = 'landscape'] = process.argv.slice(2);


const res = await fetch(`https://profilepush.ai/api/requirements/${role}/${state}`);
if (!res.ok) {
  console.error(`No data for ${role}/${state}: HTTP ${res.status}`);
  process.exit(1);
}
const data = await res.json();
const stats = data.stats ?? {};
// The JSON view calls them `requirements`; `listings` is accepted too so a
// rename on that endpoint does not silently produce a card with a blank gap
// where the roles should be — which is exactly what happened first time.
// The square canvas is nearly twice as tall for the same width, so it takes
// more rows before the bottom half reads as empty.
const listings = (data.requirements ?? data.listings ?? []).slice(0, shape === 'square' ? 6 : 3);
if (!listings.length) console.warn('warning: no requirements in the response — the card will have an empty middle');

const roleLabel = role.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const stateLabel = state.toUpperCase();
const size = shape === 'square' ? { width: 1080, height: 1080 } : { width: 1200, height: 628 };

const esc = (v) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// No recruiter names, emails or post bodies: the same rule the public pages
// follow. A card is more widely shared than a page, not less.
const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${size.width}px;height:${size.height}px;font-family:Inter,system-ui,sans-serif;
       background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 100%);color:#fff;
       padding:${shape === 'square' ? 80 : 64}px;display:flex;flex-direction:column;justify-content:space-between}
  .top{display:flex;align-items:center;gap:12px}
  .dot{width:10px;height:10px;border-radius:50%;background:#38bdf8}
  .brand{font-size:20px;font-weight:600;letter-spacing:.02em;color:#cbd5e1}
  h1{font-size:${shape === 'square' ? 72 : 58}px;font-weight:800;line-height:1.05;letter-spacing:-.02em;margin-top:28px}
  h1 em{font-style:normal;color:#38bdf8}
  .stats{display:flex;gap:${shape === 'square' ? 56 : 44}px;margin-top:${shape === 'square' ? 56 : 32}px}
  .stat b{display:block;font-size:${shape === 'square' ? 64 : 48}px;font-weight:800;line-height:1}
  .stat span{font-size:17px;color:#94a3b8;margin-top:8px;display:block}
  .roles{margin-top:${shape === 'square' ? 48 : 30}px;display:flex;flex-direction:column;gap:${shape === 'square' ? 14 : 12}px}
  .role{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:12px;
        padding:${shape === 'square' ? 18 : 14}px 18px;font-size:19px;display:flex;justify-content:space-between;gap:16px}
  .role b{font-weight:600}
  .role span{color:#94a3b8;white-space:nowrap}
  .foot{display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px}
  .cta{font-size:22px;font-weight:600}
  .url{font-size:18px;color:#7dd3fc}
</style></head><body>
  <div>
    <div class="top"><span class="dot"></span><span class="brand">ProfilePush</span></div>
    <h1>${esc(roleLabel)} C2C<br>requirements in <em>${esc(stateLabel)}</em></h1>
    <div class="stats">
      <div class="stat"><b>${esc(stats.total_last_30_days ?? 0)}</b><span>live, last 30 days</span></div>
      <div class="stat"><b>${esc(stats.added_last_7_days ?? 0)}</b><span>added this week</span></div>
      <div class="stat"><b>${esc(stats.with_direct_contact ?? 0)}</b><span>with recruiter contact</span></div>
    </div>
    <div class="roles">
      ${listings.map((l) => `<div class="role"><b>${esc(l.title).slice(0, 52)}</b><span>${esc(l.location)}</span></div>`).join('')}
    </div>
  </div>
  <div class="foot">
    <div class="cta">See all ${esc(stats.total_last_30_days ?? 0)} — free, no card</div>
    <div class="url">profilepush.ai</div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: outFile });
await browser.close();
console.log(`${outFile}  ${size.width}x${size.height}  ${roleLabel} / ${stateLabel}`);
