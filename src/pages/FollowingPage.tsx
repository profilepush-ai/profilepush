import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import AppNav from '../components/AppNav';
import { useTypewriterPlaceholder } from '../lib/useTypewriterPlaceholder';
import LogoSpinner from '../components/LogoSpinner';
import { useAuth } from '../contexts/AuthContext';
import {
  FollowButton,
  MutedIcon,
  PublisherAvatar,
  PublisherName,
  Tag,
} from '../components/publishers/PublisherBits';
import {
  claimMyPublisherProfile,
  fetchFollowQuota,
  fetchFollowingFeed,
  fetchPublisherCounts,
  fetchSuggestedPublishers,
  FollowLimitError,
  followPublisher,
  followingKindForPersona,
  searchPublishers,
  followingLabelForPersona,
  timeAgo,
  type FollowQuota,
  type FollowingCard,
  type PublisherSearchResult,
  type SuggestedPublisher,
} from '../lib/publishers';

// Vendors (for bench sales) / Bench Sales (for vendors): one card per publisher
// the account subscribes to, never individual posts. Publishers with new posts
// come first; opening a card goes to their profile page.
export default function FollowingPage() {
  const { account } = useAuth();
  const navigate = useNavigate();
  const persona = account?.active_persona;
  const kind = followingKindForPersona(persona);
  const label = followingLabelForPersona(persona);
  const postNoun = kind === 'job' ? 'requirement' : 'hotlist';

  const [cards, setCards] = useState<FollowingCard[] | null>(null);
  const [suggested, setSuggested] = useState<SuggestedPublisher[]>([]);
  const [quota, setQuota] = useState<FollowQuota | null>(null);
  const [counts, setCounts] = useState<{ total: number; following: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<PublisherSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [suggestedShown, setSuggestedShown] = useState(20);
  const activeQuery = searchQuery.trim();

  // Examples mix what people search for: skills and roles, and real names and
  // companies from this week's active publishers, so the box shows it finds both.
  const searchExamples = useMemo(() => {
    const topics = kind === 'job'
      ? ['Java Developer Dallas', 'Salesforce Admin', 'Data Engineer Remote', 'DevOps AWS', '.NET Full Stack C2C', 'Business Analyst NJ']
      : ['Java H1B', 'React Developer', 'Data Engineer GC', 'Salesforce OPT', 'DevOps Kubernetes', 'QA Automation Selenium'];
    const people: string[] = [];
    for (const s of suggested.slice(0, 12)) {
      const name = s.display_name.trim();
      const company = s.company_name.trim();
      if (name && !people.includes(name)) people.push(name);
      if (company && !people.includes(company)) people.push(company);
      if (people.length >= 4) break;
    }
    const mixed: string[] = [];
    for (let i = 0; i < Math.max(topics.length, people.length); i += 1) {
      if (topics[i]) mixed.push(topics[i]);
      if (people[i]) mixed.push(people[i]);
    }
    return mixed;
  }, [kind, suggested]);
  const animatedPlaceholder = useTypewriterPlaceholder(searchExamples);

  // Debounced server search: names and companies, plus what each publisher
  // posted in the last 30 days.
  useEffect(() => {
    if (activeQuery.length < 2) { setResults(null); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const rows = await searchPublishers(kind, activeQuery);
        if (!cancelled) setResults(rows);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeQuery, kind]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [feed, suggestions, q, c] = await Promise.all([
        fetchFollowingFeed(kind),
        fetchSuggestedPublishers(kind, 300),
        fetchFollowQuota(),
        fetchPublisherCounts(kind),
      ]);
      setCounts(c);
      setCards(feed);
      setSuggested(suggestions);
      setQuota(q);
    } catch {
      setError(`Could not load your ${label.toLowerCase()}. Pull to refresh or try again.`);
      setCards([]);
    }
  }, [kind, label]);

  useEffect(() => {
    void claimMyPublisherProfile();
  }, []);

  useEffect(() => {
    if (account?.id) void load();
  }, [account?.id, load]);

  const unread = (cards ?? []).filter((c) => c.unread_count > 0);
  const read = (cards ?? []).filter((c) => c.unread_count === 0);

  return (
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-[#f3f2ee] text-gray-900 flex flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0 dark:bg-[#1B1D21] dark:text-slate-100">
      <AppNav />
      <main className="flex-1 min-h-0 overflow-hidden">
       <div className="h-full w-full flex flex-col overflow-hidden px-2 py-2">
        {/* Same search box as the posts page and the feed. */}
        <div className="flex shrink-0 items-center gap-2 pb-2">
          <div className="relative flex min-w-[160px] flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 dark:border-white/10 dark:bg-[#20242a]">
            <Search size={11} className="text-gray-400" />
            <input
              id="following-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={animatedPlaceholder}
              aria-label={kind === 'job' ? 'Search vendors, companies or requirements' : 'Search bench recruiters, companies or skills'}
              className="w-full border-0 bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-gray-400 dark:text-slate-200 dark:placeholder:text-[#64748B]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="rounded-full p-0.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600 dark:hover:bg-white/10"
                aria-label="Clear search"
              >
                <X size={11} />
              </button>
            )}
          </div>
          {counts && (
            <div className="flex shrink-0 items-center gap-1.5 text-[12px] text-gray-600 dark:text-slate-300">
              <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 font-semibold tabular-nums dark:border-white/10 dark:bg-[#20242a]">
                {counts.total.toLocaleString('en-US')} {label.toLowerCase()}
              </span>
              {counts.following > 0 && (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-semibold tabular-nums text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
                  {counts.following.toLocaleString('en-US')} subscribed
                </span>
              )}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-1 pt-2 pb-10 sm:px-2 sm:pb-4">
          {error && <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>}

          {activeQuery.length >= 2 ? (
            <SearchResults
              query={activeQuery}
              results={results}
              searching={searching}
              postNoun={postNoun}
              onOpen={(slug) => navigate(`/p/${slug}?q=${encodeURIComponent(activeQuery)}`)}
              onFollowChange={() => void load()}
            />
          ) : cards === null ? (
            <div className="flex justify-center py-10"><LogoSpinner size={22} /></div>
          ) : cards.length === 0 ? (
            <SubscribeCta
              kind={kind}
              suggested={suggested}
              remainingToday={quota?.remaining ?? 5}
              onDone={() => void load()}
            />
          ) : (
            <section className="flex flex-col gap-2">
              {unread.map((card) => (
                <FollowingCardRow key={card.publisher_id} card={card} postNoun={postNoun} onOpen={() => navigate(`/p/${card.slug}`)} />
              ))}
              {read.length > 0 && unread.length > 0 && (
                <p className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Up to date</p>
              )}
              {read.map((card) => (
                <FollowingCardRow key={card.publisher_id} card={card} postNoun={postNoun} onOpen={() => navigate(`/p/${card.slug}`)} />
              ))}
            </section>
          )}

          {activeQuery.length < 2 && suggested.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-[13px] font-semibold">
                {cards && cards.length === 0 ? 'Or pick them yourself' : `Active ${kind === 'job' ? 'vendors' : 'bench sales recruiters'} this week`}
              </h2>
              {suggested.slice(0, suggestedShown).map((s) => (
                <div key={s.publisher_id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-[#171A1F]">
                  <Link to={`/p/${s.slug}`} className="shrink-0"><PublisherAvatar publisher={s} size={36} /></Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <PublisherName publisher={s} slug={s.slug} className="text-[13px]" />
                    </div>
                    <p className="truncate text-[11px] text-gray-500 dark:text-slate-400">
                      {s.post_count} {postNoun}{s.post_count === 1 ? '' : 's'} this week
                    </p>
                  </div>
                  <FollowButton
                    publisherId={s.publisher_id}
                    following={false}
                    size="sm"
                    onChange={() => void load()}
                  />
                </div>
              ))}
              {suggested.length > suggestedShown && (
                <LoadMoreSentinel onVisible={() => setSuggestedShown((n) => n + 20)} />
              )}
            </section>
          )}
        </div>
        </div>
       </div>
      </main>
    </div>
  );
}

// First visit, nothing followed yet. The feed is worthless empty, so this
// asks for one tap: subscribe to the most active publishers this week, up to
// what today's limit allows. Picking by hand stays available underneath.
function SubscribeCta({
  kind,
  suggested,
  remainingToday,
  onDone,
}: {
  kind: 'job' | 'hotlist';
  suggested: SuggestedPublisher[];
  remainingToday: number;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const who = kind === 'job' ? 'vendors' : 'bench sales recruiters';
  const what = kind === 'job' ? 'requirements' : 'hotlists';
  const count = Math.min(5, remainingToday, suggested.length);

  async function subscribeTop() {
    if (busy || count === 0) return;
    setBusy(true);
    setMessage(null);
    let done = 0;
    let problem: string | null = null;
    for (const s of suggested.slice(0, count)) {
      try {
        await followPublisher(s.publisher_id);
        done += 1;
      } catch (err) {
        if (err instanceof FollowLimitError) { problem = err.message; break; }
      }
    }
    setBusy(false);
    if (done === 0) setMessage(problem ?? 'Could not subscribe right now. Try again.');
    else onDone();
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-blue-200 bg-white p-5 dark:border-blue-500/30 dark:bg-[#171A1F]">
      <div className="flex -space-x-2">
        {suggested.slice(0, 5).map((s) => (
          <span key={s.publisher_id} className="rounded-full ring-2 ring-white dark:ring-[#171A1F]">
            <PublisherAvatar publisher={s} size={32} />
          </span>
        ))}
      </div>
      <h2 className="text-[16px] font-bold">Get new {what} first</h2>
      {count > 0 && (
        <button
          type="button"
          onClick={() => void subscribeTop()}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 self-start rounded-full bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? 'Subscribing…' : `Subscribe to top ${count} ${who}`}
        </button>
      )}
      {message && <p className="text-[12px] text-red-600 dark:text-red-400">{message}</p>}
    </div>
  );
}

// Loads the next page of suggestions as the list's end scrolls into view, a
// little before it gets there so the list never visibly stops.
function LoadMoreSentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onVisible();
    }, { rootMargin: '300px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onVisible]);
  return <div ref={ref} aria-hidden="true" className="h-px" />;
}

function SearchResults({
  query,
  results,
  searching,
  postNoun,
  onOpen,
  onFollowChange,
}: {
  query: string;
  results: PublisherSearchResult[] | null;
  searching: boolean;
  postNoun: string;
  onOpen: (slug: string) => void;
  onFollowChange: () => void;
}) {
  const [following, setFollowing] = useState<Record<string, boolean>>({});
  if (results === null || (searching && results.length === 0)) {
    return <div className="flex justify-center py-10"><LogoSpinner size={22} /></div>;
  }
  if (results.length === 0) {
    return <p className="py-8 text-center text-[13px] text-gray-500 dark:text-slate-400">No one matches "{query}" in the last 30 days.</p>;
  }
  return (
    <section className="flex flex-col gap-2">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {results.length} result{results.length === 1 ? '' : 's'} for "{query}"
      </p>
      {results.map((r) => {
        const isFollowing = following[r.publisher_id] ?? r.is_following;
        return (
          <div
            key={r.publisher_id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(r.slug)}
            onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.slug); }}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 transition hover:border-blue-300 dark:border-white/10 dark:bg-[#171A1F]"
          >
            <PublisherAvatar publisher={r} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold">{r.display_name || r.company_name || 'Recruiter'}</span>
              </div>
              <p className="truncate text-[11px] text-gray-500 dark:text-slate-400">
                {r.match_count > 0
                  ? `${r.match_count} matching ${postNoun}${r.match_count === 1 ? '' : 's'}`
                  : r.company_name && r.display_name ? r.company_name : 'Name match'}
                {r.latest_match_at && ` · ${timeAgo(r.latest_match_at)}`}
              </p>
            </div>
            {!r.is_mine && (
              <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <FollowButton
                  publisherId={r.publisher_id}
                  following={isFollowing}
                  size="sm"
                  onChange={(next) => { setFollowing((prev) => ({ ...prev, [r.publisher_id]: next })); onFollowChange(); }}
                />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function FollowingCardRow({ card, postNoun, onOpen }: { card: FollowingCard; postNoun: string; onOpen: () => void }) {
  const hasNew = card.unread_count > 0;
  const moreRoles = Math.max(0, card.role_count - card.top_roles.length);
  const count = hasNew ? card.unread_count : card.recent_count;
  const countLabel = hasNew
    ? `${count} new ${postNoun}${count === 1 ? '' : 's'}`
    : count > 0 ? `${count} ${postNoun}${count === 1 ? '' : 's'} in 30 days` : 'No recent posts';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-start gap-3 rounded-xl border bg-white px-3 py-3 text-left transition hover:border-blue-300 dark:bg-[#171A1F] ${
        hasNew ? 'border-blue-200 dark:border-blue-500/30' : 'border-gray-200 dark:border-white/10'
      }`}
    >
      <PublisherAvatar publisher={card} size={42} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[14px] font-semibold text-gray-900 dark:text-slate-100">
            {card.display_name || card.company_name || 'Recruiter'}
          </span>
          {card.muted && <MutedIcon />}
          <span className="ml-auto shrink-0 text-[11px] text-gray-400">{timeAgo(card.latest_post_at)}</span>
        </div>
        {card.company_name && card.display_name && (
          <p className="truncate text-[12px] text-gray-500 dark:text-slate-400">{card.company_name}</p>
        )}
        <p className={`mt-1 text-[12px] ${hasNew ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-slate-300'}`}>
          {countLabel}
          {card.top_roles.length > 0 && (
            <span className="font-normal text-gray-600 dark:text-slate-300">
              {' · '}{card.top_roles.join(', ')}{moreRoles > 0 ? `, +${moreRoles} more` : ''}
            </span>
          )}
        </p>
        {(card.top_locations.length > 0 || card.job_types.length > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {card.top_locations.map((l) => <Tag key={`l-${l}`}>{l}</Tag>)}
            {card.job_types.map((t) => <Tag key={`t-${t}`}>{t}</Tag>)}
          </div>
        )}
      </div>
    </button>
  );
}
