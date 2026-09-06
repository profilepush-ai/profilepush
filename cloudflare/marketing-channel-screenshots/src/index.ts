import puppeteer, { type Browser, type BrowserWorker } from "@cloudflare/puppeteer";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  APP_ORIGIN: string;
  WORKER_BASE_URL: string;
  SUPABASE_AUTH_STORAGE_KEY: string;
  SCREENSHOT_BOT_EMAIL: string;
  RUN_SECRET: string;
  SCREENSHOTS_BUCKET: R2Bucket;
  BROWSER: BrowserWorker;
}

type Viewport = { label: "desktop" | "mobile"; width: number; height: number };

const VIEWPORTS: Viewport[] = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "mobile", width: 390, height: 844 },
];

type RouteSpec = {
  label: string;
  requiresAuth: boolean;
  // Static path, or a resolver that looks up a real record id at capture
  // time so the manifest never goes stale. Returns null to skip the route
  // for this run (e.g. no seed data yet for a fresh bot account).
  path?: string;
  resolve?: (env: Env) => Promise<string | null>;
};

// Kept in sync with src/App.tsx by hand — Workers can't import the Vite/React
// route table directly. Deliberately excludes: pure <Navigate> redirects
// (they just land on a page already captured on its own), /admin and
// /admin/commands (internal ops tools, not marketing-facing), and
// /onboard/:token, /confirm-applied/:token, /screen/:token (one-time/
// side-effecting candidate flows — ConfirmApplied.tsx writes an
// activity_logs row just from loading, so auto-visiting daily would
// corrupt real data).
const ROUTES: RouteSpec[] = [
  { label: "Home", requiresAuth: false, path: "/" },
  { label: "Sign up", requiresAuth: false, path: "/signup" },
  { label: "Sign in", requiresAuth: false, path: "/signin" },
  { label: "About", requiresAuth: false, path: "/about" },
  { label: "Contact", requiresAuth: false, path: "/contact" },
  { label: "How it works", requiresAuth: false, path: "/how-it-works" },
  { label: "Why AI copilot", requiresAuth: false, path: "/why-ai-copilot" },
  { label: "Security", requiresAuth: false, path: "/security" },
  { label: "Privacy", requiresAuth: false, path: "/privacy" },
  { label: "Terms", requiresAuth: false, path: "/terms" },
  { label: "Cancellation & refund", requiresAuth: false, path: "/cancellation-refund" },
  { label: "Book a demo", requiresAuth: false, path: "/book-demo" },
  { label: "IT staffing vendor list", requiresAuth: false, path: "/it-staffing-vendor-list" },
  { label: "IT staffing bench sales recruiters list", requiresAuth: false, path: "/it-staffing-bench-sales-recruiters-list" },
  { label: "Vs. JobRight AI", requiresAuth: false, path: "/vs/jobright-ai" },
  { label: "Vs. DriveTube AI", requiresAuth: false, path: "/vs/drivetube-ai" },
  { label: "Vs. Apply NXT", requiresAuth: false, path: "/vs/apply-nxt" },

  { label: "Feed", requiresAuth: true, path: "/feed" },
  { label: "Posts", requiresAuth: true, path: "/posts" },
  { label: "Pulse", requiresAuth: true, path: "/pulse" },
  { label: "Tracker", requiresAuth: true, path: "/tracker" },
  { label: "Contacts", requiresAuth: true, path: "/contacts" },
  { label: "Active list", requiresAuth: true, path: "/active-list" },
  { label: "Alerts", requiresAuth: true, path: "/alerts" },
  { label: "Inbox", requiresAuth: true, path: "/inbox" },
  { label: "Account", requiresAuth: true, path: "/account" },
  { label: "Support", requiresAuth: true, path: "/support" },
  { label: "Roadmap", requiresAuth: true, path: "/roadmap" },
  { label: "Billing", requiresAuth: true, path: "/billing" },
  { label: "Watchlist profiles", requiresAuth: true, path: "/watchlist-profiles" },

  {
    label: "Job detail",
    requiresAuth: false,
    resolve: async (env) => prefixWithId("/job", await resolveLatestId(env, "social_jobs")),
  },
  {
    label: "Hotlist detail",
    requiresAuth: false,
    resolve: async (env) => prefixWithId("/hotlist", await resolveLatestId(env, "social_hotlist")),
  },
  {
    label: "Feed detail (job)",
    requiresAuth: true,
    resolve: async (env) => prefixWithId("/feed/job", await resolveLatestId(env, "social_jobs")),
  },

  // profile-details/:id and inbox/:conversationId are account-scoped (RLS
  // restricts them to the owning account's own data) rather than the
  // shared/public social_jobs-style tables above, so a fresh screenshot-bot
  // account has nothing safe to resolve for them yet. Left out until the
  // bot account has its own seeded profile/conversation to point at.

  {
    // A job + application seeded under the screenshot-bot's own account
    // (bot_sample_job_id.txt / social_jobs.post_id = "marketing-bot-sample-job")
    // — the earlier attempt reused a QA job owned by a DIFFERENT account,
    // which rendered a real page shell but with a "Job post not found"
    // error and no content, since RLS correctly blocks cross-account access
    // to someone else's job's applications.
    label: "Application detail (sample)",
    requiresAuth: true,
    path: "/posts/applications/5a1c5f5f-d011-44cf-b752-195b80ac3467/c2403b0e-6bf8-4963-a00e-77bad2564954",
  },
];

