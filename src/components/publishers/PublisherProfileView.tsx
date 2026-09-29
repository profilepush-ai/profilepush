import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Bell, BellOff, Search, Users } from 'lucide-react';
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
  renderPosts?: (args: { publisherId: string; query: string }) => ReactNode;
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
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 self-start text-[12px] text-gray-500 hover:text-gray-800 dark:text-slate-400">
            <ArrowLeft size={12} /> {backLabel}
          </button>

          {profile === undefined ? (
            <div className="flex justify-center py-10"><LogoSpinner size={22} /></div>
          ) : profile === null ? (
            <p className="py-10 text-center text-[13px] text-gray-500">This profile doesn't exist or is no longer available.</p>
          ) : (
            <>
              <header className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-[#171A1F] sm:flex-row sm:items-start">
                <PublisherAvatar publisher={profile} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h1 className="text-[18px] font-bold">{publisherDisplayName(profile)}</h1>
                  </div>
                  {profile.company_name && profile.display_name && (
                    <p className="text-[13px] text-gray-600 dark:text-slate-300">{profile.company_name}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1"><Users size={12} /> {profile.follower_count} subscriber{profile.follower_count === 1 ? '' : 's'}</span>
                    <span>
                      {kind === 'job' ? profile.job_post_count : profile.hotlist_post_count} {postNoun}s in 30 days
                    </span>
                  </div>
                </div>
                {!profile.is_mine && (
                  <div className="flex items-start gap-2">
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
                  </div>
                )}
              </header>

              {renderPosts ? (
                <section className="flex flex-col gap-3">
                  <div className="relative flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 dark:border-white/10 dark:bg-[#20242a]">
                    <Search size={12} className="shrink-0 text-gray-400" />
                    <input
                      id="publisher-post-search"
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={`Search this profile's ${postNoun}s`}
                      className="w-full min-w-0 border-0 bg-transparent text-[12px] outline-none placeholder:text-gray-400"
                    />
                  </div>
                  {renderPosts({ publisherId: profile.publisher_id, query })}
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
                  <div className="relative flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 dark:border-white/10 dark:bg-[#20242a]">
                    <Search size={12} className="shrink-0 text-gray-400" />
                    <input
                      id="publisher-post-search"
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={`Search this profile's ${postNoun}s`}
                      className="w-full min-w-0 border-0 bg-transparent text-[12px] outline-none placeholder:text-gray-400"
                    />
                  </div>

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
            </>
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
