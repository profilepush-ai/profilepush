import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, Briefcase, Check, CheckCheck, Clock3, DollarSign, Download, GraduationCap, Inbox,
  Copy, Laptop, Loader2, Mail, MapPin, Paperclip, Search, Send, Shield, Sparkles, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

type ConversationStatus = 'pending' | 'open' | 'replied' | 'closed' | 'failed' | 'draft';
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
  source: 'sent' | 'draft' | 'chat';
  vendor_name: string;
  vendor_email: string;
  sender_name: string;
  subject: string;
  status: ConversationStatus;
  channel: 'mailgun' | 'gmail' | 'chat';
  unread_count: number;
  last_message_at: string;
  created_at: string;
  job_id: string | null;
  hotlist_id: string | null;
  social_jobs: SocialJobDetails | null;
  social_hotlist: SocialHotlistDetails | null;
  radar_job_details: Record<string, RadarBreakdownEntry | number> | null;
  /** Only set when source === 'draft' — the generated email body, shown copy-only. */
  draftEmailContent?: string;
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
  vendor_message_attachments: Array<{
    id: string;
    original_filename: string;
    content_type: string;
    size_bytes: number;
  }>;
  /** True for the synthesized message representing a generated-but-unsent draft. */
  isDraft?: boolean;
  /** True for a message from the post_chat_messages in-app chat table. */
  isChat?: boolean;
};

function draftMessage(conversation: Conversation): Message {
  return {
    id: conversation.id,
    direction: 'outbound',
    sender_type: 'user',
    from_email: '',
    to_email: conversation.vendor_email,
    subject: conversation.subject,
    text_body: conversation.draftEmailContent ?? '',
    display_text: null,
    display_text_status: null,
    status: 'queued',
    error_message: null,
    sent_at: null,
    received_at: null,
    created_at: conversation.created_at,
    vendor_message_events: [],
    vendor_message_attachments: [],
    isDraft: true,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  draft: 'Generated',
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

function getJobDisplayDetails(breakdown: Conversation['radar_job_details']): DisplayJobDetail[] {
  return JOB_DETAIL_FIELDS.map(({ keys, label }) => {
    const entry = keys
      .map((key) => breakdown?.[key])
      .find((value): value is RadarBreakdownEntry => typeof value === 'object' && value !== null);
    const value = entry?.job_value?.trim();
    return { key: keys[0], label, value: value && value !== 'Not specified' ? value : '-' };
  }).filter((detail) => detail.value !== '-');
}

function getJobSummary(breakdown: Conversation['radar_job_details']) {
  const details = getJobDisplayDetails(breakdown).filter((detail) => detail.label !== 'Skills');
  return details.length > 0
    ? details.map(({ label, value }) => `${label}: ${value}`).join(' · ')
    : 'Job details not provided';
}

const JOB_DETAIL_ICONS: Record<string, LucideIcon> = {
  experience_match: GraduationCap,
  work_type_match: Laptop,
  employment_type_match: Briefcase,
  hourly_rate_match: DollarSign,
  visa_match: Shield,
  location_match: MapPin,
};

function JobDetailGrid({ details }: { details: DisplayJobDetail[] }) {
  const primaryDetails = details.filter((detail) => detail.label !== 'Skills');
  const skills = details.find((detail) => detail.label === 'Skills');
  if (primaryDetails.length === 0 && !skills) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-left">
      {primaryDetails.map(({ key, label, value }) => {
        const Icon = JOB_DETAIL_ICONS[key];
        return (
          <span key={key} title={label} className="inline-flex max-w-full items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-medium text-gray-600">
            {Icon && <Icon size={11} className="shrink-0 text-gray-400" />}
            <span className="truncate">{value}</span>
          </span>
        );
      })}
      {skills && (
        <span className="w-full text-[10px] leading-relaxed text-gray-500">
          <span className="font-semibold text-gray-600">Skills: </span>{skills.value}
        </span>
      )}
    </div>
  );
}

function JobReferenceCard({ conversation }: { conversation: Conversation }) {
  const job = conversation.social_jobs;
  const hotlist = conversation.social_hotlist;
  const details = getJobDisplayDetails(conversation.radar_job_details);
  const title = job?.job_title || hotlist?.role_title || (conversation.hotlist_id ? 'Available Consultant' : 'Job opportunity');
  const posterName = job?.posted_by_name?.trim() || hotlist?.bench_sales_recruiter_name?.trim() || conversation.vendor_name;
  const companyName = job?.company_name || hotlist?.bench_sales_company_name || '';
  const postedAt = job?.posted_at || hotlist?.posted_at || job?.created_at || hotlist?.created_at || conversation.created_at;

  return (
    <section className="mb-5 rounded-lg border border-gray-300 bg-white px-3 py-2.5 shadow-sm">
      <p className="text-xs font-semibold leading-snug text-gray-900">{title}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] text-gray-500">
        <span>{formatRelative(postedAt)}</span>
        <span>•</span>
        <span>Posted by {posterName}</span>
        {companyName && <><span>•</span><span>{companyName}</span></>}
      </div>
      <JobDetailGrid details={details} />
    </section>
  );
}

