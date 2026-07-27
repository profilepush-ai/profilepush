import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const CRM_WEBHOOK_URL = "https://services.leadconnectorhq.com/hooks/48XyGfN1WxneooOcHGHn/webhook-trigger/074831f6-cece-4229-8d04-7f0d7cd9df06";

async function enrichAndSend(
  supabase: ReturnType<typeof createClient>,
  event: string,
  accountId: string | null,
  extra: Record<string, unknown>
) {
  let enriched: Record<string, unknown> = {
    event,
    timestamp: new Date().toISOString(),
    platform: "profilepush",
    ...extra,
  };

  if (accountId) {
    // Fetch account + owner
    const { data: acc } = await supabase
      .from("accounts")
      .select("id, name, owner_id, credits_balance, is_trial")
      .eq("id", accountId)
      .maybeSingle();

    if (acc) {
      enriched.account_id = acc.id;
      enriched.account_name = acc.name;
      enriched.owner_id = acc.owner_id;
      enriched.credits_balance = acc.credits_balance;
      enriched.is_trial = acc.is_trial;

      // Fetch owner user details from auth
      if (acc.owner_id) {
        const { data: ownerData } = await supabase.auth.admin.getUserById(acc.owner_id as string);
        if (ownerData?.user) {
          const u = ownerData.user;
          enriched.user_id = u.id;
          enriched.email = u.email;
          enriched.phone = u.phone ?? u.user_metadata?.phone ?? null;
          enriched.name = u.user_metadata?.full_name ?? u.user_metadata?.name ?? null;
        }
      }

      // Fetch active subscription
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("account_id", accountId)
        .maybeSingle();

      if (sub) {
        enriched.subscription = {
          id: sub.id,
          razorpay_subscription_id: sub.razorpay_subscription_id,
          plan_amount_usd: sub.plan_amount_usd,
          status: sub.status,
          current_period_start: sub.current_period_start,
          current_period_end: sub.current_period_end,
          pending_plan_amount_usd: sub.pending_plan_amount_usd,
        };
      }
    }
  }

  // Fire-and-forget — don't block on CRM response
  fetch(CRM_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(enriched),
  }).catch((err) => console.error("CRM webhook send error:", err));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    // Accept calls from other edge functions (service role) or authenticated users
    const authHeader = req.headers.get("Authorization") ?? "";
    const isServiceRole = authHeader.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "___never___");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let userId: string | null = null;
    let accountId: string | null = null;

    // If called with a user JWT, resolve their account
    if (!isServiceRole && authHeader.startsWith("Bearer ")) {
      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (user) {
        userId = user.id;
        const { data: mem } = await supabaseAdmin
          .from("account_members")
          .select("account_id")
          .eq("user_id", user.id)
          .eq("status", "active")
          .maybeSingle();
        accountId = mem?.account_id ?? null;
      }
    }

    const body = await req.json() as {
      event: string;
      account_id?: string;
      razorpay_payload?: unknown;
      [key: string]: unknown;
    };

    const resolvedAccountId = body.account_id ?? accountId;
    const { event, account_id: _aid, ...rest } = body;

    await enrichAndSend(supabaseAdmin, event, resolvedAccountId ?? null, {
      ...rest,
      ...(userId ? { user_id: userId } : {}),
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-crm-webhook error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
