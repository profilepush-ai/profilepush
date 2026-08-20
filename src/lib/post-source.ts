export type PostSource = 'linkedin_scrape' | 'user_post';

export function normalizePostSource(value: unknown): PostSource {
  return value === 'user_post' ? 'user_post' : 'linkedin_scrape';
}
