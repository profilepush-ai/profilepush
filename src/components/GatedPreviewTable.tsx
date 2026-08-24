import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import ActiveListTable, { type ActiveListContact } from './ActiveListTable';
import GoogleSignInButton from './GoogleSignInButton';

const PAGE_SIZE = 10;

// Public preview pages only: page 1 is a real, usable preview (10 rows,
// unmasked). Pages 2+ show the same rows but masked and blurred behind a
// "sign in to download" overlay — a taste of scale (there's more data)
// without letting anyone casually page through the whole free list, and
// without leaking real PII for the gated rows if the blur is bypassed.
export default function GatedPreviewTable({
  rows,
  tabLabel,
  downloadLabel,
  loading,
  onDownload,
  onSignedIn,
  totalCount,
}: {
  rows: ActiveListContact[];
  tabLabel: string;
  downloadLabel: string;
  loading: boolean;
  onDownload: () => void;
  // Called right after a successful inline sign-in from the lock overlay's
  // Google button — the parent wires this to actually perform the download,
  // since the whole point of signing in from here is "sign in and download."
  onSignedIn: () => void;
  // Real total (e.g. active in the last 30 days), shown in the lock overlay
  // as a concrete reason to sign in — separate from rows.length, which is
  // capped at the free/gated preview size, not the true total.
  totalCount?: number | null;
}) {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [rows.length]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const locked = page > 1;

  const pagination = !loading && totalPages > 1 && (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setPage((p) => Math.max(1, p - 1))}
        disabled={page === 1}
        className="flex h-6 w-6 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft size={12} />
      </button>
      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setPage(p)}
          className={`flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-semibold transition-colors ${p === page ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-500 hover:border-gray-400'}`}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        disabled={page === totalPages}
        className="flex h-6 w-6 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight size={12} />
      </button>
    </div>
  );

  return (
    <div className="relative">
      <ActiveListTable
        tabs={[{ key: 'preview', label: tabLabel, rows: pageRows }]}
        activeTab="preview"
        onDownload={onDownload}
        downloadLabel={downloadLabel}
        loading={loading}
        maskPii={locked}
        fitContent
        headerAccessory={pagination}
        lockedBody={locked}
      />
      {locked && (
        <div className="pointer-events-none absolute inset-x-0 top-[20%] flex justify-center p-4">
          <div className="pointer-events-auto h-fit w-full max-w-xs rounded-xl border border-gray-200 bg-white px-5 py-5 text-center shadow-xl">
            <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Lock size={16} />
            </span>
            <p className="mt-2.5 text-[13px] font-bold text-gray-900">
              {totalCount != null
                ? `Sign in and download all ${totalCount.toLocaleString('en-US')} ${tabLabel.toLowerCase()}`
                : 'Sign in to download the full list'}
            </p>
            <div className="mt-3.5">
              <GoogleSignInButton onSuccess={onSignedIn} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
