import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ArrowRight, Mail, Lock } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { buildSignupWebhookPayload, sendSignupWebhook } from '../lib/auth-webhook';
import { startNativeGoogleSignIn } from '../lib/native-auth';
import { ensureAccountForUser } from '../lib/account-provisioning';
import Logo from '../components/Logo';
import LogoSpinner from '../components/LogoSpinner';
import AuthSidePanel from '../components/AuthSidePanel';

const isNativeApp = Capacitor.isNativePlatform();

const DEFAULT_REDIRECT = '/feed';
const DEFAULT_GOOGLE_CLIENT_ID = '643376526329-3dtoi5no98bdopoe7pj1bqeeefcfbi65.apps.googleusercontent.com';

type GoogleCredentialResponse = {
  credential?: string;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: 'standard' | 'icon';
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'small' | 'medium' | 'large';
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              logo_alignment?: 'left' | 'center';
              width?: number;
            }
          ) => void;
          prompt: () => void;
        };
      };
    };
  }
}

function getSafeRedirect(path: string | undefined): string {
  if (!path) return DEFAULT_REDIRECT;
  if (!path.startsWith('/')) return DEFAULT_REDIRECT;
  if (path.startsWith('//')) return DEFAULT_REDIRECT;
  if (path.includes('://')) return DEFAULT_REDIRECT;
  return path;
}

function normalizeAuthError(message: string): string {
  if (message.toLowerCase().includes('invalid login credentials')) {
    return 'Incorrect email or password. Please try again.';
  }
  if (message.toLowerCase().includes('email not confirmed')) {
    return 'Please confirm your email before signing in.';
  }
  if (message.toLowerCase().includes('too many requests')) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  return 'Unable to sign in right now. Please try again.';
}

export default function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();
  const from = getSafeRedirect((location.state as { from?: string } | undefined)?.from);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [oauthSubmitting, setOauthSubmitting] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? DEFAULT_GOOGLE_CLIENT_ID).trim();
  const showPasswordStep = email.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setInfo(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(normalizeAuthError(signInError.message));
        setSubmitting(false);
        return;
      }

      navigate(from, { replace: true });
    } catch {
      setError('Unable to reach the server. Please check your connection and try again.');
      setSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setOauthSubmitting(true);
    setError(null);
    setInfo(null);

    // Native: hand off to the system browser (Chrome Custom Tabs) and read
    // the session back via deep link — Google's Identity Services SDK
    // blocks the in-app WebView outright, so this can't just navigate the
    // current page like the web fallback below does.
    if (isNativeApp) {
      const { error: nativeError } = await startNativeGoogleSignIn();
      if (nativeError) {
        setError(normalizeAuthError(nativeError));
        setOauthSubmitting(false);
      }
      return;
    }

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${from}`,
      },
    });

    if (oauthError) {
      setError(normalizeAuthError(oauthError.message));
      setOauthSubmitting(false);
    }
  }

  const handleGoogleCredential = useCallback(async (response: GoogleCredentialResponse) => {
    if (!response.credential) {
      setError('Google sign in did not return a credential. Please try again.');
      return;
    }

    setOauthSubmitting(true);
    setError(null);
    setInfo(null);

    const { error: idTokenError } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: response.credential,
    });

    if (idTokenError) {
      setError(normalizeAuthError(idTokenError.message));
      setOauthSubmitting(false);
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

    navigate(from, { replace: true });
  }, [from, navigate]);

  useEffect(() => {
    if (isNativeApp || !googleClientId || !googleButtonRef.current) return;

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
        width: Math.min(380, googleButtonRef.current.offsetWidth),
      });

      window.google.accounts.id.prompt();
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
  }, [googleClientId, handleGoogleCredential]);

  async function handleForgotPassword() {
    if (!email.trim()) {
      setError('Enter your email first, then click Forgot password.');
      return;
    }

    setResettingPassword(true);
    setError(null);
    setInfo(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (resetError) {
      setError(normalizeAuthError(resetError.message));
    } else {
      setInfo('If your email exists, a password reset link has been sent.');
    }

    setResettingPassword(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <LogoSpinner size={20} />
      </div>
    );
  }

  if (user) {
    return <Navigate to={from} replace />;
  }

  return (
    <div className="min-h-screen bg-white flex">
      <AuthSidePanel />

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-4 py-6 sm:px-6 sm:py-12">
        <div className="w-full max-w-sm">
          <Link to="/" className="flex items-center gap-2 text-blue-600 font-bold text-base mb-10 lg:hidden">
            <Logo size="md" />
          </Link>

          <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 mb-1">Welcome back</h1>
          <p className="text-gray-500 text-sm mb-6 sm:mb-8">Start with Google or enter your work email to continue.</p>

          {error && (
            <div id="sign-in-error" role="alert" aria-live="assertive" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-6">
              {error}
            </div>
          )}

          {info && (
            <div role="status" aria-live="polite" className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg mb-6">
              {info}
            </div>
          )}

          {!isNativeApp && googleClientId ? (
            <div className="mb-4">
              <div ref={googleButtonRef} className="w-full" />
              {oauthSubmitting && (
                <div className="mt-2 text-xs text-gray-500 flex items-center gap-2">
                  <LogoSpinner size={14} /> Signing you in with Google...
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={submitting || oauthSubmitting || resettingPassword}
              className="w-full h-11 bg-white border border-[#dadce0] hover:bg-[#f8f9fa] active:bg-[#f1f3f4] disabled:opacity-60 disabled:cursor-not-allowed text-[#3c4043] text-sm font-medium rounded-full flex items-center justify-center gap-3 transition-colors mb-4 shadow-sm"
            >
              {oauthSubmitting ? (
                <><LogoSpinner size={15} /> Redirecting to Google...</>
              ) : (
                <>
                  <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
                    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
                    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
                    <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" />
                    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
                  </svg>
                  Continue with Google
                </>
              )}
            </button>
          )}

          <div className="flex items-center gap-3 mb-4">
            <div className="h-px bg-gray-200 flex-1" />
            <span className="text-xs text-gray-400">OR</span>
            <div className="h-px bg-gray-200 flex-1" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-gray-700 mb-1.5">Work Email</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="jane@acmestaffing.com"
                  className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                  autoComplete="email"
                  aria-invalid={!!error}
                  aria-describedby={error ? 'sign-in-error' : undefined}
                />
              </div>
            </div>

            {showPasswordStep && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="password" className="block text-xs font-semibold text-gray-700">Password</label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={submitting || oauthSubmitting || resettingPassword}
                      className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {resettingPassword ? 'Sending…' : 'Forgot password?'}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Your password"
                      className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                      autoComplete="current-password"
                      aria-invalid={!!error}
                      aria-describedby={error ? 'sign-in-error' : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || oauthSubmitting || resettingPassword}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm shadow-blue-200 mt-2"
                >
                  {submitting ? (
                    <><LogoSpinner size={15} /> Signing in…</>
                  ) : (
                    <>Sign In <ArrowRight size={15} /></>
                  )}
                </button>
              </>
            )}
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Don't have an account?{' '}
            <Link to="/signup" className="text-blue-600 hover:text-blue-700 font-semibold transition-colors">
              Create free account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
