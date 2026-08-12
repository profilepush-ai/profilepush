import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respondJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "GET") return respondJson({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const attachmentId = (url.searchParams.get("id") ?? "").trim();
    if (!UUID_PATTERN.test(attachmentId)) return respondJson({ error: "A valid attachment id is required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return respondJson({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return respondJson({ error: "Unauthorized" }, 401);

    // RLS (select_own_vendor_message_attachments) scopes this to the requesting
    // user's own conversations, so a successful row fetch IS the authorization check.
    const { data: attachment, error: attachmentError } = await supabaseUser
      .from("vendor_message_attachments")
      .select("id, original_filename, content_type, r2_object_key")
      .eq("id", attachmentId)
      .maybeSingle();
    if (attachmentError) return respondJson({ error: attachmentError.message }, 500);
    if (!attachment) return respondJson({ error: "Attachment not found" }, 404);

    const workerUrl = (Deno.env.get("VENDOR_MAIL_WORKER_URL") ?? "").trim();
    const workerToken = (Deno.env.get("VENDOR_MAIL_WORKER_TOKEN") ?? "").trim();
    if (!workerUrl || !workerToken) return respondJson({ error: "Attachment download is not configured" }, 503);

    const fileResponse = await fetch(
      `${workerUrl.replace(/\/$/, "")}/vendor-mail/attachment?key=${encodeURIComponent(attachment.r2_object_key)}`,
      { headers: { Authorization: `Bearer ${workerToken}` } },
    );
    if (!fileResponse.ok || !fileResponse.body) {
      return respondJson({ error: `Could not fetch attachment (HTTP ${fileResponse.status})` }, 502);
    }

    const filename = String(attachment.original_filename ?? "attachment").replace(/["\r\n]/g, "");
    return new Response(fileResponse.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": attachment.content_type || fileResponse.headers.get("Content-Type") || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return respondJson({ error: (error as Error).message }, 500);
  }
});
