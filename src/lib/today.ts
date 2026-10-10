import { supabase } from './supabase';
import { consultantTitle } from './consultant-title';
import { hashColor, locationFit, rateFit, skillMatch, visaFit } from './match-fit';
import type { FitSummary } from '../components/match/Visuals';

// Today, History and Tracker read cards from get_today / get_history /
// get_tracker. "hotlist" = the account's profiles matched to jobs; "job" =
// a vendor's jobs matched to profiles.

export type Kind = 'hotlist' | 'job';

export type Lead = {
  id: string; kind: Kind; title: string; name?: string | null; company?: string | null; poster?: string | null;
  avatar?: string | null; location?: string | null; locations?: string[]; pay?: string | null;
  rate_min?: number | null; rate_max?: number | null; skills: unknown; visas: unknown; exp?: number | null;
  type?: string | null; source?: string | null; post_url?: string | null; apply_url?: string | null;
  has_email: boolean; posted_at: string; open: boolean; category?: string | null; logo_domain?: string | null;
  /** AI pictures of the post (match_visuals): a job has a (a woman) and b (a man), a profile has a (no person). */
  visuals?: { a?: string; b?: string } | null;
};

export type CardItem = {
  card_id: string; subject_id: string; lead_id: string; subject_kind: Kind; fit: number | null; similarity: number;
  stage: string; closed_reason: string | null; viewed_at: string | null; saved_at: string | null; applied_at: string | null;
  added_at: string; reply_in_inbox: boolean; how: 'email' | 'site'; subject: Subject | null;
  lead: Lead | null; duplicate?: string | null;
  /** The viewer's own picture of this post, drawn with their avatar (when their avatar is on). */
  my_visual?: string | null;
  /** Their own note (the Tracker sheet's Notes cell). */
  notes?: string | null;
  /** Across ProfilePush: accounts that viewed, applied to, saved and shared the post. */
  eng?: { views: number; applies: number; saves: number; shares: number };
};

/** The post's picture for this viewer. Each viewer sees one version of a job,
 * the same one every time, half the posts with a woman and half with a man. */
export function pictureFor(lead: Pick<Lead, 'id' | 'visuals'>, viewerId: string | undefined): string | null {
  const v = lead.visuals;
  if (!v) return null;
  let h = 0;
  for (const c of `${viewerId ?? ''}${lead.id}`) h = (h * 31 + c.charCodeAt(0)) | 0;
  const first = (h & 1) === 0 ? v.a : v.b;
  return first ?? v.a ?? v.b ?? null;
}

/** Where a pushed or emailed match lives now, when it's no longer in Today. */
export async function cardRoute(card: string | null, lead: string | null): Promise<string> {
  const { data } = await supabase.rpc('pp_card_route' as never, { p_card: card, p_lead: lead } as never);
  const path: unknown = data;
  return typeof path === 'string' && path.startsWith('/') ? path : '/today';
}

/** Today's matches leave 24 hours after they arrive (get_today, expire_unopened_matches). */
export const TODAY_HOURS = 24;

/** "5h left" on a Today card, urgent in its last 3 hours; null once it's gone. */
export function timeLeft(item: Pick<CardItem, 'added_at'>, now = Date.now()): { label: string; urgent: boolean } | null {
  const ms = new Date(item.added_at).getTime() + TODAY_HOURS * 3_600_000 - now;
  if (!(ms > 0)) return null;
  const mins = Math.ceil(ms / 60_000);
  return { label: mins < 60 ? `${mins}m left` : `${Math.floor(mins / 60)}h left`, urgent: mins < 180 };
}

export type ResumeFile = { id: string; url: string; file_name: string; is_default: boolean };

export type Subject = {
  id: string; title: string | null; name?: string | null; visa?: string | null; visas?: unknown; location?: string | null;
  locations?: string[]; years?: number | null; skills: unknown; rate_min?: number | null; rate_max?: number | null;
  posted_at: string; resumes?: ResumeFile[]; locked: number; applied_today: number;
};

export type Reel = {
  paid: boolean; credits: number; watched_today: number; streak: number; free_daily: number; new_today: number;
  next_reset: string; waiting: number; waiting_preview: Array<{ title: string; company: string | null; avatar: string | null; fit: number | null }>;
};

export type TodayData = {
  kind: Kind; day_start: string; target: number; daily_cap: number; used_today: number; applied_today: number;
  subjects: Subject[]; items: CardItem[]; reel?: Reel;
  /** Their avatar shows in pictures (credits or an active plan). */
  avatar_on?: boolean;
};

export const timeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

export function subjectName(kind: Kind, s: Pick<Subject, 'name' | 'title'> | null | undefined): string {
  if (!s) return kind === 'hotlist' ? 'Profile' : 'Job';
  if (kind === 'hotlist') return s.name?.trim() || consultantTitle(s.title);
  return s.title?.trim() || 'Job';
}

export function leadTitle(lead: Lead): string {
  return lead.kind === 'hotlist' ? consultantTitle(lead.title) : lead.title;
}

export function leadOrg(lead: Lead): string {
  return lead.company?.trim() || lead.poster?.trim() || (lead.kind === 'hotlist' ? 'Profile' : 'Job');
}

export const subjectColor = (id: string) => hashColor(id);

