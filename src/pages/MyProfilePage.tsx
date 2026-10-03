import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, Check, Clock3, Copy, ExternalLink, MapPin, Sparkles, Users, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { timeAgo } from '../lib/publishers';

// My Profile: everything that is this account's, in one place. Their public
// profile (if they've claimed one) and every post that's theirs, posted in
// ProfilePush or carrying their claimed email, open or closed. Each post can
// be opened, matched with AI Match, or closed / reopened (get_my_all_posts,
// set_my_post_status).

type MyPost = {
  kind: 'job' | 'hotlist';
  id: string;
  is_own_post: boolean;
  post_status: 'open' | 'closed';
  posted_at: string;
  title: string | null;
  location: string | null;
  rate_min: number | null;
  rate_max: number | null;
  roles: string[] | null;
  consultant_count: number | null;
  match_text: string | null;
  copies: number;
};

type MyProfile = { slug: string; display_name: string; company_name: string; follower_count: number };
type StatusFilter = 'open' | 'closed' | 'all';

function rateText(min: number | null, max: number | null): string {
  if (min && max && min !== max) return `$${min}–${max}/hr`;
  if (min || max) return `$${min || max}/hr`;
  return '';
}

function postTitle(post: MyPost): string {
  if (post.kind === 'job') return post.title || 'Requirement';
  const roles = (post.roles ?? []).filter(Boolean);
  if (roles.length === 0) return 'Bench hotlist';
  return roles.length > 3 ? `${roles.slice(0, 3).join(', ')} +${roles.length - 3} more` : roles.join(', ');
}

