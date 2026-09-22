// Admin inbox for things that need a human: feature requests users have
// registered, and anything else the platform wants surfaced rather than
// buried in a table nobody opens.
//
// Password-gated like the other admin-* functions, on the service-role key.
// Accounts and emails are joined in here rather than in the browser so the
// page can show who asked without granting the client any cross-account read.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const REQUEST_LABELS: Record<string, string> = {
  outlook_send: "Send via Outlook",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const payload = await req.json();
    if (payload.password !== ADMIN_PASSWORD) return jsonResponse({ error: "Invalid password" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const action = String(payload.action ?? "list");

    if (action === "list") {
      const { data: requests, error } = await supabase
        .from("platform_requests")
        .select("id, account_id, user_id, request_type, note, status, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);

      const rows = requests ?? [];
      const accountIds = [...new Set(rows.map((r) => r.account_id).filter(Boolean))];
      const { data: accounts } = accountIds.length
        ? await supabase.from("accounts").select("id, name, is_trial").in("id", accountIds)
        : { data: [] as Array<{ id: string; name: string; is_trial: boolean }> };
      const accountById = new Map((accounts ?? []).map((a) => [a.id, a]));

      // Who asked, resolved one at a time because auth.users is not joinable
      // from PostgREST. Capped at the page size, so this stays bounded.
      const emailByUser = new Map<string, string>();
      await Promise.all([...new Set(rows.map((r) => r.user_id).filter(Boolean))].map(async (userId) => {
        const { data } = await supabase.auth.admin.getUserById(userId as string);
        if (data?.user?.email) emailByUser.set(userId as string, data.user.email);
      }));

      const notifications = rows.map((row) => ({
        id: row.id,
        kind: "feature_request",
        label: REQUEST_LABELS[row.request_type] ?? row.request_type,
        request_type: row.request_type,
        status: row.status,
        note: row.note,
        created_at: row.created_at,
        account_name: accountById.get(row.account_id)?.name ?? "—",
        is_trial: accountById.get(row.account_id)?.is_trial ?? null,
        user_email: row.user_id ? emailByUser.get(row.user_id) ?? "—" : "—",
      }));

      // The count that decides whether a feature gets built is how many
      // distinct accounts asked, not how many rows exist.
      const demand: Record<string, number> = {};
      for (const row of rows) {
        demand[row.request_type] = (demand[row.request_type] ?? 0) + 1;
      }

      return jsonResponse({
        notifications,
        unread: notifications.filter((n) => n.status === "new").length,
        demand,
      });
    }

    if (action === "set_status") {
      const id = String(payload.id ?? "");
      const status = String(payload.status ?? "");
      if (!id || !["new", "seen", "done", "declined"].includes(status)) {
        return jsonResponse({ error: "id and a valid status are required" }, 400);
      }
      const { error } = await supabase
        .from("platform_requests")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
