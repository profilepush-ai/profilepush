import { useState } from 'react';
import { Link, useLocation, Navigate } from 'react-router-dom';
import { Eye, EyeOff, ArrowRight, Mail, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import Logo from '../components/Logo';
import LogoSpinner from '../components/LogoSpinner';

export default function SignIn() {
  const location = useLocation();
  const { user, loading } = useAuth();
  const from = (location.state as { from?: string })?.from ?? '/job-finder';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(signInError.message === 'Invalid login credentials'
          ? 'Incorrect email or password. Please try again.'
          : signInError.message);
        setSubmitting(false);
        return;
      }

      // Hard redirect so the page reinitializes with the session from storage,
      // avoiding any race between navigate() and onAuthStateChange firing.
      window.location.replace(from);
    } catch {
      setError('Unable to reach the server. Please check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white flex">
      {/* Left panel — brand */}
      <div className="hidden lg:flex lg:w-1/2 bg-gray-100 flex-col justify-between p-12">
        <Link to="/" className="flex items-center gap-2 font-bold text-lg">
          <Logo size="lg" />
        </Link>

        <div className="space-y-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-3">Job Sourcing</p>
            <h2 className="text-3xl font-extrabold text-gray-900 leading-tight mb-4">
              Source jobs from every<br />board in one click.
            </h2>
            <p className="text-gray-500 text-sm leading-relaxed">
              LinkedIn, Indeed, Dice, Monster, CareerBuilder — searched simultaneously. Stop switching tabs and start placing candidates.
            </p>
          </div>

          {/* Review widget */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <div className="flex gap-0.5 mb-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <svg key={i} viewBox="0 0 16 16" fill="#FBBF24" className="w-3.5 h-3.5">
                  <path d="M8 1l1.85 3.75L14 5.5l-3 2.92.7 4.1L8 10.4l-3.7 2.12.7-4.1L2 5.5l4.15-.75L8 1z" />
                </svg>
              ))}
            </div>
            <p className="text-gray-600 text-sm leading-relaxed mb-4">"We cut our sourcing time in half. ProfilePush searches every board at once — it's a game changer."</p>
            <div>
              <p className="text-gray-900 text-sm font-semibold">Priya Nair</p>
              <p className="text-gray-400 text-xs">Senior Bench Sales Recruiter, TechForce Staffing</p>
            </div>
          </div>
        </div>

        <p className="text-gray-400 text-xs">© {new Date().getFullYear()} ProfilePush · Built for Bench Sales Recruiters</p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Link to="/" className="flex items-center gap-2 text-blue-600 font-bold text-base mb-10 lg:hidden">
            <Logo size="md" />
          </Link>

          <h1 className="text-2xl font-extrabold text-gray-900 mb-1">Welcome back</h1>
          <p className="text-gray-500 text-sm mb-8">Sign in to your ProfilePush workspace.</p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Email</label>
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

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Your password"
                  className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                  autoComplete="current-password"
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
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm shadow-blue-200 mt-2"
            >
              {submitting ? (
                <><LogoSpinner size={15} /> Signing in…</>
              ) : (
                <>Sign In <ArrowRight size={15} /></>
              )}
            </button>
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
