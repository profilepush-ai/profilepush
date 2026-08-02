import { useCallback, useState, useEffect, useRef } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import {
  Eye, EyeOff, ArrowRight, Building2, User, Mail, Lock,
  CheckCircle, Phone, ChevronDown, Search,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { buildSignupWebhookPayload, sendSignupWebhook } from '../lib/auth-webhook';
import Logo from '../components/Logo';
import LogoSpinner from '../components/LogoSpinner';
import AuthSidePanel from '../components/AuthSidePanel';

// ── Country data ───────────────────────────────────────────────────────────────

interface Country { code: string; dial: string; name: string; }

const COUNTRIES: Country[] = [
  { code: 'US', dial: '+1',    name: 'United States' },
  { code: 'IN', dial: '+91',   name: 'India' },
  { code: 'CA', dial: '+1',    name: 'Canada' },
  { code: 'GB', dial: '+44',   name: 'United Kingdom' },
  { code: 'AU', dial: '+61',   name: 'Australia' },
  { code: 'PH', dial: '+63',   name: 'Philippines' },
  { code: 'SG', dial: '+65',   name: 'Singapore' },
  { code: 'NZ', dial: '+64',   name: 'New Zealand' },
  { code: 'IE', dial: '+353',  name: 'Ireland' },
  { code: 'ZA', dial: '+27',   name: 'South Africa' },
  { code: 'NG', dial: '+234',  name: 'Nigeria' },
  { code: 'PK', dial: '+92',   name: 'Pakistan' },
  { code: 'BD', dial: '+880',  name: 'Bangladesh' },
  { code: 'LK', dial: '+94',   name: 'Sri Lanka' },
  { code: 'NP', dial: '+977',  name: 'Nepal' },
  { code: 'MY', dial: '+60',   name: 'Malaysia' },
  { code: 'ID', dial: '+62',   name: 'Indonesia' },
  { code: 'TH', dial: '+66',   name: 'Thailand' },
  { code: 'VN', dial: '+84',   name: 'Vietnam' },
  { code: 'CN', dial: '+86',   name: 'China' },
  { code: 'JP', dial: '+81',   name: 'Japan' },
  { code: 'KR', dial: '+82',   name: 'South Korea' },
  { code: 'HK', dial: '+852',  name: 'Hong Kong' },
  { code: 'TW', dial: '+886',  name: 'Taiwan' },
  { code: 'DE', dial: '+49',   name: 'Germany' },
  { code: 'FR', dial: '+33',   name: 'France' },
  { code: 'IT', dial: '+39',   name: 'Italy' },
  { code: 'ES', dial: '+34',   name: 'Spain' },
  { code: 'NL', dial: '+31',   name: 'Netherlands' },
  { code: 'SE', dial: '+46',   name: 'Sweden' },
  { code: 'NO', dial: '+47',   name: 'Norway' },
  { code: 'DK', dial: '+45',   name: 'Denmark' },
  { code: 'FI', dial: '+358',  name: 'Finland' },
  { code: 'PL', dial: '+48',   name: 'Poland' },
  { code: 'CH', dial: '+41',   name: 'Switzerland' },
  { code: 'BE', dial: '+32',   name: 'Belgium' },
  { code: 'AT', dial: '+43',   name: 'Austria' },
  { code: 'PT', dial: '+351',  name: 'Portugal' },
  { code: 'CZ', dial: '+420',  name: 'Czech Republic' },
  { code: 'RO', dial: '+40',   name: 'Romania' },
  { code: 'UA', dial: '+380',  name: 'Ukraine' },
  { code: 'RU', dial: '+7',    name: 'Russia' },
  { code: 'TR', dial: '+90',   name: 'Turkey' },
  { code: 'IL', dial: '+972',  name: 'Israel' },
  { code: 'SA', dial: '+966',  name: 'Saudi Arabia' },
  { code: 'AE', dial: '+971',  name: 'UAE' },
  { code: 'QA', dial: '+974',  name: 'Qatar' },
  { code: 'KW', dial: '+965',  name: 'Kuwait' },
  { code: 'EG', dial: '+20',   name: 'Egypt' },
  { code: 'GH', dial: '+233',  name: 'Ghana' },
  { code: 'KE', dial: '+254',  name: 'Kenya' },
  { code: 'MX', dial: '+52',   name: 'Mexico' },
  { code: 'BR', dial: '+55',   name: 'Brazil' },
  { code: 'AR', dial: '+54',   name: 'Argentina' },
  { code: 'CO', dial: '+57',   name: 'Colombia' },
  { code: 'CL', dial: '+56',   name: 'Chile' },
  { code: 'PE', dial: '+51',   name: 'Peru' },
];

function countryFlag(code: string): string {
  return code.toUpperCase().split('').map(c =>
    String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)
  ).join('');
}

