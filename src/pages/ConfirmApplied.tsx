import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, PartyPopper } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Logo from '../components/Logo';
import LogoSpinner from '../components/LogoSpinner';

interface ConfirmationData {
  job_title: string;
  company: string;
  candidate_name: string;
  confirmed_at: string | null;
}

export default function ConfirmApplied() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<'loading' | 'pending' | 'already_confirmed' | 'confirmed' | 'invalid'>('loading');
  const [data, setData] = useState<ConfirmationData | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { loadConfirmation(); }, [token]);

  async function loadConfirmation() {
    if (!token) { setStatus('invalid'); return; }

    const { data: conf } = await supabase
      .from('apply_confirmations')
      .select(`
        id, confirmed_at, wishlisted_job_id,
        wishlisted_jobs(job_title, company),
        profiles(candidate_name)
      `)
      .eq('token', token)
      .maybeSingle();

    if (!conf) { setStatus('invalid'); return; }

    // @ts-ignore — dynamic join
    setData({
      job_title:      conf.wishlisted_jobs?.job_title ?? '',
      company:        conf.wishlisted_jobs?.company ?? '',
      candidate_name: conf.profiles?.candidate_name ?? '',
      confirmed_at:   conf.confirmed_at,
    });

    setStatus(conf.confirmed_at ? 'already_confirmed' : 'pending');
  }

  async function handleConfirm() {
    if (!token) return;
    setConfirming(true);

    const now = new Date().toISOString();

    // Update apply_confirmation
    const { error: confErr } = await supabase
      .from('apply_confirmations')
      .update({ confirmed_at: now })
      .eq('token', token);

    if (confErr) {
      setConfirming(false);
      alert('Something went wrong. Please try again.');
      return;
    }

    // Also mark the wishlisted_job as Applied
    const { data: conf } = await supabase
      .from('apply_confirmations')
      .select('wishlisted_job_id, profile_id')
      .eq('token', token)
      .maybeSingle();

    if (conf) {
      await supabase
        .from('wishlisted_jobs')
        .update({ status: 'Applied' })
        .eq('id', conf.wishlisted_job_id);

      await supabase.from('activity_logs').insert({
        profile_id: conf.profile_id,
        event_type: 'application_confirmed',
        description: `Candidate confirmed application for "${data?.job_title}" at ${data?.company}`,
      });
    }

    setStatus('confirmed');
    setConfirming(false);
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LogoSpinner size={24} />
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={24} className="text-red-400" />
          </div>
          <h1 className="text-base font-bold text-gray-900 mb-2">Link Not Found</h1>
          <p className="text-sm text-gray-500">This confirmation link is invalid or has expired. Please contact your recruiter.</p>
        </div>
      </div>
    );
  }

  if (status === 'already_confirmed' || status === 'confirmed') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            {status === 'confirmed' ? <PartyPopper size={26} className="text-emerald-500" /> : <CheckCircle2 size={28} className="text-emerald-500" />}
          </div>
          <h1 className="text-base font-bold text-gray-900 mb-2">
            {status === 'confirmed' ? 'Thank You for Confirming!' : 'Already Confirmed'}
          </h1>
          {data && (
            <div className="bg-gray-50 rounded-xl px-4 py-3 mb-4 text-left">
              <p className="text-xs text-gray-500 mb-1">Application for:</p>
              <p className="text-sm font-bold text-gray-800">{data.job_title}</p>
              <p className="text-xs text-gray-500">{data.company}</p>
            </div>
          )}
          <p className="text-sm text-gray-500">
            {status === 'confirmed'
              ? 'Your application has been confirmed. Your recruiter will follow up with you soon.'
              : 'You have already confirmed this application. Your recruiter has been notified.'}
          </p>
        </div>
      </div>
    );
  }

  // status === 'pending'
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 max-w-sm w-full">

        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-1.5 font-bold text-blue-600 text-sm mb-4">
            <Logo size="sm" />
          </div>
          <h1 className="text-lg font-extrabold text-gray-900 mb-2">Confirm Your Application</h1>
          <p className="text-sm text-gray-500">
            Hi <strong>{data?.candidate_name}</strong>, please confirm that you applied for this position.
          </p>
        </div>

        {data && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-4 mb-6">
            <p className="text-[11px] font-semibold text-blue-500 uppercase tracking-wide mb-1">Position</p>
            <p className="text-base font-bold text-gray-900">{data.job_title}</p>
            <p className="text-sm text-gray-500">{data.company}</p>
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={confirming}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-sm px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-md shadow-emerald-900/20"
        >
          {confirming ? <LogoSpinner size={15} /> : <CheckCircle2 size={15} />}
          {confirming ? 'Confirming…' : 'Yes, I Applied for This Job'}
        </button>

        <p className="text-center text-[11px] text-gray-400 mt-4">
          This helps your recruiter track your application status automatically.
        </p>
      </div>
    </div>
  );
}
