import { Actor } from "apify";
import { GoogleGenAI } from "@google/genai";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SUPPORTED_BOARDS = ["linkedin", "dice", "indeed", "monster", "careerbuilder"];
const BOARD_FUNCTION_MAP = {
  linkedin: "linkedin-search",
  dice: "dice-search",
  indeed: "indeed-search",
  monster: "monster-search",
  careerbuilder: "careerbuilder-search",
};

const STATE_ABBREV = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

const ROLE_BLACKLIST = new Set([
  "consultant",
  "it consultant",
  "software professional",
  "engineer",
  "developer",
  "open",
  "open role",
  "any",
  "na",
]);

const LOCATION_BLACKLIST_REGEX =
  /(remote|relocation|anywhere|open|usa|united states|us|north america|canada|hybrid|onsite|on-site)/i;

await Actor.main(async () => {
  const input = await Actor.getInput();
  if (!input) throw new Error("Missing actor input");

  const {
    supabase_url,
    supabase_service_role_key,
    gemini_api_key = null,
    gemini_models = ["gemini-2.5-flash"],
    llm_mode = "always",
    boards = SUPPORTED_BOARDS,
    max_results = 25,
    posted_within = "Past 24 hours",
    linkedin_experience_level = "Mid-Senior",
    linkedin_employment_type = "",
    linkedin_work_arrangement = "",
    max_roles = 18,
    max_locations = 24,
    max_combinations = 90,
    max_locations_per_role = 4,
    llm_candidate_cap = 60,
    max_concurrent = 10,
    dry_run = false,
  } = input;

  if (!supabase_url || !supabase_service_role_key) {
    throw new Error("supabase_url and supabase_service_role_key are required inputs");
  }

  const selectedBoards = boards.filter((b) => SUPPORTED_BOARDS.includes(b));
  if (selectedBoards.length === 0) {
    throw new Error(`No valid boards selected. Allowed: ${SUPPORTED_BOARDS.join(", ")}`);
  }

  const supportedGeminiModels = ["gemini-2.5-flash"];
  const selectedGeminiModels = Array.isArray(gemini_models)
    ? gemini_models.filter((model) => supportedGeminiModels.includes(model))
    : [];
  if (gemini_api_key && selectedGeminiModels.length === 0) {
    selectedGeminiModels.push("gemini-2.5-flash");
  }

  console.log(`🚀 Starting hotlist job scraper — boards: ${selectedBoards.join(", ")}`);
  console.log(
    `🎯 Budget controls: max_roles=${max_roles}, max_locations=${max_locations}, max_combinations=${max_combinations}`
  );

  console.log("📋 Fetching hotlist_active_profiles from Supabase...");
  const profilesRes = await fetch(
    `${supabase_url}/rest/v1/hotlist_active_profiles?select=profile_id,account_id,candidate_name,target_role,location,city,state`,
    {
      headers: {
        Authorization: `Bearer ${supabase_service_role_key}`,
        apikey: supabase_service_role_key,
        "Content-Type": "application/json",
      },
    }
  );

  if (!profilesRes.ok) {
    throw new Error(`Failed to fetch hotlist profiles: ${profilesRes.status} ${await profilesRes.text()}`);
  }

  const profiles = await profilesRes.json();
  if (!profiles || profiles.length === 0) {
    console.log("⚠️ No active hotlist profiles found. Exiting.");
    await Actor.setValue("OUTPUT", { message: "No active hotlist profiles", searches_triggered: 0 });
    return;
  }
  console.log(`✅ Found ${profiles.length} active hotlist profiles`);

  console.log(`📊 Raw profiles prepared for Gemini: ${profiles.length} fetched profiles sent in full`);

  if (!gemini_api_key || llm_mode === "off") {
    throw new Error("Gemini API key is required and llm_mode must not be off. This actor runs in Gemini-only mode.");
  }

  console.log("🤖 Sending full Supabase profile list to Gemini for combination deduplication...");

  const pairSelection = await selectWithGeminiCombos({
    apiKey: gemini_api_key,
    models: selectedGeminiModels,
    profiles,
    targetCount: max_combinations,
    candidateCap: llm_candidate_cap,
  });

  if (!pairSelection?.selected?.length) {
    throw new Error("Gemini returned no valid role+location combinations. Aborting without deterministic fallback.");
  }

  const combinations = pairSelection.selected
    .map(parseCombinationValue)
    .filter(Boolean)
    .slice(0, max_combinations)
    .map(({ role, location }, index) => ({
      role,
      location,
      score: 1,
      observed_count: 1,
      rank: index + 1,
    }));

  if (combinations.length === 0) {
    throw new Error("Gemini response did not include valid role+location entries.");
  }

  const selectedRoles = [...new Set(combinations.map((c) => c.role))];
  const selectedLocations = [...new Set(combinations.map((c) => c.location))];
  const llmUsed = true;
  const llmModelUsed = pairSelection.model;

  console.log(`🔀 Selected ${combinations.length} high-signal combinations from observed hotlist behavior.`);

  if (dry_run) {
    combinations.forEach((c, i) => {
      console.log(`  ${i + 1}. [${c.role}] @ [${c.location}] (score=${c.score})`);
    });

    await Actor.setValue("OUTPUT", {
      dry_run: true,
      llm_used: llmUsed,
      llm_model_used: llmModelUsed,
      profiles_fetched: profiles.length,
      profiles_with_search_signals: profiles.length,
      selected_roles: selectedRoles,
      selected_locations: selectedLocations,
      total_combinations: combinations.length,
      combinations,
      total_searches_would_trigger: combinations.length * selectedBoards.length,
      budget: {
        max_roles,
        max_locations,
        max_combinations,
        max_locations_per_role,
      },
    });
    return;
  }

  const consumerPayload = {
    supabase_url,
    supabase_service_role_key,
    gemini_payload: {
      selected: combinations.map(({ role, location }) => ({ role, location })),
    },
    boards: selectedBoards,
    max_results,
    posted_within,
    linkedin_experience_level,
    linkedin_employment_type,
    linkedin_work_arrangement,
    max_combinations,
    max_concurrent,
    dry_run,
  };

  console.log("🚚 Forwarding Gemini response directly to consumer actor for scraping...");
  const consumerRun = await Actor.call("wavy_lilt/gemini-batch-webhook-consumer", consumerPayload, {
    waitSecs: 600,
  });

  const summary = {
    llm_used: llmUsed,
    llm_model_used: llmModelUsed,
    profiles_fetched: profiles.length,
    selected_roles: selectedRoles,
    selected_locations: selectedLocations,
    total_combinations: combinations.length,
    forwarded_to: "wavy_lilt/gemini-batch-webhook-consumer",
    consumer_run_id: consumerRun?.id ?? null,
    consumer_status: consumerRun?.status ?? null,
    consumer_input: consumerPayload,
    budget: {
      max_roles,
      max_locations,
      max_combinations,
      max_locations_per_role,
      boards: selectedBoards,
    },
  };

  console.log(`\n✅ Done! forwarded to consumer run ${summary.consumer_run_id ?? "unknown"}`);

  await Actor.setValue("OUTPUT", summary);
});