function detectCountryCode(): string {
  const lang = navigator.language ?? 'en-US';
  const parts = lang.split('-');
  return parts.length >= 2 ? parts[parts.length - 1].toUpperCase() : 'US';
}

const DEFAULT_COUNTRY = COUNTRIES[0];
const DEFAULT_SIGNUP_REDIRECT = '/pulse';
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

// ── Country selector dropdown ─────────────────────────────────────────────────

function CountrySelector({
  value,
  onChange,
}: {
  value: Country;
  onChange: (c: Country) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
    else setSearch('');
  }, [open]);

  const filtered = search.trim()
    ? COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.dial.includes(search) ||
        c.code.toLowerCase().includes(search.toLowerCase())
      )
    : COUNTRIES;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 h-full px-3 text-sm text-gray-700 hover:bg-gray-50 rounded-l-lg transition-colors border-r border-gray-200 focus:outline-none"
      >
        <span className="text-base leading-none">{countryFlag(value.code)}</span>
        <span className="font-medium text-xs text-gray-600">{value.dial}</span>
        <ChevronDown size={11} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search country..."
                className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-7 pr-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>
          {/* List */}
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No results</p>
            ) : (
              filtered.map(c => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => { onChange(c); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-blue-50 transition-colors ${c.code === value.code ? 'bg-blue-50' : ''}`}
                >
                  <span className="text-base leading-none">{countryFlag(c.code)}</span>
                  <span className="text-xs text-gray-700 flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">{c.dial}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SignUp() {
  const navigate = useNavigate();
  const { refreshAccount, user, loading } = useAuth();

  const [fullName, setFullName]         = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail]               = useState('');
  const [phoneCountry, setPhoneCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [phone, setPhone]               = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [oauthSubmitting, setOauthSubmitting] = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? DEFAULT_GOOGLE_CLIENT_ID).trim();
  const showExtendedFields = email.trim().length > 0;

  // Auto-detect country from browser locale on mount
  useEffect(() => {
    const code = detectCountryCode();
    const found = COUNTRIES.find(c => c.code === code);
    if (found) setPhoneCountry(found);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <LogoSpinner size={20} />
      </div>
    );
  }

  if (user) return <Navigate to="/pulse" replace />;

  async function handleGoogleSignUp() {
    setOauthSubmitting(true);
    setError(null);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${DEFAULT_SIGNUP_REDIRECT}`,
      },
    });

    if (oauthError) {
      setError(oauthError.message);
      setOauthSubmitting(false);
    }
  }

  const handleGoogleCredential = useCallback(async (response: GoogleCredentialResponse) => {
    if (!response.credential) {
      setError('Google sign up did not return a credential. Please try again.');
      return;
    }

    setOauthSubmitting(true);
    setError(null);

    const { error: idTokenError } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: response.credential,
    });

    if (idTokenError) {
      setError(idTokenError.message);
      setOauthSubmitting(false);
      return;
    }

    const user = (await supabase.auth.getUser()).data.user;
    if (user) {
      // Create account + owner member row if this is a brand-new Google user
      const { data: existingMember } = await supabase
        .from('account_members')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      if (!existingMember) {
        const accountId = crypto.randomUUID();
        const displayName = (user.user_metadata?.full_name ?? user.user_metadata?.name ?? '').trim();
        const businessName = displayName || (user.email?.split('@')[0] ?? 'My Workspace');

        const { error: accErr } = await supabase
          .from('accounts')
          .insert({ id: accountId, name: businessName, owner_id: user.id });

        if (!accErr) {
          await supabase.from('account_members').insert({
            account_id: accountId,
            user_id: user.id,
            invited_email: user.email!,
            role: 'owner',
            status: 'active',
          });
        }
      }

      void sendSignupWebhook(buildSignupWebhookPayload({
        action: 'google oauth signup',
        userId: user.id,
        email: user.email ?? '',
        fullName: user.user_metadata?.full_name ?? user.user_metadata?.name ?? '',
        provider: 'google',
      }));
    }

    navigate(DEFAULT_SIGNUP_REDIRECT, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return;

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !businessName.trim() || !email.trim() || !phone.trim() || !password) {
      setError('All fields are required.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 5) {
      setError('Please enter a valid phone number.');
      return;
    }

    const fullPhone = `${phoneCountry.dial}${phone.trim()}`;

    setSubmitting(true);
    setError(null);

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim(), phone: fullPhone } },
    });

    if (signUpError) {
      setError(signUpError.message);
      setSubmitting(false);
      return;
    }

    const authUser = signUpData.user;
    if (!authUser) {
      setError('Signup failed — please try again.');
      setSubmitting(false);
      return;
    }

    if (!signUpData.session) {
      setConfirmEmail(true);
      setSubmitting(false);
      return;
    }

    const accountId = crypto.randomUUID();

    const { error: accountErr } = await supabase
      .from('accounts')
      .insert({ id: accountId, name: businessName.trim(), owner_id: authUser.id });

    if (accountErr) {
      setError(`Failed to create workspace: ${accountErr.message}`);
      setSubmitting(false);
      return;
    }

    const { error: memberErr } = await supabase
      .from('account_members')
      .insert({
        account_id: accountId,
        user_id: authUser.id,
        invited_email: authUser.email!,
        role: 'owner',
        status: 'active',
      });

    if (memberErr) {
      setError(`Workspace created but member setup failed: ${memberErr.message}`);
      setSubmitting(false);
      return;
    }

    // Fire webhook (non-blocking)
    void sendSignupWebhook(buildSignupWebhookPayload({
      action: 'new account signup',
      accountId,
      ownerId: authUser.id,
      userId: authUser.id,
      fullName: fullName.trim(),
      businessName: businessName.trim(),
      email: email.trim(),
      phone: fullPhone,
      provider: 'email',
    }));

    await refreshAccount();
    navigate(DEFAULT_SIGNUP_REDIRECT, { replace: true });
  }

  if (confirmEmail) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm text-center">
          <Link to="/" className="flex items-center justify-center gap-2 text-blue-600 font-bold text-base mb-10">
            <Logo size="md" />
          </Link>
          <div className="w-14 h-14 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={26} className="text-blue-600" />
          </div>
          <h1 className="text-xl font-extrabold text-gray-900 mb-2">Check your inbox</h1>
          <p className="text-gray-500 text-sm leading-relaxed mb-6">
            We sent a confirmation link to <span className="text-gray-900 font-semibold">{email}</span>. Click it to activate your account, then sign in — your workspace will be created automatically on first login.
          </p>
          <Link
            to="/signin"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm shadow-sm shadow-blue-200"
          >
            Go to Sign In <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
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

          <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 mb-1">Create your free account</h1>
          <p className="text-gray-500 text-sm mb-6 sm:mb-8">Start with Google or enter your work email to continue.</p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-6">
              {error}
            </div>
          )}

          {googleClientId ? (
            <div className="mb-4">
              <div ref={googleButtonRef} className="w-full" />
              {oauthSubmitting && (
                <div className="mt-2 text-xs text-gray-500 flex items-center gap-2">
                  <LogoSpinner size={14} /> Signing you up with Google...
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignUp}
              disabled={submitting || oauthSubmitting}
              className="w-full bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed text-gray-700 font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors mb-4"
            >
              {oauthSubmitting ? (
                <><LogoSpinner size={15} /> Redirecting to Google...</>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.4 12 2.4 6.9 2.4 2.8 6.5 2.8 11.6s4.1 9.2 9.2 9.2c5.3 0 8.8-3.7 8.8-8.9 0-.6-.1-1.1-.2-1.7H12z"/>
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

            {/* Work Email (first step) */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Work Email</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="jane@acmestaffing.com"
                  className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                  autoComplete="email"
                />
              </div>
            </div>

            {showExtendedFields && (
              <>
                {/* Full Name */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Your Full Name</label>
                  <div className="relative">
                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      placeholder="Jane Smith"
                      className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                      autoComplete="name"
                    />
                  </div>
                </div>

                {/* Business Name */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Business / Agency Name</label>
                  <div className="relative">
                    <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={businessName}
                      onChange={e => setBusinessName(e.target.value)}
                      placeholder="Acme Staffing LLC"
                      className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                      autoComplete="organization"
                    />
                  </div>
                </div>

                {/* Phone Number */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Phone Number</label>
                  <div className="flex border border-gray-200 rounded-lg overflow-visible focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all bg-white">
                    <CountrySelector value={phoneCountry} onChange={setPhoneCountry} />
                    <div className="relative flex-1">
                      <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="tel"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="555 123 4567"
                        className="w-full bg-transparent text-gray-900 placeholder-gray-400 text-sm rounded-r-lg pl-8 pr-4 py-2.5 focus:outline-none"
                        autoComplete="tel-national"
                      />
                    </div>
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Password</label>
                  <div className="relative">
                    <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Min. 6 characters"
                      className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || oauthSubmitting}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm shadow-blue-200 mt-2"
                >
                  {submitting ? (
                    <><LogoSpinner size={15} /> Creating account…</>
                  ) : (
                    <>Create Account <ArrowRight size={15} /></>
                  )}
                </button>
              </>
            )}
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link to="/signin" className="text-blue-600 hover:text-blue-700 font-semibold transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
