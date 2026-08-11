const ONESIGNAL_APP_ID = "fbf333e8-0931-4545-ac03-c532cc07d225";
const ONESIGNAL_API_URL = "https://api.onesignal.com/notifications";

export interface Env {
  PUSH_QUEUE: Queue<PushJob>;
  PUSH_QUEUE_TOKEN: string;
  ONESIGNAL_REST_API_KEY: string;
}

type PushJob = {
  id: string;
  user_id: string;
  type: string | null;
  title: string;
  body: string | null;
  link: string | null;
  enqueued_at: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getBearerToken(request: Request) {
  const [scheme, token] = (request.headers.get("Authorization") ?? "").split(" ");
  return scheme?.toLowerCase() === "bearer" ? (token ?? "").trim() : "";
}

function asString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parsePushJob(value: unknown): PushJob | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const id = asString(source.id, 100);
  const userId = asString(source.user_id, 100);
  const title = asString(source.title, 200);
  if (!id || !userId || !title) return null;

  return {
    id,
    user_id: userId,
    type: asString(source.type, 100) || null,
    title,
    body: asString(source.body, 2_000) || null,
    link: asString(source.link, 2_000) || null,
    enqueued_at: new Date().toISOString(),
  };
}

async function deliverPush(job: PushJob, env: Env) {
  const response = await fetch(ONESIGNAL_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Key ${env.ONESIGNAL_REST_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      include_aliases: { external_id: [job.user_id] },
      target_channel: "push",
      headings: { en: job.title },
      contents: { en: job.body || job.title },
      data: { notification_id: job.id, link: job.link, type: job.type },
      idempotency_key: job.id,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OneSignal HTTP ${response.status}: ${details.slice(0, 500)}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "GET") return jsonResponse({ status: "ok" });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    if (!env.PUSH_QUEUE_TOKEN || getBearerToken(request) !== env.PUSH_QUEUE_TOKEN) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const job = parsePushJob(payload);
    if (!job) return jsonResponse({ error: "id, user_id, and title are required" }, 400);

    await env.PUSH_QUEUE.send(job, { contentType: "json" });
    return jsonResponse({ accepted: true, notification_id: job.id }, 202);
  },

  async queue(batch: MessageBatch<PushJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await deliverPush(message.body, env);
        console.log("Push delivered", message.body.id);
        message.ack();
      } catch (error) {
        console.error("Push delivery failed", message.body.id, error);
        message.retry();
      }
    }
  },
};