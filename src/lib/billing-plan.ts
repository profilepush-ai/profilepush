import { Capacitor } from '@capacitor/core';
import { Checkout } from 'capacitor-razorpay';

// Pro subscription tiers: 500-5000 credits/month, flat ₹1/credit — same
// tier list and rate as the one-time top-up packs, just billed monthly.
export const TIERS = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];

type FunctionsErrorLike = {
  message?: unknown;
  details?: unknown;
  context?: unknown;
  status?: unknown;
};

export function fmtINR(credits: number) {
  return `₹${credits.toLocaleString('en-IN')}`;
}

export function getBillingErrorMessage(error: unknown, fallback: string, serverErrorPayload?: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim();

  if (typeof serverErrorPayload === 'string' && serverErrorPayload.trim()) return serverErrorPayload.trim();
  if (typeof serverErrorPayload === 'object' && serverErrorPayload !== null) {
    const parsedServerPayload = parseBody(serverErrorPayload);
    if (parsedServerPayload) return parsedServerPayload;
  }

  if (error instanceof Error && error.message?.trim()) {
    const message = error.message.trim();
    if (message !== 'Edge Function returned a non-2xx status code') return message;
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as FunctionsErrorLike;
    const context = candidate.context;
    const details = candidate.details;

    const parseBody = (body: unknown): string | null => {
      if (!body) return null;
      if (typeof body === 'object') {
        const bodyObj = body as { message?: unknown; error?: unknown };
        if (typeof bodyObj.message === 'string') {
          const directMessage = bodyObj.message.trim();
          if (directMessage && directMessage !== 'Edge Function returned a non-2xx status code') return directMessage;
        }
        if (typeof bodyObj.error === 'string') {
          const directError = bodyObj.error.trim();
          if (directError && directError !== 'Edge Function returned a non-2xx status code') return directError;
        }
      }
      if (typeof body === 'string') {
        const trimmed = body.trim();
        if (!trimmed) return null;
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed === 'string') return parsed;
          if (parsed && typeof parsed === 'object') {
            const nested = parsed as { error?: unknown; message?: unknown };
            if (typeof nested.error === 'string' && nested.error.trim()) return nested.error.trim();
            if (typeof nested.message === 'string' && nested.message.trim()) return nested.message.trim();
          }
        } catch {
          return trimmed;
        }
        return trimmed;
      }

      if (typeof body === 'object') {
        const nested = body as { error?: unknown; message?: unknown; body?: unknown; response?: unknown };
        if (typeof nested.error === 'string' && nested.error.trim()) return nested.error.trim();
        if (typeof nested.message === 'string' && nested.message.trim()) return nested.message.trim();

        const nestedBody = nested.body;
        if (nestedBody) {
          const nestedMessage = parseBody(nestedBody);
          if (nestedMessage) return nestedMessage;
        }

        const responseBody = nested.response;
        if (responseBody && typeof responseBody === 'object') {
          const responseLike = responseBody as { body?: unknown };
          const responseMessage = parseBody(responseLike.body);
          if (responseMessage) return responseMessage;
        }
      }

      return null;
    };

    if (typeof details === 'string' && details.trim()) return details.trim();

    if (typeof context === 'object' && context !== null) {
      const contextLike = context as { body?: unknown; message?: unknown; status?: unknown; response?: unknown };
      const bodyMessage = parseBody(contextLike.body);
      if (bodyMessage) return bodyMessage;
      if (typeof contextLike.message === 'string' && contextLike.message.trim()) {
        const contextMessage = contextLike.message.trim();
        if (contextMessage !== 'Edge Function returned a non-2xx status code') return contextMessage;
      }
      if (contextLike.response && typeof contextLike.response === 'object') {
        const responseLike = contextLike.response as { body?: unknown };
        const responseMessage = parseBody(responseLike.body);
        if (responseMessage) return responseMessage;
      }
    }

    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      const candidateMessage = candidate.message.trim();
      if (candidateMessage !== 'Edge Function returned a non-2xx status code') return candidateMessage;
    }
  }

  return fallback;
}

export function loadRazorpay(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = (window as Window & { Razorpay?: unknown }).Razorpay;
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay'));
    document.head.appendChild(script);
  });
}

type RazorpayCheckoutOptions = {
  key: string;
  amount?: number;
  currency?: string;
  order_id?: string;
  subscription_id?: string;
  name: string;
  description: string;
  image?: string;
  prefill?: { name?: string; email?: string };
  theme?: { color?: string };
  handler: (response: Record<string, unknown>) => void | Promise<void>;
  onDismiss?: () => void;
};

// Web loads Razorpay's checkout.js and opens its in-page modal. Native
// (Capacitor Android) instead uses Razorpay's own native Checkout plugin —
// a real native Activity, not a WebView — since the web checkout can get
// stuck navigating through bank/UPI/OTP domains inside an embedded WebView.
// Both paths accept the same options shape so the 3 call sites in
// BillingPage.tsx don't need their own platform branching.
export async function openRazorpayCheckout(options: RazorpayCheckoutOptions): Promise<void> {
  const { handler, onDismiss, ...checkoutOptions } = options;

  if (Capacitor.isNativePlatform()) {
    try {
      // The plugin's bundled types only declare { key, amount }, but the
      // native side forwards the whole options object verbatim to
      // Razorpay's native SDK, same fields as the web checkout.js accepts.
      const result = await Checkout.open(checkoutOptions as unknown as { key: string; amount: string });
      const response = (result as unknown as { response?: unknown })?.response;
      const normalized = typeof response === 'string'
        ? (JSON.parse(response) as Record<string, unknown>)
        : (response as Record<string, unknown> | undefined) ?? {};
      await handler(normalized);
    } catch {
      onDismiss?.();
    }
    return;
  }

  await loadRazorpay();
  const rzp = new window.Razorpay({
    ...checkoutOptions,
    handler,
    modal: { ondismiss: onDismiss },
  });
  rzp.open();
}
