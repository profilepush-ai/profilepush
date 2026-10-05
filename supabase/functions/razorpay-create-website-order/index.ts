import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { WEBSITE_PLAN_BONUS_CREDITS, WEBSITE_PLAN_PRICE_INR_PAISE, WEBSITE_PLAN_TERM_MONTHS } from "../_shared/website-plan.ts";

// Creates a one-time Razorpay Order for the Website Modernization plan
// (₹29,999 a year, all inclusive, with 5,000 credits). Same shape as
// razorpay-create-credit-order. razorpay-verify-website-payment or the
// webhook applies it via the pending row this writes.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function razorpayAuth(): string {
  return "Basic " + btoa(`${getRequiredEnv("RAZORPAY_KEY_ID")}:${getRequiredEnv("RAZORPAY_KEY_SECRET")}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const supabaseUser = createClient(supabaseUrl, getRequiredEnv("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: authHeader } } });
    const supabaseAdmin = createClient(supabaseUrl, getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"));

    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const { data: member } = await supabaseAdmin
      .from("account_members")
      .select("account_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!member) return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: corsHeaders });

    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: razorpayAuth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: WEBSITE_PLAN_PRICE_INR_PAISE,
        currency: "INR",
        notes: {
          type: "website_plan",
          account_id: member.account_id,
          term_months: WEBSITE_PLAN_TERM_MONTHS.toString(),
          bonus_credits: WEBSITE_PLAN_BONUS_CREDITS.toString(),
        },
      }),
    });
    const order = await orderRes.json();
    if (!order.id) throw new Error(`Razorpay order creation failed: ${JSON.stringify(order)}`);

    const { error: insertError } = await supabaseAdmin.from("website_plan_orders").insert({
      account_id: member.account_id,
      user_id: user.id,
      razorpay_order_id: order.id,
      amount_inr_paise: WEBSITE_PLAN_PRICE_INR_PAISE,
      bonus_credits: WEBSITE_PLAN_BONUS_CREDITS,
      term_months: WEBSITE_PLAN_TERM_MONTHS,
      status: "created",
    });
    if (insertError) throw new Error(`Could not save pending website order: ${insertError.message}`);

    return new Response(
      JSON.stringify({
        order_id: order.id,
        key_id: getRequiredEnv("RAZORPAY_KEY_ID"),
        amount_inr_paise: WEBSITE_PLAN_PRICE_INR_PAISE,
        bonus_credits: WEBSITE_PLAN_BONUS_CREDITS,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("razorpay-create-website-order error:", err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
  }
});