function normalizeRole(input) {
  if (!input || typeof input !== "string") return null;
  let s = input
    .replace(/\([^)]*\)/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return null;

  s = s
    .replace(/\b(sr\.?|sen\.?|snr\.?)\b/gi, "Senior")
    .replace(/\b(jr\.?|jnr\.?)\b/gi, "Junior")
    .replace(/\bdev\b/gi, "Developer")
    .replace(/\beng\b/gi, "Engineer")
    .replace(/\bqa\b/gi, "QA")
    .replace(/\bsde\b/gi, "Software Development Engineer")
    .replace(/\s+/g, " ")
    .trim();

  if (s.length < 3 || s.length > 80) return null;
  const lower = s.toLowerCase();
  if (ROLE_BLACKLIST.has(lower)) return null;

  return toTitleCase(s);
}

function normalizeLocation(input) {
  if (!input || typeof input !== "string") return null;

  let s = input
    .replace(/[|/;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return null;
  if (LOCATION_BLACKLIST_REGEX.test(s)) return null;

  s = s
    .replace(/\bnew york city\b/gi, "New York")
    .replace(/\bseattle wa\b/gi, "Seattle, WA")
    .replace(/\bst\.\b/gi, "St")
    .replace(/\s+/g, " ")
    .trim();

  const cityState = s.match(/^([A-Za-z .'-]+),?\s+([A-Za-z .'-]{2,})$/);
  if (cityState) {
    const city = toTitleCase(cityState[1].trim());
    const state = normalizeState(cityState[2].trim());
    if (state) return `${city}, ${state}`;
  }

  const justState = normalizeState(s);
  if (justState && justState.length === 2) {
    return justState;
  }

  if (/^[A-Za-z .'-]{2,40}$/.test(s)) {
    if (STATE_ABBREV[s.toLowerCase()]) {
      return STATE_ABBREV[s.toLowerCase()];
    }
    return toTitleCase(s);
  }

  return null;
}

function normalizeState(value) {
  const cleaned = value.replace(/\./g, "").trim();
  if (!cleaned) return null;
  if (/^[A-Za-z]{2}$/.test(cleaned)) return cleaned.toUpperCase();
  return STATE_ABBREV[cleaned.toLowerCase()] || null;
}

function toTitleCase(s) {
  return s
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length <= 3 && /^(qa|ui|ux|aws|gcp|ml|ai|etl|api|sql)$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/\bUsa\b/g, "USA");
}

function toSortedCounts(map) {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

async function selectWithGeminiCombos({ apiKey, models, profiles, targetCount, candidateCap }) {
  const candidates = profiles.slice(0, Math.max(targetCount, candidateCap));
  if (candidates.length === 0) return null;
  const allowedLocations = buildAllowedLocationsFromProfiles(candidates);

  const prompt = buildCombinationSelectionPrompt(candidates, targetCount);

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1200,
            },
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`⚠️ Gemini model ${model} error ${res.status}: ${errText.slice(0, 180)}`);
        continue;
      }

      const data = await res.json();
      const raw = (data?.candidates?.[0]?.content?.parts || [])
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\n")
        .trim();
      const sourceArr = parseGeminiTextCombinationLines(raw);
      const selected = [];
      const selectedKeys = new Set();

      for (const item of sourceArr) {
        const parsed = normalizeGeminiCombination(item, allowedLocations);
        if (!parsed) continue;
        const canonicalKey = `${parsed.role}|||${parsed.location}`;
        if (selectedKeys.has(canonicalKey)) continue;

        selected.push({ role: parsed.role, location: parsed.location });
        selectedKeys.add(canonicalKey);
        if (selected.length >= targetCount) break;
      }

      if (selected.length > 0) {
        console.log(`✅ Gemini model ${model} selected ${selected.length} combinations`);
        return { selected, model };
      }

      console.warn(
        `⚠️ Gemini model ${model} returned empty/invalid combination selection. Raw output: ${raw.slice(0, 400)}`
      );
    } catch (err) {
      console.warn(`⚠️ Gemini model ${model} failed for combinations: ${err?.message || "Unknown error"}`);
    }
  }

  return null;
}

