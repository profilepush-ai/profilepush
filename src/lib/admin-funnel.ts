// The activation and money funnels, from admin_account_stats.
//
// The counts are made in SQL for the accounts that signed up in the range.
// Activation stages count everyone who got at least that far, so an account
// that applied without a recorded watch still counts as having watched — a
// skipped step drops nobody and no stage is larger than the one above.
//
// The money steps nest by definition (second chance means paused, which means
// teasers, which means credits ran out). Paid is not a step after them: an
// account can pay at any point, so it is counted on its own, with how many
// paid after running out beside it.
//
// Website and signup-page visits are not here; they come from Google
// Analytics and are drawn above these, in AdminFunnels.

import type { RoleFilter } from './admin-account-stats';

export type FunnelCounts = Record<string, number>;

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

type StageDef = { key: string; label: (role: RoleFilter) => string };

const firstThing = (role: RoleFilter) =>
  role === 'jobs' ? 'Posted a first job'
    : role === 'job_seeker' ? 'Added their profile'
      : role === 'profiles' ? 'Added a first profile' : 'Added a profile or job';

export const ACTIVATION_STAGES: StageDef[] = [
  { key: 'signed_up', label: () => 'Signed up' },
  { key: 'chose_role', label: () => 'Chose a role' },
  { key: 'added_first', label: firstThing },
  { key: 'got_match', label: () => 'Got a first match' },
  { key: 'watched', label: () => 'Watched a match' },
  { key: 'applied', label: (role) => (role === 'jobs' ? 'Asked for a resume' : 'Applied') },
  { key: 'replied', label: () => 'Got a reply' },
  { key: 'interview', label: () => 'Interview' },
  { key: 'placed', label: () => 'Placed' },
];

export const MONEY_STAGES: StageDef[] = [
  { key: 'signed_up', label: () => 'Signed up' },
  { key: 'ran_out', label: () => 'Ran out of credits' },
  { key: 'saw_teasers', label: () => 'Saw teasers' },
  { key: 'paused', label: () => 'Matches paused' },
  { key: 'second_chance', label: () => 'Got a second chance' },
  { key: 'paid', label: () => 'Paid' },
];

export function buildStages(counts: FunnelCounts | undefined, defs: StageDef[], role: RoleFilter): FunnelStage[] {
  const top = Number(counts?.[defs[0].key] ?? 0);
  return defs.map((def, index) => {
    const count = Number(counts?.[def.key] ?? 0);
    const above = index === 0 ? count : Number(counts?.[defs[index - 1].key] ?? 0);
    return {
      key: def.key,
      label: def.label(role),
      count,
      stepRate: index === 0 ? null : above === 0 ? 0 : count / above,
      overallRate: top === 0 ? 0 : count / top,
      dropped: index === 0 ? 0 : Math.max(0, above - count),
    };
  });
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
