import { useState } from 'react';
import { Download, RefreshCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { downloadCsv } from '../lib/csv';

// Admin > Lists: vendor and bench sales contacts as a CSV for GMass. The list
// is built server-side (admin-lists -> admin_publisher_list) and always leaves
// out anyone who unsubscribed from our emails.

type ListKind = 'vendors' | 'bench-sales';
type ListRow = {
  email: string;
  name: string;
  phone: string;
  company: string;
  posts: number;
  last_posted: string;
  joined: boolean;
};

const WINDOWS: Array<{ days: number | null; label: string }> = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: null, label: 'All time' },
];

// GMass personalises with {FirstName}; the first word of the name is the
// closest thing to one. Company names and initials are left blank.
function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return /^[A-Za-z][A-Za-z'-]{1,}$/.test(first) ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
}

export default function AdminListsPanel() {
  const [kind, setKind] = useState<ListKind>('vendors');
  const [days, setDays] = useState<number | null>(30);
  const [unjoinedOnly, setUnjoinedOnly] = useState(true);
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [loadedFor, setLoadedFor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectionKey = `${kind}|${days ?? 'all'}|${unjoinedOnly}`;
  const stale = rows !== null && loadedFor !== selectionKey;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('admin-lists', {
        body: { password: sessionStorage.getItem('admin_authed') || '', kind, days, unjoined_only: unjoinedOnly },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setRows((data?.rows ?? []) as ListRow[]);
      setLoadedFor(selectionKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the list.');
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!rows) return;
    const windowLabel = days ? `${days}d` : 'all-time';
    const who = unjoinedOnly ? 'not-joined' : 'all';
    downloadCsv(
      `profilepush-${kind}-${who}-${windowLabel}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Email', 'FirstName', 'Name', 'Company', 'Phone', 'Posts', 'LastPosted', 'OnProfilePush'],
      rows.map((r) => [r.email, firstName(r.name), r.name, r.company, r.phone, String(r.posts), r.last_posted, r.joined ? 'yes' : 'no']),
    );
  }

  const pill = (active: boolean) => `rounded-full border px-3 py-1.5 text-[12px] font-semibold transition ${
    active ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
  }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-[12px] font-semibold text-gray-500">List</span>
          <button type="button" className={pill(kind === 'vendors')} onClick={() => setKind('vendors')}>Vendors</button>
          <button type="button" className={pill(kind === 'bench-sales')} onClick={() => setKind('bench-sales')}>Bench Sales</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-[12px] font-semibold text-gray-500">Posted in</span>
          {WINDOWS.map((w) => (
            <button key={w.label} type="button" className={pill(days === w.days)} onClick={() => setDays(w.days)}>{w.label}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-gray-700">
          <input
            id="admin-lists-unjoined"
            type="checkbox"
            checked={unjoinedOnly}
            onChange={(e) => setUnjoinedOnly(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Only people not on ProfilePush yet
        </label>
        <p className="text-[12px] text-gray-500">Anyone who unsubscribed from our emails is always left out.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Building list…' : 'Build list'}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!rows || rows.length === 0 || stale || loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-[13px] font-semibold text-gray-800 transition hover:bg-gray-50 disabled:opacity-50"
          >
            <Download size={14} />
            Download CSV for GMass
          </button>
          {rows && !stale && (
            <span className="text-[13px] font-semibold text-gray-700 tabular-nums">{rows.length.toLocaleString('en-US')} contacts</span>
          )}
          {stale && <span className="text-[12px] text-amber-600">Options changed. Build the list again.</span>}
        </div>
        {error && <p className="text-[12px] text-red-600">{error}</p>}
      </div>

      {rows && !stale && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[720px] text-[12px]">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2 text-right">Posts</th>
                <th className="px-3 py-2">Last posted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.slice(0, 50).map((r) => (
                <tr key={r.email}>
                  <td className="px-3 py-2">{r.name || '—'}</td>
                  <td className="px-3 py-2">{r.email}</td>
                  <td className="px-3 py-2">{r.company || '—'}</td>
                  <td className="px-3 py-2">{r.phone || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.posts}</td>
                  <td className="px-3 py-2 tabular-nums">{r.last_posted}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 50 && (
            <p className="border-t border-gray-100 px-3 py-2 text-[12px] text-gray-500">
              Showing the top 50 by posts. The download has all {rows.length.toLocaleString('en-US')}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
