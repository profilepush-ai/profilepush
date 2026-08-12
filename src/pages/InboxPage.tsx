import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, Check, CheckCheck, Clock3, Inbox,
  Copy, Loader2, Mail, Search, X,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';

type ConversationStatus = 'pending' | 'open' | 'replied' | 'closed' | 'failed';
type InboxRangeId = '24h' | '3d' | '7d' | '15d' | '30d';

const INBOX_RANGE_OPTIONS: Array<{ id: InboxRangeId; label: string; hours: number }> = [
  { id: '24h', label: 'Last 24 hours', hours: 24 },
  { id: '3d', label: 'Last 3 days', hours: 72 },
  { id: '7d', label: 'Last 7 days', hours: 168 },
  { id: '15d', label: 'Last 15 days', hours: 360 },
  { id: '30d', label: 'Last 30 days', hours: 720 },
];

type RadarBreakdownEntry = {
  job_value?: string;
  rule?: string;
};

type SocialJobDetails = {
  job_title: string | null;
  platform: string | null;
  posted_by_name: string | null;
  company_name: string | null;
  posted_at: string | null;
  created_at: string;
};

type SocialHotlistDetails = {
  role_title: string | null;
  platform: string | null;
  bench_sales_recruiter_name: string | null;
  bench_sales_company_name: string | null;
  posted_at: string | null;
  created_at: string;
};

type Conversation = {
  id: string;
  vendor_name: string;
  vendor_email: string;
  sender_name: string;
  subject: string;
  status: ConversationStatus;
  unread_count: number;
  last_message_at: string;
  created_at: string;
  job_id: string | null;
  hotlist_id: string | null;
  social_jobs: SocialJobDetails | null;
  social_hotlist: SocialHotlistDetails | null;
  radar_job_details: Record<string, RadarBreakdownEntry | number> | null;
};

function leadIdOf(conversation: Pick<Conversation, 'id' | 'job_id' | 'hotlist_id'>): string {
  return conversation.job_id ?? conversation.hotlist_id ?? conversation.id;
}

type Message = {
  id: string;
  direction: 'outbound' | 'inbound';
  sender_type: 'user' | 'vendor' | 'system';
  from_email: string;
  to_email: string;
  subject: string;
  text_body: string;
  display_text: string | null;
  display_text_status: 'pending' | 'complete' | 'failed' | null;
  status: 'queued' | 'accepted' | 'delivered' | 'temporary_failed' | 'failed' | 'received';
  error_message: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
  vendor_message_events: Array<{
    event_type: string;
    occurred_at: string;
  }>;
};

function messageDeliveryState(message: Message) {
  const opened = message.vendor_message_events.find((event) => event.event_type === 'opened');
  if (opened) return { label: 'Opened', occurredAt: opened.occurred_at, opened: true };
  const delivered = message.vendor_message_events.find((event) => event.event_type === 'delivered');
  if (delivered || message.status === 'delivered') {
    return { label: 'Delivered', occurredAt: delivered?.occurred_at || message.sent_at || message.created_at, opened: false };
  }
  return null;
}

const STATUS_LABELS: Record<ConversationStatus, string> = {
  pending: 'Pending',
  open: 'Open',
  replied: 'Replied',
  closed: 'Closed',
  failed: 'Failed',
};

function formatRelative(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function maskName(name: string) {
  const trimmed = name.trim();
  return trimmed ? `${trimmed.slice(0, 3)}***` : 'Hidden';
}

function maskNameInText(text: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return text;
  const escapedName = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escapedName, 'gi'), maskName(trimmed));
}

function restoreSenderName(text: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return text;
  const masked = maskName(trimmed).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(masked, 'gi'), trimmed);
}

function maskedEmailHint(value: string) {
  const [localPart = '', domainPart = ''] = value.trim().split('@');
  const prefix = (localPart.slice(0, 3) || '***').replace(/\s+/g, '');
  const extension = domainPart.includes('.') ? domainPart.split('.').pop()?.trim() : '';
  return extension ? `${prefix}**@***.${extension}` : `${prefix}**@***`;
}

const JOB_DETAIL_FIELDS = [
  { keys: ['experience_match'], label: 'Exp' },
  { keys: ['work_type_match'], label: 'Work Type' },
  { keys: ['employment_type_match'], label: 'Emp Type' },
  { keys: ['hourly_rate_match', 'rate_match'], label: 'Rate' },
  { keys: ['visa_match'], label: 'Visa' },
  { keys: ['location_match'], label: 'Location' },
  { keys: ['skills_match'], label: 'Skills' },
] as const;

