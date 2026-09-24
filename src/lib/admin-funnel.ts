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
  /**
   * The ways people cleared this stage, when there is more than one. A stage
   * reachable by either of two actions is still one step down the funnel, but
   * which route they took is the useful part — so it is reported inside the
   * stage rather than by splitting the funnel into branches that no longer
   * share a denominator.
   */
  routes?: Array<{ label: string; count: number }>;
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
const previewed = (a: FunnelAccount) => (a.job_previews_count ?? 0) + (a.hotlist_previews_count ?? 0) > 0;
const submitted = (a: FunnelAccount) => (a.ai_pitches_count ?? 0) + (a.ai_requests_count ?? 0) > 0;

const STAGES: Array<{
  key: string;
  label: string;
  test: (a: FunnelAccount) => boolean;
  routes?: Array<{ label: string; test: (a: FunnelAccount) => boolean }>;
}> = [
  { key: 'persona', label: 'Chose a persona', test: () => true },
  { key: 'signed_in', label: 'Signed in', test: (a) => (a.session_count ?? 0) > 0 },
  { key: 'matched', label: 'Ran AI Match', test: (a) => (a.ai_match_runs_count ?? 0) > 0 },
  {
    key: 'acted',
    label: 'Previewed or AI submit sent',
    test: (a) => previewed(a) || submitted(a),
    routes: [
      { label: 'Previewed only', test: (a) => previewed(a) && !submitted(a) },
      { label: 'AI submit only', test: (a) => submitted(a) && !previewed(a) },
      { label: 'Both', test: (a) => previewed(a) && submitted(a) },
    ],
  },
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
      // Counted against those who reached this stage, so the routes always
      // add up to it exactly and never imply a bigger cohort than the funnel.
      routes: stage.routes?.map((route) => ({ label: route.label, count: reached.filter(route.test).length })),
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

// ── The journey as a graph ───────────────────────────────────────────────────
//
// The list above answers "how far down do people get". It cannot answer "which
// way did they go", and after AI Match there is more than one way: previewing
// a post is a look, generating a draft spends a credit, and sending needs a
// mailbox connected first. Flattening those into one line hid the biggest
// drop in the product — of the accounts that paid to generate a draft, most
// never connected Gmail, so the credit bought them nothing.
//
// Nodes carry a count; links carry the accounts that did both ends. A link is
// therefore never wider than either node it touches, which is the one property
// that keeps a diagram like this honest.

export type FunnelNode = {
  key: string;
  label: string;
  /** Column index, left to right. Siblings in a column are alternatives. */
  depth: number;
  count: number;
  /** Of the whole persona cohort, for the label under each node. */
  overallRate: number;
  /** Set when the node is a side path rather than the main line. */
  aside?: boolean;
  /** Said plainly on the node when its number is not what it looks like. */
  note?: string;
};

export type FunnelLink = { from: string; to: string; count: number };

export type FunnelGraph = { nodes: FunnelNode[]; links: FunnelLink[]; cohort: number };

type NodeSpec = {
  key: string;
  label: string;
  depth: number;
  test: (a: FunnelAccount) => boolean;
  aside?: boolean;
  note?: string;
};

const GRAPH_NODES: NodeSpec[] = [
  { key: 'persona', label: 'Chose a persona', depth: 0, test: () => true },
  { key: 'signed_in', label: 'Signed in', depth: 1, test: (a) => (a.session_count ?? 0) > 0 },
  { key: 'matched', label: 'Ran AI Match', depth: 2, test: (a) => (a.ai_match_runs_count ?? 0) > 0 },
  // The side path: looking at a post costs nothing and leads nowhere on its
  // own, so it hangs off the match rather than gating anything below it.
  { key: 'previewed', label: 'Previewed a post', depth: 3, aside: true, test: previewed },
  { key: 'generated', label: 'Generated a draft', depth: 3, test: (a) => (a.ai_drafts_count ?? 0) > 0 },
  {
    key: 'connected',
    label: 'Connected Gmail',
    depth: 4,
    test: (a) => a.gmail_connected === true,
    note: 'connected now, not ever',
  },
  { key: 'sent', label: 'Sent a submission', depth: 5, test: submitted },
  {
    key: 'bulk',
    label: 'Sent in bulk',
    depth: 6,
    aside: true,
    test: (a) => (a.ai_bulk_sends_count ?? 0) > 0,
    note: 'recorded from Sep 2026',
  },
  { key: 'returned', label: 'Came back (2+ days)', depth: 6, test: (a) => (a.active_days ?? 0) >= 2 },
  { key: 'paid', label: 'Upgraded to paid', depth: 7, test: (a) => a.is_trial === false },
];

// Which node feeds which. Kept explicit rather than derived from depth,
// because "previewed" and "bulk" hang off the line instead of continuing it.
const GRAPH_LINKS: Array<[string, string]> = [
  ['persona', 'signed_in'],
  ['signed_in', 'matched'],
  ['matched', 'previewed'],
  ['matched', 'generated'],
  ['generated', 'connected'],
  ['connected', 'sent'],
  ['sent', 'bulk'],
  ['sent', 'returned'],
  ['returned', 'paid'],
];

export function buildFunnelGraph(
  accounts: FunnelAccount[],
  persona: Persona,
  startDate: string | null,
  endDate: string | null,
): FunnelGraph {
  const cohort = accounts.filter((a) => inRange(a, startDate, endDate) && a.active_persona === persona);
  const bySpec = new Map(GRAPH_NODES.map((spec) => [spec.key, spec]));

  const nodes: FunnelNode[] = GRAPH_NODES.map((spec) => {
    const count = cohort.filter(spec.test).length;
    return {
      key: spec.key,
      label: spec.label,
      depth: spec.depth,
      count,
      overallRate: cohort.length === 0 ? 0 : count / cohort.length,
      aside: spec.aside,
      note: spec.note,
    };
  });

  // An account counts on a link only if it satisfies both ends. That is what
  // stops a link claiming more traffic than the node it flows into, which is
  // the usual way a diagram like this quietly lies.
  const links: FunnelLink[] = GRAPH_LINKS.map(([from, to]) => {
    const fromSpec = bySpec.get(from)!;
    const toSpec = bySpec.get(to)!;
    return { from, to, count: cohort.filter((a) => fromSpec.test(a) && toSpec.test(a)).length };
  });

  return { nodes, links, cohort: cohort.length };
}