function buildAllowedLocationsFromProfiles(profiles) {
  const allowed = new Set();

  for (const profile of profiles) {
    const candidates = extractLocationCandidates(profile);
    for (const candidate of candidates) {
      const normalized = normalizeLocation(candidate);
      if (normalized) allowed.add(normalized);
    }
  }

  return allowed;
}

function isLocationFromProfileSet(location, allowedLocations) {
  if (!location || !allowedLocations || allowedLocations.size === 0) return false;
  if (allowedLocations.has(location)) return true;

  // Allow city-only output if it maps cleanly to an observed city,state value.
  if (!location.includes(",")) {
    for (const allowed of allowedLocations) {
      if (allowed === location || allowed.startsWith(`${location},`)) return true;
    }
  }

  return false;
}

function parseGeminiTextCombinationLines(text) {
  const cleaned = String(text || "")
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .trim();

  if (!cleaned) return [];

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const out = [];

  for (const line of lines) {
    const stripped = line.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, "").trim();
    if (!stripped) continue;

    let role = "";
    let location = "";

    if (stripped.includes(",")) {
      const splitAt = stripped.indexOf(",");
      role = stripped.slice(0, splitAt).trim();
      location = stripped.slice(splitAt + 1).trim();
    } else if (stripped.includes(" - ")) {
      const splitAt = stripped.indexOf(" - ");
      role = stripped.slice(0, splitAt).trim();
      location = stripped.slice(splitAt + 3).trim();
    } else if (stripped.includes(" | ")) {
      const splitAt = stripped.indexOf(" | ");
      role = stripped.slice(0, splitAt).trim();
      location = stripped.slice(splitAt + 3).trim();
    }

    if (!role || !location) continue;
    out.push({ role, location });
  }

  return out;
}

