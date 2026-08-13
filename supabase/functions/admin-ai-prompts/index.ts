import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_PROMPT_KEYS = new Set([
  "parse-resume",
  "bulk-parse-profiles",
  "rewrite-resume",
  "rewrite-field",
  "suggest-priority-skills",
  "generate-search-ideas",
  "dashboard-summary",
  "score-job-match",
  "bench-match-extract",
  "bench-match-score",
  "bench-match-rank",
  "radar-match",
  "radar-enrich",
  "cf-job-classify",
  "cf-job-extract",
  "cf-hotlist-extract",
  "cf-queue-job-classify",
  "cf-ask-vendor-email",
  "cf-ask-resume-email",
  "cf-vendor-reply",
  "cf-hotlist-vendor-reply",
]);

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const body = await request.json();
    const adminPassword = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";
    if (body?.password !== adminPassword) return respond({ error: "Invalid password" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const action = String(body?.action ?? "list");

    if (action === "list") {
      const { data, error } = await supabase
        .from("ai_prompts")
        .select("prompt_key, system_prompt, user_prompt, updated_at, updated_by")
        .order("prompt_key", { ascending: true });
      if (error) return respond({ error: error.message }, 500);
      return respond({ prompts: data ?? [] });
    }

    const promptKey = String(body?.prompt_key ?? "");
    if (!ALLOWED_PROMPT_KEYS.has(promptKey)) return respond({ error: "Unknown prompt_key" }, 400);

    if (action === "save") {
      const systemPrompt = body?.system_prompt == null ? null : String(body.system_prompt);
      const userPrompt = body?.user_prompt == null ? null : String(body.user_prompt);
      if (!systemPrompt?.trim() && !userPrompt?.trim()) {
        return respond({ error: "system_prompt or user_prompt is required" }, 400);
      }
      const updatedBy = body?.updated_by ? String(body.updated_by) : null;
      const { data, error } = await supabase
        .from("ai_prompts")
        .upsert(
          {
            prompt_key: promptKey,
            system_prompt: systemPrompt,
            user_prompt: userPrompt,
            updated_at: new Date().toISOString(),
            updated_by: updatedBy,
          },
          { onConflict: "prompt_key" },
        )
        .select("prompt_key, system_prompt, user_prompt, updated_at, updated_by")
        .single();
      if (error) return respond({ error: error.message }, 400);

      // History logging is best-effort — a failure here must never fail the save itself.
      try {
        await supabase.from("ai_prompt_versions").insert({
          prompt_key: promptKey,
          system_prompt: systemPrompt,
          user_prompt: userPrompt,
          created_by: updatedBy,
        });
      } catch { /* non-fatal */ }

      return respond({ success: true, prompt: data });
    }

    if (action === "reset") {
      const { error } = await supabase.from("ai_prompts").delete().eq("prompt_key", promptKey);
      if (error) return respond({ error: error.message }, 400);
      return respond({ success: true, prompt_key: promptKey });
    }

    if (action === "history") {
      const { data, error } = await supabase
        .from("ai_prompt_versions")
        .select("id, system_prompt, user_prompt, created_at, created_by")
        .eq("prompt_key", promptKey)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return respond({ error: error.message }, 500);
      return respond({ versions: data ?? [] });
    }

    return respond({ error: "Unsupported action" }, 400);
  } catch (error) {
    return respond({ error: (error as Error).message }, 500);
  }
});
