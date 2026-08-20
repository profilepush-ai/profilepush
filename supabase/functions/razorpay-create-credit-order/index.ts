import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Creates a plain one-time Razorpay Order (not a Subscription) for a credit
// top-up: 500-5000 credits in 500 increments, flat ₹1/credit. Separate from
// razorpay-create-subscription/razorpay-change-plan, which are both
// recurring-subscription-shaped and stay untouched/dormant. razorpay-webhook
// credits the purchase on payment.captured via the pending row this writes.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const INR_PAISE_PER_CREDIT = 100; // ₹1/credit
const MAX_CREDITS = 5000;

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

    const { credits } = await req.json();
    if (!Number.isInteger(credits) || credits <= 0 || credits % 500 !== 0 || credits > MAX_CREDITS) {
      return new Response(JSON.stringify({ error: "credits must be a multiple of 500, up to 5000" }), { status: 400, headers: corsHeaders });
    }

    const { data: member } = await supabaseAdmin
      .from("account_members")
      .select("account_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!member) return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: corsHeaders });

    const amountInrPaise = credits * INR_PAISE_PER_CREDIT;

    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: razorpayAuth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountInrPaise,
        currency: "INR",
        notes: {
          type: "credit_topup",
          account_id: member.account_id,
          credits: credits.toString(),
        },
      }),
    });
    const order = await orderRes.json();
    if (!order.id) throw new Error(`Razorpay order creation failed: ${JSON.stringify(order)}`);

    const { error: insertError } = await supabaseAdmin.from("credit_topup_orders").insert({
      account_id: member.account_id,
      user_id: user.id,
      razorpay_order_id: order.id,
      credits,
      amount_inr_paise: amountInrPaise,
      status: "created",
    });
    if (insertError) throw new Error(`Could not save pending top-up order: ${insertError.message}`);

    return new Response(
      JSON.stringify({
        order_id: order.id,
        key_id: getRequiredEnv("RAZORPAY_KEY_ID"),
        amount_inr_paise: amountInrPaise,
        credits,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("razorpay-create-credit-order error:", err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
  }
});
