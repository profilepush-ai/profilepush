import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];

interface ExtractedJob {
  job_id: string;
  source: string;
  title: string;
  extracted: {
    role_title: string;
    core_skills: string[];
    years_experience: number | null;
    visa_types: string[];
    work_type: string;
    locations: string[];
    hourly_rate_min: number | null;
    hourly_rate_max: number | null;
    relocation_required: boolean;
  };
}

interface MatchResult {
  job_id: string;
  job_source: string;
  score: number;
  breakdown: Record<string, { score: number; candidate_value: string; job_value: string; rule: string }>;
  notes: string;
  disqualified: boolean;
  reason: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { profile_id, account_id } = await req.json();
    if (!profile_id) throw new Error("profile_id is required");

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", profile_id)
      .maybeSingle();

    if (profileErr || !profile) throw new Error("Profile not found");

    // Filter out already-scored jobs early
    const { data: existingMatches } = await supabase
      .from("radar_match_results")
      .select("job_id")
      .eq("profile_id", profile_id);

    const existingJobIds = new Set((existingMatches ?? []).map((m: { job_id: string }) => m.job_id));

    // Load jobs — use vector similarity if profile has embedding, else fallback to recent jobs
    const allJobs: Array<{ id: string; source: string; title: string; description: string; location: string; extracted_skills: string; extracted_experience_years: number | null; extracted_visa_types: string; extracted_hourly_rate_min: number | null; extracted_hourly_rate_max: number | null }> = [];
    let usedVectorSearch = false;

    if (profile.profile_embedding) {
      // Use vector similarity to find 70%+ matching jobs across all tables
      const { data: vectorMatches, error: vecErr } = await supabase.rpc("match_jobs_by_embedding", {
        query_embedding: profile.profile_embedding,
        similarity_threshold: 0.70,
        max_results: 200,
      });

      if (!vecErr && vectorMatches && vectorMatches.length > 0) {
        usedVectorSearch = true;

        // Group matched job IDs by source for batch fetching
        const jobsBySource: Record<string, string[]> = {};
        for (const m of vectorMatches) {
          if (existingJobIds.has(m.job_id)) continue;
          if (!jobsBySource[m.job_source]) jobsBySource[m.job_source] = [];
          jobsBySource[m.job_source].push(m.job_id);
        }

        const sourceConfig: Record<string, { table: string; locationCol: string }> = {
          linkedin: { table: "linkedin_jobs", locationCol: "location" },
          dice: { table: "dice_jobs", locationCol: "location" },
          indeed: { table: "indeed_jobs", locationCol: "location_display" },
          monster: { table: "monster_jobs", locationCol: "location_display" },
          careerbuilder: { table: "careerbuilder_jobs", locationCol: "location_display" },
          social: { table: "social_jobs", locationCol: "location" },
        };

        for (const [source, ids] of Object.entries(jobsBySource)) {
          const config = sourceConfig[source];
          if (!config || ids.length === 0) continue;

          // Fetch in batches of 50 to stay under query limits
          for (let i = 0; i < ids.length; i += 50) {
            const batchIds = ids.slice(i, i + 50);
            const { data: jobs } = await supabase
              .from(config.table)
              .select(`id, job_title, job_description, ${config.locationCol}, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max`)
              .in("id", batchIds);

            if (jobs) {
              for (const j of jobs) {
                allJobs.push({
                  id: j.id,
                  source,
                  title: j.job_title ?? "",
                  description: (j.job_description ?? "").slice(0, 2000),
                  location: j[config.locationCol] ?? "",
                  extracted_skills: Array.isArray(j.extracted_skills) ? j.extracted_skills.join(", ") : (j.extracted_skills ?? ""),
                  extracted_experience_years: j.extracted_experience_years,
                  extracted_visa_types: Array.isArray(j.extracted_visa_types) ? j.extracted_visa_types.join(", ") : (j.extracted_visa_types ?? ""),
                  extracted_hourly_rate_min: j.extracted_hourly_rate_min,
                  extracted_hourly_rate_max: j.extracted_hourly_rate_max,
                });
              }
            }
          }
        }
      }
    }

