import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bell, Mail, RefreshCcw, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Admin > Emails > Conversations: everyone we've emailed in the sidebar,
// newest first; pick one to see everything we've sent them, oldest first:
// each email (with its content when stored, status, opens and clicks) and,
// for users, their in-app / push notifications. Stored email content is the
// version before tracking, so opening it here never counts as their open.

type Person = {
  email: string;
  name: string | null;
  is_user: boolean;
  last_at: string;
  last_subject: string | null;
  last_category: string;
  email_count: number;
  opened_count: number;
  clicked_count: number;
};

type ThreadItem = {
  kind: 'email' | 'notification';
  id: string;
  created_at: string;
  category: string;
  subject: string | null;
  status: string | null;
  provider: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  body_text: string | null;
  body_html: string | null;
  link: string | null;
  is_read: boolean | null;
};

type Filter = 'all' | 'users' | 'non_users';

const CATEGORY_LABELS: Record<string, string> = {
  morning_brief: 'Morning brief',
  low_credits: 'Low credits',
  welcome: 'Welcome',
  campaign: 'Campaign',
  campaign_test: 'Campaign test',
  screening_invite: 'Screening invite',
  signup_alert: 'Signup alert',
  subscriber_notice: 'Subscriber notice',
  outreach_pitch: 'Matches on your post',
  digest: 'Daily digest (old)',
  other: 'Other',
};

const label = (category: string) => CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ');

