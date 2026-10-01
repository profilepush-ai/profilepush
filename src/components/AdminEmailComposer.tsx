import { useEffect, useRef, useState } from 'react';
import { RefreshCcw, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Admin > Emails > Compose and Campaigns: write an email, pick who gets it,
// preview it, send yourself a test, then send it. admin-emails picks the
// recipients (always leaving out anyone who unsubscribed, bounced or
// complained) and renders the branded layout; the email worker adds each
// person's first name and unsubscribe link and sends through Amazon SES.

type Audience = 'all' | 'no_app' | 'vendors' | 'bench_sales' | 'inactive_7d' | 'emails';

const AUDIENCES: Array<{ id: Audience; label: string; detail: string }> = [
  { id: 'all', label: 'All users', detail: 'Everyone with a confirmed email' },
  { id: 'no_app', label: 'Without the app', detail: 'Not seen in the Android app yet' },
  { id: 'vendors', label: 'Vendors', detail: 'Accounts set to vendor' },
  { id: 'bench_sales', label: 'Bench sales', detail: 'Accounts set to bench sales' },
  { id: 'inactive_7d', label: 'Inactive 7+ days', detail: 'No visits in the last week' },
  { id: 'emails', label: 'Specific people', detail: 'Paste their email addresses' },
];

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.profilepush.app';

type Draft = { subject: string; body: string; button_label: string; button_url: string };

const TEMPLATES: Array<{ id: string; label: string; draft: Draft }> = [
  {
    id: 'app',
    label: 'App install',
    draft: {
      subject: 'Get ProfilePush on your phone',
      body: `Hi {{first_name}},

ProfilePush is now on Android. New requirements and hotlists that match your work reach you the moment they're posted, so you can submit before anyone else.

With the app you can:
• Get a notification as soon as a match is posted
• Run AI Match and AI Submit in a couple of taps
• Keep up with the people you subscribe to, from anywhere

It's free and takes a minute to install. On iPhone? profilepush.ai works in Safari.`,
      button_label: 'Get the Android app',
      button_url: PLAY_URL,
    },
  },
  { id: 'blank', label: 'Blank', draft: { subject: '', body: 'Hi {{first_name}},\n\n', button_label: '', button_url: '' } },
];

const DRAFT_KEY = 'admin_email_draft';

type CampaignRow = {
  id: string;
  created_at: string;
  subject: string;
  audience: string;
  status: string;
  recipient_count: number;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  failed: number;
  unsubscribed: number;
};

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

function loadDraft(): Draft {
  try {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) return JSON.parse(saved) as Draft;
  } catch { /* storage blocked */ }
  return TEMPLATES[0].draft;
}

const fmt = (n: number) => Number(n ?? 0).toLocaleString('en-US');
const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—');

