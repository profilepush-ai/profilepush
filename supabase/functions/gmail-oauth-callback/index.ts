import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptToken, verifyOAuthState } from "../_shared/gmail.ts";

// Google redirects the user's browser here directly with a GET request — there is no
// Supabase session/Authorization header available. Identity is instead recovered from
// the signed `state` param minted by gmail-oauth-start.

function redirectToApp(status: "connected" | "error", returnTo?: string | null, detail?: string) {
  const appUrl = Deno.env.get("GMAIL_OAUTH_APP_URL")!;
  const url = new URL(returnTo || "/account", appUrl);
  if (!returnTo) url.searchParams.set("section", "integrations");
  url.searchParams.set("gmail", status);
  if (detail) url.searchParams.set("gmail_error", detail.slice(0, 200));
  return Response.redirect(url.toString(), 302);
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error");
  if (oauthError) return redirectToApp("error", null, oauthError);

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !state) return redirectToApp("error", null, "missing_code_or_state");

  // Hoisted above the try block so the catch handler below can still send the
  // user back to where they started even if a later step throws — state
  // verification is the only step that can recover this value.
  let returnTo: string | null = null;

  try {
    const verified = await verifyOAuthState(state);
    if (!verified) return redirectToApp("error", null, "invalid_state");
    returnTo = verified.returnTo;

    const clientId = Deno.env.get("GMAIL_OAUTH_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GMAIL_OAUTH_CLIENT_SECRET")!;
    const redirectUri = Deno.env.get("GMAIL_OAUTH_REDIRECT_URI")!;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({})) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
    };
    if (!tokenResponse.ok || !tokenPayload.access_token || !tokenPayload.refresh_token) {
      // A user re-connecting without Google prompting for consent again won't receive
      // a refresh_token; access_type=offline + prompt=consent on the start side avoids
      // this in the normal flow, but surface a clear error if it happens anyway.
      return redirectToApp("error", returnTo, tokenPayload.error ?? "token_exchange_failed");
    }

    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const userInfo = await userInfoResponse.json().catch(() => ({})) as { email?: string };
    const gmailAddress = (userInfo.email ?? "").trim().toLowerCase();
    if (!userInfoResponse.ok || !gmailAddress) return redirectToApp("error", returnTo, "could_not_read_gmail_address");

    const encryptionKey = Deno.env.get("GMAIL_TOKEN_ENCRYPTION_KEY")!;
    const [encryptedAccess, encryptedRefresh] = await Promise.all([
      encryptToken(tokenPayload.access_token, encryptionKey),
      encryptToken(tokenPayload.refresh_token, encryptionKey),
    ]);

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error: upsertError } = await supabaseAdmin
      .from("gmail_integrations")
      .upsert({
        user_id: verified.userId,
        account_id: verified.accountId,
        gmail_address: gmailAddress,
        scopes: tokenPayload.scope ?? "",
        access_token_encrypted: encryptedAccess.ciphertext,
        access_token_iv: encryptedAccess.iv,
        access_token_expires_at: new Date(Date.now() + (tokenPayload.expires_in ?? 3600) * 1000).toISOString(),
        refresh_token_encrypted: encryptedRefresh.ciphertext,
        refresh_token_iv: encryptedRefresh.iv,
        status: "connected",
        last_error: null,
        connected_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    if (upsertError) {
      console.error("gmail-oauth-callback upsert failed", upsertError);
      return redirectToApp("error", returnTo, "could_not_save_connection");
    }

    return redirectToApp("connected", returnTo);
  } catch (error) {
    console.error("gmail-oauth-callback error", error);
    return redirectToApp("error", returnTo, "internal_error");
  }
});
