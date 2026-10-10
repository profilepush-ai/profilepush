import { describe, expect, it } from 'vitest';
import { ACTIVATION_STAGES, MONEY_STAGES, buildStages, formatRate, worstStep } from './admin-funnel';

const counts = {
  signed_up: 100, chose_role: 90, added_first: 60, got_match: 58, watched: 20,
  applied: 15, replied: 2, interview: 1, placed: 0,
  ran_out: 10, saw_teasers: 8, paused: 3, second_chance: 1, paid: 2, paid_after_out: 1,
};

describe('buildStages', () => {
  it('reads the stages in order and rates each against the one above', () => {
    const stages = buildStages(counts, ACTIVATION_STAGES, 'all');
    expect(stages.map((s) => s.key)).toEqual(
      ['signed_up', 'chose_role', 'added_first', 'got_match', 'watched', 'applied', 'replied', 'interview', 'placed']);
    expect(stages.map((s) => s.count)).toEqual([100, 90, 60, 58, 20, 15, 2, 1, 0]);
    expect(stages[0].stepRate).toBeNull();
    expect(stages[1].stepRate).toBeCloseTo(0.9, 5);
    expect(stages[1].dropped).toBe(10);
    expect(stages[4].overallRate).toBeCloseTo(0.2, 5);
  });

  it('names the steps in each role\'s words', () => {
    expect(buildStages(counts, ACTIVATION_STAGES, 'jobs').find((s) => s.key === 'applied')?.label).toBe('Asked for a resume');
    expect(buildStages(counts, ACTIVATION_STAGES, 'jobs').find((s) => s.key === 'added_first')?.label).toBe('Posted a first job');
    expect(buildStages(counts, ACTIVATION_STAGES, 'profiles').find((s) => s.key === 'applied')?.label).toBe('Applied');
  });

  it('ends the money funnel on paid', () => {
    const stages = buildStages(counts, MONEY_STAGES, 'all');
    expect(stages[stages.length - 1].key).toBe('paid');
    expect(stages[stages.length - 1].overallRate).toBeCloseTo(0.02, 5);
  });

  it('reports zero rates rather than dividing by zero when nothing came back', () => {
    const stages = buildStages(undefined, ACTIVATION_STAGES, 'all');
    expect(stages.every((s) => s.count === 0)).toBe(true);
    expect(stages[1].stepRate).toBe(0);
    expect(stages[2].overallRate).toBe(0);
  });
});

describe('worstStep', () => {
  it('finds the steepest drop', () => {
    expect(worstStep(buildStages(counts, ACTIVATION_STAGES, 'all'))?.key).toBe('placed');
  });

  it('returns nothing when no one drops out', () => {
    const flat = Object.fromEntries(ACTIVATION_STAGES.map((s) => [s.key, 5]));
    expect(worstStep(buildStages(flat, ACTIVATION_STAGES, 'all'))).toBeNull();
  });
});

describe('formatRate', () => {
  it('rounds to a whole percent and shows a dash for no rate', () => {
    expect(formatRate(0.456)).toBe('46%');
    expect(formatRate(null)).toBe('—');
  });
});
