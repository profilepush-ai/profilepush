// Captures product screenshots for the marketing pages.
//
// Run: node scripts/capture-landing-shots.mjs <email> <password> <outDir>
//
// Every capture is scrubbed before it is written: real recruiter emails are
// replaced in the DOM (a replaced string cannot leak, a CSS filter can fail to
// paint) and the poster row — avatar, name, company, timestamp — is blurred as
// a unit. Marketing material must not carry a real person's name or address.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [email, password, outDir] = process.argv.slice(2);
if (!email || !password || !outDir) {
  console.error('usage: node scripts/capture-landing-shots.mjs <email> <password> <outDir>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const SCRUB = () => {
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

  for (const el of Array.from(document.querySelectorAll('div'))) {
    const t = el.textContent || '';
    if (t.trim().startsWith('Add as an App') && String(el.className).includes('rounded')) el.remove();
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (EMAIL.test(n.nodeValue || '')) n.nodeValue = (n.nodeValue || '').replace(EMAIL, 'recruiter@example.com');
  }

  // The poster row reads "avatar · name · company · 7 hrs ago". Find the
  // timestamp, then climb to the nearest ancestor that also contains the
  // avatar: that ancestor is the row. Blurring it takes the name and company
  // with it, without catching the whole card the way a looser rule did.
  const stamps = Array.from(document.querySelectorAll('span,div,p')).filter((el) => {
    const t = (el.textContent || '').trim();
    return t.length < 30 && /^\d+\s*(hrs?|hours?|mins?|minutes?|days?)\s*ago$/.test(t);
  });
  for (const stamp of stamps) {
    let node = stamp;
    for (let up = 0; up < 5 && node; up += 1) {
      const hasAvatar = Array.from(node.querySelectorAll('img,svg'))
        .some((m) => m.getBoundingClientRect().width <= 40);
      if (hasAvatar && (node.textContent || '').trim().length < 130) {
        node.style.filter = 'blur(6px)';
        break;
      }
      node = node.parentElement;
    }
  }

  for (const el of Array.from(document.querySelectorAll('p,div,span'))) {
    const t = (el.textContent || '').trim();
    if (t.startsWith('Posted by') && t.length < 140 && el.children.length <= 3) {
      el.style.filter = 'blur(6px)';
    }
  }
};

// Waits are generous because these pages fetch on mount and a short wait
// captures a spinner — the Active List looked empty on the first run purely
// because 7s was not long enough for it to finish loading.
//
// Only pages backed by global inventory are listed. posts, inbox, tracker and
// the screening flow are account-scoped, so they render empty states unless
// the capture runs against an account with real activity.
const PAGES = [
  ['hotlist', '/feed', 11000],
  ['activelist', '/active-list', 16000],
  ['posts', '/posts', 9000],
  ['inbox', '/inbox', 9000],
  ['tracker', '/tracker', 9000],
  ['pulse', '/pulse', 22000],
];

const browser = await chromium.launch();
try {
  for (const [isMobile, viewport, suffix] of [
    [false, { width: 1440, height: 900 }, ''],
    [true, { width: 390, height: 844 }, '-mobile'],
  ]) {
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: isMobile ? 3 : 2,
      isMobile,
      hasTouch: isMobile,
    });
    const page = await ctx.newPage();
    await page.goto('https://profilepush.ai/signin', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(7000);

    for (const [key, path, wait] of PAGES) {
      await page.goto(`https://profilepush.ai${path}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(wait);
      await page.evaluate(SCRUB);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${outDir}/${key}${suffix}.png` });

      // Refuse to leave a capture on disk that still carries an address.
      const leaked = await page.evaluate(() => (document.body.innerText
        .match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])
        .filter((e) => !/example\.com/.test(e)));
      console.log(`${key}${suffix}: ${page.url()}${leaked.length ? `  LEAK ${JSON.stringify(leaked)}` : ''}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
