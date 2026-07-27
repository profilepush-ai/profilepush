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
      supabase.from('feature_requests').select('*').order('vote_count', { ascending: false }),
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
    <div className="h-screen flex flex-col bg-gray-50">
      <AppNav />

      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* Page header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
              <Map size={15} className="text-amber-500" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900">Feature Roadmap</h1>
              <p className="text-[11px] text-gray-400 mt-0.5">Vote on what gets built next, or suggest something new</p>
            </div>
          </div>
        </div>

        {/* Two-column body */}
        <div className="flex-1 overflow-hidden">
          <div className="max-w-7xl mx-auto h-full flex gap-5 px-6 py-5">

            {/* Left: requests table */}
            <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col overflow-hidden min-w-0">
              <div className="px-5 py-3.5 border-b border-gray-100 shrink-0 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-700">
                  {loading ? 'Loading…' : `${requests.length} request${requests.length !== 1 ? 's' : ''}`}
                </span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Sorted by votes</span>
              </div>

              {loading ? (
                <div className="flex-1 flex items-center justify-center">
                  <LogoSpinner size={18} />
                </div>
              ) : requests.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
                  <div className="w-11 h-11 rounded-2xl bg-amber-50 flex items-center justify-center">
                    <Lightbulb size={18} className="text-amber-400" />
                  </div>
                  <p className="text-sm font-semibold text-gray-700">No requests yet</p>
                  <p className="text-xs text-gray-400">Be the first to suggest a feature using the form.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50/90 backdrop-blur-sm border-b border-gray-100">
                      <tr>
                        <th className="text-left px-5 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide w-14">Votes</th>
                        <th className="text-left px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Feature</th>
                        <th className="text-left px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide w-24 hidden md:table-cell">Submitted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {requests.map((req, idx) => (
                        <tr key={req.id} className="hover:bg-gray-50/70 transition-colors group">
                          {/* Vote button */}
                          <td className="px-5 py-3">
                            <button
                              onClick={() => handleVote(req)}
                              disabled={!!votingId}
                              title={req.user_voted ? 'Remove vote' : 'Upvote'}
                              className={`flex flex-col items-center gap-0.5 w-10 py-1.5 rounded-xl border transition-all ${
                                req.user_voted
                                  ? 'bg-blue-600 border-blue-600 text-white'
                                  : 'bg-white border-gray-200 text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50'
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
                                <span className="flex items-center gap-1 text-[10px] font-bold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-md shrink-0">
                                  <Flame size={9} /> Top
                                </span>
                              )}
                              <span className="font-semibold text-gray-800">{req.title}</span>
                            </div>
                            {req.description && (
                              <p className="text-gray-500 mt-0.5 line-clamp-2 text-[11px]">{req.description}</p>
                            )}
                          </td>

                          {/* Date */}
                          <td className="px-3 py-3 text-gray-400 text-[11px] hidden md:table-cell whitespace-nowrap">
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
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h2 className="text-sm font-bold text-gray-900">Suggest a Feature</h2>
                  <p className="text-[11px] text-gray-400 mt-0.5">Got an idea? Share it with the team.</p>
                </div>

                {submitted ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-5">
                    <div className="w-11 h-11 rounded-full bg-green-50 flex items-center justify-center">
                      <CheckCircle2 size={20} className="text-green-500" />
                    </div>
                    <p className="text-sm font-bold text-gray-900">Request submitted!</p>
                    <p className="text-xs text-gray-500">Others can now vote on your idea.</p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
                    {formError && (
                      <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2.5 rounded-lg">
                        {formError}
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Title <span className="text-red-400">*</span></label>
                      <input
                        type="text"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="e.g. Export candidates to CSV"
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 placeholder:text-gray-300 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                        Details <span className="text-gray-400 font-normal normal-case">(optional)</span>
                      </label>
                      <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder="Describe the problem this would solve or how it should work…"
                        rows={5}
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 placeholder:text-gray-300 transition-all resize-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold py-2.5 rounded-xl transition-colors"
                    >
                      {submitting ? <LogoSpinner size={13} /> : <Lightbulb size={13} />}
                      {submitting ? 'Submitting…' : 'Submit Request'}
                    </button>
                  </form>
                )}
              </div>

              {/* Info card */}
              <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4">
                <p className="text-xs font-semibold text-amber-800 mb-1">How voting works</p>
                <p className="text-[11px] text-amber-700 leading-relaxed">
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
