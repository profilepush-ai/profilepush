import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import LogoSpinner from './LogoSpinner';

export type ActiveListContact = {
  name: string;
  email: string;
  last_active_at: string;
  role_titles: string;
  role_titles_list: string[];
  employment_types: string[];
  work_types: string[];
  visa_types: string[];
  experience_years: number[];
  skills: string[];
  locations: string[];
  hourly_rate_min: number[];
  hourly_rate_max: number[];
  post_count: number;
};

export type ActiveListTab = {
  key: string;
  label: string;
  rows: ActiveListContact[];
};

function formatLastActive(iso: string) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// First 3 real characters, then masked — e.g. "mkanago" -> "mka••••".
function maskPart(value: string) {
  const visible = value.slice(0, 3);
  return `${visible}${'•'.repeat(Math.max(3, value.length - visible.length))}`;
}

function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!domain) return maskPart(local || email);
  const domainSegments = domain.split('.');
  const tld = domainSegments.length > 1 ? domainSegments.pop() : '';
  const domainName = domainSegments.join('.');
  const maskedDomain = domainName ? `${maskPart(domainName)}${tld ? `.${tld}` : ''}` : domain;
  return `${maskPart(local)}@${maskedDomain}`;
}

function maskName(name: string) {
  if (!name) return name;
  return name.split(' ').map((word) => (word ? maskPart(word) : word)).join(' ');
}

