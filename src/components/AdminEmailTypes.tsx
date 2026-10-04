import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Admin > Emails > Email types: every kind of email ProfilePush sends, who
// gets it, what triggers it, where it's sent from and how to opt out, with
// the last 30 days' numbers from email_sends. The descriptions here mirror
// the senders: cloudflare/profilepush-email-notifications (brief, credits,
// campaigns, subscriber notices), send-welcome-email, notify-new-signup,
// process-job-application, and cloudflare/market-stats-outreach.

type EmailType = {
  category: string;
  name: string;
  to: string;
  when: string;
  from: string;
  optOut: string;
  example: string;
  status?: 'retired';
};

const SES_TYPES: EmailType[] = [
  {
    category: 'morning_brief',
    name: 'Morning brief',
    to: 'Every user with a confirmed email. Android app users seen in the last 7 days are skipped (they get push).',
    when: 'Weekdays at 13:30 UTC (19:00 IST). People inactive for 30+ days get it on Mondays only.',
    from: 'ProfilePush <hello@mail.profilepush.ai>',
    optOut: 'Unsubscribe link and one-click unsubscribe (turns off daily emails)',
    example: '5 new requirements match your consultant',
  },
  {
    category: 'low_credits',
    name: 'Low credits',
    to: 'Account owners under half their credits, active in the last 30 days',
    when: 'Daily at 13:30 UTC, at most once a day',
    from: 'ProfilePush <hello@mail.profilepush.ai>',
    optOut: 'Unsubscribe link and one-click unsubscribe (credit reminders only)',
    example: 'Only 12 credits left. Keep your AI copilot working.',
  },
  {
    category: 'weekly_results',
    name: 'Weekly results',
    to: 'Users active in the last 30 days with something to report',
    when: 'Fridays at 13:30 UTC (19:00 IST)',
    from: 'ProfilePush <hello@mail.profilepush.ai>',
    optOut: 'Unsubscribe link and one-click unsubscribe (weekly summary only)',
    example: 'Your week: 11 emails to vendors, 139 new matches',
  },
  {
    category: 'welcome',
    name: 'Welcome',
    to: 'Each new user',
    when: 'Right after signup',
    from: 'ProfilePush <hello@mail.profilepush.ai>',
    optOut: 'None (one-time account email)',
    example: 'Welcome to ProfilePush',
  },
  {
    category: 'campaign',
    name: 'Campaigns',
    to: 'The audience picked in Compose (all users, without the app, vendors, bench sales, inactive, or pasted addresses)',
    when: 'When you send one from Compose',
    from: 'ProfilePush <hello@mail.profilepush.ai>',
    optOut: 'Unsubscribe link and one-click unsubscribe (announcements only)',
    example: 'Get ProfilePush on your phone',
  },
  {
    category: 'signup_alert',
    name: 'Signup alert',
    to: 'The ProfilePush team (profilepush.ai@gmail.com)',
    when: 'Each new signup',
    from: 'ProfilePush <hello@mail.profilepush.ai>',
    optOut: 'Internal',
    example: 'New ProfilePush signup: name@company.com',
  },
  {
    category: 'campaign_test',
    name: 'Campaign tests',
    to: 'Whoever you enter in Compose',
    when: '"Send me a test" in Compose',
    from: 'ProfilePush <hello@mail.profilepush.ai>',
    optOut: 'Internal',
    example: '[Test] Get ProfilePush on your phone',
  },
  {
    category: 'digest',
    name: 'Daily digest (old)',
    to: 'Users active in the last 7 days',
    when: 'Replaced by the morning brief on 1 Oct 2026',
    from: 'Insights@profilepush.ai via GMass',
    optOut: 'Unsubscribe link',
    example: '🔥 620 New Jobs & 160 Hotlist Consultants (Today’s Digest)',
    status: 'retired',
  },
];

