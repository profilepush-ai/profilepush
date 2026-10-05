import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

async function enqueuePush(
  pushQueueUrl: string,
  pushQueueToken: string,
  n: { id: string; user_id: string; title: string; body: string; link: string; type: string },
): Promise<{ ok: boolean; status: number; result: unknown }> {
  const queueResponse = await fetch(pushQueueUrl, {
    method: "POST",
    headers: { "Authorization": `Bearer ${pushQueueToken}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      id: n.id,
      user_id: n.user_id,
      title: n.title,
      body: n.body || null,
      link: n.link || null,
      type: n.type || null,
    }),
  });
  const result = await queueResponse.json().catch(() => ({}));
  return { ok: queueResponse.ok, status: queueResponse.status, result };
}

// Drain: pushes every notification not pushed yet (pushed_at is null), then
// marks it. Called every minute by pg_cron. It replaced a per-row trigger that
// needed the service role key stored in database settings, which were never
// set, so no notification had ever been pushed. Draining needs no secret from
// the caller: it only delivers rows already in the table, to their own users.
async function drain(pushQueueUrl: string, pushQueueToken: string) {
  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: pending, error } = await supabaseAdmin
    .from("notifications")
    .select("id, user_id, title, body, link, type, push_attempts")
    .is("pushed_at", null)
    .lt("push_attempts", 3)
    .gte("created_at", new Date(Date.now() - 6 * 3600_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return respond({ error: error.message }, 500);

  let sent = 0;
  let failed = 0;
  for (const row of (pending ?? []) as Array<{ id: string; user_id: string | null; title: string | null; body: string | null; link: string | null; type: string | null; push_attempts: number }>) {
    if (!row.user_id || !row.title) {
      await supabaseAdmin.from("notifications").update({ pushed_at: new Date().toISOString() }).eq("id", row.id);
      continue;
    }
    try {
      const res = await enqueuePush(pushQueueUrl, pushQueueToken, {
        id: row.id, user_id: row.user_id, title: asString(row.title, 200), body: asString(row.body, 2_000),
        link: asString(row.link, 2_000), type: asString(row.type, 100),
      });
      if (res.ok) {
        sent += 1;
        await supabaseAdmin.from("notifications").update({ pushed_at: new Date().toISOString() }).eq("id", row.id);
      } else {
        failed += 1;
        console.error("Push enqueue failed", row.id, res.status, res.result);
        await supabaseAdmin.from("notifications").update({ push_attempts: row.push_attempts + 1 }).eq("id", row.id);
      }
    } catch (error) {
      failed += 1;
      console.error("Push enqueue error", row.id, error);
      await supabaseAdmin.from("notifications").update({ push_attempts: row.push_attempts + 1 }).eq("id", row.id);
    }
  }
  return respond({ ok: true, drained: (pending ?? []).length, sent, failed });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const pushQueueUrl = Deno.env.get("PUSH_QUEUE_URL");
  const pushQueueToken = Deno.env.get("PUSH_QUEUE_TOKEN");
  if (!pushQueueUrl || !pushQueueToken) {
    console.error("PUSH_QUEUE_URL or PUSH_QUEUE_TOKEN is not configured");
    return respond({ error: "Push queue is not configured" }, 503);
  }

  const payload = await req.json().catch(() => ({})) as NotificationPayload & { mode?: unknown };
  if (payload.mode === "drain") return await drain(pushQueueUrl, pushQueueToken);

  // Single push: service role only.
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey || req.headers.get("Authorization") !== `Bearer ${serviceRoleKey}`) {
    return respond({ error: "Unauthorized" }, 401);
  }

  try {
    const notification = payload;
    const id = asString(notification.id, 100);
    const userId = asString(notification.user_id, 100);
    const title = asString(notification.title, 200);
    const body = asString(notification.body, 2_000);
    const link = asString(notification.link, 2_000);
    const type = asString(notification.type, 100);

    if (!id || !userId || !title) {
      return respond({ error: "id, user_id, and title are required" }, 400);
    }

    const res = await enqueuePush(pushQueueUrl, pushQueueToken, { id, user_id: userId, title, body, link, type });
    if (!res.ok) {
      console.error("Push enqueue failed", res.status, res.result);
      return respond({ error: "Push enqueue failed", details: res.result }, 502);
    }

    return respond({ ok: true, queued: true, notification_id: id }, 202);
  } catch (error) {
    console.error("send-push-notification error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});