import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const APP_BASE_URL = "https://profilepush.ai";

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Brand palette matches the daily digest email (cloudflare/profilepush-email-notifications).
function renderWelcomeEmail(firstName: string) {
  const loginUrl = `${APP_BASE_URL}/signin`;
  const logoUrl = `${APP_BASE_URL}/favicon.svg`;
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";
  const subject = "Welcome to ProfilePush";

  const text = `${greeting}

Welcome to ProfilePush — your account is ready. Browse new job requirements and hotlist consultants as they're added, and we'll keep you posted with daily updates.

Get started: ${loginUrl}

— The ProfilePush Team`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to ProfilePush</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 32px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 480px;">

          <tr>
            <td style="padding-bottom: 28px;">
              <img src="${logoUrl}" width="24" height="24" alt="" style="vertical-align: middle; border-radius: 6px;" />
              <span style="font-size: 16px; font-weight: 800; color: #0f172a; vertical-align: middle; margin-left: 8px;">ProfilePush</span>
            </td>
          </tr>

          <tr>
            <td style="padding-bottom: 4px;">
              <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.3;">${greeting}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 28px;">
              <p style="margin: 0; font-size: 14px; color: #64748b; line-height: 1.6;">Welcome to ProfilePush — your account is ready. Browse new job requirements and hotlist consultants as they're added, and we'll keep you posted with daily updates.</p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding-bottom: 28px;">
              <a href="${loginUrl}" style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; border-radius: 6px;">Get Started</a>
            </td>
          </tr>

          <tr>
            <td style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">Questions? Just reply to this email.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });

  try {
    // Recipient comes from the caller's own verified session, never the
    // request body — this is a welcome email, not an arbitrary send-to-anyone endpoint.
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user || !user.email) return respond({ error: "Unauthorized" }, 401);

    const fullName = typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === "string"
      ? user.user_metadata.name
      : "";
    const firstName = fullName.trim().split(/\s+/)[0] ?? "";

    const { subject, text, html } = renderWelcomeEmail(firstName);

    const workerUrl = Deno.env.get("EMAIL_WORKER_URL")?.trim();
    const workerToken = Deno.env.get("EMAIL_WORKER_TOKEN")?.trim();
    if (!workerUrl || !workerToken) throw new Error("Email worker is not configured");

    const sendResponse = await fetch(`${workerUrl.replace(/\/$/, "")}/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ to: user.email, subject, html, text }),
    });

    if (!sendResponse.ok) {
      const errorDetail = (await sendResponse.text()).slice(0, 500);
      console.error("send-welcome-email: worker /send failed", sendResponse.status, errorDetail);
      return respond({ error: "Could not queue welcome email" }, 502);
    }

    return respond({ queued: true });
  } catch (error) {
    console.error("send-welcome-email error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
