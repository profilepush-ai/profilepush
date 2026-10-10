import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';

type Member = { user_id: string; name: string; email: string; role: string; sends: number; applies: number; ai_match_runs: number; posts: number; last_active: string | null };
type Activity = {
  days: number;
  can_see_all: boolean;
  totals: { sends: number; applies: number; ai_match_runs: number; matches_received: number; matches_left: number; members: number };
  members: Member[];
  daily: Array<{ day: string; sends: number; applies: number }>;
};

const RANGES = [7, 30, 90];
const num = (n: number) => Math.round(n).toLocaleString('en-IN');

function ago(iso: string | null) {
  if (!iso) return 'Not yet';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#20242a]">
      <p className="text-[11.5px] font-medium text-gray-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-[24px] font-bold tabular-nums">{value}</p>
      {sub && <p className="text-[11.5px] text-gray-400">{sub}</p>}
    </div>
  );
}

// Submissions and applies per day, stacked: one series each, one axis.
function DailyBars({ daily }: { daily: Activity['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.sends + d.applies));
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-[#20242a]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[14px] font-semibold">Submissions per day</p>
        <p className="flex items-center gap-3 text-[11.5px] text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blue-600" />Emailed</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" />Applied on site</span>
        </p>
      </div>
      <div className="mt-3 flex h-32 items-end gap-[3px]">
        {daily.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
            <div className="flex w-full flex-col justify-end gap-[2px]" style={{ height: `${((d.sends + d.applies) / max) * 100}%` }}>
              {d.applies > 0 && <div className="w-full rounded-t-[4px] bg-emerald-500" style={{ flex: d.applies }} />}
              {d.sends > 0 && <div className={`w-full bg-blue-600 ${d.applies > 0 ? '' : 'rounded-t-[4px]'}`} style={{ flex: d.sends }} />}
            </div>
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] text-white group-hover:block">
              {new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: {d.sends} emailed · {d.applies} applied
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] tabular-nums text-gray-400">
        <span>{daily[0] && new Date(daily[0].day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span>today</span>
      </div>
    </div>
  );
}

// The owner's view of the team: what each recruiter sent, applied to and
// ran, so the day's work is visible without asking. Free for every account.
export default function TeamPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: res } = await supabase.rpc('get_team_activity' as never, { p_days: days } as never);
    setData((res as Activity | null) ?? null);
    setLoading(false);
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const t = data?.totals;
  return (
    <div className="min-h-[100dvh] bg-[#f3f2ee] pb-[calc(5rem+env(safe-area-inset-bottom))] text-gray-900 dark:bg-[#1B1D21] dark:text-slate-100 sm:pb-10">
      <AppNav />
      <main className="mx-auto w-full max-w-5xl space-y-3 px-4 pt-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-bold">Team</h1>
            <p className="mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">
              {data?.can_see_all === false ? 'Your activity.' : 'What each recruiter sent, applied to and matched.'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {RANGES.map((r) => (
              <button key={r} type="button" onClick={() => setDays(r)}
                className={`h-8 rounded-lg border px-3 text-[12.5px] font-semibold ${days === r ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-200'}`}>
                {r === 7 ? '7 days' : r === 30 ? '30 days' : '90 days'}
              </button>
            ))}
          </div>
        </div>

        {loading && !data ? (
          <div className="flex justify-center py-16"><LogoSpinner size={20} /></div>
        ) : !data || !t ? (
          <p className="rounded-xl bg-white p-6 text-center text-[13px] text-gray-500">No team data yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Submissions emailed" value={num(t.sends)} sub={`last ${data.days} days`} />
              <Tile label="Applied on career sites" value={num(t.applies)} sub={`last ${data.days} days`} />
              <Tile label="Matches received" value={num(t.matches_received)} sub={`${num(t.ai_match_runs)} AI Match runs`} />
              <Tile label="Matches left" value={num(t.matches_left)} sub={t.members === 1 ? 'shared by the team' : `shared by ${t.members} recruiters`} />
            </div>

            <DailyBars daily={data.daily} />

            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#20242a]">
              <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-white/10">
                <p className="text-[14px] font-semibold">Recruiters</p>
                {data.can_see_all && (
                  <Link to="/account" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-blue-600 hover:underline">
                    <UserPlus size={14} />Invite a recruiter
                  </Link>
                )}
              </div>
              <table className="w-full min-w-[620px] text-left text-[13px]">
                <thead className="text-[11px] uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Recruiter</th>
                    <th className="px-3 py-2 text-right font-medium">Emailed</th>
                    <th className="px-3 py-2 text-right font-medium">Applied</th>
                    <th className="px-3 py-2 text-right font-medium">AI Match</th>
                    <th className="px-3 py-2 text-right font-medium">Posts</th>
                    <th className="px-4 py-2 text-right font-medium">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.user_id} className="border-t border-gray-100 dark:border-white/5">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold">{m.name}</p>
                        <p className="text-[11.5px] text-gray-400">{m.role === 'owner' ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Recruiter'} · {m.email}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{num(m.sends)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{num(m.applies)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{num(m.ai_match_runs)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{num(m.posts)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{ago(m.last_active)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.can_see_all && data.members.length === 1 && (
                <p className="border-t border-gray-100 px-4 py-3 text-[12.5px] text-gray-500 dark:border-white/10">
                  Invite your recruiters to the same account to see each one’s submissions here. They share your matches.
                </p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
