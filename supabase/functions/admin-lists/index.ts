import { createClient } from "npm:@supabase/supabase-js@2.49.1";

// Admin > Lists: vendor / bench sales contact lists for bulk email. Same
// admin password as admin-stats; the list itself comes from
// admin_publisher_list (service role only).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const { password, action, kind, days, unjoined_only, source, emails } = await req.json();
    if (password !== ADMIN_PASSWORD) return respond({ error: "Invalid password" }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Import a file's addresses into the Imported list.
    if (action === "import") {
      if (!Array.isArray(emails) || emails.length === 0) return respond({ error: "emails is required" }, 400);
      if (emails.length > 50000) return respond({ error: "At most 50,000 addresses per import" }, 400);
      const { data, error } = await supabase.rpc("admin_import_email_contacts", {
        p_source: typeof source === "string" ? source : "import",
        p_emails: emails.filter((e: unknown) => typeof e === "string"),
      });
      if (error) return respond({ error: error.message }, 500);
      return respond({ result: data });
    }

    if (kind === "imported") {
      const { data, error } = await supabase.rpc("admin_imported_list", { p_unjoined_only: unjoined_only !== false });
      if (error) return respond({ error: error.message }, 500);
      return respond({ rows: data ?? [] });
    }

    if (kind !== "vendors" && kind !== "bench-sales") return respond({ error: "kind must be vendors, bench-sales or imported" }, 400);
    const windowDays = typeof days === "number" && days > 0 ? Math.min(Math.floor(days), 3650) : null;
    const { data, error } = await supabase.rpc("admin_publisher_list", {
      p_kind: kind,
      p_days: windowDays,
      p_unjoined_only: unjoined_only !== false,
    });
    if (error) return respond({ error: error.message }, 500);
    return respond({ rows: data ?? [] });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});
