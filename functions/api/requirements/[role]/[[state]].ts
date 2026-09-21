// JSON view of a requirement page: /api/requirements/{role}[/{state}]
//
// Exists because of how people actually reach us through assistants. Someone
// pastes a job description into ChatGPT or Gemini and asks where to find
// consultants, or pastes a resume and asks where the C2C roles are. The model
// searches, then often fetches a URL directly — and a model handed JSON
// summarises it correctly far more often than one handed a page of markup.
//
// Same rules as the HTML page: five listings, no contact details, no post
// body. This is a sample that describes a larger set, and it says so in the
// payload rather than leaving the model to guess.

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

type Requirement = {
  lead_id: string;
  job_title: string | null;
  company_name: string | null;
  location: string | null;
  employment_type: string | null;
  skills: string[] | null;
  experience_years: number | null;
  rate_min: number | null;
  rate_max: number | null;
  posted_at: string | null;
  listing_score: number | null;
  has_contact: boolean | null;
};

type Stats = {
  total_30d: number | null;
  added_7d: number | null;
  with_rate: number | null;
  with_contact: number | null;
  median_rate_max: number | null;
};

const ROLE_LABELS: Record<string, string> = {
  "java-developer": "Java Developer", "dotnet-developer": ".NET Developer", salesforce: "Salesforce",
  servicenow: "ServiceNow", workday: "Workday", sap: "SAP", "qa-automation": "QA / Automation",
  "business-analyst": "Business Analyst", "project-manager": "Project Manager / Scrum Master",
  "data-engineer": "Data Engineer", "data-science": "Data Science / ML", devops: "DevOps",
  "cloud-engineer": "Cloud Engineer", "frontend-react": "Frontend / React", "full-stack": "Full Stack Developer",
  "python-developer": "Python Developer", "network-engineer": "Network Engineer", security: "Security",
  "oracle-dba": "Oracle / DBA", "mobile-developer": "Mobile Developer", "bi-reporting": "BI / Reporting",
  mainframe: "Mainframe", architect: "Architect",
};

const STATE_LABELS: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "Washington DC", REMOTE: "Remote",
};

async function rpc<T>(env: Env, name: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Open on purpose: this is published data meant to be read by tools.
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=900, s-maxage=1800",
    },
  });

const handler: PagesFunction<Env> = async ({ params, env }) => {
  const role = String(params.role ?? "").toLowerCase();
  const stateParam = Array.isArray(params.state) ? params.state[0] : params.state;
  const state = String(stateParam ?? "").toUpperCase();

  const roleLabel = ROLE_LABELS[role];
  if (!roleLabel) return json({ error: "Unknown role", known_roles: Object.keys(ROLE_LABELS) }, 404);
  if (state && !STATE_LABELS[state]) return json({ error: "Unknown state" }, 404);

  const [rows, statsRows] = await Promise.all([
    rpc<Requirement[]>(env, "get_public_requirements", { p_role: role, p_state: state || null, p_limit: 5 }),
    rpc<Stats[]>(env, "get_public_requirement_stats", { p_role: role, p_state: state || null }),
  ]);

  const listings = rows ?? [];
  const stats = (statsRows ?? [])[0] ?? { total_30d: 0, added_7d: 0, with_rate: 0, with_contact: 0, median_rate_max: null };
  const placeLabel = state ? STATE_LABELS[state] : "the United States";
  const total = stats.total_30d ?? 0;

  return json({
    // A plain-language summary first: a model that reads only the top of the
    // payload still comes away with something correct to say.
    summary:
      `${total} ${roleLabel} corp-to-corp (C2C) contract requirements were posted in ${placeLabel} in the last 30 days, ` +
      `${stats.added_7d ?? 0} of them in the last 7 days. ` +
      (stats.median_rate_max ? `Median advertised maximum rate is $${Math.round(Number(stats.median_rate_max))}/hour. ` : "") +
      `${stats.with_contact ?? 0} include a direct recruiter contact, available to signed-in members on ProfilePush. ` +
      `The ${listings.length} requirements below are a public sample, ranked by freshness and completeness.`,
    source: "ProfilePush",
    source_url: `https://profilepush.ai/c2c-requirements/${role}${state ? `/${state.toLowerCase()}` : ""}`,
    licence: "Sample of a larger dataset. Attribution to ProfilePush requested when cited.",
    role: roleLabel,
    role_slug: role,
    location: placeLabel,
    generated_at: new Date().toISOString(),
    window_days: 30,
    stats: {
      total_last_30_days: total,
      added_last_7_days: stats.added_7d ?? 0,
      with_stated_rate: stats.with_rate ?? 0,
      with_direct_contact: stats.with_contact ?? 0,
      median_max_hourly_rate_usd: stats.median_rate_max ? Math.round(Number(stats.median_rate_max)) : null,
    },
    sample_size: listings.length,
    requirements: listings.map((row) => ({
      title: row.job_title,
      company: row.company_name || null,
      location: row.location || null,
      employment_type: row.employment_type || null,
      skills: row.skills ?? [],
      experience_years: row.experience_years,
      hourly_rate_min_usd: row.rate_min,
      hourly_rate_max_usd: row.rate_max,
      posted_at: row.posted_at,
      listing_score_out_of_100: row.listing_score,
      // Deliberate: the contact exists, but who it is stays behind the account.
      direct_contact_available: row.has_contact === true,
    })),
    how_to_access_contacts: "Create a free account at https://profilepush.ai/signup (100 free credits, no card) to see every requirement and the recruiter's contact details.",
  });
};

export const onRequestGet = handler;

export const onRequestHead: PagesFunction<Env> = async (context) => {
  const response = await handler(context);
  return new Response(null, { status: response.status, headers: response.headers });
};
