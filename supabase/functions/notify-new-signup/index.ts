import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Invoked only by the accounts_notify_new_signup trigger (supabase/migrations/
// 20260827160000_notify_new_signup.sql), which posts with a shared secret
// stored in signup_notify_config as its bearer token — this endpoint has no
// Supabase-session-based auth of its own, since a DB trigger has no user JWT
// to present.

const NOTIFY_TO_EMAIL = "profilepush.ai@gmail.com";

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function getBearerToken(request: Request): string {
  const [scheme, token] = (request.headers.get("Authorization") ?? "").split(" ");
  return scheme?.toLowerCase() === "bearer" ? (token ?? "").trim() : "";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const expectedToken = Deno.env.get("SIGNUP_NOTIFY_WEBHOOK_TOKEN") ?? "";
    if (!expectedToken || getBearerToken(request) !== expectedToken) {
      return respond({ error: "Unauthorized" }, 401);
    }

    const body = await request.json().catch(() => ({})) as {
      account_id?: string;
      account_name?: string;
      owner_id?: string;
      created_at?: string;
    };
    const ownerId = typeof body.owner_id === "string" ? body.owner_id : "";
    if (!ownerId) return respond({ error: "owner_id is required" }, 400);

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: ownerLookup, error: ownerError } = await supabaseAdmin.auth.admin.getUserById(ownerId);
    const owner = ownerLookup?.user ?? null;
    if (ownerError || !owner) {
      console.error("notify-new-signup: could not load owner user", ownerId, ownerError?.message);
    }

    const ownerEmail = owner?.email ?? "(unknown)";
    const metadata = owner?.user_metadata ?? {};
    const fullName = typeof metadata.full_name === "string" ? metadata.full_name
      : typeof metadata.name === "string" ? metadata.name
      : "";
    const provider = owner?.app_metadata?.provider ?? "email";
    const accountName = typeof body.account_name === "string" ? body.account_name : "";
    const signedUpAt = body.created_at ?? new Date().toISOString();

    const subject = `New ProfilePush signup: ${ownerEmail}`;
    const rows: [string, string][] = [
      ["Email", ownerEmail],
      ["Name", fullName || "(not provided)"],
      ["Sign-up method", String(provider)],
      ["Workspace name", accountName || "(default)"],
      ["Account ID", String(body.account_id ?? "")],
      ["User ID", ownerId],
      ["Signed up at", signedUpAt],
    ];

    const text = `New ProfilePush signup\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}`;
    const html = `<div style="font-family: -apple-system, sans-serif; font-size: 14px; color: #0f172a;">
      <h2 style="margin: 0 0 12px;">New ProfilePush signup</h2>
      <table cellpadding="4" cellspacing="0">
        ${rows.map(([k, v]) => `<tr><td style="color:#64748b; padding-right: 12px;">${escapeHtml(k)}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`).join("")}
      </table>
    </div>`;

    const workerUrl = Deno.env.get("EMAIL_WORKER_URL")?.trim();
    const workerToken = Deno.env.get("EMAIL_WORKER_TOKEN")?.trim();
    if (!workerUrl || !workerToken) throw new Error("Email worker is not configured");

    const sendResponse = await fetch(`${workerUrl.replace(/\/$/, "")}/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ to: NOTIFY_TO_EMAIL, subject, html, text }),
    });

    if (!sendResponse.ok) {
      const errorDetail = (await sendResponse.text()).slice(0, 500);
      console.error("notify-new-signup: worker /send failed", sendResponse.status, errorDetail);
      return respond({ ok: false, error: "send_failed" }, 502);
    }

    return respond({ ok: true });
  } catch (error) {
    console.error("notify-new-signup error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
