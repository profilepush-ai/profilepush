import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Sparkles, Download, Copy, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Kind = 'job' | 'hotlist';

type PostRow = {
  id: string;
  post_url: string;
  content: string;
  title: string | null;
  company: string | null;
  created_at: string;
  matching_count?: number;
  comment?: string;
};

async function callAdminPosts(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('admin-posts', {
    body: { password: sessionStorage.getItem('admin_authed') || '', ...body },
  });
  if (error || data?.error) throw new Error(error?.message || data.error);
  return data;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(kind: Kind, rows: PostRow[]) {
  const headers = ['post_url', 'title', 'company', 'created_at', 'matching_count', 'comment', 'content'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([
      row.post_url ?? '',
      row.title ?? '',
      row.company ?? '',
      row.created_at ?? '',
      String(row.matching_count ?? ''),
      row.comment ?? '',
      row.content ?? '',
    ].map((v) => csvEscape(String(v))).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${kind}-outreach-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
    >
      {copied ? <Check size={11} className="text-green-600" /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

const PAGE_SIZE = 50;

export default function AdminPostOutreachPanel() {
  const [kind, setKind] = useState<Kind>('job');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<PostRow[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function loadPosts(pageToLoad: number) {
    setLoading(true);
    setError('');
    try {
      const data = await callAdminPosts({
        action: 'list',
        kind,
        start_date: startDate || null,
        end_date: endDate || null,
        limit: PAGE_SIZE,
        offset: pageToLoad * PAGE_SIZE,
      });
      setRows((data.rows ?? []) as PostRow[]);
      setTotal((data.total as number) ?? 0);
      setSelected(new Set());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPage(0);
    void loadPosts(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  function goToPage(next: number) {
    const clamped = Math.max(0, Math.min(next, totalPages - 1));
    setPage(clamped);
    void loadPosts(clamped);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function handleGenerate() {
    const ids = selected.size > 0 ? Array.from(selected) : rows.map((r) => r.id);
    if (ids.length === 0) return;
    setGenerating(true);
    setError('');
    try {
      // The worker enqueues onto a Cloudflare Queue and returns immediately
      // — comments land in admin_post_comments asynchronously, so poll for
      // results rather than expecting them in this response.
      await callAdminPosts({ action: 'generate_comments', kind, ids });

      const pending = new Set(ids);
      const POLL_INTERVAL_MS = 2000;
      const MAX_POLLS = 30; // ~60s ceiling
      for (let attempt = 0; attempt < MAX_POLLS && pending.size > 0; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        const data = await callAdminPosts({ action: 'comment_status', ids: Array.from(pending) });
        const results = (data.results ?? []) as Array<{ post_id: string; comment: string | null; matching_count: number | null; status: string }>;
        if (results.length === 0) continue;
        const byId = new Map(results.map((r) => [r.post_id, r]));
        setRows((prev) => prev.map((row) => {
          const result = byId.get(row.id);
          if (!result || result.status !== 'done') return row;
          return { ...row, comment: result.comment ?? undefined, matching_count: result.matching_count ?? undefined };
        }));
        for (const result of results) {
          if (result.status === 'done' || result.status === 'failed') pending.delete(result.post_id);
        }
      }
      if (pending.size > 0) {
        setError(`${pending.size} comment(s) are still processing — they'll appear once ready. You can re-check by refreshing.`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setKind('job')}
            className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition ${kind === 'job' ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            Jobs
          </button>
          <button
            type="button"
            onClick={() => setKind('hotlist')}
            className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition ${kind === 'hotlist' ? 'bg-orange-500 text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            Hotlist
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-md border border-gray-200 px-2 py-1.5 text-[12px]"
          />
          <span className="text-[12px] text-gray-400">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-md border border-gray-200 px-2 py-1.5 text-[12px]"
          />
          <button
            type="button"
            onClick={() => goToPage(0)}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-50"
          >
            Filter
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating || rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Generate AI Comments {selected.size > 0 ? `(${selected.size})` : '(all loaded)'}
          </button>
          <button
            type="button"
            onClick={() => downloadCsv(kind, rows)}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={13} />
            Download CSV
          </button>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-gray-400">
          {total} scraped {kind === 'job' ? 'job' : 'hotlist'} posts in range · page {page + 1} of {totalPages} · up to {PAGE_SIZE} per page and per bulk generate
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page === 0 || loading}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages - 1 || loading}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-2 py-2">
                  <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleSelectAll} />
                </th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Post</th>
                <th className="px-3 py-2">Content</th>
                <th className="px-3 py-2">Matches</th>
                <th className="px-3 py-2">AI Comment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No posts in this range.</td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="align-top text-gray-700">
                    <td className="px-2 py-2">
                      <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelected(row.id)} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500">{formatDate(row.created_at)}</td>
                    <td className="px-3 py-2">
                      <p className="font-semibold text-gray-900">{row.title || '—'}</p>
                      <p className="text-gray-400">{row.company || ''}</p>
                      {row.post_url && (
                        <a href={row.post_url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-blue-600 hover:underline">
                          <ExternalLink size={11} /> View post
                        </a>
                      )}
                    </td>
                    <td className="max-w-xs px-3 py-2">
                      <p className="line-clamp-3 text-gray-600">{row.content}</p>
                    </td>
                    <td className="px-3 py-2 font-semibold text-gray-900">{row.matching_count ?? '—'}</td>
                    <td className="min-w-[240px] max-w-sm px-3 py-2">
                      {row.comment ? (
                        <div>
                          <p className="text-gray-700">{row.comment}</p>
                          <div className="mt-1"><CopyButton text={row.comment} /></div>
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