type DisplayJobDetail = { key: string; label: string; value: string };

function getJobDisplayDetails(breakdown: Conversation['radar_job_details'], includeMissing = false): DisplayJobDetail[] {
  return JOB_DETAIL_FIELDS.map(({ keys, label }) => {
    const entry = keys
      .map((key) => breakdown?.[key])
      .find((value): value is RadarBreakdownEntry => typeof value === 'object' && value !== null);
    const value = entry?.job_value?.trim();
    return { key: keys[0], label, value: value && value !== 'Not specified' ? value : '-' };
  }).filter((detail) => includeMissing || detail.value !== '-');
}

function getJobSummary(breakdown: Conversation['radar_job_details']) {
  const details = getJobDisplayDetails(breakdown).filter((detail) => detail.label !== 'Skills');
  return details.length > 0
    ? details.map(({ label, value }) => `${label}: ${value}`).join(' · ')
    : 'Job details not provided';
}

function JobDetailGrid({ details }: { details: DisplayJobDetail[] }) {
  const primaryDetails = details.filter((detail) => detail.label !== 'Skills');
  const skills = details.find((detail) => detail.label === 'Skills');

  return (
    <div className="rounded-md bg-gray-50 px-2.5 py-2 text-left">
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
        {primaryDetails.map(({ key, label, value }) => (
          <div key={key} className="min-w-0">
            <dt className="text-[9px] uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className="break-words text-[9px] leading-tight text-gray-700">{value}</dd>
          </div>
        ))}
      </dl>
      {skills && (
        <div className="mt-2 min-w-0">
          <div className="text-[9px] uppercase tracking-wide text-gray-500">Skills</div>
          <div className="break-words text-[9px] leading-tight text-gray-700">{skills.value}</div>
        </div>
      )}
    </div>
  );
}

function JobReferenceCard({ conversation, revealed }: { conversation: Conversation; revealed: boolean }) {
  const job = conversation.social_jobs;
  const hotlist = conversation.social_hotlist;
  const details = getJobDisplayDetails(conversation.radar_job_details, true);
  const title = job?.job_title || hotlist?.role_title || (conversation.hotlist_id ? 'Available Consultant' : 'Job opportunity');
  const posterName = job?.posted_by_name?.trim() || hotlist?.bench_sales_recruiter_name?.trim() || conversation.vendor_name;
  const companyName = job?.company_name || hotlist?.bench_sales_company_name || '';
  const platform = job?.platform || hotlist?.platform || '';
  const postedAt = job?.posted_at || hotlist?.posted_at || job?.created_at || hotlist?.created_at || conversation.created_at;

  return (
    <section className="mb-5 rounded-lg border border-gray-300 bg-white px-3 py-2.5 shadow-sm">
      <p className="text-xs font-semibold leading-snug text-gray-900">{title}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] text-gray-500">
        <span>{formatRelative(postedAt)}</span>
        <span>•</span>
        <span>Posted by {revealed ? posterName : maskName(posterName)}</span>
        {companyName && <><span>•</span><span>{revealed ? companyName : `${companyName.slice(0, 3)}***`}</span></>}
        {platform && <><span>•</span><span className="font-bold uppercase text-gray-500">{platform}</span></>}
      </div>
      <div className="mt-2">
      <JobDetailGrid details={details} />
      </div>
    </section>
  );
}

