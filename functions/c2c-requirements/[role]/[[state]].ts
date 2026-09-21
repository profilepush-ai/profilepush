// Server-rendered requirement pages: /c2c-requirements/{role}[/{state}]
//
// A Pages Function rather than a prerender step, for two reasons. The data
// changes every day — ~900 new requirements on a weekday — so a build-time
// snapshot would be stale before it was crawled. And AI answer engines
// (GPTBot, PerplexityBot, ClaudeBot) largely do not execute JavaScript, so a
// client-rendered route is invisible to them however well it is built.
//
// What is public and what is not:
//   * public: title, company, location, rate, skills, freshness, a 0-100
//     listing score, and whether a direct contact exists.
//   * never public: poster_email, poster_phone, or the post body. Those are
//     what an account is for, and publishing them hands the list to scrapers.
//
// Submitting requires an account; the page links to signup, it does not hide
// the content. Showing crawlers more than people would be cloaking and risks
// the domain, so Googlebot and a logged-out visitor see exactly the same five.

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
  "java-developer": "Java Developer",
  "dotnet-developer": ".NET Developer",
  salesforce: "Salesforce",
  servicenow: "ServiceNow",
  workday: "Workday",
  sap: "SAP",
  "qa-automation": "QA / Automation",
  "business-analyst": "Business Analyst",
  "project-manager": "Project Manager / Scrum Master",
  "data-engineer": "Data Engineer",
  "data-science": "Data Science / ML",
  devops: "DevOps",
  "cloud-engineer": "Cloud Engineer",
  "frontend-react": "Frontend / React",
  "full-stack": "Full Stack Developer",
  "python-developer": "Python Developer",
  "network-engineer": "Network Engineer",
  security: "Security",
  "oracle-dba": "Oracle / DBA",
  "mobile-developer": "Mobile Developer",
  "bi-reporting": "BI / Reporting",
  mainframe: "Mainframe",
  architect: "Architect",
};

const STATE_LABELS: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "Washington DC", REMOTE: "Remote",
};

