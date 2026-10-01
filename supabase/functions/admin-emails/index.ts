import { createClient } from "npm:@supabase/supabase-js@2.49.1";

// Admin > Emails: every email the email worker sends, by category, with
// delivery, bounce, complaint and unsubscribe counts, plus Compose: write an
// email, pick who gets it, preview, send a test, and send it. Same admin
// password as admin-stats. Campaign emails go through the email worker's
// /broadcast (user lane, Amazon SES), which adds each recipient's first name
// and own unsubscribe link.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";
const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") || "https://profilepush.ai").replace(/\/$/, "");
const AUDIENCES = ["all", "vendors", "bench_sales", "no_app", "inactive_7d", "emails"];

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Escapes a paragraph and turns bare https links into links. {{first_name}}
// survives escaping untouched for the worker to fill in.
function paragraphHtml(text: string): string {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color: #2563eb;">$1</a>')
    .replace(/\n/g, "<br>");
}

type Draft = { subject: string; body: string; buttonLabel: string; buttonUrl: string };

function readDraft(input: Record<string, unknown>): Draft | string {
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const buttonLabel = typeof input.button_label === "string" ? input.button_label.trim() : "";
  const buttonUrl = typeof input.button_url === "string" ? input.button_url.trim() : "";
  if (!subject) return "Write a subject.";
  if (!body) return "Write the email.";
  if (subject.length > 200) return "Keep the subject under 200 characters.";
  if (buttonLabel && !/^https:\/\/\S+$/.test(buttonUrl)) return "The button link must start with https://";
  return { subject, body, buttonLabel, buttonUrl };
}

// The same branded layout as the digest and credit emails.
function renderCampaign(draft: Draft): { html: string; text: string } {
  const paragraphs = draft.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const button = draft.buttonLabel && draft.buttonUrl
    ? `<tr><td align="left" style="padding: 8px 0 28px;"><a href="${escapeHtml(draft.buttonUrl)}" style="display: inline-block; padding: 12px 28px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; border-radius: 6px;">${escapeHtml(draft.buttonLabel)}</a></td></tr>`
    : "";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(draft.subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(paragraphs[0]?.slice(0, 140) ?? "")}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 32px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px;">
          <tr>
            <td style="padding-bottom: 28px;">
              <img src="${APP_BASE_URL}/favicon.svg" width="24" height="24" alt="" style="vertical-align: middle; border-radius: 6px;" />
              <span style="font-size: 16px; font-weight: 800; color: #0f172a; vertical-align: middle; margin-left: 8px;">ProfilePush</span>
            </td>
          </tr>
          ${paragraphs.map((p) => `<tr><td style="padding-bottom: 16px;"><p style="margin: 0; font-size: 15px; line-height: 1.6; color: #1e293b;">${paragraphHtml(p)}</p></td></tr>`).join("\n          ")}
          ${button}
          <tr>
            <td style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                You're getting this because you have a ProfilePush account.
                <a href="{{unsubscribe_url}}" style="color: #94a3b8; text-decoration: underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  const text = `${paragraphs.join("\n\n")}${draft.buttonLabel && draft.buttonUrl ? `\n\n${draft.buttonLabel}: ${draft.buttonUrl}` : ""}

---
You're getting this because you have a ProfilePush account. Unsubscribe: {{unsubscribe_url}}`;
  return { html, text };
}

async function sendToWorker(payload: Record<string, unknown>): Promise<void> {
  const workerUrl = (Deno.env.get("EMAIL_WORKER_URL") ?? "").trim().replace(/\/$/, "");
  const workerToken = (Deno.env.get("EMAIL_WORKER_TOKEN") ?? "").trim();
  if (!workerUrl || !workerToken) throw new Error("EMAIL_WORKER_URL / EMAIL_WORKER_TOKEN are not set");
  const response = await fetch(`${workerUrl}/broadcast`, {
    method: "POST",
    headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Email worker /broadcast HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

function parseEmails(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...new Set((value.match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => e.toLowerCase()))];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const input = await req.json();
    const { password, action, days, category, search, limit } = input;
    if (password !== ADMIN_PASSWORD) return respond({ error: "Invalid password" }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "recent") {
      const { data, error } = await supabase.rpc("admin_recent_email_sends", {
        p_limit: typeof limit === "number" ? limit : 100,
        p_category: typeof category === "string" ? category : null,
        p_search: typeof search === "string" ? search : null,
      });
      if (error) return respond({ error: error.message }, 500);
      return respond({ rows: data ?? [] });
    }

    if (action === "campaigns") {
      const { data, error } = await supabase.rpc("admin_campaign_report");
      if (error) return respond({ error: error.message }, 500);
      return respond({ rows: data ?? [] });
    }

    if (action === "audience" || action === "send") {
      const audience = typeof input.audience === "string" && AUDIENCES.includes(input.audience) ? input.audience : null;
      if (!audience) return respond({ error: "Pick who gets the email." }, 400);
      const emails = audience === "emails" ? parseEmails(input.emails) : null;
      if (audience === "emails" && emails!.length === 0) return respond({ error: "Paste at least one email address." }, 400);
      const { data: recipients, error } = await supabase.rpc("admin_campaign_recipients", { p_audience: audience, p_emails: emails });
      if (error) return respond({ error: error.message }, 500);
      const list = (recipients ?? []) as Array<{ user_id: string; account_id: string; email: string; first_name: string | null }>;

      if (action === "audience") {
        return respond({ count: list.length, sample: list.slice(0, 5).map((r) => r.email) });
      }

      const draft = readDraft(input);
      if (typeof draft === "string") return respond({ error: draft }, 400);
      if (list.length === 0) return respond({ error: "Nobody matches this audience." }, 400);
      if (input.confirm_count !== list.length) {
        return respond({ error: `The audience is now ${list.length} people. Check the count and send again.`, count: list.length }, 409);
      }

      const { data: campaign, error: insertError } = await supabase.from("email_campaigns").insert({
        subject: draft.subject,
        body: draft.body,
        button_label: draft.buttonLabel || null,
        button_url: draft.buttonUrl || null,
        audience,
        recipient_count: list.length,
      }).select("id").single();
      if (insertError || !campaign) return respond({ error: insertError?.message ?? "Could not save the campaign." }, 500);

      const { html, text } = renderCampaign(draft);
      for (let i = 0; i < list.length; i += 500) {
        await sendToWorker({ campaign_id: campaign.id, subject: draft.subject, html, text, recipients: list.slice(i, i + 500) });
      }
      await supabase.from("email_campaigns").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", campaign.id);
      return respond({ campaign_id: campaign.id, queued: list.length });
    }

    if (action === "preview" || action === "test") {
      const draft = readDraft(input);
      if (typeof draft === "string") return respond({ error: draft }, 400);
      const { html, text } = renderCampaign(draft);
      if (action === "preview") {
        return respond({ html: html.replaceAll("{{first_name}}", "Priya").replaceAll("{{unsubscribe_url}}", "#") });
      }
      const to = parseEmails(input.to)[0];
      if (!to) return respond({ error: "Enter an email address for the test." }, 400);
      await sendToWorker({
        campaign_id: null,
        subject: `[Test] ${draft.subject}`,
        html,
        text,
        recipients: [{ user_id: null, account_id: null, email: to, first_name: typeof input.test_first_name === "string" ? input.test_first_name : null }],
      });
      return respond({ sent_to: to });
    }

    const { data, error } = await supabase.rpc("admin_email_report", {
      p_days: typeof days === "number" && days > 0 ? Math.floor(days) : 30,
    });
    if (error) return respond({ error: error.message }, 500);
    return respond({ report: data });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});
