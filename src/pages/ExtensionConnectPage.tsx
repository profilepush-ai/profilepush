import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Puzzle } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';
import { toExtension } from '../lib/extension';
import { trackEvent } from '../lib/track';

// /extension: connects the ProfilePush Apply extension to this account (it
// gets the session to call AI Apply as the user).
export default function ExtensionConnectPage() {
  const [state, setState] = useState<'working' | 'connected' | 'missing'>('working');

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setState('missing'); return; }
      const res = await toExtension({
        type: 'pp-connect',
        session: { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at },
        user: { email: session.user.email },
      });
      setState(res?.ok ? 'connected' : 'missing');
      trackEvent('extension_connect', { ok: Boolean(res?.ok) });
    })();
  }, []);

  return (
    <div className="min-h-screen bg-[#f3f2ee] text-gray-900 dark:bg-[#1B1D21] dark:text-slate-100">
      <AppNav />
      <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
        {state === 'working' ? <LogoSpinner size={22} /> : state === 'connected' ? (
          <>
            <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-600 text-white"><Check size={32} strokeWidth={3} /></span>
            <h1 className="text-[24px] font-extrabold">ProfilePush Apply is connected</h1>
            <p className="text-gray-600 dark:text-slate-400">Open a job&apos;s application, click the ProfilePush icon in Chrome&apos;s toolbar, pick the profile and press Fill. You check it and press Apply. Each application the AI answers costs 4 credits.</p>
            <Link to="/today" className="rounded-full bg-blue-600 px-5 py-2.5 font-bold text-white">Back to Today</Link>
          </>
        ) : (
          <>
            <span className="grid h-16 w-16 place-items-center rounded-full bg-blue-600 text-white"><Puzzle size={30} /></span>
            <h1 className="text-[24px] font-extrabold">Add ProfilePush Apply to Chrome</h1>
            <p className="text-gray-600 dark:text-slate-400">It fills job applications on career sites for your profiles in one click. Install it, then open this page again to connect.</p>
          </>
        )}
      </main>
    </div>
  );
}