function extractGeminiCombinationArrayFromText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];

  const candidates = [];
  const objectMatches = trimmed.match(/\{[^{}]*\}/g) || [];
  for (const snippet of objectMatches) {
    try {
      const parsed = JSON.parse(snippet);
      candidates.push(parsed);
    } catch {
      const roleMatch = snippet.match(/"?(?:role|target_role|job_title|title|position|role_name)"?\s*:\s*"([^"]+)"/i);
      const locationMatch = snippet.match(/"?(?:location|location_name|job_location|city)"?\s*:\s*"([^"]+)"/i);
      if (roleMatch && locationMatch) {
        candidates.push({ role: roleMatch[1], location: locationMatch[1] });
      }
    }
  }

  return candidates;
}

function tryParseJson(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch) {
      try {
        return JSON.parse(fencedMatch[1].trim());
      } catch {
        // Keep trying below.
      }
    }

    const bracketMatch = trimmed.match(/\[[\s\S]*\]/);
    if (bracketMatch) {
      try {
        return JSON.parse(bracketMatch[0]);
      } catch {
        // Keep trying below.
      }
    }

    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function extractGeminiCombinationArray(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];

  const candidates = [
    json.selected,
    json.combinations,
    json.items,
    json.results,
    json.output,
    json.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") return [candidate];
  }

  return [];
}

function buildCombinationSelectionPrompt(items, targetCount) {
  const list = items.map((x, i) => `${i + 1}. ${JSON.stringify(x)}`).join("\n");

  return [
    "Give me only unique role + location combinations out of this whole list of profiles we have.",
    `Task: choose up to ${targetCount} unique role + location combinations from the list below.`,
    "Rules:",
    "- Remove duplicates and near-duplicates.",
    "- Keep only the most specific combination for each group.",
    "- If a combination is broad, generic, repetitive, or less specific than another version, drop it.",
    "- Standardize the role and location text in your output.",
    "- Use short state abbreviations where appropriate, e.g. Andhra Pradesh -> AP, Texas -> TX, New York -> NY.",
    "- Example: Visakhapatnam, India and Visakhapatnam, ANDHRA PRADESH should be normalized to Visakhapatnam, AP.",
    "- Do not invent new combinations.",
    "- You MUST choose only from the provided profile rows as the source material.",
    "- Return plain text only (no JSON, no markdown).",
    "- Output one combination per line in this format: Role Name, Standardized Location",
    `- Return up to ${targetCount} lines.`,
    "Profiles:",
    list,
  ].join("\n");
}

function parseCombinationValue(value) {
  if (!value) return null;

  if (Array.isArray(value)) {
    const role = typeof value[0] === "string" ? value[0].trim() : "";
    const location = typeof value[1] === "string" ? value[1].trim() : "";
    if (!role || !location) return null;
    return { role, location };
  }

  if (typeof value === "object") {
    const role =
      typeof value.role === "string"
        ? value.role.trim()
        : typeof value.target_role === "string"
        ? value.target_role.trim()
        : typeof value.job_title === "string"
        ? value.job_title.trim()
        : typeof value.title === "string"
        ? value.title.trim()
        : typeof value.position === "string"
        ? value.position.trim()
        : typeof value.role_name === "string"
        ? value.role_name.trim()
        : "";

    const location =
      typeof value.location === "string"
        ? value.location.trim()
        : typeof value.location_name === "string"
        ? value.location_name.trim()
        : typeof value.job_location === "string"
        ? value.job_location.trim()
        : typeof value.city === "string" && typeof value.state === "string"
        ? `${value.city.trim()}, ${value.state.trim()}`
        : typeof value.city === "string" && value.city.trim()
        ? value.city.trim()
        : typeof value.state === "string" && value.state.trim()
        ? value.state.trim()
        : "";

    if (!role || !location) return null;
    return { role, location };
  }

  if (typeof value !== "string") return null;
  const [role, location] = value.split("|||");
  if (!role || !location) return null;
  return { role, location };
}

