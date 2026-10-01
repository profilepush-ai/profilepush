import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { FIRST_PURCHASE_OFFER_PACKS, INR_PAISE_PER_CREDIT, isValidCreditPack } from "../_shared/credit-tiers.ts";

// Creates a plain one-time Razorpay Order (not a Subscription) for a credit
// top-up: a 249 starter pack or 500-5000 credits in 500 increments, flat
// ₹1/credit. Separate from
// razorpay-create-subscription/razorpay-change-plan, which bill the same
// tiers/rate on a recurring monthly cadence instead of one time.
// razorpay-webhook credits the purchase on payment.captured via the
// pending row this writes.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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
    if (!isValidCreditPack(credits)) {
      return new Response(JSON.stringify({ error: "credits must be 249, or a multiple of 500 up to 5000" }), { status: 400, headers: corsHeaders });
    }

    const { data: member } = await supabaseAdmin
      .from("account_members")
      .select("account_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!member) return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: corsHeaders });

    const amountInrPaise = credits * INR_PAISE_PER_CREDIT;

    // First-purchase offer: while it's live, the 249 and 500 packs come with
    // as many bonus credits again (other packs are unchanged).
    // apply_credit_topup adds the bonus once, on the first paid order.
    let bonusCredits = 0;
    if (FIRST_PURCHASE_OFFER_PACKS.includes(credits)) {
      const { data: offerActive } = await supabaseAdmin.rpc("first_purchase_offer_active", { p_account_id: member.account_id });
      if (offerActive === true) bonusCredits = credits;
    }

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
          bonus_credits: bonusCredits.toString(),
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
      bonus_credits: bonusCredits,
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
        bonus_credits: bonusCredits,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("razorpay-create-credit-order error:", err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
  }
});
