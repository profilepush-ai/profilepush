import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

  const pushQueueUrl = Deno.env.get("PUSH_QUEUE_URL");
  const pushQueueToken = Deno.env.get("PUSH_QUEUE_TOKEN");
  if (!pushQueueUrl || !pushQueueToken) {
    console.error("PUSH_QUEUE_URL or PUSH_QUEUE_TOKEN is not configured");
    return respond({ error: "Push queue is not configured" }, 503);
  }

  try {
    const notification = await req.json() as NotificationPayload;
    const id = asString(notification.id, 100);
    const userId = asString(notification.user_id, 100);
    const title = asString(notification.title, 200);
    const body = asString(notification.body, 2_000);
    const link = asString(notification.link, 2_000);
    const type = asString(notification.type, 100);

    if (!id || !userId || !title) {
      return respond({ error: "id, user_id, and title are required" }, 400);
    }

    const queueResponse = await fetch(pushQueueUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${pushQueueToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        id,
        user_id: userId,
        title,
        body: body || null,
        link: link || null,
        type: type || null,
      }),
    });

    const result = await queueResponse.json().catch(() => ({}));
    if (!queueResponse.ok) {
      console.error("Push enqueue failed", queueResponse.status, result);
      return respond({ error: "Push enqueue failed", details: result }, 502);
    }

    return respond({ ok: true, queued: true, notification_id: id }, 202);
  } catch (error) {
    console.error("send-push-notification error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});