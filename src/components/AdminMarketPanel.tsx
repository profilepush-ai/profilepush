import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

type LeaderboardRow = {
  rank: number;
  target_role: string;
  active_watchers: number;
  unique_jobs: number;
  unique_vendors: number;
  unique_hotlists: number;
  avg_rate: number | null;
  refreshed_at: string;
};

async function callAdminMarket(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('admin-market', {
    body: { password: sessionStorage.getItem('admin_authed') || '', ...body },
  });
  if (error || data?.error) throw new Error(error?.message || data.error);
  return data;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function AdminMarketPanel() {
  const [roles, setRoles] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  async function loadLeaderboard() {
    setError('');
    try {
      const data = await callAdminMarket({ action: 'list_leaderboard' });
      setRoles((data.roles ?? []) as LeaderboardRow[]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadLeaderboard();
      setLoading(false);
    })();
  }, []);

  async function handleForceRefresh() {
    setRefreshing(true);
    setError('');
    try {
      await callAdminMarket({ action: 'force_refresh' });
      await loadLeaderboard();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[13px] font-bold text-gray-900">Market Pulse leaderboard</p>
          <p className="text-[11px] text-gray-400">
            {roles[0]?.refreshed_at ? `Last refreshed ${formatTimestamp(roles[0].refreshed_at)}` : 'Not refreshed yet'} · auto-refreshes every 6 hours
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleForceRefresh()}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh now
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-left text-[12px]">
          <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-3 py-2">Rank</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Watchers</th>
              <th className="px-3 py-2">Unique Jobs</th>
              <th className="px-3 py-2">Unique Vendors</th>
              <th className="px-3 py-2">Unique Hotlists</th>
              <th className="px-3 py-2">Avg Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {roles.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-400">No leaderboard data yet.</td>
              </tr>
            ) : (
              roles.map((role) => (
                <tr key={role.target_role} className="text-gray-700">
                  <td className="px-3 py-2 font-semibold text-gray-500">#{role.rank}</td>
                  <td className="px-3 py-2 font-semibold text-gray-900">{role.target_role}</td>
                  <td className="px-3 py-2">{role.active_watchers}</td>
                  <td className="px-3 py-2">{role.unique_jobs}</td>
                  <td className="px-3 py-2">{role.unique_vendors}</td>
                  <td className="px-3 py-2">{role.unique_hotlists}</td>
                  <td className="px-3 py-2">{role.avg_rate != null ? `$${Number(role.avg_rate).toFixed(0)}/hr` : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
