import { describe, expect, it } from 'vitest';
import { consultantTitle, looksLikePersonName } from './consultant-title';

describe('consultantTitle', () => {
  it('hides names written where the role goes', () => {
    expect(consultantTitle('Name: Tejaswi Puvvada')).toBe('Available Consultant');
    expect(consultantTitle('Candidate Name - Ravi Kumar')).toBe('Available Consultant');
    expect(looksLikePersonName('Ravi Kumar')).toBe(true);
  });

  it('keeps real roles, including plurals and short forms', () => {
    for (const role of ['Java Developer', 'GenAI Engineers', 'Dot Net', '.NET Developers', 'Service Now', 'Sr. OCM', 'SENIOR AWS DATA ENGINEER', 'Salesforce Consultant / Architect']) {
      expect(consultantTitle(role)).toBe(role);
    }
  });

  it('falls back when empty', () => {
    expect(consultantTitle('')).toBe('Available Consultant');
    expect(consultantTitle(null, '')).toBe('');
  });
});
