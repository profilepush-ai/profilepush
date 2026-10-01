import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BellOff, Check, Crown, Flame, Plus, TrendingUp } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  FollowLimitError,
  fetchPublisherForLead,
  followPublisher,
  getFollowedEmailsSnapshot,
  profilePath,
  publisherEmailKey,
  setEmailFollowed,
  subscribeFollowedEmails,
  publisherDisplayName,
  publisherInitials,
  unfollowPublisher,
} from '../../lib/publishers';

export function PublisherAvatar({
  publisher,
  size = 40,
}: {
  publisher: { display_name: string; company_name: string; avatar_url: string };
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (publisher.avatar_url && !failed) {
    return (
      <img
        src={publisher.avatar_url}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={style}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div style={style} className="flex shrink-0 items-center justify-center rounded-full bg-slate-200 font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">
      {publisherInitials(publisher)}
    </div>
  );
}

export function PublisherName({
  publisher,
  slug,
  className = '',
}: {
  publisher: { display_name: string; company_name: string };
  slug: string;
  className?: string;
}) {
  const { account } = useAuth();
  return (
    <Link to={profilePath(slug, account?.active_persona)} className={`truncate font-semibold text-gray-900 hover:underline dark:text-slate-100 ${className}`}>
      {publisherDisplayName(publisher)}
    </Link>
  );
}

// Subscribe / Subscribed toggle. Reports the daily limit in place instead of
// failing silently, since hitting it is the moment a free account learns the
// limit exists.
export function FollowButton({
  publisherId,
  following,
  onChange,
  size = 'md',
}: {
  publisherId: string;
  following: boolean;
  onChange: (following: boolean) => void;
  size?: 'sm' | 'md';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNeedsUpgrade(false);
    try {
      if (following) {
        await unfollowPublisher(publisherId);
        onChange(false);
      } else {
        await followPublisher(publisherId);
        onChange(true);
      }
    } catch (err) {
      setError(err instanceof FollowLimitError ? err.message : 'Could not update the subscription. Try again.');
      setNeedsUpgrade(err instanceof FollowLimitError && err.kind === 'total');
    } finally {
      setBusy(false);
    }
  }

  const pad = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-[12px]';
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={following}
        className={`inline-flex shrink-0 items-center gap-1 rounded-full font-semibold transition disabled:opacity-60 ${pad} ${
          following
            ? 'border border-gray-200 bg-white text-gray-700 hover:border-red-200 hover:text-red-600 dark:border-white/15 dark:bg-transparent dark:text-slate-200'
            : 'border border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        {following ? <Check size={12} /> : <Plus size={12} />}
        {following ? 'Subscribed' : 'Subscribe'}
      </button>
      {error && (
        <p className="max-w-[220px] text-right text-[11px] text-red-600 dark:text-red-400">
          {error}
          {needsUpgrade && (
            <> <Link to="/billing" className="font-semibold text-blue-600 underline dark:text-blue-400">Upgrade</Link></>
          )}
        </p>
      )}
    </div>
  );
}

export function MutedIcon() {
  return <BellOff size={11} className="text-gray-400" aria-label="Notifications muted" />;
}

export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-white/5 dark:text-slate-300">
      {children}
    </span>
  );
}

// The poster's name on a feed card, as a link to their profile. The profile is
// looked up on click rather than per card, so a feed of hundreds of cards
// makes no extra requests.
export function PosterProfileLink({
  kind,
  leadId,
  children,
}: {
  kind: 'job' | 'hotlist';
  leadId: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const { account } = useAuth();
  const [busy, setBusy] = useState(false);
  async function open(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const publisher = await fetchPublisherForLead(kind, leadId);
      if (publisher) navigate(profilePath(publisher.slug, account?.active_persona));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span
      role="link"
      tabIndex={0}
      onClick={(e) => void open(e)}
      onKeyDown={(e) => { if (e.key === 'Enter') void open(e); }}
      className={`inline-flex cursor-pointer items-center gap-1 font-medium text-gray-700 underline decoration-gray-300 underline-offset-2 transition-colors hover:text-blue-600 hover:decoration-blue-400 dark:text-slate-200 dark:decoration-slate-600 dark:hover:text-blue-300 ${busy ? 'opacity-60' : ''}`}
      title="View profile"
    >
      {children}
    </span>
  );
}

// "View profile" and Subscribe for one post's publisher, used in the detail view.
export function PublisherFollowInline({ kind, leadId }: { kind: 'job' | 'hotlist'; leadId: string }) {
  const { account } = useAuth();
  const [publisher, setPublisher] = useState<Awaited<ReturnType<typeof fetchPublisherForLead>>>(null);
  useEffect(() => {
    let cancelled = false;
    setPublisher(null);
    void fetchPublisherForLead(kind, leadId).then((p) => { if (!cancelled) setPublisher(p); });
    return () => { cancelled = true; };
  }, [kind, leadId]);
  if (!publisher) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Link
        to={profilePath(publisher.slug, account?.active_persona)}
        className="text-[12px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
      >
        View profile
      </Link>
      {!publisher.is_mine && (
        <FollowButton
          publisherId={publisher.publisher_id}
          following={publisher.is_following}
          size="sm"
          onChange={(following) => setPublisher({ ...publisher, is_following: following })}
        />
      )}
    </div>
  );
}

// "Subscribe" as a text link on a feed card, beside the poster's name.
// Following state comes from the shared set in lib/publishers, loaded once.
export function SubscribeTextLink({
  kind,
  leadId,
  posterEmail,
}: {
  kind: 'job' | 'hotlist';
  leadId: string;
  posterEmail: string;
}) {
  const { user } = useAuth();
  const myEmail = user?.email;
  const followed = useSyncExternalStore(subscribeFollowedEmails, getFollowedEmailsSnapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = publisherEmailKey(posterEmail);
  if (!key || key === publisherEmailKey(myEmail)) return null;
  const isFollowing = followed?.has(key) ?? false;

  async function subscribe(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (busy || isFollowing) return;
    setBusy(true);
    setError(null);
    try {
      const publisher = await fetchPublisherForLead(kind, leadId);
      if (!publisher || publisher.is_mine) return;
      await followPublisher(publisher.publisher_id);
      setEmailFollowed(key, true);
    } catch (err) {
      setError(err instanceof FollowLimitError
        ? (err.kind === 'total' ? `Free limit of ${err.limit} reached` : 'Daily limit reached')
        : 'Try again');
    } finally {
      setBusy(false);
    }
  }

  if (isFollowing) {
    return <span className="whitespace-nowrap text-gray-400 dark:text-slate-500">Subscribed</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <button
        type="button"
        onClick={(e) => void subscribe(e)}
        disabled={busy}
        className="font-semibold text-blue-600 hover:underline disabled:opacity-60 dark:text-blue-400"
      >
        Subscribe
      </button>
      {error && <span className="text-red-500">{error}</span>}
    </span>
  );
}

// Badge for well-subscribed profiles: Rising (3+), Popular (10+), Top (50+).
// The thresholds start low because the network is young; raise them as it grows.
const SUBSCRIBER_TIERS = [
  { min: 50, label: 'Top', className: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300', Icon: Crown },
  { min: 10, label: 'Popular', className: 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300', Icon: Flame },
  { min: 3, label: 'Rising', className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300', Icon: TrendingUp },
] as const;

export function SubscriberBadge({ count, size = 'sm' }: { count: number | null | undefined; size?: 'sm' | 'md' }) {
  const tier = SUBSCRIBER_TIERS.find((t) => (count ?? 0) >= t.min);
  if (!tier) return null;
  const Icon = tier.Icon;
  return (
    <span
      title={`${count} subscribers`}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border font-semibold ${size === 'md' ? 'px-2 py-0.5 text-[11px]' : 'px-1.5 py-px text-[10px]'} ${tier.className}`}
    >
      <Icon size={size === 'md' ? 11 : 9} strokeWidth={2.5} />
      {tier.label}
    </span>
  );
}
