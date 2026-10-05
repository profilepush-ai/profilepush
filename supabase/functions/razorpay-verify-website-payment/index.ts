import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Called by the Website page the moment Razorpay's checkout reports success,
// so the plan and its credits land immediately instead of waiting on the
// webhook. Razorpay's signature (HMAC-SHA256 of "order_id|payment_id" with the
// key secret) proves the payment is real; apply_website_plan_order applies
// the order at most once, whichever of this or the webhook gets there first.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
    if (typeof razorpay_order_id !== "string" || typeof razorpay_payment_id !== "string" || typeof razorpay_signature !== "string") {
      return respond({ error: "razorpay_order_id, razorpay_payment_id and razorpay_signature are required" }, 400);
    }

    const expected = await hmacHex(Deno.env.get("RAZORPAY_KEY_SECRET")!, `${razorpay_order_id}|${razorpay_payment_id}`);
    if (expected !== razorpay_signature) return respond({ error: "Payment signature did not verify" }, 400);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: member } = await admin
      .from("account_members").select("account_id")
      .eq("user_id", user.id).eq("status", "active")
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    const { data: order } = await admin
      .from("website_plan_orders").select("account_id")
      .eq("razorpay_order_id", razorpay_order_id).maybeSingle();
    if (!order) return respond({ error: "Order not found" }, 404);
    if (!member || member.account_id !== order.account_id) return respond({ error: "This order belongs to another account" }, 403);

    const { data, error } = await admin.rpc("apply_website_plan_order", {
      p_razorpay_order_id: razorpay_order_id,
      p_razorpay_payment_id: razorpay_payment_id,
    });
    if (error) return respond({ error: error.message }, 500);
    const row = (data ?? [])[0] ?? null;
    return respond({
      applied: row?.applied ?? false,
      plan_expires_at: row?.plan_expires_at ?? null,
      credits: row?.credits ?? null,
      balance: row?.new_balance ?? null,
    });
  } catch (err) {
    console.error("razorpay-verify-website-payment error:", err);
    return respond({ error: (err as Error).message }, 500);
  }
});
