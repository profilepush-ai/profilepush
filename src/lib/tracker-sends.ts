import { supabase } from './supabase';

// What the account has sent out, for the Tracker: Bench Sales' job
// applications (with their screening and AI score) and a Vendor's resume
// requests and chats off Hotlist posts. Each send names the lead it went to,
// so the Tracker can show it on that match's card, or under "Other" when the
// lead is not on the board.

export type ScreeningTurn = {
  id: string;
  application_id: string;
  turn_index: number;
  question_text: string;
  video_offset_ms: number | null;
  answered_at: string | null;
};

export type TrackerSend = {
  key: string;
  type: 'application' | 'ask' | 'chat';
  leadKind: 'job' | 'hotlist';
  leadId: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: 'gray' | 'blue' | 'green' | 'red';
  closed: boolean;
  createdAt: string;
  // application
  applicationId?: string;
  aiScore?: number | null;
  screeningUrl?: string;
  turns?: ScreeningTurn[];
  // ask
  resumeUrl?: string | null;
  note?: string | null;
  // chat
  chatId?: string;
  hasUnread?: boolean;
};

const APPLICATION_STATUS: Record<string, { label: string; tone: TrackerSend['statusTone']; closed?: boolean }> = {
  submitted: { label: 'Applied', tone: 'gray' },
  screening_sent: { label: 'Screening sent', tone: 'blue' },
  screening_completed: { label: 'Screening submitted', tone: 'green' },
  qualified: { label: 'Qualified', tone: 'green', closed: true },
  rejected: { label: 'Rejected', tone: 'red', closed: true },
};

const ASK_STATUS: Record<string, { label: string; tone: TrackerSend['statusTone']; closed?: boolean }> = {
  processing: { label: 'Requesting…', tone: 'blue' },
  charged: { label: 'Requesting…', tone: 'blue' },
  completed: { label: 'Resume requested', tone: 'blue' },
  fulfilled: { label: 'Resume received', tone: 'green' },
  failed: { label: 'Failed', tone: 'red', closed: true },
  refunded: { label: 'Refunded', tone: 'gray', closed: true },
};

export async function loadTrackerSends(accountId: string, persona: 'vendor' | 'bench_sales' | null | undefined): Promise<TrackerSend[]> {
  // Vendors never apply to jobs and Bench Sales never request resumes off
  // Hotlist, so each persona only loads its own sources (both if unset).
  const includeApplications = persona !== 'vendor';
  const includeHotlist = persona !== 'bench_sales';
  const empty = { data: [], error: null } as const;

  const [apps, asks, chats] = await Promise.all([
    includeApplications
      ? supabase
        .from('job_applications')
        .select('id, social_job_id, candidate_name, status, ai_score, screening_token, created_at, social_jobs(job_title, company_name)')
        .eq('created_by_account_id', accountId)
        .order('created_at', { ascending: false })
      : Promise.resolve(empty),
    includeHotlist ? supabase.rpc('get_my_hotlist_ask_requests' as never) : Promise.resolve(empty),
    includeHotlist
      ? supabase
        .from('post_chat_threads')
        .select('id, hotlist_id, subject, owner_display_name, status, participant_unread_count, created_at')
        .eq('participant_account_id', accountId)
        .eq('post_kind', 'hotlist')
        .order('created_at', { ascending: false })
      : Promise.resolve(empty),
  ]);

  const sends: TrackerSend[] = [];

  const appRows = (apps.error ? [] : apps.data ?? []) as unknown as Array<{
    id: string; social_job_id: string; candidate_name: string; status: string;
    ai_score: number | null; screening_token: string; created_at: string;
    social_jobs: { job_title: string; company_name: string } | null;
  }>;
  const turnsByApp: Record<string, ScreeningTurn[]> = {};
  if (appRows.length > 0) {
    const { data: turns } = await supabase
      .from('job_application_screening_turns')
      .select('id, application_id, turn_index, question_text, video_offset_ms, answered_at')
      .in('application_id', appRows.map((r) => r.id))
      .order('turn_index', { ascending: true });
    for (const turn of (turns ?? []) as unknown as ScreeningTurn[]) (turnsByApp[turn.application_id] ??= []).push(turn);
  }
  for (const r of appRows) {
    const status = APPLICATION_STATUS[r.status] ?? APPLICATION_STATUS.submitted;
    sends.push({
      key: `app:${r.id}`, type: 'application', leadKind: 'job', leadId: r.social_job_id,
      title: r.social_jobs?.job_title || 'Job Opportunity',
      subtitle: [r.social_jobs?.company_name, r.candidate_name].filter(Boolean).join(' · '),
      statusLabel: status.label, statusTone: status.tone, closed: Boolean(status.closed), createdAt: r.created_at,
      applicationId: r.id, aiScore: r.ai_score,
      screeningUrl: `${window.location.origin}/screen/${r.screening_token}`,
      turns: turnsByApp[r.id] ?? [],
    });
  }

  const askRows = (asks.error ? [] : asks.data ?? []) as unknown as Array<{
    id: string; hotlist_id: string; role_title: string; candidate_name: string; company_name: string;
    status: string; created_at: string; submission_resume_url: string | null; submission_note: string | null;
  }>;
  for (const r of askRows) {
    const status = ASK_STATUS[r.status] ?? ASK_STATUS.completed;
    sends.push({
      key: `ask:${r.id}`, type: 'ask', leadKind: 'hotlist', leadId: r.hotlist_id,
      title: r.role_title || 'Available Consultant',
      subtitle: [r.candidate_name, r.company_name].filter(Boolean).join(' · '),
      statusLabel: status.label, statusTone: status.tone, closed: Boolean(status.closed), createdAt: r.created_at,
      resumeUrl: r.status === 'fulfilled' ? r.submission_resume_url : null, note: r.submission_note,
    });
  }

  const chatRows = (chats.error ? [] : chats.data ?? []) as unknown as Array<{
    id: string; hotlist_id: string; subject: string; owner_display_name: string;
    status: string; participant_unread_count: number; created_at: string;
  }>;
  for (const r of chatRows) {
    const unread = r.participant_unread_count > 0;
    sends.push({
      key: `chat:${r.id}`, type: 'chat', leadKind: 'hotlist', leadId: r.hotlist_id,
      title: r.subject || 'Available Consultant', subtitle: r.owner_display_name || '',
      statusLabel: unread ? 'New reply' : r.status === 'closed' ? 'Closed' : 'Awaiting reply',
      statusTone: unread ? 'blue' : 'gray', closed: r.status === 'closed', createdAt: r.created_at,
      chatId: r.id, hasUnread: unread,
    });
  }

  return sends.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export const SEND_TONE_CLASSES: Record<TrackerSend['statusTone'], string> = {
  gray: 'border-gray-200 bg-gray-100 text-gray-600 dark:border-white/15 dark:bg-white/5 dark:text-slate-300',
  blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-300',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  red: 'border-red-200 bg-red-50 text-red-600 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300',
};
