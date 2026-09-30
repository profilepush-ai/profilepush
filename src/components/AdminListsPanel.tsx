import { useState } from 'react';
import { Download, RefreshCcw, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { downloadCsv } from '../lib/csv';

// Admin > Lists: vendor and bench sales contacts as a CSV for GMass. The list
// is built server-side (admin-lists -> admin_publisher_list) and always leaves
// out anyone who unsubscribed from our emails.

type ListKind = 'vendors' | 'bench-sales' | 'imported';
type ListRow = {
  email: string;
  name: string;
  phone: string;
  company: string;
  posts: number;
  last_posted: string;
  joined: boolean;
  // Imported list only: the files the address came from.
  sources?: string;
};

type ImportResult = { source: string; received: number; valid: number; new: number; already_there: number };

// Pulls every email address out of a pasted or uploaded file, whatever its
// layout, and drops the broken ones: double dots, all-digit fragments and
// misspelled domains that would only bounce.
const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}(?![A-Za-z])/g;
const BAD_DOMAINS = /(^|\.)(gamail\.com|gnail\.com)$|\.xcom$|\.nt$/;
function extractEmails(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(EMAIL_RE)) {
    const email = match[0].toLowerCase().replace(/^[^a-z0-9]+/, '');
    const [local, domain] = email.split('@');
    if (!local || !domain || /\.\./.test(email) || /^\d+$/.test(local) || BAD_DOMAINS.test(domain)) continue;
    out.add(email);
  }
  return [...out];
}

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

// supabase-js hides a function's error behind "Edge Function returned a non-2xx
// status code"; the real reason is in the response body.
async function functionErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    const body = await context.clone().json().catch(() => null) as { error?: unknown } | null;
    if (typeof body?.error === 'string' && body.error) {
      return context.status === 401 ? 'The admin password in this tab is out of date. Sign out of admin and back in.' : body.error;
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export default function AdminListsPanel() {
  const [kind, setKind] = useState<ListKind>('vendors');
  const [days, setDays] = useState<number | null>(30);
  const [unjoinedOnly, setUnjoinedOnly] = useState(true);
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [loadedFor, setLoadedFor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const isImported = kind === 'imported';

  // Each file becomes one source, named after the file.
  async function importFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImporting(true);
    setError('');
    const results: ImportResult[] = [];
    try {
      for (const file of Array.from(files)) {
        const emails = extractEmails(await file.text());
        const source = file.name.replace(/\.[^.]+$/, '').replace(/^Email Lists - /i, '').trim() || 'import';
        if (emails.length === 0) {
          results.push({ source, received: 0, valid: 0, new: 0, already_there: 0 });
          continue;
        }
        const { data, error: fnError } = await supabase.functions.invoke('admin-lists', {
          body: { password: sessionStorage.getItem('admin_authed') || '', action: 'import', source, emails },
        });
        if (fnError) throw new Error(await functionErrorMessage(fnError));
        if (data?.error) throw new Error(data.error);
        results.push(data.result as ImportResult);
      }
      setImportResults(results);
      setRows(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import the file.');
    } finally {
      setImporting(false);
    }
  }

  const selectionKey = `${kind}|${isImported ? '' : days ?? 'all'}|${unjoinedOnly}`;
  const stale = rows !== null && loadedFor !== selectionKey;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('admin-lists', {
        body: { password: sessionStorage.getItem('admin_authed') || '', kind, days, unjoined_only: unjoinedOnly },
      });
      if (fnError) throw new Error(await functionErrorMessage(fnError));
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
    const windowLabel = isImported ? 'imported' : days ? `${days}d` : 'all-time';
    const who = unjoinedOnly ? 'not-joined' : 'all';
    downloadCsv(
      `profilepush-${kind}-${who}-${windowLabel}-${new Date().toISOString().slice(0, 10)}.csv`,
      isImported
        ? ['Email', 'FirstName', 'Name', 'Company', 'Source', 'OnProfilePush']
        : ['Email', 'FirstName', 'Name', 'Company', 'Phone', 'Posts', 'LastPosted', 'OnProfilePush'],
      rows.map((r) => (isImported
        ? [r.email, firstName(r.name), r.name, r.company, r.sources ?? '', r.joined ? 'yes' : 'no']
        : [r.email, firstName(r.name), r.name, r.company, r.phone, String(r.posts), r.last_posted, r.joined ? 'yes' : 'no'])),
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
          <button type="button" className={pill(kind === 'imported')} onClick={() => setKind('imported')}>Imported</button>
        </div>
        {isImported ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-[12px] font-semibold text-gray-500">Add file</span>
            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 ${importing ? 'pointer-events-none opacity-60' : ''}`}>
              <Upload size={13} />
              {importing ? 'Importing…' : 'Import CSV / text files'}
              <input
                id="admin-lists-import"
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                multiple
                className="hidden"
                onChange={(e) => { void importFiles(e.target.files); e.target.value = ''; }}
              />
            </label>
            <span className="text-[12px] text-gray-500">Every email address in the file is picked up; each file becomes a source.</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-[12px] font-semibold text-gray-500">Posted in</span>
            {WINDOWS.map((w) => (
              <button key={w.label} type="button" className={pill(days === w.days)} onClick={() => setDays(w.days)}>{w.label}</button>
            ))}
          </div>
        )}
        {isImported && importResults.length > 0 && (
          <ul className="space-y-0.5 text-[12px] text-gray-600">
            {importResults.map((r) => (
              <li key={r.source}>
                <span className="font-semibold">{r.source}</span>: {r.valid.toLocaleString('en-US')} addresses, {r.new.toLocaleString('en-US')} new, {r.already_there.toLocaleString('en-US')} already there
              </li>
            ))}
          </ul>
        )}
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
                {isImported ? (
                  <th className="px-3 py-2">Source</th>
                ) : (
                  <>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2 text-right">Posts</th>
                    <th className="px-3 py-2">Last posted</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.slice(0, 50).map((r) => (
                <tr key={r.email}>
                  <td className="px-3 py-2">{r.name || '—'}</td>
                  <td className="px-3 py-2">{r.email}</td>
                  <td className="px-3 py-2">{r.company || '—'}</td>
                  {isImported ? (
                    <td className="px-3 py-2">{r.sources || '—'}</td>
                  ) : (
                    <>
                      <td className="px-3 py-2">{r.phone || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.posts}</td>
                      <td className="px-3 py-2 tabular-nums">{r.last_posted}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 50 && (
            <p className="border-t border-gray-100 px-3 py-2 text-[12px] text-gray-500">
              Showing the first 50{isImported ? '' : ' by posts'}. The download has all {rows.length.toLocaleString('en-US')}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