const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function daysAgo(iso: string | null): string {
  if (!iso) return "recently";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function rateText(row: Requirement): string {
  if (row.rate_min && row.rate_max) return `$${row.rate_min}-$${row.rate_max}/hr`;
  if (row.rate_max) return `up to $${row.rate_max}/hr`;
  if (row.rate_min) return `from $${row.rate_min}/hr`;
  return "Rate on request";
}

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

const renderPage: PagesFunction<Env> = async ({ params, env }) => {
  const role = String(params.role ?? "").toLowerCase();
  const stateParam = Array.isArray(params.state) ? params.state[0] : params.state;
  const state = String(stateParam ?? "").toUpperCase();

  const roleLabel = ROLE_LABELS[role];
  if (!roleLabel) return new Response("Not found", { status: 404 });
  if (state && !STATE_LABELS[state]) return new Response("Not found", { status: 404 });

  const [rows, statsRows] = await Promise.all([
    rpc<Requirement[]>(env, "get_public_requirements", { p_role: role, p_state: state || null, p_limit: 5 }),
    rpc<Stats[]>(env, "get_public_requirement_stats", { p_role: role, p_state: state || null }),
  ]);

  const listings = rows ?? [];
  const stats = (statsRows ?? [])[0] ?? { total_30d: 0, added_7d: 0, with_rate: 0, with_contact: 0, median_rate_max: null };
  const placeLabel = state ? STATE_LABELS[state] : "the US";
  const canonical = `https://profilepush.ai/c2c-requirements/${role}${state ? `/${state.toLowerCase()}` : ""}`;

  // A page with nothing on it should not be in the index at all.
  if (listings.length === 0) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=600" } });
  }

  const total = stats.total_30d ?? 0;
  const title = `${roleLabel} C2C Requirements in ${placeLabel} - ${total} open this month | ProfilePush`;
  const description =
    `${total} ${roleLabel} corp-to-corp requirements posted in ${placeLabel} in the last 30 days, ` +
    `${stats.added_7d ?? 0} of them this week. ${stats.with_contact ?? 0} include a direct recruiter contact. Updated daily.`;

  // JobPosting markup is what makes these eligible for Google's jobs
  // experience, which is where consultant-side search volume actually lands.
  const jobSchema = listings.map((row) => ({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: row.job_title ?? roleLabel,
    description: `${roleLabel} contract requirement${row.location ? ` in ${row.location}` : ""}. ` +
      `${(row.skills ?? []).slice(0, 8).join(", ")}${row.employment_type ? `. ${row.employment_type}` : ""}.`,
    datePosted: row.posted_at,
    employmentType: "CONTRACTOR",
    hiringOrganization: { "@type": "Organization", name: row.company_name || "Confidential" },
    jobLocation: state === "REMOTE"
      ? undefined
      : { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: row.location ?? placeLabel, addressCountry: "US" } },
    jobLocationType: state === "REMOTE" ? "TELECOMMUTE" : undefined,
    ...(row.rate_max
      ? {
        baseSalary: {
          "@type": "MonetaryAmount",
          currency: "USD",
          value: { "@type": "QuantitativeValue", minValue: row.rate_min ?? undefined, maxValue: row.rate_max, unitText: "HOUR" },
        },
      }
      : {}),
  }));

  const otherStates = ["TX", "CA", "NY", "NJ", "NC", "GA", "IL", "OH", "REMOTE"].filter((s) => s !== state);

  const updatedLabel = new Date().toISOString().slice(0, 10);
  const rateSentence = stats.median_rate_max
    ? `The median advertised maximum rate is $${Math.round(Number(stats.median_rate_max))} per hour.`
    : "Rates vary and are not stated on every requirement.";

  // Phrased the way someone types into an assistant, not the way a marketer
  // writes a heading.
  const faqs = [
    {
      q: `Where can I find ${roleLabel} C2C requirements in ${placeLabel}?`,
      a: `ProfilePush collects ${roleLabel} corp-to-corp requirements from public postings across LinkedIn, WhatsApp, Telegram and job boards, de-duplicates them by recruiter, and refreshes them daily. ${total} were posted in ${placeLabel} in the last 30 days and ${stats.added_7d ?? 0} in the last 7. The five freshest and most complete are listed above; a free account shows all of them with the recruiter's contact.`,
    },
    {
      q: `What do ${roleLabel} C2C roles pay in ${placeLabel}?`,
      a: `${rateSentence} ${stats.with_rate ?? 0} of the ${total} requirements posted in the last 30 days stated a rate; the rest are negotiable or disclosed on contact.`,
    },
    {
      q: `How current are these ${roleLabel} requirements?`,
      a: `They are refreshed every day, and listings are scored partly on how recently they were posted, so a requirement from this week ranks above one from three weeks ago. This page was generated on ${updatedLabel}.`,
    },
    {
      q: `How do I submit a consultant to these requirements?`,
      a: `Create a free account, paste the consultant's details, and AI Match ranks the open requirements 1-10 against them with a reason for each score. Submitting is done from the match itself. New accounts get 100 free credits and no card is required.`,
    },
  ];

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  // Says out loud what the page is a sample of, which is what an assistant
  // needs in order to describe the source it is citing.
  const datasetSchema = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${roleLabel} C2C requirements in ${placeLabel}`,
    description: `Corp-to-corp contract requirements for ${roleLabel} roles in ${placeLabel}, collected from public staffing postings and refreshed daily. ${total} requirements in the trailing 30 days.`,
    url: canonical,
    isAccessibleForFree: true,
    dateModified: updatedLabel,
    creator: { "@type": "Organization", name: "ProfilePush", url: "https://profilepush.ai" },
    temporalCoverage: `${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}/${updatedLabel}`,
    variableMeasured: ["job title", "company", "location", "hourly rate", "skills", "employment type", "date posted"],
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">${JSON.stringify(jobSchema)}</script>
<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
<script type="application/ld+json">${JSON.stringify(datasetSchema)}</script>
<link rel="alternate" type="application/json" href="${esc(canonical.replace("/c2c-requirements/", "/api/requirements/"))}" />
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f2ee;color:#111827;line-height:1.5}
.wrap{max-width:860px;margin:0 auto;padding:24px 16px 64px}
a{color:#2563eb}
h1{font-size:28px;line-height:1.25;margin:0 0 8px}
.sub{color:#6b7280;font-size:15px;margin:0 0 16px}
.answer{background:#fff;border-left:4px solid #2563eb;border-radius:8px;padding:14px 16px;margin:0 0 24px;font-size:15px}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 24px}
.stat{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px 14px;min-width:120px}
.stat b{display:block;font-size:20px}
.stat span{font-size:12px;color:#6b7280}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin-bottom:12px}
.card h2{font-size:17px;margin:0 0 4px}
.meta{color:#6b7280;font-size:13px;margin:0 0 10px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
.chip{background:#f3f4f6;border-radius:999px;padding:3px 10px;font-size:12px;color:#374151}
.score{float:right;background:#ecfdf5;color:#047857;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700}
.cta{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:12px}
.gate{background:#fff;border:1px dashed #cbd5e1;border-radius:14px;padding:20px;text-align:center;margin:20px 0}
.links{margin-top:32px;font-size:14px}
.links a{display:inline-block;margin:0 10px 8px 0}
footer{margin-top:40px;color:#9ca3af;font-size:12px}
</style>
</head>
<body>
<div class="wrap">
<p style="font-size:13px;margin:0 0 16px"><a href="/">ProfilePush</a> / <a href="/c2c-requirements/${esc(role)}">${esc(roleLabel)}</a>${state ? ` / ${esc(STATE_LABELS[state])}` : ""}</p>

<h1>${esc(roleLabel)} C2C requirements in ${esc(placeLabel)}</h1>
<p class="sub">${esc(total)} posted in the last 30 days &middot; ${esc(stats.added_7d ?? 0)} added this week &middot; updated ${esc(updatedLabel)}</p>

<!-- Answer block. An assistant asked "where do I find Java C2C roles in
     Texas" quotes the first passage that answers it outright, so the page
     states the answer in one self-contained paragraph with the numbers in it,
     rather than making the model infer it from a list of cards. -->
<p class="answer"><strong>${esc(total)} ${esc(roleLabel)} corp-to-corp (C2C) requirements</strong> were posted in ${esc(placeLabel)} in the last 30 days on ProfilePush, ${esc(stats.added_7d ?? 0)} of them in the last 7 days.${stats.median_rate_max ? ` The median advertised maximum rate is <strong>$${esc(Math.round(Number(stats.median_rate_max)))}/hour</strong>.` : ""} ${esc(stats.with_contact ?? 0)} of the ${esc(total)} include a direct recruiter contact, which is available to signed-in members. Requirements are collected from public postings across LinkedIn, WhatsApp, Telegram and job boards, de-duplicated by recruiter and refreshed every day.</p>

<div class="stats">
  <div class="stat"><b>${esc(total)}</b><span>requirements, 30 days</span></div>
  <div class="stat"><b>${esc(stats.added_7d ?? 0)}</b><span>added this week</span></div>
  <div class="stat"><b>${esc(stats.with_contact ?? 0)}</b><span>with direct contact</span></div>
  ${stats.median_rate_max ? `<div class="stat"><b>$${esc(Math.round(Number(stats.median_rate_max)))}</b><span>median max rate</span></div>` : ""}
</div>

<h2 style="font-size:18px;margin:0 0 12px">Top 5 right now</h2>
${listings.map((row) => `
<div class="card">
  <span class="score">${esc(row.listing_score ?? 0)}/100</span>
  <h2>${esc(row.job_title || roleLabel)}</h2>
  <p class="meta">${esc(row.company_name || "Confidential")}${row.location ? ` &middot; ${esc(row.location)}` : ""} &middot; posted ${esc(daysAgo(row.posted_at))} &middot; ${esc(rateText(row))}${row.employment_type ? ` &middot; ${esc(row.employment_type)}` : ""}</p>
  <div class="chips">${(row.skills ?? []).slice(0, 8).map((skill) => `<span class="chip">${esc(skill)}</span>`).join("")}</div>
  <p style="margin:0;font-size:13px;color:#6b7280">${row.has_contact ? "Direct recruiter contact available" : "Contact via platform"} - <a href="/signup">sign in to submit a consultant</a></p>
