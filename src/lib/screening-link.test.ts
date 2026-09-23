import { describe, expect, it } from 'vitest';
import { hasScreeningLink, withScreeningLink } from './screening-link';

const URL = 'https://profilepush.ai/screen/XYBBKpVITSme0M2r0ZUyRA';

describe('withScreeningLink', () => {
  it('puts the link above a trailing signature', () => {
    const body = 'Hi Gopal — I have a live client requirement that fits your Sr. Salesforce Developer. Next step is a short video screening, about five minutes.\n\nPoorna';
    expect(withScreeningLink(body, URL)).toBe(
      'Hi Gopal — I have a live client requirement that fits your Sr. Salesforce Developer. Next step is a short video screening, about five minutes.'
      + `\n\nScreening link:\n${URL}\n\nPoorna`,
    );
  });

  it('handles a dashed signature', () => {
    const out = withScreeningLink('Message body here.\n\n— Poorna', URL);
    expect(out.endsWith('— Poorna')).toBe(true);
    expect(out.indexOf(URL)).toBeLessThan(out.indexOf('— Poorna'));
  });

  it('appends at the end when the last line is a sentence', () => {
    // No signature to sit under, so the link goes last rather than being
    // wedged above the final sentence.
    const out = withScreeningLink('Hi Ravi, here is the requirement.', URL);
    expect(out).toBe(`Hi Ravi, here is the requirement.\n\nScreening link:\n${URL}`);
  });

  it('does not treat a long final line as a signature', () => {
    const body = 'Hi Ravi\n\nThis last line is far too long to be somebody name and should stay put';
    const out = withScreeningLink(body, URL);
    expect(out.endsWith(URL)).toBe(true);
  });

  it('survives a single-line draft', () => {
    expect(withScreeningLink('Poorna', URL)).toBe(`Poorna\n\nScreening link:\n${URL}`);
  });

  it('returns just the link for an empty draft', () => {
    expect(withScreeningLink('   ', URL)).toBe(`Screening link:\n${URL}`);
  });
});

describe('hasScreeningLink', () => {
  it('detects an existing link so it is not added twice', () => {
    expect(hasScreeningLink(`body\n\nScreening link:\n${URL}`)).toBe(true);
    expect(hasScreeningLink('body with no link')).toBe(false);
  });
});