const GMASS_TYPES: EmailType[] = [
  {
    category: 'subscriber_notice',
    name: '“X subscribed to you”',
    to: 'Publishers who aren’t users yet and got new subscribers',
    when: 'Daily at 13:30 UTC, at most one a day per publisher',
    from: 'Insights@profilepush.ai via GMass',
    optOut: 'Stop these emails, or Remove my profile',
    example: 'Priya Sharma and 2 others subscribed to your requirements',
  },
  {
    category: 'outreach_pitch',
    name: 'Matches on your post',
    to: 'People who posted a requirement or hotlist and aren’t users yet',
    when: 'When they post, plus a backfill every 30 minutes. At most one a week per person, 300 a day in all.',
    from: 'Insights@profilepush.ai via GMass',
    optOut: 'Unsubscribe, or Remove my profile',
    example: '33 bench consultants match your Salesforce Production Support Lead requirement',
  },
];

type CategoryStats = { category: string; sent: number; engagement_tracked: number; opened: number; clicked: number; unsubscribed: number; last_sent: string | null };

const fmt = (n: number) => Number(n ?? 0).toLocaleString('en-US');
const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—');

function timeAgo(iso: string | null): string {
  if (!iso) return 'not yet';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function TypeCard({ type, stats }: { type: EmailType; stats?: CategoryStats }) {
  const retired = type.status === 'retired';
  return (
    <div className={`flex min-w-0 flex-col gap-3 rounded-lg border bg-white p-4 ${retired ? 'border-gray-200 opacity-70' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-gray-900">{type.name}</h3>
        {retired && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">Retired</span>}
      </div>
      <p className="rounded-md bg-gray-50 px-3 py-2 text-[12px] italic text-gray-600">&ldquo;{type.example}&rdquo;</p>
      <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
        <dt className="font-semibold text-gray-500">To</dt><dd className="min-w-0 text-gray-800">{type.to}</dd>
        <dt className="font-semibold text-gray-500">When</dt><dd className="min-w-0 text-gray-800">{type.when}</dd>
        <dt className="font-semibold text-gray-500">From</dt><dd className="min-w-0 break-words text-gray-800">{type.from}</dd>
        <dt className="font-semibold text-gray-500">Opt-out</dt><dd className="min-w-0 text-gray-800">{type.optOut}</dd>
      </dl>
      <div className="mt-auto grid grid-cols-4 gap-2 border-t border-gray-100 pt-3 text-center">
        {[
          ['Sent 30d', stats ? fmt(stats.sent) : '0'],
          ['Opened', stats ? pct(stats.opened, stats.engagement_tracked) : '—'],
          ['Clicked', stats ? pct(stats.clicked, stats.engagement_tracked) : '—'],
          ['Last sent', timeAgo(stats?.last_sent ?? null)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="text-[13px] font-semibold tabular-nums text-gray-900">{value}</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminEmailTypes() {
  const [stats, setStats] = useState<Record<string, CategoryStats>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const { data, error: fnError } = await supabase.functions.invoke('admin-emails', {
        body: { password: sessionStorage.getItem('admin_authed') || '', action: 'report', days: 30 },
      });
      if (fnError || data?.error) { setError('Could not load the numbers. The descriptions are still accurate.'); return; }
      const rows = (data?.report?.categories ?? []) as CategoryStats[];
      setStats(Object.fromEntries(rows.map((r) => [r.category, r])));
    })();
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {error && <p className="text-[12px] text-amber-700">{error}</p>}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-gray-900">To our users · Amazon SES</h2>
          <p className="text-[12px] text-gray-500">Sent from mail.profilepush.ai. Every bulk email has a one-click unsubscribe.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {SES_TYPES.map((t) => <TypeCard key={t.category} type={t} stats={stats[t.category]} />)}
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-gray-900">To people who aren&apos;t users yet · GMass</h2>
          <p className="text-[12px] text-gray-500">Never through SES. Each links to their public profile with a one-tap claim.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {GMASS_TYPES.map((t) => <TypeCard key={t.category} type={t} stats={stats[t.category]} />)}
        </div>
      </section>
      <p className="text-[12px] text-gray-500">
        Not listed: sign-up confirmation, password reset and the sign-in link from a profile claim. Those come from Supabase&apos;s own sign-in emails, not from SES or GMass. AI Submit and AI Request emails go out from each user&apos;s own Gmail.
      </p>
    </div>
  );
}
