import { supabase } from './supabase';

// Subscriptions: a publisher is one poster (a vendor posting requirements or a
// bench sales recruiter posting hotlists). All reads and writes go through the
// RPCs in 20260929120000_publisher_subscriptions.sql; the tables themselves are
// not readable by the client because they hold the poster's email.

export type PublisherPostKind = 'job' | 'hotlist';
export type Persona = 'vendor' | 'bench_sales' | null | undefined;

// Bench sales read vendors' requirements; vendors read bench recruiters' hotlists.
export function followingKindForPersona(persona: Persona): PublisherPostKind {
  return persona === 'bench_sales' ? 'job' : 'hotlist';
}

// One name for both personas: the page holds the people you work with (vendors
// for bench sales, bench sales recruiters for vendors).
export function followingLabelForPersona(_persona: Persona): string {
  return 'Network';
}

export type FollowingCard = {
  publisher_id: string;
  slug: string;
  display_name: string;
  company_name: string;
  avatar_url: string;
  is_claimed: boolean;
  muted: boolean;
  unread_count: number;
  recent_count: number;
  latest_post_at: string | null;
  top_roles: string[];
  role_count: number;
  top_locations: string[];
  job_types: string[];
  first_unread_lead_id: string | null;
};

export type SuggestedPublisher = {
  publisher_id: string;
  slug: string;
  display_name: string;
  company_name: string;
  avatar_url: string;
  is_claimed: boolean;
  post_count: number;
  top_roles: string[];
  follower_count?: number;
};

export type PublisherProfile = {
  publisher_id: string;
  slug: string;
  display_name: string;
  company_name: string;
  avatar_url: string;
  linkedin_url: string;
  is_claimed: boolean;
  is_mine: boolean;
  is_following: boolean;
  muted: boolean;
  last_seen_at: string | null;
  follower_count: number;
  job_post_count: number;
  hotlist_post_count: number;
};

export type PublisherPost = {
  lead_id: string;
  posted_at: string;
  title: string;
  locations: string[];
  job_types: string[];
  rate: string | null;
  skills: string[];
  summary: string;
  consultant_count: number | null;
  visa_types: string[];
  experience: string | null;
};

export type FollowQuota = {
  used_today: number;
  daily_limit: number;
  // Left today, already capped by the free plan's total limit.
  remaining: number;
  is_trial: boolean;
  following_total?: number;
  total_limit?: number | null;
};

