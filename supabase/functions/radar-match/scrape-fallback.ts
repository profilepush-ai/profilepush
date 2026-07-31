export interface ScrapeFallbackRequest {
  source: string;
  table: string;
  endpoint: string;
  body: Record<string, unknown>;
}

function firstPreferredLocation(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const delimiter = raw.includes("|") ? "|" : raw.includes(";") ? ";" : raw.includes("\n") ? "\n" : null;
  if (!delimiter) return raw;
  return raw.split(delimiter).map((item) => item.trim()).find(Boolean) ?? "";
}

function buildLocationSeed(profile: Record<string, unknown>): string {
  const preferred = firstPreferredLocation(String(profile.preferred_locations ?? ""));
  if (preferred) return preferred;

  const location = String(profile.location ?? "").trim();
  if (location) return location;

  const city = String(profile.city ?? "").trim();
  const state = String(profile.state ?? "").trim();
  const country = String(profile.country ?? "").trim();
  const parts = [city, state, country].filter(Boolean);
  return parts.join(", ");
}

export function buildScrapeFallbackRequests(
  profile: Record<string, unknown>,
  accountId: string | null = null,
): ScrapeFallbackRequest[] {
  const targetRole = String(profile.target_role ?? "").trim();
  const location = buildLocationSeed(profile) || "US";
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
