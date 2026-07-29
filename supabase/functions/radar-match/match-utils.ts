function normalizeValue(value?: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function scoreEmploymentTypeMatch(candidateEmploymentType?: string | null, jobEmploymentType?: string | null): number {
  const candidate = normalizeValue(candidateEmploymentType);
  const job = normalizeValue(jobEmploymentType);

  if (!candidate || !job || job === "unknown" || job === "na") {
    return 70;
  }

  if (candidate === "any" || job === "any") {
    return 70;
  }

  const candidateAliases = new Set<string>([
    candidate,
    candidate === "c2c" ? "corp2corp" : "",
    candidate === "1099" ? "contract" : "",
    candidate === "w2" ? "employee" : "",
  ].filter(Boolean));

  const jobAliases = new Set<string>([
    job,
    job === "c2c" ? "corp2corp" : "",
    job === "1099" ? "contract" : "",
    job === "w2" ? "employee" : "",
  ].filter(Boolean));

  for (const value of candidateAliases) {
    if (jobAliases.has(value)) {
      return 100;
    }
  }

  return 20;
}

export function scoreWorkTypeMatch(candidateWorkType?: string | null, jobWorkType?: string | null, candidateRelocation = false): number {
  const candidate = normalizeValue(candidateWorkType);
  const job = normalizeValue(jobWorkType);

  if (!candidate) return 80;
  if (!job || job === "unknown") return 80;

  if (candidate.includes(job) || job.includes(candidate) || job === "remote") {
    return 100;
  }

  if (job === "hybrid" && (candidate.includes("remote") || candidate.includes("hybrid"))) {
    return 80;
  }

  if (job === "onsite" && candidate.includes("remote")) {
    return candidateRelocation ? 50 : 20;
  }

  return 50;
}