export default function InboxPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { user, account, refreshAccount } = useAuth();
  const { isDark } = useTheme();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(conversationId ?? null);
  const [messagesConversationId, setMessagesConversationId] = useState<string | null>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const lastAutoScrolledConversationId = useRef<string | null>(null);
  const [query, setQuery] = useState('');
  const [pendingQuery, setPendingQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'asked' | 'replied'>('all');
  const [rangeId, setRangeId] = useState<InboxRangeId>('7d');
  const [isRangeMenuOpen, setIsRangeMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [revealedJobIds, setRevealedJobIds] = useState<Set<string>>(new Set());
  const [revealingJobId, setRevealingJobId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const loadConversations = useCallback(async () => {
    const { data, error } = await supabase
      .from('vendor_conversations')
      .select('id, vendor_name, vendor_email, sender_name, subject, status, unread_count, last_message_at, created_at, job_id, hotlist_id, social_jobs(job_title, platform, posted_by_name, company_name, posted_at, created_at), social_hotlist(role_title, platform, bench_sales_recruiter_name, bench_sales_company_name, posted_at, created_at)')
      .order('last_message_at', { ascending: false });
    if (error) {
      setToast({ message: 'Could not load inbox', type: 'error' });
      return;
    }
    const conversationRows = (data ?? []) as unknown as Omit<Conversation, 'radar_job_details'>[];
    const jobIds = [...new Set(conversationRows.map((row) => row.job_id).filter((id): id is string => Boolean(id)))];
    const hotlistIds = [...new Set(conversationRows.map((row) => row.hotlist_id).filter((id): id is string => Boolean(id)))];
    const [{ data: radarRows }, { data: hotlistRadarRows }] = await Promise.all([
      jobIds.length > 0
        ? supabase
          .from('radar_match_results')
          .select('job_id, score_breakdown, created_at')
          .eq('job_source', 'social')
          .in('job_id', jobIds)
          .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
      hotlistIds.length > 0
        ? supabase
          .from('radar_match_hotlist')
          .select('hotlist_id, score_breakdown, created_at')
          .in('hotlist_id', hotlistIds)
          .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);
    const breakdownByLeadId = new Map<string, Conversation['radar_job_details']>();
    for (const row of (radarRows ?? []) as Array<{ job_id: string; score_breakdown: Conversation['radar_job_details'] }>) {
      if (!breakdownByLeadId.has(row.job_id)) breakdownByLeadId.set(row.job_id, row.score_breakdown);
    }
    for (const row of (hotlistRadarRows ?? []) as Array<{ hotlist_id: string; score_breakdown: Conversation['radar_job_details'] }>) {
      if (!breakdownByLeadId.has(row.hotlist_id)) breakdownByLeadId.set(row.hotlist_id, row.score_breakdown);
    }
    const rows: Conversation[] = conversationRows.map((row) => ({
      ...row,
      radar_job_details: breakdownByLeadId.get(leadIdOf(row)) ?? null,
    }));
    const leadIds = [...new Set(rows.map((row) => leadIdOf(row)))];
    if (leadIds.length > 0 && user?.id) {
      const { data: actionRows } = await supabase
        .from('pulse_lead_actions')
        .select('lead_id')
        .in('lead_id', leadIds)
        .eq('user_id', user.id)
        .eq('action_type', 'revealed');
      setRevealedJobIds(new Set((actionRows ?? []).map((row) => row.lead_id)));
    }
    setConversations(rows);
    setSelectedId((current) => current ?? (window.matchMedia('(min-width: 640px)').matches ? rows[0]?.id ?? null : null));
  }, [user?.id]);

  const loadMessages = useCallback(async (id: string) => {
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('vendor_messages')
      .select('id, direction, sender_type, from_email, to_email, subject, text_body, display_text, display_text_status, status, error_message, sent_at, received_at, created_at, vendor_message_events(event_type, occurred_at)')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });
    setLoadingMessages(false);
    if (error) {
      setToast({ message: 'Could not load messages', type: 'error' });
      return;
    }
    setMessages((data ?? []) as Message[]);
    setMessagesConversationId(id);
  }, []);

  useEffect(() => {
    void loadConversations().finally(() => setLoading(false));
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setMessagesConversationId(null);
      lastAutoScrolledConversationId.current = null;
      return;
    }
    setMessagesConversationId(null);
    void loadMessages(selectedId);
    void supabase.rpc('update_own_vendor_conversation', {
      p_conversation_id: selectedId,
      p_action: 'read',
    }).then(() => setConversations((current) => current.map((item) => (
      item.id === selectedId ? { ...item, unread_count: 0 } : item
    ))));
  }, [loadMessages, selectedId]);

  useEffect(() => {
    if (!selectedId || messagesConversationId !== selectedId || lastAutoScrolledConversationId.current === selectedId) return;
    const frame = requestAnimationFrame(() => {
      const scrollContainer = threadScrollRef.current;
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
      lastAutoScrolledConversationId.current = selectedId;
    });
    return () => cancelAnimationFrame(frame);
  }, [messagesConversationId, selectedId]);

  useEffect(() => {
    const channel = supabase
      .channel('vendor-inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_conversations' }, () => {
        void loadConversations();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_messages' }, (payload) => {
        const row = payload.new as { conversation_id?: string };
        if (row.conversation_id === selectedId) void loadMessages(selectedId);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vendor_message_events' }, () => {
        if (selectedId) void loadMessages(selectedId);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadConversations, loadMessages, selectedId]);

  useEffect(() => {
    setSelectedId(conversationId ?? null);
  }, [conversationId]);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const scopedConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const range = INBOX_RANGE_OPTIONS.find((option) => option.id === rangeId) ?? INBOX_RANGE_OPTIONS[2];
    const cutoff = Date.now() - range.hours * 60 * 60 * 1000;
    return conversations.filter((item) => {
      if (new Date(item.last_message_at).getTime() < cutoff) return false;
      if (!normalized) return true;
      return [item.vendor_name, item.vendor_email, item.subject, item.social_jobs?.job_title, item.social_hotlist?.role_title]
        .some((value) => value?.toLowerCase().includes(normalized));
    });
  }, [conversations, query, rangeId]);

  const tabCounts = useMemo(() => ({
    all: scopedConversations.length,
    asked: scopedConversations.filter((item) => ['pending', 'open'].includes(item.status)).length,
    replied: scopedConversations.filter((item) => item.status === 'replied').length,
  }), [scopedConversations]);

  const filtered = useMemo(() => scopedConversations.filter((item) => {
    if (filter === 'asked') return ['pending', 'open'].includes(item.status);
    if (filter === 'replied') return item.status === 'replied';
    return true;
  }), [filter, scopedConversations]);

  function selectConversation(id: string) {
    navigate(`/inbox/${id}`, { replace: true });
  }

  async function revealEmail(conversation: Conversation) {
    if (!user || !account?.id || revealingJobId) {
      if (!user) setToast({ message: 'Please sign in to reveal contact details', type: 'error' });
      return;
    }

    const leadId = leadIdOf(conversation);
    setRevealingJobId(leadId);
    try {
      const metadata = {
        lead_id: leadId,
        platform: 'social',
        title: conversation.social_jobs?.job_title || conversation.social_hotlist?.role_title || conversation.subject,
      };
      let { data, error } = await supabase.rpc('consume_feature_credit', {
        p_account_id: account.id,
        p_amount: 0.25,
        p_feature: 'pulse_reveal_contact',
        p_metadata: metadata,
      });

      if (error) {
        const retry = await supabase.rpc('consume_feature_credit', {
          p_account_id: account.id,
          p_amount: 0.25,
          p_feature: 'pulse_reveal_contact',
        });
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        const { data: accountRow, error: accountError } = await supabase
          .from('accounts')
          .select('credits_balance')
          .eq('id', account.id)
          .maybeSingle();
        const currentBalance = Number(accountRow?.credits_balance ?? 0);
        if (accountError || currentBalance < 0.25) {
          setToast({ message: accountError ? 'Could not load credits balance' : 'Insufficient credits', type: 'error' });
          return;
        }
        const { error: updateError } = await supabase
          .from('accounts')
          .update({ credits_balance: Number((currentBalance - 0.25).toFixed(4)) })
          .eq('id', account.id);
        if (updateError) {
          setToast({ message: 'Could not update credits balance', type: 'error' });
          return;
        }
        await supabase.from('credit_transactions').insert({
          account_id: account.id,
          user_id: user.id,
          type: 'usage',
          amount: -0.25,
          description: 'Pulse: pulse_reveal_contact',
        });
      } else {
        const row = Array.isArray(data) ? data[0] : null;
        if (!row?.success) {
          setToast({ message: String(row?.message ?? 'Insufficient credits'), type: 'error' });
          return;
        }
      }

      await supabase.from('pulse_lead_actions').upsert({
        account_id: account.id,
        user_id: user.id,
        lead_id: leadId,
        action_type: 'revealed',
      }, {
        onConflict: 'account_id,user_id,lead_id,action_type',
        ignoreDuplicates: true,
      });
      setRevealedJobIds((current) => new Set(current).add(leadId));
      await refreshAccount();
      setToast({ message: '$0.25 credits consumed for reveal', type: 'success' });
    } finally {
      setRevealingJobId(null);
    }
  }

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-gray-50 text-gray-900">
      <AppNav />
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden sm:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[310px_minmax(0,1fr)]">
        <aside className={`${selectedId ? 'hidden sm:flex' : 'flex'} min-h-0 flex-col border-r border-gray-200 bg-white`}>
          <div className="border-b border-gray-200 bg-white px-1.5 pb-1.5 pt-1.5 dark:border-white/10 dark:bg-[#1B1D21]">
            <div className="flex items-center gap-2">
              <div className="relative flex flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5">
                <Search size={11} className="shrink-0 text-gray-400" />
                <input
                  value={pendingQuery}
                  onChange={(event) => setPendingQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      setQuery(pendingQuery.trim());
                    }
                  }}
                  placeholder="Search vendor or job"
                  className="w-full border-0 bg-transparent text-[11px] text-gray-700 outline-none placeholder:text-gray-400"
                />
                {pendingQuery && (
                  <button type="button" onClick={() => { setPendingQuery(''); setQuery(''); }} className="rounded-full p-0.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600" aria-label="Clear search field">
                    <X size={11} />
                  </button>
                )}
              </div>
              <button type="button" onClick={() => setQuery(pendingQuery.trim())} className="rounded-full border border-blue-600 bg-blue-600 p-1.5 text-white transition hover:bg-blue-700" aria-label="Search">
                <Search size={12} />
              </button>
              <div className="relative shrink-0">
                <button type="button" onClick={() => setIsRangeMenuOpen((open) => !open)} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1.5 text-[10px] font-semibold text-gray-600 transition hover:bg-gray-100" aria-label="Change date range">
                  <Clock3 size={11} />
                  <span>{rangeId}</span>
                </button>
                {isRangeMenuOpen && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-[116px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                    {INBOX_RANGE_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => { setRangeId(option.id); setIsRangeMenuOpen(false); }}
                        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[10px] font-semibold transition ${option.id === rangeId ? (isDark ? 'bg-[#2A2E35] text-slate-100' : 'bg-gray-100 text-gray-800') : 'text-gray-600 hover:bg-gray-50'}`}
                      >
                        <span>{option.label}</span>
                        {option.id === rangeId && <Check size={11} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-1.5 grid w-full grid-cols-3 gap-1">
              {(['all', 'asked', 'replied'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFilter(option)}
                  className={`inline-flex w-full items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold capitalize transition ${filter === option ? (isDark ? 'border border-white/25 bg-[#22262c] text-slate-100' : 'border border-blue-600 bg-blue-600 text-white') : (isDark ? 'border border-transparent bg-[#171a1f] text-[#94A3B8] hover:bg-[#1e2228] hover:text-slate-300' : 'border border-blue-200 bg-white text-blue-600 hover:bg-blue-50')}`}
                >
                  <span>{option}</span>
                  <span>{tabCounts[option]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-0">
            {loading ? (
              <div className="flex h-40 items-center justify-center"><Loader2 size={18} className="animate-spin text-blue-600" /></div>
            ) : filtered.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center px-6 text-center text-gray-400">
                <Inbox size={26} />
                <p className="mt-3 text-xs font-semibold text-gray-600">No conversations found</p>
                <p className="mt-1 text-[11px]">Ask a vendor from Jobs to start a thread.</p>
              </div>
            ) : filtered.map((item) => (
              <button key={item.id} type="button" onClick={() => selectConversation(item.id)} className={`flex w-full border-b border-gray-100 px-3 py-3 text-left transition-colors ${selectedId === item.id ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate text-xs ${item.unread_count > 0 ? 'font-bold text-gray-950' : 'font-semibold text-gray-800'}`}>{item.social_jobs?.job_title || item.social_hotlist?.role_title || 'Vendor request'}</span>
                    <span className="shrink-0 text-[10px] text-gray-400">{formatRelative(item.last_message_at)}</span>
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 whitespace-normal break-words text-[9px] leading-3 text-gray-400">{getJobSummary(item.radar_job_details)}</span>
                    {item.unread_count > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white">{item.unread_count}</span>}
                  </span>
                  <span className="mt-1 flex items-center">
                    <span className={`shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide ${item.hotlist_id ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>{item.hotlist_id ? 'Hotlist' : 'Job'}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className={`${selectedId ? 'flex' : 'hidden sm:flex'} min-h-0 min-w-0 flex-col overflow-hidden bg-white`}>
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center text-gray-400">
              <Mail size={32} />
              <p className="mt-3 text-sm font-semibold text-gray-600">Select a conversation</p>
            </div>
          ) : (
            <div ref={threadScrollRef} className="min-h-0 flex-1 overflow-y-auto bg-white">
              <header className="sticky top-0 z-10 flex h-12 items-center gap-1 border-b border-gray-200 bg-white px-2 sm:px-3">
                <button type="button" onClick={() => navigate('/inbox', { replace: true })} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 sm:hidden" title="Back to conversations">
                  <ArrowLeft size={16} />
                </button>
                <div className="flex-1" />
                <span className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${selected.hotlist_id ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>{selected.hotlist_id ? 'Hotlist' : 'Job'}</span>
                <span className={`rounded px-2 py-1 text-[10px] font-semibold ${selected.status === 'failed' ? 'bg-red-50 text-red-700' : selected.status === 'replied' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{STATUS_LABELS[selected.status]}</span>
              </header>

              <div className="mx-auto max-w-5xl px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-5 sm:px-8 sm:py-7">
                  <JobReferenceCard conversation={selected} revealed={revealedJobIds.has(leadIdOf(selected))} />
                  {loadingMessages ? (
                    <div className="flex h-32 items-center justify-center"><Loader2 size={18} className="animate-spin text-blue-600" /></div>
                  ) : messages.map((message) => {
                    const outbound = message.direction === 'outbound';
                    const deliveryState = outbound ? messageDeliveryState(message) : null;
                    const emailRevealed = revealedJobIds.has(leadIdOf(selected));
                    const outboundText = restoreSenderName(emailRevealed ? message.text_body : maskNameInText(message.text_body, selected.vendor_name), selected.sender_name);
                    const messageText = outbound
                      ? outboundText
                      : message.display_text_status === 'complete' && message.display_text
                        ? message.display_text
                        : message.display_text_status === 'failed'
                          ? 'This reply could not be prepared for private display.'
                          : 'Reply received. Preparing a private version.';
                    return (
                      <article key={message.id} className={`mb-3 flex last:mb-0 ${outbound ? 'justify-end' : 'justify-start'}`}>
                        <div className={`w-fit max-w-[92%] rounded-lg border px-3 py-3 sm:max-w-2xl ${outbound ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                          <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-gray-800">{messageText}</p>
                          <div className="mt-3 flex flex-col gap-2 border-t border-gray-200/80 pt-2.5 sm:flex-row sm:items-center">
                            <div className="flex items-center justify-between gap-2 sm:justify-start">
                              <span className="inline-flex min-w-0 items-center gap-1 text-[10px] font-medium text-gray-500">
                                {outbound && (message.status === 'failed' || message.status === 'temporary_failed') ? <><AlertCircle size={11} className="text-red-600" /> <span className="text-red-600">Failed</span></> : deliveryState ? <><CheckCheck size={11} className={deliveryState.opened ? 'text-emerald-600' : 'text-blue-600'} /> <span className={deliveryState.opened ? 'text-emerald-700' : ''}>{deliveryState.label}</span></> : <span>{outbound ? 'Sent' : 'Received'}</span>}
                              </span>
                              <span className="shrink-0 text-[10px] text-gray-500">{formatMessageTime(message.sent_at || message.received_at || message.created_at)}</span>
                            </div>
                            {emailRevealed ? (
                              <button
                                type="button"
                                onClick={() => void navigator.clipboard.writeText(selected.vendor_email).then(() => setToast({ message: 'Vendor email copied', type: 'success' }))}
                                className="inline-flex w-full shrink-0 items-center justify-center gap-1 rounded-md border border-blue-300 bg-transparent px-2 py-1.5 text-[10px] font-semibold text-blue-600 transition-all hover:shadow-[0_0_0_1px_rgba(37,99,235,0.20),0_0_14px_rgba(37,99,235,0.16)] dark:border-cyan-500/30 dark:text-cyan-400 sm:ml-auto sm:w-auto sm:px-2.5"
                              >
                                <Copy size={11} /> Email
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void revealEmail(selected)}
                                disabled={revealingJobId === leadIdOf(selected)}
                                className="inline-flex w-full shrink-0 items-center justify-center gap-1 rounded-md border border-blue-300 bg-transparent px-2 py-1.5 text-[10px] font-semibold text-blue-600 transition-all hover:shadow-[0_0_0_1px_rgba(37,99,235,0.20),0_0_14px_rgba(37,99,235,0.16)] disabled:cursor-not-allowed disabled:opacity-70 dark:border-cyan-500/30 dark:text-cyan-400 sm:ml-auto sm:w-auto sm:px-2.5"
                              >
                                {revealingJobId === leadIdOf(selected) ? '...' : <><Copy size={11} /><span>{maskedEmailHint(selected.vendor_email)}</span></>}
                              </button>
                            )}
                          </div>
                          {message.error_message && <p className="mt-2 text-[10px] text-red-600">{message.error_message}</p>}
                        </div>
                      </article>
                    );
                  })}

              </div>
            </div>
          )}
        </section>
      </main>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}