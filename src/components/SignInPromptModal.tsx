import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
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

export default function SignInPromptModal({
  open,
  onClose,
  onSuccess,
  message = 'Sign in to download the full list.',
  signInPath = '/signin',
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  message?: string;
  signInPath?: string;
}) {
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
    if (!open || isNativeApp || !googleClientId || !googleButtonRef.current) return;

    const initializeGoogleButton = () => {
      if (!window.google?.accounts?.id || !googleButtonRef.current) return;

      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleGoogleCredential,
      });

      googleButtonRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: 'standard',
        size: 'large',
        theme: 'outline',
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'left',
        width: Math.min(320, googleButtonRef.current.offsetWidth),
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
  }, [open, googleClientId, handleGoogleCredential]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <X size={15} />
        </button>
        <div className="px-6 pb-7 pt-8 text-center">
          <p className="text-[15px] font-semibold text-gray-900">{message}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500">It's free — takes about 10 seconds.</p>

          {submitting ? (
            <div className="mt-6 flex items-center justify-center py-2">
              <LogoSpinner size={18} />
            </div>
          ) : (
            <>
              {!isNativeApp && googleClientId && (
                <div className="mt-6 flex justify-center">
                  <div ref={googleButtonRef} />
                </div>
              )}
              {error && <p className="mt-3 text-[12px] text-red-600">{error}</p>}
              <p className="mt-5 text-[12px] text-gray-400">
                or <Link to={signInPath} onClick={onClose} className="font-semibold text-blue-600 hover:underline">sign in with email</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
