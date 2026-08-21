import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Cancels at the end of the current billing cycle (not immediately) — a
// customer who already paid for this cycle keeps their Pro credit grant
// and access through current_period_end. razorpay-webhook's
// subscription.cancelled handler flips status to 'cancelled' once Razorpay
// actually ends it; this just schedules that with Razorpay and marks
// cancel_at_period_end so BillingPage can show "cancels on <date>".

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function fireCrmWebhook(supabaseUrl: string, serviceRoleKey: string, event: string, accountId: string, extra: Record<string, unknown>) {
  fetch(`${supabaseUrl}/functions/v1/notify-crm-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
    body: JSON.stringify({ event, account_id: accountId, ...extra }),
  }).catch((err) => console.error("notify-crm-webhook call failed:", err));
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function razorpayAuth(): string {
  const key = getRequiredEnv("RAZORPAY_KEY_ID");
  const secret = getRequiredEnv("RAZORPAY_KEY_SECRET");
  return "Basic " + btoa(`${key}:${secret}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const supabaseAnonKey = getRequiredEnv("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const { data: member } = await supabaseAdmin
      .from("account_members")
      .select("account_id, role")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!member) return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: corsHeaders });
    if (member.role !== "owner") return new Response(JSON.stringify({ error: "Only account owners can manage subscriptions" }), { status: 403, headers: corsHeaders });

    const { data: dbSub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("account_id", member.account_id)
      .maybeSingle();
    if (!dbSub || dbSub.status !== "active") {
      return new Response(JSON.stringify({ error: "No active subscription found" }), { status: 400, headers: corsHeaders });
    }
    if (dbSub.cancel_at_period_end) {
      return new Response(JSON.stringify({ error: "Cancellation already scheduled" }), { status: 400, headers: corsHeaders });
    }

    const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${dbSub.razorpay_subscription_id}/cancel`, {
      method: "POST",
      headers: { Authorization: razorpayAuth(), "Content-Type": "application/json" },
      body: JSON.stringify({ cancel_at_cycle_end: 1 }),
    });
    const rzpResult = await res.json();
    if (!res.ok) throw new Error(`Razorpay cancellation failed: ${JSON.stringify(rzpResult)}`);

    await supabaseAdmin.from("subscriptions").update({
      cancel_at_period_end: true,
      updated_at: new Date().toISOString(),
    }).eq("account_id", member.account_id);

    fireCrmWebhook(supabaseUrl, supabaseServiceRoleKey, "subscription.cancel_scheduled", member.account_id, {
      plan_credits: dbSub.plan_credits,
      effective_date: dbSub.current_period_end,
      razorpay_subscription_id: dbSub.razorpay_subscription_id,
      user_id: user.id,
      email: user.email,
    });

    return new Response(
      JSON.stringify({ ok: true, effective_date: dbSub.current_period_end }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("razorpay-cancel-subscription error:", err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
  }
});
