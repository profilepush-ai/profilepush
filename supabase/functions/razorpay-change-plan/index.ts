import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const VALID_PLAN_AMOUNTS = [25, 50, 100, 200, 300, 500];
const INR_PER_USD = 100;

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

async function getOrCreatePlan(amountUsd: number, supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: cached } = await supabase
    .from("razorpay_plan_cache")
    .select("razorpay_plan_id")
    .eq("amount_usd", amountUsd)
    .maybeSingle();

  if (cached?.razorpay_plan_id) return cached.razorpay_plan_id;

  const amountPaise = amountUsd * INR_PER_USD * 100;
  const res = await fetch("https://api.razorpay.com/v1/plans", {
    method: "POST",
    headers: { Authorization: razorpayAuth(), "Content-Type": "application/json" },
    body: JSON.stringify({
      period: "monthly",
      interval: 1,
      item: {
        name: `ProfilePush Pro – $${amountUsd}/mo`,
        amount: amountPaise,
        currency: "INR",
        description: `ProfilePush Pro Plan – $${amountUsd}/month, ${amountUsd} credits`,
      },
    }),
  });

  const plan = await res.json();
  if (!plan.id) throw new Error(`Razorpay plan creation failed: ${JSON.stringify(plan)}`);

  await supabase.from("razorpay_plan_cache").insert({ amount_usd: amountUsd, razorpay_plan_id: plan.id });
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

    const { new_plan_amount_usd } = await req.json();
    if (!VALID_PLAN_AMOUNTS.includes(new_plan_amount_usd)) {
      return new Response(JSON.stringify({ error: "Invalid plan amount" }), { status: 400, headers: corsHeaders });
    }

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

    const oldAmount = dbSub.plan_amount_usd as number;
    if (oldAmount === new_plan_amount_usd) {
      return new Response(JSON.stringify({ error: "Already on this plan" }), { status: 400, headers: corsHeaders });
    }

    const isUpgrade = new_plan_amount_usd > oldAmount;

    if (isUpgrade) {
      // Calculate prorated charge
      const periodEnd = dbSub.current_period_end ? new Date(dbSub.current_period_end) : new Date(Date.now() + 30 * 86400000);
      const now = new Date();
      const msRemaining = Math.max(0, periodEnd.getTime() - now.getTime());
      const fraction = msRemaining / (30 * 86400000);
      const proratedUsd = parseFloat(((new_plan_amount_usd - oldAmount) * fraction).toFixed(2));
      const proratedPaise = Math.round(proratedUsd * INR_PER_USD * 100);

      // Create one-time Razorpay order for prorated difference
      const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { Authorization: razorpayAuth(), "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: proratedPaise,
          currency: "INR",
          notes: {
            type: "plan_upgrade",
            account_id: member.account_id,
            old_plan_usd: oldAmount.toString(),
            new_plan_usd: new_plan_amount_usd.toString(),
          },
        }),
      });
      const order = await orderRes.json();
      if (!order.id) throw new Error(`Razorpay order creation failed: ${JSON.stringify(order)}`);

      // Store upgrade order in DB (notes.order_id used in webhook)
      const { data: upgradeRec } = await supabaseAdmin.from("razorpay_upgrade_orders").insert({
        account_id: member.account_id,
        razorpay_order_id: order.id,
        old_plan_amount_usd: oldAmount,
        new_plan_amount_usd,
        proration_usd: proratedUsd,
        status: "created",
      }).select().single();

      // Also update the Razorpay subscription plan immediately (effective after current cycle)
      const newPlanId = await getOrCreatePlan(new_plan_amount_usd, supabaseAdmin);
      await fetch(`https://api.razorpay.com/v1/subscriptions/${dbSub.razorpay_subscription_id}`, {
        method: "PATCH",
        headers: { Authorization: razorpayAuth(), "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: newPlanId, schedule_change_at: "now" }),
      });

      fireCrmWebhook(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        "subscription.upgrade_checkout_initiated",
        member.account_id,
        {
          old_plan_amount_usd: oldAmount,
          new_plan_amount_usd,
          proration_usd: proratedUsd,
          amount_inr_paise: proratedPaise,
          razorpay_order_id: order.id,
          user_id: user.id,
          email: user.email,
          phone: user.phone ?? user.user_metadata?.phone ?? null,
          name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
        }
      );

      return new Response(
        JSON.stringify({
          type: "upgrade",
          order_id: order.id,
          key_id: getRequiredEnv("RAZORPAY_KEY_ID"),
          amount_inr_paise: proratedPaise,
          proration_usd: proratedUsd,
          old_plan_usd: oldAmount,
          new_plan_usd: new_plan_amount_usd,
          upgrade_order_db_id: upgradeRec?.id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // Downgrade — schedule for next renewal, no immediate charge
      await supabaseAdmin.from("subscriptions").update({
        pending_plan_amount_usd: new_plan_amount_usd,
        updated_at: new Date().toISOString(),
      }).eq("account_id", member.account_id);

      // Update Razorpay subscription plan at cycle end
      const newPlanId = await getOrCreatePlan(new_plan_amount_usd, supabaseAdmin);
      await fetch(`https://api.razorpay.com/v1/subscriptions/${dbSub.razorpay_subscription_id}`, {
        method: "PATCH",
        headers: { Authorization: razorpayAuth(), "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: newPlanId, schedule_change_at: "cycle_end" }),
      });

      fireCrmWebhook(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        "subscription.downgrade_scheduled",
        member.account_id,
        {
          old_plan_amount_usd: oldAmount,
          new_plan_amount_usd,
          effective_date: dbSub.current_period_end,
          user_id: user.id,
          email: user.email,
          phone: user.phone ?? user.user_metadata?.phone ?? null,
          name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
        }
      );

      return new Response(
        JSON.stringify({
          type: "downgrade",
          old_plan_usd: oldAmount,
          new_plan_usd: new_plan_amount_usd,
          effective_date: dbSub.current_period_end,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("razorpay-change-plan error:", err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
  }
});