function parseGeminiCombinationLoose(value) {
  if (!value) return null;

  if (Array.isArray(value)) {
    const role = typeof value[0] === "string" ? value[0].trim() : "";
    const location = typeof value[1] === "string" ? value[1].trim() : "";
    if (!role) return null;
    return { role, location };
  }

  if (typeof value === "object") {
    const role =
      typeof value.role === "string"
        ? value.role.trim()
        : typeof value.target_role === "string"
        ? value.target_role.trim()
        : typeof value.job_title === "string"
        ? value.job_title.trim()
        : typeof value.title === "string"
        ? value.title.trim()
        : typeof value.position === "string"
        ? value.position.trim()
        : typeof value.role_name === "string"
        ? value.role_name.trim()
        : "";

    const location =
      typeof value.location === "string"
        ? value.location.trim()
        : typeof value.location_name === "string"
        ? value.location_name.trim()
        : typeof value.job_location === "string"
        ? value.job_location.trim()
        : typeof value.city === "string" && typeof value.state === "string"
        ? `${value.city.trim()}, ${value.state.trim()}`
        : typeof value.city === "string" && value.city.trim()
        ? value.city.trim()
        : typeof value.state === "string" && value.state.trim()
        ? value.state.trim()
        : "";

    if (!role) return null;
    return { role, location };
  }

  if (typeof value !== "string") return null;
  const [role, location = ""] = value.split("|||");
  if (!role) return null;
  return { role: role.trim(), location: String(location || "").trim() };
}

function normalizeGeminiCombination(value, allowedLocations = null) {
  const parsed = parseGeminiCombinationLoose(value);
  if (!parsed) return null;

  const normalizedRole = normalizeRole(parsed.role) || parsed.role;
  let normalizedLocation = normalizeLocation(parsed.location || "");

  if (allowedLocations && !isLocationFromProfileSet(normalizedLocation, allowedLocations)) {
    return null;
  }

  if (!normalizedRole || !normalizedLocation) return null;

  return {
    role: normalizedRole,
    location: normalizedLocation,
  };
}

async function submitGeminiBatchJob({ apiKey, profiles, max_combinations }) {
  const client = new GoogleGenAI({ apiKey });
  const batchRequestPath = path.join(os.tmpdir(), `hotlist-gemini-batch-${Date.now()}.jsonl`);

  const prompt = buildBatchPrompt(profiles, max_combinations);
  const jsonlLine = {
    key: "hotlist-combinations",
    request: {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generation_config: {
        temperature: 0.1,
        max_output_tokens: 1200,
        response_mime_type: "application/json",
      },
    },
  };

  await writeFile(batchRequestPath, `${JSON.stringify(jsonlLine)}\n`, "utf8");

  const uploadedFile = await client.files.upload({
    file: batchRequestPath,
    config: {
      displayName: "hotlist-job-scraper-batch-requests",
      mimeType: "application/jsonl",
    },
  });

  const batchJob = await client.batches.create({
    model: "gemini-2.5-flash",
    src: uploadedFile.name,
    config: {
      display_name: `hotlist-job-scraper-${new Date().toISOString()}`,
    },
  });

  return batchJob;
}

