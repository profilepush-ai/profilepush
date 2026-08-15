import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidAccessToken, sendViaGmail } from "../_shared/gmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asString(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return respond({ error: "Unauthorized" }, 401);

    const body = await request.json<Record<string, unknown>>();
    const conversationId = asString(body.conversation_id, 100);
    const textBody = asString(body.text_body, 100_000);
    const clientRequestId = asString(body.client_request_id, 100);
    if (!/^[0-9a-f-]{36}$/i.test(conversationId) || !textBody || !/^[0-9a-f-]{36}$/i.test(clientRequestId)) {
      return respond({ error: "Conversation, message text, and request ID are required" }, 400);
    }

    const { data: conversation, error: conversationError } = await supabaseAdmin
      .from("vendor_conversations")
      .select("id, user_id, vendor_email, subject, status, sender_name, channel, gmail_thread_id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (conversationError || !conversation) return respond({ error: "Conversation not found" }, 404);
    if (conversation.status === "closed") return respond({ error: "Reopen this conversation before replying" }, 409);

    // The conversation's channel is fixed by whichever way its first (Ask AI) message
    // was sent — Gmail/Mailgun threading can't be mixed mid-conversation — so replies
    // always follow the conversation's own channel rather than accepting one from the client.
    let gmailAccessToken: string | null = null;
    let gmailFromAddress: string | null = null;
    if (conversation.channel === "gmail") {
      if (!conversation.gmail_thread_id) return respond({ error: "This conversation is not linked to a Gmail thread" }, 409);
      try {
        const token = await getValidAccessToken(supabaseAdmin, user.id);
        gmailAccessToken = token.accessToken;
        gmailFromAddress = token.gmailAddress;
      } catch {
        return respond({ error: "gmail_not_connected" }, 400);
      }
    }

    const { data: existingMessage } = await supabaseAdmin
      .from("vendor_messages")
      .select("id")
      .eq("conversation_id", conversation.id)
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (existingMessage) return respond({ ok: true, message_id: existingMessage.id, duplicate: true });

    const { data: latestMessage } = await supabaseAdmin
      .from("vendor_messages")
      .select("internet_message_id, message_references")
      .eq("conversation_id", conversation.id)
      .not("internet_message_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const senderName = asString(conversation.sender_name, 200)
      || asString(user.user_metadata?.full_name ?? user.user_metadata?.name, 200)
      || user.email?.split("@")[0]
      || "Recruiter";
    const safeSenderName = senderName.replace(/[\r\n"]/g, "");
    const references = [latestMessage?.message_references, latestMessage?.internet_message_id]
      .filter(Boolean)
      .join(" ") || null;

    const replySubject = conversation.subject.toLowerCase().startsWith("re:") ? conversation.subject : `Re: ${conversation.subject}`;
    const { data: message, error: messageError } = await supabaseAdmin
      .from("vendor_messages")
      .insert({
        conversation_id: conversation.id,
        direction: "outbound",
        sender_type: "user",
        from_email: conversation.channel === "gmail"
          ? `${safeSenderName} <${gmailFromAddress}>`
          : `${safeSenderName} via ProfilePush <requests@ask.profilepush.ai>`,
        to_email: conversation.vendor_email,
        subject: replySubject,
        text_body: textBody,
        in_reply_to: latestMessage?.internet_message_id ?? null,
        message_references: references,
        client_request_id: clientRequestId,
        channel: conversation.channel,
        status: "queued",
      })
      .select("id")
      .single();
    if (messageError?.code === "23505") {
      const { data: duplicateMessage } = await supabaseAdmin
        .from("vendor_messages")
        .select("id")
        .eq("conversation_id", conversation.id)
        .eq("client_request_id", clientRequestId)
        .maybeSingle();
      if (duplicateMessage) return respond({ ok: true, message_id: duplicateMessage.id, duplicate: true });
    }
    if (messageError || !message) throw messageError ?? new Error("Could not create message");

    if (conversation.channel === "gmail") {
      try {
        const sendResult = await sendViaGmail({
          accessToken: gmailAccessToken!,
          fromName: safeSenderName,
          fromAddress: gmailFromAddress!,
          toAddress: conversation.vendor_email,
          subject: replySubject,
          textBody,
          threadId: conversation.gmail_thread_id,
        });
        await supabaseAdmin
          .from("vendor_messages")
          .update({ status: "accepted", gmail_message_id: sendResult.id, sent_at: new Date().toISOString(), error_message: null })
          .eq("id", message.id);
        await supabaseAdmin
          .from("vendor_conversations")
          .update({ status: "open", last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", conversation.id);
      } catch (error) {
        const errorDetail = (error as Error).message.slice(0, 500);
        await supabaseAdmin.from("vendor_messages").update({ status: "failed", error_message: errorDetail }).eq("id", message.id);
        return respond({ error: "Could not send message" }, 502);
      }
      return respond({ ok: true, message_id: message.id });
    }

    const workerUrl = Deno.env.get("VENDOR_MAIL_WORKER_URL")?.trim();
    const workerToken = Deno.env.get("VENDOR_MAIL_WORKER_TOKEN")?.trim();
    if (!workerUrl || !workerToken) throw new Error("Vendor mail worker is not configured");

    const queueResponse = await fetch(`${workerUrl.replace(/\/$/, "")}/vendor-mail/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ message_id: message.id }),
    });
    if (!queueResponse.ok) {
      const errorDetail = (await queueResponse.text()).slice(0, 500);
      await supabaseAdmin.from("vendor_messages").update({ status: "failed", error_message: errorDetail }).eq("id", message.id);
      return respond({ error: "Could not queue message" }, 502);
    }

    return respond({ ok: true, message_id: message.id });
  } catch (error) {
    console.error("send-vendor-message error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});