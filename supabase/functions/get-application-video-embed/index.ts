import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Resolves a Cloudflare Stream video UID (stored on a
// job_application_screening_turns row) into a playable iframe URL. Kept
// server-side rather than exposed to the frontend directly for two reasons:
// 1) the CLOUDFLARE_STREAM_API_TOKEN must never reach the browser
// 2) the "customer-<code>.cloudflarestream.com" embed domain is
//    account-specific and only discoverable via the Stream API, so it's
//    resolved here from the video's own playback URLs rather than hardcoded.
// Authorization is delegated to Postgres RLS: the turn is looked up using
// the caller's own session (anon key + their Authorization header), so this
// only succeeds if select_job_application_screening_turns already lets them
// see that row (submitting recruiter or the job's poster).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const accountId = (Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? "").trim();
  const streamToken = (Deno.env.get("CLOUDFLARE_STREAM_API_TOKEN") ?? "").trim();

  if (!accountId || !streamToken) {
    return respond({ error: "Video playback is not configured yet" }, 500);
  }

  try {
    const body = await req.json().catch(() => ({})) as { turnId?: string };
    const turnId = typeof body.turnId === "string" ? body.turnId.trim() : "";
    if (!turnId) return respond({ error: "turnId is required" }, 400);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: turn, error: turnError } = await userClient
      .from("job_application_screening_turns")
      .select("id, video_stream_uid")
      .eq("id", turnId)
      .maybeSingle();
    if (turnError) return respond({ error: turnError.message }, 500);
    if (!turn) return respond({ error: "Not found" }, 404);
    if (!turn.video_stream_uid) return respond({ error: "This question has not been answered yet" }, 404);

    const streamRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${turn.video_stream_uid}`,
      { headers: { Authorization: `Bearer ${streamToken}` } },
    );
    const streamPayload = await streamRes.json() as {
      result?: { playback?: { hls?: string }; status?: { state?: string } };
      errors?: unknown;
    };
    if (!streamRes.ok || !streamPayload.result?.playback?.hls) {
      return respond({ error: "Could not load this video", details: streamPayload.errors }, 502);
    }

    const playbackOrigin = new URL(streamPayload.result.playback.hls).origin;
    const iframeUrl = `${playbackOrigin}/${turn.video_stream_uid}/iframe`;

    return respond({ iframeUrl, status: streamPayload.result.status?.state ?? "unknown" });
  } catch (error) {
    console.error("get-application-video-embed error", error);
    return respond({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
