import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Clock3, Eye, EyeOff, ExternalLink, FileText, MessageSquare, Paperclip, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, Video, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import BulkAiSubmitBar from '../components/BulkAiSubmitBar';
import ScreeningSubmissionModal from '../components/ScreeningSubmissionModal';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import LeadCard, { fetchLeadPostContent, loadLeadsByIds, PostPreviewModal, type SocialLead } from '../components/LeadCard';
import { AiSubmitDialog, useAiSubmit } from '../components/AiSubmit';
import SubmitApplicationModal from '../components/SubmitApplicationModal';
import PostFormModal, { type UserPost } from '../components/posts/PostFormModal';
import { deleteUserPost, loadUserPost, setUserPostStatus } from '../lib/user-posts';
import InsufficientCreditsModal from '../components/InsufficientCreditsModal';
import { supabase } from '../lib/supabase';
import { consultantTitle } from '../lib/consultant-title';
import { trackEvent } from '../lib/track';
import { enableWebPush } from '../lib/onesignal';
import { Capacitor } from '@capacitor/core';
import { loadTrackerSends, SEND_TONE_CLASSES, type TrackerSend } from '../lib/tracker-sends';

// Tracker (named Board in code, at /board): a column per consultant (bench sales) or per requirement
// (vendors), each with two tabs, New matches and Submitted (Requested for vendors),
// and its own date range. Every match starts in New; sending an AI Submit
// moves it to Submitted on the server (replies stay there, with a Reply
// button). A column's ↻ rematches that post for fresh matches right here,
// and its cards can be ticked and AI Submitted in bulk. Not a match
// takes a card off the board. New matches arrive live (realtime on
// pipeline_cards) and the browser tab title counts them.

type Stage = 'new' | 'submitted' | 'replied' | 'interview' | 'closed';

type Subject = { subject_id: string; title: string; detail: string | null; created_at: string; new_count: number; active_count: number; match_text: string | null };

type Card = {
  subject_id: string;
  id: string;
  stage: Stage;
  similarity: number | null;
  conversation_id: string | null;
  closed_reason: string | null;
  created_at: string;
  stage_changed_at: string;
  lead_kind: 'job' | 'hotlist';
  lead_id: string;
  title: string;
  location: string | null;
  rate_min: number | null;
  rate_max: number | null;
  posted_at: string;
  detail: string | null;
  has_email: boolean;
  added_at: string;
};

// The 'submitted' stage is an AI Request for vendors, so it reads "Requested".
const stagesFor = (isVendor: boolean): Array<{ id: Stage; label: string }> => [
  { id: 'new', label: 'New' },
  { id: 'submitted', label: isVendor ? 'Requested' : 'Submitted' },
];

// Which matches a column shows. New shows every open match by default (newest
// first, live arrivals on top) so a column never looks empty; Submitted shows
// the last 7 days. Each column can pick its own range from a short pill
// (all, 2h, 1d, 7d, 30d, custom), like the range pill on other pages.
type RangePreset = 'all' | '2h' | '1d' | '7d' | '30d' | 'custom';
type Range = { preset: RangePreset; from?: string; to?: string };

const RANGE_OPTIONS: Array<{ id: RangePreset; label: string }> = [
  { id: 'all', label: 'All open' },
  { id: '2h', label: 'Last 2 hours' },
  { id: '1d', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'custom', label: 'Custom dates' },
];