</div>`).join("")}

<div class="gate">
  <p style="margin:0 0 6px;font-weight:700">${esc(Math.max(0, total - listings.length))} more ${esc(roleLabel)} requirements in ${esc(placeLabel)}</p>
  <p style="margin:0 0 14px;color:#6b7280;font-size:14px">Create a free account to see every requirement, get the recruiter's contact, and submit your consultants. 100 free credits, no card.</p>
  <a class="cta" href="/signup">See all ${esc(total)} requirements free</a>
</div>

<h2 style="font-size:18px;margin:28px 0 12px">Common questions</h2>
${faqs.map((item) => `
<div class="card">
  <h3 style="font-size:15px;margin:0 0 6px">${esc(item.q)}</h3>
  <p style="margin:0;font-size:14px;color:#374151">${item.a}</p>
</div>`).join("")}

<div class="links">
  <p style="font-weight:700;margin:0 0 6px">${esc(roleLabel)} requirements by state</p>
  ${otherStates.map((s) => `<a href="/c2c-requirements/${esc(role)}/${esc(s.toLowerCase())}">${esc(STATE_LABELS[s])}</a>`).join("")}
  <p style="font-weight:700;margin:16px 0 6px">Other roles${state ? ` in ${esc(STATE_LABELS[state])}` : ""}</p>
  ${Object.entries(ROLE_LABELS).filter(([key]) => key !== role).slice(0, 14)
    .map(([key, label]) => `<a href="/c2c-requirements/${esc(key)}${state ? `/${esc(state.toLowerCase())}` : ""}">${esc(label)}</a>`).join("")}
</div>

<footer>Requirements are collected from public postings across LinkedIn, WhatsApp, Telegram and job boards, de-duplicated and refreshed daily. Contact details are available to signed-in members. <a href="/">ProfilePush</a></footer>
</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Fresh enough to reflect today's postings, cached enough to survive a
      // crawl burst.
      "Cache-Control": "public, max-age=900, s-maxage=1800",
      "X-Robots-Tag": "index, follow",
    },
  });
};

export const onRequestGet = renderPage;

// Without this, HEAD falls through to the SPA fallback and returns the empty
// app shell: link previewers, uptime checks and some crawlers ask for HEAD
// first and would conclude the page is blank.
export const onRequestHead: PagesFunction<Env> = async (context) => {
  const response = await renderPage(context);
  return new Response(null, { status: response.status, headers: response.headers });
};
