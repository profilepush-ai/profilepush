export interface RelevanceJob {
  title: string;
  description: string;
  extracted_skills: string;
}

const ROLE_STOP_WORDS = new Set([
  "senior",
  "junior",
  "lead",
  "staff",
  "principal",
  "mid",
  "level",
  "developer",
  "engineer",
  "architect",
  "manager",
  "i",
  "ii",
  "iii",
  "iv",
  "the",
  "and",
  "or",
  "a",
]);

export function filterRelevantJobs<T extends RelevanceJob>(
  jobs: T[],
  targetRole: string,
  coreSkills: string,
): T[] {
  const normalizedTargetRole = (targetRole ?? "").trim().toLowerCase();
  if (!normalizedTargetRole) return jobs;

  const roleWords = normalizedTargetRole
    .split(/[\s/,-]+/)
    .filter((word) => word.length > 2)
    .map((word) => word.toLowerCase())
    .filter((word) => !ROLE_STOP_WORDS.has(word));

  const skillWords = (coreSkills ?? "")
    .toLowerCase()
    .split(/[,;|]+/)
    .map((skill) => skill.trim())
    .filter((skill) => skill.length > 2);

  const primaryTech = roleWords;

  return jobs.filter((job) => {
    const title = job.title.toLowerCase();
    const descriptionText = `${job.description ?? ""} ${job.extracted_skills ?? ""}`.toLowerCase();

    if (primaryTech.length === 0) return true;

    const titleHasTech = primaryTech.some((term) => title.includes(term));
    const descHasTech = primaryTech.filter((term) => descriptionText.includes(term)).length >= Math.ceil(primaryTech.length * 0.5);

    if (!titleHasTech && !descHasTech) {
      const skillMatches = skillWords.filter((skill) => descriptionText.includes(skill)).length;
      if (skillMatches < 2) return false;
    }

    return true;
  });
}
