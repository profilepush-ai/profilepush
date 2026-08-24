import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase';
import { ensureAccountForUser } from '../lib/account-provisioning';
import { buildSignupWebhookPayload, sendSignupWebhook } from '../lib/auth-webhook';
import LogoSpinner from './LogoSpinner';

const isNativeApp = Capacitor.isNativePlatform();
const DEFAULT_GOOGLE_CLIENT_ID = '643376526329-3dtoi5no98bdopoe7pj1bqeeefcfbi65.apps.googleusercontent.com';

type GoogleCredentialResponse = { credential?: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void;
          renderButton: (parent: HTMLElement, options: {
            type?: 'standard' | 'icon';
            theme?: 'outline' | 'filled_blue' | 'filled_black';
            size?: 'small' | 'medium' | 'large';
            text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
            shape?: 'rectangular' | 'pill' | 'circle' | 'square';
            logo_alignment?: 'left' | 'center';
            width?: number;
          }) => void;
          prompt: () => void;
        };
      };
    };
  }
}

// Renders the real Google Identity Services button and handles the full
// sign-in flow (credential exchange, account provisioning, signup webhook),
// then calls onSuccess — shared by SignInPromptModal and any other spot
// (e.g. GatedPreviewTable's lock overlay) that wants the button inline
// instead of behind a separate modal.
export default function GoogleSignInButton({ onSuccess, width = 320 }: { onSuccess: () => void; width?: number }) {
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? DEFAULT_GOOGLE_CLIENT_ID).trim();

  const handleGoogleCredential = useCallback(async (response: GoogleCredentialResponse) => {
    if (!response.credential) {
      setError('Google sign in did not return a credential. Please try again.');
      return;
    }
    setSubmitting(true);
    setError('');

    const { error: idTokenError } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: response.credential,
    });

    if (idTokenError) {
      setError(idTokenError.message);
      setSubmitting(false);
      return;
    }

    const user = (await supabase.auth.getUser()).data.user;
    if (user) {
      await ensureAccountForUser(user);
      void sendSignupWebhook(buildSignupWebhookPayload({
        action: 'google oauth sign in',
        userId: user.id,
        email: user.email ?? '',
        fullName: user.user_metadata?.full_name ?? user.user_metadata?.name ?? '',
        provider: 'google',
      }));
    }

    setSubmitting(false);
    onSuccess();
  }, [onSuccess]);

  useEffect(() => {
    if (isNativeApp || !googleClientId || !googleButtonRef.current) return;

    const initializeGoogleButton = () => {
      if (!window.google?.accounts?.id || !googleButtonRef.current) return;

      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleGoogleCredential,
      });

      googleButtonRef.current.innerHTML = '';
      // Measure the parent, not googleButtonRef.current itself: the ref div
      // is still empty at this point (Google hasn't inserted the button
      // markup yet), so its own offsetWidth always reads 0 and the fallback
      // silently wins every time. The parent is a plain block/flex box with
      // no width of its own, so it's already been laid out to the real
      // available width from the caller's container (a narrow lock-overlay
      // card vs. a wider modal, for example) — measuring it is what actually
      // makes this responsive instead of a fixed 320px in every context.
      const availableWidth = googleButtonRef.current.parentElement?.offsetWidth;
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: 'standard',
        size: 'large',
        theme: 'outline',
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'left',
        width: Math.min(width, availableWidth || width),
      });
    };

    const existingScript = document.getElementById('google-gsi-script') as HTMLScriptElement | null;
    if (existingScript) {
      if (window.google?.accounts?.id) {
        initializeGoogleButton();
      } else {
        existingScript.addEventListener('load', initializeGoogleButton, { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initializeGoogleButton;
    document.head.appendChild(script);
  }, [googleClientId, handleGoogleCredential, width]);

  if (isNativeApp || !googleClientId) return null;

  if (submitting) {
    return (
      <div className="flex items-center justify-center py-2">
        <LogoSpinner size={18} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-center">
        <div ref={googleButtonRef} />
      </div>
      {error && <p className="mt-3 text-center text-[12px] text-red-600">{error}</p>}
    </div>
  );
}
