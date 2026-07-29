export interface MatchableJobContent {
  title?: string | null;
  description?: string | null;
  extracted_skills?: string | null;
  extracted_visa_types?: string | null;
  extracted_experience_years?: number | null;
  extracted_hourly_rate_min?: number | null;
  extracted_hourly_rate_max?: number | null;
  employment_type?: string | null;
  work_type?: string | null;
}

export function hasMeaningfulJobContent(job: MatchableJobContent): boolean {
  const description = (job.description ?? "").trim();
  if (description) return true;

  const title = (job.title ?? "").trim();
  const hasStructuredSignals = [
    job.extracted_skills,
    job.extracted_visa_types,
    job.extracted_experience_years != null ? String(job.extracted_experience_years) : "",
    job.extracted_hourly_rate_min != null ? String(job.extracted_hourly_rate_min) : "",
    job.extracted_hourly_rate_max != null ? String(job.extracted_hourly_rate_max) : "",
    job.employment_type,
    job.work_type,
  ].some((value) => (value ?? "").toString().trim().length > 0);

  return Boolean(title && hasStructuredSignals);
}
