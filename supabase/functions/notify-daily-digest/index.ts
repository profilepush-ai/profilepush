import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Recipient = { user_id: string; account_id: string };

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const body = await request.json();

    const expectedToken = Deno.env.get("DIGEST_NOTIFY_TOKEN") ?? "";
    if (!expectedToken || body?.token !== expectedToken) {
      return respond({ error: "Unauthorized" }, 401);
    }

    const recipients = Array.isArray(body?.recipients) ? body.recipients as Recipient[] : [];
    const jobsCount = Number(body?.jobs_count ?? 0);
    const hotlistCount = Number(body?.hotlist_count ?? 0);
    if (recipients.length === 0) return respond({ inserted: 0, pushed: 0 });

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

    const title = `${jobsCount} new job${jobsCount === 1 ? "" : "s"}, ${hotlistCount} new hotlist profile${hotlistCount === 1 ? "" : "s"}`;
    const notifBody = "Your daily ProfilePush update is ready.";
    const link = "/jobs";
    const type = "daily_digest";

    // Only notify users who haven't disabled in-app notifications for this type.
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("user_id, in_app_enabled")
      .eq("notif_type", type)
      .in("user_id", recipients.map((r) => r.user_id));
    const inAppDisabled = new Set((prefs ?? []).filter((p) => p.in_app_enabled === false).map((p) => p.user_id as string));

    const rows = recipients
      .filter((r) => !inAppDisabled.has(r.user_id))
      .map((r) => ({
        id: crypto.randomUUID(),
        user_id: r.user_id,
        account_id: r.account_id,
        type,
        title,
        body: notifBody,
        link,
        read: false,
      }));

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("notifications").insert(rows);
      if (insertError) console.error("notify-daily-digest: notifications insert failed", insertError.message);
    }

    const pushUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`;
    const pushResults = await Promise.allSettled(rows.map((row) =>
      fetch(pushUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          id: row.id,
          user_id: row.user_id,
          title: row.title,
          body: row.body,
          link: row.link,
          type: row.type,
        }),
      })
    ));
    const pushed = pushResults.filter((r) => r.status === "fulfilled" && (r.value as Response).ok).length;

    return respond({ inserted: rows.length, pushed });
  } catch (error) {
    return respond({ error: (error as Error).message }, 500);
  }
});
