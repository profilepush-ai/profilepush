import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AtSign, Briefcase, Building2, BadgeCheck, Check, MessageCircle, DollarSign, FileText, Laptop, MapPin, Share2, Shield, Sparkles, Mail, Gauge, GraduationCap, Eye, X } from 'lucide-react';
import { PosterProfileLink, SubscribeTextLink } from './publishers/PublisherBits';
import LogoSpinner from './LogoSpinner';
import { supabase } from '../lib/supabase';
import { consultantTitle } from '../lib/consultant-title';
import { buildScoreBreakdownDisplayItems } from '../lib/radar-match-ui';
import { normalizePostSource, type PostSource } from '../lib/post-source';
import LeadKindPill from './LeadKindPill';
import LeadAvatar from './LeadAvatar';
import ApplyOnSiteButton, { isCareerSiteLead } from './ApplyOnSite';

// The lead card used everywhere a job or hotlist post is shown (Feed, AI Match,
// profile panels, Tracker). Moved here from PulsePage unchanged so every page
// draws the same card.

export function getLeadShareUrl(lead: SocialLead): string {
  return `${window.location.origin}/${lead.kind === 'hotlist' ? 'hotlist' : 'job'}/${lead.id}`;
}

// Records that this account shared this lead, for the Posts page's Shares
// column — same "one row per (account, lead, action)" convention as
// revealed/breakdown/post_content_viewed, so a repeat share by the same
// account doesn't inflate the count.
export function recordLeadShare(leadId: string, accountId: string | null | undefined, userId: string | null | undefined) {
  if (!accountId) return;
  void supabase
    .from('pulse_lead_actions')
    .upsert(
      { account_id: accountId, user_id: userId ?? null, lead_id: leadId, action_type: 'shared' },
      { onConflict: 'account_id,user_id,lead_id,action_type', ignoreDuplicates: true },
    );
}

// Shared by both the card and table views — uses the native share sheet
// where available (mobile, some desktop browsers), otherwise copies the
// link and reports success via the returned boolean so the caller can show
// its own brief "Copied" feedback.
export async function shareLead(lead: SocialLead, accountId: string | null | undefined, userId: string | null | undefined): Promise<boolean> {
  const url = getLeadShareUrl(lead);
  const title = lead.kind === 'hotlist' ? (lead.roleTitle || lead.title || 'Available Consultant') : (lead.title || 'Job Opportunity');
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      recordLeadShare(lead.id, accountId, userId);
      return false;
    } catch {
      // AbortError (user cancelled) or unsupported — fall through to copy.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    recordLeadShare(lead.id, accountId, userId);
    return true;
  } catch {
    return false;
  }
}

// Marks a requirement taken straight from the firm's own careers site.
function CareerSitePill() {
  return (
    <span
      title="Posted on the firm's own careers site"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-[1px] text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
    >
      <Building2 size={10} strokeWidth={2} />
      Career site
    </span>
  );
}

export type SocialLead = {
  id: string;
  title: string;
  roleTitle?: string;
  location: string;
  company: string;
  posterName: string;
  posterEmail: string;
  posterPhone: string;
  postedAt: string;
  createdAt: string;
  matchedAt?: string;
  postedAgo: string;
  platform: string;
  matchScore: number | null;
  profileId: string | null;
  scoreBreakdown: Record<string, unknown> | null;
  snippet: string;
  employmentType: string;
  seniority: string;
  salaryRange: string;
  skills: string[];
  experienceYears: number | null;
  visaTypes: string[];
  hourlyRate: string;
  workType: string;
  consultantCount?: number;
  candidateIndex?: number;
  postSource: PostSource;
  /** Career-site jobs: the job page on the firm's site, where Apply happens. */
  applyUrl?: string | null;
  authorAccountId: string | null;
  authorUserId: string | null;
  authorName: string | null;
  avatarUrl: string | null;
  kind: 'job' | 'hotlist';
  // Set only on AI Match results: the 1-10 fit score and the model's one-line
  // reason. Absent everywhere else, which is what keeps the badge off the feed.
  aiMatchScore?: number | null;
  aiMatchReason?: string | null;
  // Why the rules capped the score, when they did: a stated fact the two sides
  // disagree on, such as the job being USC-only.
  aiMatchRuleNote?: string | null;
};

export function extractPrimaryEmail(raw: string | null | undefined): string {
  // Recruiter posts often list more than one contact address (a primary plus
  // a backup) separated by commas/slashes/whitespace. The whole raw string
  // never matches a single-email pattern, which was silently disabling the
  // Request button for every lead with more than one email on file. Pick the
  // first token that actually looks like a single valid email instead.
  const candidates = (raw ?? '').split(/[,;/|\s]+/).map((part) => part.trim()).filter(Boolean);
  return candidates.find((candidate) => /^\S+@\S+\.\S+$/.test(candidate)) ?? '';
}

export type FeedTimeBasis = 'posted' | 'created';

export type GlobalAskedJobState = 'asked' | 'verified';

export type PredictCategory = { label: string; earned: number; max: number; note: string };

export type PredictResult = { score: number; categories: PredictCategory[]; verdict: string; verdictClass: string };

export function PersonaMissingTag() {
  return (
    <span
      className="inline-flex items-center justify-center text-[#64748B]"
      aria-label="Request the missing details by revealing the email"
      title="Request the missing details by revealing the email"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2" opacity="0.9" />
        <path d="M5 2.8V5.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="5" cy="7.3" r="0.6" fill="currentColor" />
      </svg>
    </span>
  );
}

export const CARD_PALETTE = [
  {
    border: 'border-blue-100',
    fill: 'bg-white dark:bg-[#1E2126]',
    titleColor: '#38BDF8',
  },
  {
    border: 'border-violet-100',
    fill: 'bg-white dark:bg-[#1E2126]',
    titleColor: '#FACC15',
  },
  {
    border: 'border-emerald-100',
    fill: 'bg-white dark:bg-[#1E2126]',
    titleColor: '#34D399',
  },
  {
    border: 'border-amber-100',
    fill: 'bg-white dark:bg-[#1E2126]',
    titleColor: '#FB7185',
  },
  {
    border: 'border-rose-100',
    fill: 'bg-white dark:bg-[#1E2126]',
    titleColor: '#C084FC',
  },
  {
    border: 'border-cyan-100',
    fill: 'bg-white dark:bg-[#1E2126]',
    titleColor: '#FB923C',
  },
];

