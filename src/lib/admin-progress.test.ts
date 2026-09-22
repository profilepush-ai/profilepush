import { describe, expect, it } from 'vitest';
import { departmentScore, evaluateGoal, type Goal } from './admin-progress';

const points = (counts: number[]) =>
  counts.map((count, i) => ({ key: `2026-09-${String(22 + i).padStart(2, '0')}`, count }));

describe('evaluateGoal', () => {
  it('measures a flow goal against the summed 5%-a-day curve', () => {
    const goal: Goal = {
      key: 'signups', department: 'Growth', label: 'Signups', kind: 'flow',
      points: points([10, 10, 10]), base: 10,
    };
    const result = evaluateGoal(goal);
    expect(result.achieved).toBe(30);
    // 10 + 10.5 + 11.025 — flat delivery falls behind a compounding plan.
    expect(result.target).toBeCloseTo(31.525, 3);
    expect(result.attainment).toBeLessThan(0);
  });

  it('marks a flow goal as met when it beats the curve', () => {
    const goal: Goal = {
      key: 'signups', department: 'Growth', label: 'Signups', kind: 'flow',
      points: points([20, 20, 20]), base: 10,
    };
    expect(evaluateGoal(goal).attainment).toBeGreaterThan(0);
  });

  it('gives a flow goal with no activity no target rather than a zero one', () => {
    const goal: Goal = {
      key: 'chats', department: 'Product', label: 'Chats', kind: 'flow', points: points([0, 0, 0]),
    };
    const result = evaluateGoal(goal);
    expect(result.achieved).toBe(0);
    expect(result.target).toBeNull();
    expect(result.attainment).toBeNull();
  });

  it('measures a rate goal against a fixed share', () => {
    const goal: Goal = {
      key: 'persona', department: 'Growth', label: 'Persona chosen', kind: 'rate',
      numerator: 40, denominator: 100, target: 0.5,
    };
    const result = evaluateGoal(goal);
    expect(result.achieved).toBeCloseTo(0.4, 5);
    expect(result.attainment).toBeCloseTo(-0.2, 5);
    expect(result.direction).toBe('down');
    expect(result.unit).toBe('percent');
  });

  it('does not divide by zero on an empty rate denominator', () => {
    const goal: Goal = {
      key: 'persona', department: 'Growth', label: 'Persona chosen', kind: 'rate',
      numerator: 0, denominator: 0, target: 0.5,
    };
    expect(evaluateGoal(goal).achieved).toBe(0);
  });

  it('keeps an unconnected goal null rather than showing it as zero', () => {
    // A goal with no source must not read as a department failing its target.
    const goal: Goal = {
      key: 'revenue', department: 'Income', label: 'Revenue', kind: 'missing',
      missing: 'Razorpay is not connected to this dashboard',
    };
    const result = evaluateGoal(goal);
    expect(result.achieved).toBeNull();
    expect(result.target).toBeNull();
    expect(result.attainment).toBeNull();
    expect(result.direction).toBe('unknown');
    expect(result.missing).toContain('Razorpay');
  });

  it('reads direction from the shape of the series', () => {
    const rising = evaluateGoal({ key: 'a', department: 'Product', label: 'A', kind: 'flow', points: points([2, 2, 8, 8]) });
    const falling = evaluateGoal({ key: 'b', department: 'Product', label: 'B', kind: 'flow', points: points([8, 8, 2, 2]) });
    expect(rising.direction).toBe('up');
    expect(falling.direction).toBe('down');
  });
});

describe('departmentScore', () => {
  it('counts only goals that can be measured', () => {
    const results = [
      evaluateGoal({ key: 'a', department: 'Growth', label: 'A', kind: 'rate', numerator: 6, denominator: 10, target: 0.5 }),
      evaluateGoal({ key: 'b', department: 'Growth', label: 'B', kind: 'rate', numerator: 2, denominator: 10, target: 0.5 }),
      evaluateGoal({ key: 'c', department: 'Growth', label: 'C', kind: 'missing', missing: 'no source' }),
    ];
    const score = departmentScore(results);
    expect(score.measured).toBe(2);
    expect(score.met).toBe(1);
  });

  it('reports nothing measurable when every goal is unconnected', () => {
    const results = [evaluateGoal({ key: 'a', department: 'HR', label: 'A', kind: 'missing', missing: 'no source' })];
    expect(departmentScore(results)).toEqual({ met: 0, measured: 0, attainment: null });
  });
});
