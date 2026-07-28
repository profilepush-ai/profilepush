export interface MatchHealthProfileLike {
  target_role?: string | null;
  priority_skills?: string | null;
  years_experience?: number | string | null;
  visa_status?: string | null;
  work_authorization?: string | null;
  work_type?: string | null;
  preferred_locations?: string | null;
  desired_salary_min?: number | string | null;
  desired_salary_max?: number | string | null;
}

const MATCH_HEALTH_FIELDS = [
  'target_role',
  'years_experience',
  'visa_status',
  'work_authorization',
  'work_type',
  'preferred_locations',
  'desired_salary_min',
  'desired_salary_max',
] as const;

function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function hasValue(value: number | string | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'number') return Number.isFinite(value);
  return value.trim().length > 0;
}

export function getMatchHealthPercent(profile: MatchHealthProfileLike): number {
  const filled = MATCH_HEALTH_FIELDS.filter(field => {
    switch (field) {
      case 'target_role':
      case 'visa_status':
      case 'work_authorization':
      case 'work_type':
      case 'preferred_locations':
        return hasText(profile[field]);
      case 'years_experience':
        return hasValue(profile.years_experience);
      case 'desired_salary_min':
      case 'desired_salary_max':
        return hasValue(profile[field]);
      default:
        return false;
    }
  }).length;

  return MATCH_HEALTH_FIELDS.length === 0 ? 0 : Math.round((filled / MATCH_HEALTH_FIELDS.length) * 100);
}
