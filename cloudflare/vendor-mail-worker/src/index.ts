export interface Env {
  OUTBOUND_QUEUE: Queue<OutboundJob>;
  INBOUND_QUEUE: Queue<InboundJob>;
  EXTRACTION_QUEUE: Queue<ExtractionJob>;
  VENDOR_MAIL_BUCKET: R2Bucket;
  REPLY_PROCESSOR?: Fetcher;
  MAILGUN_API_KEY: string;
  MAILGUN_SIGNING_KEY: string;
  MAILGUN_DOMAIN: string;
  MAILGUN_BASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WORKER_AUTH_TOKEN: string;
  REPLY_PROCESSOR_URL: string;
  REPLY_PROCESSOR_TOKEN: string;
}

// Cloudflare rejects/rate-limits a Worker calling another Worker's *.workers.dev
// route directly over the public network (error 1042). Prefer the service
// binding, which routes internally; fall back to the raw URL only if the
// binding isn't configured (e.g. local dev).
function fetchReplyProcessor(env: Env, init: RequestInit): Promise<Response> {
  if (env.REPLY_PROCESSOR) {
    return env.REPLY_PROCESSOR.fetch("https://reply-processor.internal", init);
  }
  return fetch(env.REPLY_PROCESSOR_URL, init);
}

type OutboundJob = { kind: "outbound"; messageId: string; resumeUrl?: string; resumeFileName?: string };

type ExtractionJob = {
  kind: "extraction";
  messageId: string;
  requestId: string;
  jobId: string | null;
  hotlistId: string | null;
  sender: string;
  subject: string;
  textBody: string;
};

type InboundAttachment = {
  objectKey: string;
  filename: string;
  contentType: string;
  size: number;
};

type InboundJob = {
  kind: "inbound";
  conversationId: string;
  sender: string;
  recipient: string;
  subject: string;
  textBody: string;
  htmlBody: string | null;
  internetMessageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  rawObjectKey: string;
  attachments: InboundAttachment[];
};

type ConversationRow = {
  id: string;
  request_id: string;
  user_id: string;
  account_id: string;
  vendor_email: string;
  vendor_name: string;
  sender_name: string;
  reply_token: string;
  subject: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  from_email: string;
  to_email: string;
  subject: string;
  text_body: string;
  html_body: string | null;
  in_reply_to: string | null;
  message_references: string | null;
};

const MAX_WEBHOOK_AGE_SECONDS = 15 * 60;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/jpeg",
  "image/png",
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getBearerToken(request: Request): string {
  const [scheme, token] = (request.headers.get("Authorization") ?? "").split(" ");
  return scheme?.toLowerCase() === "bearer" ? (token ?? "").trim() : "";
}

function serviceHeaders(env: Env, json = false): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

async function supabaseRequest(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(env), ...(init.headers ?? {}) },
  });
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function verifyMailgunSignature(
  env: Env,
  timestamp: string,
  token: string,
  signature: string,
): Promise<boolean> {
  const epoch = Number(timestamp);
  if (!Number.isFinite(epoch) || Math.abs(Date.now() / 1000 - epoch) > MAX_WEBHOOK_AGE_SECONDS) return false;
  const expected = await hmacHex(env.MAILGUN_SIGNING_KEY, `${timestamp}${token}`);
  return timingSafeEqual(expected, signature.toLowerCase());
}

