import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { INR_PAISE_PER_CREDIT, isValidCreditTier } from "../_shared/credit-tiers.ts";

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

async function getOrCreatePlan(planCredits: number, supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: cached } = await supabase
    .from("razorpay_plan_cache")
    .select("razorpay_plan_id")
    .eq("plan_credits", planCredits)
    .maybeSingle();

  if (cached?.razorpay_plan_id) return cached.razorpay_plan_id;

  const amountPaise = planCredits * INR_PAISE_PER_CREDIT;
  const res = await fetch("https://api.razorpay.com/v1/plans", {
    method: "POST",
    headers: { Authorization: razorpayAuth(), "Content-Type": "application/json" },
    body: JSON.stringify({
      period: "monthly",
      interval: 1,
      item: {
        name: `ProfilePush Pro – ₹${planCredits}/mo`,
        amount: amountPaise,
        currency: "INR",
        description: `ProfilePush Pro Plan – ₹${planCredits}/month, ${planCredits} credits every cycle`,
      },
    }),
  });

  const plan = await res.json();
  if (!plan.id) throw new Error(`Razorpay plan creation failed: ${JSON.stringify(plan)}`);

  await supabase.from("razorpay_plan_cache").insert({ plan_credits: planCredits, razorpay_plan_id: plan.id });
  return plan.id as string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const supabaseAnonKey = getRequiredEnv("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseUser = createClient(
      supabaseUrl,
      supabaseAnonKey,
      { global: { headers: { Authorization: authHeader } } }
    );
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const { plan_credits } = await req.json();
    if (!isValidCreditTier(plan_credits)) {
      return new Response(JSON.stringify({ error: "Invalid plan amount" }), { status: 400, headers: corsHeaders });
    }

    // Get account
    const { data: member } = await supabaseAdmin
      .from("account_members")
      .select("account_id, role")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!member) return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: corsHeaders });
    if (member.role !== "owner") return new Response(JSON.stringify({ error: "Only account owners can manage subscriptions" }), { status: 403, headers: corsHeaders });

    // Check for existing active subscription
    const { data: existingSub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("account_id", member.account_id)
      .maybeSingle();
    if (existingSub?.status === "active") {
      return new Response(JSON.stringify({ error: "Account already has an active subscription" }), { status: 400, headers: corsHeaders });
    }

    const planId = await getOrCreatePlan(plan_credits, supabaseAdmin);

    // Create Razorpay subscription
    const res = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: { Authorization: razorpayAuth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: planId,
        quantity: 1,
        total_count: 120,
        notify_info: {
          notify_email: user.email,
          notify_sms: false,
          notify_whatsapp: false,
        },
        notes: { account_id: member.account_id },
      }),
    });

    const rzpSub = await res.json();
    if (!rzpSub.id) throw new Error(`Razorpay subscription creation failed: ${JSON.stringify(rzpSub)}`);

    // Upsert subscription record
    await supabaseAdmin.from("subscriptions").upsert({
      account_id: member.account_id,
      razorpay_subscription_id: rzpSub.id,
      razorpay_plan_id: planId,
      plan_credits,
      pending_plan_credits: null,
      cancel_at_period_end: false,
      status: "pending",
      updated_at: new Date().toISOString(),
    }, { onConflict: "account_id" });

    fireCrmWebhook(
      supabaseUrl,
      supabaseServiceRoleKey,
      "subscription.checkout_initiated",
      member.account_id,
      {
        plan_credits,
        amount_inr: plan_credits,
        razorpay_subscription_id: rzpSub.id,
        user_id: user.id,
        email: user.email,
        phone: user.phone ?? user.user_metadata?.phone ?? null,
        name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
      }
    );

    return new Response(
      JSON.stringify({
        subscription_id: rzpSub.id,
        key_id: getRequiredEnv("RAZORPAY_KEY_ID"),
        plan_credits,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("razorpay-create-subscription error:", err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
  }
});
