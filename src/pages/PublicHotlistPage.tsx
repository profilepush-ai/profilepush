import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Building2, Clock3, ExternalLink, MapPin, MessageSquare, UserRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import Logo from '../components/Logo';
import LogoSpinner from '../components/LogoSpinner';
import Toast from '../components/Toast';

interface PublicHotlistLead {
  id: string;
  candidate_name: string;
  role_title: string;
  core_skills: string[];
  years_experience: number | null;
  visa_type: string;
  employment_type: string;
  work_type: string;
  locations: string[];
  hourly_rate_min: number | null;
  hourly_rate_max: number | null;
  availability: string;
  candidate_summary: string;
  bench_sales_company_name: string;
  bench_sales_recruiter_avatar_url: string | null;
  post_source: string;
  post_status: string;
  post_url: string;
  created_at: string;
}

const CONTACT_INTENT_KEY = 'ppush_contact_intent_hotlist';

export default function PublicHotlistPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState<'loading' | 'invalid' | 'ready'>('loading');
  const [lead, setLead] = useState<PublicHotlistLead | null>(null);
  const [contacting, setContacting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!id) { setStatus('invalid'); return; }
    void (async () => {
      const { data, error } = await supabase.rpc('get_public_hotlist_lead' as never, { p_id: id } as never);
      const row = (data as unknown as PublicHotlistLead[] | null)?.[0];
      if (error || !row) { setStatus('invalid'); return; }
      setLead(row);
      setStatus('ready');
    })();
  }, [id]);

  async function startChat() {
    if (!id) return;
    setContacting(true);
    try {
      const { data, error } = await supabase.rpc('start_post_chat_thread' as never, {
        p_post_kind: 'hotlist',
        p_post_id: id,
      } as never);
      if (error || !data) throw new Error(error?.message || 'Could not start the conversation');
      navigate(`/inbox/${data as string}`);
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : 'Could not start the conversation', type: 'error' });
    } finally {
      setContacting(false);
    }
  }

  // Same resume-after-login pattern as PublicJobPage: if the visitor clicked
  // Contact while logged out, they're sent to /signin with `from` pointing
  // back here, then this picks the intent back up once authenticated.
  useEffect(() => {
    if (authLoading || !user || status !== 'ready') return;
    if (sessionStorage.getItem(CONTACT_INTENT_KEY) === id) {
      sessionStorage.removeItem(CONTACT_INTENT_KEY);
      void startChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, status, id]);

  function handleContactClick() {
    if (!id) return;
    if (!user) {
      sessionStorage.setItem(CONTACT_INTENT_KEY, id);
      navigate('/signin', { state: { from: `/hotlist/${id}` } });
      return;
    }
    void startChat();
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LogoSpinner size={24} />
      </div>
    );
  }

  if (status === 'invalid' || !lead) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={24} className="text-red-400" />
          </div>
          <h1 className="text-base font-bold text-gray-900 mb-2">Consultant Not Found</h1>
          <p className="text-sm text-gray-500">This listing is no longer available.</p>
        </div>
      </div>
    );
  }

  const isUserPost = lead.post_source === 'user_post';
  const isClosed = lead.post_status === 'closed';
  const rateText = lead.hourly_rate_min || lead.hourly_rate_max
    ? `$${lead.hourly_rate_min ?? '?'}${lead.hourly_rate_max ? `–$${lead.hourly_rate_max}` : ''}/hr`
    : '';

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex items-center gap-1.5 font-bold text-blue-600 text-sm">
          <Logo size="sm" />
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 sm:p-8">
          <div className="flex items-start gap-3">
            {lead.bench_sales_recruiter_avatar_url ? (
              <img src={lead.bench_sales_recruiter_avatar_url} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <UserRound size={18} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-extrabold text-gray-900">
                  {lead.role_title || 'Available Consultant'}{lead.candidate_name ? ` — ${lead.candidate_name}` : ''}
                </h1>
                {isClosed && (
                  <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
                    Closed
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gray-500">
                {lead.bench_sales_company_name && (
                  <span className="inline-flex items-center gap-1"><Building2 size={13} />{lead.bench_sales_company_name}</span>
                )}
                {lead.locations.length > 0 && (
                  <span className="inline-flex items-center gap-1"><MapPin size={13} />{lead.locations.join(', ')}</span>
                )}
                {lead.availability && (
                  <span className="inline-flex items-center gap-1"><Clock3 size={13} />{lead.availability}</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {rateText && (
              <span className="inline-flex items-center rounded-lg bg-blue-50 px-3 py-1.5 text-[13px] font-semibold text-blue-700">
                {rateText}
              </span>
            )}
            {lead.years_experience != null && (
              <span className="inline-flex items-center rounded-lg bg-gray-100 px-3 py-1.5 text-[13px] font-semibold text-gray-600">
                {lead.years_experience}+ yrs experience
              </span>
            )}
            {lead.visa_type && (
              <span className="inline-flex items-center rounded-lg bg-gray-100 px-3 py-1.5 text-[13px] font-semibold text-gray-600">
                {lead.visa_type}
              </span>
            )}
          </div>

          {lead.core_skills.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {lead.core_skills.map((skill) => (
                <span key={skill} className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600">{skill}</span>
              ))}
            </div>
          )}

          {lead.candidate_summary && (
            <div className="mt-5 border-t border-gray-100 pt-5">
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-700">
                {lead.candidate_summary}
              </p>
            </div>
          )}

          <div className="mt-6 border-t border-gray-100 pt-5">
            {isUserPost ? (
              <>
                <button
                  type="button"
                  onClick={handleContactClick}
                  disabled={isClosed || contacting}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-md shadow-blue-900/20"
                >
                  <MessageSquare size={15} />
                  {isClosed ? 'No longer available' : contacting ? 'Starting…' : 'Contact About This Consultant'}
                </button>
                {!user && !isClosed && (
                  <p className="text-center text-[11px] text-gray-400 mt-3">You'll need to sign in first.</p>
                )}
              </>
            ) : lead.post_url ? (
              <a
                href={lead.post_url}
                target="_blank"
                rel="noreferrer"
                className="w-full bg-gray-900 hover:bg-gray-800 text-white font-bold text-sm px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <ExternalLink size={15} />
                View Original Post
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
