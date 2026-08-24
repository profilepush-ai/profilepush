import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import ActiveListTable, { type ActiveListContact } from './ActiveListTable';

const PAGE_SIZE = 10;

// Public preview pages only: page 1 is a real, usable preview (10 rows,
// unmasked). Pages 2+ show the same rows but blurred behind a "sign in to
// download" overlay — a taste of scale (there's more data) without letting
// anyone casually page through the whole free list. Masking is unnecessary
// here since the lock (not the mask) is what actually protects pages 2+.
export default function GatedPreviewTable({
  rows,
  tabLabel,
  downloadLabel,
  loading,
  onDownload,
}: {
  rows: ActiveListContact[];
  tabLabel: string;
  downloadLabel: string;
  loading: boolean;
  onDownload: () => void;
}) {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [rows.length]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const locked = page > 1;

  return (
    <div>
      <div className="relative">
        <div className={locked ? 'pointer-events-none select-none blur-sm' : ''}>
          <ActiveListTable
            tabs={[{ key: 'preview', label: tabLabel, rows: pageRows }]}
            activeTab="preview"
            onDownload={onDownload}
            downloadLabel={downloadLabel}
            loading={loading}
            maskPii={locked}
            fitContent
          />
        </div>
        {locked && (
          <div className="absolute inset-0 flex justify-center p-4 pt-10">
            <div className="h-fit w-full max-w-xs rounded-xl border border-gray-200 bg-white px-5 py-5 text-center shadow-xl">
              <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <Lock size={16} />
              </span>
              <p className="mt-2.5 text-[13px] font-semibold text-gray-900">
                Rows {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, rows.length)} are for signed-in users
              </p>
              <p className="mt-1 text-[12px] text-gray-500">Sign in to download the full list as a CSV.</p>
              <button
                type="button"
                onClick={onDownload}
                className="mt-3.5 w-full rounded-lg bg-blue-600 px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-blue-700"
              >
                Sign in to download full list
              </button>
            </div>
          </div>
        )}
      </div>

      {!loading && totalPages > 1 && (
        <div className="mt-2 flex items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={12} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              className={`flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-semibold transition-colors ${p === page ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-500 hover:border-gray-400'}`}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
