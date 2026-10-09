export type PostSource = 'linkedin_scrape' | 'user_post' | 'career_site';

export function normalizePostSource(value: unknown): PostSource {
  return value === 'user_post' || value === 'career_site' ? value : 'linkedin_scrape';
}