async function callAdminEmails(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-emails', {
    body: { password: sessionStorage.getItem('admin_authed') || '', ...body },
  });
  if (error) {
    const context = (error as { context?: unknown }).context;
    const detail = context instanceof Response ? await context.clone().json().catch(() => null) as { error?: string } | null : null;
    throw new Error(detail?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Chip({ children, tone }: { children: string; tone: 'gray' | 'green' | 'blue' | 'sky' | 'red' }) {
  const cls = {
    gray: 'bg-gray-100 text-gray-600',
    green: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    sky: 'bg-sky-50 text-sky-700',
    red: 'bg-red-50 text-red-700',
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{children}</span>;
}

// Stored emails carry live links (one-tap claims, Remove my profile,
// unsubscribe). The preview disables every link so viewing a conversation
// can never act for the recipient.
function inertHtml(html: string): string {
  const disabled = html.replace(/\shref="[^"]*"/gi, ' href="#" data-link-disabled="true"');
  const style = '<style>a{pointer-events:none;cursor:default}</style>';
  return disabled.includes('</head>') ? disabled.replace('</head>', `${style}</head>`) : style + disabled;
}

function EmailBubble({ item }: { item: ThreadItem }) {
  const [open, setOpen] = useState(false);
  const failed = item.status === 'failed' || item.status === 'rejected';
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full min-w-0 flex-col gap-1.5 px-4 py-3 text-left hover:bg-gray-50">
        <div className="flex min-w-0 items-center gap-2">
          <Mail size={13} className="shrink-0 text-gray-400" />
          <span className="truncate text-[13px] font-semibold text-gray-900">{item.subject || '(no subject)'}</span>
          <span className="ml-auto shrink-0 text-[11px] text-gray-500" title={fullTime(item.created_at)}>{fullTime(item.created_at)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone="gray">{label(item.category)}</Chip>
          <Chip tone="gray">{item.provider === 'ses' ? 'Amazon SES' : item.provider === 'gmass' ? 'GMass' : item.provider ?? ''}</Chip>
          {failed && <Chip tone="red">{item.status === 'rejected' ? 'Rejected' : 'Failed'}</Chip>}
          {item.bounced_at && <Chip tone="red">Bounced</Chip>}
          {item.complained_at && <Chip tone="red">Marked as spam</Chip>}
          {item.delivered_at && <Chip tone="green">Delivered</Chip>}
          {item.opened_at && <Chip tone="sky">{`Opened ${when(item.opened_at)} ago`}</Chip>}
          {item.clicked_at && <Chip tone="blue">{`Clicked ${when(item.clicked_at)} ago`}</Chip>}
        </div>
      </button>
      {open && (
        <div className="border-t border-gray-100">
          {item.body_html ? (
            <>
              <iframe title={item.subject ?? 'Email'} srcDoc={inertHtml(item.body_html)} sandbox="" className="h-[520px] w-full" />
              <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">Links are turned off in this preview, so it can&apos;t claim, remove or unsubscribe for them.</p>
            </>
          ) : item.body_text ? (
            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-sans text-[13px] text-gray-700">{item.body_text}</pre>
          ) : (
            <p className="px-4 py-3 text-[12px] text-gray-500">Content wasn&apos;t stored for this email (sent before content was saved, on 1 Oct 2026).</p>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationBubble({ item }: { item: ThreadItem }) {
  return (
    <div className="flex min-w-0 gap-2.5 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-2.5">
      <Bell size={13} className="mt-0.5 shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[12px] font-semibold text-gray-800">{item.subject}</span>
          <span className="ml-auto shrink-0 text-[11px] text-gray-500">{fullTime(item.created_at)}</span>
        </div>
        {item.body_text && <p className="mt-0.5 text-[12px] text-gray-600">{item.body_text}</p>}
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Chip tone="gray">In-app + push</Chip>
          <Chip tone="gray">{label(item.category)}</Chip>
          {item.is_read ? <Chip tone="sky">Read</Chip> : <Chip tone="gray">Unread</Chip>}
        </div>
      </div>
    </div>
  );
}

export default function AdminEmailConversations() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Person | null>(null);
  const [thread, setThread] = useState<ThreadItem[] | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);

  async function loadPeople(nextFilter = filter, nextSearch = search) {
    setLoading(true);
    setError('');
    try {
      const data = await callAdminEmails({ action: 'conversations', filter: nextFilter, search: nextSearch || null, limit: 200 });
      setPeople((data.rows ?? []) as Person[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load conversations.');
    } finally {
      setLoading(false);
    }
  }

  async function openPerson(person: Person) {
    setSelected(person);
    setThread(null);
    setThreadLoading(true);
    try {
      const data = await callAdminEmails({ action: 'thread', email: person.email });
      setThread(((data.rows ?? []) as ThreadItem[]).slice().reverse());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this conversation.');
    } finally {
      setThreadLoading(false);
    }
  }

  useEffect(() => { void loadPeople(filter, search); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  const threadSummary = useMemo(() => {
    if (!thread) return '';
    const emails = thread.filter((t) => t.kind === 'email').length;
    const notes = thread.length - emails;
    return `${emails} email${emails === 1 ? '' : 's'}${notes ? ` · ${notes} notification${notes === 1 ? '' : 's'}` : ''}`;
  }, [thread]);

  const pill = (active: boolean) => `rounded-full px-2.5 py-1 text-[11px] font-semibold ${active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`;

  return (
    <div className="flex min-h-[620px] min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* Sidebar */}
      <aside className={`${selected ? 'hidden md:flex' : 'flex'} w-full min-w-0 flex-col border-r border-gray-200 md:w-80 md:shrink-0`}>
        <div className="flex flex-col gap-2 border-b border-gray-100 p-3">
          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void loadPeople(filter, search); }}>
            <div className="relative min-w-0 flex-1">
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="admin-conversations-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or email"
                className="h-8 w-full rounded-lg border border-gray-200 pl-7 pr-2 text-[12px] focus:border-blue-400 focus:outline-none"
              />
            </div>
            <button type="button" onClick={() => void loadPeople(filter, search)} disabled={loading} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Refresh">
              <RefreshCcw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </form>
          <div className="flex gap-1.5">
            <button type="button" className={pill(filter === 'all')} onClick={() => setFilter('all')}>All</button>
            <button type="button" className={pill(filter === 'users')} onClick={() => setFilter('users')}>Users</button>
            <button type="button" className={pill(filter === 'non_users')} onClick={() => setFilter('non_users')}>Not users</button>
          </div>
        </div>
        {error && <p className="px-3 py-2 text-[12px] text-red-600">{error}</p>}
        <ul className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto">
          {(people ?? []).map((p) => (
            <li key={p.email}>
              <button
                type="button"
                onClick={() => void openPerson(p)}
                className={`flex w-full min-w-0 flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-gray-50 ${selected?.email === p.email ? 'bg-blue-50/70' : ''}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-gray-900">{p.name || p.email}</span>
                  {!p.is_user && <Chip tone="gray">Not a user</Chip>}
                  <span className="ml-auto shrink-0 text-[11px] text-gray-500">{when(p.last_at)}</span>
                </div>
                {p.name && <span className="truncate text-[11px] text-gray-500">{p.email}</span>}
                <span className="truncate text-[12px] text-gray-600">{p.last_subject || label(p.last_category)}</span>
                <span className="text-[11px] text-gray-400">
                  {p.email_count} email{p.email_count === 1 ? '' : 's'}
                  {p.opened_count ? ` · ${p.opened_count} opened` : ''}
                  {p.clicked_count ? ` · ${p.clicked_count} clicked` : ''}
                </span>
              </button>
            </li>
          ))}
          {people && people.length === 0 && <li className="px-3 py-8 text-center text-[12px] text-gray-500">Nobody matches.</li>}
          {!people && loading && <li className="px-3 py-8 text-center text-[12px] text-gray-500">Loading…</li>}
        </ul>
      </aside>

      {/* Thread */}
      <section className={`${selected ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {!selected ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-gray-500">
            Pick someone on the left to see everything we&apos;ve sent them.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 md:hidden" aria-label="Back">
                <ArrowLeft size={15} />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-semibold text-gray-900">{selected.name || selected.email}</span>
                  {selected.is_user ? <Chip tone="green">User</Chip> : <Chip tone="gray">Not a user</Chip>}
                </div>
                <div className="truncate text-[12px] text-gray-500">{selected.email}{threadSummary ? ` · ${threadSummary}` : ''}</div>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-gray-50/60 p-4">
              {threadLoading && <p className="text-center text-[12px] text-gray-500">Loading…</p>}
              {(thread ?? []).map((item) => (item.kind === 'email'
                ? <EmailBubble key={`e-${item.id}`} item={item} />
                : <NotificationBubble key={`n-${item.id}`} item={item} />))}
              {thread && thread.length === 0 && <p className="text-center text-[12px] text-gray-500">Nothing sent yet.</p>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
