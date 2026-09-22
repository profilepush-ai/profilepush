// The activation funnel, per persona.
//
// Two stages people expect at the top — website visitors and signup-page
// visitors — are not in here, and deliberately not faked. Those live in
// Google Analytics (G-Y4Z8FJQMG0 in index.html); this database only starts
// recording once an account exists, because every activity row is keyed by
// account_id. Reading GA needs the GA4 Data API and a service account. The UI
// shows those stages as unconnected rather than estimating them, because a
// made-up conversion rate at the top makes every rate below it wrong.
//
// What is here is measurable per account and therefore trustworthy.

export type FunnelAccount = {
  created_at: string;
  active_persona: 'vendor' | 'bench_sales' | null;
  session_count: number;
  job_posts_count: number;
  hotlist_posts_count: number;
  job_previews_count: number;
  hotlist_previews_count: number;
  ai_pitches_count: number;
  ai_requests_count: number;
  ai_match_runs_count: number;
  gmail_connected: boolean;
  active_days: number;
  /** false once an account is on a paid plan — the end of the funnel. */
  is_trial: boolean;
};

export type FunnelStage = {
  key: string;
  label: string;
  count: number;
  /** Share of the stage above. Null for the first stage. */
  stepRate: number | null;
  /** Share of the funnel's own first stage. */
  overallRate: number;
  /** How many were lost between the stage above and this one. */
  dropped: number;
};

export type Persona = 'vendor' | 'bench_sales';

// Ordered as the journey is meant to run: look, engage, contribute, come
// back, pay. Sharing a job or hotlist would sit between previewing and
// submitting, but nothing records it — the public permalinks are not
// instrumented — so it is named in the UI as unmeasured rather than guessed
// at here.
const STAGES: Array<{ key: string; label: string; test: (a: FunnelAccount) => boolean }> = [
  { key: 'persona', label: 'Chose a persona', test: () => true },
  { key: 'signed_in', label: 'Signed in', test: (a) => (a.session_count ?? 0) > 0 },
  { key: 'previewed', label: 'Previewed a post', test: (a) => (a.job_previews_count ?? 0) + (a.hotlist_previews_count ?? 0) > 0 },
  { key: 'submitted', label: 'AI submit sent', test: (a) => (a.ai_pitches_count ?? 0) + (a.ai_requests_count ?? 0) > 0 },
  { key: 'posted', label: 'Posted inventory', test: (a) => (a.job_posts_count ?? 0) + (a.hotlist_posts_count ?? 0) > 0 },
  { key: 'matched', label: 'Ran AI Match', test: (a) => (a.ai_match_runs_count ?? 0) > 0 },
  { key: 'returned', label: 'Came back (2+ days)', test: (a) => (a.active_days ?? 0) >= 2 },
  { key: 'paid', label: 'Upgraded to paid', test: (a) => a.is_trial === false },
];

function inRange(account: FunnelAccount, startDate: string | null, endDate: string | null): boolean {
  const created = Date.parse(account.created_at);
  if (Number.isNaN(created)) return false;
  if (startDate && created < Date.parse(startDate)) return false;
  if (endDate && created > Date.parse(endDate)) return false;
  return true;
}

/**
 * Stages are cumulative and ordered, not independent counts: an account that
 * ran AI Match without ever posting still counts at "posted", because the
 * question a funnel answers is how far people get, and a stage that can go up
 * as you descend is not a funnel.
 */
export function buildFunnel(
  accounts: FunnelAccount[],
  persona: Persona,
  startDate: string | null,
  endDate: string | null,
): FunnelStage[] {
  const cohort = accounts.filter((a) => inRange(a, startDate, endDate) && a.active_persona === persona);

  const stages: FunnelStage[] = [];
  let reachedPrevious = cohort;

  for (const [index, stage] of STAGES.entries()) {
    const reached = index === 0 ? cohort : reachedPrevious.filter(stage.test);
    const above = index === 0 ? cohort.length : stages[index - 1].count;
    stages.push({
      key: stage.key,
      label: stage.label,
      count: reached.length,
      stepRate: index === 0 ? null : above === 0 ? 0 : reached.length / above,
      overallRate: cohort.length === 0 ? 0 : reached.length / cohort.length,
      dropped: above - reached.length,
    });
    reachedPrevious = reached;
  }

  return stages;
}

/** Accounts that signed up in range but never chose a persona — in neither funnel. */
export function personaLess(accounts: FunnelAccount[], startDate: string | null, endDate: string | null): number {
  return accounts.filter((a) => inRange(a, startDate, endDate) && a.active_persona == null).length;
}

export function signupsInRange(accounts: FunnelAccount[], startDate: string | null, endDate: string | null): number {
  return accounts.filter((a) => inRange(a, startDate, endDate)).length;
}

/** The single worst step, which is where effort should go. */
export function worstStep(stages: FunnelStage[]): FunnelStage | null {
  const candidates = stages.filter((s) => s.stepRate !== null && s.dropped > 0);
  if (!candidates.length) return null;
  return candidates.reduce((worst, stage) => ((stage.stepRate ?? 1) < (worst.stepRate ?? 1) ? stage : worst));
}

export function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}
