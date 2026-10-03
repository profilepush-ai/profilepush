import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, MapPin, MessageSquare, Sparkles, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { timeAgo } from '../lib/publishers';
import { consultantTitle } from '../lib/consultant-title';

// The Board: one pipeline per consultant (bench sales) or per requirement
// (vendors). Every match is a card in New; sending an AI Submit moves it to
// Submitted and a vendor reply to Replied, on the server. Interview and
// Closed are set here, by dragging a card or with its Move to menu. New
// matches arrive live (realtime on pipeline_cards) and the tab title counts
// them while the page is open.

type Stage = 'new' | 'submitted' | 'replied' | 'interview' | 'closed';

type Subject = { subject_id: string; title: string; detail: string | null; created_at: string; new_count: number; active_count: number };

type Card = {
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
};

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: 'new', label: 'New matches' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'replied', label: 'Replied' },
  { id: 'interview', label: 'Interview' },
  { id: 'closed', label: 'Closed' },
];

function rateText(min: number | null, max: number | null): string {
  if (min && max && min !== max) return `$${min}–${max}/hr`;
  if (min || max) return `$${min || max}/hr`;
  return '';
}

export default function BoardPage() {
  const navigate = useNavigate();
  const { account } = useAuth();
  const isVendor = account?.active_persona === 'vendor';
  // Bench sales: each consultant (a hotlist row) is a pipeline of requirements.
  // Vendors: each requirement is a pipeline of consultants.
  const subjectKind: 'hotlist' | 'job' = isVendor ? 'job' : 'hotlist';
  const submitLabel = isVendor ? 'AI Invite' : 'AI Submit';

  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState('');
  const [dragId, setDragId] = useState('');
  const [overStage, setOverStage] = useState<Stage | ''>('');
  const [liveNew, setLiveNew] = useState(0);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const selectedRef = useRef('');
  selectedRef.current = selected;

  const loadSubjects = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('get_pipeline_subjects' as never, { p_kind: subjectKind } as never);
    if (rpcError) { setError('Could not load your board.'); setSubjects([]); return; }
    const rows = (data as Subject[] | null) ?? [];
    setSubjects(rows);
    setSelected((current) => (current && rows.some((s) => s.subject_id === current) ? current : rows[0]?.subject_id ?? ''));
  }, [subjectKind]);

  const loadCards = useCallback(async (subjectId: string) => {
    if (!subjectId) { setCards([]); return; }
    const { data, error: rpcError } = await supabase.rpc('get_pipeline_cards' as never, { p_subject_id: subjectId } as never);
    if (rpcError) { setError('Could not load matches.'); setCards([]); return; }
    setCards((data as Card[] | null) ?? []);
  }, []);

  useEffect(() => { if (account?.id) void loadSubjects(); }, [account?.id, loadSubjects]);
  useEffect(() => { setCards(null); void loadCards(selected); }, [selected, loadCards]);

  // Live: new matches and stage changes made elsewhere (a submit sent from
  // the feed, a vendor reply) show up without a refresh.
  useEffect(() => {
    if (!account?.id) return;
    const channel = supabase
      .channel(`board-${account.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pipeline_cards', filter: `account_id=eq.${account.id}` }, (payload) => {
        const row = (payload.new ?? {}) as { id?: string; subject_id?: string; stage?: Stage };
        if (payload.eventType === 'INSERT') {
          setLiveNew((n) => n + 1);
          if (row.id) setFlashIds((prev) => new Set(prev).add(row.id as string));
        }
        if (row.subject_id && row.subject_id === selectedRef.current) void loadCards(row.subject_id);
        void loadSubjects();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [account?.id, loadCards, loadSubjects]);

  // "(3) Board" in the tab while new matches arrive and the tab is open.
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

  async function move(card: Card, stage: Stage, reason?: string) {
    if (card.stage === stage) return;
    const previous = cards;
    setCards((prev) => (prev ?? []).map((c) => (c.id === card.id ? { ...c, stage, stage_changed_at: new Date().toISOString() } : c)));
    const { error: rpcError } = await supabase.rpc('move_pipeline_card' as never, { p_id: card.id, p_stage: stage, p_reason: reason ?? null } as never);
    if (rpcError) { setCards(previous); setError('Could not move that card.'); return; }
    void loadSubjects();
  }

  function openLead(card: Card) {
    navigate(`/feed/${card.lead_kind}/${card.lead_id}`);
  }

  const byStage = useMemo(() => {
    const groups: Record<Stage, Card[]> = { new: [], submitted: [], replied: [], interview: [], closed: [] };
    for (const card of cards ?? []) groups[card.stage].push(card);
    return groups;
  }, [cards]);

  const current = subjects?.find((s) => s.subject_id === selected) ?? null;
  const subjectTitle = (s: Subject) => (subjectKind === 'hotlist' ? consultantTitle(s.title) : s.title);

  return (
    <div className="flex h-[100dvh] flex-col overscroll-none bg-gray-50 pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />

      {/* Consultant / requirement tabs */}
      <div className="shrink-0 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2 overflow-x-auto px-3 py-2 sm:px-6">
          {(subjects ?? []).map((s) => (
            <button
              key={s.subject_id}
              type="button"
              onClick={() => setSelected(s.subject_id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-left transition ${selected === s.subject_id ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
            >
              <span className={`max-w-[180px] truncate text-[13px] font-semibold ${selected === s.subject_id ? 'text-blue-700' : 'text-gray-800'}`}>{subjectTitle(s)}</span>
              {s.new_count > 0 && <span className="rounded-full bg-green-600 px-1.5 text-[10px] font-bold text-white tabular-nums">{s.new_count}</span>}
            </button>
          ))}
          {subjects && subjects.length === 0 && (
            <div className="flex items-center gap-3 py-1 text-[13px] text-gray-600">
              {isVendor ? 'Post a requirement and its matching consultants show up here, live.' : 'Add your consultants and their matching requirements show up here, live.'}
              <button type="button" onClick={() => navigate('/match')} className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700">
                {isVendor ? 'Post a requirement' : 'Add consultants'}
              </button>
            </div>
          )}
        </div>
        {current && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 text-[12px] text-gray-500 sm:px-6">
            {current.detail && <span>{current.detail}</span>}
            <span className="inline-flex items-center gap-1 text-green-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-600" /> Live: new matches appear here as they’re posted</span>
          </div>
        )}
      </div>

      {error && <p className="mx-3 mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 sm:mx-6">{error}</p>}

      {/* Stage columns */}
      <div className="min-h-0 flex-1 overflow-x-auto">
        <div className="flex h-full min-w-max gap-3 p-3 sm:px-6">
          {STAGES.map((stage) => (
            <section
              key={stage.id}
              onDragOver={(e) => { e.preventDefault(); setOverStage(stage.id); }}
              onDragLeave={() => setOverStage((s) => (s === stage.id ? '' : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOverStage('');
                const card = (cards ?? []).find((c) => c.id === dragId);
                if (card) void move(card, stage.id, stage.id === 'closed' ? 'closed' : undefined);
                setDragId('');
              }}
              className={`flex h-full w-[280px] flex-col rounded-xl border bg-gray-100/70 ${overStage === stage.id ? 'border-blue-400 bg-blue-50/60' : 'border-gray-200'}`}
            >
              <header className="flex shrink-0 items-center justify-between px-3 py-2.5">
                <span className="text-[13px] font-semibold text-gray-800">{stage.label}</span>
                <span className="rounded-full bg-white px-2 text-[11px] font-semibold tabular-nums text-gray-600">{byStage[stage.id].length}</span>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {!cards && stage.id === 'new' && <p className="px-1 py-4 text-center text-[12px] text-gray-500">Loading…</p>}
                {cards && byStage[stage.id].length === 0 && (
                  <p className="px-2 py-6 text-center text-[11px] text-gray-400">
                    {stage.id === 'new' ? 'No new matches yet. They appear here as they’re posted.' : stage.id === 'submitted' ? `Send an ${submitLabel} from a new match.` : stage.id === 'replied' ? 'Vendor replies land here.' : 'Drag a card here.'}
                  </p>
                )}
                {byStage[stage.id].map((card) => (
                  <article
                    key={card.id}
                    draggable
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => setDragId('')}
                    className={`cursor-grab rounded-lg border bg-white p-3 shadow-sm transition active:cursor-grabbing ${flashIds.has(card.id) ? 'border-green-400 ring-2 ring-green-200' : 'border-gray-200'} ${dragId === card.id ? 'opacity-50' : ''}`}
                  >
                    <button type="button" onClick={() => openLead(card)} className="block w-full text-left">
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
                    <div className="mt-2 flex items-center gap-1.5">
                      {card.stage === 'new' && (
                        <>
                          <button type="button" onClick={() => openLead(card)} className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700">
                            <Sparkles size={11} /> {submitLabel}
                          </button>
                          <button type="button" onClick={() => void move(card, 'closed', 'skipped')} className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-100">
                            <X size={11} /> Skip
                          </button>
                        </>
                      )}
                      {card.conversation_id && card.stage !== 'new' && (
                        <button type="button" onClick={() => navigate(`/inbox/${card.conversation_id}`)} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-200">
                          <MessageSquare size={11} /> {card.stage === 'replied' ? 'Reply' : 'Conversation'}
                        </button>
                      )}
                      <select
                        id={`move-${card.id}`}
                        aria-label="Move to"
                        value=""
                        onChange={(e) => { const to = e.target.value as Stage; if (to) void move(card, to, to === 'closed' ? 'closed' : undefined); }}
                        className="ml-auto rounded-md border border-gray-200 bg-white px-1.5 py-1 text-[11px] text-gray-600"
                      >
                        <option value="">Move to…</option>
                        {STAGES.filter((s) => s.id !== card.stage).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </div>
                    {card.stage === 'closed' && card.closed_reason && <p className="mt-1 text-[10px] uppercase tracking-wide text-gray-400">{card.closed_reason}</p>}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