export default function ActiveListTable({
  tabs,
  activeTab,
  onTabChange,
  onDownload,
  downloadLabel = 'Download CSV',
  loading = false,
  emptyMessage = 'No active contacts found.',
  pageSize,
  maskPii = false,
  selectable = false,
  selectedEmails,
  onToggleRow,
  onToggleAllVisible,
  fitContent = false,
  headerAccessory,
  lockedBody = false,
}: {
  tabs: ActiveListTab[];
  activeTab: string;
  onTabChange?: (key: string) => void;
  onDownload: () => void;
  downloadLabel?: string;
  loading?: boolean;
  emptyMessage?: string;
  pageSize?: number;
  maskPii?: boolean;
  selectable?: boolean;
  selectedEmails?: Set<string>;
  onToggleRow?: (email: string) => void;
  onToggleAllVisible?: (emails: string[], select: boolean) => void;
  // Sizes to its natural content height instead of stretching to fill a
  // bounded-height flex parent — for contexts like a normal-flow marketing
  // page (no app-shell) where there's no such parent to stretch against, and
  // a short, fixed row count (e.g. a 10-row preview) that should just show
  // in full rather than get its own internal scrollbar.
  fitContent?: boolean;
  // Rendered in the header bar next to the tab label/heading — e.g. the
  // public preview pages' pagination controls, so they sit beside "Vendors"/
  // "Recruiters" instead of below the whole table.
  headerAccessory?: ReactNode;
  // Blurs and disables pointer events on just the row data, leaving the
  // header (label, headerAccessory, download button) fully interactive —
  // for the public preview pages' locked pages, where pagination must stay
  // clickable so a visitor can navigate back off a locked page.
  lockedBody?: boolean;
}) {
  const current = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];
  const allRows = current?.rows ?? [];

  // Lazy-loads more rows as the user scrolls near the bottom, same "near
  // bottom" threshold /jobs uses for its own infinite-scrolling lists,
  // instead of paging through the already-fetched, in-memory row set.
  const [visibleCount, setVisibleCount] = useState(pageSize ?? allRows.length);
  useEffect(() => { setVisibleCount(pageSize ?? allRows.length); }, [activeTab, allRows.length, pageSize]);

  const rows = allRows.slice(0, visibleCount);
  const canLoadMore = pageSize != null && visibleCount < allRows.length;

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // A short first page (e.g. 10 rows) often doesn't fill a tall container at
  // all, so there's nothing to scroll and the near-bottom check below never
  // fires — the list gets stuck showing only the first page even though
  // hundreds more rows exist. Keep auto-loading until the content actually
  // overflows the container, or everything is loaded.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !canLoadMore || !pageSize) return;
    if (el.scrollHeight <= el.clientHeight) {
      setVisibleCount((prev) => Math.min(prev + pageSize, allRows.length));
    }
  }, [rows.length, canLoadMore, pageSize, allRows.length]);

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    if (!canLoadMore || !pageSize) return;
    const el = event.currentTarget;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 96;
    if (nearBottom) setVisibleCount((prev) => Math.min(prev + pageSize, allRows.length));
  }

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white ${fitContent ? '' : 'h-full'}`}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          {tabs.length > 1 ? (
            <div className="flex items-center gap-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => onTabChange?.(tab.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${tab.key === activeTab ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  {tab.label} <span className="tabular-nums">{tab.rows.length}</span>
                </button>
              ))}
            </div>
          ) : (
            <span className="text-xs font-semibold text-gray-600">{current?.label}</span>
          )}
          {headerAccessory}
        </div>
        <div className="flex items-center gap-2">
          {selectable && <span className="text-[11px] text-gray-500">{selectedEmails?.size ?? 0} selected</span>}
          <button
            type="button"
            onClick={onDownload}
            disabled={loading || (selectable ? (selectedEmails?.size ?? 0) === 0 : rows.length === 0)}
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 px-2.5 py-1.5 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={12} /> {downloadLabel}
          </button>
        </div>
      </div>

      {loading ? (
        <div className={`flex items-center justify-center ${fitContent ? 'min-h-[160px]' : 'flex-1'} ${lockedBody ? 'pointer-events-none select-none blur-sm' : ''}`}><LogoSpinner size={18} /></div>
      ) : (
        <div
          ref={scrollRef}
          className={`${fitContent ? '' : 'min-h-0 flex-1 overflow-auto'} ${lockedBody ? 'pointer-events-none select-none blur-sm' : ''}`}
          onScroll={fitContent ? undefined : handleScroll}
        >
          <table className="w-full table-fixed text-left text-xs">
            <thead className="sticky top-0 z-10 bg-gray-50 text-[10px] font-medium uppercase tracking-wide text-gray-400">
              <tr>
                {selectable && (
                  <th className="w-8 px-2 py-2.5">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((row) => selectedEmails?.has(row.email))}
                      onChange={() => onToggleAllVisible?.(rows.map((row) => row.email), !rows.every((row) => selectedEmails?.has(row.email)))}
                      aria-label="Select all visible rows"
                    />
                  </th>
                )}
                <th className="w-[16%] px-2 py-2.5 font-medium select-none" onCopy={(event) => event.preventDefault()}>Name</th>
                <th className="w-[22%] px-2 py-2.5 font-medium select-none" onCopy={(event) => event.preventDefault()}>Email</th>
                <th className="w-[16%] px-2 py-2.5 font-medium">Last Active On</th>
                <th className="w-[8%] px-2 py-2.5 text-right font-medium">Records</th>
                <th className="px-2 py-2.5 font-medium">Role Titles</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.email}-${index}`} className="hover:bg-gray-50">
                  {selectable && (
                    <td className="px-2 py-2.5 align-top">
                      <input
                        type="checkbox"
                        checked={selectedEmails?.has(row.email) ?? false}
                        onChange={() => onToggleRow?.(row.email)}
                        aria-label={`Select ${maskPii ? (maskEmail(row.email)) : (row.name || row.email)}`}
                      />
                    </td>
                  )}
                  <td className="truncate select-none px-2 py-2.5 align-top text-gray-800" onCopy={(event) => event.preventDefault()}>
                    {row.name ? (maskPii ? maskName(row.name) : row.name) : '—'}
                  </td>
                  <td className="truncate select-none px-2 py-2.5 align-top text-gray-600" onCopy={(event) => event.preventDefault()}>
                    {maskPii ? maskEmail(row.email) : row.email}
                  </td>
                  <td className="px-2 py-2.5 align-top text-gray-600">{formatLastActive(row.last_active_at)}</td>
                  <td className="px-2 py-2.5 text-right align-top tabular-nums text-gray-600">{row.post_count || '—'}</td>
                  <td className="whitespace-normal break-words px-2 py-2.5 align-top text-gray-600">{row.role_titles || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={selectable ? 6 : 5} className="px-4 py-10 text-center text-xs text-gray-500">{emptyMessage}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && pageSize && allRows.length > 0 && (
        <div className="flex shrink-0 items-center justify-center border-t border-gray-100 px-3 py-2">
          <span className="text-[11px] text-gray-400">
            {canLoadMore ? `Showing ${rows.length} of ${allRows.length} — scroll for more` : `${allRows.length} of ${allRows.length}`}
          </span>
        </div>
      )}
    </div>
  );
}
