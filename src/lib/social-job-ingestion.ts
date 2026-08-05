export type SocialJobItem = Record<string, unknown>;

export type NormalizedSocialJobItem = {
  post_id: string;
  platform: string;
  post_content: string;
  posted_by_name: string;
  posted_at: string | null;
  profile_link: string;
  poster_email: string;
  poster_phone: string;
  post_url: string;
  job_title: string;
  company_name: string;
  location: string;
  employment_type: string;
  seniority_level: string;
  job_description: string;
  salary_range: string;
  account_id: string | null;
};

export type NormalizedSocialJobPayload = {
  rows: NormalizedSocialJobItem[];
  errors: string[];
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asIsoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.seconds === 'number') return new Date(obj.seconds * 1000).toISOString();
    if (obj.$date) return new Date(String(obj.$date)).toISOString();
  }
  return null;
}

export function normalizeSocialJobItems(items: SocialJobItem[]): NormalizedSocialJobPayload {
  const rows: NormalizedSocialJobItem[] = [];
  const errors: string[] = [];

  for (const item of items) {
    const postId = asString(item.post_id ?? item.external_id ?? item.id ?? item.postId);
    const platform = asString(item.platform ?? item.source ?? item.provider).trim().toLowerCase();
    const postContent = asString(item.post_content ?? item.body ?? item.description ?? item.content).trim();

    if (!postId || !platform || !postContent) {
      errors.push('Each item requires: post_id, platform, post_content');
      continue;
    }

    rows.push({
      post_id: postId,
      platform,
      post_content: postContent,
      posted_by_name: asString(item.posted_by_name ?? item.poster_name ?? item.recruiter_name),
      posted_at: asIsoOrNull(item.posted_at ?? item.created_at ?? item.timestamp),
      profile_link: asString(item.profile_link ?? item.profileUrl ?? item.profile_url),
      poster_email: asString(item.poster_email ?? item.email ?? item.posterEmail),
      poster_phone: asString(item.poster_phone ?? item.phone ?? item.posterPhone),
      post_url: asString(item.post_url ?? item.url ?? item.postUrl),
      job_title: asString(item.job_title ?? item.title ?? item.role),
      company_name: asString(item.company_name ?? item.company ?? item.companyName),
      location: asString(item.location ?? item.work_location ?? item.workLocation),
      employment_type: asString(item.employment_type ?? item.employmentType),
      seniority_level: asString(item.seniority_level ?? item.seniorityLevel),
      job_description: asString(item.job_description ?? item.description ?? item.body ?? item.post_content),
      salary_range: asString(item.salary_range ?? item.salaryRange),
      account_id: item.account_id ? String(item.account_id) : null,
    });
  }

  return { rows, errors };
}

export async function logSocialJobPayload(
  insertLog: (payload: Record<string, unknown>) => Promise<unknown>,
  payload: Record<string, unknown>,
  normalizedRows: NormalizedSocialJobItem[],
  errors: string[],
  insertedCount: number,
  status: string,
): Promise<boolean> {
  try {
    await insertLog({
      function_name: 'receive-social-job',
      source: payload?.source ?? null,
      payload,
      normalized_rows: normalizedRows,
      errors,
      inserted_count: insertedCount,
      status,
    });
    return true;
  } catch (error) {
    console.error('social_job_payload_logs insert failed:', error);
    return false;
  }
}
