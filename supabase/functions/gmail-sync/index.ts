import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decodeGmailBase64Url, getValidAccessToken, GmailDisconnectedError } from "../_shared/gmail.ts";

// Invoked only by the sync-gmail-conversations pg_cron job (supabase/migrations/
// 20260815160000_schedule_gmail_sync_cron.sql), which posts with the service-role key
// as its bearer token — Supabase's platform-level JWT verification is what actually
// gates this endpoint, matching the same pattern as send-daily-match-notification.

const CONVERSATION_BATCH_LIMIT = 50;
const ACTIVE_STATUSES = ["pending", "open", "replied"];

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type GmailHeader = { name: string; value: string };
type GmailMessagePart = { mimeType?: string; body?: { data?: string }; parts?: GmailMessagePart[] };
type GmailMessage = { id: string; internalDate?: string; payload?: GmailMessagePart & { headers?: GmailHeader[] } };
type GmailThread = { id: string; messages?: GmailMessage[] };

type ConversationRow = {
  id: string;
  user_id: string;
  account_id: string;
  vendor_name: string;
  subject: string;
  gmail_thread_id: string;
};

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractPlainText(part: GmailMessagePart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeGmailBase64Url(part.body.data);
  if (part.parts) {
    for (const child of part.parts) {
      const text = extractPlainText(child);
      if (text) return text;
    }
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeGmailBase64Url(part.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

function extractEmailAddress(headerValue: string): string {
  const match = headerValue.match(/<([^<>]+)>/);
  return (match?.[1] ?? headerValue).trim().toLowerCase();
}

async function syncConversation(
  admin: SupabaseClient,
  conversation: ConversationRow,
  accessToken: string,
  gmailAddress: string,
): Promise<void> {
  const { data: existingRows } = await admin
    .from("vendor_messages")
    .select("gmail_message_id")
    .eq("conversation_id", conversation.id)
    .not("gmail_message_id", "is", null);
  const knownMessageIds = new Set(
    (existingRows ?? []).map((row) => row.gmail_message_id as string),
  );

  const threadResponse = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(conversation.gmail_thread_id)}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) },
  );
  if (threadResponse.status === 401 || threadResponse.status === 403) {
    throw new GmailDisconnectedError("Gmail thread fetch was unauthorized");
  }
  if (threadResponse.status === 404) return; // Thread deleted/moved on Gmail's side — nothing to sync.
  if (!threadResponse.ok) throw new Error(`Gmail thread fetch HTTP ${threadResponse.status}`);

  const thread = await threadResponse.json() as GmailThread;
  const newMessages = (thread.messages ?? []).filter((message) => !knownMessageIds.has(message.id));
  if (newMessages.length === 0) return;

  let insertedInboundCount = 0;
  for (const message of newMessages) {
    const headers = message.payload?.headers;
    const fromHeader = getHeader(headers, "From");
    const senderAddress = extractEmailAddress(fromHeader);
    const isOutbound = senderAddress === gmailAddress;
    const textBody = extractPlainText(message.payload) || "(no text content)";
    const occurredAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString();

    const { error: insertError } = await admin.from("vendor_messages").insert({
      conversation_id: conversation.id,
      direction: isOutbound ? "outbound" : "inbound",
      sender_type: isOutbound ? "user" : "vendor",
      // Store the bare address, not the raw "Display Name <addr>" header — the reply
      // extraction service does an exact-match comparison against social_jobs.poster_email
      // (see cloudflare/social-job-queue-consumer's handleVendorReply), matching the
      // convention Mailgun's inbound path already uses via extractEmail().
      from_email: senderAddress || fromHeader,
      to_email: getHeader(headers, "To"),
      subject: getHeader(headers, "Subject") || conversation.subject,
      text_body: textBody,
      in_reply_to: getHeader(headers, "In-Reply-To") || null,
      message_references: getHeader(headers, "References") || null,
      channel: "gmail",
      gmail_message_id: message.id,
      status: isOutbound ? "accepted" : "received",
      display_text_status: isOutbound ? null : "pending",
      sent_at: isOutbound ? occurredAt : null,
      received_at: isOutbound ? null : occurredAt,
    });
    if (insertError) {
      if (insertError.code === "23505") continue; // Already synced by a concurrent/overlapping tick.
      throw insertError;
    }
    if (!isOutbound) insertedInboundCount += 1;
  }
  if (insertedInboundCount === 0) return;

  for (let index = 0; index < insertedInboundCount; index += 1) {
    const { error: unreadError } = await admin.rpc("increment_vendor_conversation_unread", { p_conversation_id: conversation.id });
    if (unreadError) console.error(`gmail-sync unread increment failed for conversation ${conversation.id}`, unreadError);
  }

  const { error: notificationError } = await admin.from("notifications").insert({
    account_id: conversation.account_id,
    user_id: conversation.user_id,
    type: "vendor_reply_received",
    title: `${conversation.vendor_name} replied`,
    body: conversation.subject,
    link: `/inbox/${conversation.id}`,
  });
  if (notificationError) console.error(`gmail-sync notification insert failed for conversation ${conversation.id}`, notificationError);
}