    // Fallback: if no vector search results, use the old method (recent 50 from each board)
    if (!usedVectorSearch || allJobs.length === 0) {
      const sources = [
        { table: "linkedin_jobs", source: "linkedin", locationCol: "location" },
        { table: "dice_jobs", source: "dice", locationCol: "location" },
        { table: "indeed_jobs", source: "indeed", locationCol: "location_display" },
        { table: "monster_jobs", source: "monster", locationCol: "location_display" },
        { table: "careerbuilder_jobs", source: "careerbuilder", locationCol: "location_display" },
      ];

      for (const { table, source, locationCol } of sources) {
        const query = supabase
          .from(table)
          .select(`id, job_title, job_description, ${locationCol}, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max`)
          .order("created_at", { ascending: false })
          .limit(50);

        const { data: jobs } = await query;

        if (jobs) {
          for (const j of jobs) {
            allJobs.push({
              id: j.id,
              source,
              title: j.job_title ?? "",
              description: (j.job_description ?? "").slice(0, 2000),
              location: j[locationCol] ?? "",
              extracted_skills: Array.isArray(j.extracted_skills) ? j.extracted_skills.join(", ") : (j.extracted_skills ?? ""),
              extracted_experience_years: j.extracted_experience_years,
              extracted_visa_types: Array.isArray(j.extracted_visa_types) ? j.extracted_visa_types.join(", ") : (j.extracted_visa_types ?? ""),
              extracted_hourly_rate_min: j.extracted_hourly_rate_min,
              extracted_hourly_rate_max: j.extracted_hourly_rate_max,
            });
          }
        }
      }

      // Load social_jobs (fallback path)
      {
        const socialSelect = "id, job_title, job_description, location, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max";

        let socialJobs: Record<string, unknown>[] = [];

        if (account_id) {
          const { data: owned } = await supabase
            .from("social_jobs")
            .select(socialSelect)
            .eq("account_id", account_id)
            .order("created_at", { ascending: false })
            .limit(50);

          const { data: shared } = await supabase
            .from("social_jobs")
            .select(socialSelect)
            .is("account_id", null)
            .order("created_at", { ascending: false })
            .limit(50);

          const seenIds = new Set<string>();
          for (const j of [...(owned ?? []), ...(shared ?? [])]) {
            if (!seenIds.has(j.id as string)) {
              seenIds.add(j.id as string);
              socialJobs.push(j);
            }
          }
          socialJobs = socialJobs.slice(0, 50);
        } else {
          const { data } = await supabase
            .from("social_jobs")
            .select(socialSelect)
            .order("created_at", { ascending: false })
            .limit(50);
          socialJobs = data ?? [];
        }

        for (const j of socialJobs) {
          const skills = j.extracted_skills;
          allJobs.push({
            id: j.id as string,
            source: "social",
            title: (j.job_title as string) ?? "",
            description: ((j.job_description as string) ?? "").slice(0, 2000),
            location: (j.location as string) ?? "",
            extracted_skills: Array.isArray(skills) ? skills.join(", ") : ((skills as string) ?? ""),
            extracted_experience_years: j.extracted_experience_years as number | null,
            extracted_visa_types: Array.isArray(j.extracted_visa_types) ? (j.extracted_visa_types as string[]).join(", ") : ((j.extracted_visa_types as string) ?? ""),
            extracted_hourly_rate_min: j.extracted_hourly_rate_min as number | null,
            extracted_hourly_rate_max: j.extracted_hourly_rate_max as number | null,
          });
        }
      }
    }

    if (allJobs.length === 0) {
      return respond({ message: "No jobs found. Run a search first." });
    }

    // Remove already-scored jobs (for fallback path; vector path already filters)
    const newJobs = usedVectorSearch ? allJobs : allJobs.filter(j => !existingJobIds.has(j.id));

    if (newJobs.length === 0) {
      return respond({ message: "All jobs already scored", matched: 0, skipped: existingJobIds.size });
    }

    // Title relevance filter (skip for vector path since vector already filtered semantically)
    const targetRole = ((profile.target_role as string) ?? "").toLowerCase();
    const relevantJobs = usedVectorSearch
      ? newJobs
      : filterRelevantJobs(newJobs, targetRole, (profile.core_skills as string) ?? "");

