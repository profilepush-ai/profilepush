export type ProfileCardItem = {
  target_role: string;
  summary?: string | null;
  priority_skills?: string | null;
  preferred_locations?: string | null;
  visa_status?: string | null;
  employment_type?: string | null;
  work_type?: string | null;
  min_years_exp?: number | null;
  max_years_exp?: number | null;
  min_rate_usd_per_hr?: number | null;
  max_rate_usd_per_hr?: number | null;
  relocation_open?: boolean | null;
  jobsCount?: number | null;
  vendorsCount?: number | null;
};

export function normalizeProfileQueryText(value?: string | null) {
  return (value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function filterProfilesByQuery(items: ProfileCardItem[], query: string) {
  const normalizedQuery = normalizeProfileQueryText(query);
  if (!normalizedQuery) return items;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (!tokens.length) return items;

  return items.filter((item) => {
    const haystack = [
      item.target_role,
      item.summary,
      item.priority_skills,
      item.preferred_locations,
      item.visa_status,
      item.employment_type,
      item.work_type,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return tokens.every((token) => haystack.includes(token));
  });
}

export function sortProfilesByMetrics(items: ProfileCardItem[]) {
  return [...items].sort((a, b) => {
    const aJobs = a.jobsCount ?? 0;
    const bJobs = b.jobsCount ?? 0;
    const aVendors = a.vendorsCount ?? 0;
    const bVendors = b.vendorsCount ?? 0;

    if (bJobs !== aJobs) return bJobs - aJobs;
    if (bVendors !== aVendors) return bVendors - aVendors;
    return (a.target_role ?? '').localeCompare(b.target_role ?? '');
  });
}

export function getProfileCardDetails(item: ProfileCardItem) {
  const minYears = item.min_years_exp;
  const maxYears = item.max_years_exp;
  const minRate = item.min_rate_usd_per_hr;
  const maxRate = item.max_rate_usd_per_hr;

  return {
    experience: minYears != null && maxYears != null ? `${minYears}-${maxYears} yrs` : 'Flexible',
    location: item.preferred_locations || 'Remote / Flexible',
    visa: item.visa_status || 'Open',
    employment: item.employment_type || 'Any',
    workType: item.work_type || 'Any',
    rate: minRate != null || maxRate != null ? `$${minRate ?? '?'}-$${maxRate ?? '?'}` : 'Open',
    skills: (item.priority_skills || '').split(',').map((skill) => skill.trim()).filter(Boolean).slice(0, 6),
    relocation: item.relocation_open ? 'Relocation open' : 'No relocation',
  };
}

export function getProfileSkillList(role: string, personaSkills?: string | null) {
  const skillStr = personaSkills ?? '';
  if (!skillStr) return [];
  return skillStr.split(',').map((item) => item.trim()).filter(Boolean);
}

export function buildProfileCardsFromRolesAndFeedRows(
  rolesData: Array<{
    target_role?: string | null;
    summary?: string | null;
    priority_skills?: string | null;
    preferred_locations?: string | null;
    visa_status?: string | null;
    employment_type?: string | null;
    work_type?: string | null;
    min_years_exp?: number | null;
    max_years_exp?: number | null;
    min_rate_usd_per_hr?: number | null;
    max_rate_usd_per_hr?: number | null;
    relocation_open?: boolean | null;
  }> | null | undefined,
  feedRows: Array<{
    job_title?: string | null;
    post_content?: string | null;
    posted_by_name?: string | null;
    poster_email?: string | null;
    poster_phone?: string | null;
    extracted_role_normalized?: string | null;
  }> | null | undefined,
) {
  const normalizedFeedRows = (feedRows ?? []).filter(Boolean);

  return (rolesData ?? []).map((role) => {
    const roleTitle = role.target_role ?? 'Untitled profile';
    const skills = getProfileSkillList(roleTitle, role.priority_skills ?? '');
    const matchedRows = normalizedFeedRows.filter((row) => roleMatchesProfileRow(row, roleTitle, skills));

    const vendors = new Set<string>();
    for (const row of matchedRows) {
      const vendorKey = (row.poster_email ?? '').trim() || (row.poster_phone ?? '').trim() || (row.posted_by_name ?? '').trim();
      if (vendorKey) vendors.add(vendorKey.toLowerCase());
    }

    return {
      target_role: roleTitle,
      summary: role.summary ?? 'Role profile tracked across the live market board.',
      priority_skills: role.priority_skills ?? '',
      preferred_locations: role.preferred_locations ?? '',
      visa_status: role.visa_status ?? '',
      employment_type: role.employment_type ?? '',
      work_type: role.work_type ?? '',
      min_years_exp: role.min_years_exp ?? null,
      max_years_exp: role.max_years_exp ?? null,
      min_rate_usd_per_hr: role.min_rate_usd_per_hr ?? null,
      max_rate_usd_per_hr: role.max_rate_usd_per_hr ?? null,
      relocation_open: role.relocation_open ?? false,
      jobsCount: matchedRows.length,
      vendorsCount: vendors.size,
    } satisfies ProfileCardItem;
  });
}

export function roleMatchesProfileRow(row: { job_title?: string | null; post_content?: string | null; extracted_role_normalized?: string | null }, role: string, personaSkills: string[]) {
  const roleText = normalizeProfileQueryText(role);
  const titleText = normalizeProfileQueryText(`${row.extracted_role_normalized ?? ''} ${row.job_title ?? ''}`);
  const fullText = normalizeProfileQueryText(`${titleText} ${row.post_content ?? ''}`);
  if (!fullText) return false;

  if (fullText.includes(roleText)) return true;

  const roleTokens = roleText
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !['engineer', 'developer', 'senior', 'lead', 'staff', 'principal'].includes(token));

  const titleRoleHits = roleTokens.reduce((count, token) => count + (titleText.includes(token) ? 1 : 0), 0);
  const fullRoleHits = roleTokens.reduce((count, token) => count + (fullText.includes(token) ? 1 : 0), 0);
  const skillHits = personaSkills.reduce((count, skill) => count + (fullText.includes(normalizeProfileQueryText(skill)) ? 1 : 0), 0);

  if (roleTokens.length > 0) {
    if (titleRoleHits >= Math.min(2, roleTokens.length)) return true;
    if (fullRoleHits >= Math.min(2, roleTokens.length) && skillHits >= 1) return true;
    return false;
  }

  return skillHits >= 2;
}
