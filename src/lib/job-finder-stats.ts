export interface JobFinderProfileBoardStats {
  fetched: number;
  matched: number;
}

interface ProfileLike { id: string; }
interface SearchRow { id: string; profile_id: string | null; created_at?: string | null; }
interface JobRow { id?: string; search_id: string | null; }
interface ScoreRow {
  profile_id: string | null;
  linkedin_job_id?: string | null;
  dice_job_id?: string | null;
  indeed_job_id?: string | null;
  monster_job_id?: string | null;
  careerbuilder_job_id?: string | null;
}

interface BuildProfileBoardStatsInput {
  profiles: ProfileLike[];
  boardSearches: SearchRow[][];
  boardJobs: JobRow[][];
  scoreRows: ScoreRow[];
}

function getLatestSearchIds(searchRows: SearchRow[]): Map<string, Set<string>> {
  const byProfile = new Map<string, SearchRow[]>();
  searchRows.forEach(row => {
    if (!row.profile_id) return;
    const rows = byProfile.get(row.profile_id) ?? [];
    rows.push(row);
    byProfile.set(row.profile_id, rows);
  });

  const latestIds = new Map<string, Set<string>>();
  byProfile.forEach((rows, profileId) => {
    const sorted = [...rows].sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
    const latestRow = sorted[0];
    if (latestRow?.id) {
      latestIds.set(profileId, new Set([latestRow.id]));
    }
  });
  return latestIds;
}

export function buildProfileBoardStats({
  profiles,
  boardSearches,
  boardJobs,
  scoreRows,
}: BuildProfileBoardStatsInput): Record<string, JobFinderProfileBoardStats> {
  const statsByProfile: Record<string, JobFinderProfileBoardStats> = Object.fromEntries(
    profiles.map(profile => [profile.id, { fetched: 0, matched: 0 }])
  ) as Record<string, JobFinderProfileBoardStats>;

  const latestSearchIdsByBoard = boardSearches.map(searchRows => getLatestSearchIds(searchRows));
  const latestJobIdsByBoard: Array<Map<string, Set<string>>> = [];

  boardJobs.forEach((jobs, boardIndex) => {
    const latestSearchIds = latestSearchIdsByBoard[boardIndex] ?? new Map<string, Set<string>>();
    const latestJobIdsByProfile = new Map<string, Set<string>>();

    jobs.forEach(job => {
      const searchId = job.search_id;
      if (!searchId) return;

      const profileId = boardSearches[boardIndex].find(search => search.id === searchId)?.profile_id;
      if (!profileId) return;

      if (latestSearchIds.get(profileId)?.has(searchId)) {
        const jobIds = latestJobIdsByProfile.get(profileId) ?? new Set<string>();
        if (job.id) {
          jobIds.add(job.id);
        }
        latestJobIdsByProfile.set(profileId, jobIds);
      }
    });

    latestJobIdsByBoard.push(latestJobIdsByProfile);
  });

  boardJobs.forEach((jobs, boardIndex) => {
    const latestJobIds = latestJobIdsByBoard[boardIndex] ?? new Map<string, Set<string>>();
    jobs.forEach(job => {
      const searchId = job.search_id;
      if (!searchId) return;
      const profileId = boardSearches[boardIndex].find(search => search.id === searchId)?.profile_id;
      if (!profileId) return;
      if (!latestJobIds.get(profileId)?.has(job.id ?? '')) return;
      statsByProfile[profileId] ??= { fetched: 0, matched: 0 };
      statsByProfile[profileId].fetched += 1;
    });
  });

  scoreRows.forEach((row, rowIndex) => {
    const profileId = row.profile_id;
    if (!profileId) return;

    const boardValues = [
      { boardIndex: 0, value: row.linkedin_job_id },
      { boardIndex: 1, value: row.dice_job_id },
      { boardIndex: 2, value: row.indeed_job_id },
      { boardIndex: 3, value: row.monster_job_id },
      { boardIndex: 4, value: row.careerbuilder_job_id },
    ];

    const matchedCount = boardValues.filter(({ value, boardIndex }) => {
      const latestJobIds = latestJobIdsByBoard[boardIndex] ?? new Map<string, Set<string>>();
      return value != null && value !== '' && latestJobIds.get(profileId)?.has(value);
    }).length;

    if (matchedCount === 0) return;
    statsByProfile[profileId] ??= { fetched: 0, matched: 0 };
    statsByProfile[profileId].matched += matchedCount;
  });

  return statsByProfile;
}