export function AdminEmailComposer({ onSent }: { onSent: () => void }) {
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [audience, setAudience] = useState<Audience>('all');
  const [emails, setEmails] = useState('');
  const [count, setCount] = useState<{ value: number; sample: string[]; key: string } | null>(null);
  const [counting, setCounting] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [testTo, setTestTo] = useState('profilepush.ai@gmail.com');
  const [busy, setBusy] = useState<'' | 'test' | 'send'>('');
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const previewTimer = useRef<number | null>(null);

  const audienceKey = `${audience}|${audience === 'emails' ? emails : ''}`;
  const countIsCurrent = count?.key === audienceKey;

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* storage blocked */ }
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      if (!draft.subject.trim() || !draft.body.trim()) { setPreviewHtml(''); setPreviewError(''); return; }
      callAdminEmails({ action: 'preview', ...draft })
        .then((data) => { setPreviewHtml(String(data.html ?? '')); setPreviewError(''); })
        .catch((err: Error) => setPreviewError(err.message));
    }, 600);
    return () => { if (previewTimer.current) window.clearTimeout(previewTimer.current); };
  }, [draft]);

  useEffect(() => {
    setConfirming(false);
    if (audience === 'emails') return;
    void countAudience();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience]);

  async function countAudience() {
    setCounting(true);
    try {
      const data = await callAdminEmails({ action: 'audience', audience, emails });
      setCount({ value: Number(data.count ?? 0), sample: (data.sample ?? []) as string[], key: audienceKey });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not count the audience.' });
    } finally {
      setCounting(false);
    }
  }

  async function sendTest() {
    setBusy('test');
    setMessage(null);
    try {
      const data = await callAdminEmails({ action: 'test', ...draft, to: testTo, test_first_name: 'Priya' });
      setMessage({ tone: 'ok', text: `Test sent to ${data.sent_to}. It can take a minute to arrive.` });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not send the test.' });
    } finally {
      setBusy('');
    }
  }

  async function sendCampaign() {
    if (!count || !countIsCurrent) return;
    setBusy('send');
    setMessage(null);
    try {
      const data = await callAdminEmails({ action: 'send', ...draft, audience, emails, confirm_count: count.value });
      setConfirming(false);
      setMessage({ tone: 'ok', text: `Sending to ${fmt(Number(data.queued))} people. Results show under Campaigns as they come in.` });
      onSent();
    } catch (err) {
      setConfirming(false);
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not send.' });
      void countAudience();
    } finally {
      setBusy('');
    }
  }

  const pill = (active: boolean) => `rounded-full border px-3 py-1.5 text-[12px] font-semibold transition ${
    active ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
  }`;
  const field = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-900 focus:border-blue-400 focus:outline-none';
  const canSend = Boolean(draft.subject.trim() && draft.body.trim() && count && countIsCurrent && count.value > 0);

  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-[12px] font-semibold text-gray-500">Start</span>
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" className={pill(false)} onClick={() => setDraft(t.draft)}>{t.label}</button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold text-gray-500">To</span>
          <div className="flex flex-wrap gap-2">
            {AUDIENCES.map((a) => (
              <button key={a.id} type="button" title={a.detail} className={pill(audience === a.id)} onClick={() => setAudience(a.id)}>{a.label}</button>
            ))}
          </div>
          {audience === 'emails' && (
            <div className="flex flex-col gap-2">
              <textarea
                id="admin-compose-emails"
                rows={3}
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder="Paste email addresses, any format"
                className={field}
              />
              <button type="button" onClick={() => void countAudience()} className="self-start rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                Check addresses
              </button>
            </div>
          )}
          <p className="text-[12px] text-gray-600">
            {counting ? 'Counting…' : count && countIsCurrent
              ? <><span className="font-semibold text-gray-900 tabular-nums">{fmt(count.value)} people</span> will get this.{count.sample.length > 0 && <span className="text-gray-400"> e.g. {count.sample.slice(0, 3).join(', ')}</span>}</>
              : AUDIENCES.find((a) => a.id === audience)?.detail}
          </p>
          <p className="text-[11px] text-gray-400">People who unsubscribed from these emails, or whose address bounced or complained, are always left out.</p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-gray-500">Subject</span>
          <input id="admin-compose-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-gray-500">Email</span>
          <textarea id="admin-compose-body" rows={12} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className={`${field} font-[inherit] leading-relaxed`} />
          <span className="text-[11px] text-gray-400">{'{{first_name}}'} becomes each person&apos;s first name (or &ldquo;there&rdquo;). A blank line starts a new paragraph. Links work as typed.</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-gray-500">Button text <span className="font-normal text-gray-400">(optional)</span></span>
            <input id="admin-compose-button-label" value={draft.button_label} onChange={(e) => setDraft({ ...draft, button_label: e.target.value })} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-gray-500">Button link</span>
            <input id="admin-compose-button-url" value={draft.button_url} onChange={(e) => setDraft({ ...draft, button_url: e.target.value })} placeholder="https://" className={field} />
          </label>
        </div>

        <div className="flex flex-col gap-2 border-t border-gray-100 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <input id="admin-compose-test-to" value={testTo} onChange={(e) => setTestTo(e.target.value)} className={`${field} w-64 flex-none`} />
            <button
              type="button"
              onClick={() => void sendTest()}
              disabled={busy !== '' || !draft.subject.trim() || !draft.body.trim()}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              {busy === 'test' ? 'Sending test…' : 'Send me a test'}
            </button>
          </div>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!canSend || busy !== ''}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Send size={14} />
              {count && countIsCurrent ? `Send to ${fmt(count.value)} people` : 'Send'}
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-[13px] text-amber-900">
                Send <span className="font-semibold">&ldquo;{draft.subject}&rdquo;</span> to <span className="font-semibold tabular-nums">{fmt(count?.value ?? 0)} people</span> now? This can&apos;t be undone.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => void sendCampaign()} disabled={busy !== ''} className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                  {busy === 'send' ? 'Sending…' : 'Send now'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={busy !== ''} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {message && (
            <p className={`text-[12px] ${message.tone === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{message.text}</p>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-2.5 text-[12px] text-gray-500">
          <span className="font-semibold text-gray-800">Preview</span>
          {draft.subject && <> · <span className="text-gray-700">{draft.subject.split('{{first_name}}').join('Priya')}</span></>}
        </div>
        {previewError && <p className="px-4 py-2 text-[12px] text-red-600">{previewError}</p>}
        {previewHtml ? (
          <iframe title="Email preview" srcDoc={previewHtml} sandbox="" className="h-[640px] w-full rounded-b-lg" />
        ) : (
          <p className="px-4 py-10 text-center text-[12px] text-gray-400">Write a subject and email to see the preview.</p>
        )}
      </div>
    </div>
  );
}

const AUDIENCE_LABELS: Record<string, string> = Object.fromEntries(AUDIENCES.map((a) => [a.id, a.label]));

export function AdminEmailCampaigns() {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await callAdminEmails({ action: 'campaigns' });
      setRows((data.rows ?? []) as CampaignRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load campaigns.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="text-[13px] font-semibold text-gray-800">Campaigns</span>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
          <RefreshCcw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      {error && <p className="px-3 py-2 text-[12px] text-red-600">{error}</p>}
      <table className="w-full min-w-[820px] text-[12px]">
        <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2">Sent</th>
            <th className="px-3 py-2">Subject</th>
            <th className="px-3 py-2">To</th>
            <th className="px-3 py-2 text-right">People</th>
            <th className="px-3 py-2 text-right">Sent</th>
            <th className="px-3 py-2 text-right">Delivered</th>
            <th className="px-3 py-2 text-right">Bounced</th>
            <th className="px-3 py-2 text-right">Complaints</th>
            <th className="px-3 py-2 text-right">Unsubscribed</th>
            <th className="px-3 py-2 text-right">Failed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {(rows ?? []).map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
              <td className="max-w-[280px] truncate px-3 py-2 font-semibold text-gray-900" title={r.subject}>{r.subject}</td>
              <td className="whitespace-nowrap px-3 py-2">{AUDIENCE_LABELS[r.audience] ?? r.audience}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(r.recipient_count)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(r.sent)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{pct(r.delivered, r.sent)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${r.sent && r.bounced / r.sent >= 0.02 ? 'font-semibold text-amber-600' : ''}`}>{fmt(r.bounced)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${r.complained ? 'font-semibold text-red-600' : ''}`}>{fmt(r.complained)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(r.unsubscribed)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${r.failed ? 'font-semibold text-red-600' : ''}`}>{fmt(r.failed)}</td>
            </tr>
          ))}
          {rows && rows.length === 0 && (
            <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-500">No campaigns yet. Write one under Compose.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