function extractEmail(value: string): string {
  const match = value.match(/<([^<>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

function headerValue(headersJson: string, name: string): string | null {
  try {
    const headers = JSON.parse(headersJson) as Array<[string, string]>;
    const match = headers.find(([header]) => header.toLowerCase() === name.toLowerCase());
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

async function claimWebhook(env: Env, webhookType: "inbound" | "event", token: string, timestamp: string): Promise<boolean> {
  const response = await supabaseRequest(env, "vendor_mail_webhook_receipts", {
    method: "POST",
    headers: { ...serviceHeaders(env, true), Prefer: "return=minimal" },
    body: JSON.stringify({ webhook_type: webhookType, provider_token: token, provider_timestamp: Number(timestamp) }),
  });
  if (response.ok) return true;
  if (response.status === 409) return false;
  throw new Error(`Webhook receipt insert ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

async function releaseWebhookClaim(env: Env, webhookType: "inbound" | "event", token: string): Promise<void> {
  const response = await supabaseRequest(
    env,
    `vendor_mail_webhook_receipts?webhook_type=eq.${webhookType}&provider_token=eq.${encodeURIComponent(token)}`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
  );
  if (!response.ok) console.error(`Could not release ${webhookType} webhook claim`, response.status);
}

async function findConversationByRecipient(env: Env, recipient: string): Promise<ConversationRow | null> {
  const localPart = recipient.split("@")[0] ?? "";
  const token = localPart.startsWith("reply+") ? localPart.slice(6) : "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const response = await supabaseRequest(
    env,
    `vendor_conversations?reply_token=eq.${encodeURIComponent(token)}&select=id,request_id,user_id,account_id,vendor_email,vendor_name,reply_token,subject&limit=1`,
  );
  if (!response.ok) throw new Error(`Conversation lookup ${response.status}`);
  const rows = await response.json<ConversationRow[]>();
  return rows[0] ?? null;
}

async function handleOutboundRequest(request: Request, env: Env): Promise<Response> {
  if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
  const body = await request.json<{ message_id?: unknown; resume_url?: unknown; resume_file_name?: unknown }>();
  const messageId = typeof body.message_id === "string" ? body.message_id.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return jsonResponse({ error: "A valid message_id is required" }, 400);
  const resumeUrl = typeof body.resume_url === "string" ? body.resume_url.trim().slice(0, 2000) : "";
  const resumeFileName = typeof body.resume_file_name === "string" ? body.resume_file_name.trim().slice(0, 255) : "";
  await env.OUTBOUND_QUEUE.send({
    kind: "outbound",
    messageId,
    ...(resumeUrl ? { resumeUrl, resumeFileName: resumeFileName || "resume.pdf" } : {}),
  });
  return jsonResponse({ queued: true, message_id: messageId }, 202);
}

async function handleInboundWebhook(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const timestamp = String(form.get("timestamp") ?? "");
  const token = String(form.get("token") ?? "");
  const signature = String(form.get("signature") ?? "");
  if (!await verifyMailgunSignature(env, timestamp, token, signature)) {
    return jsonResponse({ error: "Invalid Mailgun signature" }, 401);
  }
  if (!await claimWebhook(env, "inbound", token, timestamp)) return jsonResponse({ accepted: true, duplicate: true });

  try {
  const recipient = extractEmail(String(form.get("recipient") ?? ""));
  const sender = extractEmail(String(form.get("sender") ?? form.get("from") ?? ""));
  const conversation = await findConversationByRecipient(env, recipient);
  if (!conversation) return jsonResponse({ error: "Conversation not found" }, 406);
  if (sender !== conversation.vendor_email.toLowerCase()) return jsonResponse({ error: "Sender does not match vendor" }, 406);

  const messageHeaders = String(form.get("message-headers") ?? "[]");
  const messageKey = crypto.randomUUID();
  const prefix = `inbound/${conversation.id}/${messageKey}`;
  const rawObjectKey = `${prefix}/payload.json`;
  const rawPayload = Object.fromEntries(
    [...form.entries()].filter(([, value]) => typeof value === "string") as Array<[string, string]>,
  );
  await env.VENDOR_MAIL_BUCKET.put(rawObjectKey, JSON.stringify(rawPayload), {
    httpMetadata: { contentType: "application/json" },
  });

  const attachmentCount = Math.min(10, Number(form.get("attachment-count") ?? 0) || 0);
  const attachments: InboundAttachment[] = [];
  for (let index = 1; index <= attachmentCount; index += 1) {
    const attachment = form.get(`attachment-${index}`);
    if (!(attachment instanceof File)) continue;
    if (attachment.size > MAX_ATTACHMENT_BYTES || !ALLOWED_ATTACHMENT_TYPES.has(attachment.type)) continue;
    const objectKey = `${prefix}/attachments/${crypto.randomUUID()}`;
    await env.VENDOR_MAIL_BUCKET.put(objectKey, attachment.stream(), {
      httpMetadata: { contentType: attachment.type },
      customMetadata: { filename: attachment.name.slice(0, 255) },
    });
    attachments.push({
      objectKey,
      filename: attachment.name.slice(0, 255),
      contentType: attachment.type,
      size: attachment.size,
    });
  }

  await env.INBOUND_QUEUE.send({
    kind: "inbound",
    conversationId: conversation.id,
    sender,
    recipient,
    subject: String(form.get("subject") ?? conversation.subject).slice(0, 500),
    textBody: String(form.get("stripped-text") ?? form.get("body-plain") ?? "").slice(0, 100_000),
    htmlBody: form.get("stripped-html") ? String(form.get("stripped-html")).slice(0, 250_000) : null,
    internetMessageId: headerValue(messageHeaders, "Message-Id"),
    inReplyTo: headerValue(messageHeaders, "In-Reply-To"),
    references: headerValue(messageHeaders, "References"),
    rawObjectKey,
    attachments,
  });
  return jsonResponse({ accepted: true });
  } catch (error) {
    await releaseWebhookClaim(env, "inbound", token);
    throw error;
  }
}

async function handleEventWebhook(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<Record<string, unknown>>();
  const eventData = payload["event-data"] as Record<string, unknown> | undefined;
  const signatureData = (payload.signature ?? eventData?.signature) as Record<string, unknown> | undefined;
  const timestamp = String(signatureData?.timestamp ?? "");
  const token = String(signatureData?.token ?? "");
  const signature = String(signatureData?.signature ?? "");
  if (!await verifyMailgunSignature(env, timestamp, token, signature)) {
    return jsonResponse({ error: "Invalid Mailgun signature" }, 401);
  }
  if (!await claimWebhook(env, "event", token, timestamp)) return jsonResponse({ accepted: true, duplicate: true });

  const eventType = String(eventData?.event ?? "");
  const eventId = String(eventData?.id ?? token);
  const variables = eventData?.["user-variables"] as Record<string, unknown> | undefined;
  const message = eventData?.message as Record<string, unknown> | undefined;
  const headers = message?.headers as Record<string, unknown> | undefined;
  const internalMessageId = String(variables?.["message-id"] ?? variables?.message_id ?? variables?.messageId ?? "");
  const conversationId = String(variables?.["conversation-id"] ?? variables?.conversation_id ?? variables?.conversationId ?? "");
  const providerMessageId = String(headers?.["message-id"] ?? "");
  let messageRow: { id: string } | undefined;
  if (/^[0-9a-f-]{36}$/i.test(internalMessageId)) {
    const response = await supabaseRequest(env, `vendor_messages?id=eq.${encodeURIComponent(internalMessageId)}&select=id&limit=1`);
    messageRow = (await response.json<Array<{ id: string }>>())[0];
  }
  if (!messageRow && /^[0-9a-f-]{36}$/i.test(conversationId)) {
    const response = await supabaseRequest(
      env,
      `vendor_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&direction=eq.outbound&select=id&order=created_at.desc&limit=1`,
    );
    messageRow = (await response.json<Array<{ id: string }>>())[0];
  }
  if (!messageRow && providerMessageId) {
    const providerIds = [...new Set([
      providerMessageId,
      providerMessageId.replace(/^<|>$/g, ""),
      `<${providerMessageId.replace(/^<|>$/g, "")}>`,
    ])];
    for (const candidate of providerIds) {
      const response = await supabaseRequest(env, `vendor_messages?mailgun_message_id=eq.${encodeURIComponent(candidate)}&select=id&limit=1`);
      messageRow = (await response.json<Array<{ id: string }>>())[0];
      if (messageRow) break;
    }
  }
  await supabaseRequest(env, "vendor_message_events?on_conflict=provider_event_id", {
    method: "POST",
    headers: { ...serviceHeaders(env, true), Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      message_id: messageRow?.id ?? null,
      provider_event_id: eventId,
      event_type: eventType,
      severity: String(eventData?.severity ?? "") || null,
      provider_payload: payload,
      occurred_at: eventData?.timestamp ? new Date(Number(eventData.timestamp) * 1000).toISOString() : new Date().toISOString(),
    }),
  });
  if (!messageRow) return jsonResponse({ accepted: true, matched: false });

  const statusByEvent: Record<string, string> = {
    accepted: "accepted",
    delivered: "delivered",
    failed: String(eventData?.severity ?? "") === "temporary" ? "temporary_failed" : "failed",
    complained: "failed",
  };
  if (statusByEvent[eventType]) {
    const errorMessage = String((eventData?.["delivery-status"] as Record<string, unknown> | undefined)?.message ?? eventType);
    if (eventType === "failed" && String(eventData?.severity ?? "") !== "temporary") {
      await failMessageAndRefund(env, messageRow.id, errorMessage);
    } else {
      await updateMessage(env, messageRow.id, {
        status: statusByEvent[eventType],
        error_message: eventType === "failed" || eventType === "complained" ? errorMessage : null,
      });
    }
  }
  return jsonResponse({ accepted: true, matched: true });
}

async function loadOutboundData(env: Env, messageId: string): Promise<{ message: MessageRow; conversation: ConversationRow }> {
  const messageResponse = await supabaseRequest(
    env,
    `vendor_messages?id=eq.${encodeURIComponent(messageId)}&direction=eq.outbound&select=id,conversation_id,from_email,to_email,subject,text_body,html_body,in_reply_to,message_references&limit=1`,
  );
  if (!messageResponse.ok) throw new Error(`Message lookup ${messageResponse.status}`);
  const message = (await messageResponse.json<MessageRow[]>())[0];
  if (!message) throw new Error("Outbound message not found");
  const conversationResponse = await supabaseRequest(
    env,
    `vendor_conversations?id=eq.${encodeURIComponent(message.conversation_id)}&select=id,request_id,user_id,account_id,vendor_email,vendor_name,sender_name,reply_token,subject&limit=1`,
  );
  if (!conversationResponse.ok) throw new Error(`Conversation lookup ${conversationResponse.status}`);
  const conversation = (await conversationResponse.json<ConversationRow[]>())[0];
  if (!conversation) throw new Error("Conversation not found");
  return { message, conversation };
}

async function updateMessage(env: Env, messageId: string, values: Record<string, unknown>): Promise<void> {
  const response = await supabaseRequest(env, `vendor_messages?id=eq.${encodeURIComponent(messageId)}`, {
    method: "PATCH",
    headers: { ...serviceHeaders(env, true), Prefer: "return=minimal" },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Message update ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

async function failMessageAndRefund(env: Env, messageId: string, errorMessage: string): Promise<void> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/fail_vendor_message_and_refund`, {
    method: "POST",
    headers: serviceHeaders(env, true),
    body: JSON.stringify({ p_message_id: messageId, p_error_message: errorMessage }),
  });
  if (!response.ok) throw new Error(`Permanent failure update ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

async function processOutbound(job: OutboundJob, env: Env): Promise<void> {
  const { message, conversation } = await loadOutboundData(env, job.messageId);
  const form = new FormData();
  form.set("from", message.from_email);
  form.set("to", message.to_email);
  form.set("subject", message.subject);
  form.set("text", message.text_body);
  if (message.html_body) form.set("html", message.html_body);
  form.set("o:tracking", "yes");
  form.set("o:tracking-clicks", "yes");
  form.set("o:tracking-opens", "yes");
  const replyName = `${conversation.sender_name.replace(/[\r\n"]/g, "")} via ProfilePush`;
  form.set("h:Reply-To", `${replyName} <reply+${conversation.reply_token}@${env.MAILGUN_DOMAIN}>`);
  if (message.in_reply_to) form.set("h:In-Reply-To", message.in_reply_to);
  if (message.message_references) form.set("h:References", message.message_references);
  form.set("v:conversation-id", conversation.id);
  form.set("v:message-id", message.id);

  let attachment: { objectKey: string; filename: string; contentType: string; size: number } | null = null;
  if (job.resumeUrl) {
    try {
      const resumeResponse = await fetch(job.resumeUrl);
      if (resumeResponse.ok) {
        const contentType = resumeResponse.headers.get("content-type") ?? "application/octet-stream";
        const bytes = await resumeResponse.arrayBuffer();
        if (bytes.byteLength > 0 && bytes.byteLength <= MAX_ATTACHMENT_BYTES) {
          const filename = job.resumeFileName || "resume.pdf";
          const objectKey = `outbound/${conversation.id}/${message.id}/${crypto.randomUUID()}-${filename}`;
          await env.VENDOR_MAIL_BUCKET.put(objectKey, bytes, { httpMetadata: { contentType } });
          form.append("attachment", new File([bytes], filename, { type: contentType }));
          attachment = { objectKey, filename, contentType, size: bytes.byteLength };
        }
      }
    } catch (error) {
      console.error(`Resume attachment fetch failed for message ${message.id}: ${(error as Error).message}`);
    }
  }

  const response = await fetch(`${env.MAILGUN_BASE_URL}/v3/${env.MAILGUN_DOMAIN}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}` },
    body: form,
  });
  const payload = await response.json<{ id?: string; message?: string }>().catch(() => ({}));
  if (!response.ok || !payload.id) {
    const errorMessage = payload.message ?? `Mailgun HTTP ${response.status}`;
    if (response.status >= 500 || response.status === 429) {
      await updateMessage(env, message.id, { status: "temporary_failed", error_message: errorMessage });
      throw new Error(errorMessage);
    }
    await failMessageAndRefund(env, message.id, errorMessage);
    return;
  }
  await updateMessage(env, message.id, {
    status: "accepted",
    mailgun_message_id: payload.id,
    internet_message_id: payload.id,
    sent_at: new Date().toISOString(),
    error_message: null,
  });
  if (attachment) {
    const attachmentResponse = await supabaseRequest(env, "vendor_message_attachments", {
      method: "POST",
      headers: { ...serviceHeaders(env, true), Prefer: "return=minimal" },
      body: JSON.stringify([{
        message_id: message.id,
        r2_object_key: attachment.objectKey,
        original_filename: attachment.filename,
        content_type: attachment.contentType,
        size_bytes: attachment.size,
        scan_status: "clean",
      }]),
    });
    if (!attachmentResponse.ok) console.error(`Outbound attachment insert failed: ${attachmentResponse.status}`);
  }
  const conversationResponse = await supabaseRequest(env, `vendor_conversations?id=eq.${encodeURIComponent(conversation.id)}`, {
    method: "PATCH",
    headers: { ...serviceHeaders(env, true), Prefer: "return=minimal" },
    body: JSON.stringify({ status: "open", last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
  if (!conversationResponse.ok) throw new Error(`Conversation update ${conversationResponse.status}`);
}

async function processInbound(job: InboundJob, env: Env): Promise<void> {
  const insertResponse = await supabaseRequest(env, "vendor_messages?on_conflict=internet_message_id", {
    method: "POST",
    headers: { ...serviceHeaders(env, true), Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      conversation_id: job.conversationId,
      direction: "inbound",
      sender_type: "vendor",
      from_email: job.sender,
      to_email: job.recipient,
      subject: job.subject,
      text_body: job.textBody,
      html_body: job.htmlBody,
      internet_message_id: job.internetMessageId,
      in_reply_to: job.inReplyTo,
      message_references: job.references,
      status: "received",
      display_text_status: "pending",
      received_at: new Date().toISOString(),
    }),
  });
  if (!insertResponse.ok) throw new Error(`Inbound insert ${insertResponse.status}: ${(await insertResponse.text()).slice(0, 300)}`);
  const inserted = await insertResponse.json<Array<{ id: string }>>();
  const messageId = inserted[0]?.id;
  if (!messageId) return;

  if (job.attachments.length > 0) {
    const attachmentResponse = await supabaseRequest(env, "vendor_message_attachments", {
      method: "POST",
      headers: { ...serviceHeaders(env, true), Prefer: "return=minimal" },
      body: JSON.stringify(job.attachments.map((attachment) => ({
        message_id: messageId,
        r2_object_key: attachment.objectKey,
        original_filename: attachment.filename,
        content_type: attachment.contentType,
        size_bytes: attachment.size,
      }))),
    });
    if (!attachmentResponse.ok) throw new Error(`Attachment insert ${attachmentResponse.status}`);
  }

  const conversationResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_vendor_conversation_unread`, {
    method: "POST",
    headers: serviceHeaders(env, true),
    body: JSON.stringify({ p_conversation_id: job.conversationId }),
  });
  if (!conversationResponse.ok) throw new Error(`Conversation update ${conversationResponse.status}`);

  const conversationLookup = await supabaseRequest(env, `vendor_conversations?id=eq.${encodeURIComponent(job.conversationId)}&select=user_id,account_id,vendor_name,subject,request_id,job_id,hotlist_id&limit=1`);
  const conversation = (await conversationLookup.json<Array<{ user_id: string; account_id: string; vendor_name: string; subject: string; request_id: string; job_id: string | null; hotlist_id: string | null }>>())[0];
  if (conversation) {
    await supabaseRequest(env, "notifications", {
      method: "POST",
      headers: { ...serviceHeaders(env, true), Prefer: "return=minimal" },
      body: JSON.stringify({
        account_id: conversation.account_id,
        user_id: conversation.user_id,
        type: "vendor_reply_received",
        title: `${conversation.vendor_name} replied`,
        body: conversation.subject,
        link: `/inbox/${job.conversationId}`,
      }),
    });
    await env.EXTRACTION_QUEUE.send({
      kind: "extraction",
      messageId,
      requestId: conversation.request_id,
      jobId: conversation.job_id,
      hotlistId: conversation.hotlist_id,
      sender: job.sender,
      subject: job.subject,
      textBody: job.textBody,
    });
  }
}

async function processExtraction(job: ExtractionJob, env: Env): Promise<void> {
  const response = await fetchReplyProcessor(env, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.REPLY_PROCESSOR_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      request_id: job.requestId,
      job_id: job.jobId,
      hotlist_id: job.hotlistId,
      from_email: job.sender,
      subject: job.subject,
      email_content: job.textBody,
    }),
  });
  if (!response.ok) {
    throw new Error(`Reply extraction HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const payload = await response.json<{ display_text?: unknown }>();
  const displayText = String(payload.display_text ?? "").trim().slice(0, 12_000);
  await updateMessage(env, job.messageId, {
    display_text: displayText || "Reply content could not be displayed.",
    display_text_status: "complete",
  });
}

async function queuePendingExtractions(env: Env): Promise<void> {
  // Also re-claim rows stuck in "processing" — a permanently-failing extraction
  // (e.g. exhausted queue retries into the DLQ) leaves display_text_status there
  // forever otherwise, since only this sweep or a successful run advances it.
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const response = await supabaseRequest(
    env,
    `vendor_messages?direction=eq.inbound&or=(display_text_status.eq.pending,and(display_text_status.eq.processing,updated_at.lt.${encodeURIComponent(staleBefore)}))&select=id,from_email,subject,text_body,vendor_conversations!inner(request_id,job_id,hotlist_id)&order=created_at.asc&limit=25`,
  );
  if (!response.ok) throw new Error(`Pending reply lookup ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const rows = await response.json<Array<{
    id: string;
    from_email: string;
    subject: string;
    text_body: string;
    vendor_conversations: { request_id: string; job_id: string | null; hotlist_id: string | null };
  }>>();
  for (const row of rows) {
    await env.EXTRACTION_QUEUE.send({
      kind: "extraction",
      messageId: row.id,
      requestId: row.vendor_conversations.request_id,
      jobId: row.vendor_conversations.job_id,
      hotlistId: row.vendor_conversations.hotlist_id,
      sender: row.from_email,
      subject: row.subject,
      textBody: row.text_body,
    });
    await updateMessage(env, row.id, { display_text_status: "processing" });
  }
}

async function handleAttachmentDownload(request: Request, env: Env): Promise<Response> {
  if (getBearerToken(request) !== env.WORKER_AUTH_TOKEN) return jsonResponse({ error: "Unauthorized" }, 401);
  const objectKey = new URL(request.url).searchParams.get("key") ?? "";
  if (!objectKey.startsWith("inbound/")) return jsonResponse({ error: "A valid object key is required" }, 400);

  const object = await env.VENDOR_MAIL_BUCKET.get(objectKey);
  if (!object) return jsonResponse({ error: "File not found" }, 404);

  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/vendor-mail/attachment") {
      try {
        return await handleAttachmentDownload(request, env);
      } catch (error) {
        console.error("Attachment download failed", error);
        return jsonResponse({ error: (error as Error).message }, 500);
      }
    }
    if (request.method === "GET") return jsonResponse({ status: "ok" });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    try {
      if (pathname === "/vendor-mail/send") return await handleOutboundRequest(request, env);
      if (pathname === "/mailgun/inbound") return await handleInboundWebhook(request, env);
      if (pathname === "/mailgun/events") return await handleEventWebhook(request, env);
      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Vendor mail request failed", error);
      return jsonResponse({ error: (error as Error).message }, 500);
    }
  },

  async queue(batch: MessageBatch<OutboundJob | InboundJob | ExtractionJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        if (message.body.kind === "outbound") await processOutbound(message.body, env);
        else if (message.body.kind === "inbound") await processInbound(message.body, env);
        else await processExtraction(message.body, env);
        message.ack();
      } catch (error) {
        console.error("Vendor mail queue job failed", error);
        message.retry();
      }
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await queuePendingExtractions(env);
  },
};