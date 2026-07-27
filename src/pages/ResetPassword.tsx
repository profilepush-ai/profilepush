import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Logo from '../components/Logo';
import LogoSpinner from '../components/LogoSpinner';

export default function ResetPassword() {
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSessionReady(!!data.session);
      setChecking(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setSessionReady(!!session);
        setChecking(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!password || !confirmPassword) {
      setError('Both password fields are required.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError('Unable to reset password. Please request a new reset link and try again.');
      setSubmitting(false);
      return;
    }

    setSuccess('Password updated successfully. Redirecting to sign in...');
    setSubmitting(false);
    setTimeout(() => navigate('/signin', { replace: true }), 1200);
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <LogoSpinner size={20} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center gap-2 text-blue-600 font-bold text-base mb-8">
          <Logo size="md" />
        </Link>

        <h1 className="text-2xl font-extrabold text-gray-900 mb-1">Reset your password</h1>
        <p className="text-gray-500 text-sm mb-8">Set a new password for your account.</p>

        {!sessionReady && (
          <div role="alert" className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm px-4 py-3 rounded-lg mb-6">
            This reset link is missing or expired. Request a new reset email from sign in.
          </div>
        )}

        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {success && (
          <div role="status" className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg mb-6">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-password" className="block text-xs font-semibold text-gray-700 mb-1.5">New password</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                autoComplete="new-password"
                disabled={!sessionReady || submitting}
              />
            </div>
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-xs font-semibold text-gray-700 mb-1.5">Confirm new password</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                autoComplete="new-password"
                disabled={!sessionReady || submitting}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!sessionReady || submitting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm shadow-blue-200"
          >
            {submitting ? (
              <><LogoSpinner size={15} /> Updating…</>
            ) : (
              <>Update Password <ArrowRight size={15} /></>
            )}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          Back to{' '}
          <Link to="/signin" className="text-blue-600 hover:text-blue-700 font-semibold transition-colors">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