// How a job and a profile fit, whichever side the account is on.
export function fitFor(kind: Kind, subject: Subject | undefined, lead: Lead): FitSummary {
  const jobSkills = kind === 'hotlist' ? strings(lead.skills) : strings(subject?.skills);
  const profileSkills = kind === 'hotlist' ? strings(subject?.skills) : strings(lead.skills);
  const jobVisas = kind === 'hotlist' ? strings(lead.visas) : strings(subject?.visas);
  const profileVisa = kind === 'hotlist' ? subject?.visa ?? null : strings(lead.visas)[0] ?? null;
  const jobLocation = kind === 'hotlist' ? lead.location ?? null : subject?.location ?? null;
  const profileLocations = kind === 'hotlist' ? strings(subject?.locations) : strings(lead.locations);
  const job = kind === 'hotlist' ? lead : subject;
  const profile = kind === 'hotlist' ? subject : lead;
  return {
    skills: skillMatch(jobSkills, profileSkills),
    visa: visaFit(jobVisas, profileVisa),
    location: locationFit(jobLocation, profileLocations),
    rate: rateFit(job?.rate_min, job?.rate_max, profile?.rate_min, profile?.rate_max),
  };
}

export async function loadToday(kind: Kind): Promise<TodayData | null> {
  const { data, error } = await supabase.rpc('get_today' as never, { p_kind: kind, p_tz: timeZone() } as never);
  if (error) throw new Error(error.message);
  return data as unknown as TodayData | null;
}

export async function loadHistory(kind: Kind, tab: 'viewed' | 'saved' | 'applied') {
  const { data, error } = await supabase.rpc('get_history' as never, { p_kind: kind, p_tab: tab, p_tz: timeZone() } as never);
  if (error) throw new Error(error.message);
  return data as unknown as { tab: string; counts: { viewed: number; saved: number; applied: number }; items: CardItem[] } | null;
}

export async function loadTracker(kind: Kind) {
  const { data, error } = await supabase.rpc('get_tracker' as never, { p_kind: kind } as never);
  if (error) throw new Error(error.message);
  return data as unknown as { counts: { applied: number; replied: number; interview: number; placed: number }; items: CardItem[] } | null;
}

// Opening a card (or seeing it in swipe mode) marks it viewed. Batched.
const pendingViews = new Set<string>();
let viewTimer: ReturnType<typeof setTimeout> | null = null;
export function markViewed(cardId: string) {
  pendingViews.add(cardId);
  if (viewTimer) return;
  viewTimer = setTimeout(() => {
    const ids = [...pendingViews];
    pendingViews.clear();
    viewTimer = null;
    void supabase.rpc('mark_cards_viewed' as never, { p_ids: ids } as never);
  }, 1200);
}

export async function setSaved(cardId: string, saved: boolean) {
  const { error } = await supabase.rpc('set_card_saved' as never, { p_id: cardId, p_saved: saved } as never);
  if (error) throw new Error(error.message);
}

export async function dismissCard(cardId: string) {
  const { error } = await supabase.rpc('move_pipeline_card' as never, { p_id: cardId, p_stage: 'closed', p_reason: 'not_a_match' } as never);
  if (error) throw new Error(error.message);
}

export async function restoreCard(cardId: string) {
  await supabase.rpc('move_pipeline_card' as never, { p_id: cardId, p_stage: 'new', p_reason: null } as never);
}

export async function shareLink(lead: Lead): Promise<'shared' | 'copied' | 'failed'> {
  const url = `${window.location.origin}/${lead.kind === 'job' ? 'job' : 'hotlist'}/${lead.id}`;
  const title = leadTitle(lead);
  try {
    if (navigator.share) { await navigator.share({ title, url }); return 'shared'; }
  } catch (e) {
    // Closing the share sheet is not a share.
    if ((e as Error)?.name === 'AbortError') return 'failed';
  }
  try { await navigator.clipboard.writeText(url); return 'copied'; } catch { return 'failed'; }
}

// A card's own profile (or job), for pages that don't load Today's list.
export const subjectsOf = (items: CardItem[]): Record<string, Subject> =>
  Object.fromEntries(items.filter((i) => i.subject).map((i) => [i.subject_id, i.subject as Subject]));

// Where an application stands, in the words the Tracker shows.
export const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'applied', label: 'Applied' }, { value: 'replied', label: 'Replied' }, { value: 'interview', label: 'Interview' },
  { value: 'placed', label: 'Placed' }, { value: 'not_selected', label: 'Not selected' }, { value: 'no_response', label: 'No response' },
  { value: 'job_closed', label: 'Job closed' },
];
export function statusOf(item: Pick<CardItem, 'stage' | 'closed_reason'>): string {
  if (item.stage === 'closed') return ['not_selected', 'no_response', 'job_closed'].includes(item.closed_reason ?? '') ? item.closed_reason! : 'job_closed';
  return item.stage === 'submitted' ? 'applied' : item.stage;
}
export async function setNotes(cardId: string, notes: string) {
  const { error } = await supabase.rpc('set_card_notes' as never, { p_id: cardId, p_notes: notes } as never);
  if (error) throw new Error(error.message);
}
export async function setStatus(cardId: string, status: string) {
  const { error } = await supabase.rpc('set_card_status' as never, { p_id: cardId, p_status: status } as never);
  if (error) throw new Error(error.message);
}

export type Question = 'rate' | 'visa' | 'location';
// What the post leaves out that its poster can be asked for. For a job post:
// its rate, visas, location. For a profile post (vendors): the profile's.
export function missingFor(kind: Kind, fit: FitSummary): Question[] {
  const out: Question[] = [];
  if (kind === 'hotlist') {
    if (fit.rate.job == null) out.push('rate');
    if (fit.visa.accepted.length === 0) out.push('visa');
    if (fit.location.kind === 'unknown') out.push('location');
  } else {
    if (fit.rate.mine == null) out.push('rate');
    if (!fit.visa.mine) out.push('visa');
    if (!fit.location.profileState && fit.location.kind !== 'remote') out.push('location');
  }
  return out;
}
