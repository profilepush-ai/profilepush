import { describe, expect, it } from 'vitest';
import { normalizePostSource } from './post-source';

describe('normalizePostSource', () => {
  it('recognizes a user-submitted post', () => {
    expect(normalizePostSource('user_post')).toBe('user_post');
  });

  it('defaults anything else to a scraped post, including missing/unknown values', () => {
    expect(normalizePostSource('linkedin_scrape')).toBe('linkedin_scrape');
    expect(normalizePostSource(undefined)).toBe('linkedin_scrape');
    expect(normalizePostSource(null)).toBe('linkedin_scrape');
    expect(normalizePostSource('')).toBe('linkedin_scrape');
    expect(normalizePostSource('something_else')).toBe('linkedin_scrape');
  });
});