// The generated Database types don't know these functions yet.
const rpc = (name: string, args?: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

export async function fetchFollowingFeed(kind: PublisherPostKind): Promise<FollowingCard[]> {
  const { data, error } = await rpc('get_following_feed', { p_kind: kind });
  if (error) throw new Error(error.message);
  return (data as FollowingCard[] | null) ?? [];
}

// One page of the Active tab, most posts this week first. total is how many
// publishers are active in all, for the tab's count.
export async function fetchSuggestedPublishers(
  kind: PublisherPostKind,
  limit = 20,
  offset = 0,
): Promise<{ rows: SuggestedPublisher[]; total: number }> {
  const { data, error } = await rpc('get_suggested_publishers', { p_kind: kind, p_limit: limit, p_offset: offset });
  if (error) throw new Error(error.message);
  const rows = (data as Array<SuggestedPublisher & { total_count: number }> | null) ?? [];
  return { rows, total: rows[0]?.total_count ?? (offset === 0 ? 0 : offset) };
}

export async function fetchPublisherProfile(slug: string): Promise<PublisherProfile | null> {
  const { data, error } = await rpc('get_publisher_profile', { p_slug: slug });
  if (error) throw new Error(error.message);
  return ((data as PublisherProfile[] | null) ?? [])[0] ?? null;
}

export async function fetchPublisherPosts(publisherId: string, kind: PublisherPostKind): Promise<PublisherPost[]> {
  const { data, error } = await rpc('get_publisher_posts', { p_publisher_id: publisherId, p_kind: kind });
  if (error) throw new Error(error.message);
  return (data as PublisherPost[] | null) ?? [];
}

export async function fetchFollowQuota(): Promise<FollowQuota | null> {
  const { data, error } = await rpc('get_follow_quota');
  if (error) return null;
  return ((data as FollowQuota[] | null) ?? [])[0] ?? null;
}

// Free accounts: 5 new a day and 10 in total. Paid: 10 new a day.
export class FollowLimitError extends Error {
  constructor(public limit: number, public kind: 'daily' | 'total' = 'daily') {
    super(kind === 'total'
      ? `Free accounts can subscribe to ${limit} publishers. Upgrade to subscribe to more.`
      : `You can subscribe to ${limit} new publishers a day. Try again tomorrow.`);
  }
}

export async function followPublisher(publisherId: string): Promise<FollowQuota> {
  const { data, error } = await rpc('follow_publisher', { p_publisher_id: publisherId });
  if (error) {
    const total = error.message.match(/FOLLOW_TOTAL_LIMIT_REACHED:(\d+)/);
    if (total) throw new FollowLimitError(Number(total[1]), 'total');
    const limit = error.message.match(/FOLLOW_LIMIT_REACHED:(\d+)/);
    if (limit) throw new FollowLimitError(Number(limit[1]), 'daily');
    throw new Error(error.message);
  }
  const row = ((data as Array<FollowQuota & { following: boolean }> | null) ?? [])[0];
  if (followedEmails) void refreshFollowedEmails();
  return { used_today: row?.used_today ?? 0, daily_limit: row?.daily_limit ?? 0, remaining: row?.remaining ?? 0, is_trial: true };
}

export async function unfollowPublisher(publisherId: string): Promise<void> {
  const { error } = await rpc('unfollow_publisher', { p_publisher_id: publisherId });
  if (error) throw new Error(error.message);
  if (followedEmails) void refreshFollowedEmails();
}

export async function setPublisherMuted(publisherId: string, muted: boolean): Promise<void> {
  const { error } = await rpc('set_publisher_muted', { p_publisher_id: publisherId, p_muted: muted });
  if (error) throw new Error(error.message);
}

export async function markPublisherSeen(publisherId: string): Promise<void> {
  await rpc('mark_publisher_seen', { p_publisher_id: publisherId });
}

export async function fetchPublisherForLead(kind: PublisherPostKind, leadId: string) {
  const { data, error } = await rpc('get_publisher_for_lead', { p_kind: kind, p_lead_id: leadId });
  if (error) return null;
  return ((data as Array<{ publisher_id: string; slug: string; display_name: string; is_following: boolean; is_mine: boolean }> | null) ?? [])[0] ?? null;
}

// Claims the profile that matches the signed-in user's confirmed email, if
// one exists and nobody has claimed it. Safe to call on every sign-in.
export async function claimMyPublisherProfile(): Promise<void> {
  try {
    await rpc('claim_my_publisher_profile');
  } catch {
    // Claiming is best-effort; the next sign-in retries it.
  }
}

export function publisherDisplayName(p: { display_name: string; company_name: string }): string {
  return p.display_name.trim() || p.company_name.trim() || 'Recruiter';
}

export function publisherInitials(p: { display_name: string; company_name: string }): string {
  return publisherDisplayName(p).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// Where a post opens: the existing feed detail view, which already carries
// Match and Submit. Lead permalinks use the singular kind.
export function leadPath(kind: PublisherPostKind, leadId: string): string {
  return `/feed/${kind}/${leadId}`;
}

export type PublisherSearchResult = {
  publisher_id: string;
  slug: string;
  display_name: string;
  company_name: string;
  avatar_url: string;
  is_claimed: boolean;
  is_following: boolean;
  is_mine: boolean;
  match_count: number;
  latest_match_at: string | null;
  top_roles: string[];
  name_match: boolean;
};

// Finds publishers by name or company, and by what they posted in the last 30
// days (websearch syntax, same as the feed's search box).
export async function searchPublishers(kind: PublisherPostKind, query: string, limit = 30): Promise<PublisherSearchResult[]> {
  const { data, error } = await rpc('search_publishers', { p_kind: kind, p_query: query, p_limit: limit });
  if (error) throw new Error(error.message);
  return (data as PublisherSearchResult[] | null) ?? [];
}

export async function fetchPublisherCounts(kind: PublisherPostKind): Promise<{ total: number; following: number } | null> {
  const { data, error } = await rpc('get_publisher_counts', { p_kind: kind });
  if (error) return null;
  return ((data as Array<{ total: number; following: number }> | null) ?? [])[0] ?? null;
}

// ── Followed posters, shared by every feed card ─────────────────────────────
// Loaded once per session and kept current by the follow/unfollow calls, so a
// feed of hundreds of cards can show Subscribe / Subscribed without a request
// per card.
export function publisherEmailKey(email: string | null | undefined): string {
  return (email ?? '').split(',')[0].trim().toLowerCase();
}

let followedEmails: Set<string> | null = null;
let followedLoading: Promise<void> | null = null;
const followedListeners = new Set<() => void>();

function emitFollowed() {
  for (const listener of followedListeners) listener();
}

export function refreshFollowedEmails(): Promise<void> {
  followedLoading = (async () => {
    const { data, error } = await rpc('get_followed_publisher_emails');
    if (!error) {
      followedEmails = new Set(((data as string[] | null) ?? []).map(publisherEmailKey));
      emitFollowed();
    }
  })().finally(() => { followedLoading = null; });
  return followedLoading;
}

export function subscribeFollowedEmails(listener: () => void): () => void {
  followedListeners.add(listener);
  if (!followedEmails && !followedLoading) void refreshFollowedEmails();
  return () => { followedListeners.delete(listener); };
}

export function getFollowedEmailsSnapshot(): Set<string> | null {
  return followedEmails;
}

export function setEmailFollowed(email: string, following: boolean) {
  const key = publisherEmailKey(email);
  if (!key) return;
  const next = new Set(followedEmails ?? []);
  if (following) next.add(key); else next.delete(key);
  followedEmails = next;
  emitFollowed();
}

// ── Page addresses ──────────────────────────────────────────────────────────
// /network/vendors (for bench sales) and /network/bench-sales (for vendors)
// list the people you work with; /network/<section>/<slug> is one profile.
// /network, /network/<slug>, /following and /p/<slug> all redirect here.
export const NETWORK_PATH = '/network';
export type NetworkSection = 'vendors' | 'bench-sales';

export function networkSectionForPersona(persona: Persona): NetworkSection {
  return persona === 'bench_sales' ? 'vendors' : 'bench-sales';
}

export function networkPath(persona: Persona): string {
  return `${NETWORK_PATH}/${networkSectionForPersona(persona)}`;
}

export function profilePath(slug: string, persona: Persona, query?: string): string {
  const q = query?.trim();
  return `${networkPath(persona)}/${encodeURIComponent(slug)}${q ? `?q=${encodeURIComponent(q)}` : ''}`;
}