async function fetchGeminiBatchJob({ apiKey, batchJobName }) {
  const normalizedName = String(batchJobName).startsWith("batches/")
    ? String(batchJobName)
    : `batches/${batchJobName}`;
  const encodedName = encodeResourceName(normalizedName);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${encodedName}?key=${apiKey}`,
  );
  if (!res.ok) {
    const errText = await res.text();
    const error = new Error(`Failed to fetch Gemini batch job ${normalizedName}: ${res.status} ${errText}`);
    error.statusCode = res.status;
    throw error;
  }
  return res.json();
}

function encodeResourceName(resourceName) {
  return String(resourceName)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function getBatchStateName(batchJob) {
  return (
    batchJob?.state?.name ||
    batchJob?.state ||
    batchJob?.status ||
    "UNKNOWN"
  );
}

function isBatchSucceeded(stateName) {
  return stateName === "JOB_STATE_SUCCEEDED" || stateName === "SUCCEEDED";
}

function isBatchFailed(stateName) {
  return ["JOB_STATE_FAILED", "FAILED", "JOB_STATE_CANCELLED", "CANCELLED"].includes(stateName);
}

async function waitForGeminiBatchCompletion({ apiKey, batchJobName, maxWaitMs, pollIntervalMs }) {
  const startedAt = Date.now();
  let batchJob = null;

  while (true) {
    try {
      batchJob = await fetchGeminiBatchJob({ apiKey, batchJobName: batchJob?.name ?? batchJobName });
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      const is404 = err?.statusCode === 404;
      if (is404 && elapsedMs < maxWaitMs) {
        console.log(
          `⏳ Gemini batch not visible yet (404). Retrying in ${Math.round(pollIntervalMs / 1000)}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        continue;
      }
      throw err;
    }

    const stateName = getBatchStateName(batchJob);
    if (isBatchSucceeded(stateName) || isBatchFailed(stateName)) {
      return { batchJob, timedOut: false };
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= maxWaitMs) {
      return { batchJob, timedOut: true };
    }

    console.log(
      `⏳ Waiting for Gemini batch ${batchJob.name ?? batchJobName} state=${stateName} elapsed=${Math.round(
        elapsedMs / 1000
      )}s`
    );
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function consumeGeminiBatchAndTrigger({
  apiKey,
  batchJobName,
  waitForCompletion,
  maxWaitMs,
  pollIntervalMs,
  maxCombinations,
  dryRun,
  selectedBoards,
  supabaseUrl,
  supabaseServiceRoleKey,
  maxResults,
  postedWithin,
  linkedinExperienceLevel,
  linkedinEmploymentType,
  linkedinWorkArrangement,
  maxConcurrent,
}) {
  const { batchJob, timedOut } = waitForCompletion
    ? await waitForGeminiBatchCompletion({ apiKey, batchJobName, maxWaitMs, pollIntervalMs })
    : { batchJob: await fetchGeminiBatchJob({ apiKey, batchJobName }), timedOut: false };

  const batchState = getBatchStateName(batchJob);
  const resolvedBatchName = batchJob.name ?? batchJobName;

  if (timedOut) {
    return {
      output: {
        mode: "gemini_batch_consume",
        ready: false,
        timed_out: true,
        batch_job_name: resolvedBatchName,
        batch_state: batchState,
        note: "Batch did not finish within max wait window. Re-run with same gemini_batch_job_name to continue.",
      },
    };
  }

  if (isBatchFailed(batchState)) {
    return {
      output: {
        mode: "gemini_batch_consume",
        ready: false,
        failed: true,
        batch_job_name: resolvedBatchName,
        batch_state: batchState,
        note: "Gemini batch job failed or was cancelled.",
      },
    };
  }

  if (!isBatchSucceeded(batchState)) {
    return {
      output: {
        mode: "gemini_batch_consume",
        ready: false,
        batch_job_name: resolvedBatchName,
        batch_state: batchState,
        note: "Batch job is not complete yet. Re-run this actor later with the same gemini_batch_job_name.",
      },
    };
  }

  const outputFileName = resolveBatchOutputFileName(batchJob);
  if (!outputFileName) {
    throw new Error("Gemini batch completed but no output file reference was found on the batch job.");
  }

  const outputText = await fetchGeminiBatchOutputText({ apiKey, fileName: outputFileName });
  const selectedPairs = extractCombinationsFromBatchOutput(outputText, maxCombinations);
  if (selectedPairs.length === 0) {
    throw new Error("Gemini batch output did not contain any valid role+location combinations.");
  }

  const combinations = selectedPairs.map((pair, index) => ({
    role: pair.role,
    location: pair.location,
    score: 1,
    observed_count: 1,
    rank: index + 1,
  }));

  const selectedRoles = [...new Set(combinations.map((c) => c.role))];
  const selectedLocations = [...new Set(combinations.map((c) => c.location))];

  if (dryRun) {
    return {
      output: {
        dry_run: true,
        mode: "gemini_batch_consume",
        llm_used: true,
        llm_model_used: batchJob.model ?? "gemini-2.5-flash",
        batch_job_name: resolvedBatchName,
        batch_state: batchState,
        batch_output_file: outputFileName,
        selected_roles: selectedRoles,
        selected_locations: selectedLocations,
        total_combinations: combinations.length,
        combinations,
        total_searches_would_trigger: combinations.length * selectedBoards.length,
      },
    };
  }

  const triggerSummary = await triggerBoardSearches({
    combinations,
    selectedBoards,
    supabaseUrl,
    supabaseServiceRoleKey,
    maxResults,
    postedWithin,
    linkedinExperienceLevel,
    linkedinEmploymentType,
    linkedinWorkArrangement,
    maxConcurrent,
  });

  return {
    output: {
      mode: "gemini_batch_consume",
      llm_used: true,
      llm_model_used: batchJob.model ?? "gemini-2.5-flash",
      batch_job_name: resolvedBatchName,
      batch_state: batchState,
      batch_output_file: outputFileName,
      selected_roles: selectedRoles,
      selected_locations: selectedLocations,
      total_combinations: combinations.length,
      total_searches_triggered: triggerSummary.total_searches_triggered,
      ok: triggerSummary.ok,
      queued: triggerSummary.queued,
      errors: triggerSummary.errors,
      skipped: triggerSummary.skipped,
      results: triggerSummary.results,
    },
  };
}

