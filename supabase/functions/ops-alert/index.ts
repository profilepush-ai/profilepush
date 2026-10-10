import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Emails an operations alert to the team. Invoked only by
// check_scheduled_jobs() (migration 20261010300000), which sends the anon key
// for the platform gateway; the real check is the "token" field, the same
// shared secret as notify-new-signup (SIGNUP_NOTIFY_WEBHOOK_TOKEN).

const ALERT_TO_EMAIL = "profilepush.ai@gmail.com";

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  try {
    const body = await request.json().catch(() => ({})) as { token?: string; subject?: string; lines?: unknown };
    const expectedToken = Deno.env.get("SIGNUP_NOTIFY_WEBHOOK_TOKEN") ?? "";
    if (!expectedToken || body.token !== expectedToken) return respond({ error: "Unauthorized" }, 401);

    const subject = (typeof body.subject === "string" && body.subject.trim()) ? body.subject.trim().slice(0, 200) : "ProfilePush alert";
    const lines = (Array.isArray(body.lines) ? body.lines : []).map((l) => String(l).slice(0, 500)).slice(0, 20);
    if (lines.length === 0) return respond({ ok: true, skipped: true });

    const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const text = `${subject}\n${when}\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\nCheck cron.job_run_details in Supabase.`;
    const html = `<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 14px; color: #111827;">
      <p style="margin: 0 0 4px; font-weight: 700;">${escapeHtml(subject)}</p>
      <p style="margin: 0 0 12px; color: #6b7280;">${escapeHtml(when)}</p>
      <ul style="margin: 0 0 12px; padding-left: 18px;">${lines.map((l) => `<li style="margin-bottom: 4px;">${escapeHtml(l)}</li>`).join("")}</ul>
      <p style="margin: 0; color: #6b7280;">Check cron.job_run_details in Supabase.</p>
    </div>`;

    const workerUrl = Deno.env.get("EMAIL_WORKER_URL")?.trim();
    const workerToken = Deno.env.get("EMAIL_WORKER_TOKEN")?.trim();
    if (!workerUrl || !workerToken) throw new Error("Email worker is not configured");
    const sendResponse = await fetch(`${workerUrl.replace(/\/$/, "")}/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ to: ALERT_TO_EMAIL, subject, html, text, category: "ops_alert" }),
    });
    if (!sendResponse.ok) {
      console.error("ops-alert: worker /send failed", sendResponse.status, (await sendResponse.text()).slice(0, 300));
      return respond({ ok: false, error: "send_failed" }, 502);
    }
    return respond({ ok: true });
  } catch (error) {
    console.error("ops-alert error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
