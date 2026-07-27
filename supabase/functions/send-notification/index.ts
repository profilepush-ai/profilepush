import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { user_id, account_id, type, title, body, link } = await req.json();

    if (!user_id || !account_id || !type || !title) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: user_id, account_id, type, title" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load user preference for this notification type
    const { data: pref } = await supabase
      .from("notification_preferences")
      .select("in_app_enabled")
      .eq("user_id", user_id)
      .eq("notif_type", type)
      .maybeSingle();

    const inApp = pref ? pref.in_app_enabled : true;

    // ── In-App notification ──────────────────────────────────────────────────
    if (inApp) {
      await supabase.from("notifications").insert({
        user_id,
        account_id,
        type,
        title,
        body: body ?? null,
        link: link ?? null,
        read: false,
      });
    }

    // ── External webhook notification (WhatsApp, email, etc.) ────────────────
    // Delegate all external delivery to the CRM webhook
    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-crm-webhook`;
    fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        event: `notification.${type}`,
        account_id,
        user_id,
        title,
        body: body ?? null,
        link: link ?? null,
      }),
    }).catch((err) => console.error("Webhook relay error:", err));

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
