export interface DemoRoleFormValues {
  target_role: string;
  years_experience: string;
  visa_status: string;
  work_authorization: string;
  work_type: string;
  preferred_locations: string;
  desired_salary_min: string;
  desired_salary_max: string;
  relocation_open: boolean;
  priority_skills: string;
}

export function getCreatedAtTimestamp(createdAt?: string | null): number | null {
  if (!createdAt) return null;
  const parsed = new Date(createdAt);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

export function getDemoRoleAccountIds(accountId: string | null | undefined, memberships: Array<{ account_id: string | null | undefined }> = []) {
  const ids = new Set<string>();

  if (accountId) {
    ids.add(accountId);
  }

  for (const membership of memberships) {
    if (membership.account_id) {
      ids.add(membership.account_id);
    }
  }

  return Array.from(ids);
}

export function getDemoRoleQueryAccountIds(accountId: string | null | undefined, memberships: Array<{ account_id: string | null | undefined }> = []) {
  const ids = getDemoRoleAccountIds(accountId, memberships);

  if (!accountId) {
    return ids;
  }

  return [accountId, ...ids.filter((id) => id !== accountId)];
}

export function buildDemoRolePayload(accountId: string, form: DemoRoleFormValues) {
  const parseNumber = (value: string) => {
    const trimmed = value.trim();
    return trimmed ? Number(trimmed) : null;
  };

  const normalizeText = (value: string) => {
    const trimmed = value.trim();
    return trimmed || null;
  };

  return {
    account_id: accountId,
    target_role: form.target_role.trim(),
    years_exp: parseNumber(form.years_experience),
    visa_status: normalizeText(form.visa_status),
    employment_type: normalizeText(form.work_authorization),
    work_type: normalizeText(form.work_type),
    preferred_locations: normalizeText(form.preferred_locations),
    min_rate_usd_per_hr: parseNumber(form.desired_salary_min),
    max_rate_usd_per_hr: parseNumber(form.desired_salary_max),
    relocation_open: form.relocation_open,
    priority_skills: normalizeText(form.priority_skills),
    schedule_frequency: 'daily' as const,
    is_active: true,
  };
}

export function getDemoRoleDisplayMatchCount(loadedMatchesCount: number | null | undefined, fallbackCount: number | null | undefined) {
  if (typeof loadedMatchesCount === 'number' && Number.isFinite(loadedMatchesCount)) {
    return loadedMatchesCount;
  }

  return typeof fallbackCount === 'number' && Number.isFinite(fallbackCount) ? fallbackCount : 0;
}

export function getLiveMatchActionLabel({ isScanning, isMatching }: { isScanning: boolean; isMatching: boolean }) {
  if (isScanning) return 'Scanning...';
  if (isMatching) return 'Matching...';
  return 'Live Match';
}

export function getWatchListDisplayMatchCount(loadedMatchesCount: number | null | undefined, fallbackCount: number | null | undefined) {
  if (typeof loadedMatchesCount === 'number' && Number.isFinite(loadedMatchesCount)) {
    return loadedMatchesCount;
  }

  return typeof fallbackCount === 'number' && Number.isFinite(fallbackCount) ? fallbackCount : 0;
}