    if (relevantJobs.length === 0) {
      return respond({ message: "No relevant jobs found matching the target role", matched: 0, skipped: existingJobIds.size + newJobs.length });
    }

    if (!GEMINI_API_KEY) {
      return respond({ error: "GEMINI_API_KEY not configured" }, 500);
    }

    // Stream results in batches of 5
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const batchSize = 5;
        let totalMatched = 0;

        for (let i = 0; i < relevantJobs.length; i += batchSize) {
          const batch = relevantJobs.slice(i, i + batchSize);

          const extractedJobs = await extractJobFields(batch, GEMINI_API_KEY);
          if (extractedJobs.length === 0) {
            controller.enqueue(encoder.encode(JSON.stringify({ type: "batch", matched: 0, total_so_far: totalMatched, progress: Math.min(i + batchSize, relevantJobs.length), total_jobs: relevantJobs.length }) + "\n"));
            continue;
          }

          const batchResults = scoreJobsAgainstProfile(extractedJobs, profile);

          // Save to DB immediately
          if (batchResults.length > 0) {
            const rows = batchResults.map(r => ({
              profile_id,
              job_source: r.job_source,
              job_id: r.job_id,
              final_average_score: r.score,
              score_breakdown: r.breakdown,
              ai_notes: r.notes,
              disqualified: r.disqualified,
              disqualify_reason: r.reason,
            }));

            await supabase.from("radar_match_results").insert(rows);
            totalMatched += batchResults.length;
          }

          controller.enqueue(encoder.encode(JSON.stringify({ type: "batch", matched: batchResults.length, total_so_far: totalMatched, progress: Math.min(i + batchSize, relevantJobs.length), total_jobs: relevantJobs.length }) + "\n"));
        }

