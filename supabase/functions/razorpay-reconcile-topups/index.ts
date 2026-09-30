import { createClient } from "npm:@supabase/supabase-js@2";

// Admin-only safety net: checks every pending credit top-up against Razorpay
// and credits the ones that were actually paid (captured), through the same
// apply_credit_topup the checkout and the webhook use, so nothing is credited
// twice. Uses the admin dashboard password.
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
    const { password, days } = await req.json();
    if (password !== ADMIN_PASSWORD) return respond({ error: "Invalid password" }, 401);
    const lookback = typeof days === "number" && days > 0 ? Math.min(days, 180) : 60;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = `Basic ${btoa(`${Deno.env.get("RAZORPAY_KEY_ID")}:${Deno.env.get("RAZORPAY_KEY_SECRET")}`)}`;
    const { data: pending, error } = await supabase
      .from("credit_topup_orders").select("razorpay_order_id, credits, created_at")
      .eq("status", "created")
      .gte("created_at", new Date(Date.now() - lookback * 86_400_000).toISOString());
    if (error) return respond({ error: error.message }, 500);

    const results: Array<Record<string, unknown>> = [];
    for (const order of pending ?? []) {
      const res = await fetch(`https://api.razorpay.com/v1/orders/${order.razorpay_order_id}/payments`, { headers: { Authorization: auth } });
      const body = await res.json().catch(() => ({}));
      const payments = (body.items ?? []) as Array<{ id: string; status: string; amount: number }>;
      const captured = payments.find((p) => p.status === "captured");
      if (!captured) {
        results.push({ order: order.razorpay_order_id, outcome: "not_paid", statuses: payments.map((p) => p.status) });
        continue;
      }
      const { data, error: applyError } = await supabase.rpc("apply_credit_topup", {
        p_razorpay_order_id: order.razorpay_order_id,
        p_razorpay_payment_id: captured.id,
      });
      const row = (data ?? [])[0];
      results.push({ order: order.razorpay_order_id, payment: captured.id, outcome: applyError ? `error: ${applyError.message}` : row?.credited ? "credited" : "already_credited", credits: row?.credits, balance: row?.new_balance });
    }
    // Read-only: what Razorpay says about subscriptions we still hold as
    // pending, so a paid-but-unactivated subscription can't go unnoticed.
    const { data: subs } = await supabase
      .from("subscriptions").select("account_id, razorpay_subscription_id, status, plan_credits")
      .in("status", ["pending", "created"]);
    const subscriptions: Array<Record<string, unknown>> = [];
    for (const sub of subs ?? []) {
      if (!sub.razorpay_subscription_id) { subscriptions.push({ account_id: sub.account_id, razorpay: "no id" }); continue; }
      const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${sub.razorpay_subscription_id}`, { headers: { Authorization: auth } });
      const body = await res.json().catch(() => ({}));
      subscriptions.push({
        account_id: sub.account_id,
        subscription: sub.razorpay_subscription_id,
        ours: sub.status,
        razorpay: body.status ?? body.error?.description ?? res.status,
        paid_count: body.paid_count ?? null,
      });
    }
    return respond({ checked: pending?.length ?? 0, results, subscriptions });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});