export default function InboxPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { account } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(conversationId ?? null);
  const [messagesConversationId, setMessagesConversationId] = useState<string | null>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const lastAutoScrolledConversationId = useRef<string | null>(null);
  const [query, setQuery] = useState('');
  const [pendingQuery, setPendingQuery] = useState('');
  const [filter, setFilter] = useState<'recent' | 'job' | 'hotlist'>('recent');
  const [rangeId, setRangeId] = useState<InboxRangeId>('7d');
  const [isRangeMenuOpen, setIsRangeMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [draftingAiReply, setDraftingAiReply] = useState(false);

  const loadConversations = useCallback(async () => {
    if (!account?.id) return;
    const [{ data, error }, { data: previewData, error: previewError }, { data: chatData, error: chatError }] = await Promise.all([
      supabase
        .from('vendor_conversations')
        .select('id, vendor_name, vendor_email, sender_name, subject, status, channel, unread_count, last_message_at, created_at, job_id, hotlist_id, social_jobs(job_title, platform, posted_by_name, company_name, posted_at, created_at), social_hotlist(role_title, platform, bench_sales_recruiter_name, bench_sales_company_name, posted_at, created_at)')
        .order('last_message_at', { ascending: false }),
      supabase
        .from('pulse_ask_ai_previews' as never)
        .select('id, vendor_name, vendor_email, subject, email_content, job_id, hotlist_id, created_at, updated_at, social_jobs(job_title, platform, posted_by_name, company_name, posted_at, created_at), social_hotlist(role_title, platform, bench_sales_recruiter_name, bench_sales_company_name, posted_at, created_at)')
        .order('updated_at', { ascending: false }),
      supabase
        .from('post_chat_threads' as never)
        .select('id, subject, status, last_message_at, created_at, job_id, hotlist_id, owner_account_id, owner_display_name, owner_unread_count, participant_account_id, participant_display_name, participant_unread_count, social_jobs(job_title, platform, posted_by_name, company_name, posted_at, created_at), social_hotlist(role_title, platform, bench_sales_recruiter_name, bench_sales_company_name, posted_at, created_at)')
        .or(`owner_account_id.eq.${account.id},participant_account_id.eq.${account.id}`)
        .order('last_message_at', { ascending: false }),
    ]);
    if (error || previewError) {
      setToast({ message: 'Could not load inbox', type: 'error' });
      return;
    }
    if (chatError) {
      // Non-fatal: in-app chat is an additional source layered onto the
      // inbox. If it errors (e.g. not yet provisioned), email/draft
      // conversations should still load rather than the whole page failing.
      console.error('Could not load post chat threads', chatError);
    }
    const conversationRows = ((data ?? []) as unknown as Omit<Conversation, 'radar_job_details' | 'source'>[]).map((row) => ({ ...row, source: 'sent' as const }));
    type PreviewRow = {
      id: string;
      vendor_name: string;
      vendor_email: string;
      subject: string;
      email_content: string;
      job_id: string | null;
      hotlist_id: string | null;
      created_at: string;
      updated_at: string;
      social_jobs: SocialJobDetails | null;
      social_hotlist: SocialHotlistDetails | null;
    };
    const draftRows = ((previewData ?? []) as unknown as PreviewRow[]).map((row) => ({
      id: row.id,
      source: 'draft' as const,
      vendor_name: row.vendor_name,
      vendor_email: row.vendor_email,
      sender_name: '',
      subject: row.subject,
      status: 'draft' as const,
      channel: 'mailgun' as const,
      unread_count: 0,
      last_message_at: row.updated_at,
      created_at: row.created_at,
      job_id: row.job_id,
      hotlist_id: row.hotlist_id,
      social_jobs: row.social_jobs,
      social_hotlist: row.social_hotlist,
      draftEmailContent: row.email_content,
    })) as unknown as Omit<Conversation, 'radar_job_details'>[];
    type ChatThreadRow = {
      id: string;
      subject: string;
      status: 'open' | 'closed';
      last_message_at: string;
      created_at: string;
      job_id: string | null;
      hotlist_id: string | null;
      owner_account_id: string;
      owner_display_name: string;
      owner_unread_count: number;
      participant_account_id: string;
      participant_display_name: string;
      participant_unread_count: number;
      social_jobs: SocialJobDetails | null;
      social_hotlist: SocialHotlistDetails | null;
    };
    const chatRows = ((chatData ?? []) as unknown as ChatThreadRow[]).map((row) => {
      const isOwner = row.owner_account_id === account.id;
      return {
        id: row.id,
        source: 'chat' as const,
        vendor_name: isOwner ? row.participant_display_name : row.owner_display_name,
        vendor_email: '',
        sender_name: '',
        subject: row.subject,
        status: row.status,
        channel: 'chat' as const,
        unread_count: isOwner ? row.owner_unread_count : row.participant_unread_count,
        last_message_at: row.last_message_at,
        created_at: row.created_at,
        job_id: row.job_id,
        hotlist_id: row.hotlist_id,
        social_jobs: row.social_jobs,
        social_hotlist: row.social_hotlist,
      };
    }) as unknown as Omit<Conversation, 'radar_job_details'>[];
    const combinedRows = [...conversationRows, ...draftRows, ...chatRows];
    const jobIds = [...new Set(combinedRows.map((row) => row.job_id).filter((id): id is string => Boolean(id)))];
    const hotlistIds = [...new Set(combinedRows.map((row) => row.hotlist_id).filter((id): id is string => Boolean(id)))];
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
    const rows: Conversation[] = combinedRows
      .map((row) => ({
        ...row,
        radar_job_details: breakdownByLeadId.get(leadIdOf(row)) ?? null,
      }))
      .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
    setConversations(rows);
    setSelectedId((current) => current ?? (window.matchMedia('(min-width: 640px)').matches ? rows[0]?.id ?? null : null));
  }, [account?.id]);

  const loadChatMessages = useCallback(async (threadId: string) => {
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('post_chat_messages' as never)
      .select('id, sender_account_id, body, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    setLoadingMessages(false);
    if (error) {
      setToast({ message: 'Could not load messages', type: 'error' });
      return;
    }
    const rows = (data ?? []) as unknown as Array<{ id: string; sender_account_id: string; body: string; created_at: string }>;
    setMessages(rows.map((row): Message => ({
      id: row.id,
      direction: row.sender_account_id === account?.id ? 'outbound' : 'inbound',
      sender_type: 'user',
      from_email: '',
      to_email: '',
      subject: '',
      text_body: row.body,
      display_text: null,
      display_text_status: null,
      status: 'delivered',
      error_message: null,
      sent_at: row.created_at,
      received_at: null,
      created_at: row.created_at,
      vendor_message_events: [],
      vendor_message_attachments: [],
      isChat: true,
    })));
    setMessagesConversationId(threadId);
  }, [account?.id]);

  const loadMessages = useCallback(async (id: string) => {
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from('vendor_messages')
      .select('id, direction, sender_type, from_email, to_email, subject, text_body, display_text, display_text_status, status, error_message, sent_at, received_at, created_at, vendor_message_events(event_type, occurred_at), vendor_message_attachments(id, original_filename, content_type, size_bytes)')
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
    const selectedConversation = conversations.find((item) => item.id === selectedId);
    if (selectedConversation?.source === 'draft') {
      setMessages([draftMessage(selectedConversation)]);
      setMessagesConversationId(selectedId);
      return;
    }
    if (selectedConversation?.source === 'chat') {
      setMessagesConversationId(null);
      void loadChatMessages(selectedId);
      void supabase.rpc('mark_post_chat_thread_read' as never, { p_thread_id: selectedId } as never)
        .then(() => setConversations((current) => current.map((item) => (
          item.id === selectedId ? { ...item, unread_count: 0 } : item
        ))));
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
  }, [loadChatMessages, loadMessages, selectedId]);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pulse_ask_ai_previews' }, () => {
        void loadConversations();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_messages' }, (payload) => {
        const row = payload.new as { conversation_id?: string };
        if (row.conversation_id === selectedId) void loadMessages(selectedId);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vendor_message_events' }, () => {
        if (selectedId) void loadMessages(selectedId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_chat_threads' }, () => {
        void loadConversations();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_chat_messages' }, (payload) => {
        const row = payload.new as { thread_id?: string };
        if (row.thread_id === selectedId) void loadChatMessages(selectedId);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadChatMessages, loadConversations, loadMessages, selectedId]);

  useEffect(() => {
    setSelectedId(conversationId ?? null);
    setReplyText('');
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
    recent: scopedConversations.length,
    job: scopedConversations.filter((item) => !item.hotlist_id).length,
    hotlist: scopedConversations.filter((item) => Boolean(item.hotlist_id)).length,
  }), [scopedConversations]);

  const filtered = useMemo(() => scopedConversations.filter((item) => {
    if (filter === 'job') return !item.hotlist_id;
    if (filter === 'hotlist') return Boolean(item.hotlist_id);
    return true;
  }), [filter, scopedConversations]);

  function selectConversation(id: string) {
    navigate(`/inbox/${id}`, { replace: true });
  }

  async function downloadAttachment(attachmentId: string, filename: string) {
    if (downloadingAttachmentId) return;
    setDownloadingAttachmentId(attachmentId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setToast({ message: 'Please sign in to download attachments', type: 'error' });
        return;
      }
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vendor-attachment-download?id=${encodeURIComponent(attachmentId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Download failed (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setToast({ message: (error as Error).message || 'Could not download attachment', type: 'error' });
    } finally {
      setDownloadingAttachmentId(null);
    }
  }

  async function sendReply() {
    const text = replyText.trim();
    if (!text || !selected || sendingReply) return;
    setSendingReply(true);
    try {
      if (selected.channel === 'chat') {
        const { error } = await supabase.rpc('send_post_chat_message' as never, { p_thread_id: selected.id, p_body: text } as never);
        if (error) throw new Error(error.message);
        setReplyText('');
        void loadChatMessages(selected.id);
        return;
      }
      const { data, error } = await supabase.functions.invoke('send-vendor-message', {
        body: {
          conversation_id: selected.id,
          text_body: text,
          client_request_id: crypto.randomUUID(),
        },
      });
      if (error || !data?.ok) {
        throw new Error(data?.error || (error as Error)?.message || 'Could not send message');
      }
      setReplyText('');
    } catch (error) {
      setToast({ message: (error as Error).message || 'Could not send message', type: 'error' });
    } finally {
      setSendingReply(false);
    }
  }

  async function generateAiReply() {
    if (!selected || selected.channel !== 'chat' || draftingAiReply) return;
    const threadId = selected.id;
    setDraftingAiReply(true);
    try {
      const details = getJobDisplayDetails(selected.radar_job_details);
      const title = selected.social_jobs?.job_title || selected.social_hotlist?.role_title || selected.subject;
      const { data, error } = await supabase.functions.invoke('generate-chat-message', {
        body: {
          title,
          is_hotlist: Boolean(selected.hotlist_id),
          details: details.map(({ label, value }) => ({ label, value })),
          recent_messages: messages.slice(-8).map((message) => ({ direction: message.direction, text: message.text_body })),
        },
      });
      if (error || !data?.ok) {
        throw new Error(data?.error || (error as Error)?.message || 'Could not generate a message');
      }
      if (selectedId === threadId) setReplyText(String(data.message ?? ''));
    } catch (error) {
      setToast({ message: (error as Error).message || 'Could not generate a message', type: 'error' });
    } finally {
      setDraftingAiReply(false);
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
              {([
                { id: 'recent' as const, label: 'Recent' },
                { id: 'job' as const, label: 'Jobs' },
                { id: 'hotlist' as const, label: 'Hotlist' },
              ]).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  className={`inline-flex w-full items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition ${filter === option.id ? (isDark ? 'border border-white/25 bg-[#22262c] text-slate-100' : 'border border-blue-600 bg-blue-600 text-white') : (isDark ? 'border border-transparent bg-[#171a1f] text-[#94A3B8] hover:bg-[#1e2228] hover:text-slate-300' : 'border border-blue-200 bg-white text-blue-600 hover:bg-blue-50')}`}
                >
                  <span>{option.label}</span>
                  <span>{tabCounts[option.id]}</span>
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
                  <span className="mt-1 flex items-center gap-1">
                    <span className={`shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide ${item.hotlist_id ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>{item.hotlist_id ? 'Hotlist' : 'Job'}</span>
                    {item.source === 'chat' && <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide bg-indigo-50 text-indigo-700">Chat</span>}
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
            <>
            <div ref={threadScrollRef} className="min-h-0 flex-1 overflow-y-auto bg-white">
              <header className="sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-1 border-b border-gray-200 bg-white px-2 py-1.5 sm:px-3">
                <button type="button" onClick={() => navigate('/inbox', { replace: true })} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 sm:hidden" title="Back to conversations">
                  <ArrowLeft size={16} />
                </button>
                <div className="min-w-0 flex-1 basis-0" />
                <div className="flex flex-wrap items-center justify-end gap-1">
                {selected.channel === 'gmail' && (
                  <span className="rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide bg-red-50 text-red-600" title="Sent from your connected Gmail address">Via Gmail</span>
                )}
                {selected.channel === 'chat' && (
                  <span className="rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide bg-indigo-50 text-indigo-700" title="In-app chat">Chat</span>
                )}
                <span className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${selected.hotlist_id ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>{selected.hotlist_id ? 'Hotlist' : 'Job'}</span>
                <span className={`rounded px-2 py-1 text-[10px] font-semibold ${selected.status === 'failed' ? 'bg-red-50 text-red-700' : selected.status === 'replied' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{STATUS_LABELS[selected.status]}</span>
                </div>
              </header>

              <div className="mx-auto max-w-5xl px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-5 sm:px-8 sm:py-7">
                  <JobReferenceCard conversation={selected} />
                  {loadingMessages ? (
                    <div className="flex h-32 items-center justify-center"><Loader2 size={18} className="animate-spin text-blue-600" /></div>
                  ) : messages.map((message) => {
                    const outbound = message.direction === 'outbound';
                    const deliveryState = outbound ? messageDeliveryState(message) : null;
                    const messageText = outbound
                      ? message.text_body
                      : message.display_text_status === 'complete' && message.display_text
                        ? message.display_text
                        : message.display_text_status === 'failed'
                          ? 'This reply could not be prepared for private display.'
                          : 'Reply received. Preparing a private version.';
                    return (
                      <article key={message.id} className={`mb-3 flex last:mb-0 ${outbound ? 'justify-end' : 'justify-start'}`}>
                        <div className={`w-fit max-w-[92%] rounded-lg border px-3 py-3 sm:max-w-2xl ${outbound ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                          <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-gray-800">{messageText}</p>
                          {message.vendor_message_attachments.length > 0 && (
                            <div className="mt-2 flex flex-col gap-1.5">
                              {message.vendor_message_attachments.map((attachment) => (
                                <button
                                  key={attachment.id}
                                  type="button"
                                  onClick={() => void downloadAttachment(attachment.id, attachment.original_filename)}
                                  disabled={downloadingAttachmentId === attachment.id}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-left text-[11px] font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {downloadingAttachmentId === attachment.id ? (
                                    <Loader2 size={12} className="shrink-0 animate-spin text-gray-400" />
                                  ) : (
                                    <Paperclip size={12} className="shrink-0 text-gray-400" />
                                  )}
                                  <span className="min-w-0 flex-1 truncate">{attachment.original_filename}</span>
                                  <span className="shrink-0 text-gray-400">{formatFileSize(attachment.size_bytes)}</span>
                                  <Download size={11} className="shrink-0 text-gray-400" />
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="mt-3 flex flex-col gap-2 border-t border-gray-200/80 pt-2.5 sm:flex-row sm:items-center">
                            <div className="flex items-center justify-between gap-2 sm:justify-start">
                              <span className="inline-flex min-w-0 items-center gap-1 text-[10px] font-medium text-gray-500">
                                {message.isChat ? <span>{outbound ? 'Sent' : 'Received'}</span> : message.isDraft ? 'Generated' : outbound && (message.status === 'failed' || message.status === 'temporary_failed') ? <><AlertCircle size={11} className="text-red-600" /> <span className="text-red-600">Failed</span></> : deliveryState ? <><CheckCheck size={11} className={deliveryState.opened ? 'text-emerald-600' : 'text-blue-600'} /> <span className={deliveryState.opened ? 'text-emerald-700' : ''}>{deliveryState.label}</span></> : <span>{outbound ? 'Sent' : 'Received'}</span>}
                              </span>
                              <span className="shrink-0 text-[10px] text-gray-500">{formatMessageTime(message.sent_at || message.received_at || message.created_at)}</span>
                            </div>
                            {message.isChat ? null : message.isDraft ? (
                              <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                                <button
                                  type="button"
                                  onClick={() => void navigator.clipboard.writeText(selected.vendor_email).then(() => setToast({ message: 'Vendor email copied', type: 'success' }))}
                                  className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-blue-300 bg-transparent px-2.5 py-1.5 text-[10px] font-semibold text-blue-600 transition-all hover:shadow-[0_0_0_1px_rgba(37,99,235,0.20),0_0_14px_rgba(37,99,235,0.16)] dark:border-cyan-500/30 dark:text-cyan-400"
                                >
                                  <Copy size={11} /> Email
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void navigator.clipboard.writeText(message.subject).then(() => setToast({ message: 'Subject copied', type: 'success' }))}
                                  className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-blue-300 bg-transparent px-2.5 py-1.5 text-[10px] font-semibold text-blue-600 transition-all hover:shadow-[0_0_0_1px_rgba(37,99,235,0.20),0_0_14px_rgba(37,99,235,0.16)] dark:border-cyan-500/30 dark:text-cyan-400"
                                >
                                  <Copy size={11} /> Subject
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void navigator.clipboard.writeText(message.text_body).then(() => setToast({ message: 'Body copied', type: 'success' }))}
                                  className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-blue-300 bg-transparent px-2.5 py-1.5 text-[10px] font-semibold text-blue-600 transition-all hover:shadow-[0_0_0_1px_rgba(37,99,235,0.20),0_0_14px_rgba(37,99,235,0.16)] dark:border-cyan-500/30 dark:text-cyan-400"
                                >
                                  <Copy size={11} /> Body
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void navigator.clipboard.writeText(selected.vendor_email).then(() => setToast({ message: 'Vendor email copied', type: 'success' }))}
                                className="inline-flex w-full shrink-0 items-center justify-center gap-1 rounded-md border border-blue-300 bg-transparent px-2 py-1.5 text-[10px] font-semibold text-blue-600 transition-all hover:shadow-[0_0_0_1px_rgba(37,99,235,0.20),0_0_14px_rgba(37,99,235,0.16)] dark:border-cyan-500/30 dark:text-cyan-400 sm:ml-auto sm:w-auto sm:px-2.5"
                              >
                                <Copy size={11} /> Email
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
            {selected.source === 'draft' ? null : selected.status === 'closed' ? (
              <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-3 pt-3 pb-[calc(5rem+env(safe-area-inset-bottom))] text-center text-[11px] text-gray-500 sm:pb-3">
                This conversation is closed. Reopen it to send a message.
              </div>
            ) : (
              <div className="shrink-0 border-t border-gray-200 bg-white px-2.5 pt-2.5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-3 sm:pt-3 sm:pb-3">
                <p className="mb-1.5 text-[10px] text-gray-400">
                  {selected.channel === 'chat' ? 'In-app chat — not sent by email' : selected.channel === 'gmail' ? 'Replying from your connected Gmail address' : 'Replying via ProfilePush'}
                </p>
                <div className="flex flex-col gap-1.5 rounded-2xl border border-gray-200 bg-gray-50 p-1.5 transition focus-within:border-blue-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100">
                  <textarea
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void sendReply();
                      }
                    }}
                    disabled={sendingReply || draftingAiReply}
                    rows={2}
                    placeholder={draftingAiReply ? 'Writing a message…' : 'Write a reply...'}
                    className="max-h-32 min-h-[2.25rem] w-full resize-none border-0 bg-transparent px-2 py-1.5 text-xs leading-relaxed text-gray-900 outline-none disabled:opacity-60"
                  />
                  <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
                    {selected.channel === 'chat' ? (
                      <button
                        type="button"
                        onClick={() => void generateAiReply()}
                        disabled={draftingAiReply || sendingReply}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-blue-600 bg-transparent px-2.5 py-1 text-[10px] font-semibold text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {draftingAiReply ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                        {draftingAiReply ? 'Writing…' : 'Write with AI'}
                      </button>
                    ) : <span />}
                    <button
                      type="button"
                      onClick={() => void sendReply()}
                      disabled={sendingReply || draftingAiReply || !replyText.trim()}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Send reply"
                    >
                      {sendingReply ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            )}
            </>
          )}
        </section>
      </main>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}