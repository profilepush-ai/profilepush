export interface RadarMatchResultLike {
  id?: string;
  profile_id?: string;
  job_source?: string;
  job_id?: string;
  final_average_score?: number;
  score_breakdown?: Record<string, unknown>;
  ai_notes?: string;
  disqualified?: boolean;
  disqualify_reason?: string | null;
  created_at?: string;
}

export function normalizeRadarMatchResults(rows: Array<Record<string, unknown>>): RadarMatchResultLike[] {
  return rows.map((row) => ({
    id: String(row.id ?? ''),
    profile_id: String(row.profile_id ?? ''),
    job_source: String(row.job_source ?? ''),
    job_id: String(row.job_id ?? ''),
    final_average_score: Number(row.final_average_score ?? 0),
    score_breakdown: (row.score_breakdown as Record<string, unknown>) ?? {},
    ai_notes: String(row.ai_notes ?? ''),
    disqualified: Boolean(row.disqualified),
    disqualify_reason: (row.disqualify_reason as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
  }));
}
