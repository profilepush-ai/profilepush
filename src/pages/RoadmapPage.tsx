import { useState, useEffect, useCallback } from 'react';
import { ChevronUp, Lightbulb, Flame, CheckCircle2, Map } from 'lucide-react';
import AppNav from '../components/AppNav';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import LogoSpinner from '../components/LogoSpinner';

interface FeatureRequest {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  vote_count: number;
  created_at: string;
  user_voted: boolean;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86_400_000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export default function RoadmapPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [votingId, setVotingId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    const [reqRes, voteRes] = await Promise.all([
      supabase
        .from('feature_requests')
        .select('*')
        .order('vote_count', { ascending: false })
        .order('created_at', { ascending: true }),
      user
        ? supabase.from('feature_request_votes').select('request_id').eq('user_id', user.id)
        : Promise.resolve({ data: [] }),
    ]);
    const votedIds = new Set((voteRes.data ?? []).map((v: { request_id: string }) => v.request_id));
    setRequests(
      (reqRes.data ?? []).map((r: Omit<FeatureRequest, 'user_voted'>) => ({
        ...r,
        user_voted: votedIds.has(r.id),
      }))
    );
    setLoading(false);
  }, [user]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  async function handleVote(req: FeatureRequest) {
    if (!user || votingId) return;
    setVotingId(req.id);
    if (req.user_voted) {
      await Promise.all([
        supabase.from('feature_request_votes').delete().match({ request_id: req.id, user_id: user.id }),
        supabase.from('feature_requests').update({ vote_count: req.vote_count - 1 }).eq('id', req.id),
      ]);
      setRequests(prev =>
        prev.map(r => r.id === req.id ? { ...r, vote_count: r.vote_count - 1, user_voted: false } : r)
          .sort((a, b) => b.vote_count - a.vote_count)
      );
    } else {
      await Promise.all([
        supabase.from('feature_request_votes').insert({ request_id: req.id, user_id: user.id }),
        supabase.from('feature_requests').update({ vote_count: req.vote_count + 1 }).eq('id', req.id),
      ]);
      setRequests(prev =>
        prev.map(r => r.id === req.id ? { ...r, vote_count: r.vote_count + 1, user_voted: true } : r)
          .sort((a, b) => b.vote_count - a.vote_count)
      );
    }
    setVotingId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setFormError('Title is required.'); return; }
    if (!user) return;
    setSubmitting(true);
    setFormError(null);
    const { data, error } = await supabase
      .from('feature_requests')
      .insert({ user_id: user.id, title: title.trim(), description: description.trim() || null })
      .select()
      .single();
    if (error || !data) {
      setFormError('Failed to submit. Please try again.');
      setSubmitting(false);
      return;
    }
    await supabase.from('feature_request_votes').insert({ request_id: data.id, user_id: user.id });
    setSubmitted(true);
    setSubmitting(false);
    setTimeout(() => {
      setSubmitted(false);
      setTitle('');
      setDescription('');
      loadRequests();
    }, 2000);
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[#F7F8FA] dark:bg-[#15181D]">
      <AppNav />

      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* Page header */}
        <div className="shrink-0 border-b border-[#E5E7EB] bg-[#FFFFFF] px-6 py-4 dark:border-[#303640] dark:bg-[#1C2026]">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#FFF7E6] dark:bg-[#332817]">
              <Map size={15} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900 dark:text-slate-100">Feature Roadmap</h1>
              <p className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">Vote on what gets built next, or suggest something new</p>
            </div>
          </div>
        </div>

        {/* Two-column body */}
        <div className="flex-1 overflow-hidden">
          <div className="max-w-7xl mx-auto h-full flex gap-5 px-6 py-5">