// Disabled 2026-08-25: gmail.readonly was dropped from GMAIL_OAUTH_SCOPES
// (_shared/gmail.ts) to speed up Google's OAuth verification. Every Gmail
// API call in syncConversation() below needs that scope, so a live run
// would get a 403 on every thread fetch — and the 401/403 handling there
// treats that as GmailDisconnectedError, which would incorrectly mark every
// connected user's integration as "revoked" even though nothing was
// actually revoked. The cron that used to invoke this every 3 minutes is
// also unscheduled (20260825140000_disable_gmail_sync_cron.sql) — this
// guard covers any other caller. Flip back to false once gmail.readonly (or
// an equivalent scope) is requested and approved again.
const GMAIL_SYNC_DISABLED = true;

Deno.serve(async (request) => {
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  if (GMAIL_SYNC_DISABLED) return respond({ ok: false, disabled: true, reason: "gmail_readonly_scope_removed" });

  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: conversations, error } = await supabaseAdmin
      .from("vendor_conversations")
      .select("id, user_id, account_id, vendor_name, subject, gmail_thread_id")
      .eq("channel", "gmail")
      .in("status", ACTIVE_STATUSES)
      .not("gmail_thread_id", "is", null)
      .order("last_message_at", { ascending: true })
      .limit(CONVERSATION_BATCH_LIMIT);
    if (error) throw error;

    const rows = (conversations ?? []) as ConversationRow[];
    const conversationsByUser = new Map<string, ConversationRow[]>();
    for (const row of rows) {
      const list = conversationsByUser.get(row.user_id) ?? [];
      list.push(row);
      conversationsByUser.set(row.user_id, list);
    }

    let syncedConversations = 0;
    let skippedUsers = 0;

    for (const [userId, userConversations] of conversationsByUser) {
      let accessToken: string;
      let gmailAddress: string;
      try {
        const token = await getValidAccessToken(supabaseAdmin, userId);
        accessToken = token.accessToken;
        gmailAddress = token.gmailAddress;
      } catch (tokenError) {
        skippedUsers += 1;
        if (!(tokenError instanceof GmailDisconnectedError)) console.error(`gmail-sync token error for user ${userId}`, tokenError);
        continue;
      }

      for (const conversation of userConversations) {
        try {
          await syncConversation(supabaseAdmin, conversation, accessToken, gmailAddress);
          syncedConversations += 1;
        } catch (conversationError) {
          if (conversationError instanceof GmailDisconnectedError) {
            await supabaseAdmin
              .from("gmail_integrations")
              .update({ status: "revoked", last_error: conversationError.message })
              .eq("user_id", userId);
            break;
          }
          console.error(`gmail-sync failed for conversation ${conversation.id}`, conversationError);
        }
      }

      await supabaseAdmin
        .from("gmail_integrations")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("status", "connected");
    }

    return respond({ ok: true, conversations_synced: syncedConversations, users_skipped: skippedUsers });
  } catch (error) {
    console.error("gmail-sync error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
