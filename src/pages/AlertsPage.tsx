import { useState } from 'react';
import { Bell, Clock, Zap } from 'lucide-react';
import AppNav from '../components/AppNav';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function AlertsPage() {
  const { user } = useAuth();
  const [joined, setJoined] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function joinWaitlist() {
    if (!user) return;
    setSubmitting(true);
    try {
      // Save as a feature request / roadmap item
      await supabase.from('feature_requests').upsert({
        user_id: user.id,
        title: 'Scheduled Alerts – Live job alerts for watchlist profiles',
        description: 'Daily scheduled job match alerts for watchlist profiles, delivered between 5 PM IST to 1 AM IST. Paid plan feature.',
      }, { onConflict: 'user_id,title' });
      setJoined(true);
    } catch {
      // silently fail
    }
    setSubmitting(false);
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-white overscroll-none pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
            <Bell size={28} className="text-amber-500" />
          </div>

          <h1 className="text-lg font-bold text-gray-900">Live Job Alerts</h1>
          <p className="mt-1 text-xs text-gray-500">Coming Soon</p>

          <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 text-left space-y-3">
            <div className="flex items-start gap-2.5">
              <Zap size={14} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-[12px] text-gray-700 leading-relaxed">
                Paid plan users will get access to <span className="font-semibold">live job alerts</span> for your watchlist profiles every day.
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <Clock size={14} className="text-blue-500 mt-0.5 shrink-0" />
              <p className="text-[12px] text-gray-700 leading-relaxed">
                Alerts delivered daily from <span className="font-semibold">5 PM IST to 1 AM IST</span> — matching jobs pushed directly to you.
              </p>
            </div>
          </div>

          {joined ? (
            <div className="mt-6 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
              <p className="text-xs font-semibold text-emerald-700">✓ You're on the waitlist!</p>
              <p className="text-[11px] text-emerald-600 mt-0.5">We'll notify you when alerts go live.</p>
            </div>
          ) : (
            <button
              onClick={joinWaitlist}
              disabled={submitting}
              className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
            >
              {submitting ? 'Joining...' : 'Join Waitlist'}
            </button>
          )}

          <p className="mt-3 text-[10px] text-gray-400">
            This will be saved to the roadmap as a feature request.
          </p>
        </div>
      </main>
    </div>
  );
}
