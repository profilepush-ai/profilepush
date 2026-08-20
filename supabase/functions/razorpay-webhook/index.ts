import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBytes = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const expected = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, "0")).join("");
  return expected === signature;
}

async function setCredits(supabase: ReturnType<typeof createClient>, accountId: string, amountUsd: number, description: string) {
  await supabase.from("accounts").update({ credits_balance: amountUsd, is_trial: false }).eq("id", accountId);
  await supabase.from("credit_transactions").insert({
    account_id: accountId,
    type: "topup",
    amount: amountUsd,
    description,
  });
}

async function addCredits(supabase: ReturnType<typeof createClient>, accountId: string, amountUsd: number, description: string) {
  const { data: acc } = await supabase.from("accounts").select("credits_balance").eq("id", accountId).single();
  const newBalance = ((acc?.credits_balance as number) ?? 0) + amountUsd;
  await supabase.from("accounts").update({ credits_balance: newBalance, is_trial: false }).eq("id", accountId);
  await supabase.from("credit_transactions").insert({
    account_id: accountId,
    type: "topup",
    amount: amountUsd,
    description,
  });
}

function fireCrmWebhook(
  supabaseUrl: string,
  serviceRoleKey: string,
  event: string,
  accountId: string | null,
  extra: Record<string, unknown>
) {
  fetch(`${supabaseUrl}/functions/v1/notify-crm-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ event, account_id: accountId, ...extra }),
  }).catch((err) => console.error("notify-crm-webhook call failed:", err));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const rawBody = await req.text();
  const signature = req.headers.get("X-Razorpay-Signature") ?? "";
  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";

  if (webhookSecret) {
    const valid = await verifySignature(rawBody, signature, webhookSecret);
    if (!valid) {
      console.error("Webhook signature invalid");
      return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 400, headers: corsHeaders });
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: corsHeaders });
  }

  const event = payload.event as string;
  const entity = (payload.payload as Record<string, unknown>);

  try {
    if (event === "subscription.activated" || event === "subscription.charged") {
      const sub = (entity.subscription as Record<string, unknown>)?.entity as Record<string, unknown>;
      if (!sub?.id) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });

      const rzpSubId = sub.id as string;
      const chargeAt = sub.charge_at as number | null;
      const currentStart = sub.current_start as number | null;
      const currentEnd = sub.current_end as number | null;

      const { data: dbSub } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("razorpay_subscription_id", rzpSubId)
        .maybeSingle();

      if (!dbSub) {
        console.warn("Subscription not found in DB:", rzpSubId);
        fireCrmWebhook(supabaseUrl, serviceRoleKey, event, null, {
          razorpay_payload: payload,
          razorpay_subscription_id: rzpSubId,
          error: "subscription_not_found_in_db",
        });
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }

      let creditsToGrant = dbSub.plan_amount_usd as number;
      let newPlanAmount = dbSub.plan_amount_usd as number;

      if (event === "subscription.charged" && dbSub.pending_plan_amount_usd) {
        newPlanAmount = dbSub.pending_plan_amount_usd as number;
        creditsToGrant = newPlanAmount;
      }

      const periodStart = currentStart ? new Date(currentStart * 1000).toISOString() : null;
      const periodEnd = currentEnd ? new Date(currentEnd * 1000).toISOString() : chargeAt ? new Date((chargeAt + 30 * 86400) * 1000).toISOString() : null;

      await supabase.from("subscriptions").update({
        status: "active",
        plan_amount_usd: newPlanAmount,
        pending_plan_amount_usd: null,
        current_period_start: periodStart ?? new Date().toISOString(),
        current_period_end: periodEnd ?? new Date(Date.now() + 30 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("razorpay_subscription_id", rzpSubId);

      const label = event === "subscription.activated" ? "New subscription" : "Monthly renewal";
      await setCredits(supabase, dbSub.account_id as string, creditsToGrant, `${label} – Pro Plan $${creditsToGrant}/mo`);

      fireCrmWebhook(supabaseUrl, serviceRoleKey, event, dbSub.account_id as string, {
        razorpay_payload: payload,
        plan_amount_usd: newPlanAmount,
        credits_granted: creditsToGrant,
        period_start: periodStart,
        period_end: periodEnd,
        razorpay_subscription_id: rzpSubId,
      });
    }

    else if (event === "subscription.halted") {
      const sub = (entity.subscription as Record<string, unknown>)?.entity as Record<string, unknown>;
      if (sub?.id) {
        await supabase.from("subscriptions").update({ status: "halted", updated_at: new Date().toISOString() }).eq("razorpay_subscription_id", sub.id as string);
        const { data: dbSub } = await supabase.from("subscriptions").select("account_id").eq("razorpay_subscription_id", sub.id as string).maybeSingle();
        fireCrmWebhook(supabaseUrl, serviceRoleKey, event, dbSub?.account_id ?? null, {
          razorpay_payload: payload,
          razorpay_subscription_id: sub.id,
          reason: "payment_overdue_or_halted",
        });
      }
    }

    else if (event === "subscription.cancelled" || event === "subscription.completed") {
      const sub = (entity.subscription as Record<string, unknown>)?.entity as Record<string, unknown>;
      if (sub?.id) {
        const newStatus = event === "subscription.cancelled" ? "cancelled" : "completed";
        await supabase.from("subscriptions").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("razorpay_subscription_id", sub.id as string);
        const { data: dbSub } = await supabase.from("subscriptions").select("account_id, plan_amount_usd").eq("razorpay_subscription_id", sub.id as string).maybeSingle();
        fireCrmWebhook(supabaseUrl, serviceRoleKey, event, dbSub?.account_id ?? null, {
          razorpay_payload: payload,
          razorpay_subscription_id: sub.id,
          plan_amount_usd: dbSub?.plan_amount_usd ?? null,
        });
      }
    }

    else if (event === "payment.captured") {
      const payment = (entity.payment as Record<string, unknown>)?.entity as Record<string, unknown>;
      const notes = payment?.notes as Record<string, string> | null;

      if (notes?.type === "credit_topup" && notes?.order_id) {
        const { data: topupOrder } = await supabase
          .from("credit_topup_orders")
          .select("*")
          .eq("razorpay_order_id", notes.order_id)
          .maybeSingle();

        if (topupOrder && topupOrder.status === "created") {
          await supabase.from("credit_topup_orders").update({ status: "paid" }).eq("id", topupOrder.id);

          await addCredits(
            supabase,
            topupOrder.account_id as string,
            topupOrder.credits as number,
            `Credit top-up: ${topupOrder.credits} credits`,
          );

          fireCrmWebhook(supabaseUrl, serviceRoleKey, "credits.topup", topupOrder.account_id as string, {
            razorpay_payload: payload,
            credits: topupOrder.credits,
            amount_inr_paise: topupOrder.amount_inr_paise,
            razorpay_order_id: notes.order_id,
            payment_id: payment?.id ?? null,
          });
        }
      } else if (notes?.type === "plan_upgrade" && notes?.order_id) {
        const { data: upgradeOrder } = await supabase
          .from("razorpay_upgrade_orders")
          .select("*")
          .eq("razorpay_order_id", notes.order_id)
          .maybeSingle();

        if (upgradeOrder && upgradeOrder.status === "created") {
          const creditsDiff = (upgradeOrder.new_plan_amount_usd as number) - (upgradeOrder.old_plan_amount_usd as number);

          await supabase.from("razorpay_upgrade_orders").update({ status: "paid" }).eq("id", upgradeOrder.id);
          await supabase.from("subscriptions").update({
            plan_amount_usd: upgradeOrder.new_plan_amount_usd,
            updated_at: new Date().toISOString(),
          }).eq("account_id", upgradeOrder.account_id);

          await addCredits(
            supabase,
            upgradeOrder.account_id as string,
            creditsDiff,
            `Plan upgrade $${upgradeOrder.old_plan_amount_usd} → $${upgradeOrder.new_plan_amount_usd}`
          );

          fireCrmWebhook(supabaseUrl, serviceRoleKey, "subscription.upgraded", upgradeOrder.account_id as string, {
            razorpay_payload: payload,
            old_plan_amount_usd: upgradeOrder.old_plan_amount_usd,
            new_plan_amount_usd: upgradeOrder.new_plan_amount_usd,
            credits_added: creditsDiff,
            proration_usd: upgradeOrder.proration_usd,
            razorpay_order_id: notes.order_id,
            payment_id: payment?.id ?? null,
            amount_inr: payment?.amount ?? null,
          });
        }
      } else {
        // Generic payment capture (e.g. subscription renewal payment)
        const subId = (payment?.subscription_id as string) ?? null;
        let accountId: string | null = null;
        if (subId) {
          const { data: dbSub } = await supabase.from("subscriptions").select("account_id").eq("razorpay_subscription_id", subId).maybeSingle();
          accountId = dbSub?.account_id ?? null;
        }
        fireCrmWebhook(supabaseUrl, serviceRoleKey, event, accountId, {
          razorpay_payload: payload,
          payment_id: payment?.id ?? null,
          amount_inr: payment?.amount ?? null,
          razorpay_subscription_id: subId,
        });
      }
    }

    else if (event === "payment.failed") {
      const payment = (entity.payment as Record<string, unknown>)?.entity as Record<string, unknown>;
      const subId = (payment?.subscription_id as string) ?? null;
      let accountId: string | null = null;
      if (subId) {
        const { data: dbSub } = await supabase.from("subscriptions").select("account_id").eq("razorpay_subscription_id", subId).maybeSingle();
        accountId = dbSub?.account_id ?? null;
      }
      fireCrmWebhook(supabaseUrl, serviceRoleKey, event, accountId, {
        razorpay_payload: payload,
        payment_id: payment?.id ?? null,
        error_code: (payment?.error_code as string) ?? null,
        error_description: (payment?.error_description as string) ?? null,
        razorpay_subscription_id: subId,
      });
    }

    else {
      // Forward any other Razorpay events as-is
      fireCrmWebhook(supabaseUrl, serviceRoleKey, event, null, { razorpay_payload: payload });
    }

  } catch (err) {
    console.error("Webhook handler error:", err);
    fireCrmWebhook(supabaseUrl, serviceRoleKey, `${event}.error`, null, {
      razorpay_payload: payload,
      error: String(err),
    });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
