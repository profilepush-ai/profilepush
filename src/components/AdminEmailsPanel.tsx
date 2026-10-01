import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AdminEmailCampaigns, AdminEmailComposer } from './AdminEmailComposer';
import AdminEmailTypes from './AdminEmailTypes';
import AdminEmailConversations from './AdminEmailConversations';

// Admin > Emails: every email the email worker sends, by category, with how
// each one performs. Sends are logged by the worker (email_sends); SES reports
// delivery, bounces and complaints back, GMass does not. AI Submit / Invite
// emails go out through each user's own Gmail and are counted separately.

type CategoryRow = {
  category: string;
  lane: string;
  provider: string;
  sent: number;
  rejected: number;
  failed: number;
  delivered: number;
  bounced: number;
  complained: number;
  tracked: number;
  // Sent with the open image and tracked links; open and click rates are out of these.
  engagement_tracked: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  last_sent: string | null;
};

type Report = {
  since: string;
  tracking_started: string | null;
  categories: CategoryRow[];
  unsubscribes: Record<string, number>;
  gmail: { sent: number; last_sent: string | null };
  daily: Array<{ day: string; category: string; sent: number }>;
};

type SendRow = {
  id: string;
  created_at: string;
  category: string;
  lane: string;
  provider: string;
  to_email: string;
  subject: string | null;
  status: string;
  error: string | null;
  delivered_at: string | null;
  bounced_at: string | null;
  bounce_type: string | null;
  complained_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
};

const CATEGORIES: Record<string, { label: string; detail: string; color: string }> = {
  morning_brief: { label: 'Morning brief', detail: 'Weekday email: their matches, subscriptions and the market', color: '#1d4ed8' },
  digest: { label: 'Daily digest (old)', detail: 'Replaced by the morning brief on Oct 1', color: '#93c5fd' },
  low_credits: { label: 'Low credits', detail: 'Daily upgrade reminder under half credits', color: '#d97706' },
  welcome: { label: 'Welcome', detail: 'Right after signup', color: '#059669' },
  signup_alert: { label: 'Signup alert', detail: 'New signup, to the ProfilePush team', color: '#64748b' },
  screening_invite: { label: 'Screening invite', detail: 'Video screening link to a submitted candidate', color: '#7c3aed' },
  subscriber_notice: { label: 'Subscriber notice', detail: '"X subscribed to you", to unclaimed publishers', color: '#db2777' },
  outreach_pitch: { label: 'Outreach pitch', detail: 'Market-stats pitch to non-users (paused)', color: '#0891b2' },
  campaign: { label: 'Campaigns', detail: 'Written and sent from Compose', color: '#0d9488' },
  campaign_test: { label: 'Campaign tests', detail: 'Test sends from Compose', color: '#cbd5e1' },
  other: { label: 'Other', detail: 'Sent without a category', color: '#94a3b8' },
};

function categoryInfo(category: string) {
  return CATEGORIES[category] ?? { label: category, detail: '', color: '#94a3b8' };
}

const RANGES = [7, 30, 90];

