export interface RoleStatsSummary {
  job_count: number;
  watch_count: number;
  active_watch_count: number;
}

export interface FeedRowLike {
  id?: string | null;
  extracted_role_normalized?: string | null;
  job_title?: string | null;
  post_content?: string | null;
}

export function buildRoleFeedRowsFromMatches(
  matchRows: Array<{ job_source?: string | null; job_id?: string | null; created_at?: string | null }>,
  socialRows: FeedRowLike[]
) {
  const socialById = new Map<string, FeedRowLike>();
  for (const row of socialRows) {
    const id = (row.id ?? '').trim();
    if (id) socialById.set(id, row);
  }

  const latestByJobKey = new Map<string, { jobId: string; createdAt: string | null }>();
  for (const row of matchRows) {
    const source = (row.job_source ?? '').trim() || 'unknown';
    const jobId = (row.job_id ?? '').trim();
    if (!jobId || source !== 'social') continue;

    const key = `${source}:${jobId}`;
    const current = latestByJobKey.get(key);
    const createdAt = row.created_at ?? null;
    if (!current || !createdAt || !current.createdAt || new Date(createdAt).getTime() > new Date(current.createdAt).getTime()) {
      latestByJobKey.set(key, { jobId, createdAt });
    }
  }

  const feedRows: FeedRowLike[] = [];
  for (const entry of latestByJobKey.values()) {
    const socialRow = socialById.get(entry.jobId);
    if (!socialRow) continue;
    feedRows.push({
      id: socialRow.id,
      extracted_role_normalized: socialRow.extracted_role_normalized ?? null,
      job_title: socialRow.job_title ?? null,
      post_content: socialRow.post_content ?? null,
    });
  }

  return feedRows;
}

function normalize(input: string | null | undefined) {
  return (input ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function canonicalizeRoleForUniqueness(role: string) {
  return normalize(role)
    .replace(/\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|ii|iii|iv)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPersonaSkillList(role: string, personaSkills?: string | null) {
  const skillStr = personaSkills ?? '';
  if (!skillStr) return [];
  return skillStr.split(',').map((item) => item.trim()).filter(Boolean);
}

function roleMatchesPersona(row: { extracted_role_normalized?: string | null; job_title?: string | null; post_content?: string | null }, personaRole: string, personaSkills: string[]) {
  const roleText = normalize(personaRole);
  const titleText = normalize(`${row.extracted_role_normalized ?? ''} ${row.job_title ?? ''}`);
  const fullText = normalize(`${titleText} ${row.post_content ?? ''}`);
  if (!fullText) return false;

  if (fullText.includes(roleText)) return true;

  const roleTokens = canonicalizeRoleForUniqueness(personaRole)
    .split(' ')
    .filter((token) => token.length >= 3 && !['engineer', 'developer', 'senior', 'lead', 'staff', 'principal'].includes(token));

  const titleRoleHits = roleTokens.reduce((count, token) => count + (titleText.includes(token) ? 1 : 0), 0);
  const fullRoleHits = roleTokens.reduce((count, token) => count + (fullText.includes(token) ? 1 : 0), 0);
  const skillHits = personaSkills.reduce((count, skill) => count + (fullText.includes(normalize(skill)) ? 1 : 0), 0);

  if (roleTokens.length > 0) {
    if (titleRoleHits >= Math.min(2, roleTokens.length)) return true;
    if (fullRoleHits >= Math.min(2, roleTokens.length) && skillHits >= 1) return true;
    return false;
  }

  return skillHits >= 2;
}

export function buildRoleStatsSummary(
  roles: Array<{ id: string; target_role?: string | null; priority_skills?: string | null }>,
  radarRows: Array<{ role_id?: string | null; extracted_role_normalized?: string | null; job_title?: string | null; post_content?: string | null }>,
  watchRows: Array<{ source_hotlist_role_id?: string | null; is_watching?: boolean | null }>
) {
  const summary = new Map<string, RoleStatsSummary>();

  for (const role of roles) {
    summary.set(role.id, { job_count: 0, watch_count: 0, active_watch_count: 0 });
  }

  for (const role of roles) {
    const roleId = role.id;
    const skills = getPersonaSkillList(role.target_role ?? '', role.priority_skills ?? '');
    const existing = summary.get(roleId)!;

    for (const radarRow of radarRows) {
      if (!roleMatchesPersona(radarRow, role.target_role ?? '', skills)) continue;
      existing.job_count += 1;
    }
  }

  for (const watchRow of watchRows) {
    const roleId = watchRow.source_hotlist_role_id ?? '';
    if (!roleId || !summary.has(roleId)) continue;
    const existing = summary.get(roleId)!;
    existing.watch_count += 1;
    if (watchRow.is_watching) {
      existing.active_watch_count += 1;
    }
  }

  return Object.fromEntries(summary.entries()) as Record<string, RoleStatsSummary>;
}
