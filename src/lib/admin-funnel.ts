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
  /** Drafts generated — the act the credit is charged for. Distinct from
   *  sending: a draft can be generated and never sent. */
  /** Credits used, summed from the ledger. Not derived from the balance,
   *  which top-ups and refunds also move. */
  /** What this account was granted at signup. Read per account because the
   *  grant changed from 500 to 100 on 2026-09-21. */
  credits_granted: number;
  credits_spent: number;
  ai_drafts_count: number;
  /** Sends triggered from the bulk bar. Zero for sends made before
   *  send_source existed, which is not the same as none. */
  ai_bulk_sends_count: number;
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

// Ordered as the product actually runs, which is not how this was first
// written. Sign-in lands on AI Match, so running a match is the next thing
// anyone does — it used to sit sixth, below previewing and submitting, and
// because the stages filter each other cumulatively, every account that
// signed in and ran a match without first previewing a post was dropped
// before it reached "Ran AI Match" and counted as zero there. The most
// important step in the funnel was being undercounted by its own position.
//
// Previewing and submitting are alternatives rather than a sequence — either
// one is the same signal, that the results were worth acting on — so they are
// one stage, not two ranked against each other.
//
// "Posted inventory" is gone. A match run auto-posts the pasted text (see the
// auto-post block in the ai-match function), so as a stage below AI Match it
// was close to a tautology and measured no decision the user made.
//
// Sharing a job or hotlist would sit alongside previewing, but nothing
// records it — the public permalinks are not instrumented — so it is named in
// the UI as unmeasured rather than guessed at here.
/**
 * Fallback only, for an account with no grant row. The signup grant is 100 as
 * of 2026-09-21, down from 500 — which is exactly why the real figure is read
 * per account from the ledger rather than assumed here.
 */
const DEFAULT_CREDIT_GRANT = 100;

const grantFor = (a: FunnelAccount) => (a.credits_granted ?? 0) > 0 ? a.credits_granted : DEFAULT_CREDIT_GRANT;

export const CREDIT_BANDS = [10, 25, 50, 100] as const;

/**
 * How far into the free grant each account got — reported beside the funnel,
 * not inside it.
 *
 * It was a set of funnel stages first, and read zero everywhere. Spending and
 * converting turn out to be close to disjoint: of the accounts past 10% of
 * the grant in a recent week, one had run AI Match, none had connected Gmail
 * and none had sent anything. A cumulative funnel makes every stage a subset
 * of the one above, so credit bands placed under "Sent" could only ever be
 * zero — not because nobody spends, but because spenders are not the people
 * who send.
 *
 * Each band is everyone at or past that share, so they nest: anyone past half
 * is also past a quarter. The share is of that account's own grant, because
 * the signup amount changed from 500 to 100 partway through — spending 60
 * credits is most of a new account's grant and a tenth of an old one's.
 */
export function creditBands(
  accounts: FunnelAccount[],
  startDate: string | null,
  endDate: string | null,
): Array<{ pct: number; label: string; count: number; share: number }> {
  const cohort = accounts.filter((a) => inRange(a, startDate, endDate));
  return CREDIT_BANDS.map((pct) => {
    const count = cohort.filter((a) => (a.credits_spent ?? 0) >= (grantFor(a) * pct) / 100).length;
    return { pct, label: `${pct}%+ of credits`, count, share: cohort.length === 0 ? 0 : count / cohort.length };
  });
}

const submitted = (a: FunnelAccount) => (a.ai_pitches_count ?? 0) + (a.ai_requests_count ?? 0) > 0;

const STAGES: Array<{
  key: string;
  label: string;
  test: (a: FunnelAccount) => boolean;
}> = [
  { key: 'persona', label: 'Chose a persona', test: () => true },
  { key: 'signed_in', label: 'Signed in', test: (a) => (a.session_count ?? 0) > 0 },
  { key: 'matched', label: 'Ran AI Match', test: (a) => (a.ai_match_runs_count ?? 0) > 0 },
  // Generating, connecting a mailbox and sending are three separate
  // decisions, and the drop between them is the real one: a draft is charged
  // for, and without a mailbox connected it can never be sent. Generation is
  // read from the credit ledger, because the client-side previews table is
  // not written by the bulk path and reported zero for accounts that had
  // plainly generated.
  { key: 'generated', label: 'Generated a draft', test: (a) => (a.ai_drafts_count ?? 0) > 0 },
  { key: 'connected', label: 'Connected Gmail', test: (a) => a.gmail_connected === true },
  { key: 'sent', label: 'Sent a submission', test: submitted },
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