function prefixWithId(base: string, id: string | null): string | null {
  return id ? `${base}/${id}` : null;
}

function serviceHeaders(env: Env, json = false): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

async function supabaseRequest(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(env), ...(init.headers ?? {}) },
  });
}

async function resolveLatestId(env: Env, table: string): Promise<string | null> {
  const res = await supabaseRequest(env, `${table}?select=id&order=created_at.desc&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

// Two-step exchange, done once per run and reused for every authenticated
// route: (1) admin/generate_link mints a one-time token for the bot account,
// (2) POSTing that token_hash to /auth/v1/verify returns a real
// access_token/refresh_token pair as JSON — no browser redirect involved, so
// it isn't subject to the project's redirect-URL allowlist (which only
// covers the bare app origin, not arbitrary sub-paths). The resulting
// session object is injected into the page's localStorage further down,
// exactly like the manual magic-link-session Playwright QA used throughout
// this app's testing.
async function fetchBotSession(env: Env): Promise<Record<string, unknown>> {
  const linkRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: serviceHeaders(env, true),
    body: JSON.stringify({ type: "magiclink", email: env.SCREENSHOT_BOT_EMAIL }),
  });
  if (!linkRes.ok) throw new Error(`generate_link failed (${linkRes.status}): ${await linkRes.text()}`);
  const linkData = (await linkRes.json()) as { hashed_token?: string };
  if (!linkData.hashed_token) throw new Error("generate_link response had no hashed_token");

  const verifyRes = await fetch(`${env.SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ type: "magiclink", token_hash: linkData.hashed_token }),
  });
  if (!verifyRes.ok) throw new Error(`verify failed (${verifyRes.status}): ${await verifyRes.text()}`);
  return verifyRes.json();
}