            {/* Left: requests table */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#E1E5EA] bg-[#FFFFFF] shadow-sm dark:border-[#343B46] dark:bg-[#1E232A] dark:shadow-black/20">
              <div className="flex shrink-0 items-center justify-between border-b border-[#E9ECF0] px-5 py-3.5 dark:border-[#303640]">
                <span className="text-xs font-bold text-gray-700 dark:text-slate-100">
                  {loading ? 'Loading…' : `${requests.length} request${requests.length !== 1 ? 's' : ''}`}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">Sorted by votes</span>
              </div>

              {loading ? (
                <div className="flex-1 flex items-center justify-center">
                  <LogoSpinner size={18} />
                </div>
              ) : requests.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#FFF7E6] dark:bg-[#332817]">
                    <Lightbulb size={18} className="text-amber-400" />
                  </div>
                  <p className="text-sm font-semibold text-gray-700 dark:text-slate-100">No requests yet</p>
                  <p className="text-xs text-gray-400 dark:text-slate-400">Be the first to suggest a feature using the form.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 border-b border-[#E5E7EB] bg-[#F1F3F5]/95 backdrop-blur-sm dark:border-[#303640] dark:bg-[#171B20]/95">
                      <tr>
                        <th className="text-left px-5 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide w-14">Votes</th>
                        <th className="text-left px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Feature</th>
                        <th className="text-left px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide w-24 hidden md:table-cell">Submitted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ECEFF3] dark:divide-[#303640]">
                      {requests.map((req, idx) => (
                        <tr key={req.id} className="group transition-colors hover:bg-[#F8FAFC] dark:hover:bg-[#252B33]">
                          {/* Vote button */}
                          <td className="px-5 py-3">
                            <button
                              onClick={() => handleVote(req)}
                              disabled={!!votingId}
                              title={req.user_voted ? 'Remove vote' : 'Upvote'}
                              className={`flex flex-col items-center gap-0.5 w-10 py-1.5 rounded-xl border transition-all ${
                                req.user_voted
                                  ? 'bg-blue-600 border-blue-600 text-white'
                                  : 'border-[#D8DEE6] bg-[#FFFFFF] text-gray-500 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:border-[#46505D] dark:bg-[#171B20] dark:text-slate-400 dark:hover:border-blue-500 dark:hover:bg-[#202C40] dark:hover:text-blue-300'
                              } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              {votingId === req.id
                                ? <LogoSpinner size={11} />
                                : <ChevronUp size={13} />
                              }
                              <span className="text-[11px] font-bold leading-none">{req.vote_count}</span>
                            </button>
                          </td>

                          {/* Title + description */}
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              {idx === 0 && (
                                <span className="flex shrink-0 items-center gap-1 rounded-md bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-500 dark:bg-[#3B2719] dark:text-orange-300">
                                  <Flame size={9} /> Top
                                </span>
                              )}
                              <span className="font-semibold text-gray-800 dark:text-slate-100">{req.title}</span>
                            </div>
                            {req.description && (
                              <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-500 dark:text-slate-400">{req.description}</p>
                            )}
                          </td>

                          {/* Date */}
                          <td className="hidden whitespace-nowrap px-3 py-3 text-[11px] text-gray-400 dark:text-slate-500 md:table-cell">
                            {timeAgo(req.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Right: submit form */}
            <div className="w-80 shrink-0 flex flex-col gap-4">
              <div className="overflow-hidden rounded-lg border border-[#E1E5EA] bg-[#FFFFFF] shadow-sm dark:border-[#343B46] dark:bg-[#1E232A] dark:shadow-black/20">
                <div className="border-b border-[#E9ECF0] px-5 py-4 dark:border-[#303640]">
                  <h2 className="text-sm font-bold text-gray-900 dark:text-slate-100">Suggest a Feature</h2>
                  <p className="mt-0.5 text-[11px] text-gray-400 dark:text-slate-400">Got an idea? Share it with the team.</p>
                </div>

                {submitted ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-green-50 dark:bg-[#193329]">
                      <CheckCircle2 size={20} className="text-green-500" />
                    </div>
                    <p className="text-sm font-bold text-gray-900 dark:text-slate-100">Request submitted!</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Others can now vote on your idea.</p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
                    {formError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                        {formError}
                      </div>
                    )}
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-300">Title <span className="text-red-400">*</span></label>
                      <input
                        type="text"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="e.g. Export candidates to CSV"
                        className="w-full rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-3 py-2.5 text-sm text-gray-900 transition-all placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-[#46505D] dark:bg-[#171B20] dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-300">
                        Details <span className="text-gray-400 font-normal normal-case">(optional)</span>
                      </label>
                      <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder="Describe the problem this would solve or how it should work…"
                        rows={5}
                        className="w-full resize-none rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-3 py-2.5 text-sm text-gray-900 transition-all placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-[#46505D] dark:bg-[#171B20] dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex w-full items-center justify-center gap-2 rounded-md bg-gray-900 py-2.5 text-xs font-bold text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500"
                    >
                      {submitting ? <LogoSpinner size={13} /> : <Lightbulb size={13} />}
                      {submitting ? 'Submitting…' : 'Submit Request'}
                    </button>
                  </form>
                )}
              </div>

              {/* Info card */}
              <div className="rounded-lg border border-[#F3D89B] bg-[#FFFBEB] px-5 py-4 dark:border-[#66512A] dark:bg-[#2B2418]">
                <p className="mb-1 text-xs font-semibold text-amber-800 dark:text-amber-300">How voting works</p>
                <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-200/80">
                  Upvote requests you'd like to see built. The most-voted features are prioritized in our development cycle. Your own submission gets an automatic vote.
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