export default function MyProfilePage() {
  const navigate = useNavigate();
  const { user, account } = useAuth();
  const persona = account?.active_persona ?? null;
  // AI Match matches a requirement against consultants for a vendor, and a
  // consultant against requirements for bench sales, so only that kind of
  // post can be matched from here.
  const matchableKind: MyPost['kind'] = persona === 'bench_sales' ? 'hotlist' : 'job';

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [posts, setPosts] = useState<MyPost[] | null>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<MyPost['kind']>(matchableKind);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [busyId, setBusyId] = useState('');
  const [preview, setPreview] = useState<MyPost | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setError('');
    const [profileRes, postsRes] = await Promise.all([
      supabase.rpc('get_my_publisher_profile' as never),
      supabase.rpc('get_my_all_posts' as never),
    ]);
    setProfile((((profileRes.data as MyProfile[] | null) ?? [])[0]) ?? null);
    if (postsRes.error) { setError('Could not load your posts.'); setPosts([]); return; }
    const rows = (postsRes.data as MyPost[] | null) ?? [];
    setPosts(rows);
    // Open on the kind they have, preferring the one AI Match can use.
    if (!rows.some((p) => p.kind === matchableKind) && rows.length > 0) setKind(rows[0].kind);
  }

  useEffect(() => { if (account?.id) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [account?.id]);

  const counts = useMemo(() => ({
    job: (posts ?? []).filter((p) => p.kind === 'job').length,
    hotlist: (posts ?? []).filter((p) => p.kind === 'hotlist').length,
  }), [posts]);

  const visible = useMemo(() => (posts ?? [])
    .filter((p) => p.kind === kind)
    .filter((p) => status === 'all' || p.post_status === status), [posts, kind, status]);

  const statusCounts = useMemo(() => {
    const ofKind = (posts ?? []).filter((p) => p.kind === kind);
    return { open: ofKind.filter((p) => p.post_status === 'open').length, closed: ofKind.filter((p) => p.post_status === 'closed').length, all: ofKind.length };
  }, [posts, kind]);

  async function toggleStatus(post: MyPost) {
    const next = post.post_status === 'open' ? 'closed' : 'open';
    setBusyId(post.id);
    const { error: rpcError } = await supabase.rpc('set_my_post_status' as never, { p_kind: post.kind, p_id: post.id, p_status: next } as never);
    setBusyId('');
    if (rpcError) { setError(rpcError.message || 'Could not update the post.'); return; }
    setPosts((prev) => (prev ?? []).map((p) => (p.id === post.id && p.kind === post.kind ? { ...p, post_status: next } : p)));
  }

  function runMatch(post: MyPost) {
    // Matching an imported post saves it as their own post; AI Match then
    // closes the imported copy.
    navigate('/match', { state: {
      aiMatchDescription: post.match_text ?? postTitle(post),
      aiMatchFrom: postTitle(post),
      aiMatchCloseSource: post.is_own_post ? undefined : { kind: post.kind, id: post.id },
    } });
  }

  const publicUrl = profile ? `https://profilepush.ai/profile/${profile.slug}` : '';
  const name = profile ? (profile.display_name.trim() || profile.company_name.trim()) : ((user?.user_metadata?.full_name as string | undefined) || user?.email || '');
  const kindLabel = (k: MyPost['kind']) => (k === 'job' ? 'Requirements' : 'Hotlists');
  const tab = (active: boolean) => `border-b-2 px-1 pb-2 text-[13px] font-semibold transition ${active ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`;
  const pill = (active: boolean) => `rounded-full px-3 py-1 text-[12px] font-semibold ${active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`;

  return (
    <div className="flex h-[100dvh] flex-col overscroll-none bg-gray-50 pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
          {/* Profile */}
          <section className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[16px] font-bold text-blue-700">
                {(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-[17px] font-bold text-gray-900">{name || 'My profile'}</h1>
                {profile ? (
                  <p className="flex flex-wrap items-center gap-x-3 text-[12px] text-gray-500">
                    {profile.company_name && profile.company_name !== name && <span>{profile.company_name}</span>}
                    <span className="inline-flex items-center gap-1"><Users size={12} /> {profile.follower_count} subscriber{profile.follower_count === 1 ? '' : 's'}</span>
                  </p>
                ) : (
                  <p className="text-[12px] text-gray-500">Your public profile appears once you post a requirement or a hotlist.</p>
                )}
              </div>
            </div>
            {profile && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard?.writeText(publicUrl).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => undefined); }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy profile link'}
                </button>
                <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                  <ExternalLink size={13} /> Public page
                </a>
              </div>
            )}
          </section>

          {/* Posts */}
          <section className="flex flex-col gap-3">
            <div className="flex gap-5 border-b border-gray-200">
              {(['job', 'hotlist'] as const).map((k) => (
                <button key={k} type="button" className={tab(kind === k)} onClick={() => setKind(k)}>
                  {kindLabel(k)} <span className="ml-0.5 font-normal tabular-nums text-gray-400">{counts[k]}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['open', 'closed', 'all'] as const).map((s) => (
                <button key={s} type="button" className={pill(status === s)} onClick={() => setStatus(s)}>
                  {s === 'open' ? 'Open' : s === 'closed' ? 'Closed' : 'All'} <span className="tabular-nums opacity-70">{statusCounts[s]}</span>
                </button>
              ))}
              {/* New posts start in AI Match: pasting a requirement or hotlist
                  there posts it and finds its matches in one go. */}
              <Link
                to="/match"
                className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
              >
                {matchableKind === 'job' ? 'Post a requirement' : 'Add consultants'}
              </Link>
            </div>
            {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>}
            {kind !== matchableKind && visible.length > 0 && (
              <p className="text-[12px] text-gray-500">
                AI Match runs {matchableKind === 'job' ? 'requirements against consultants' : 'consultants against requirements'} for your account type, so these {kindLabel(kind).toLowerCase()} can be opened and closed here but not matched.
              </p>
            )}

            {!posts && <p className="py-10 text-center text-[13px] text-gray-500">Loading your posts…</p>}
            {posts && visible.length === 0 && (
              <div className="rounded-2xl border border-gray-200 bg-white px-5 py-10 text-center">
                <p className="text-[14px] font-semibold text-gray-800">No {status === 'all' ? '' : `${status} `}{kindLabel(kind).toLowerCase()} yet</p>
                <p className="mt-1 text-[12px] text-gray-500">{kind === 'job' ? 'Post a requirement and we’ll match bench consultants to it every morning.' : 'Add your consultants and we’ll match new requirements to them every morning.'}</p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {visible.map((post) => {
                const closed = post.post_status === 'closed';
                return (
                  <article key={`${post.kind}-${post.id}`} className={`rounded-xl border bg-white p-4 ${closed ? 'border-gray-200 opacity-75' : 'border-gray-200'}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <button type="button" onClick={() => setPreview(post)} className="min-w-0 flex-1 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold text-gray-900">{postTitle(post)}</span>
                          {closed && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Closed</span>}
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-500">
                          {post.kind === 'hotlist' && post.consultant_count && post.consultant_count > 1 && <span className="inline-flex items-center gap-1"><Users size={11} /> {post.consultant_count} consultants</span>}
                          {post.location && <span className="inline-flex items-center gap-1"><MapPin size={11} /> {post.location}</span>}
                          {rateText(post.rate_min, post.rate_max) && <span className="inline-flex items-center gap-1"><Briefcase size={11} /> {rateText(post.rate_min, post.rate_max)}</span>}
                          <span className="inline-flex items-center gap-1"><Clock3 size={11} /> {timeAgo(post.posted_at)}</span>
                        </p>
                      </button>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button type="button" onClick={() => setPreview(post)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">Open</button>
                        {post.kind === matchableKind && !closed && (
                          <button type="button" onClick={() => runMatch(post)} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700">
                            <Sparkles size={12} /> AI Match
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void toggleStatus(post)}
                          disabled={busyId === post.id}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                        >
                          {busyId === post.id ? '…' : closed ? 'Reopen' : 'Close'}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPreview(null)} />
          <div className="relative flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-gray-900">{postTitle(preview)}</p>
                <p className="mt-0.5 text-[12px] text-gray-500">{[preview.location, rateText(preview.rate_min, preview.rate_max), timeAgo(preview.posted_at), preview.post_status === 'closed' ? 'Closed' : 'Open'].filter(Boolean).join(' · ')}</p>
              </div>
              <button type="button" onClick={() => setPreview(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" aria-label="Close"><X size={16} /></button>
            </div>
            <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-5 py-4 font-sans text-[13px] leading-relaxed text-gray-700">{preview.match_text || 'No details for this post.'}</pre>
            <div className="flex shrink-0 flex-wrap gap-2 border-t border-gray-100 px-5 py-3">
              {preview.kind === matchableKind && preview.post_status === 'open' && (
                <button type="button" onClick={() => runMatch(preview)} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-blue-700">
                  <Sparkles size={12} /> AI Match
                </button>
              )}
              <button type="button" onClick={() => { void toggleStatus(preview); setPreview(null); }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                {preview.post_status === 'closed' ? 'Reopen' : 'Close post'}
              </button>
              <a href={preview.kind === 'job' ? `/job/${preview.id}` : `/hotlist/${preview.id}`} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-100">
                <ExternalLink size={12} /> Public page
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
