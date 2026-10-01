import { createClient } from "npm:@supabase/supabase-js@2.49.1";

// One-tap claim, opened straight from an outreach email:
//   GET /functions/v1/claim-profile?t=<claim token>
// The token (profile_claim_tokens, single use, 14 days) stands for one
// publisher profile. A good token signs the person in as that profile's email
// address with a magic link, creating the account if they don't have one, and
// lands them on their profile; the app then sets up their account and claims
// the profile (ensureAccountForUser -> claim_my_publisher_profile), since a
// magic-link sign-in confirms the address. A used, expired or unknown token
// goes to the profile page with the reason, where they can sign up instead.
//
// Deployed with --no-verify-jwt: it's opened from an email, with no session.

const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") || "https://profilepush.ai").replace(/\/$/, "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!UUID.test(token)) return redirect(`${APP_BASE_URL}/signup`);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data, error } = await admin.rpc("use_profile_claim_token", { p_token: token });
    if (error) throw new Error(error.message);
    const row = ((data ?? []) as Array<{ ok: boolean; reason: string | null; email: string | null; slug: string | null }>)[0];
    if (!row?.ok || !row.email || !row.slug) {
      return redirect(row?.slug ? `${APP_BASE_URL}/profile/${encodeURIComponent(row.slug)}?claim=${row.reason ?? "invalid"}` : `${APP_BASE_URL}/signup`);
    }

    const redirectTo = `${APP_BASE_URL}/profile/${encodeURIComponent(row.slug)}?claimed=1`;
    let link = await admin.auth.admin.generateLink({ type: "magiclink", email: row.email, options: { redirectTo } });
    if (link.error) {
      // No account with that address yet: create it, confirmed (they reached
      // this from their own inbox), then sign them in.
      const created = await admin.auth.admin.createUser({ email: row.email, email_confirm: true });
      if (created.error) throw new Error(`createUser: ${created.error.message}`);
      link = await admin.auth.admin.generateLink({ type: "magiclink", email: row.email, options: { redirectTo } });
      if (link.error) throw new Error(`generateLink: ${link.error.message}`);
    }
    const actionLink = link.data?.properties?.action_link;
    if (!actionLink) throw new Error("generateLink returned no action_link");
    return redirect(actionLink);
  } catch (err) {
    console.error("claim-profile failed", (err as Error).message);
    return redirect(`${APP_BASE_URL}/signin`);
  }
});
