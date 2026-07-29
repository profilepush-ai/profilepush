export interface RadarScoreBreakdownDetail {
  score: number;
  candidate_value: string;
  job_value: string;
  rule: string;
}

export interface RadarScoreBreakdownEntry {
  score: number;
  candidate_value: string;
  job_value: string;
  rule: string;
}

function normalizeDisplayValue(value?: string | null): string {
  return (value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreDisplayEmploymentTypeMatch(candidateEmploymentType?: string | null, jobEmploymentType?: string | null): number {
  const candidate = normalizeDisplayValue(candidateEmploymentType);
  const job = normalizeDisplayValue(jobEmploymentType);

  if (!candidate || !job || job === 'unknown' || job === 'na') return 70;
  if (candidate === 'any' || job === 'any') return 70;

  const candidateAliases = new Set<string>([
    candidate,
    candidate === 'c2c' ? 'corp2corp' : '',
    candidate === '1099' ? 'contract' : '',
    candidate === 'w2' ? 'employee' : '',
  ].filter(Boolean));

  const jobAliases = new Set<string>([
    job,
    job === 'c2c' ? 'corp2corp' : '',
    job === '1099' ? 'contract' : '',
    job === 'w2' ? 'employee' : '',
  ].filter(Boolean));

  for (const value of candidateAliases) {
    if (jobAliases.has(value)) return 100;
  }

  return 20;
}

function scoreDisplayWorkTypeMatch(candidateWorkType?: string | null, jobWorkType?: string | null, candidateRelocation = false): number {
  const candidate = normalizeDisplayValue(candidateWorkType);
  const job = normalizeDisplayValue(jobWorkType);

  if (!candidate) return 80;
  if (!job || job === 'unknown') return 80;
  if (candidate.includes(job) || job.includes(candidate) || job === 'remote') return 100;
  if (job === 'hybrid' && (candidate.includes('remote') || candidate.includes('hybrid'))) return 80;
  if (job === 'onsite' && candidate.includes('remote')) return candidateRelocation ? 50 : 20;
  return 50;
}

export function buildScoreBreakdownDisplayItems(
  breakdown: Record<string, RadarScoreBreakdownEntry | number> | undefined,
  profile?: { work_authorization?: string | null; work_type?: string | null },
  job?: { employment_type?: string | null; work_type?: string | null },
) {
  const entries = Object.entries(breakdown ?? {});
  const displayItems = entries.map(([key, value]) => {
    const isDetailed = typeof value === 'object' && value !== null && 'score' in value;
    return {
      key,
      score: isDetailed ? (value as RadarScoreBreakdownEntry).score : (Number(value) || 0),
      detail: isDetailed ? { candidate_value: value.candidate_value, job_value: value.job_value, rule: value.rule } : undefined,
    };
  });

  const employmentTypeValue = (profile?.work_authorization ?? '').trim();
  const jobEmploymentTypeValue = (job?.employment_type ?? '').trim();
  if (employmentTypeValue || jobEmploymentTypeValue) {
    const existing = displayItems.find(item => item.key === 'employment_type_match');
    const score = scoreDisplayEmploymentTypeMatch(employmentTypeValue, jobEmploymentTypeValue);

    if (!existing) {
      displayItems.push({
        key: 'employment_type_match',
        score,
        detail: {
          candidate_value: employmentTypeValue || 'Not specified',
          job_value: jobEmploymentTypeValue || 'Not specified',
          rule: 'Matches employment-type preference against the job posting.',
        },
      });
    }
  }

  const workTypeValue = (profile?.work_type ?? '').trim();
  const jobWorkTypeValue = (job?.work_type ?? '').trim();
  if (workTypeValue || jobWorkTypeValue) {
    const existing = displayItems.find(item => item.key === 'work_type_match');
    const score = scoreDisplayWorkTypeMatch(workTypeValue, jobWorkTypeValue);

    if (!existing) {
      displayItems.push({
        key: 'work_type_match',
        score,
        detail: {
          candidate_value: workTypeValue || 'Not specified',
          job_value: jobWorkTypeValue || 'Not specified',
          rule: 'Matches work-arrangement preference against the job posting.',
        },
      });
    }
  }

  return displayItems.sort((a, b) => b.score - a.score);
}

export function getDisplayJobTitle(job?: { job_title?: string | null; company_name?: string | null; job_description?: string | null; post_content?: string | null }) {
  const candidateTitle = (job?.job_title ?? '').trim();
  if (candidateTitle) return candidateTitle;

  const description = (job?.job_description ?? '').trim();
  if (description) return description.split(/\n+/)[0].trim();

  const postContent = (job?.post_content ?? '').trim();
  if (postContent) return postContent.split(/\n+/)[0].trim();

  const companyName = (job?.company_name ?? '').trim();
  return companyName ? `${companyName} role` : 'Position details unavailable';
}

export function getDisplayJobDescription(job?: { job_description?: string | null; post_content?: string | null }) {
  const description = (job?.job_description ?? '').trim();
  if (description) return description;
  const postContent = (job?.post_content ?? '').trim();
  if (postContent) return postContent;
  return 'No description available.';
}
