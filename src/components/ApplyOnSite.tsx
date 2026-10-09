import { useEffect, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Requirements from staffing firms' career sites have no recruiter email: the
// action is Apply on the firm's own site, then "Mark applied" so it counts as
// submitted (and moves the Tracker card).

type LeadLike = { id: string; postSource: string; kind: 'job' | 'hotlist'; applyUrl?: string | null; posterName?: string };

export function isCareerSiteLead(lead: LeadLike): boolean {
  return lead.kind === 'job' && lead.postSource === 'career_site';
}

// Applied job ids for the signed-in account, loaded once per session.
let appliedCache: Set<string> | null = null;
let appliedLoad: Promise<Set<string>> | null = null;
const listeners = new Set<() => void>();

function loadApplied(): Promise<Set<string>> {
  if (appliedCache) return Promise.resolve(appliedCache);
  appliedLoad ??= (async () => {
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { data } = await supabase.from('external_applications').select('social_job_id').gte('created_at', since).limit(5000);
    appliedCache = new Set((data ?? []).map((r: { social_job_id: string }) => r.social_job_id));
    return appliedCache;
  })();
  return appliedLoad;
}

function useApplied(jobId: string): [boolean, () => void] {
  const [applied, setApplied] = useState(() => appliedCache?.has(jobId) ?? false);
  useEffect(() => {
    let alive = true;
    const sync = () => { if (alive) setApplied(appliedCache?.has(jobId) ?? false); };
    listeners.add(sync);
    void loadApplied().then(sync);
    return () => { alive = false; listeners.delete(sync); };
  }, [jobId]);
  const mark = () => {
    (appliedCache ??= new Set()).add(jobId);
    listeners.forEach((fn) => fn());
  };
  return [applied, mark];
}

async function resolveApplyUrl(lead: LeadLike): Promise<string | null> {
  if (lead.applyUrl) return lead.applyUrl;
  const { data } = await supabase.from('social_jobs').select('post_url').eq('id', lead.id).maybeSingle();
  return (data as { post_url?: string } | null)?.post_url ?? null;
}

// Opens the job on the firm's site. The tab is opened inside the click so
// popup blockers allow it, then pointed at the job once the URL is known.
export async function openApplyPage(lead: LeadLike): Promise<boolean> {
  const tab = window.open('', '_blank');
  const url = await resolveApplyUrl(lead);
  if (!url) { tab?.close(); return false; }
  if (tab) { tab.opener = null; tab.location.href = url; } else window.open(url, '_blank', 'noopener');
  return true;
}

type Variant = 'bar' | 'icon' | 'table' | 'panel';

const CLASSES: Record<Variant, string> = {
  bar: 'inline-flex h-9 flex-1 items-center justify-center gap-1.5 bg-blue-50 text-blue-600 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20',
  icon: 'inline-flex h-8 w-8 items-center justify-center rounded-full text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-blue-400 dark:hover:bg-blue-500/10',
  table: 'inline-flex h-6 w-6 items-center justify-center rounded border border-gray-200 text-blue-600 hover:bg-blue-50 disabled:opacity-60 dark:border-white/10 dark:text-blue-400',
  panel: 'inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-600 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60',
};

export default function ApplyOnSiteButton({
  lead,
  variant,
  subjectId,
  compact = false,
  onApplied,
}: {
  lead: LeadLike;
  variant: Variant;
  /** The consultant this application is for (Tracker), so only that card moves. */
  subjectId?: string | null;
  compact?: boolean;
  onApplied?: () => void;
}) {
  const [applied, markApplied] = useApplied(lead.id);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const firm = lead.posterName?.trim() || 'the firm';
  const showLabel = (variant === 'bar' && !compact) || variant === 'panel';
  const size = variant === 'panel' ? 14 : variant === 'table' ? 12 : 16;

  const open = async () => {
    if (await openApplyPage(lead)) setOpened(true);
  };

  const confirm = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('mark_external_applied' as never, { p_job_id: lead.id, p_subject_id: subjectId ?? null } as never);
    setBusy(false);
    if (!error) { markApplied(); onApplied?.(); }
  };

  if (applied) {
    return (
      <span title={`Applied on ${firm}'s site`} className={`${CLASSES[variant]} cursor-default`}>
        <Check size={size} strokeWidth={1.75} />
        {showLabel && <span className="text-[12px] font-normal">Applied</span>}
      </span>
    );
  }
  if (opened) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void confirm(); }}
        disabled={busy}
        title="Mark applied: counts as submitted and moves the Tracker card"
        aria-label="Mark applied"
        className={CLASSES[variant]}
      >
        <Check size={size} strokeWidth={1.75} />
        {showLabel && <span className="text-[12px] font-normal">Mark applied</span>}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); void open(); }}
      title={`Apply on ${firm}'s site`}
      aria-label="Apply"
      className={CLASSES[variant]}
    >
      <ExternalLink size={size} strokeWidth={1.75} />
      {showLabel && <span className="text-[12px] font-normal">Apply</span>}
    </button>
  );
}
