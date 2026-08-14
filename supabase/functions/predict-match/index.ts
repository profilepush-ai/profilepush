import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asString(value: unknown, maxLength = 10_000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return respond({ error: "Unauthorized" }, 401);

    const body = await req.json() as Record<string, unknown>;
    const leadId = asString(body.lead_id, 200);
    const platform = asString(body.platform, 100);
    const feedKind = asString(body.feed_kind, 20);
    const roleTitle = asString(body.role_title, 300);
    const consultantText = asString(body.consultant_text, 8000);
    const accountId = asString(body.account_id, 100);
    const jobContext = (body.job_context && typeof body.job_context === "object")
      ? body.job_context as Record<string, unknown>
      : {};

    if (!consultantText) return respond({ error: "consultant_text is required" }, 400);

    const workerUrl = (Deno.env.get("CLOUDFLARE_WORKER_URL") ?? "").trim();
    const workerToken = (Deno.env.get("CLOUDFLARE_WORKER_TOKEN") ?? "").trim();
    if (!workerUrl) return respond({ error: "Predict service is not configured" }, 500);

    const workerResponse = await fetch(`${workerUrl.replace(/\/$/, "")}/predict-match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
      },
      body: JSON.stringify({
        roleTitle,
        jobContext: {
          skills: asString(jobContext.skills, 500),
          exp: asString(jobContext.exp, 100),
          visa: asString(jobContext.visa, 100),
          workType: asString(jobContext.workType, 100),
          location: asString(jobContext.location, 200),
          employmentType: asString(jobContext.employmentType, 100),
        },
        consultantText,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const workerPayload = await workerResponse.json().catch(() => ({} as Record<string, unknown>));
    if (!workerResponse.ok) {
      throw new Error(asString(workerPayload?.error) || `Predict worker HTTP ${workerResponse.status}`);
    }

    const score = Number(workerPayload.score) || 0;
    const verdict = asString(workerPayload.verdict, 200);
    const categories = Array.isArray(workerPayload.categories) ? workerPayload.categories : [];

    const { error: logError } = await supabaseAdmin.from("pulse_predict_logs").insert({
      account_id: UUID_PATTERN.test(accountId) ? accountId : null,
      user_id: user.id,
      user_email: user.email ?? "",
      lead_id: leadId,
      platform,
      feed_kind: feedKind,
      role_title: roleTitle,
      consultant_text: consultantText,
      score,
      verdict,
      categories,
    });
    if (logError) console.error(`pulse_predict_logs insert failed: ${logError.message}`);

    return respond({ score, verdict, categories });
  } catch (error) {
    return respond({ error: (error as Error).message }, 500);
  }
});
