import { createClient } from "npm:@supabase/supabase-js@2.49.1";

// Finds every user who has the mobile app with push (OneSignal knows them by
// external_id = Supabase user id) and records them in user_app_installs.
// The OneSignal key lives in the push worker, so this asks its /app-installs
// endpoint 100 users at a time. Run daily by the email worker before the
// morning brief (DIGEST_NOTIFY_TOKEN), or by hand with the admin password.
// { dry_run: true } reports what it found without writing.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type AppInstall = { user_id: string; platforms: string[]; first_active: number | null; last_active: number | null; known?: boolean; subscription_types?: string[] };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const notifyToken = (Deno.env.get("DIGEST_NOTIFY_TOKEN") ?? "").trim();
  const adminPassword = Deno.env.get("ADMIN_PASSWORD") || "";
  const authorized = (notifyToken && body?.token === notifyToken) || (adminPassword && body?.password === adminPassword);
  if (!authorized) return respond({ error: "Unauthorized" }, 401);

  const pushUrl = (Deno.env.get("PUSH_QUEUE_URL") ?? "").trim();
  const pushToken = (Deno.env.get("PUSH_QUEUE_TOKEN") ?? "").trim();
  if (!pushUrl || !pushToken) return respond({ error: "PUSH_QUEUE_URL / PUSH_QUEUE_TOKEN are not set" }, 500);
  const endpoint = new URL("/app-installs", pushUrl).toString();
  const dryRun = body?.dry_run === true;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const userIds: string[] = [];
    for (let page = 1; ; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(`listUsers: ${error.message}`);
      userIds.push(...data.users.map((u) => u.id));
      if (data.users.length < 1000) break;
    }

    const found: AppInstall[] = [];
    const typeCounts: Record<string, number> = {};
    let known = 0;
    let failed = 0;
    for (let i = 0; i < userIds.length; i += 100) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pushToken}` },
        body: JSON.stringify({ user_ids: userIds.slice(i, i + 100) }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`push worker /app-installs HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      const payload = await response.json() as { results: AppInstall[]; failed: string[] };
      found.push(...payload.results.filter((r) => r.platforms.length > 0));
      for (const r of payload.results) {
        if (r.known) known += 1;
        for (const t of r.subscription_types ?? []) typeCounts[t] = (typeCounts[t] ?? 0) + 1;
      }
      failed += payload.failed.length;
    }

    const rows = found.map((r) => ({
      user_id: r.user_id,
      platform: r.platforms.includes("android") ? "android" : r.platforms[0],
      first_active: r.first_active,
      last_active: r.last_active,
    }));
    if (dryRun) {
      return respond({ users: userIds.length, known_to_onesignal: known, with_app: rows.length, failed, subscription_types: typeCounts });
    }
    const { data: written, error } = await admin.rpc("record_app_installs_bulk", { p_rows: rows });
    if (error) throw new Error(`record_app_installs_bulk: ${error.message}`);
    return respond({ users: userIds.length, with_app: rows.length, recorded: written, failed });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});
