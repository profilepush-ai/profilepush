// Google Analytics 4 daily numbers for the admin funnel.
//
// This closes the top of the funnel. Everything else in the dashboard starts
// at signup, because every row in this database is keyed by account_id — so
// "how many people saw the site and did not sign up" was unanswerable, and the
// visitor-to-signup rate that the whole growth plan rests on was an assumption.
//
// Auth is a service-account JWT exchanged for an access token: GA4's Data API
// has no API-key mode, and a refresh token would tie the dashboard to one
// person's Google account.
//
// Required secrets:
//   GA4_PROPERTY_ID    numeric, from GA4 Admin - Property Settings
//   GA4_CLIENT_EMAIL   the service account address
//   GA4_PRIVATE_KEY    its private key, the whole PEM including the header
//
// The service account must also be added to the GA4 property itself with
// Viewer access — creating the key is not enough, and the failure mode is a
// 403 that reads like a bad key.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The private key arrives as a PEM. Secret managers routinely turn its real
// newlines into the two characters \n, so both forms have to work or the
// import fails with an opaque DataError.
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalised = pem.replace(/\\n/g, "\n").trim();
  const body = normalised
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function accessToken(clientEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));

  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const assertion = `${header}.${claims}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await res.json().catch(() => ({})) as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`Google token exchange failed: ${body.error_description ?? body.error ?? res.status}`);
  }
  return body.access_token;
}

type ReportRow = { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> };

async function runReport(
  token: string,
  propertyId: string,
  startDate: string,
  endDate: string,
  extra: Record<string, unknown> = {},
): Promise<ReportRow[]> {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      limit: 400,
      ...extra,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GA4 runReport ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = await res.json() as { rows?: ReportRow[] };
  return body.rows ?? [];
}

// GA4 returns dates as YYYYMMDD; everything else in this dashboard keys on
// YYYY-MM-DD, and a mismatch here would silently produce an empty join.
const toDayKey = (value: string) =>
  value.length === 8 ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const payload = await req.json();
    if (payload.password !== ADMIN_PASSWORD) return jsonResponse({ error: "Invalid password" }, 401);

    const propertyId = Deno.env.get("GA4_PROPERTY_ID");
    const clientEmail = Deno.env.get("GA4_CLIENT_EMAIL");
    const privateKey = Deno.env.get("GA4_PRIVATE_KEY");
    if (!propertyId || !clientEmail || !privateKey) {
      // Returned rather than thrown: the funnel renders its own "not
      // connected" state from this and should not show an error banner for a
      // feature nobody has set up yet.
      return jsonResponse({
        connected: false,
        reason: "GA4_PROPERTY_ID, GA4_CLIENT_EMAIL or GA4_PRIVATE_KEY is not set on this function",
        daily: [],
      });
    }

    const startDate = typeof payload.start_date === "string" ? payload.start_date.slice(0, 10) : "28daysAgo";
    const endDate = typeof payload.end_date === "string" ? payload.end_date.slice(0, 10) : "today";

    const token = await accessToken(clientEmail, privateKey);

    const [siteRows, signupRows] = await Promise.all([
      runReport(token, propertyId, startDate, endDate),
      // Views of the signup page specifically — the second stage of the
      // funnel, between landing on the site and creating an account.
      runReport(token, propertyId, startDate, endDate, {
        metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }],
        dimensionFilter: {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "BEGINS_WITH", value: "/signup" },
          },
        },
      }),
    ]);

    const signupByDay = new Map<string, { views: number; users: number }>();
    for (const row of signupRows) {
      const day = toDayKey(row.dimensionValues?.[0]?.value ?? "");
      signupByDay.set(day, {
        views: Number(row.metricValues?.[0]?.value ?? 0),
        users: Number(row.metricValues?.[1]?.value ?? 0),
      });
    }

    const daily = siteRows.map((row) => {
      const day = toDayKey(row.dimensionValues?.[0]?.value ?? "");
      const signup = signupByDay.get(day);
      return {
        date: day,
        sessions: Number(row.metricValues?.[0]?.value ?? 0),
        visitors: Number(row.metricValues?.[1]?.value ?? 0),
        signup_page_views: signup?.views ?? 0,
        signup_page_visitors: signup?.users ?? 0,
      };
    }).sort((a, b) => a.date.localeCompare(b.date));

    return jsonResponse({ connected: true, property_id: propertyId, daily });
  } catch (err) {
    return jsonResponse({ connected: false, reason: (err as Error).message, daily: [] });
  }
});

// Unused, but keeps the supabase-js import meaningful if this function later
// needs to cache reports into the database rather than hitting GA4 every load.
export type _Unused = ReturnType<typeof createClient>;
