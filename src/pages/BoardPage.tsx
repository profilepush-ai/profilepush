import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, MapPin, MessageSquare, Plus, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import BulkAiSubmitBar from '../components/BulkAiSubmitBar';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { timeAgo } from '../lib/publishers';
import { consultantTitle } from '../lib/consultant-title';

// The Board: a column per consultant (bench sales) or per requirement
// (vendors), each with two tabs, New matches and Submitted (Invited for vendors),
// and its own date range. Every match starts in New; sending an AI Submit
// moves it to Submitted on the server (replies stay there, with a Reply
// button). A column's ↻ rematches that post for fresh matches right here,
// and its cards can be ticked and AI Submitted in bulk. Skip
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
};

// The 'submitted' stage is an AI Invite for vendors, so it reads "Invited".
const stagesFor = (isVendor: boolean): Array<{ id: Stage; label: string }> => [
  { id: 'new', label: 'New matches' },
  { id: 'submitted', label: isVendor ? 'Invited' : 'Submitted' },
];

// Which matches a column shows. New defaults to the last 2 hours and every
// other stage to today; each column can pick its own range.
type RangePreset = '2h' | 'today' | 'yesterday' | '7d' | '30d' | 'custom';
type Range = { preset: RangePreset; from?: string; to?: string };

const RANGE_LABELS: Record<RangePreset, string> = {
  '2h': 'Last 2 hours', today: 'Today', yesterday: 'Yesterday', '7d': 'Last 7 days', '30d': 'Last 30 days', custom: 'Custom…',
};

const defaultRange = (stage: Stage): Range => ({ preset: stage === 'new' ? '2h' : 'today' });

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
    case '2h': return { since: new Date(Date.now() - 2 * 3600_000).toISOString(), until: null };
    case 'today': return { since: today.toISOString(), until: null };
    case 'yesterday': return { since: daysFrom(today, -1).toISOString(), until: today.toISOString() };
    case '7d': return { since: daysFrom(today, -6).toISOString(), until: null };
    case '30d': return { since: daysFrom(today, -29).toISOString(), until: null };
    case 'custom': {
      const from = range.from ? localDay(range.from) : today;
      const to = range.to ? daysFrom(localDay(range.to), 1) : null;
      return { since: from.toISOString(), until: to ? to.toISOString() : null };
    }
  }
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function rateText(min: number | null, max: number | null): string {
  if (min && max && min !== max) return `$${min}–${max}/hr`;
  if (min || max) return `$${min || max}/hr`;
  return '';
}

type ColumnView = { stage: Stage; range: Range };
const DEFAULT_VIEW: ColumnView = { stage: 'new', range: { preset: '2h' } };
const isDefaultView = (v: ColumnView) => v.stage === 'new' && v.range.preset === '2h';

