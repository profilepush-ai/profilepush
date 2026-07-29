export interface ScrapeFallbackRequest {
  source: string;
  table: string;
  endpoint: string;
  body: Record<string, unknown>;
}

export function buildScrapeFallbackRequests(
  profile: Record<string, unknown>,
  accountId: string | null = null,
): ScrapeFallbackRequest[] {
  const targetRole = String(profile.target_role ?? "").trim();
  const preferredLocations = String(profile.preferred_locations ?? "").trim();
  const location = preferredLocations || "US";
  const keyword = targetRole || "software engineer";

  return [
    {
      source: "linkedin",
      table: "linkedin_jobs",
      endpoint: "linkedin-search",
      body: {
        job_title: keyword,
        location,
        posted_within: "Last week",
        experience_level: "",
        employment_type: "",
        work_arrangement: "",
        account_id: accountId,
        user_id: null,
        max_results: 25,
      },
    },
    {
      source: "dice",
      table: "dice_jobs",
      endpoint: "dice-search",
      body: {
        keyword,
        location,
        posted_date: "Last week",
        account_id: accountId,
        user_id: null,
        max_results: 25,
      },
    },
    {
      source: "indeed",
      table: "indeed_jobs",
      endpoint: "indeed-search",
      body: {
        keyword,
        location,
        date_posted: "Last week",
        job_type: "",
        remote: "",
        account_id: accountId,
        user_id: null,
        max_results: 25,
      },
    },
    {
      source: "monster",
      table: "monster_jobs",
      endpoint: "monster-search",
      body: {
        keyword,
        location,
        date_posted: "Last week",
        account_id: accountId,
        user_id: null,
        max_results: 25,
      },
    },
    {
      source: "careerbuilder",
      table: "careerbuilder_jobs",
      endpoint: "careerbuilder-search",
      body: {
        keyword,
        location,
        date_posted: "Last week",
        account_id: accountId,
        user_id: null,
        max_results: 25,
      },
    },
  ];
}
