import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Drafts a short in-app chat message for a post_chat thread. Thin proxy onto
// the existing profilepush-social-job-parser Cloudflare Worker (Workers AI),
// same infra and CLOUDFLARE_WORKER_URL/CLOUDFLARE_WORKER_TOKEN already used
// by extract-post-fields, rather than a direct model call. The draft is
// returned for the user to review/edit before sending — this function never
// sends anything itself; sending still goes through send_post_chat_message.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

type DetailInput = { label?: unknown; value?: unknown };
type MessageInput = { direction?: unknown; text?: unknown };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonError("Unauthorized", 401);
  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return jsonError("Unauthorized", 401);
  } catch {
    return jsonError("Unauthorized", 401);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const title = String(body?.title ?? "").trim().slice(0, 300);
  const isHotlist = Boolean(body?.is_hotlist);
  const details = Array.isArray(body?.details)
    ? (body.details as DetailInput[])
      .map((d) => ({ label: String(d?.label ?? "").trim().slice(0, 40), value: String(d?.value ?? "").trim().slice(0, 120) }))
      .filter((d) => d.label && d.value)
      .slice(0, 10)
    : [];
  const recentMessages = Array.isArray(body?.recent_messages)
    ? (body.recent_messages as MessageInput[])
      .map((m) => ({
        direction: m?.direction === "outbound" ? "outbound" as const : "inbound" as const,
        text: String(m?.text ?? "").trim().slice(0, 600),
      }))
      .filter((m) => m.text)
      .slice(-8)
    : [];
  const instruction = String(body?.instruction ?? "").trim().slice(0, 300);

  const workerUrl = (Deno.env.get("CLOUDFLARE_WORKER_URL") ?? "").trim();
  const workerToken = (Deno.env.get("CLOUDFLARE_WORKER_TOKEN") ?? "").trim();
  if (!workerUrl) return jsonError("Message drafting service is not configured", 500);

  let workerResponse: Response;
  try {
    workerResponse = await fetch(`${workerUrl.replace(/\/$/, "")}/generate-chat-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
      },
      body: JSON.stringify({ title, isHotlist, details, recentMessages, instruction }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return jsonError(`Could not reach the drafting service: ${(error as Error).message}`, 503);
  }

  const payload = await workerResponse.json().catch(() => ({} as Record<string, unknown>));
  if (!workerResponse.ok || !payload?.message) {
    return jsonError(String(payload?.error ?? `Drafting service HTTP ${workerResponse.status}`), 502);
  }

  return new Response(JSON.stringify({ ok: true, message: payload.message }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});
