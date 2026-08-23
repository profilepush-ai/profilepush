import { supabase } from './supabase';

const SIGNUP_WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/48XyGfN1WxneooOcHGHn/webhook-trigger/5acdf9f6-c8e2-44ea-91be-163a46cf83fd';

export type SignupWebhookPayload = Record<string, string>;

export function buildSignupWebhookPayload(params: {
  action: string;
  userId?: string;
  accountId?: string;
  ownerId?: string;
  email?: string;
  fullName?: string;
  businessName?: string;
  phone?: string;
  provider?: string;
}): SignupWebhookPayload {
  const payload: SignupWebhookPayload = {
    action: params.action,
    user_id: params.userId ?? '',
    email: params.email ?? '',
    full_name: params.fullName ?? '',
    auth_provider: params.provider ?? 'email',
  };

  if (params.accountId) payload.account_id = params.accountId;
  if (params.ownerId) payload.owner_id = params.ownerId;
  if (params.businessName) payload.business_name = params.businessName;
  if (params.phone) payload.phone = params.phone;

  return payload;
}

export async function sendSignupWebhook(payload: SignupWebhookPayload) {
  try {
    await fetch(SIGNUP_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Signup webhook failed:', err);
  }
}

export async function sendWelcomeEmail() {
  try {
    const { error } = await supabase.functions.invoke('send-welcome-email');
    if (error) console.error('Welcome email failed:', error);
  } catch (err) {
    console.error('Welcome email failed:', err);
  }
}
