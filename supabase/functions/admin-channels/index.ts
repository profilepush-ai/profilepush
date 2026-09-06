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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const body = await request.json();
    const adminPassword = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";
    if (body?.password !== adminPassword) return respond({ error: "Invalid password" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const action = String(body?.action ?? "list_channels");

    if (action === "list_channels") {
      const { data, error } = await supabase
        .from("admin_channels")
        .select("id, slug, name, created_at")
        .order("created_at", { ascending: true });
      if (error) return respond({ error: error.message }, 500);
      return respond({ channels: data ?? [] });
    }

    const channelSlug = String(body?.channel_slug ?? "");
    if (!channelSlug) return respond({ error: "channel_slug is required" }, 400);

    const { data: channel, error: channelError } = await supabase
      .from("admin_channels")
      .select("id, slug, name")
      .eq("slug", channelSlug)
      .maybeSingle();
    if (channelError) return respond({ error: channelError.message }, 500);
    if (!channel) return respond({ error: "Unknown channel" }, 404);

    if (action === "list_messages") {
      const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 200);
      const before = body?.before ? String(body.before) : null;

      let query = supabase
        .from("admin_channel_messages")
        .select("id, kind, body, metadata, author_label, created_at")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (before) query = query.lt("created_at", before);

      const { data, error } = await query;
      if (error) return respond({ error: error.message }, 500);
      // Newest-first from the query (for cursor pagination), flipped to
      // oldest-first here since that's how a chat feed renders.
      return respond({ messages: (data ?? []).reverse() });
    }

    if (action === "post_message") {
      const messageBody = String(body?.body ?? "").trim();
      if (!messageBody) return respond({ error: "body is required" }, 400);
      const authorLabel = body?.author_label ? String(body.author_label) : "Admin";

      const { data, error } = await supabase
        .from("admin_channel_messages")
        .insert({
          channel_id: channel.id,
          kind: "text",
          body: messageBody,
          author_label: authorLabel,
        })
        .select("id, kind, body, metadata, author_label, created_at")
        .single();
      if (error) return respond({ error: error.message }, 400);
      return respond({ message: data });
    }

    return respond({ error: "Unsupported action" }, 400);
  } catch (error) {
    return respond({ error: (error as Error).message }, 500);
  }
});
