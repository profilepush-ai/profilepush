import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ONESIGNAL_APP_ID = "fbf333e8-0931-4545-ac03-c532cc07d225";
const ONESIGNAL_API_URL = "https://api.onesignal.com/notifications";

type NotificationPayload = {
  id?: unknown;
  user_id?: unknown;
  title?: unknown;
  body?: unknown;
  link?: unknown;
  type?: unknown;
};

function respond(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey || req.headers.get("Authorization") !== `Bearer ${serviceRoleKey}`) {
    return respond({ error: "Unauthorized" }, 401);
  }

  const oneSignalApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
  if (!oneSignalApiKey) {
    console.error("ONESIGNAL_REST_API_KEY is not configured");
    return respond({ error: "Push delivery is not configured" }, 503);
  }

  try {
    const notification = await req.json() as NotificationPayload;
    const id = asString(notification.id, 100);
    const userId = asString(notification.user_id, 100);
    const title = asString(notification.title, 200);
    const body = asString(notification.body, 2_000) || title;
    const link = asString(notification.link, 2_000);
    const type = asString(notification.type, 100);

    if (!id || !userId || !title) {
      return respond({ error: "id, user_id, and title are required" }, 400);
    }

    const oneSignalResponse = await fetch(ONESIGNAL_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Key ${oneSignalApiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        include_aliases: { external_id: [userId] },
        target_channel: "push",
        headings: { en: title },
        contents: { en: body },
        data: { notification_id: id, link: link || null, type: type || null },
        idempotency_key: id,
      }),
    });

    const result = await oneSignalResponse.json().catch(() => ({}));
    if (!oneSignalResponse.ok) {
      console.error("OneSignal delivery failed", oneSignalResponse.status, result);
      return respond({ error: "OneSignal delivery failed", details: result }, 502);
    }

    return respond({ ok: true, one_signal_id: result.id ?? null });
  } catch (error) {
    console.error("send-push-notification error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});