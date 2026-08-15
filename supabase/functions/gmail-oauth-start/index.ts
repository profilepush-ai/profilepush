import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GMAIL_OAUTH_SCOPES, signOAuthState } from "../_shared/gmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function asString(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
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

    const body = await request.json<Record<string, unknown>>();
    const accountId = asString(body.account_id, 100);
    if (!accountId) return respond({ error: "account_id is required" }, 400);

    const { data: membership } = await supabaseAdmin
      .from("account_members")
      .select("account_id")
      .eq("account_id", accountId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!membership) return respond({ error: "Account access denied" }, 403);

    const clientId = Deno.env.get("GMAIL_OAUTH_CLIENT_ID");
    const redirectUri = Deno.env.get("GMAIL_OAUTH_REDIRECT_URI");
    if (!clientId || !redirectUri) return respond({ error: "Gmail integration is not configured" }, 503);

    const state = await signOAuthState(user.id, accountId);
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", GMAIL_OAUTH_SCOPES);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("state", state);

    return respond({ ok: true, url: authUrl.toString() });
  } catch (error) {
    console.error("gmail-oauth-start error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