export default function BoardPage() {
  const navigate = useNavigate();
  const { account } = useAuth();
  const isVendor = account?.active_persona === 'vendor';
  // Bench sales: a column per consultant (a hotlist row) holding requirements.
  // Vendors: a column per requirement holding consultants.
  const subjectKind: 'hotlist' | 'job' = isVendor ? 'job' : 'hotlist';
  const submitLabel = isVendor ? 'AI Invite' : 'AI Submit';
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
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  // Bulk AI Submit works on one column at a time (an invite's screening link
  // hangs off that column's requirement).
  const [selected, setSelected] = useState<{ subjectId: string; ids: Set<string> }>({ subjectId: '', ids: new Set() });
  const [gmailConnected, setGmailConnected] = useState(false);
  const [rematching, setRematching] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const viewsRef = useRef<Record<string, ColumnView>>({});
  viewsRef.current = views;

  const loadSubjects = useCallback(async () => {
    const [subj, cnt] = await Promise.all([
      supabase.rpc('get_pipeline_subjects' as never, { p_kind: subjectKind } as never),
      supabase.rpc('get_pipeline_column_counts' as never, {
        p_kind: subjectKind, p_new_since: rangeBounds({ preset: '2h' }).since, p_since: startOfToday().toISOString(),
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
    if (!account?.id) return;
    void loadSubjects();
    void loadAll();
  }, [account?.id, loadSubjects, loadAll]);

  useEffect(() => {
    supabase
      .from('gmail_integration_status' as never)
      .select('status')
      .maybeSingle()
      .then(({ data }: { data: { status?: string } | null }) => setGmailConnected(data?.status === 'connected'));
  }, []);

  async function connectGmail() {
    if (!account?.id) return;
    const { data, error: fnError } = await supabase.functions.invoke('gmail-oauth-start', { body: { account_id: account.id, return_to: '/board' } });
    if (fnError || !data?.url) { setError('Could not start Gmail connection.'); return; }
    window.location.href = data.url;
  }

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
        const row = (payload.new ?? {}) as { id?: string };
        if (payload.eventType === 'INSERT') {
          setLiveNew((n) => n + 1);
          if (row.id) setFlashIds((prev) => new Set(prev).add(row.id as string));
        }
        void loadAll();
        void loadSubjects();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [account?.id, loadAll, loadSubjects]);

  // "(3) Board" in the browser tab while new matches arrive.
  useEffect(() => {
    const base = 'Board · ProfilePush';
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

  function openLead(card: Card) {
    navigate(`/feed/${card.lead_kind}/${card.lead_id}`);
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
    if (view.stage === 'new') return 'No new matches in the last 2 hours. Tap ↻ to rematch.';
    return `No ${isVendor ? 'invites' : 'submits'} today.`;
  };
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
            gmailConnected={gmailConnected}
            isNarrowed
            onClearSelection={() => setSelected({ subjectId: '', ids: new Set() })}
            onConnectGmail={() => { void connectGmail(); }}
            onDone={() => { setSelected({ subjectId: '', ids: new Set() }); void loadAll(); void loadSubjects(); }}
          />
        </div>
      )}

      {subjects && subjects.length === 0 && (
        <div className="mx-auto mt-16 max-w-sm text-center">
          <p className="text-[14px] text-gray-700">{isVendor ? 'Post a requirement and its matching consultants show up here, live.' : 'Add your consultants and their matching requirements show up here, live.'}</p>
          <button type="button" onClick={() => navigate('/match')} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700">
            {isVendor ? 'Post a requirement' : 'Add consultants'}
          </button>
        </div>
      )}

      {/* A column per consultant (or requirement), each with its own stage icons */}
      <div className="min-h-0 flex-1 overflow-x-auto">
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
            const colCounts = counts[sid] ?? {};
            const range = view.range;
            return (
              <section key={sid} className="flex h-full w-[280px] flex-col rounded-xl border border-gray-200 bg-gray-100/70">
                <header className="shrink-0 px-3 pt-2.5">
                  <p className="truncate text-[13px] font-semibold text-gray-800" title={subjectTitle(subject)}>{subjectTitle(subject)}</p>
                  {subject.detail && <p className="mt-0.5 truncate text-[11px] text-gray-500">{subject.detail}</p>}


                  {/* Stage switcher (drop a New card on Submitted to mark it sent) and rematch */}
                  <div className="mt-2 flex gap-0.5 rounded-lg bg-white p-0.5">
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
                          className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold transition ${active ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'} ${overTarget === target ? 'ring-2 ring-blue-400' : ''}`}
                        >
                          {st.label}
                          {n > 0 && (
                            <span className={`min-w-[16px] rounded-full px-1 text-center text-[10px] font-bold leading-[15px] tabular-nums ${st.id === 'new' && !active ? 'bg-green-600 text-white' : active ? 'bg-white text-blue-700' : 'bg-gray-200 text-gray-700'}`}>{n}</span>
                          )}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      title="Rematch: find fresh matches now"
                      aria-label="Rematch"
                      onClick={() => void rematch(subject)}
                      disabled={rematching === sid}
                      className="flex h-8 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 disabled:opacity-60"
                    >
                      <RefreshCw size={14} className={rematching === sid ? 'animate-spin' : ''} />
                    </button>
                  </div>

                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="text-[11px] tabular-nums text-gray-500">{loaded ? `${list.length} shown` : '…'}</span>
                    {view.stage === 'new' && list.some((c) => c.has_email) && (
                      <button type="button" onClick={() => selectAll(sid, list)} className="text-[11px] font-semibold text-blue-700 hover:underline">
                        {selected.subjectId === sid && selected.ids.size > 0 ? 'Clear' : 'Select all'}
                      </button>
                    )}
                    <select
                      aria-label="Date range"
                      value={range.preset}
                      onChange={(e) => {
                        const preset = e.target.value as RangePreset;
                        setColumnView(sid, { stage: view.stage, range: preset === 'custom' ? { preset, from: isoDay(daysFrom(startOfToday(), -6)), to: isoDay(startOfToday()) } : { preset } });
                      }}
                      className={`ml-auto rounded-md border bg-white px-1 py-0.5 text-[11px] ${range.preset !== defaultRange(view.stage).preset ? 'border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600'}`}
                    >
                      {(Object.keys(RANGE_LABELS) as RangePreset[]).filter((p) => p !== '2h' || view.stage === 'new').map((p) => <option key={p} value={p}>{RANGE_LABELS[p]}</option>)}
                    </select>
                  </div>
                  {range.preset === 'custom' && (
                    <div className="mt-1 flex items-center gap-1">
                      <input type="date" aria-label="From" value={range.from ?? ''} max={range.to} onChange={(e) => setColumnView(sid, { stage: view.stage, range: { ...range, from: e.target.value } })} className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-1 py-0.5 text-[11px] text-gray-700" />
                      <span className="text-[11px] text-gray-400">–</span>
                      <input type="date" aria-label="To" value={range.to ?? ''} min={range.from} onChange={(e) => setColumnView(sid, { stage: view.stage, range: { ...range, to: e.target.value } })} className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-1 py-0.5 text-[11px] text-gray-700" />
                    </div>
                  )}
                </header>

                <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {!loaded && <p className="px-2 py-6 text-center text-[11px] text-gray-400">Loading…</p>}
                  {loaded && list.length === 0 && <p className="px-2 py-6 text-center text-[11px] text-gray-400">{emptyText(view)}</p>}
                  {list.map((card) => (
                    <article
                      key={card.id}
                      draggable
                      onDragStart={() => setDragId(card.id)}
                      onDragEnd={() => { setDragId(''); setOverTarget(''); }}
                      className={`cursor-grab rounded-lg border bg-white p-3 shadow-sm transition active:cursor-grabbing ${flashIds.has(card.id) ? 'border-green-400 ring-2 ring-green-200' : 'border-gray-200'} ${dragId === card.id ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-start gap-2">
                      {card.stage === 'new' && card.has_email && (
                        <input
                          type="checkbox"
                          aria-label="Select for bulk"
                          checked={selected.subjectId === sid && selected.ids.has(card.id)}
                          onChange={() => toggleSelect(card)}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-blue-600"
                        />
                      )}
                      <button type="button" onClick={() => openLead(card)} className="block min-w-0 flex-1 text-left">
                        <p className="text-[13px] font-semibold leading-snug text-gray-900">{card.lead_kind === 'hotlist' ? consultantTitle(card.title) : card.title}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
                          {card.location && <span className="inline-flex items-center gap-0.5"><MapPin size={10} /> {card.location}</span>}
                          {rateText(card.rate_min, card.rate_max) && <span>{rateText(card.rate_min, card.rate_max)}</span>}
                          {card.detail && <span>{card.detail}</span>}
                        </p>
                        <p className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
                          <span className="inline-flex items-center gap-0.5"><Clock3 size={10} /> posted {timeAgo(card.posted_at)}</span>
                          {card.similarity != null && <span className="font-semibold text-green-700">{Math.round(card.similarity * 100)}% match</span>}
                        </p>
                      </button>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5">
                        {card.stage === 'new' && (
                          <>
                            {card.has_email && (
                              <button type="button" onClick={() => openLead(card)} className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700">
                                <Sparkles size={11} /> {submitLabel}
                              </button>
                            )}
                            <button type="button" onClick={() => void move(card, 'closed', 'skipped')} className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-100">
                              <X size={11} /> Skip
                            </button>
                          </>
                        )}
                        {card.conversation_id && card.stage !== 'new' && (
                          <button type="button" onClick={() => navigate(`/inbox/${card.conversation_id}`)} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-200">
                            <MessageSquare size={11} /> {card.stage === 'replied' ? 'Replied · open' : 'Conversation'}
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