        controller.enqueue(encoder.encode(JSON.stringify({ type: "done", matched: totalMatched, skipped: existingJobIds.size }) + "\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Title Relevance Filter ────────────────────────────────────────────────────
function filterRelevantJobs(
  jobs: Array<{ id: string; source: string; title: string; description: string; location: string; extracted_skills: string; extracted_experience_years: number | null; extracted_visa_types: string; extracted_hourly_rate_min: number | null; extracted_hourly_rate_max: number | null }>,
  targetRole: string,
  coreSkills: string,
): typeof jobs {
  if (!targetRole) return jobs;

  const roleWords = targetRole.split(/[\s/,\-]+/).filter(w => w.length > 2).map(w => w.toLowerCase());
  const skillWords = coreSkills.toLowerCase().split(/[,;|]+/).map(s => s.trim()).filter(s => s.length > 2);
  const primaryTech = roleWords.filter(w => !["senior", "junior", "lead", "staff", "principal", "mid", "level", "developer", "engineer", "architect", "manager"].includes(w));

  return jobs.filter(job => {
    const title = job.title.toLowerCase();
    const desc = (job.description + " " + job.extracted_skills).toLowerCase();

    if (primaryTech.length > 0) {
      const titleHasTech = primaryTech.some(t => title.includes(t));
      const descHasTech = primaryTech.filter(t => desc.includes(t)).length >= Math.ceil(primaryTech.length * 0.5);
      if (!titleHasTech && !descHasTech) {
        const skillMatches = skillWords.filter(s => desc.includes(s)).length;
        if (skillMatches < 2) return false;
      }
    }
    return true;
  });
}

// ── LLM Field Extraction ──────────────────────────────────────────────────────
async function extractJobFields(
  jobs: Array<{ id: string; source: string; title: string; description: string; location: string; extracted_skills: string; extracted_experience_years: number | null; extracted_visa_types: string; extracted_hourly_rate_min: number | null; extracted_hourly_rate_max: number | null }>,
  apiKey: string,
): Promise<ExtractedJob[]> {
  const jobTexts = jobs.map((j, idx) => `
[Job ${idx}] (id: ${j.id})
Title: ${j.title}
Location: ${j.location}
Pre-extracted skills: ${j.extracted_skills}
Pre-extracted experience: ${j.extracted_experience_years ?? "unknown"}
Pre-extracted visa: ${j.extracted_visa_types}
Pre-extracted rate: ${j.extracted_hourly_rate_min ?? "?"}–${j.extracted_hourly_rate_max ?? "?"}/hr
Description: ${j.description.slice(0, 1200)}
`).join("\n---\n");

  const prompt = `Extract structured fields from each job posting. For each job, extract:
- role_title: the actual role title
- core_skills: array of required technical skills (max 15)
- years_experience: minimum years required (number or null)
- visa_types: array of accepted visa/work authorization types (if mentioned), e.g. ["H1B", "GC", "USC", "EAD", "OPT"]
- work_type: "Remote" | "Hybrid" | "Onsite" | "Unknown"
- locations: array of work locations mentioned
- hourly_rate_min: minimum hourly rate in USD (number or null)
- hourly_rate_max: maximum hourly rate in USD (number or null)
- relocation_required: whether the candidate must relocate (boolean)

If a field is not mentioned in the job description, use the pre-extracted value if available. If still unknown, use null/empty.

JOBS:
${jobTexts}

Return ONLY a JSON array:
[
  {
    "job_id": "uuid",
    "role_title": "...",
    "core_skills": ["..."],
    "years_experience": null,
    "visa_types": ["..."],
    "work_type": "...",
    "locations": ["..."],
    "hourly_rate_min": null,
    "hourly_rate_max": null,
    "relocation_required": false
  }
]`;

  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
        }),
      });

      if (!res.ok) continue;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;

      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : (parsed.results ?? []);

      return arr.map((item: Record<string, unknown>, idx: number) => ({
        job_id: (item.job_id as string) ?? jobs[idx]?.id ?? "",
        source: jobs[idx]?.source ?? "unknown",
        title: jobs[idx]?.title ?? "",
        extracted: {
          role_title: (item.role_title as string) ?? jobs[idx]?.title ?? "",
          core_skills: Array.isArray(item.core_skills) ? item.core_skills : [],
          years_experience: typeof item.years_experience === "number" ? item.years_experience : (jobs[idx]?.extracted_experience_years ?? null),
          visa_types: Array.isArray(item.visa_types) ? item.visa_types : [],
          work_type: (item.work_type as string) ?? "Unknown",
          locations: Array.isArray(item.locations) ? item.locations : [jobs[idx]?.location ?? ""],
          hourly_rate_min: typeof item.hourly_rate_min === "number" ? item.hourly_rate_min : (jobs[idx]?.extracted_hourly_rate_min ?? null),
          hourly_rate_max: typeof item.hourly_rate_max === "number" ? item.hourly_rate_max : (jobs[idx]?.extracted_hourly_rate_max ?? null),
          relocation_required: item.relocation_required === true,
        },
      }));
    } catch {
      continue;
    }
  }

  // Fallback: use pre-extracted data directly
  return jobs.map(j => ({
    job_id: j.id,
    source: j.source,
    title: j.title,
    extracted: {
      role_title: j.title,
      core_skills: j.extracted_skills ? j.extracted_skills.split(",").map(s => s.trim()) : [],
      years_experience: j.extracted_experience_years,
      visa_types: j.extracted_visa_types ? j.extracted_visa_types.split(",").map(s => s.trim()) : [],
      work_type: "Unknown",
      locations: j.location ? [j.location] : [],
      hourly_rate_min: j.extracted_hourly_rate_min,
      hourly_rate_max: j.extracted_hourly_rate_max,
      relocation_required: false,
    },
  }));
}

