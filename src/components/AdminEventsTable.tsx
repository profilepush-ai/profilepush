import type { EventRow } from '../lib/admin-account-stats';

type Props = {
  events: EventRow[];
  rangeLabel: string;
};

// What people tapped, from product_events (trackEvent in the app): the 40
// most frequent in the range, with how many accounts each came from.
export default function AdminEventsTable({ events, rangeLabel }: Props) {
  const top = events[0]?.count ?? 0;
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="w-full table-fixed text-left">
        <thead className="bg-gray-50">
          <tr className="border-b border-gray-200 text-[10px] font-semibold uppercase text-gray-600">
            <th className="px-4 py-2.5">Event · {rangeLabel}</th>
            <th className="w-[90px] px-4 py-2.5 text-right">Count</th>
            <th className="w-[90px] px-4 py-2.5 text-right">Accounts</th>
            <th className="hidden w-[110px] px-4 py-2.5 text-right sm:table-cell">Per account</th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">No events in this range.</td></tr>
          )}
          {events.map((e) => (
            <tr key={e.event} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
              <td className="px-4 py-2">
                <code className="block truncate text-xs text-gray-800">{e.event}</code>
                <div className="mt-1 h-1 rounded-sm bg-gray-100">
                  <div className="h-1 rounded-sm bg-blue-500" style={{ width: `${top ? (e.count / top) * 100 : 0}%` }} />
                </div>
              </td>
              <td className="px-4 py-2 text-right text-xs font-semibold tabular-nums text-gray-900">{e.count.toLocaleString()}</td>
              <td className="px-4 py-2 text-right text-xs tabular-nums text-gray-700">{e.accounts.toLocaleString()}</td>
              <td className="hidden px-4 py-2 text-right text-xs tabular-nums text-gray-500 sm:table-cell">
                {e.accounts ? (e.count / e.accounts).toFixed(1) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