function resolveBatchOutputFileName(batchJob) {
  return (
    batchJob?.dest?.fileName ||
    batchJob?.destination?.fileName ||
    batchJob?.output?.fileName ||
    batchJob?.output?.file?.name ||
    batchJob?.response?.fileName ||
    null
  );
}

async function fetchGeminiBatchOutputText({ apiKey, fileName }) {
  const normalizedFileName = String(fileName).startsWith("files/") ? String(fileName) : `files/${fileName}`;
  const encoded = encodeResourceName(normalizedFileName);
  const urls = [
    `https://generativelanguage.googleapis.com/v1beta/${encoded}:download?alt=media&key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/${encoded}:download?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/${encoded}?alt=media&key=${apiKey}`,
  ];

  let lastError = "";
  for (const url of urls) {
    const res = await fetch(url);
    if (res.ok) return res.text();
    lastError = `${res.status} ${await res.text()}`;
  }

  throw new Error(`Failed to download Gemini batch output file ${normalizedFileName}: ${lastError}`);
}

function extractGeminiTextFromBatchLine(line) {
  return (
    line?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
    line?.response?.body?.candidates?.[0]?.content?.parts?.[0]?.text ||
    line?.response?.result?.candidates?.[0]?.content?.parts?.[0]?.text ||
    line?.result?.candidates?.[0]?.content?.parts?.[0]?.text ||
    ""
  );
}

function extractCombinationsFromBatchOutput(outputText, maxCombinations) {
  const selected = [];
  const seen = new Set();
  const lines = String(outputText).split("\n").map((x) => x.trim()).filter(Boolean);

  for (const line of lines) {
    let parsedLine = null;
    try {
      parsedLine = JSON.parse(line);
    } catch {
      continue;
    }

    const rawText = extractGeminiTextFromBatchLine(parsedLine);
    if (!rawText) continue;

    const parsed = tryParseJson(rawText);
    const candidates = Array.isArray(parsed?.selected)
      ? parsed.selected
      : Array.isArray(parsed?.combinations)
      ? parsed.combinations
      : [];

    for (const item of candidates) {
      const normalized = normalizeGeminiCombination(item);
      if (!normalized) continue;
      const key = `${normalized.role}|||${normalized.location}`;
      if (seen.has(key)) continue;

      seen.add(key);
      selected.push(normalized);
      if (selected.length >= maxCombinations) return selected;
    }
  }

  return selected;
}

function buildBatchPrompt(profiles, maxCombinations) {
  return [
    "You are given the full raw hotlist profile list from Supabase.",
    `Return up to ${maxCombinations} unique role + location combinations only from this data.`,
    "Normalize and deduplicate the roles and locations.",
    "Keep the most specific version of each role and location.",
    "Use short state abbreviations where appropriate, e.g. Andhra Pradesh -> AP, Texas -> TX, New York -> NY.",
    "Example: Visakhapatnam, India and Visakhapatnam, ANDHRA PRADESH should be normalized to Visakhapatnam, AP.",
    "Return strict JSON only in this format: {\"selected\":[{\"role\":\"Role Name\",\"location\":\"Standardized Location\"}]}",
    "Raw profiles:",
    JSON.stringify(profiles, null, 2),
  ].join("\n");
}