const defaultRange = (stage: Stage): Range => ({ preset: stage === 'new' ? 'all' : '7d' });

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysFrom(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function localDay(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function rangeBounds(range: Range): { since: string; until: string | null } {
  const today = startOfToday();
  switch (range.preset) {
    case 'all': return { since: '1970-01-01T00:00:00.000Z', until: null };
    case '2h': return { since: new Date(Date.now() - 2 * 3600_000).toISOString(), until: null };
    case '1d': return { since: new Date(Date.now() - 24 * 3600_000).toISOString(), until: null };
    case '7d': return { since: new Date(Date.now() - 7 * 24 * 3600_000).toISOString(), until: null };
    case '30d': return { since: new Date(Date.now() - 30 * 24 * 3600_000).toISOString(), until: null };
    case 'custom': {
      const from = range.from ? localDay(range.from) : today;
      const to = range.to ? daysFrom(localDay(range.to), 1) : null;
      return { since: from.toISOString(), until: to ? to.toISOString() : null };
    }
  }
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Each column has its own colour, by position, alternating cool and warm so
// two similar colours (blue / sky, emerald / teal, amber / orange) never sit
// side by side, including where the cycle wraps. The header takes the deeper
// (200) shade and the column body a light tint of the same colour; cards stay as
// they are on top.
const COLUMN_TINTS: Array<{ header: string; body: string }> = [
  { header: 'border-transparent bg-blue-200 dark:bg-blue-500/30', body: 'bg-blue-50/70 dark:bg-blue-500/[0.06]' },
  { header: 'border-transparent bg-amber-200 dark:bg-amber-500/30', body: 'bg-amber-50/70 dark:bg-amber-500/[0.06]' },
  { header: 'border-transparent bg-emerald-200 dark:bg-emerald-500/30', body: 'bg-emerald-50/70 dark:bg-emerald-500/[0.06]' },
  { header: 'border-transparent bg-rose-200 dark:bg-rose-500/30', body: 'bg-rose-50/70 dark:bg-rose-500/[0.06]' },
  { header: 'border-transparent bg-violet-200 dark:bg-violet-500/30', body: 'bg-violet-50/70 dark:bg-violet-500/[0.06]' },
  { header: 'border-transparent bg-orange-200 dark:bg-orange-500/30', body: 'bg-orange-50/70 dark:bg-orange-500/[0.06]' },
];

type ColumnView = { stage: Stage; range: Range };
const DEFAULT_VIEW: ColumnView = { stage: 'new', range: { preset: 'all' } };
const isDefaultView = (v: ColumnView) => v.stage === 'new' && v.range.preset === 'all';

export default function BoardPage() {
  const navigate = useNavigate();
  const { account, user } = useAuth();
  const { isDark } = useTheme();
  const isVendor = account?.active_persona === 'vendor';
  // Bench sales: a column per consultant (a hotlist row) holding requirements.
  // Vendors: a column per requirement holding consultants.
  const subjectKind: 'hotlist' | 'job' = isVendor ? 'job' : 'hotlist';
  const submitLabel = isVendor ? 'AI Request' : 'AI Submit';
  const STAGES = stagesFor(isVendor);
  const subjectTitle = (s: Subject) => (subjectKind === 'hotlist' ? consultantTitle(s.title) : s.title);

  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [counts, setCounts] = useState<Record<string, Partial<Record<Stage, number>>>>({});
  // Every column on its default view (New, last 2 hours) comes from one load;
  // a column switched to another stage or range loads on its own.
  const [cards, setCards] = useState<Card[] | null>(null);
  const [views, setViews] = useState<Record<string, ColumnView>>({});
  const [columnCards, setColumnCards] = useState<Record<string, Card[]>>({});
  const [error, setError] = useState('');
  const [dragId, setDragId] = useState('');
  const [overTarget, setOverTarget] = useState('');
  const [liveNew, setLiveNew] = useState(0);
  // Green ring on new arrivals: cards added while the page is open, plus any
  // added since this person's last Tracker visit (mark_tracker_visit). No label.
  const [arrivedIds, setArrivedIds] = useState<Set<string>>(new Set());
  const [unseenSince, setUnseenSince] = useState<number | null>(null);
  // Bulk AI Submit works on one column at a time (an invite's screening link
  // hangs off that column's requirement).
  const [selected, setSelected] = useState<{ subjectId: string; ids: Set<string> }>({ subjectId: '', ids: new Set() });
  const [rematching, setRematching] = useState('');
  // Bench sales: each consultant's resume (Tracker column header), sent as an
  // attachment with AI Submit and previewed beside the column.
  const [resumes, setResumes] = useState<Record<string, { url: string; name: string }>>({});
  const [uploadingResumeFor, setUploadingResumeFor] = useState('');
  const resumeInputRef = useRef<HTMLInputElement | null>(null);
  const resumeTargetRef = useRef('');
  const [hiddenPreviews, setHiddenPreviews] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('tracker_resume_preview_hidden') ?? '[]') as string[]); } catch { return new Set(); }
  });
  const aiResumeRef = useRef<{ url: string; name: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  // Browser notifications for new matches: shown until they're on (or the
  // person dismisses this), since the one-time ask at sign-in is easy to miss.
  const [pushState, setPushState] = useState<NotificationPermission | 'unsupported'>(() => (
    typeof window !== 'undefined' && 'Notification' in window && !Capacitor.isNativePlatform() ? Notification.permission : 'unsupported'
  ));
  const [pushPromptHidden, setPushPromptHidden] = useState(() => {
    try { return localStorage.getItem('tracker_push_prompt_hidden') === '1'; } catch { return false; }
  });
  // Ten cards per column at a time, then Load more. Keyed by column (and the
  // Other column as 'other'); reset when a column changes stage or range.
  const PAGE_SIZE = 10;
  const [shownCount, setShownCount] = useState<Record<string, number>>({});
  const shownFor = (key: string) => shownCount[key] ?? PAGE_SIZE;
  const loadMoreButton = (key: string, total: number) => total > shownFor(key) && (
    <button
      type="button"
      onClick={() => setShownCount((prev) => ({ ...prev, [key]: shownFor(key) + PAGE_SIZE }))}
      className="mx-auto mt-1 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-[#171a1f] dark:text-slate-200"
    >
      Load more ({total - shownFor(key)})
    </button>
  );
  const [rangeMenuFor, setRangeMenuFor] = useState('');
  // Column header menu: edit / view / close / delete the post the column is for.
  const [postMenuFor, setPostMenuFor] = useState('');
  const [editingPost, setEditingPost] = useState<UserPost | null>(null);
  // Applications, resume requests and chats (what the old Submissions /
  // Invites page listed). Shown on the card of the lead they went to, or in
  // the Other column when that lead is not on the board.
  const [sends, setSends] = useState<TrackerSend[]>([]);
  const [leadsOnBoard, setLeadsOnBoard] = useState<Set<string>>(new Set());
  const [otherTab, setOtherTab] = useState<'open' | 'closed'>('open');
  const [watchSend, setWatchSend] = useState<TrackerSend | null>(null);
  // Full lead rows for the shared Feed card, loaded by id as cards appear.
  const [leadsById, setLeadsById] = useState<Record<string, SocialLead>>({});
  const requestedLeadIds = useRef<Set<string>>(new Set());
  // The Feed card's expandable sections (skills, breakdown, fields).
  const [expandedBreakdown, setExpandedBreakdown] = useState<Set<string>>(new Set());
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  const viewsRef = useRef<Record<string, ColumnView>>({});
  viewsRef.current = views;

  const loadSubjects = useCallback(async () => {
    const [subj, cnt] = await Promise.all([
      supabase.rpc('get_pipeline_subjects' as never, { p_kind: subjectKind } as never),
      supabase.rpc('get_pipeline_column_counts' as never, {
        p_kind: subjectKind, p_new_since: rangeBounds({ preset: 'all' }).since, p_since: rangeBounds({ preset: '7d' }).since,
      } as never),
    ]);
    if (subj.error) { setError('Could not load your board.'); setSubjects([]); return; }
    setSubjects((subj.data as Subject[] | null) ?? []);
    const next: Record<string, Partial<Record<Stage, number>>> = {};
    for (const row of (cnt.data as Array<{ subject_id: string; stage: Stage; n: number }> | null) ?? []) {
      (next[row.subject_id] ??= {})[row.stage] = row.n;
    }
    setCounts(next);
  }, [subjectKind]);

  const fetchCards = useCallback(async (view: ColumnView, subjectId: string | null) => {
    const { since, until } = rangeBounds(view.range);
    const { data, error: rpcError } = await supabase.rpc('get_pipeline_board' as never, {
      p_kind: subjectKind, p_stage: view.stage, p_since: since, p_until: until, p_subject_id: subjectId,
    } as never);
    if (rpcError) { setError('Could not load matches.'); return [] as Card[]; }
    return (data as Card[] | null) ?? [];
  }, [subjectKind]);

  const loadColumn = useCallback(async (subjectId: string, view: ColumnView) => {
    const list = await fetchCards(view, subjectId);
    // Ignore a stale answer if the column was switched again meanwhile.
    if (viewsRef.current[subjectId] === view) setColumnCards((prev) => ({ ...prev, [subjectId]: list }));
  }, [fetchCards]);

  const loadAll = useCallback(async () => {
    setCards(await fetchCards(DEFAULT_VIEW, null));
    for (const [subjectId, view] of Object.entries(viewsRef.current)) void loadColumn(subjectId, view);
  }, [fetchCards, loadColumn]);

  useEffect(() => {
    const wanted: Record<'job' | 'hotlist', string[]> = { job: [], hotlist: [] };
    const all = [...(cards ?? []), ...Object.values(columnCards).flat()];
    for (const c of all) if (!requestedLeadIds.current.has(c.lead_id)) { requestedLeadIds.current.add(c.lead_id); wanted[c.lead_kind].push(c.lead_id); }
    for (const x of sends) if (!requestedLeadIds.current.has(x.leadId)) { requestedLeadIds.current.add(x.leadId); wanted[x.leadKind].push(x.leadId); }
    for (const kind of ['job', 'hotlist'] as const) {
      if (wanted[kind].length === 0) continue;
      void loadLeadsByIds(kind, wanted[kind]).then((found) => setLeadsById((prev) => ({ ...prev, ...found })));
    }
  }, [cards, columnCards, sends]);

  const toggleIn = (setter: typeof setExpandedSkills, key: string, on?: boolean) =>
    setter((prev) => {
      const next = new Set(prev);
      if (on ?? !next.has(key)) next.add(key); else next.delete(key);
      return next;
    });

  // The Feed card, exactly as the Feed draws it, with the Feed's actions.
  const feedCard = (lead: SocialLead, paletteIndex: number, bulk?: { selected: boolean; onToggle: () => void }, subjectId?: string, onDismiss?: () => void) => (
    <LeadCard
      lead={lead}
      accountId={account?.id}
      userId={user?.id}
      paletteIndex={paletteIndex}
      isDark={isDark}
      isHotlistFeed={lead.kind === 'hotlist'}
      feedTimeBasis="posted"
      isLeadRevealed={false}
      globalAskedJobState={undefined}
      predictResult={undefined}
      askedRequestedAt={undefined}
      askedFulfilledAt={undefined}
      revealedAt={undefined}
      isViewed={Boolean(viewedAt[lead.id])}
      viewedAt={viewedAt[lead.id]}
      isInlineBreakdownExpanded={expandedBreakdown.has(lead.id)}
      isSkillsExpanded={expandedSkills.has(lead.id)}
      isExpFieldExpanded={expandedFields.has(`${lead.id}:exp`)}
      isWorkTypeFieldExpanded={expandedFields.has(`${lead.id}:workType`)}
      isEmpTypeFieldExpanded={expandedFields.has(`${lead.id}:empType`)}
      isRateFieldExpanded={expandedFields.has(`${lead.id}:rate`)}
      isVisaFieldExpanded={expandedFields.has(`${lead.id}:visa`)}
      isLocationFieldExpanded={expandedFields.has(`${lead.id}:location`)}
      isLoadingPreview={false}
      isProcessingAskAI={ai.processingLeadId === lead.id}
      onPreview={(l) => void previewPost(l)}
      onAskAI={(l) => {
        aiSourceJobRef.current = subjectKind === 'job' && subjectId ? subjectId : null;
        aiResumeRef.current = subjectKind === 'hotlist' && subjectId ? resumes[subjectId] ?? null : null;
        void ai.generate(l);
      }}
      onApply={(l) => { setApplyResume(subjectKind === 'hotlist' && subjectId ? resumes[subjectId] ?? null : null); setApplyLead(l); }}
      onToggleInlineBreakdown={(id) => toggleIn(setExpandedBreakdown, id)}
      onExpandSkills={(id) => toggleIn(setExpandedSkills, id, true)}
      onCollapseSkills={(id) => toggleIn(setExpandedSkills, id, false)}
      onToggleField={(key) => toggleIn(setExpandedFields, key)}
      bulkSelectable={Boolean(bulk)}
      isBulkSelected={bulk?.selected}
      onToggleBulkSelect={bulk ? () => bulk.onToggle() : undefined}
      collapsible
      defaultCollapsed
      onDismiss={onDismiss ? () => onDismiss() : undefined}
      applySubjectId={subjectKind === 'hotlist' ? subjectId ?? null : null}
      onExternalApplied={() => void loadAll()}
    />
  );

  useEffect(() => {
    if (!postMenuFor) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-post-menu]')) setPostMenuFor('');
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [postMenuFor]);

  async function postAction(subject: Subject, action: 'edit' | 'view' | 'close' | 'delete') {
    setPostMenuFor('');
    trackEvent('tracker_post_menu', { action, kind: subjectKind });
    try {
      if (action === 'view') {
        const content = await fetchLeadPostContent(subject.subject_id, subjectKind);
        setPostPreview({ title: subjectTitle(subject), content });
        return;
      }
      const post = await loadUserPost(subjectKind, subject.subject_id);
      if (!post) { setError('Could not load this post.'); return; }
      if (action === 'edit') { setEditingPost(post); return; }
      if (action === 'close') {
        const { error: rpcError } = await setUserPostStatus(post, 'closed');
        if (rpcError) throw new Error(rpcError.message);
        setNotice(`Closed ${subjectTitle(subject)}. Reopen it any time from My Posts.`);
      } else {
        if (!window.confirm(`Delete ${subjectTitle(subject)}? This cannot be undone.`)) return;
        const { error: rpcError } = await deleteUserPost(post);
        if (rpcError) throw new Error(rpcError.message);
        setNotice(`Deleted ${subjectTitle(subject)}.`);
      }
      void loadSubjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }

  // Close a column's range menu on any click outside it.
  useEffect(() => {
    if (!rangeMenuFor) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-range-menu]')) setRangeMenuFor('');
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [rangeMenuFor]);

  const loadSends = useCallback(async () => {
    if (!account?.id) return;
    const list = await loadTrackerSends(account.id, account.active_persona);
    const leadIds = [...new Set(list.map((x) => x.leadId))];
    const onBoard = new Set<string>();
    for (let i = 0; i < leadIds.length; i += 200) {
      const { data } = await supabase.from('pipeline_cards' as never).select('lead_id').in('lead_id', leadIds.slice(i, i + 200));
      for (const row of (data as Array<{ lead_id: string }> | null) ?? []) onBoard.add(row.lead_id);
    }
    setSends(list);
    setLeadsOnBoard(onBoard);
  }, [account?.id, account?.active_persona]);

  useEffect(() => {
    if (!account?.id) return;
    void loadSubjects();
    void loadSends();
    void loadAll();
  }, [account?.id, loadSubjects, loadAll]);

  // Once per open: the ring's cut-off. Null on a first visit.
  useEffect(() => {
    if (!user?.id) return;
    void Promise.resolve(supabase.rpc('mark_tracker_visit' as never)).then(({ data }) => {
      if (typeof data === 'string') setUnseenSince(Date.parse(data));
    });
  }, [user?.id]);

  // The Feed's own AI Submit / AI Request, preview and Apply, right here: the
  // same draft popup, Gmail send, credits and screening link as everywhere.
  const showToast = useCallback((message: string, type?: 'success' | 'error') => {
    if (type === 'error') setError(message); else setNotice(message);
  }, []);
  const [outOfCredits, setOutOfCredits] = useState<{ open: boolean; action: string | null }>({ open: false, action: null });
  // An invite's screening link hangs off the requirement whose column it was sent from.
  const aiSourceJobRef = useRef<string | null>(null);
  const ai = useAiSubmit({
    accountId: account?.id,
    userId: user?.id,
    showToast,
    getSourceJobId: () => aiSourceJobRef.current,
    getResume: () => aiResumeRef.current,
    onOutOfCredits: (action) => setOutOfCredits({ open: true, action }),
    // Stay on the board; the card moves to Submitted / Requested on its own.
    openInboxAfterSend: false,
  });
  const [postPreview, setPostPreview] = useState<{ title: string; content: string } | null>(null);
  // Posts this user has opened (same record the Feed keeps), shown on the card.
  const [viewedAt, setViewedAt] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!user?.id) return;
    void supabase
      .from('pulse_lead_actions' as never)
      .select('lead_id, created_at')
      .eq('user_id', user.id)
      .eq('action_type', 'post_content_viewed')
      .then(({ data }: { data: Array<{ lead_id: string; created_at: string }> | null }) => {
        const next: Record<string, string> = {};
        for (const row of data ?? []) next[row.lead_id] = row.created_at;
        setViewedAt(next);
      });
  }, [user?.id]);
  const [applyLead, setApplyLead] = useState<SocialLead | null>(null);
  // The consultant's attached resume, handed to the submit form so it isn't asked for again.
  const [applyResume, setApplyResume] = useState<{ url: string; name: string } | null>(null);

  const loadResumes = useCallback(async () => {
    if (subjectKind !== 'hotlist') return;
    const { data } = await supabase.from('hotlist_resumes' as never).select('hotlist_id, url, file_name');
    const next: Record<string, { url: string; name: string }> = {};
    for (const row of (data as Array<{ hotlist_id: string; url: string; file_name: string }> | null) ?? []) next[row.hotlist_id] = { url: row.url, name: row.file_name };
    setResumes(next);
  }, [subjectKind]);
  useEffect(() => { if (account?.id) void loadResumes(); }, [account?.id, loadResumes]);

  const setPreviewHidden = (subjectId: string, hidden: boolean) => {
    setHiddenPreviews((prev) => {
      const next = new Set(prev);
      if (hidden) next.add(subjectId); else next.delete(subjectId);
      try { localStorage.setItem('tracker_resume_preview_hidden', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  async function uploadResume(subjectId: string, file: File) {
    if (!account?.id) return;
    if (!/\.(pdf|docx?)$/i.test(file.name)) { setError('Attach a PDF or Word resume.'); return; }
    if (file.size > 4 * 1024 * 1024) { setError('Resume must be under 4 MB.'); return; }
    setUploadingResumeFor(subjectId);
    try {
      const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
      const storagePath = `consultant-resumes/${account.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('resumes').upload(storagePath, file, { contentType: file.type || 'application/octet-stream' });
      if (uploadError) throw new Error(uploadError.message);
      const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(storagePath);
      const { error: rpcError } = await supabase.rpc('set_hotlist_resume' as never, { p_hotlist_id: subjectId, p_url: urlData.publicUrl, p_file_name: file.name } as never);
      if (rpcError) throw new Error(rpcError.message);
      setResumes((prev) => ({ ...prev, [subjectId]: { url: urlData.publicUrl, name: file.name } }));
      setPreviewHidden(subjectId, false);
      trackEvent('consultant_resume_attached', { type: file.name.split('.').pop()?.toLowerCase() ?? '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach the resume.');
    } finally {
      setUploadingResumeFor('');
    }
  }

  async function removeResume(subjectId: string) {
    const { error: rpcError } = await supabase.rpc('remove_hotlist_resume' as never, { p_hotlist_id: subjectId } as never);
    if (rpcError) { setError('Could not remove the resume.'); return; }
    setResumes((prev) => { const next = { ...prev }; delete next[subjectId]; return next; });
  }

  const previewPost = useCallback(async (lead: SocialLead) => {
    // Same rule as the Feed: consultants have no post worth opening.
    if (lead.kind === 'hotlist') return;
    try {
      const content = await fetchLeadPostContent(lead.id, lead.kind);
      if (account?.id) {
        void supabase.from('pulse_lead_actions' as never).upsert(
          { account_id: account.id, user_id: user?.id ?? null, lead_id: lead.id, action_type: 'post_content_viewed' } as never,
          { onConflict: 'account_id,user_id,lead_id,action_type', ignoreDuplicates: true },
        );
      }
      setPostPreview({ title: lead.title || 'Job Opportunity', content });
      setViewedAt((prev) => (prev[lead.id] ? prev : { ...prev, [lead.id]: new Date().toISOString() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the post');
    }
  }, [account?.id, user?.id]);

  function toggleSelect(card: Card) {
    setSelected((prev) => {
      const ids = new Set(prev.subjectId === card.subject_id ? prev.ids : []);
      if (ids.has(card.id)) ids.delete(card.id); else ids.add(card.id);
      return { subjectId: card.subject_id, ids };
    });
  }

  function selectAll(subjectId: string, list: Card[]) {
    const sendable = list.filter((c) => c.stage === 'new' && c.has_email).map((c) => c.id);
    setSelected((prev) => {
      const all = prev.subjectId === subjectId && sendable.length > 0 && sendable.every((id) => prev.ids.has(id));
      return all ? { subjectId: '', ids: new Set() } : { subjectId, ids: new Set(sendable) };
    });
  }

  // Pull to refresh (phones): pull a column down from its top to reload the
  // board and quietly rematch that column. Vertical pulls only, so swiping
  // sideways between columns never triggers it.
  const PULL_TRIGGER = 64;
  const pullStart = useRef<{ key: string; x: number; y: number } | null>(null);
  const [pull, setPull] = useState<{ key: string; dy: number } | null>(null);
  const [pullRefreshing, setPullRefreshing] = useState('');
  // The board scrolls sideways; while a column is being pulled down that has
  // to stop, or the slightest sideways drift pans the board instead.
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const lockBoardX = (locked: boolean) => {
    if (boardScrollRef.current) boardScrollRef.current.style.overflowX = locked ? 'hidden' : '';
  };

  async function pullRefresh(key: string) {
    setPullRefreshing(key);
    trackEvent('tracker_pull_refresh', { column: key === 'other' ? 'other' : 'subject' });
    try {
      const jobs: Array<Promise<unknown>> = [loadAll(), loadSubjects(), loadSends()];
      if (key !== 'other') {
        jobs.push(Promise.resolve(supabase.rpc('rematch_pipeline_subject' as never, { p_subject_id: key } as never)).then(({ data }) => {
          const added = Number(data) || 0;
          if (added > 0) { setNotice(`${added} new match${added === 1 ? '' : 'es'} found.`); void loadAll(); void loadSubjects(); }
        }));
      }
      await Promise.all(jobs);
    } finally {
      setPullRefreshing('');
    }
  }

  const pullHandlers = (key: string) => ({
    onTouchStart: (e: React.TouchEvent<HTMLDivElement>) => {
      pullStart.current = e.currentTarget.scrollTop <= 0 && !pullRefreshing
        ? { key, x: e.touches[0].clientX, y: e.touches[0].clientY }
        : null;
    },
    onTouchMove: (e: React.TouchEvent<HTMLDivElement>) => {
      const start = pullStart.current;
      if (!start || start.key !== key) return;
      const dy = e.touches[0].clientY - start.y;
      const dx = e.touches[0].clientX - start.x;
      // Only a clearly downward drag is a pull; anything diagonal or
      // sideways belongs to the board's horizontal swipe.
      if (dy <= 0 || Math.abs(dx) * 1.5 > dy || e.currentTarget.scrollTop > 0) {
        // A sideways swipe: let the board scroll, and stop treating it as a pull.
        if (Math.abs(dx) > 8 && Math.abs(dx) * 1.5 > Math.abs(dy)) pullStart.current = null;
        lockBoardX(false);
        setPull(null);
        return;
      }
      if (dy < 10) return;
      lockBoardX(true);
      setPull({ key, dy: Math.min((dy - 10) * 0.5, 96) });
    },
    onTouchCancel: () => { pullStart.current = null; lockBoardX(false); setPull(null); },
    onTouchEnd: () => {
      const ready = pull && pull.key === key && pull.dy >= PULL_TRIGGER;
      pullStart.current = null;
      lockBoardX(false);
      setPull(null);
      if (ready) void pullRefresh(key);
    },
  });

  const pullIndicator = (key: string) => {
    const dy = pull?.key === key ? pull.dy : 0;
    const busy = pullRefreshing === key;
    if (!dy && !busy) return null;
    return (
      <div className="flex shrink-0 items-center justify-center gap-1.5 text-[11px] font-semibold text-gray-500 transition-[height]" style={{ height: busy ? 36 : dy }}>
        <RefreshCw size={13} className={busy ? 'animate-spin' : ''} style={busy ? undefined : { transform: `rotate(${dy * 4}deg)` }} />
        {busy ? 'Refreshing…' : dy >= PULL_TRIGGER ? 'Release to refresh' : 'Pull to refresh'}
      </div>
    );
  };

  async function rematch(subject: Subject) {
    setRematching(subject.subject_id);
    const { data, error: rpcError } = await supabase.rpc('rematch_pipeline_subject' as never, { p_subject_id: subject.subject_id } as never);
    setRematching('');
    if (rpcError) { setError('Could not rematch right now.'); return; }
    const added = Number(data) || 0;
    setNotice(added > 0 ? `${added} new match${added === 1 ? '' : 'es'} for ${subjectTitle(subject)}.` : `No new matches for ${subjectTitle(subject)} yet. We'll add them here as they're posted.`);
    // Rematched cards are new as of now, so the default view shows them.
    setColumnView(subject.subject_id, DEFAULT_VIEW);
    void loadAll();
    void loadSubjects();
  }

  function setColumnView(subjectId: string, view: ColumnView) {
    setShownCount((prev) => { const copy = { ...prev }; delete copy[subjectId]; return copy; });
    const next = { ...viewsRef.current };
    if (isDefaultView(view)) delete next[subjectId]; else next[subjectId] = view;
    viewsRef.current = next;
    setViews(next);
    setColumnCards((prev) => { const copy = { ...prev }; delete copy[subjectId]; return copy; });
    if (!isDefaultView(view) && (view.range.preset !== 'custom' || view.range.from)) void loadColumn(subjectId, view);
  }

  // Live: new matches and stage changes made elsewhere (a submit sent from
  // the feed, a reply) show up without a refresh.
  useEffect(() => {
    if (!account?.id) return;
    const channel = supabase
      .channel(`board-${account.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pipeline_cards', filter: `account_id=eq.${account.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setLiveNew((n) => n + 1);
          const id = (payload.new as { id?: string } | null)?.id;
          if (id) setArrivedIds((prev) => new Set(prev).add(id));
        }
        void loadAll();
        void loadSubjects();
        void loadSends();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [account?.id, loadAll, loadSubjects, loadSends]);

  // "(3) Tracker" in the browser tab while new matches arrive.
  useEffect(() => {
    const base = 'Tracker · ProfilePush';
    document.title = liveNew > 0 ? `(${liveNew}) ${base}` : base;
    return () => { document.title = 'ProfilePush'; };
  }, [liveNew]);
  useEffect(() => {
    const clear = () => { if (document.visibilityState === 'visible') setLiveNew(0); };
    window.addEventListener('focus', clear);
    return () => window.removeEventListener('focus', clear);
  }, []);

  async function move(card: Card, to: Stage, reason?: string) {
    if (card.stage === to) return;
    const prevCards = cards;
    const prevColumn = columnCards;
    // It leaves the stage the column is showing; the icon counts follow.
    setCards((prev) => (prev ?? []).filter((c) => c.id !== card.id));
    setColumnCards((prev) => (prev[card.subject_id] ? { ...prev, [card.subject_id]: prev[card.subject_id].filter((c) => c.id !== card.id) } : prev));
    setCounts((prev) => {
      const col = { ...(prev[card.subject_id] ?? {}) };
      col[card.stage] = Math.max(0, (col[card.stage] ?? 1) - 1);
      col[to] = (col[to] ?? 0) + 1;
      return { ...prev, [card.subject_id]: col };
    });
    const { error: rpcError } = await supabase.rpc('move_pipeline_card' as never, { p_id: card.id, p_stage: to, p_reason: reason ?? null } as never);
    if (rpcError) { setCards(prevCards); setColumnCards(prevColumn); setError('Could not move that card.'); }
    void loadSubjects();
  }

  const defaultBySubject = useMemo(() => {
    const groups = new Map<string, Card[]>();
    for (const card of cards ?? []) {
      const list = groups.get(card.subject_id) ?? [];
      list.push(card);
      groups.set(card.subject_id, list);
    }
    return groups;
  }, [cards]);

  // Columns with new matches first, then the rest (newest first).
  const columns = useMemo(() => {
    const list = [...(subjects ?? [])];
    list.sort((a, b) => (counts[b.subject_id]?.new ?? 0) - (counts[a.subject_id]?.new ?? 0));
    return list;
  }, [subjects, counts]);

  // Search narrows the board to columns whose post matches, or to the
  // matching cards in the others.
  const q = query.trim().toLowerCase();
  const subjectMatches = (subject: Subject) => !q || `${subjectTitle(subject)} ${subject.detail ?? ''}`.toLowerCase().includes(q);
  const cardMatches = (card: Card) => `${card.lead_kind === 'hotlist' ? consultantTitle(card.title) : card.title} ${card.location ?? ''} ${card.detail ?? ''}`.toLowerCase().includes(q);

  const emptyText = (view: ColumnView) => {
    if (view.range.preset !== defaultRange(view.stage).preset) return 'Nothing in this range.';
    if (view.stage === 'new') return 'Finding matches. New ones appear here the moment they’re posted.';
    return `No ${isVendor ? 'requests' : 'submits'} in the last 7 days.`;
  };
  const sendsByLead = useMemo(() => {
    const map = new Map<string, TrackerSend[]>();
    for (const send of sends) map.set(send.leadId, [...(map.get(send.leadId) ?? []), send]);
    return map;
  }, [sends]);
  const otherSends = sends.filter((x) => !leadsOnBoard.has(x.leadId));
  const otherVisible = otherSends
    .filter((x) => (otherTab === 'closed' ? x.closed : !x.closed))
    .filter((x) => !q || `${x.title} ${x.subtitle}`.toLowerCase().includes(q));
  const otherLabel = isVendor ? 'Other requests' : 'Other submissions';

  // Status, screening, resume and chat for one send, as the old page showed.
  const sendBadges = (send: TrackerSend) => (
    <div key={send.key} className="flex flex-wrap items-center gap-1">
      <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${SEND_TONE_CLASSES[send.statusTone]}`}>{send.statusLabel}</span>
      {send.aiScore != null && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:border-purple-400/30 dark:bg-purple-500/10 dark:text-purple-300">
          <Sparkles size={9} /> {send.aiScore}/100
        </span>
      )}
      {send.screeningUrl && (
        <a href={send.screeningUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-100 dark:border-white/15 dark:bg-white/5 dark:text-slate-300">
          <ExternalLink size={9} /> Screening link
        </a>
      )}
      {send.turns?.some((t) => t.answered_at) && (
        <button type="button" onClick={() => setWatchSend(send)} className="inline-flex items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-300">
          <Video size={9} /> Watch
        </button>
      )}
      {send.resumeUrl && (
        <a href={send.resumeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          <FileText size={9} /> Resume
        </a>
      )}
      {send.chatId && (
        <button type="button" onClick={() => navigate(`/inbox/${send.chatId}`)} className="inline-flex items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-300">
          <MessageSquare size={9} /> Open chat
        </button>
      )}
    </div>
  );

  // Next column colour; reset every render (see COLUMN_TINTS).
  let tintIndex = 0;
  const allCards = () => [...(cards ?? []), ...Object.values(columnCards).flat()];

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden overscroll-none bg-[#f3f2ee] text-gray-900 pb-[calc(4.25rem+env(safe-area-inset-bottom))] dark:bg-[#1B1D21] dark:text-slate-100 sm:pb-0">
      <AppNav />

      {/* Same toolbar as the other pages: search, then actions, then Add Post. */}
      <div className="flex shrink-0 items-center gap-2 px-2 pt-2 sm:px-3">
        <div className="relative flex min-w-[160px] flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 dark:border-white/10 dark:bg-[#20242a]">
          <Search size={11} className="shrink-0 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isVendor ? 'Search requirements and consultants' : 'Search consultants and requirements'}
            className="w-full min-w-0 border-0 bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-gray-400 dark:text-slate-200 dark:placeholder:text-[#64748B]"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="shrink-0 rounded-full p-0.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600 dark:hover:bg-white/10" aria-label="Clear search">
              <X size={11} />
            </button>
          )}
        </div>
        <span className="hidden shrink-0 items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-1.5 text-[11px] font-semibold text-green-700 sm:inline-flex dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-600" /> Live
        </span>
        {/* New posts start in AI Match, like everywhere else. */}
        <button
          type="button"
          onClick={() => navigate('/match')}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700"
        >
          <Plus size={13} />
          Add Post
        </button>
      </div>

      {/* Each new match costs a credit (charge_tracker_match), so at zero the
          matcher quietly stops adding cards. Say so, or the board just looks
          dead. Not dismissible: it goes away when there are credits again. */}
      {account && Number(account.credits_balance ?? 0) < 1 && (
        <div className="mx-2 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 sm:mx-3 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
          <span className="min-w-0 flex-1">
            New matches are paused: you’re out of credits. Buy credits to resume (from ₹249).
          </span>
          <button
            type="button"
            onClick={() => { trackEvent('tracker_out_of_credits_clicked', {}); navigate('/billing'); }}
            className="rounded-full bg-amber-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-amber-700"
          >
            Buy credits
          </button>
        </div>
      )}

      {pushState !== 'granted' && pushState !== 'unsupported' && !pushPromptHidden && (
        <div className="mx-2 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] text-blue-900 sm:mx-3 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-100">
          <span className="min-w-0 flex-1">
            {pushState === 'denied'
              ? 'Notifications are blocked in this browser. Allow them for profilepush.ai in your browser’s site settings to hear about new matches.'
              : 'Get a notification the moment a new match lands for your ' + (isVendor ? 'requirements.' : 'consultants.')}
          </span>
          {pushState !== 'denied' && (
            <button
              type="button"
              onClick={() => {
                trackEvent('push_prompt_clicked', { from: 'tracker' });
                void enableWebPush().then((state) => { setPushState(state); trackEvent('push_prompt_result', { state }); });
              }}
              className="rounded-full bg-blue-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-blue-700"
            >
              Turn on notifications
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => { setPushPromptHidden(true); try { localStorage.setItem('tracker_push_prompt_hidden', '1'); } catch { /* ignore */ } }}
            className="text-blue-700/70 hover:text-blue-900 dark:text-blue-200/70"
          >
            <X size={13} />
          </button>
        </div>
      )}
      {error && <p className="mx-2 mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 sm:mx-3">{error}</p>}
      {notice && (
        <p className="mx-2 mt-2 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[12px] text-green-800 sm:mx-3">
          {notice}
          <button type="button" aria-label="Dismiss" onClick={() => setNotice('')} className="ml-auto text-green-700"><X size={12} /></button>
        </p>
      )}

      {account?.id && selected.ids.size > 0 && (
        <div className="mx-2 mt-2 sm:mx-3">
          <BulkAiSubmitBar
            targets={allCards()
              .filter((c) => selected.ids.has(c.id))
              .map((c) => ({ id: c.lead_id, title: c.lead_kind === 'hotlist' ? consultantTitle(c.title) : c.title, company: '', hasEmail: c.has_email, kind: c.lead_kind }))}
            accountId={account.id}
            sourceJobId={subjectKind === 'job' ? selected.subjectId : null}
            resume={subjectKind === 'hotlist' ? resumes[selected.subjectId] ?? null : null}
            gmailConnected={ai.gmailStatus === 'connected'}
            isNarrowed
            onClearSelection={() => setSelected({ subjectId: '', ids: new Set() })}
            onConnectGmail={() => { void ai.connectGmailStandalone(); }}
            onDone={() => { setSelected({ subjectId: '', ids: new Set() }); void loadAll(); void loadSubjects(); void loadSends(); }}
          />
        </div>
      )}

      {subjects && subjects.length === 0 && otherSends.length === 0 && (
        <div className="mx-auto mt-16 max-w-sm text-center">
          <p className="text-[14px] text-gray-700">{isVendor ? 'Post a requirement and its matching consultants show up here, live.' : 'Add your consultants and their matching requirements show up here, live.'}</p>
          <button type="button" onClick={() => navigate('/match')} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700">
            {isVendor ? 'Post a requirement' : 'Add consultants'}
          </button>
        </div>
      )}

      <input
        ref={resumeInputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file && resumeTargetRef.current) void uploadResume(resumeTargetRef.current, file);
        }}
      />

      {/* A column per consultant (or requirement), each with its own stage icons */}
      <div ref={boardScrollRef} className="min-h-0 flex-1 overflow-x-auto">
        <div className="flex h-full min-w-max gap-3 p-2 sm:p-3">
          {!subjects && <p className="p-4 text-[12px] text-gray-500">Loading…</p>}
          {columns.map((subject) => {
            const sid = subject.subject_id;
            const view = views[sid] ?? DEFAULT_VIEW;
            const own = views[sid] !== undefined;
            const waitingForDates = view.range.preset === 'custom' && !view.range.from;
            const loaded = own ? columnCards[sid] !== undefined || waitingForDates : cards !== null;
            const all = loaded ? (own ? columnCards[sid] ?? [] : defaultBySubject.get(sid) ?? []) : [];
            const list = subjectMatches(subject) ? all : all.filter(cardMatches);
            if (q && !subjectMatches(subject) && list.length === 0) return null;
            // Counted over the columns actually shown, so hidden ones don't
            // put two of the same colour next to each other.
            const tint = COLUMN_TINTS[tintIndex++ % COLUMN_TINTS.length];
            const resume = subjectKind === 'hotlist' ? resumes[sid] : undefined;
            const showResumePreview = Boolean(resume) && !hiddenPreviews.has(sid);
            const colCounts = counts[sid] ?? {};
            const range = view.range;
            return (
              <div key={sid} className="flex h-full shrink-0 overflow-hidden rounded-xl bg-white dark:bg-[#20242a]">
              <section className={`flex h-full w-[340px] flex-col ${tint.body}`}>
                <header className={`shrink-0 border-b px-3 py-2.5 ${tint.header}`}>
                  <div className="flex items-center gap-1.5">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100" title={subjectTitle(subject)}>{subjectTitle(subject)}</p>
                    <div data-post-menu className="relative shrink-0">
                      <button
                        type="button"
                        title="Edit, view, close or delete this post"
                        aria-label="Post options"
                        onClick={() => setPostMenuFor((open) => (open === sid ? '' : sid))}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition hover:text-gray-800 dark:border-white/10 dark:bg-[#171a1f] dark:text-[#94A3B8]"
                      >
                        <Pencil size={12} />
                      </button>
                      {postMenuFor === sid && (
                        <div className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-[150px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#20242a]">
                          {([
                            { id: 'edit', label: 'Edit post', icon: Pencil },
                            { id: 'view', label: 'View post', icon: Eye },
                            { id: 'close', label: 'Close post', icon: Archive },
                            { id: 'delete', label: 'Delete post', icon: Trash2 },
                          ] as const).map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => void postAction(subject, item.id)}
                              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition ${item.id === 'delete' ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10' : 'text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-white/5'}`}
                            >
                              <item.icon size={13} /> {item.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {subjectKind === 'hotlist' && (
                      <button
                        type="button"
                        title={resume ? 'Replace resume' : 'Attach resume (sent with AI Submit)'}
                        aria-label={resume ? 'Replace resume' : 'Attach resume'}
                        disabled={uploadingResumeFor === sid}
                        onClick={() => { resumeTargetRef.current = sid; resumeInputRef.current?.click(); }}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition hover:text-gray-800 disabled:opacity-60 dark:border-white/10 dark:bg-[#171a1f] dark:text-[#94A3B8]"
                      >
                        {uploadingResumeFor === sid ? <RefreshCw size={12} className="animate-spin" /> : <Paperclip size={13} />}
                      </button>
                    )}
                  </div>
                  {subject.detail && <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-[#94A3B8]">{subject.detail}</p>}
                  {resume && (
                    <div className="mt-1.5 flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700 dark:border-white/10 dark:bg-[#171a1f] dark:text-slate-200">
                      <FileText size={11} className="shrink-0 text-gray-500" />
                      <span className="min-w-0 flex-1 truncate" title={resume.name}>{resume.name}</span>
                      <button type="button" onClick={() => setPreviewHidden(sid, showResumePreview)} title={showResumePreview ? 'Hide preview' : 'Show preview'} aria-label={showResumePreview ? 'Hide resume preview' : 'Show resume preview'} className="shrink-0 text-gray-400 hover:text-gray-700">
                        {showResumePreview ? <EyeOff size={11} /> : <Eye size={11} />}
                      </button>
                      <button type="button" onClick={() => void removeResume(sid)} title="Remove resume" aria-label="Remove resume" className="shrink-0 text-gray-400 hover:text-gray-700">
                        <X size={11} />
                      </button>
                    </div>
                  )}

                  {/* Stage pills, as on the other pages (drop a New card on
                      Submitted to mark it sent), and rematch */}
                  <div className="mt-2 flex items-center gap-1">
                    {STAGES.map((st) => {
                      const active = view.stage === st.id;
                      const n = colCounts[st.id] ?? 0;
                      const target = `${sid}:${st.id}`;
                      return (
                        <button
                          key={st.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setColumnView(sid, { stage: st.id, range: defaultRange(st.id) })}
                          onDragOver={(e) => {
                            const card = allCards().find((c) => c.id === dragId);
                            if (card && card.subject_id === sid && card.stage === 'new' && st.id === 'submitted') { e.preventDefault(); setOverTarget(target); }
                          }}
                          onDragLeave={() => setOverTarget((o) => (o === target ? '' : o))}
                          onDrop={(e) => {
                            e.preventDefault();
                            setOverTarget('');
                            const card = allCards().find((c) => c.id === dragId);
                            if (card) void move(card, st.id);
                            setDragId('');
                          }}
                          className={`inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-[11px] font-semibold transition dark:bg-[#171a1f] ${active ? 'border-gray-400 text-gray-900 dark:border-white/30 dark:text-slate-100' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-[#94A3B8]'} ${overTarget === target ? 'ring-2 ring-blue-400' : ''}`}
                        >
                          <span>{st.label}</span>
                          {/* Only the count carries colour, and only when there is something */}
                          <span className={`tabular-nums ${n === 0 ? 'text-gray-400 dark:text-[#64748B]' : st.id === 'new' ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'}`}>{n}</span>
                        </button>
                      );
                    })}
                    {/* Range pill, as on the other pages' search rows */}
                    <div data-range-menu className="relative ml-auto shrink-0">
                      <button
                        type="button"
                        onClick={() => setRangeMenuFor((open) => (open === sid ? '' : sid))}
                        aria-label="Change date range"
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold transition ${range.preset !== defaultRange(view.stage).preset ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-300' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-[#171a1f] dark:text-[#94A3B8]'}`}
                      >
                        <Clock3 size={11} />
                        <span>{range.preset}</span>
                      </button>
                      {rangeMenuFor === sid && (
                        <div className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-[130px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#20242a]">
                          {RANGE_OPTIONS.filter((o) => o.id !== '2h' || view.stage === 'new').map((o) => (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => {
                                setRangeMenuFor('');
                                setColumnView(sid, { stage: view.stage, range: o.id === 'custom' ? { preset: 'custom', from: isoDay(daysFrom(startOfToday(), -6)), to: isoDay(startOfToday()) } : { preset: o.id } });
                              }}
                              className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${o.id === range.preset ? 'bg-gray-100 text-gray-800 dark:bg-[#2A2E35] dark:text-slate-100' : 'text-gray-600 hover:bg-gray-50 dark:text-[#94A3B8] dark:hover:bg-white/5'}`}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      title="Rematch: find fresh matches now"
                      aria-label="Rematch"
                      onClick={() => void rematch(subject)}
                      disabled={rematching === sid}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition hover:text-gray-800 disabled:opacity-60 dark:border-white/10 dark:bg-[#171a1f] dark:text-[#94A3B8]"
                    >
                      <RefreshCw size={13} className={rematching === sid ? 'animate-spin' : ''} />
                    </button>
                  </div>

                  {range.preset === 'custom' && (
                    <div className="mt-1 flex items-center gap-1">
                      <input type="date" aria-label="From" value={range.from ?? ''} max={range.to} onChange={(e) => setColumnView(sid, { stage: view.stage, range: { ...range, from: e.target.value } })} className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-1 py-0.5 text-[11px] text-gray-700" />
                      <span className="text-[11px] text-gray-400">–</span>
                      <input type="date" aria-label="To" value={range.to ?? ''} min={range.from} onChange={(e) => setColumnView(sid, { stage: view.stage, range: { ...range, to: e.target.value } })} className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-1 py-0.5 text-[11px] text-gray-700" />
                    </div>
                  )}
                </header>

                <div {...pullHandlers(sid)} className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-y-contain px-2 pb-2">
                  {pullIndicator(sid)}
                  {!loaded && <p className="px-2 py-6 text-center text-[11px] text-gray-400">Loading…</p>}
                  {loaded && list.length === 0 && <p className="px-2 py-6 text-center text-[11px] text-gray-400">{emptyText(view)}</p>}
                  {view.stage === 'new' && list.some((c) => c.has_email) && (
                    <button type="button" onClick={() => selectAll(sid, list)} className="self-end px-1 text-[11px] font-semibold text-blue-700 hover:underline dark:text-blue-300">
                      {selected.subjectId === sid && selected.ids.size > 0 ? 'Clear selection' : `Select all for ${submitLabel}`}
                    </button>
                  )}
                  {list.slice(0, shownFor(sid)).map((card, cardIndex) => {
                    const lead = leadsById[card.lead_id];
                    const cardSends = sendsByLead.get(card.lead_id) ?? [];
                    return (
                      <div
                        key={card.id}
                        draggable
                        onDragStart={() => setDragId(card.id)}
                        onDragEnd={() => { setDragId(''); setOverTarget(''); }}
                        className={`shrink-0 rounded-lg transition ${arrivedIds.has(card.id) || (unseenSince !== null && Date.parse(card.added_at) > unseenSince) ? 'ring-2 ring-green-400' : ''} ${dragId === card.id ? 'opacity-50' : ''}`}
                      >
                        {/* A plain block around the card: the card is h-full,
                            and without it that resolved to this whole slot,
                            extras row included, leaving a gap inside the card
                            and pushing the extras under the next card. */}
                        <div>
                        {lead
                          ? feedCard(lead, cardIndex, card.stage === 'new' && card.has_email
                            ? { selected: selected.subjectId === sid && selected.ids.has(card.id), onToggle: () => toggleSelect(card) }
                            : undefined, sid,
                            card.stage === 'new'
                              ? () => { trackEvent('tracker_not_a_match', { similarity: card.similarity, lead_kind: card.lead_kind }); void move(card, 'closed', 'not_a_match'); }
                              : undefined)
                          : <div className="h-28 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5" />}
                        </div>
                        {/* Tracker extras under the Feed card */}
                        {(cardSends.length > 0 || card.conversation_id) && (
                          <div className="mt-1 flex flex-col gap-1 px-1">
                            {cardSends.map(sendBadges)}
                            <div className="flex items-center gap-1.5">
                              {card.conversation_id && card.stage !== 'new' && (
                                <button type="button" onClick={() => navigate(`/inbox/${card.conversation_id}`)} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-[#171a1f] dark:text-slate-200">
                                  <MessageSquare size={10} /> {card.stage === 'replied' ? 'Replied · open' : 'Conversation'}
                                </button>
                              )}

                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {loadMoreButton(sid, list.length)}
                </div>
              </section>
              {/* The consultant's resume, beside their column */}
              {resume && showResumePreview && (
                <aside className="flex h-full w-[420px] flex-col border-l border-gray-200 dark:border-white/10">
                  <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-white/10">
                    <FileText size={13} className="shrink-0 text-gray-500" />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-gray-800 dark:text-slate-100">{resume.name}</span>
                    <a href={resume.url} target="_blank" rel="noreferrer" title="Open in a new tab" className="shrink-0 text-gray-400 hover:text-gray-700"><ExternalLink size={13} /></a>
                    <button type="button" onClick={() => setPreviewHidden(sid, true)} title="Hide preview" aria-label="Hide resume preview" className="shrink-0 text-gray-400 hover:text-gray-700"><X size={13} /></button>
                  </div>
                  {/\.pdf$/i.test(resume.name) ? (
                    <iframe title={`Resume: ${resume.name}`} src={`${resume.url}#view=FitH`} className="min-h-0 w-full flex-1 bg-gray-50" />
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[12px] text-gray-500">
                      <p>Word files can't be previewed here.</p>
                      <a href={resume.url} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 hover:underline">Open {resume.name}</a>
                    </div>
                  )}
                </aside>
              )}
              </div>
            );
          })}

          {/* Sends to leads that are not on the board (the old Submissions / Invites list) */}
          {otherSends.length > 0 && (!q || otherVisible.length > 0) && (
            <section className="flex h-full w-[340px] flex-col overflow-hidden rounded-xl bg-gray-50 dark:bg-[#1f232a]">
              <header className="shrink-0 rounded-t-xl bg-gray-200 px-3 py-2.5 dark:bg-[#333946]">
                <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100">{otherLabel}</p>
                <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-[#94A3B8]">{isVendor ? 'Requests and chats outside your requirements' : 'Applications outside your consultants'}</p>
                <div className="mt-2 flex items-center gap-1">
                  {(['open', 'closed'] as const).map((t) => {
                    const n = otherSends.filter((x) => (t === 'closed' ? x.closed : !x.closed)).length;
                    return (
                      <button key={t} type="button" onClick={() => { setOtherTab(t); setShownCount((prev) => { const copy = { ...prev }; delete copy.other; return copy; }); }} className={`inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-[11px] font-semibold transition dark:bg-[#171a1f] ${otherTab === t ? 'border-gray-400 text-gray-900 dark:border-white/30 dark:text-slate-100' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-[#94A3B8]'}`}>
                        <span>{t === 'open' ? 'Open' : 'Closed'}</span>
                        <span className={`tabular-nums ${n === 0 ? 'text-gray-400 dark:text-[#64748B]' : 'text-blue-600 dark:text-blue-400'}`}>{n}</span>
                      </button>
                    );
                  })}
                </div>
              </header>
              <div {...pullHandlers('other')} className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-y-contain px-2 pb-2">
                {pullIndicator('other')}
                {otherVisible.length === 0 && <p className="px-2 py-6 text-center text-[11px] text-gray-400">{otherTab === 'closed' ? 'Nothing closed yet.' : 'Nothing open.'}</p>}
                {otherVisible.slice(0, shownFor('other')).map((send, i) => (
                  <div key={send.key} className="shrink-0">
                    <div>
                    {leadsById[send.leadId]
                      ? feedCard(leadsById[send.leadId], i)
                      : <div className="h-28 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5" />}
                    </div>
                    <div className="mt-1 px-1">{sendBadges(send)}</div>
                  </div>
                ))}
                {loadMoreButton('other', otherVisible.length)}
              </div>
            </section>
          )}
        </div>
      </div>

      <AiSubmitDialog ai={ai} />
      {editingPost && (
        <PostFormModal
          kind={subjectKind}
          existingPost={editingPost}
          onClose={() => setEditingPost(null)}
          onSaved={() => { setEditingPost(null); setNotice('Post updated.'); void loadSubjects(); }}
          showToast={showToast}
        />
      )}
      {postPreview && <PostPreviewModal title={postPreview.title} content={postPreview.content} onClose={() => setPostPreview(null)} />}
      {applyLead && (
        <SubmitApplicationModal
          jobId={applyLead.id}
          jobTitle={applyLead.title || 'this job'}
          onClose={() => setApplyLead(null)}
          onSaved={() => { setApplyLead(null); void loadAll(); void loadSends(); }}
          showToast={showToast}
          attachedResume={applyResume}
        />
      )}
      <InsufficientCreditsModal
        open={outOfCredits.open}
        onClose={() => setOutOfCredits({ open: false, action: null })}
        balance={account?.credits_balance ?? 0}
        actionLabel={outOfCredits.action ?? (isVendor ? 'send this request' : 'generate this submission email')}
      />

      {watchSend?.applicationId && (
        <ScreeningSubmissionModal
          applicationId={watchSend.applicationId}
          turns={watchSend.turns ?? []}
          onClose={() => setWatchSend(null)}
          showToast={(message, type) => (type === 'error' ? setError(message) : setNotice(message))}
        />
      )}
    </div>
  );
}
