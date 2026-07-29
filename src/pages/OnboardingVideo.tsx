import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const LOOM_EMBED_URL = 'https://www.loom.com/embed/e4d985b799fe49f69f4f509d48d0cb98?autoplay=0&hide_owner=true&hide_share=true&hide_title=false&hideEmbedTopBar=false';

async function logOnboardingAction(
  userId: string,
  accountId: string | null,
  action: 'watched' | 'remind_later' | 'viewed',
) {
  await supabase.from('onboarding_logs').insert({
    user_id: userId,
    account_id: accountId ?? null,
    action,
    metadata: { source: 'onboarding_video_page', timestamp: new Date().toISOString() },
  });
}

export default function OnboardingVideo() {
  const navigate = useNavigate();
  const { user, account } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [watchedCount, setWatchedCount] = useState<number | null>(null);

  // Fetch count of users who watched (seed baseline + real count)
  const SEED_COUNT = 38; // baseline to show social proof from day 1
  useEffect(() => {
    supabase
      .from('onboarding_logs')
      .select('user_id', { count: 'exact', head: true })
      .eq('action', 'watched')
      .then(({ count }) => {
        setWatchedCount(SEED_COUNT + (count ?? 0));
      });
  }, []);

  // Log that the user viewed the onboarding screen
  useEffect(() => {
    if (user) {
      logOnboardingAction(user.id, account?.id ?? null, 'viewed');
    }
  }, [user, account]);

  async function handleConfirm() {
    setConfirming(true);
    if (user) {
      await logOnboardingAction(user.id, account?.id ?? null, 'watched');
    }
    navigate('/bench', { replace: true });
  }

  async function handleRemindLater() {
    if (user) {
      await logOnboardingAction(user.id, account?.id ?? null, 'remind_later');
    }
    navigate('/bench', { replace: true });
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4 py-10">

      {/* Logo */}
      <div className="mb-6">
        <Logo size="lg" white />
      </div>

      {/* Video — full width, prominent */}
      <div className="w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl bg-black">
        <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
          <iframe
            src={LOOM_EMBED_URL}
            frameBorder="0"
            allowFullScreen
            className="absolute inset-0 w-full h-full"
            title="ProfilePush Onboarding"
          />
        </div>
      </div>

      {/* Text + CTA below video */}
      <div className="w-full max-w-4xl mt-8 flex flex-col items-center gap-6 text-center">

        {/* Social proof */}
        {watchedCount !== null && (
          <div className="flex items-center gap-3 bg-white/10 border border-white/20 rounded-full px-4 py-2">
            <div className="flex -space-x-2">
              {[
                'https://randomuser.me/api/portraits/women/44.jpg',
                'https://randomuser.me/api/portraits/men/57.jpg',
                'https://randomuser.me/api/portraits/women/68.jpg',
                'https://randomuser.me/api/portraits/men/36.jpg',
              ].map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt="recruiter"
                  className="w-7 h-7 rounded-full border-2 border-gray-950 object-cover"
                />
              ))}
            </div>
            <span className="text-sm text-gray-300">
              <span className="text-white font-semibold">{watchedCount.toLocaleString()} recruiters</span> watched already to become power users
            </span>
          </div>
        )}
        <p className="text-white text-2xl font-bold leading-relaxed max-w-2xl">
          Bulk upload your hotlist.<br />
          Fetch <span className="text-blue-400">100 jobs</span> from 4+ boards.<br />
          Get <span className="text-blue-400">5 AI job matches.</span>
        </p>

        {/* Single CTA */}
        <button
          onClick={handleConfirm}
          disabled={confirming}
          className="w-full max-w-md bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm shadow-blue-900/40"
        >
          {confirming ? (
            <>
              <svg className="animate-spin w-4 h-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Taking you to your dashboard...
            </>
          ) : (
            <>I watched the video — Continue <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></>
          )}
        </button>

        {/* Skip */}
        <button
          onClick={handleRemindLater}
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          I'll watch later, remind me
        </button>
      </div>

    </div>
  );
}
