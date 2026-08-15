import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptToken } from "../_shared/gmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const supabaseUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return respond({ error: "Unauthorized" }, 401);

    const { data: integration } = await supabaseAdmin
      .from("gmail_integrations")
      .select("id, refresh_token_encrypted, refresh_token_iv, status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!integration) return respond({ ok: true, already_disconnected: true });

    // Best-effort revoke with Google — a failure here shouldn't block the user from
    // disconnecting in our system, since we're about to stop using the token either way.
    if (integration.status === "connected") {
      try {
        const encryptionKey = Deno.env.get("GMAIL_TOKEN_ENCRYPTION_KEY")!;
        const refreshToken = await decryptToken(integration.refresh_token_encrypted, integration.refresh_token_iv, encryptionKey);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: AbortSignal.timeout(10_000),
        });
      } catch (revokeError) {
        console.error("gmail-oauth-disconnect revoke failed (continuing)", revokeError);
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from("gmail_integrations")
      .update({ status: "disconnected", last_error: null })
      .eq("id", integration.id);
    if (updateError) throw updateError;

    return respond({ ok: true });
  } catch (error) {
    console.error("gmail-oauth-disconnect error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