// Pure breakdown-field helpers, hoisted out of PulsePage so the memoized
// LeadCard component (defined below, outside PulsePage) can call them
// without needing PulsePage's closure.
export function isRoleLikeBreakdownKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('role') ||
    normalized.includes('title') ||
    normalized.includes('name_match')
  );
}

export function getPulseBreakdownOrder(key: string) {
  const normalized = key.toLowerCase();
  if (normalized.includes('experience') || normalized.includes('exp')) return 0;
  if (normalized.includes('work_type') || normalized.includes('work type')) return 1;
  if (normalized.includes('employment_type') || normalized.includes('employment type')) return 2;
  if (normalized.includes('rate') || normalized.includes('hourly')) return 3;
  if (normalized.includes('visa')) return 4;
  if (normalized.includes('location')) return 5;
  if (normalized.includes('skill')) return 6;
  return 999;
}

export function orderPulseBreakdownItems<T extends { key: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    const orderDelta = getPulseBreakdownOrder(a.key) - getPulseBreakdownOrder(b.key);
    if (orderDelta !== 0) return orderDelta;
    return a.key.localeCompare(b.key);
  });
}

export function normalizeBreakdownDisplayValue(value: string | null | undefined) {
  const cleaned = (value ?? '').trim();
  const normalized = cleaned.toLowerCase().replace(/\s+/g, ' ');
  if (!cleaned) return '-';
  if (
    normalized === 'unknown'
    || normalized === 'not specified'
    || normalized === 'not available'
    || normalized === 'n/a'
    || normalized === 'na'
    || normalized === 'none'
    || normalized === 'null'
    || normalized === '-'
    || normalized === '--'
    || normalized === 'tbd'
  ) {
    return '-';
  }
  return cleaned;
}

export function normalizeHotlistWorkType(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[-_]+/g, ' ');
  if (/\bhybrid\b/.test(normalized)) return 'Hybrid';
  if (/\bremote\b/.test(normalized)) return 'Remote';
  if (/\bon\s*site\b|\bonsite\b/.test(normalized)) return 'Onsite';
  return '-';
}

export function getLeadBreakdownFieldValues(lead: SocialLead, isHotlistFeed: boolean) {
  const inlineBreakdownItems = orderPulseBreakdownItems(buildScoreBreakdownDisplayItems(
    lead.scoreBreakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
    undefined,
    {
      employment_type: lead.employmentType || null,
      work_type: null,
    },
  ).filter((item) => !isRoleLikeBreakdownKey(item.key)));
  // Self-submitted posts (post_source='user_post') never go through AI
  // matching, so scoreBreakdown is always empty for them — without a
  // fallback to the lead's own stored fields, every chip below would show
  // "-" even though the poster's real data (location, skills, experience,
  // visa, rate) is sitting right there on the lead.
  const getBreakdownValue = (matchers: string[], fallback?: string) => {
    const found = inlineBreakdownItems.find((item) => {
      const key = item.key.toLowerCase();
      return matchers.some((matcher) => key.includes(matcher));
    });
    const breakdownValue = normalizeBreakdownDisplayValue(found?.detail?.job_value);
    if (breakdownValue !== '-') return breakdownValue;
    return fallback ? normalizeBreakdownDisplayValue(fallback) : '-';
  };
  const expValue = getBreakdownValue(['experience', 'exp'], lead.experienceYears != null ? String(lead.experienceYears) : undefined);
  const rawWorkTypeValue = getBreakdownValue(['work_type', 'work type'], lead.workType || undefined);
  const workTypeValue = isHotlistFeed ? normalizeHotlistWorkType(rawWorkTypeValue) : rawWorkTypeValue;
  const employmentTypeValue = getBreakdownValue(['employment_type', 'employment type'], lead.employmentType || undefined);
  // "$65–$65/hr" reads as a range; a single figure is shown once.
  const rateValue = getBreakdownValue(['rate', 'hourly'], lead.hourlyRate || undefined)
    .replace(/^\$([\d.,]+)\s*[–-]\s*\$?\1(\/\w+)?$/, '$$$1$2');
  const visaValue = getBreakdownValue(['visa'], lead.visaTypes.length > 0 ? lead.visaTypes.join(', ') : undefined);
  const locationValue = getBreakdownValue(['location'], lead.location && lead.location !== 'Location not specified' ? lead.location : undefined);
  const skillsValue = getBreakdownValue(['skill'], lead.skills.length > 0 ? lead.skills.join(', ') : undefined);
  return { inlineBreakdownItems, expValue, workTypeValue, employmentTypeValue, rateValue, visaValue, locationValue, skillsValue };
}

export function predictToneClass(score: number, isDark: boolean) {
  if (score >= 80) return isDark ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
  if (score >= 60) return isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100';
  if (score >= 40) return isDark ? 'border-amber-400/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100';
  return isDark ? 'border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/20' : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100';
}

// A field value clamped to 2 lines with a "+N more"/"less" toggle, used inside
// LeadCard's breakdown grid. Takes isExpanded/onToggle as props (rather than
// closing over PulsePage's expandedFieldKeys state) so LeadCard can stay a
// pure, memoizable component.
export function ClampedField({ value, linkClassName, isExpanded, onToggle }: {
  value: string;
  linkClassName: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isMultiPart = value !== '-' && value.includes(',');
  const parts = isMultiPart ? value.split(',').map((part) => part.trim()).filter(Boolean) : [];
  const itemCap = 2;
  const collapsedParts = isMultiPart ? parts.slice(0, itemCap) : [];
  const hiddenCount = isMultiPart ? parts.length - collapsedParts.length : 0;
  const visibleParts = isExpanded ? parts : collapsedParts;
  const visibleText = isMultiPart ? visibleParts.join(', ') : value;

  // Real overflow detection (scrollHeight vs clientHeight) instead of a
  // fixed character-count guess — see ClampedSkills for why. Also, when
  // overflow does apply, the toggle button is nested INSIDE the clamped
  // span rather than after it as a sibling, since line-clamp's
  // display:-webkit-box always forces a following sibling onto a new line
  // even when the visible text's last line still has room.
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [isTextClamped, setIsTextClamped] = useState(false);
  useLayoutEffect(() => {
    if (isExpanded || value === '-') return;
    const el = textRef.current;
    if (!el) return;
    const measure = () => setIsTextClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isExpanded, visibleText, value]);

  if (value === '-') return <PersonaMissingTag />;
  const isLikelyOverflow = hiddenCount > 0 || isTextClamped;

  if (!isExpanded) {
    return (
      <span ref={textRef} className="line-clamp-2">
        {visibleText}
        {isLikelyOverflow && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
            {hiddenCount > 0 ? `+${hiddenCount} more` : 'more'}
          </button>
        )}
      </span>
    );
  }
  return (
    <>
      <span className="block max-h-14 overflow-y-auto">{visibleText}</span>
      {isLikelyOverflow && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
          {isMultiPart ? 'Show less' : 'less'}
        </button>
      )}
    </>
  );
}

