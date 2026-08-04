import { Actor } from "apify";

const SUPPORTED_BOARDS = ["linkedin", "dice", "indeed", "monster", "careerbuilder"];
const BOARD_FUNCTION_MAP = {
  linkedin: "linkedin-search",
  dice: "dice-search",
  indeed: "indeed-search",
  monster: "monster-search",
  careerbuilder: "careerbuilder-search",
};

await Actor.main(async () => {
  const input = await Actor.getInput();
  if (!input) throw new Error("Missing actor input");

  const {
    supabase_url,
    supabase_service_role_key,
    gemini_payload = null,
    gemini_payload_json = "",
    gemini_webhook_secret = "",
    gemini_secret_field = "secret",
    boards = SUPPORTED_BOARDS,
    max_results = 20,
    posted_within = "Past 24 hours",
    linkedin_experience_level = "Mid-Senior",
    linkedin_employment_type = "",
    linkedin_work_arrangement = "",
    max_combinations = 40,
    max_concurrent = 3,
    dry_run = false,
  } = input;

  if (!supabase_url || !supabase_service_role_key) {
    throw new Error("supabase_url and supabase_service_role_key are required inputs");
  }

  const selectedBoards = Array.isArray(boards)
    ? boards.filter((b) => SUPPORTED_BOARDS.includes(b))
    : [];
  if (selectedBoards.length === 0) {
    throw new Error(`No valid boards selected. Allowed: ${SUPPORTED_BOARDS.join(", ")}`);
  }

  const payload = resolveIncomingPayload({ input, gemini_payload, gemini_payload_json });

  if (gemini_webhook_secret) {
    const payloadSecret = extractSecretFromPayload(payload, gemini_secret_field);
    if (payloadSecret !== gemini_webhook_secret) {
      throw new Error("Gemini webhook secret mismatch");
    }
  }

  const selectedPairs = extractCombinationsFromPayload(payload, max_combinations);
  if (selectedPairs.length === 0) {
    throw new Error("No valid role+location combinations found in Gemini payload.");
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

  if (dry_run) {
    await Actor.setValue("OUTPUT", {
      dry_run: true,
      mode: "gemini_payload_consume",
      total_combinations: combinations.length,
      selected_roles: selectedRoles,
      selected_locations: selectedLocations,
      combinations,
      total_searches_would_trigger: combinations.length * selectedBoards.length,
    });
    return;
  }

  const triggerSummary = await triggerBoardSearches({
    combinations,
    selectedBoards,
    supabaseUrl: supabase_url,
    supabaseServiceRoleKey: supabase_service_role_key,
    maxResults: max_results,
    postedWithin: posted_within,
    linkedinExperienceLevel: linkedin_experience_level,
    linkedinEmploymentType: linkedin_employment_type,
    linkedinWorkArrangement: linkedin_work_arrangement,
    maxConcurrent: max_concurrent,
  });

  await Actor.setValue("OUTPUT", {
    mode: "gemini_payload_consume",
    total_combinations: combinations.length,
    selected_roles: selectedRoles,
    selected_locations: selectedLocations,
    total_searches_triggered: triggerSummary.total_searches_triggered,
    ok: triggerSummary.ok,
    queued: triggerSummary.queued,
    errors: triggerSummary.errors,
    skipped: triggerSummary.skipped,
    results: triggerSummary.results,
  });
});

function resolveIncomingPayload({ input, gemini_payload, gemini_payload_json }) {
  if (gemini_payload && typeof gemini_payload === "object") {
    return gemini_payload;
  }

  if (typeof gemini_payload_json === "string" && gemini_payload_json.trim()) {
    const parsed = tryParseJson(gemini_payload_json);
    if (parsed) return parsed;
    return { jsonl: gemini_payload_json };
  }

  if (typeof input === "string") {
    const parsed = tryParseJson(input);
    if (parsed) return parsed;
    return { jsonl: input };
  }

  return input;
}

function extractSecretFromPayload(payload, secretField) {
  if (!payload || typeof payload !== "object") return "";
  const direct = payload[secretField];
  if (typeof direct === "string") return direct;
  const nested = payload?.meta?.[secretField] ?? payload?.data?.[secretField];
  return typeof nested === "string" ? nested : "";
}

function extractCombinationsFromPayload(payload, maxCombinations) {
  const out = [];
  const seen = new Set();

  const pushItem = (item) => {
    const normalized = normalizeCombination(item);
    if (!normalized) return;
    const key = `${normalized.role}|||${normalized.location}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  };

  const collectFromJson = (obj) => {
    if (!obj || typeof obj !== "object") return;

    const selected = Array.isArray(obj.selected) ? obj.selected : [];
    const combinations = Array.isArray(obj.combinations) ? obj.combinations : [];
    for (const item of [...selected, ...combinations]) pushItem(item);

    const textCandidate =
      obj?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      obj?.response?.body?.candidates?.[0]?.content?.parts?.[0]?.text ||
      obj?.result?.candidates?.[0]?.content?.parts?.[0]?.text ||
      obj?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    if (typeof textCandidate === "string" && textCandidate.trim()) {
      const parsed = tryParseJson(textCandidate);
      if (parsed) collectFromJson(parsed);
    }

    if (Array.isArray(obj.items)) {
      for (const item of obj.items) collectFromJson(item);
    }

    if (Array.isArray(obj.responses)) {
      for (const item of obj.responses) collectFromJson(item);
    }
  };

  if (payload && typeof payload === "object" && typeof payload.jsonl === "string") {
    const lines = payload.jsonl.split("\n").map((x) => x.trim()).filter(Boolean);
    for (const line of lines) {
      const parsed = tryParseJson(line);
      if (parsed) collectFromJson(parsed);
    }
  } else {
    collectFromJson(payload);
  }

  if (out.length > maxCombinations) {
    return out.slice(0, maxCombinations);
  }
  return out;
}

function normalizeCombination(value) {
  const parsed = parseCombinationValue(value);
  if (!parsed) return null;

  const role = parsed.role.trim();
  const location = parsed.location.trim();
  if (!role || !location) return null;

  return { role, location };
}

function parseCombinationValue(value) {
  if (!value) return null;

  if (typeof value === "object") {
    const role = typeof value.role === "string" ? value.role.trim() : "";
    const location = typeof value.location === "string" ? value.location.trim() : "";
    if (!role || !location) return null;
    return { role, location };
  }

  if (typeof value !== "string") return null;
  const parts = value.split("|||");
  if (parts.length !== 2) return null;
  const role = parts[0].trim();
  const location = parts[1].trim();
  if (!role || !location) return null;
  return { role, location };
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
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