// ── Deterministic Scoring ─────────────────────────────────────────────────────
function scoreJobsAgainstProfile(extractedJobs: ExtractedJob[], profile: Record<string, unknown>): MatchResult[] {
  const candidateSkills = ((profile.core_skills as string) ?? "").toLowerCase().split(/[,;|]+/).map(s => s.trim()).filter(Boolean);
  const candidateRole = ((profile.target_role as string) ?? "").toLowerCase();
  const candidateExp = (profile.years_experience as number) ?? 0;
  const candidateVisa = ((profile.visa_status as string) ?? "").toLowerCase();
  const candidateWorkType = ((profile.work_type as string) ?? "").toLowerCase();
  const candidateLocations = ((profile.preferred_locations as string) ?? "").toLowerCase();
  const candidateRateMin = (profile.desired_salary_min as number) ?? 0;
  const candidateRateMax = (profile.desired_salary_max as number) ?? 0;
  const candidateRelocation = profile.relocation_open === true;

  const results: MatchResult[] = [];

  for (const job of extractedJobs) {
    const e = job.extracted;
    const breakdown: Record<string, { score: number; candidate_value: string; job_value: string; rule: string }> = {};
    let disqualified = false;
    let disqualifyReason: string | null = null;

    // 1. Role Match (20%)
    const roleScore = scoreRole(candidateRole, e.role_title);
    breakdown.role_match = {
      score: roleScore,
      candidate_value: (profile.target_role as string) ?? "",
      job_value: e.role_title,
      rule: "Compares candidate target role against job title for tech stack and seniority alignment",
    };

    // 2. Skills Match (25%)
    const jobSkillsLower = e.core_skills.map(s => s.toLowerCase());
    const matchedSkills = candidateSkills.filter(cs => jobSkillsLower.some(js => js.includes(cs) || cs.includes(js)));
    const skillScore = candidateSkills.length > 0
      ? Math.round((matchedSkills.length / Math.min(candidateSkills.length, jobSkillsLower.length || 1)) * 100)
      : 50;
    breakdown.skills_match = {
      score: Math.min(skillScore, 100),
      candidate_value: candidateSkills.slice(0, 10).join(", "),
      job_value: e.core_skills.slice(0, 10).join(", "),
      rule: "Percentage of candidate skills that match job required skills",
    };

    // 3. Experience Match (15%)
    let expScore = 70;
    if (e.years_experience != null) {
      if (candidateExp >= e.years_experience) {
        expScore = 100;
      } else if (candidateExp >= e.years_experience - 2) {
        expScore = 70;
      } else {
        expScore = 30;
      }
    }
    breakdown.experience_match = {
      score: expScore,
      candidate_value: `${candidateExp} years`,
      job_value: e.years_experience != null ? `${e.years_experience}+ years required` : "Not specified",
      rule: "Full score if candidate meets/exceeds requirement. Partial if within 2 years. Low if significantly under.",
    };

    // 4. Visa Match (15%)
    let visaScore = 70;
    if (e.visa_types.length > 0 && candidateVisa) {
      const visaLower = e.visa_types.map(v => v.toLowerCase());
      const candidateVisaWords = candidateVisa.split(/[\s,/]+/).map(v => v.trim());
      const visaMatch = candidateVisaWords.some(cv => visaLower.some(jv => jv.includes(cv) || cv.includes(jv)));
      if (visaMatch) {
        visaScore = 100;
      } else {
        visaScore = 0;
        disqualified = true;
        disqualifyReason = `Visa mismatch: candidate has "${profile.visa_status}" but job requires ${e.visa_types.join("/")}`;
      }
    }
    breakdown.visa_match = {
      score: visaScore,
      candidate_value: (profile.visa_status as string) ?? "Not specified",
      job_value: e.visa_types.length > 0 ? e.visa_types.join(", ") : "Not specified",
      rule: "Disqualified if job specifies visa requirements and candidate visa is incompatible",
    };

    // 5. Work Type Match (10%)
    let workTypeScore = 80;
    if (candidateWorkType && e.work_type.toLowerCase() !== "unknown") {
      const jobWT = e.work_type.toLowerCase();
      if (candidateWorkType.includes(jobWT) || jobWT.includes(candidateWorkType) || jobWT === "remote") {
        workTypeScore = 100;
      } else if (jobWT === "hybrid" && (candidateWorkType.includes("remote") || candidateWorkType.includes("hybrid"))) {
        workTypeScore = 80;
      } else if (jobWT === "onsite" && candidateWorkType.includes("remote")) {
        workTypeScore = candidateRelocation ? 50 : 20;
      } else {
        workTypeScore = 50;
      }
    }
    breakdown.work_type_match = {
      score: workTypeScore,
      candidate_value: (profile.work_type as string) ?? "Not specified",
      job_value: e.work_type,
      rule: "Full score if work type matches preference. Lower if mismatch.",
    };

    // 6. Location Match (10%)
    let locationScore = 70;
    if (candidateLocations && e.locations.length > 0) {
      const jobLocLower = e.locations.map(l => l.toLowerCase()).join(" ");
      const candidateLocWords = candidateLocations.split(/[,;|]+/).map(l => l.trim()).filter(Boolean);
      const locMatch = candidateLocWords.some(cl => jobLocLower.includes(cl));
      if (locMatch) {
        locationScore = 100;
      } else if (e.work_type.toLowerCase() === "remote") {
        locationScore = 90;
      } else if (candidateRelocation) {
        locationScore = 60;
      } else {
        locationScore = 30;
      }
    }
    breakdown.location_match = {
      score: locationScore,
      candidate_value: (profile.preferred_locations as string) ?? "Not specified",
      job_value: e.locations.join(", ") || "Not specified",
      rule: "Full score if location overlaps. Remote jobs score high. Otherwise depends on relocation willingness.",
    };

    // 7. Rate Match (5%)
    let rateScore = 70;
    if (e.hourly_rate_max != null && candidateRateMin > 0) {
      if (candidateRateMin <= e.hourly_rate_max) {
        rateScore = 100;
      } else if (candidateRateMin <= e.hourly_rate_max * 1.15) {
        rateScore = 60;
      } else {
        rateScore = 20;
      }
    } else if (e.hourly_rate_min != null && candidateRateMax > 0) {
      if (candidateRateMax >= e.hourly_rate_min) {
        rateScore = 100;
      } else {
        rateScore = 30;
      }
    }
    breakdown.rate_match = {
      score: rateScore,
      candidate_value: candidateRateMin || candidateRateMax ? `$${candidateRateMin}-$${candidateRateMax}/hr` : "Not specified",
      job_value: e.hourly_rate_min != null || e.hourly_rate_max != null ? `$${e.hourly_rate_min ?? "?"}–$${e.hourly_rate_max ?? "?"}/hr` : "Not specified",
      rule: "Full score if candidate rate falls within job budget. Lower if rate exceeds budget.",
    };

    // Calculate weighted final score
    const weights = { role_match: 20, skills_match: 25, experience_match: 15, visa_match: 15, work_type_match: 10, location_match: 10, rate_match: 5 };
    let totalWeight = 0;
    let weightedSum = 0;
    for (const [key, weight] of Object.entries(weights)) {
      if (breakdown[key]) {
        weightedSum += breakdown[key].score * weight;
        totalWeight += weight;
      }
    }
    const finalScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

    const topMatches = Object.entries(breakdown).filter(([, v]) => v.score >= 80).map(([k]) => k.replace("_match", ""));
    const weakPoints = Object.entries(breakdown).filter(([, v]) => v.score < 50).map(([k]) => k.replace("_match", ""));
    let notes = "";
    if (topMatches.length > 0) notes += `Strong on: ${topMatches.join(", ")}. `;
    if (weakPoints.length > 0) notes += `Weak on: ${weakPoints.join(", ")}. `;
    if (disqualified) notes += `DISQUALIFIED: ${disqualifyReason}`;

    results.push({
      job_id: job.job_id,
      job_source: job.source,
      score: disqualified ? Math.min(finalScore, 25) : finalScore,
      breakdown,
      notes: notes.trim(),
      disqualified,
      reason: disqualifyReason,
    });
  }

  return results;
}

function scoreRole(candidateRole: string, jobRole: string): number {
  const jobLower = jobRole.toLowerCase();
  if (!candidateRole) return 50;

  const stopWords = new Set(["senior", "junior", "lead", "staff", "principal", "mid", "level", "i", "ii", "iii", "iv", "the", "and", "or", "a"]);
  const candidateWords = candidateRole.split(/[\s/,\-]+/).filter(w => w.length > 1 && !stopWords.has(w));
  const jobWords = jobLower.split(/[\s/,\-]+/).filter(w => w.length > 1 && !stopWords.has(w));

  if (candidateWords.length === 0) return 50;

  const matches = candidateWords.filter(cw => jobWords.some(jw => jw.includes(cw) || cw.includes(jw)));
  const matchRatio = matches.length / candidateWords.length;

  if (matchRatio >= 0.8) return 100;
  if (matchRatio >= 0.5) return 75;
  if (matchRatio >= 0.3) return 50;
  return 20;
}

function respond(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
