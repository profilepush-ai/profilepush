import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Bell, BellOff, Search } from 'lucide-react';
import LogoSpinner from '../LogoSpinner';
import { useAuth } from '../../contexts/AuthContext';
import { FollowButton, PublisherAvatar, Tag } from './PublisherBits';
import {
  fetchPublisherPosts,
  fetchPublisherProfile,
  followingKindForPersona,
  markPublisherSeen,
  publisherDisplayName,
  setPublisherMuted,
  timeAgo,
  type PublisherPost,
  type PublisherProfile,
} from '../../lib/publishers';

function dayLabel(date: Date): string {
  const today = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(date)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function PublisherProfileView({
  slug,
  initialQuery = '',
  backLabel,
  onBack,
  onOpenPost,
  renderPosts,
}: {
  slug: string;
  initialQuery?: string;
  backLabel: string;
  onBack: () => void;
  onOpenPost: (leadId: string) => void;
  // Inside the feed, the feed renders the posts with its own cards and
  // actions; elsewhere the view lists them itself.
  // canChat: the publisher has joined and isn't you, so post chat can reach them.
  renderPosts?: (args: { publisherId: string; query: string; canChat: boolean }) => ReactNode;
}) {
  const usesFeedCards = Boolean(renderPosts);
  const { account } = useAuth();
  const kind = followingKindForPersona(account?.active_persona);

  const [profile, setProfile] = useState<PublisherProfile | null | undefined>(undefined);
  const [posts, setPosts] = useState<PublisherPost[] | null>(null);
  // Captured before the visit marks everything seen, so the "new" divider
  // still shows where this visit's new posts start.
  const [seenBefore, setSeenBefore] = useState<string | null>(null);
  // Arriving from a search carries the query, so the profile opens on the
  // posts that matched it.
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    let cancelled = false;
    setProfile(undefined);
    setPosts(null);
    (async () => {
      try {
        const p = await fetchPublisherProfile(slug);
        if (cancelled) return;
        setProfile(p);
        if (!p) return;
        setSeenBefore(p.is_following ? p.last_seen_at : null);
        if (!usesFeedCards) {
          const rows = await fetchPublisherPosts(p.publisher_id, kind);
          if (cancelled) return;
          setPosts(rows);
        }
        if (p.is_following) void markPublisherSeen(p.publisher_id);
      } catch {
        if (!cancelled) { setProfile(null); setPosts([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [slug, kind, usesFeedCards]);

  const filtered = useMemo(() => {
    if (!posts) return [];
    // Every word must appear somewhere in the post, in any order, so
    // "Salesforce Dallas" finds a Salesforce post located in Dallas.
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return posts;
    return posts.filter((p) => {
      const haystack = [p.title, p.summary, ...p.skills, ...p.locations, ...p.job_types, ...p.visa_types, p.experience ?? '', p.rate ?? '']
        .join(' ').toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [posts, query]);

  const groups = useMemo(() => {
    const out: Array<{ label: string; items: PublisherPost[] }> = [];
    for (const post of filtered) {
      const label = dayLabel(new Date(post.posted_at));
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(post);
      else out.push({ label, items: [post] });
    }
    return out;
  }, [filtered]);

  const newCount = seenBefore ? filtered.filter((p) => p.posted_at > seenBefore).length : 0;
  const lastNewLeadId = newCount > 0 ? filtered[newCount - 1]?.lead_id : null;
  const otherKindCount = profile ? (kind === 'job' ? profile.hotlist_post_count : profile.job_post_count) : 0;
  const postNoun = kind === 'job' ? 'requirement' : 'hotlist';

  return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-3 pb-4 sm:px-4">
          {/* Back, then search across this profile's posts, on one row above
              both columns. */}
          {/* Pinned: the page scrolls under it, so Back and search stay in reach. */}
          <div className="sticky top-0 z-20 -mx-3 flex items-center gap-2 bg-[#f3f2ee] px-3 py-3 dark:bg-[#1B1D21] sm:-mx-4 sm:px-4">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[13px] font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 dark:border-white/15 dark:bg-[#20242a] dark:text-slate-200 dark:hover:bg-white/5"
            >
              <ArrowLeft size={15} strokeWidth={2.25} /> {backLabel}
            </button>
            <div className="relative flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 dark:border-white/10 dark:bg-[#20242a]">
              <Search size={13} className="shrink-0 text-gray-400" />
              <input
                id="publisher-post-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search this profile's ${postNoun}s`}
                className="w-full min-w-0 border-0 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400 dark:text-slate-200"
              />
            </div>
          </div>

          {profile === undefined ? (
            <div className="flex justify-center py-10"><LogoSpinner size={22} /></div>
          ) : profile === null ? (
            <p className="py-10 text-center text-[13px] text-gray-500">This profile doesn't exist or is no longer available.</p>
          ) : (
            // Two columns from lg up, like a LinkedIn profile: a narrow card with
            // who they are, and their posts beside it. Stacked on a phone.
            <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="flex flex-col items-center gap-3 rounded-2xl border border-gray-200 bg-white p-5 text-center dark:border-white/10 dark:bg-[#171A1F] lg:sticky lg:top-[4.25rem]">
                <PublisherAvatar publisher={profile} size={72} />
                <div className="min-w-0">
                  <h1 className="break-words text-[18px] font-bold leading-snug">{publisherDisplayName(profile)}</h1>
                  {profile.company_name && profile.display_name && (
                    <p className="mt-0.5 text-[13px] text-gray-600 dark:text-slate-300">{profile.company_name}</p>
                  )}
                </div>
                <dl className="grid w-full grid-cols-2 gap-2 border-y border-gray-100 py-3 text-center dark:border-white/10">
                  <div>
                    <dt className="text-[11px] text-gray-500 dark:text-slate-400">Subscribers</dt>
                    <dd className="text-[16px] font-bold tabular-nums">{profile.follower_count.toLocaleString('en-US')}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-gray-500 dark:text-slate-400">{postNoun === 'hotlist' ? 'Hotlists' : 'Requirements'}, 30d</dt>
                    <dd className="text-[16px] font-bold tabular-nums">{(kind === 'job' ? profile.job_post_count : profile.hotlist_post_count).toLocaleString('en-US')}</dd>
                  </div>
                </dl>
                {!profile.is_mine && (
                  <div className="flex w-full items-center justify-center gap-2">
                    <FollowButton
                      publisherId={profile.publisher_id}
                      following={profile.is_following}
                      onChange={(following) => setProfile({
                        ...profile,
                        is_following: following,
                        muted: following ? profile.muted : false,
                        follower_count: profile.follower_count + (following ? 1 : -1),
                      })}
                    />
                    {profile.is_following && (
                      <button
                        type="button"
                        onClick={async () => {
                          const next = !profile.muted;
                          setProfile({ ...profile, muted: next });
                          try { await setPublisherMuted(profile.publisher_id, next); }
                          catch { setProfile({ ...profile, muted: !next }); }
                        }}
                        title={profile.muted ? 'Turn notifications on' : 'Mute notifications'}
                        aria-label={profile.muted ? 'Turn notifications on' : 'Mute notifications'}
                        className="rounded-full border border-gray-200 p-1.5 text-gray-500 hover:text-gray-800 dark:border-white/15 dark:text-slate-300"
                      >
                        {profile.muted ? <BellOff size={14} /> : <Bell size={14} />}
                      </button>
                    )}
                  </div>
                )}
              </aside>

              <div className="min-w-0">
              {renderPosts ? (
                <section className="flex flex-col gap-3">
                  {renderPosts({ publisherId: profile.publisher_id, query, canChat: profile.is_claimed && !profile.is_mine })}
                </section>
              ) : posts === null ? (
                <div className="flex justify-center py-8"><LogoSpinner size={20} /></div>
              ) : posts.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-gray-500 dark:text-slate-400">
                  No open {postNoun}s in the last 30 days.
                  {otherKindCount > 0 && ` This profile posted ${otherKindCount} ${kind === 'job' ? 'hotlist' : 'requirement'}${otherKindCount === 1 ? '' : 's'}, which your view doesn't show.`}
                </p>
              ) : (
                <section className="flex flex-col gap-3">

                  {groups.length === 0 && (
                    <p className="py-4 text-center text-[12px] text-gray-500">No {postNoun}s match "{query}".</p>
                  )}

                  {groups.map((group) => (
                    <div key={group.label} className="flex flex-col gap-2">
                      <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{group.label}</p>
                      {group.items.map((post) => (
                        <div key={post.lead_id} className="flex flex-col gap-2">
                          <PostRow post={post} kind={kind} onOpen={() => onOpenPost(post.lead_id)} />
                          {post.lead_id === lastNewLeadId && filtered.length > newCount && (
                            <div className="flex items-center gap-2 px-1 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                              <span className="h-px flex-1 bg-blue-200 dark:bg-blue-500/30" />
                              Seen before
                              <span className="h-px flex-1 bg-blue-200 dark:bg-blue-500/30" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </section>
              )}
              </div>
            </div>
          )}
        </div>
  );
}

function PostRow({ post, kind, onOpen }: { post: PublisherPost; kind: 'job' | 'hotlist'; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-3 text-left transition hover:border-blue-300 dark:border-white/10 dark:bg-[#171A1F]"
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[14px] font-semibold">{post.title}</span>
        <span className="shrink-0 text-[11px] text-gray-400">{timeAgo(post.posted_at)}</span>
      </div>
      {kind === 'hotlist' && post.consultant_count != null && post.consultant_count > 1 && post.summary && (
        <p className="text-[12px] text-gray-600 dark:text-slate-300">{post.summary}</p>
      )}
      {kind === 'job' && post.summary && (
        <p className="line-clamp-2 text-[12px] text-gray-600 dark:text-slate-300">{post.summary}</p>
      )}
      <div className="flex flex-wrap gap-1">
        {post.locations.slice(0, 3).map((l) => <Tag key={`l-${l}`}>{l}</Tag>)}
        {post.job_types.map((t) => <Tag key={`t-${t}`}>{t}</Tag>)}
        {post.visa_types.slice(0, 3).map((v) => <Tag key={`v-${v}`}>{v}</Tag>)}
        {post.experience && <Tag>{post.experience}</Tag>}
        {post.rate && <Tag>{post.rate}</Tag>}
      </div>
      {post.skills.length > 0 && (
        <p className="truncate text-[11px] text-gray-500 dark:text-slate-400">{post.skills.join(' · ')}</p>
      )}
    </button>
  );
}
