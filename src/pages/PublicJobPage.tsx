import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Briefcase, Building2, Clock3, ExternalLink, MapPin, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import Logo from '../components/Logo';
import LogoSpinner from '../components/LogoSpinner';
import Toast from '../components/Toast';
import SubmitApplicationModal from '../components/SubmitApplicationModal';

interface PublicJobLead {
  id: string;
  job_title: string;
  company_name: string;
  location: string;
  employment_type: string;
  seniority_level: string;
  job_description: string;
  salary_range: string;
  post_source: string;
  post_status: string;
  post_url: string;
  avatar_url: string | null;
  posted_by_name: string;
  created_at: string;
}

const APPLY_INTENT_KEY = 'ppush_apply_intent_job';

export default function PublicJobPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState<'loading' | 'invalid' | 'ready'>('loading');
  const [job, setJob] = useState<PublicJobLead | null>(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!id) { setStatus('invalid'); return; }
    void (async () => {
      const { data, error } = await supabase.rpc('get_public_job_lead' as never, { p_id: id } as never);
      const row = (data as unknown as PublicJobLead[] | null)?.[0];
      if (error || !row) { setStatus('invalid'); return; }
      setJob(row);
      setStatus('ready');
    })();
  }, [id]);

  // If the visitor clicked Apply while logged out, they're sent to /signin
  // with a `from` pointing back here; once they're back and authenticated,
  // resume straight into the modal instead of making them click Apply again.
  useEffect(() => {
    if (authLoading || !user || status !== 'ready') return;
    if (sessionStorage.getItem(APPLY_INTENT_KEY) === id) {
      sessionStorage.removeItem(APPLY_INTENT_KEY);
      setShowApplyModal(true);
    }
  }, [authLoading, user, status, id]);

  function handleApplyClick() {
    if (!id) return;
    if (!user) {
      sessionStorage.setItem(APPLY_INTENT_KEY, id);
      navigate('/signin', { state: { from: `/job/${id}` } });
      return;
    }
    setShowApplyModal(true);
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LogoSpinner size={24} />
      </div>
    );
  }

  if (status === 'invalid' || !job) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={24} className="text-red-400" />
          </div>
          <h1 className="text-base font-bold text-gray-900 mb-2">Job Not Found</h1>
          <p className="text-sm text-gray-500">This job posting is no longer available.</p>
        </div>
      </div>
    );
  }

  const isUserPost = job.post_source === 'user_post';
  const isClosed = job.post_status === 'closed';

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex items-center gap-1.5 font-bold text-blue-600 text-sm">
          <Logo size="sm" />
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 sm:p-8">
          <div className="flex items-start gap-3">
            {job.avatar_url ? (
              <img src={job.avatar_url} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <Briefcase size={18} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-extrabold text-gray-900">{job.job_title || 'Job Opportunity'}</h1>
                {isClosed && (
                  <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
                    Closed
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gray-500">
                {job.company_name && (
                  <span className="inline-flex items-center gap-1"><Building2 size={13} />{job.company_name}</span>
                )}
                {job.location && (
                  <span className="inline-flex items-center gap-1"><MapPin size={13} />{job.location}</span>
                )}
                {job.employment_type && (
                  <span className="inline-flex items-center gap-1"><Clock3 size={13} />{job.employment_type}</span>
                )}
              </div>
            </div>
          </div>

          {job.salary_range && (
            <div className="mt-4 inline-flex items-center rounded-lg bg-blue-50 px-3 py-1.5 text-[13px] font-semibold text-blue-700">
              {job.salary_range}
            </div>
          )}

          <div className="mt-5 border-t border-gray-100 pt-5">
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-700">
              {job.job_description || 'No description provided.'}
            </p>
          </div>

          <div className="mt-6 border-t border-gray-100 pt-5">
            {isUserPost ? (
              <>
                <button
                  type="button"
                  onClick={handleApplyClick}
                  disabled={isClosed}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-md shadow-blue-900/20"
                >
                  <Send size={15} />
                  {isClosed ? 'This job is closed' : 'Submit a Consultant'}
                </button>
                {!user && !isClosed && (
                  <p className="text-center text-[11px] text-gray-400 mt-3">You'll need to sign in first.</p>
                )}
              </>
            ) : job.post_url ? (
              <a
                href={job.post_url}
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

      {showApplyModal && job && (
        <SubmitApplicationModal
          jobId={job.id}
          jobTitle={job.job_title || 'this job'}
          onClose={() => setShowApplyModal(false)}
          onSaved={() => setShowApplyModal(false)}
          showToast={(message, type) => setToast({ message, type: type ?? 'success' })}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
