import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// gmail.readonly was dropped (2026-08-25) to speed up Google's OAuth
// verification review — restricted/sensitive scopes that read a user's
// inbox draw much more scrutiny than gmail.send alone. This means
// gmail-sync (which needs readonly to poll vendor reply threads) is no
// longer usable — see its own disabled short-circuit — so sending via a
// connected Gmail account works, but replies no longer sync back into
// ProfilePush's Inbox automatically.
export const GMAIL_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
].join(" ");

const TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000;
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

export class GmailDisconnectedError extends Error {
  constructor(message = "Gmail is not connected") {
    super(message);
    this.name = "GmailDisconnectedError";
  }
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return base64Decode(padded);
}

async function importAesKey(keyBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", base64Decode(keyBase64), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plaintext: string, keyBase64: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await importAesKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return { ciphertext: base64Encode(new Uint8Array(encrypted)), iv: base64Encode(iv) };
}

export async function decryptToken(ciphertextBase64: string, ivBase64: string, keyBase64: string): Promise<string> {
  const key = await importAesKey(keyBase64);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Decode(ivBase64) },
    key,
    base64Decode(ciphertextBase64),
  );
  return new TextDecoder().decode(decrypted);
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
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

/** Same-origin relative path (+ optional query string) only — rejects protocol-relative ("//host/..."), absolute ("https://..."), and anything else that could turn the signed callback redirect into an open redirect. We sign whatever the caller passes here, so this must be validated before signing, not just trusted because the result ends up inside a signature. */
export function isSafeReturnPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 500 && /^\/(?!\/)[A-Za-z0-9\-._~/?=&%]*$/.test(value);
}

/** Signed, short-lived state param carrying who initiated the OAuth flow and where to send them back — verified on callback since Google redirects the browser there with no Supabase session header. */
export async function signOAuthState(userId: string, accountId: string, returnTo?: string | null): Promise<string> {
  const secret = Deno.env.get("GMAIL_STATE_SIGNING_SECRET")!;
  const payload = JSON.stringify({ userId, accountId, returnTo: returnTo ?? null, nonce: crypto.randomUUID(), issuedAt: Date.now() });
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(payload));
  const signature = await hmacHex(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifyOAuthState(state: string): Promise<{ userId: string; accountId: string; returnTo: string | null } | null> {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) return null;
  const secret = Deno.env.get("GMAIL_STATE_SIGNING_SECRET")!;
  const expected = await hmacHex(secret, encodedPayload);
  if (!timingSafeEqual(expected, signature)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as
      { userId: string; accountId: string; returnTo?: string | null; issuedAt: number };
    if (Date.now() - payload.issuedAt > OAUTH_STATE_MAX_AGE_MS) return null;
    if (!payload.userId || !payload.accountId) return null;
    return { userId: payload.userId, accountId: payload.accountId, returnTo: isSafeReturnPath(payload.returnTo) ? payload.returnTo : null };
  } catch {
    return null;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({
      client_id: Deno.env.get("GMAIL_OAUTH_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_OAUTH_CLIENT_SECRET")!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !payload.access_token) {
    if (payload.error === "invalid_grant") throw new GmailDisconnectedError("Gmail access was revoked");
    throw new Error(`Gmail token refresh failed: ${payload.error ?? response.status}`);
  }
  return { accessToken: payload.access_token, expiresInSeconds: payload.expires_in ?? 3600 };
}

type GmailIntegrationRow = {
  id: string;
  gmail_address: string;
  status: string;
  access_token_encrypted: string;
  access_token_iv: string;
  access_token_expires_at: string;
  refresh_token_encrypted: string;
  refresh_token_iv: string;
};

/** Returns a live access token for the user's connected Gmail account, refreshing and persisting it first if it's near expiry. Throws GmailDisconnectedError if not connected or the refresh token was revoked (and marks the integration 'revoked' in that case). */
// deno-lint-ignore no-explicit-any
export async function getValidAccessToken(supabaseAdmin: SupabaseClient<any, any, any>, userId: string): Promise<{ accessToken: string; gmailAddress: string; integrationId: string }> {
  const { data: integration, error } = await supabaseAdmin
    .from("gmail_integrations")
    .select("id, gmail_address, status, access_token_encrypted, access_token_iv, access_token_expires_at, refresh_token_encrypted, refresh_token_iv")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const row = integration as GmailIntegrationRow | null;
  if (!row || row.status !== "connected") throw new GmailDisconnectedError();

  const encryptionKey = Deno.env.get("GMAIL_TOKEN_ENCRYPTION_KEY")!;
  const expiresAt = new Date(row.access_token_expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
    const accessToken = await decryptToken(row.access_token_encrypted, row.access_token_iv, encryptionKey);
    return { accessToken, gmailAddress: row.gmail_address, integrationId: row.id };
  }

  const refreshToken = await decryptToken(row.refresh_token_encrypted, row.refresh_token_iv, encryptionKey);
  try {
    const refreshed = await refreshAccessToken(refreshToken);
    const encryptedAccess = await encryptToken(refreshed.accessToken, encryptionKey);
    await supabaseAdmin
      .from("gmail_integrations")
      .update({
        access_token_encrypted: encryptedAccess.ciphertext,
        access_token_iv: encryptedAccess.iv,
        access_token_expires_at: new Date(Date.now() + refreshed.expiresInSeconds * 1000).toISOString(),
        status: "connected",
        last_error: null,
      })
      .eq("id", row.id);
    return { accessToken: refreshed.accessToken, gmailAddress: row.gmail_address, integrationId: row.id };
  } catch (refreshError) {
    if (refreshError instanceof GmailDisconnectedError) {
      await supabaseAdmin
        .from("gmail_integrations")
        .update({ status: "revoked", last_error: refreshError.message })
        .eq("id", row.id);
    }
    throw refreshError;
  }
}

function buildRawMessage(params: {
  fromName: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  textBody: string;
  inReplyTo?: string | null;
  references?: string | null;
}): string {
  const safeFromName = params.fromName.replace(/[\r\n"]/g, "");
  const headers = [
    `From: ${safeFromName} <${params.fromAddress}>`,
    `To: ${params.toAddress}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(params.subject)))}?=`,
    "MIME-Version: 1.0",
    `Content-Type: text/plain; charset="UTF-8"`,
    "Content-Transfer-Encoding: 7bit",
  ];
  if (params.inReplyTo) headers.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) headers.push(`References: ${params.references}`);
  return `${headers.join("\r\n")}\r\n\r\n${params.textBody}`;
}

/** Decodes a Gmail API base64url-encoded message body part into UTF-8 text. */
export function decodeGmailBase64Url(value: string): string {
  return new TextDecoder().decode(base64UrlDecode(value));
}

/** Sends a plain-text message via the Gmail API on behalf of the connected user, threading it via `threadId` when replying to an existing conversation. */
export async function sendViaGmail(params: {
  accessToken: string;
  fromName: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  textBody: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
}): Promise<{ id: string; threadId: string }> {
  const raw = buildRawMessage(params);
  const encodedRaw = base64UrlEncode(new TextEncoder().encode(raw));

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ raw: encodedRaw, ...(params.threadId ? { threadId: params.threadId } : {}) }),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; threadId?: string; error?: { message?: string } };
  if (!response.ok || !payload.id || !payload.threadId) {
    if (response.status === 401) throw new GmailDisconnectedError("Gmail send was unauthorized");
    throw new Error(payload.error?.message ?? `Gmail send HTTP ${response.status}`);
  }
  return { id: payload.id, threadId: payload.threadId };
}
