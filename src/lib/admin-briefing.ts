// The daily briefing at the top of the admin Charts pane.
//
// Every highlight and issue is derived from the series by rule. Nothing here
// is written by a language model: this dashboard is read by managers who will
// act on it, and a plausible-sounding sentence with a wrong number in it is
// worse than no sentence. If a rule cannot find its number, the line does not
// appear.

import type { SignupPoint } from './admin-signups-series';
import { formatChange, trendOf } from './admin-targets';

export type BriefLine = {
  key: string;
  text: string;
  tone: 'good' | 'bad' | 'neutral';
};

export type MetricSeries = {
  key: string;
  title: string;
  points: SignupPoint[];
  targets: SignupPoint[];
};

const latest = (points: SignupPoint[]) => (points.length ? points[points.length - 1] : null);
const sum = (points: SignupPoint[]) => points.reduce((total, p) => total + p.count, 0);

/** Up to five things that went well or are worth knowing, strongest first. */
export function buildHighlights(metrics: MetricSeries[]): BriefLine[] {
  const lines: Array<BriefLine & { weight: number }> = [];

  for (const metric of metrics) {
    if (!metric.points.length) continue;
    const trend = trendOf(metric.points);
    const total = sum(metric.points);
    if (total === 0) continue;

    if (trend.direction === 'up' && trend.change !== null && trend.change >= 0.1) {
      lines.push({
        key: `rise-${metric.key}`,
        text: `${metric.title} is up ${formatChange(trend.change)} on the first half of the range (${Math.round(trend.recent * 10) / 10}/day).`,
        tone: 'good',
        weight: trend.change,
      });
    }

    const today = latest(metric.points);
    const target = latest(metric.targets);
    if (today && target && target.count > 0 && today.count >= target.count) {
      lines.push({
        key: `ontarget-${metric.key}`,
        text: `${metric.title} met plan on the latest day: ${today.count} against a target of ${Math.round(target.count)}.`,
        tone: 'good',
        weight: 0.5 + (today.count - target.count) / target.count,
      });
    }

    const best = metric.points.reduce((top, p) => (p.count > top.count ? p : top), metric.points[0]);
    if (best.count > 0 && best.count >= trend.recent * 2 && metric.points.length > 3) {
      lines.push({
        key: `peak-${metric.key}`,
        text: `Best ${metric.title.toLowerCase()} day in range was ${best.key} at ${best.count}.`,
        tone: 'neutral',
        weight: 0.2,
      });
    }
  }

  return lines.sort((a, b) => b.weight - a.weight).slice(0, 5).map(({ weight: _weight, ...line }) => line);
}

/** Up to five things that need attention, worst first. */
export function buildIssues(metrics: MetricSeries[], blockers: BriefLine[] = []): BriefLine[] {
  const lines: Array<BriefLine & { weight: number }> = [];

  for (const metric of metrics) {
    if (!metric.points.length) continue;
    const trend = trendOf(metric.points);
    const total = sum(metric.points);

    if (total === 0) {
      lines.push({
        key: `zero-${metric.key}`,
        text: `${metric.title}: nothing at all in this range.`,
        tone: 'bad',
        weight: 1.5,
      });
      continue;
    }

    if (trend.direction === 'down' && trend.change !== null && trend.change <= -0.15) {
      lines.push({
        key: `fall-${metric.key}`,
        text: `${metric.title} is down ${formatChange(trend.change)} against the first half of the range.`,
        tone: 'bad',
        weight: Math.abs(trend.change) + 1,
      });
    }

    const today = latest(metric.points);
    const target = latest(metric.targets);
    if (today && target && target.count > 0) {
      const gap = (today.count - target.count) / target.count;
      if (gap <= -0.2) {
        lines.push({
          key: `behind-${metric.key}`,
          text: `${metric.title} is ${formatChange(gap)} behind plan: ${today.count} against a target of ${Math.round(target.count)}.`,
          tone: 'bad',
          weight: Math.abs(gap),
        });
      }
    }

    // A metric that has gone quiet in the last three days, having been active
    // before, is usually a broken pipeline rather than a slow week.
    const tail = metric.points.slice(-3);
    if (tail.length === 3 && sum(tail) === 0 && total > 0) {
      lines.push({
        key: `stalled-${metric.key}`,
        text: `${metric.title} has been zero for three days after activity earlier in the range — check the pipeline, not the market.`,
        tone: 'bad',
        weight: 2,
      });
    }
  }

  // Known blockers outrank anything the data can say, because they are the
  // reason some of the data is missing in the first place.
  const ranked = blockers.map((line, index) => ({ ...line, weight: 10 - index }));
  return [...ranked, ...lines]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map(({ weight: _weight, ...line }) => line);
}

export type Experiment = { key: string; text: string };

// Five-minute experiments. Each is something one person can do today without
// a deploy, a budget or a meeting — the constraint is deliberate: a list of
// week-long projects never gets ticked.
export const EXPERIMENT_CATALOGUE: Experiment[] = [
  { key: 'reply-groups', text: 'Answer three "looking for C2C requirements" posts in a LinkedIn group with a link to the matching requirement page.' },
  { key: 'share-permalink', text: 'Share one hotlist permalink into a WhatsApp group and watch whether it brings a signup.' },
  { key: 'dm-lapsed', text: 'Message five accounts that signed up but never posted, and ask what stopped them.' },
  { key: 'store-listing', text: 'Change one line of the Play Store short description to lead with "C2C requirements" and note the install rate.' },
  { key: 'first-post-nudge', text: 'Email everyone who signed up this week but has not posted, with one requirement that matches their persona.' },
  { key: 'rate-post', text: 'Post one rate benchmark from the requirement data — a median rate for a hot role — and see what it does for reach.' },
  { key: 'ask-referral', text: 'Ask the three most active accounts directly who else on their team should have an account.' },
  { key: 'thin-page', text: 'Open the three requirement pages with the fewest listings and decide whether they should exist at all.' },
  { key: 'signup-friction', text: 'Sign up as a new user on a phone and time it. Note every step that takes more than five seconds.' },
  { key: 'competitor-gap', text: 'Search the top three C2C keywords and note which competitor ranks above us and why.' },
  { key: 'ai-match-retry', text: 'Run AI Match yourself with a real consultant and judge whether the top three matches are genuinely good.' },
  { key: 'reactivate-gmail', text: 'Contact the accounts whose Gmail connection is revoked and ask them to reconnect.' },
];

/**
 * Five experiments for a given week, rotated so the list changes but repeats
 * predictably — the same week always offers the same five, which is what makes
 * a tick meaningful a month later.
 */
export function experimentsForWeek(weekStart: string, catalogue = EXPERIMENT_CATALOGUE): Experiment[] {
  if (!catalogue.length) return [];
  const weeks = Math.floor(Date.parse(`${weekStart}T00:00:00.000Z`) / (7 * 86_400_000));
  const offset = ((weeks % catalogue.length) + catalogue.length) % catalogue.length;
  return Array.from({ length: Math.min(5, catalogue.length) }, (_, i) => catalogue[(offset + i) % catalogue.length]);
}

/** Monday of the ISO week containing the date, in UTC. */
export function weekStartOf(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}
