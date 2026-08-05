export type PulseFeedSearchScope = 'all' | 'role' | 'skills' | 'location' | 'visa' | 'experience' | 'rate';

export type PulseFeedSearchCandidate = {
  title?: string | null;
  company?: string | null;
  location?: string | null;
  posterName?: string | null;
  employmentType?: string | null;
  seniority?: string | null;
  salaryRange?: string | null;
  hourlyRate?: string | null;
  snippet?: string | null;
  skills?: string[] | null;
  experienceYears?: number | null;
  visaTypes?: string[] | null;
  roleTitle?: string | null;
};

function normalizePulseFeedSearchText(value?: string | null) {
  return (value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildPulseFeedSearchText(candidate: PulseFeedSearchCandidate, scope: PulseFeedSearchScope = 'all') {
  const skillText = (candidate.skills ?? []).join(' ');
  const visaText = (candidate.visaTypes ?? []).join(' ');
  const experienceText = candidate.experienceYears != null ? `${candidate.experienceYears} years` : '';

  const fieldBuckets: Record<PulseFeedSearchScope, Array<string | null | undefined>> = {
    all: [
      candidate.roleTitle,
      candidate.title,
      candidate.company,
      candidate.location,
      candidate.posterName,
      candidate.employmentType,
      candidate.seniority,
      candidate.salaryRange,
      candidate.hourlyRate,
      candidate.snippet,
      skillText,
      visaText,
      experienceText,
    ],
    role: [candidate.roleTitle, candidate.title, candidate.company, candidate.posterName],
    skills: [skillText, candidate.title, candidate.roleTitle],
    location: [candidate.location, candidate.company, candidate.posterName],
    visa: [visaText, candidate.title, candidate.roleTitle],
    experience: [experienceText, candidate.title, candidate.roleTitle],
    rate: [candidate.salaryRange, candidate.hourlyRate, candidate.title, candidate.roleTitle],
  };

  return fieldBuckets[scope]
    .filter(Boolean)
    .map(normalizePulseFeedSearchText)
    .join(' ');
}

export function matchesPulseFeedSearch(candidate: PulseFeedSearchCandidate, query: string, scope: PulseFeedSearchScope = 'all') {
  const normalizedQuery = normalizePulseFeedSearchText(query);
  if (!normalizedQuery) return true;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const haystack = buildPulseFeedSearchText(candidate, scope);
  return tokens.every((token) => haystack.includes(token));
}