// Comma-separated skills list clamped to `itemCap` items with a "+N more"
// toggle. Same isExpanded/onExpand/onCollapse-as-props shape as ClampedField,
// for the same memoization reason.
export function ClampedSkills({ skillsValue, itemCap, linkClassName, isExpanded, onExpand, onCollapse }: {
  skillsValue: string;
  itemCap: number;
  linkClassName: string;
  isExpanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const skillsList = skillsValue === '-' ? [] : skillsValue.split(',').map((skill) => skill.trim()).filter(Boolean);
  const collapsedSkills = skillsList.slice(0, itemCap);
  const hiddenCount = skillsList.length - collapsedSkills.length;
  const visibleSkills = isExpanded ? skillsList : collapsedSkills;
  const visibleText = visibleSkills.join(', ');

  // Whether the 2-line clamp is actually cutting text off. A fixed
  // character-count guess doesn't track the card's real width (e.g. it
  // over-triggers once cards get wider, like on a 2-column desktop grid vs
  // 4-column), so measure the rendered span directly instead.
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [isTextClamped, setIsTextClamped] = useState(false);
  useLayoutEffect(() => {
    if (isExpanded) return;
    const el = textRef.current;
    if (!el) return;
    const measure = () => setIsTextClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isExpanded, visibleText]);

  if (skillsList.length === 0) return <PersonaMissingTag />;
  const isLikelyOverflow = hiddenCount > 0 || isTextClamped;
  if (!isExpanded) {
    // The "+N more" link is nested INSIDE the clamped span, not after it as
    // a sibling — line-clamp renders as display:-webkit-box, which acts
    // like a block and always forces a following sibling onto its own new
    // line, even when the last visible line still has room. Keeping it as
    // trailing inline content of the same box lets it sit right at the end
    // of the visible text instead of wasting that leftover space.
    return (
      <span ref={textRef} className="line-clamp-2">
        {visibleText}
        {isLikelyOverflow && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onExpand(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
            {hiddenCount > 0 ? `+${hiddenCount} more` : 'more'}
          </button>
        )}
      </span>
    );
  }
  return (
    <>
      {/* Capped + scrollable when expanded so revealing a long skills list on
          one card can never grow that card's height — with the sibling
          grid row set to stretch-to-tallest, an uncapped reveal would
          visually inflate every other card in the same row too. */}
      <span className="block max-h-14 overflow-y-auto">{visibleText}</span>
      {isLikelyOverflow && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onCollapse(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
          Show less
        </button>
      )}
    </>
  );
}

export interface LeadCardProps {
  lead: SocialLead;
  accountId: string | null | undefined;
  userId: string | null | undefined;
  paletteIndex: number;
  isDark: boolean;
  isHotlistFeed: boolean;
  feedTimeBasis: FeedTimeBasis;
  isLeadRevealed: boolean;
  globalAskedJobState: GlobalAskedJobState | undefined;
  predictResult: PredictResult | undefined;
  askedRequestedAt: string | undefined;
  askedFulfilledAt: string | null | undefined;
  revealedAt: string | undefined;
  /** The user opened this post's preview before, and when. */
  isViewed?: boolean;
  viewedAt?: string;
  isInlineBreakdownExpanded: boolean;
  isSkillsExpanded: boolean;
  isExpFieldExpanded: boolean;
  isWorkTypeFieldExpanded: boolean;
  isEmpTypeFieldExpanded: boolean;
  isRateFieldExpanded: boolean;
  isVisaFieldExpanded: boolean;
  isLocationFieldExpanded: boolean;
  isLoadingPreview: boolean;
  isProcessingAskAI: boolean;
  onPreview: (lead: SocialLead) => void;
  onAskAI: (lead: SocialLead) => void;
  /** No longer used by the card (AI Submit is always the email); kept for callers. */
  onApply?: (lead: SocialLead) => void;
  /** Tracker: the consultant a career-site Apply is for, so only that card moves. */
  applySubjectId?: string | null;
  onExternalApplied?: () => void;
  onToggleInlineBreakdown: (leadId: string) => void;
  onExpandSkills: (leadId: string) => void;
  onCollapseSkills: (leadId: string) => void;
  onToggleField: (cellKey: string) => void;
  // Detail-panel layout only: renders the exact same card content (skills,
  // chips, badges — nothing reinvented) but with the action bar swapped out
  // for the whole card being clickable, opening that lead in the panel.
  hideActions?: boolean;
  isSelected?: boolean;
  onSelect?: (lead: SocialLead) => void;
  // Bulk selection for AI Match results. Separate from isSelected, which is
  // the detail panel's "which lead is open" state.
  bulkSelectable?: boolean;
  isBulkSelected?: boolean;
  onToggleBulkSelect?: (lead: SocialLead) => void;
  /** 1-based position in the AI Match results. A rank says what a score cannot:
   *  where this one sits against the others in front of you. */
  matchRank?: number;
  /** The card the invite pane is showing. Distinct from bulk selection, and
   *  from onPreview above, which opens the original post. */
  isFocused?: boolean;
  onFocus?: (lead: SocialLead) => void;
  /** Profile pages of publishers who have joined: start a chat on this post. */
  onChat?: (lead: SocialLead) => void;
  isProcessingChat?: boolean;
  /** Collapsible card: a compact view (title, one summary line, icon-only
   *  actions) that expands to the full card. Used on the Tracker. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Tracker: dismiss this match ("Not a match"), an icon in the action bar. */
  onDismiss?: (lead: SocialLead) => void;
  /** Always the compact card (no skills); a click opens the lead (the Feed's
   *  full preview popup) instead of expanding the card. */
  onOpen?: (lead: SocialLead) => void;
}

// Extracted out of PulsePage's renderLeadCards loop and wrapped in memo() so a
// card only re-renders when ITS OWN props change — previously every card in
// the visible list recomputed its full breakdown/palette/badges on every
// PulsePage render, including ones triggered by unrelated interactions
// elsewhere on the page (typing in search, hovering, etc).
export const LeadCard = memo(function LeadCard({
  lead, accountId, userId, paletteIndex, isDark, isHotlistFeed, feedTimeBasis, isLeadRevealed, globalAskedJobState,
  predictResult, askedRequestedAt, askedFulfilledAt, revealedAt, isViewed = false, viewedAt, isSkillsExpanded,
  isExpFieldExpanded, isWorkTypeFieldExpanded, isEmpTypeFieldExpanded, isRateFieldExpanded, isVisaFieldExpanded, isLocationFieldExpanded,
  isLoadingPreview, isProcessingAskAI,
  onPreview, onAskAI, onToggleInlineBreakdown, onExpandSkills, onCollapseSkills, onToggleField,
  hideActions, isSelected, onSelect,
  bulkSelectable, isBulkSelected, onToggleBulkSelect, matchRank, isFocused, onFocus,
  onChat, isProcessingChat, collapsible = false, defaultCollapsed = true, onDismiss, applySubjectId, onExternalApplied, onOpen,
}: LeadCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // The Tracker's collapsed card is the one look for lists: the Feed (onOpen)
  // and the select-to-view lists on Today and the Feed's detail layout.
  const compact = (collapsible && collapsed) || Boolean(onOpen) || Boolean(hideActions);
  const cardPalette = CARD_PALETTE[paletteIndex % CARD_PALETTE.length];
  const cardFillClass = cardPalette.fill;
  // An opened post reads as visited: grey title (like a visited link).
  const titleToneStyle = isViewed && lead.kind !== 'hotlist'
    ? { color: isDark ? '#94A3B8' : '#6B7280' }
    : { color: isDark ? '#FFFFFF' : '#2563EB' };
  const [justCopiedShare, setJustCopiedShare] = useState(false);
  const isAskPending = globalAskedJobState === 'asked';
  const isVerified = globalAskedJobState === 'verified';
  const canAskAI = !isAskPending && !isVerified && Boolean(extractPrimaryEmail(lead.posterEmail));
  const {
    expValue,
    workTypeValue,
    employmentTypeValue,
    rateValue,
    visaValue,
    locationValue,
    skillsValue,
  } = getLeadBreakdownFieldValues(lead, isHotlistFeed);
  const compactCompany = (lead.company || lead.posterName || '').trim();
  const skillsValueClass = isDark ? 'text-[#CBD5E1]' : 'text-slate-700';
  const linkClassName = isDark ? 'text-blue-300' : 'text-blue-600';

  const actionButtonsBar = (
    <div className="mt-auto flex items-stretch divide-x divide-gray-200 border-t border-gray-200 dark:divide-white/10 dark:border-white/10">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void shareLead(lead, accountId, userId).then((copied) => { if (copied) { setJustCopiedShare(true); setTimeout(() => setJustCopiedShare(false), 1500); } }); }}
        title="Share this post"
        className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 bg-gray-50 text-gray-600 transition-colors hover:bg-gray-100 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/5"
      >
        {justCopiedShare ? <Check size={17} strokeWidth={1.75} /> : <Share2 size={17} strokeWidth={1.75} />}
        {!compact && <span className="text-[12px] font-normal">{justCopiedShare ? 'Copied' : 'Share'}</span>}
      </button>
      {onChat && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChat(lead); }}
          disabled={isProcessingChat}
          title="Chat about this post"
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 bg-gray-50 text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/5"
        >
          {isProcessingChat ? <LogoSpinner size={14} /> : <MessageCircle size={16} strokeWidth={1.75} />}
          {!compact && <span className="text-[12px] font-normal">Chat</span>}
        </button>
      )}
      {/* AI Submit is always the email (with the resume when attached), for
          jobs posted on ProfilePush too; the old application form is no
          longer offered from the card. */}
      {isCareerSiteLead(lead) ? (
        <ApplyOnSiteButton lead={lead} variant="bar" compact={compact} subjectId={applySubjectId} onApplied={onExternalApplied} />
      ) : isAskPending || isVerified ? (
        <span
          title={isVerified ? 'Verified' : (isHotlistFeed ? 'Requested' : 'Submitted')}
          className={`inline-flex h-9 flex-1 items-center justify-center ${isVerified ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'}`}
        >
          {isVerified ? <BadgeCheck size={17} strokeWidth={1.75} /> : <Check size={17} strokeWidth={1.75} />}
        </span>
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAskAI(lead); }}
          disabled={!canAskAI || isProcessingAskAI}
          title={!lead.posterEmail ? 'No email' : (isHotlistFeed ? 'AI Request: ask for resume, rate and availability' : 'AI Submit')}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 bg-blue-50 text-blue-600 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
        >
          {isProcessingAskAI ? <LogoSpinner size={14} /> : (
            <>
              {/* A consultant gets a resume request (document icon; the video
                  screening is an optional add-on in the draft); a job gets
                  AI Submit, the email to its recruiter (mail icon), wherever
                  the job was posted. */}
              {isHotlistFeed ? <FileText size={15} strokeWidth={1.75} /> : <Mail size={15} strokeWidth={1.75} />}
              {!compact && <span className="text-[12px] font-normal">{isHotlistFeed ? 'AI Request' : 'AI Submit'}</span>}
            </>
          )}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss(lead); }}
          title="Not a match (won't be suggested again)"
          aria-label="Not a match"
          className="inline-flex h-9 w-10 shrink-0 items-center justify-center bg-red-50 text-red-600 transition-colors hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );

  // Collapsed card: the same actions as plain icons beside "Posted …", with no
  // bar, dividers or fills, so a column of cards isn't a grid of lines.
  const iconButtonClass = 'inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40';
  const compactActions = (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void shareLead(lead, accountId, userId).then((copied) => { if (copied) { setJustCopiedShare(true); setTimeout(() => setJustCopiedShare(false), 1500); } }); }}
        title={justCopiedShare ? 'Link copied' : 'Share this post'}
        aria-label="Share"
        className={`${iconButtonClass} text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5`}
      >
        {justCopiedShare ? <Check size={16} strokeWidth={1.75} /> : <Share2 size={16} strokeWidth={1.75} />}
      </button>
      {isCareerSiteLead(lead) ? (
        <ApplyOnSiteButton lead={lead} variant="icon" subjectId={applySubjectId} onApplied={onExternalApplied} />
      ) : isAskPending || isVerified ? (
        <span title={isVerified ? 'Verified' : (isHotlistFeed ? 'Requested' : 'Submitted')} className={`${iconButtonClass} ${isVerified ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'}`}>
          {isVerified ? <BadgeCheck size={16} strokeWidth={1.75} /> : <Check size={16} strokeWidth={1.75} />}
        </span>
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAskAI(lead); }}
          disabled={!canAskAI || isProcessingAskAI}
          title={!lead.posterEmail ? 'No email' : (isHotlistFeed ? 'AI Request: ask for resume, rate and availability' : 'AI Submit')}
          aria-label={isHotlistFeed ? 'AI Request' : 'AI Submit'}
          className={`${iconButtonClass} text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10`}
        >
          {isProcessingAskAI ? <LogoSpinner size={14} /> : isHotlistFeed ? <FileText size={16} strokeWidth={1.75} /> : <Mail size={16} strokeWidth={1.75} />}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss(lead); }}
          title="Not a match (won't be suggested again)"
          aria-label="Not a match"
          className={`${iconButtonClass} text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10`}
        >
          <X size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  );

  return (
    <div
      role={hideActions ? 'button' : undefined}
      tabIndex={hideActions ? 0 : undefined}
      onClick={hideActions ? () => onSelect?.(lead) : onOpen ? (event) => {
        if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
        onOpen(lead);
      } : collapsible ? (event) => {
        // Collapsible: a click on the card itself expands or collapses it;
        // the title, buttons, links and the tick keep their own actions.
        if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
        setCollapsed((value) => !value);
      } : undefined}
      aria-expanded={collapsible && !onOpen ? !compact : undefined}
      title={onOpen ? 'Click to open' : collapsible ? (compact ? 'Click to see the full card' : 'Click to collapse') : undefined}
      onKeyDown={hideActions ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(lead); } } : undefined}
      onClickCapture={!hideActions && onFocus ? (event) => {
        // Ignore clicks on anything that already acts: buttons, links, the
        // tick. Focusing the card is the fallback, not an override.
        if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
        onFocus(lead);
      } : undefined}
      className={`relative flex ${hideActions ? 'h-auto' : 'h-full'} min-w-0 flex-col overflow-hidden rounded-lg border ${
        isSelected ? 'border-blue-400 ring-1 ring-blue-200'
          : isFocused ? 'border-indigo-400 ring-1 ring-indigo-200'
          : compact ? 'border-transparent shadow-[0_1px_3px_rgba(15,23,42,0.08)] dark:border-white/5'
          : 'border-[#dfdad2] dark:border-white/10'
      } ${cardFillClass} ${hideActions || onFocus || collapsible || onOpen ? 'cursor-pointer' : ''}`}
    >
      {!compact && <LeadKindPill kind={lead.kind} variant="banner" onProfilePush={lead.postSource === 'user_post'} />}
      {matchRank != null && (
        // Top right, beside the kind icon rather than under it: below, it
        // would land on the second line of a wrapping title. The header
        // already reserves this strip with pr-14.
        <span
          className={`absolute ${lead.postSource === 'user_post' ? 'right-11' : 'right-7'} top-0 z-10 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-bl-lg bg-gradient-to-br from-indigo-500 to-violet-600 px-1.5 text-[11px] font-bold tabular-nums text-white shadow-sm`}
          title={`Rank ${matchRank} in this run`}
        >
          {matchRank}
        </span>
      )}
      <div className="min-w-0 flex-1 px-3 pt-2.5 pb-2">
      <div className={bulkSelectable ? 'flex items-start gap-2' : undefined}>
        {bulkSelectable && (
          // Fixed 20px square, aligned to the title line. It used to stretch to
          // the height of the text beside it, so no two cards agreed on its
          // size and on a short card it was a thin sliver.
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleBulkSelect?.(lead); }}
            aria-pressed={Boolean(isBulkSelected)}
            title={isBulkSelected ? 'Selected for bulk send' : 'Select for bulk send'}
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
              isBulkSelected
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-400 bg-white text-transparent hover:border-blue-500 dark:border-white/30 dark:bg-white/5'
            }`}
          >
            <Check size={13} strokeWidth={3} />
          </button>
        )}
        <div className="min-w-0 flex-1 pr-14">
          {hideActions || onOpen ? (
            // Detail layout: the whole card selects the lead and the post opens
            // in the pane beside it, so the title stays plain text there.
            <p className="text-[13px] font-semibold leading-snug" style={titleToneStyle}>{lead.title || (isHotlistFeed ? 'Available Consultant' : 'Job Opportunity')}</p>
          ) : (
            // The title is the way to open the original post; it replaced the
            // separate Preview button and calls the same handler, so the
            // one-time preview charge and the modal behave exactly as before.
            lead.kind === 'hotlist' ? (
              // A consultant's original post is a bulk hotlist of ten people;
              // the card's own parsed fields are the useful view.
              <p className="text-[13px] font-semibold leading-snug" style={titleToneStyle}>
                {lead.title || 'Available Consultant'}
              </p>
            ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPreview(lead); }}
              disabled={isLoadingPreview}
              title={isViewed ? 'Open post (viewed)' : 'Open post'}
              className="text-left text-[13px] font-semibold leading-snug underline-offset-2 hover:underline disabled:cursor-wait"
              style={titleToneStyle}
            >
              {lead.title || (isHotlistFeed ? 'Available Consultant' : 'Job Opportunity')}
              {/* Says the title opens the post; grey once it has been opened. */}
              {isLoadingPreview
                ? <span className="ml-1.5 inline-block align-middle"><LogoSpinner size={11} /></span>
                : <Eye size={12} strokeWidth={2.25} className={`ml-1 inline-block align-[-1px] ${isViewed ? 'text-gray-500 dark:text-slate-400' : 'text-blue-400 dark:text-slate-400'}`} />}
            </button>
            )
          )}
          {/* Row 2: the AI's verdict, on its own line. It shared a wrapping
              flex row with the score and the badges, so on a narrow card the
              sentence broke around them and read as fragments. The score
              itself is gone — the rank beside the title already says where
              this one stands, and two numbers for one idea is one too many. */}
          {lead.aiMatchReason && (
            <p className="mt-1 flex min-w-0 items-start gap-1 text-[11px] leading-snug">
              <Sparkles size={10} strokeWidth={2.5} className="mt-0.5 shrink-0 text-indigo-500 dark:text-indigo-300" />
              <span className="min-w-0 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text font-medium text-transparent dark:from-blue-300 dark:via-indigo-300 dark:to-violet-300">
                {lead.aiMatchReason}
              </span>
            </p>
          )}
          {(predictResult || isAskPending || isVerified || (isViewed && lead.kind !== 'hotlist') || isLeadRevealed) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
              {predictResult && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${predictToneClass(predictResult.score, isDark)}`}>
                  <Gauge size={9} strokeWidth={2.5} />
                  {isHotlistFeed ? 'Match' : 'Predicted'} {predictResult.score}%
                </span>
              )}
              {(isAskPending || isVerified) && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isVerified ? (isDark ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700') : (isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700')}`}>
                  {isVerified ? <BadgeCheck size={9} strokeWidth={2.5} /> : <Check size={9} strokeWidth={2.5} />}
                  {(() => {
                    const stampIso = isVerified ? (askedFulfilledAt ?? askedRequestedAt) : askedRequestedAt;
                    const label = isVerified ? 'Verified' : (isHotlistFeed ? 'Asked' : 'Submitted');
                    return stampIso ? `${label} ${formatAgoCompact(stampIso)}` : label;
                  })()}
                </span>
              )}
              {isViewed && lead.kind !== 'hotlist' && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-white/15 bg-white/5 text-slate-400' : 'border-gray-200 bg-gray-100 text-gray-500'}`}>
                  <Eye size={9} strokeWidth={2.5} />
                  Viewed{viewedAt ? ` ${formatAgoCompact(viewedAt)}` : ''}
                </span>
              )}
              {isLeadRevealed && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-white/15 bg-white/5 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                  <AtSign size={9} strokeWidth={2.5} />
                  Revealed{revealedAt ? ` ${formatAgoCompact(revealedAt)}` : ''}
                </span>
              )}
            </div>
          )}
          {lead.aiMatchRuleNote && (
            // The score was capped by a stated fact, not by the model's read of
            // the text, so it is called out rather than folded into the reason.
            <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              <Shield size={9} strokeWidth={2.5} />
              {lead.aiMatchRuleNote}
            </p>
          )}
        </div>
      </div>
      {(() => {
        const chipFields = [
          { key: 'exp', value: expValue, isExpanded: isExpFieldExpanded, icon: GraduationCap, title: 'Experience' },
          { key: 'workType', value: workTypeValue, isExpanded: isWorkTypeFieldExpanded, icon: Laptop, title: 'Work type' },
          { key: 'empType', value: employmentTypeValue, isExpanded: isEmpTypeFieldExpanded, icon: Briefcase, title: 'Employment type' },
          { key: 'rate', value: rateValue, isExpanded: isRateFieldExpanded, icon: DollarSign, title: 'Rate' },
          { key: 'visa', value: visaValue, isExpanded: isVisaFieldExpanded, icon: Shield, title: 'Visa' },
          { key: 'location', value: locationValue, isExpanded: isLocationFieldExpanded, icon: MapPin, title: 'Location' },
        ].filter((field) => field.value !== '-');
        // Collapsed: the field pills only; skills wait for the full card.
        if (chipFields.length === 0 && (compact || skillsValue === '-')) return null;
        return (
        <div className={`min-w-0 rounded-md text-left bg-transparent ${compact ? 'mt-2' : 'mt-1.5 px-2.5 py-2'}`}>
          {(() => {
            if (chipFields.length === 0) return null;
            return (
              <div className="flex flex-wrap items-center gap-1">
                {chipFields.map((field) => (
                  <span
                    key={field.key}
                    title={field.title}
                    className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] leading-tight ${compact ? (isDark ? 'bg-white/5 text-[#CBD5E1]' : 'bg-slate-100 text-slate-700') : `border ${isDark ? 'border-white/10 bg-white/5 text-[#CBD5E1]' : 'border-gray-200 bg-gray-50 text-slate-700'}`}`}
                  >
                    <field.icon size={10} className={isDark ? 'shrink-0 text-[#94A3B8]' : 'shrink-0 text-gray-400'} />
                    <ClampedField value={field.value} linkClassName={linkClassName} isExpanded={field.isExpanded} onToggle={() => onToggleField(`${lead.id}:${field.key}`)} />
                  </span>
                ))}
              </div>
            );
          })()}
          {!compact && skillsValue !== '-' && (
            <button
              type="button"
              onClick={() => onToggleInlineBreakdown(lead.id)}
              title="Skills"
              className="mt-2 w-full rounded-md py-1.5 text-left focus:outline-none bg-transparent"
            >
              <div className={`text-[10px] leading-tight break-words ${skillsValueClass}`}>
                <ClampedSkills
                  skillsValue={skillsValue}
                  itemCap={8}
                  linkClassName={linkClassName}
                  isExpanded={isSkillsExpanded}
                  onExpand={() => onExpandSkills(lead.id)}
                  onCollapse={() => onCollapseSkills(lead.id)}
                />
              </div>
            </button>
          )}
        </div>
        );
      })()}
      {/* Collapsed: the vendor company and when it was posted; the full poster line comes back with the full card. */}
      {compact && (
        <div className={`flex items-center gap-1 ${hideActions ? 'mt-2' : 'mt-1'}`}>
          <p className="flex min-w-0 flex-1 items-center gap-1 truncate text-[11px] text-[#94A3B8]">
            {compactCompany && <span className="max-w-[55%] shrink-0 truncate font-medium text-slate-600 dark:text-slate-300">{compactCompany}</span>}
            {isCareerSiteLead(lead) && <CareerSitePill />}
            {compactCompany && !isCareerSiteLead(lead) && <span>·</span>}
            <span className="min-w-0 truncate">{feedTimeBasis === 'created' ? 'Added ' : compactCompany ? '' : 'Posted '}{formatAgo(feedTimeBasis === 'created' ? lead.createdAt : lead.postedAt)}</span>
          </p>
          {!hideActions && compactActions}
        </div>
      )}
      {!compact && (
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-[#94A3B8]">
        {isCareerSiteLead(lead) ? (
          // The firm itself, not a person with a ProfilePush profile page.
          <span className="inline-flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
            <LeadAvatar avatarUrl={lead.avatarUrl} name={lead.posterName} size={14} />
            {lead.posterName}
            <CareerSitePill />
          </span>
        ) : (
          <PosterProfileLink kind={lead.kind === 'hotlist' ? 'hotlist' : 'job'} leadId={lead.id}>
            <LeadAvatar avatarUrl={lead.avatarUrl} name={lead.posterName} size={14} />
            {lead.posterName}
          </PosterProfileLink>
        )}
        {lead.posterEmail && (
          <>
            <span className="whitespace-nowrap">•</span>
            <SubscribeTextLink
              kind={lead.kind === 'hotlist' ? 'hotlist' : 'job'}
              leadId={lead.id}
              posterEmail={lead.posterEmail}
            />
          </>
        )}
        <span className="whitespace-nowrap">•</span>
        <span className="whitespace-nowrap">{feedTimeBasis === 'created' ? 'Added ' : ''}{formatAgo(feedTimeBasis === 'created' ? lead.createdAt : lead.postedAt)}</span>
      </div>
      )}
      </div>
      {!hideActions && !compact && actionButtonsBar}
    </div>
  );
});

export function formatAgo(dateIso: string) {
  const ts = new Date(dateIso).getTime();
  if (Number.isNaN(ts)) return 'just now';
  const diffMs = Date.now() - ts;
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} mins ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hrs ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

export function formatAgoCompact(dateIso: string) {
  const ts = new Date(dateIso).getTime();
  if (Number.isNaN(ts)) return 'now';
  const diffMs = Date.now() - ts;
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Loading a lead by id into what the card draws: the same mapping the Feed
// uses for posts it fetches by id, shared so every page builds identical cards.
export type SocialJobRow = {
  id: string;
  platform: string;
  posted_by_name: string;
  poster_email: string;
  poster_phone: string;
  created_at: string;
  posted_at: string | null;
  job_title: string;
  company_name: string;
  location: string;
  post_content: string;
  extracted_role_normalized: string | null;
  employment_type: string;
  seniority_level: string;
  salary_range: string;
  extracted_skills: string[] | null;
  extracted_experience_years: number | null;
  extracted_visa_types: string[] | null;
  extracted_hourly_rate_min: number | null;
  extracted_hourly_rate_max: number | null;
  role_title?: string | null;
  core_skills?: string[] | null;
  years_experience?: number | null;
  visa_types?: string[] | null;
  employment_type_status?: string | null;
  work_type?: string | null;
  locations?: string[] | null;
  hourly_rate_min?: number | null;
  hourly_rate_max?: number | null;
  relocation_required?: boolean | null;
  post_source?: string | null;
  created_by_account_id?: string | null;
  created_by_user_id?: string | null;
  author_display_name?: string | null;
  avatar_url?: string | null;
  post_url?: string | null;
};

// AI-populated fields (radar_match_results job_details, extracted_* columns)
// are occasionally malformed — a nested object instead of a plain number —
// which previously rendered as literal "[object Object]" text once
// string-interpolated. Every experienceYears/hourlyRate mapping site below
// routes raw values through this instead of trusting the declared type.
export function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed);
  }
  return null;
}

export type HotlistLeadRow = {
  id: string; platform: string; bench_sales_recruiter_name: string | null; bench_sales_recruiter_email: string | null;
  bench_sales_recruiter_phone: string | null; bench_sales_recruiter_avatar_url: string | null; bench_sales_company_name: string | null; role_title: string | null;
  core_skills: string[] | null; years_experience: number | null; visa_type: string | null; employment_type: string | null; work_type: string | null;
  locations: string[] | null; hourly_rate_min: number | null; hourly_rate_max: number | null; raw_post_content: string | null;
  posted_at: string | null; created_at: string; post_source: string | null; created_by_account_id: string | null; created_by_user_id: string | null;
};

export const JOB_LEAD_COLUMNS = 'id, platform, posted_by_name, poster_email, poster_phone, avatar_url, created_at, posted_at, job_title, company_name, location, post_content, extracted_role_normalized, employment_type, seniority_level, salary_range, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max, post_source, post_url, created_by_account_id, created_by_user_id';
export const HOTLIST_LEAD_COLUMNS = 'id, platform, bench_sales_recruiter_name, bench_sales_recruiter_email, bench_sales_recruiter_phone, bench_sales_recruiter_avatar_url, bench_sales_company_name, role_title, core_skills, years_experience, visa_type, employment_type, work_type, locations, hourly_rate_min, hourly_rate_max, raw_post_content, posted_at, created_at, post_source, created_by_account_id, created_by_user_id';

export function jobRowToLead(row: SocialJobRow): SocialLead {
  const eventTime = row.posted_at || row.created_at;
  return {

    id: row.id,
    title: row.job_title?.trim() || row.extracted_role_normalized?.trim() || row.post_content?.trim().split('\n')[0]?.slice(0, 80) || 'Untitled Job',
    roleTitle: row.job_title?.trim() || row.extracted_role_normalized?.trim() || '',
    location: row.location?.trim() || 'Location not specified',
    company: row.company_name?.trim() || '',
    posterName: row.posted_by_name?.trim() || 'Vendor contact',
    posterEmail: row.poster_email?.trim() || '',
    posterPhone: row.poster_phone?.trim() || '',
    postedAt: eventTime,
    createdAt: row.created_at,
    postedAgo: formatAgo(eventTime),
    platform: row.platform,
    matchScore: null,
    profileId: null,
    scoreBreakdown: null,
    snippet: row.post_content?.trim().slice(0, 150) || '',
    employmentType: row.employment_type?.trim() || '',
    seniority: row.seniority_level?.trim() || '',
    salaryRange: row.salary_range?.trim() || '',
    skills: Array.isArray(row.extracted_skills) ? row.extracted_skills : [],
    experienceYears: safeNumber(row.extracted_experience_years),
    visaTypes: Array.isArray(row.extracted_visa_types) ? row.extracted_visa_types : [],
    hourlyRate: (safeNumber(row.extracted_hourly_rate_min) != null || safeNumber(row.extracted_hourly_rate_max) != null)
      ? `$${safeNumber(row.extracted_hourly_rate_min) ?? '?'}–$${safeNumber(row.extracted_hourly_rate_max) ?? '?'}/hr`
      : '',
    workType: '',
    postSource: normalizePostSource(row.post_source),
    applyUrl: row.post_source === 'career_site' ? row.post_url ?? null : null,
    authorAccountId: row.created_by_account_id ?? null,
    authorUserId: row.created_by_user_id ?? null,
    authorName: null,
    avatarUrl: row.avatar_url?.trim() || null,
    kind: 'job',
  };
}

export function hotlistRowToLead(row: HotlistLeadRow): SocialLead {
  const eventTime = row.posted_at || row.created_at;
  return {

    id: row.id,
    title: consultantTitle(row.role_title),
    roleTitle: consultantTitle(row.role_title, ''),
    location: Array.isArray(row.locations) && row.locations.length > 0 ? row.locations.join(', ') : 'Location not specified',
    company: row.bench_sales_company_name?.trim() || '',
    posterName: row.bench_sales_recruiter_name?.trim() || 'Bench Sales Recruiter',
    posterEmail: row.bench_sales_recruiter_email?.trim() || '',
    posterPhone: row.bench_sales_recruiter_phone?.trim() || '',
    postedAt: eventTime,
    createdAt: row.created_at,
    postedAgo: formatAgo(eventTime),
    platform: row.platform,
    matchScore: null,
    profileId: null,
    scoreBreakdown: null,
    snippet: row.raw_post_content?.trim().slice(0, 150) || '',
    employmentType: row.employment_type?.trim() || '',
    seniority: '',
    salaryRange: '',
    skills: Array.isArray(row.core_skills) ? row.core_skills : [],
    experienceYears: safeNumber(row.years_experience),
    visaTypes: row.visa_type ? [row.visa_type] : [],
    hourlyRate: (safeNumber(row.hourly_rate_min) != null || safeNumber(row.hourly_rate_max) != null)
      ? `$${safeNumber(row.hourly_rate_min) ?? '?'}–$${safeNumber(row.hourly_rate_max) ?? '?'}/hr`
      : '',
    workType: row.work_type?.trim() || '',
    postSource: normalizePostSource(row.post_source),
    authorAccountId: row.created_by_account_id ?? null,
    authorUserId: row.created_by_user_id ?? null,
    authorName: null,
    avatarUrl: row.bench_sales_recruiter_avatar_url?.trim() || null,
    kind: 'hotlist',
  };
}

export async function loadLeadsByIds(kind: 'job' | 'hotlist', ids: string[]): Promise<Record<string, SocialLead>> {
  const leads: Record<string, SocialLead> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (kind === 'job') {
      const { data } = await supabase.from('social_jobs').select(JOB_LEAD_COLUMNS).in('id', chunk);
      for (const row of (data ?? []) as unknown as SocialJobRow[]) leads[row.id] = jobRowToLead(row);
    } else {
      const { data } = await supabase.from('social_hotlist').select(HOTLIST_LEAD_COLUMNS).in('id', chunk);
      for (const row of (data ?? []) as unknown as HotlistLeadRow[]) leads[row.id] = hotlistRowToLead(row);
    }
  }
  return leads;
}

// The details a job post leaves out, which an AI Submit email asks about.
export function formatBreakdownFieldName(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/\bmatch\b/gi, '')
    .replace(/\bemployment\b/gi, 'Emp')
    .replace(/\bexperience\b/gi, 'Exp')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getMissingJobDetails(lead: SocialLead): string[] {
  const breakdownItems = orderPulseBreakdownItems(buildScoreBreakdownDisplayItems(
    lead.scoreBreakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
    undefined,
    {
      employment_type: lead.employmentType || null,
      work_type: null,
    },
  ).filter((item) => !isRoleLikeBreakdownKey(item.key)));

  return Array.from(new Set(breakdownItems
    .filter((item) => {
      const value = (item.detail?.job_value ?? '').trim().toLowerCase();
      return !value || value === '-' || value === 'unknown' || value === 'not specified' || value === 'n/a';
    })
    .map((item) => formatBreakdownFieldName(item.key))));
}

// Post text as shown in previews and the detail panel: any email address in
// it is hidden. The way to a poster's email is AI Submit / AI Request, which
// writes the email and shows who it goes to.
export const EMAIL_IN_TEXT = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export function hideEmails(text: string | null | undefined): string {
  return (text ?? '').replace(EMAIL_IN_TEXT, '[email hidden · use AI Submit]');
}

// A post's full text, for the preview popup and the detail panel.
export async function fetchLeadPostContent(leadId: string, kind: 'job' | 'hotlist'): Promise<string> {
  const previewIsHotlist = kind === 'hotlist';
  const { data, error } = await supabase
    .from(previewIsHotlist ? 'social_hotlist' : 'social_jobs')
    .select(previewIsHotlist ? 'raw_post_content' : 'post_content')
    .eq('id', leadId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message || 'Could not load the post');

  const content = String((previewIsHotlist ? (data as { raw_post_content: string | null }).raw_post_content : (data as { post_content: string | null }).post_content) ?? '').trim();
  return content || 'No post content available.';
}

// The post preview popup (the card's title / Preview), with emails hidden.
export function PostPreviewModal({ title, content, onClose }: { title: string; content: string; onClose: () => void }) {
  return (
<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-content-preview-title"
      onClick={(e) => e.stopPropagation()}
      className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-gray-200 bg-white shadow-xl"
    >
      <div className="flex items-start gap-2.5 border-b border-gray-100 p-4">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-500">
          <Eye size={16} />
        </span>
        <h2 id="post-content-preview-title" className="min-w-0 flex-1 truncate text-[15px] font-semibold text-gray-900">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          aria-label="Close post preview"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-700">{hideEmails(content)}</p>
      </div>
    </div>
  </div>
  );
}

// A list card's full view: the whole card (skills, poster, actions) and the
// post itself. A sheet from the bottom on phones, a dialog on desktop.
export function LeadPreviewModal({ cardProps, content, loading, onClose }: {
  cardProps: LeadCardProps;
  content: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);
  const isHotlist = cardProps.lead.kind === 'hotlist';
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={cardProps.lead.title || (isHotlist ? 'Available Consultant' : 'Job Opportunity')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-[#f3f2ee] shadow-xl sm:max-h-[85vh] sm:max-w-2xl sm:rounded-lg dark:bg-[#1B1D21]"
      >
        <div className="relative flex items-center justify-between px-4 pt-3 pb-2">
          <span className="mx-auto h-1 w-10 rounded-full bg-gray-300 sm:hidden dark:bg-white/20" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-black/5 sm:static sm:ml-auto dark:text-gray-300 dark:hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4 sm:px-4">
          <LeadCard {...cardProps} onOpen={undefined} collapsible={false} hideActions={false} onPreview={() => {}} />
          {!isHotlist && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-[#20242a]">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Job description</p>
              {loading && content == null ? (
                <div className="flex justify-center py-6"><LogoSpinner size={16} /></div>
              ) : (
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-700 dark:text-slate-300">{hideEmails(content || 'No post content available.')}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default LeadCard;