function mapPostedWithin(postedWithin) {
  const value = (postedWithin || "Past 24 hours").toLowerCase();
  if (value.includes("week")) {
    return {
      linkedin: "Past Week",
      dice: "Last 7 days",
      indeed: "Last 7 days",
      monster: "Last 7 days",
      careerbuilder: "Last 7 days",
    };
  }
  if (value.includes("month")) {
    return {
      linkedin: "Past Month",
      dice: "Last 30 days",
      indeed: "Last 30 days",
      monster: "Last 30 days",
      careerbuilder: "Last 30 days",
    };
  }
  if (value.includes("any")) {
    return {
      linkedin: "Any Time",
      dice: "Any",
      indeed: "Any",
      monster: "Any",
      careerbuilder: "Any",
    };
  }

  return {
    linkedin: "Past 24 hours",
    dice: "Last 24 hours",
    indeed: "Last 24 hours",
    monster: "Last 24 hours",
    careerbuilder: "Last 24 hours",
  };
}

function buildPayload(
  board,
  role,
  location,
  maxResults,
  postedWithin,
  linkedinExperienceLevel,
  linkedinEmploymentType,
  linkedinWorkArrangement
) {
  const postedMap = mapPostedWithin(postedWithin);

  switch (board) {
    case "linkedin":
      return {
        job_title: role,
        location,
        posted_within: postedMap.linkedin,
        experience_level: linkedinExperienceLevel,
        employment_type: linkedinEmploymentType,
        work_arrangement: linkedinWorkArrangement,
        max_results: maxResults,
      };
    case "dice":
      return {
        keyword: role,
        location,
        posted_date: postedMap.dice,
        max_results: maxResults,
      };
    case "indeed":
      return {
        keyword: role,
        location,
        date_posted: postedMap.indeed,
        max_results: maxResults,
      };
    case "monster":
      return {
        keyword: role,
        location,
        date_posted: postedMap.monster,
        max_results: maxResults,
      };
    case "careerbuilder":
      return {
        keyword: role,
        location,
        date_posted: postedMap.careerbuilder,
        max_results: maxResults,
      };
    default:
      return null;
  }
}

async function triggerBoardSearches({
  combinations,
  selectedBoards,
  supabaseUrl,
  supabaseServiceRoleKey,
  maxResults,
  postedWithin,
  linkedinExperienceLevel,
  linkedinEmploymentType,
  linkedinWorkArrangement,
  maxConcurrent,
}) {
  const reqHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
  };

  const tasks = [];
  for (const combo of combinations) {
    for (const board of selectedBoards) {
      tasks.push(async () => {
        const payload = buildPayload(
          board,
          combo.role,
          combo.location,
          maxResults,
          postedWithin,
          linkedinExperienceLevel,
          linkedinEmploymentType,
          linkedinWorkArrangement
        );
        const fnName = BOARD_FUNCTION_MAP[board];
        if (!payload || !fnName) {
          return { board, role: combo.role, location: combo.location, status: "skipped" };
        }

        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
            method: "POST",
            headers: reqHeaders,
            body: JSON.stringify(payload),
          });

          const body = await res.json().catch(() => ({}));
          const queued = body?.queued === true;

          return {
            board,
            role: combo.role,
            location: combo.location,
            status: queued ? "queued" : res.ok ? "ok" : "error",
            statusCode: res.status,
            message: body?.message ?? body?.error ?? null,
          };
        } catch (err) {
          return {
            board,
            role: combo.role,
            location: combo.location,
            status: "error",
            message: err?.message || "Unknown fetch error",
          };
        }
      });
    }
  }

  const results = [];
  let idx = 0;
  const workerCount = Math.min(Math.max(1, maxConcurrent), tasks.length || 1);
  const workers = Array.from({ length: workerCount }, async () => {
    while (idx < tasks.length) {
      const task = tasks[idx++];
      const result = await task();
      results.push(result);
      console.log(
        `  [${result.status.toUpperCase()}] ${result.board} - "${result.role}" @ "${result.location}"` +
          (result.message ? ` (${result.message})` : "")
      );
    }
  });
  await Promise.all(workers);

  return {
    total_searches_triggered: results.filter((r) => r.status !== "skipped").length,
    ok: results.filter((r) => r.status === "ok").length,
    queued: results.filter((r) => r.status === "queued").length,
    errors: results.filter((r) => r.status === "error").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    results,
  };
}
