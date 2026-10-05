import { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, Download, ExternalLink, FileText, Inbox, Mail, Phone, UserRound } from 'lucide-react';
import LogoSpinner from '../LogoSpinner';
import {
  fetchSubmissions, KIND_LABEL, resumeDownloadUrl, setSubmissionStatus, submissionsCsv, websiteUrl,
  type MyWebsite, type SubmissionKind, type WebsiteSubmission,
} from '../../lib/website-checkout';

// Enquiries from one website: filter by type, open each to see every field,
// download the résumé, move it along (New → Contacted → Closed), export CSV.

const KIND_TONE: Record<SubmissionKind, string> = {
  candidate: 'bg-yellow-100 text-yellow-800',
  consultant: 'bg-amber-100 text-amber-800',
  employer: 'bg-emerald-100 text-emerald-700',
  partner: 'bg-violet-100 text-violet-700',
  training: 'bg-sky-100 text-sky-700',
  contact: 'bg-gray-100 text-gray-700',
};
const STATUSES: WebsiteSubmission['status'][] = ['new', 'contacted', 'closed'];

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function WebsiteSubmissions({ site }: { site: MyWebsite }) {
  const [rows, setRows] = useState<WebsiteSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'all' | SubmissionKind>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchSubmissions(site.id));
      setError(null);
    } catch {
      setError('Could not load submissions. Please refresh.');
    }
  }, [site.id]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter(r => kind === 'all' || r.kind === kind), [rows, kind]);
  const counts = useMemo(() => {
    const c: Partial<Record<'all' | SubmissionKind, number>> = { all: rows?.length ?? 0 };
    (rows ?? []).forEach(r => { c[r.kind] = (c[r.kind] ?? 0) + 1; });
    return c;
  }, [rows]);
  const filters = useMemo(
    () => ['all', ...(Object.keys(KIND_LABEL) as SubmissionKind[]).filter(k => counts[k])] as ('all' | SubmissionKind)[],
    [counts],
  );

  async function changeStatus(row: WebsiteSubmission, status: WebsiteSubmission['status']) {
    setRows(prev => prev?.map(r => (r.id === row.id ? { ...r, status } : r)) ?? prev);
    try {
      await setSubmissionStatus(row.id, status);
    } catch {
      setRows(prev => prev?.map(r => (r.id === row.id ? { ...r, status: row.status } : r)) ?? prev);
      setError('Could not update the status. Please try again.');
    }
  }

  async function openResume(path: string) {
    try {
      window.open(await resumeDownloadUrl(path), '_blank', 'noopener');
    } catch {
      setError('Could not open the résumé. Please try again.');
    }
  }

  function exportCsv() {
    const blob = new Blob([submissionsCsv(shown)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${site.slug}-enquiries-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-gray-900 flex items-center gap-2"><Inbox size={16} className="text-blue-600" /> {site.name} enquiries</p>
          <a href={websiteUrl(site)} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 truncate">
            {websiteUrl(site).replace(/^https:\/\//, '').replace(/\/$/, '')} <ExternalLink size={11} />
          </a>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-gray-200 p-0.5 text-[13px]">
            {filters.map(k => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`px-3 py-1.5 rounded-lg font-medium ${kind === k ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}
              >
                {k === 'all' ? 'All' : KIND_LABEL[k]} <span className="opacity-70">{counts[k] ?? 0}</span>
              </button>
            ))}
          </div>
          <button onClick={exportCsv} disabled={!shown.length} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-700 hover:border-gray-300 disabled:opacity-50">
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {error && <p className="px-5 py-3 text-sm text-red-600 border-b border-gray-100">{error}</p>}
      {!rows && !error && <div className="py-12 flex justify-center"><LogoSpinner /></div>}
      {rows && shown.length === 0 && (
        <div className="py-14 text-center text-sm text-gray-500">
          No {kind === 'all' ? '' : `${KIND_LABEL[kind].toLowerCase()} `}enquiries yet. New ones appear here and in your email.
        </div>
      )}

      <ul className="divide-y divide-gray-100">
        {shown.map(r => {
          const open = openId === r.id;
          const Icon = r.kind === 'partner' || r.kind === 'employer' ? Briefcase : UserRound;
          return (
            <li key={r.id} className={r.status === 'new' ? 'bg-blue-50/30' : ''}>
              <div className="px-5 py-3 flex items-center gap-3">
                <button onClick={() => setOpenId(open ? null : r.id)} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${KIND_TONE[r.kind]}`}><Icon size={14} /></span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-gray-900 text-sm truncate">
                      {r.name || r.data?.company || r.email}
                      {r.status === 'new' && <span className="ml-2 align-middle w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />}
                    </span>
                    <span className="block text-xs text-gray-500 truncate">
                      {KIND_LABEL[r.kind]} · {fmt(r.created_at)}
                      {(r.data?.primary_skill || r.data?.technology || r.data?.course || r.data?.role || r.data?.company) ? ` · ${r.data.primary_skill || r.data.technology || r.data.course || r.data.role || r.data.company}` : ''}
                    </span>
                  </span>
                </button>
                {r.resume_path && (
                  <button onClick={() => openResume(r.resume_path!)} title="Download résumé" className="p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50">
                    <FileText size={15} />
                  </button>
                )}
                <select
                  value={r.status}
                  onChange={e => changeStatus(r, e.target.value as WebsiteSubmission['status'])}
                  className="text-[12px] font-medium text-gray-700 bg-white border border-gray-200 rounded-lg px-2 py-1.5"
                  aria-label="Status"
                >
                  {STATUSES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
              {open && (
                <div className="px-5 pb-4 pl-16">
                  <div className="flex flex-wrap gap-3 mb-3 text-sm">
                    {r.email && <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1.5 text-blue-600 hover:underline"><Mail size={13} />{r.email}</a>}
                    {r.phone && <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 text-blue-600 hover:underline"><Phone size={13} />{r.phone}</a>}
                  </div>
                  <dl className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-4 gap-y-1.5 text-sm">
                    {Object.entries(r.data ?? {}).filter(([k]) => !['name', 'email', 'phone'].includes(k)).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-gray-500 capitalize">{k.replace(/_/g, ' ')}</dt>
                        <dd className="text-gray-900 whitespace-pre-wrap break-words">{v}</dd>
                      </div>
                    ))}
                    {r.resume_filename && (
                      <div className="contents">
                        <dt className="text-gray-500">Résumé</dt>
                        <dd><button onClick={() => openResume(r.resume_path!)} className="text-blue-600 hover:underline">{r.resume_filename}</button></dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