async function captureRoute(
  browser: Browser,
  env: Env,
  targetPath: string,
  requiresAuth: boolean,
  botSession: Record<string, unknown> | null,
  viewport: Viewport,
): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: viewport.width, height: viewport.height });

    if (requiresAuth && botSession) {
      // A page has to exist at the target origin before localStorage on
      // that origin can be written — land on the bare origin first, inject
      // the session, then navigate to the real target route.
      await page.goto(env.APP_ORIGIN, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.evaluate(
        (storageKey: string, sessionJson: string) => {
          window.localStorage.setItem(storageKey, sessionJson);
        },
        env.SUPABASE_AUTH_STORAGE_KEY,
        JSON.stringify(botSession),
      );
    }

    // "networkidle0" never resolves on pages that hold an open realtime/
    // long-poll connection (this app uses Supabase realtime in places) — it
    // would wait out the full per-navigation timeout on every such route.
    // "domcontentloaded" plus a fixed settle delay is slightly less precise
    // but reliably finishes.
    await page.goto(`${env.APP_ORIGIN}${targetPath}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const screenshot = await page.screenshot({ fullPage: true, type: "png" });
    return screenshot as Uint8Array;
  } finally {
    await page.close();
  }
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

type CapturedItem = { route: string; label: string; viewport: string; url: string };

async function runDailyScreenshotBatch(env: Env): Promise<{ captured: CapturedItem[]; skipped: string[] }> {
  const dateKey = new Date().toISOString().slice(0, 10);
  const captured: CapturedItem[] = [];
  const skipped: string[] = [];

  // One session for the whole run, reused across every authenticated route —
  // the bot doesn't need a fresh token per page, just a valid one.
  let botSession: Record<string, unknown> | null = null;
  const needsAuth = ROUTES.some((route) => route.requiresAuth);
  if (needsAuth) {
    try {
      botSession = await fetchBotSession(env);
    } catch (error) {
      console.error("could not establish screenshot-bot session — all authenticated routes will be skipped", error);
    }
  }

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    for (const route of ROUTES) {
      const targetPath = route.path ?? (route.resolve ? await route.resolve(env) : null);
      if (!targetPath) {
        skipped.push(route.label);
        continue;
      }
      if (route.requiresAuth && !botSession) {
        skipped.push(`${route.label}: no bot session available`);
        continue;
      }

      for (const viewport of VIEWPORTS) {
        try {
          const png = await captureRoute(browser, env, targetPath, route.requiresAuth, botSession, viewport);
          const key = `marketing/${dateKey}/${slugify(route.label)}-${viewport.label}.png`;
          await env.SCREENSHOTS_BUCKET.put(key, png, { httpMetadata: { contentType: "image/png" } });

          // Proxied through this Worker (not a public R2 dev URL) — same
          // pattern as job-application-screening's /video/:applicationId
          // route for R2-backed media, and avoids depending on R2's
          // per-bucket public hostname being known ahead of time.
          const publicUrl = `${env.WORKER_BASE_URL}/image/${key}`;
          captured.push({ route: targetPath, label: route.label, viewport: viewport.label, url: publicUrl });
        } catch (error) {
          console.error(`screenshot failed for ${route.label} (${viewport.label})`, error);
          skipped.push(`${route.label} (${viewport.label}): ${(error as Error).message}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (captured.length > 0) {
    const channelRes = await supabaseRequest(env, "admin_channels?select=id&slug=eq.marketing&limit=1");
    const channels = (await channelRes.json()) as Array<{ id: string }>;
    const channelId = channels[0]?.id;
    if (channelId) {
      await supabaseRequest(env, "admin_channel_messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          channel_id: channelId,
          kind: "screenshot_batch",
          body: `Daily screenshots — ${dateKey}`,
          author_label: "Screenshot Bot",
          metadata: { items: captured, skipped },
        }),
      });
    } else {
      console.error("marketing channel not found — did the admin_channels migration run?");
    }
  }

  return { captured, skipped };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.startsWith("/image/")) {
      const key = decodeURIComponent(url.pathname.slice("/image/".length));
      const object = await env.SCREENSHOTS_BUCKET.get(key);
      if (!object) return new Response("Not found", { status: 404 });
      const filename = key.split("/").pop() ?? "screenshot.png";
      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType ?? "image/png",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/run") {
      if (url.searchParams.get("key") !== env.RUN_SECRET) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      try {
        const result = await runDailyScreenshotBatch(env);
        return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
      } catch (error) {
        console.error("manual /run failed", error);
        return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
      }
    }
    return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      const { captured, skipped } = await runDailyScreenshotBatch(env);
      console.log(`marketing-channel-screenshots: captured ${captured.length}, skipped ${skipped.length}`);
    } catch (error) {
      console.error("marketing-channel-screenshots: cron run failed", error);
      throw error;
    }
  },
};