async function functionErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    const body = await context.clone().json().catch(() => null) as { error?: unknown } | null;
    if (typeof body?.error === 'string' && body.error) {
      return context.status === 401 ? 'The admin password in this tab is out of date. Sign out of admin and back in.' : body.error;
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

async function callAdminEmails(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-emails', {
    body: { password: sessionStorage.getItem('admin_authed') || '', ...body },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

const fmt = (n: number) => n.toLocaleString('en-US');

function pct(part: number, whole: number): string {
  if (!whole) return '—';
  const value = (part / whole) * 100;
  return `${value < 1 && value > 0 ? value.toFixed(2) : value.toFixed(1)}%`;
}

// Gmail and Outlook start rejecting senders at 0.3% complaints; SES reviews
// accounts at 5% bounces. Amber is the early warning.
function rateTone(part: number, whole: number, warn: number, bad: number): string {
  if (!whole || !part) return 'text-gray-700';
  const rate = part / whole;
  return rate >= bad ? 'font-semibold text-red-600' : rate >= warn ? 'font-semibold text-amber-600' : 'text-gray-700';
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function sendState(row: SendRow): { label: string; className: string } {
  if (row.complained_at) return { label: 'Complaint', className: 'bg-red-50 text-red-700' };
  if (row.bounced_at) return { label: row.bounce_type?.startsWith('Permanent') ? 'Bounced' : 'Soft bounce', className: 'bg-red-50 text-red-700' };
  if (row.status === 'rejected') return { label: 'Rejected', className: 'bg-red-50 text-red-700' };
  if (row.status === 'failed') return { label: 'Failed', className: 'bg-red-50 text-red-700' };
  if (row.clicked_at) return { label: 'Clicked', className: 'bg-blue-50 text-blue-700' };
  if (row.opened_at) return { label: 'Opened', className: 'bg-sky-50 text-sky-700' };
  if (row.delivered_at) return { label: 'Delivered', className: 'bg-emerald-50 text-emerald-700' };
  return { label: row.provider === 'ses' ? 'Sent' : 'Sent (GMass)', className: 'bg-gray-100 text-gray-600' };
}

function EmailPerformance() {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<SendRow[] | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');

  async function loadReport(range = days) {
    setLoading(true);
    setError('');
    try {
      const data = await callAdminEmails({ action: 'report', days: range });
      setReport(data.report as Report);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the email report.');
    } finally {
      setLoading(false);
    }
  }

  async function loadRows(nextCategory = category, nextSearch = search) {
    setRowsLoading(true);
    try {
      const data = await callAdminEmails({ action: 'recent', category: nextCategory || null, search: nextSearch || null, limit: 100 });
      setRows((data.rows ?? []) as SendRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load recent emails.');
    } finally {
      setRowsLoading(false);
    }
  }

  useEffect(() => {
    void loadReport(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  useEffect(() => {
    void loadRows('', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const c = report?.categories ?? [];
    const sum = (key: keyof CategoryRow) => c.reduce((acc, row) => acc + Number(row[key] ?? 0), 0);
    return {
      sent: sum('sent'),
      tracked: sum('tracked'),
      delivered: sum('delivered'),
      bounced: sum('bounced'),
      complained: sum('complained'),
      engagementTracked: sum('engagement_tracked'),
      opened: sum('opened'),
      clicked: sum('clicked'),
      unsubscribed: Object.values(report?.unsubscribes ?? {}).reduce((a, b) => a + Number(b), 0),
      failed: sum('failed') + sum('rejected'),
    };
  }, [report]);

  // Daily bars: one column per day in the range, stacked by category.
  const chart = useMemo(() => {
    if (!report) return null;
    const byDay = new Map<string, Array<{ category: string; sent: number }>>();
    for (const row of report.daily) {
      const key = row.day.slice(0, 10);
      byDay.set(key, [...(byDay.get(key) ?? []), { category: row.category, sent: Number(row.sent) }]);
    }
    const daysList: Array<{ day: string; parts: Array<{ category: string; sent: number }>; total: number }> = [];
    const end = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setUTCDate(end.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const parts = byDay.get(key) ?? [];
      daysList.push({ day: key, parts, total: parts.reduce((a, p) => a + p.sent, 0) });
    }
    const max = Math.max(1, ...daysList.map((d) => d.total));
    return { daysList, max };
  }, [report, days]);

  const pill = (active: boolean) => `rounded-full border px-3 py-1.5 text-[12px] font-semibold transition ${
    active ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
  }`;

  const stat = (label: string, value: string, sub?: string, tone = 'text-gray-900') => (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-gray-200 bg-white px-4 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <span className={`text-[22px] font-bold tabular-nums ${tone}`}>{value}</span>
      {sub && <span className="text-[11px] text-gray-500">{sub}</span>}
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
        {RANGES.map((r) => (
          <button key={r} type="button" className={pill(days === r)} onClick={() => setDays(r)}>Last {r} days</button>
        ))}
        <button
          type="button"
          onClick={() => { void loadReport(); void loadRows(); }}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <RefreshCcw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            {stat('Sent', fmt(totals.sent), totals.failed ? `${fmt(totals.failed)} failed or rejected` : 'by the email worker')}
            {stat('Opened', pct(totals.opened, totals.engagementTracked), `${fmt(totals.opened)} of ${fmt(totals.engagementTracked)} tracked`)}
            {stat('Clicked', pct(totals.clicked, totals.engagementTracked), `${fmt(totals.clicked)} people clicked`)}
            {stat('Delivered', pct(totals.delivered, totals.tracked), `of ${fmt(totals.tracked)} sent through SES`)}
            {stat('Bounced', pct(totals.bounced, totals.tracked), `${fmt(totals.bounced)} · keep under 2%`, rateTone(totals.bounced, totals.tracked, 0.02, 0.05).replace('text-gray-700', 'text-gray-900'))}
            {stat('Complaints', pct(totals.complained, totals.tracked), `${fmt(totals.complained)} · keep under 0.1%`, rateTone(totals.complained, totals.tracked, 0.001, 0.003).replace('text-gray-700', 'text-gray-900'))}
            {stat('Unsubscribed', fmt(totals.unsubscribed), pct(totals.unsubscribed, totals.sent) + ' of sent')}
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full min-w-[980px] text-[12px]">
              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Sent via</th>
                  <th className="px-3 py-2 text-right">Sent</th>
                  <th className="px-3 py-2 text-right">Delivered</th>
                  <th className="px-3 py-2 text-right">Opened</th>
                  <th className="px-3 py-2 text-right">Clicked</th>
                  <th className="px-3 py-2 text-right">Bounced</th>
                  <th className="px-3 py-2 text-right">Complaints</th>
                  <th className="px-3 py-2 text-right">Unsubscribed</th>
                  <th className="px-3 py-2 text-right">Failed</th>
                  <th className="px-3 py-2">Last sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {report.categories.map((c) => {
                  const info = categoryInfo(c.category);
                  const failed = Number(c.failed) + Number(c.rejected);
                  return (
                    <tr
                      key={c.category}
                      className={`cursor-pointer hover:bg-gray-50 ${category === c.category ? 'bg-blue-50/60' : ''}`}
                      onClick={() => { const next = category === c.category ? '' : c.category; setCategory(next); void loadRows(next, search); }}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: info.color }} />
                          <div className="min-w-0">
                            <div className="font-semibold text-gray-900">{info.label}</div>
                            <div className="text-[11px] text-gray-500">{info.detail}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.lane === 'outreach' ? 'bg-cyan-50 text-cyan-700' : 'bg-blue-50 text-blue-700'}`}>
                          {c.provider === 'ses' ? 'Amazon SES' : c.provider === 'gmass' ? 'GMass' : c.provider}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(Number(c.sent))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.tracked ? pct(Number(c.delivered), Number(c.tracked)) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.engagement_tracked ? pct(Number(c.opened), Number(c.engagement_tracked)) : '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{c.engagement_tracked ? pct(Number(c.clicked), Number(c.engagement_tracked)) : '—'}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${rateTone(Number(c.bounced), Number(c.tracked), 0.02, 0.05)}`}>
                        {c.tracked ? `${fmt(Number(c.bounced))} · ${pct(Number(c.bounced), Number(c.tracked))}` : '—'}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${rateTone(Number(c.complained), Number(c.tracked), 0.001, 0.003)}`}>
                        {c.tracked ? fmt(Number(c.complained)) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(c.unsubscribed))}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${failed ? 'font-semibold text-red-600' : 'text-gray-700'}`}>{fmt(failed)}</td>
                      <td className="px-3 py-2 text-gray-600">{timeAgo(c.last_sent)}</td>
                    </tr>
                  );
                })}
                <tr className="bg-gray-50/60">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-gray-300" />
                      <div>
                        <div className="font-semibold text-gray-900">AI Submit / AI Invite</div>
                        <div className="text-[11px] text-gray-500">Sent by users from their own Gmail</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">User&apos;s Gmail</span></td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(Number(report.gmail?.sent ?? 0))}</td>
                  <td className="px-3 py-2 text-right text-gray-400" colSpan={7}>Not reported by Gmail</td>
                  <td className="px-3 py-2 text-gray-600">{timeAgo(report.gmail?.last_sent ?? null)}</td>
                </tr>
                {report.categories.length === 0 && (
                  <tr><td colSpan={11} className="px-3 py-6 text-center text-gray-500">No emails logged in this range yet.</td></tr>
                )}
              </tbody>
            </table>
            <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500">
              Opened and clicked count each person once, out of emails sent with tracking. Opens run high: Apple Mail and some company mail filters load images on their own, so treat clicks as the real signal. Delivery, bounce and complaint results come from Amazon SES only.
              {report.tracking_started && ` Logging started ${new Date(report.tracking_started).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`}
              {' '}Click a row to see its emails below.
            </p>
          </div>

          {chart && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-gray-800">Sent per day</span>
                <span className="text-[11px] tabular-nums text-gray-500">peak {fmt(chart.max)}</span>
              </div>
              <div className="flex h-32 items-end gap-[2px]">
                {chart.daysList.map((d) => (
                  <div
                    key={d.day}
                    className="flex h-full min-w-0 flex-1 flex-col-reverse"
                    title={`${d.day}: ${fmt(d.total)} sent${d.parts.map((p) => `\n${categoryInfo(p.category).label}: ${fmt(p.sent)}`).join('')}`}
                  >
                    {d.parts.map((p) => (
                      <div key={p.category} style={{ height: `${(p.sent / chart.max) * 100}%`, backgroundColor: categoryInfo(p.category).color }} />
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] tabular-nums text-gray-400">
                <span>{chart.daysList[0]?.day.slice(5)}</span>
                <span>{chart.daysList[chart.daysList.length - 1]?.day.slice(5)}</span>
              </div>
            </div>
          )}
        </>
      )}

      {!report && loading && <p className="px-1 text-[12px] text-gray-500">Loading email report…</p>}

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3">
          <span className="text-[13px] font-semibold text-gray-800">Recent emails</span>
          {category && (
            <button
              type="button"
              onClick={() => { setCategory(''); void loadRows('', search); }}
              className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
            >
              {categoryInfo(category).label} ×
            </button>
          )}
          <form
            className="ml-auto flex items-center gap-1.5"
            onSubmit={(e) => { e.preventDefault(); void loadRows(category, search); }}
          >
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="admin-emails-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Email or subject"
                className="h-8 w-56 rounded-lg border border-gray-200 pl-7 pr-2 text-[12px] focus:border-blue-400 focus:outline-none"
              />
            </div>
            <button type="submit" className="h-8 rounded-lg bg-blue-600 px-3 text-[12px] font-semibold text-white hover:bg-blue-700">Search</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12px]">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(rows ?? []).map((r) => {
                const state = sendState(r);
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600" title={new Date(r.created_at).toLocaleString()}>{timeAgo(r.created_at)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{categoryInfo(r.category).label}</td>
                    <td className="px-3 py-2">{r.to_email}</td>
                    <td className="max-w-[320px] truncate px-3 py-2 text-gray-700" title={r.subject ?? ''}>{r.subject || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${state.className}`} title={r.error ?? r.bounce_type ?? ''}>{state.label}</span>
                    </td>
                  </tr>
                );
              })}
              {rows && rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">No emails match.</td></tr>
              )}
              {!rows && rowsLoading && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

type EmailsTab = 'performance' | 'conversations' | 'types' | 'compose' | 'campaigns';

export default function AdminEmailsPanel() {
  const [tab, setTab] = useState<EmailsTab>('performance');
  const tabClass = (active: boolean) => `border-b-2 px-1 pb-2 text-[13px] font-semibold transition ${
    active ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
  }`;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex gap-5 overflow-x-auto border-b border-gray-200">
        <button type="button" className={tabClass(tab === 'performance')} onClick={() => setTab('performance')}>Performance</button>
        <button type="button" className={tabClass(tab === 'conversations')} onClick={() => setTab('conversations')}>Conversations</button>
        <button type="button" className={tabClass(tab === 'types')} onClick={() => setTab('types')}>Email types</button>
        <button type="button" className={tabClass(tab === 'compose')} onClick={() => setTab('compose')}>Compose</button>
        <button type="button" className={tabClass(tab === 'campaigns')} onClick={() => setTab('campaigns')}>Campaigns</button>
      </div>
      {tab === 'performance' && <EmailPerformance />}
      {tab === 'conversations' && <AdminEmailConversations />}
      {tab === 'types' && <AdminEmailTypes />}
      {tab === 'compose' && <AdminEmailComposer onSent={() => setTab('campaigns')} />}
      {tab === 'campaigns' && <AdminEmailCampaigns />}
    </div>
  );
}
