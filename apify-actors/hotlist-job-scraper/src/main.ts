import { Actor } from "apify";
import Anthropic from "@anthropic-ai/sdk";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HotlistProfile {
  profile_id: string;
  account_id: string;
  candidate_name: string;
  target_role: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  preferred_locations: string | null;
}

interface SearchCombination {
  role: string;
  location: string;
}

interface BoardResult {
  board: string;
  role: string;
  location: string;
  status: "queued" | "ok" | "error" | "skipped";
  statusCode?: number;
  message?: string;
}

// ── Main ──────────────────────────────────────────────────────────────────────

await Actor.main(async () => {
  const input = await Actor.getInput<{
    supabase_url: string;
    supabase_service_role_key: string;
    gemini_api_key?: string;
    boards?: string[];
    max_results?: number;
    posted_within?: string;
    dry_run?: boolean;
  }>();

  if (!input) throw new Error("Missing actor input");

  const {
    supabase_url,
    supabase_service_role_key,
    gemini_api_key,
    boards = ["linkedin", "dice", "indeed", "monster", "careerbuilder"],
    max_results = 25,
    posted_within = "Past 24 hours",
    dry_run = false,
  } = input;

  console.log(`🚀 Starting hotlist job scraper — boards: ${boards.join(", ")}`);

  // ── Step 1: Fetch active hotlist profiles from Supabase ─────────────────────

  console.log("📋 Fetching hotlist_active_profiles from Supabase...");

  const profilesRes = await fetch(
    `${supabase_url}/rest/v1/hotlist_active_profiles?select=profile_id,account_id,candidate_name,target_role,location,city,state,preferred_locations`,
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

  const profiles: HotlistProfile[] = await profilesRes.json();

  if (!profiles || profiles.length === 0) {
    console.log("⚠️ No active hotlist profiles found. Exiting.");
    await Actor.setValue("OUTPUT", { message: "No active hotlist profiles", searches_triggered: 0 });
    return;
  }

  console.log(`✅ Found ${profiles.length} active hotlist profiles`);

  // ── Step 2: Extract raw roles and locations ─────────────────────────────────

  const rawRoles = profiles
    .map((p) => p.target_role)
    .filter((r): r is string => !!r && r.trim().length > 0);

  const rawLocations = profiles
    .flatMap((p) => [
      p.preferred_locations,
      p.location,
      p.city && p.state ? `${p.city}, ${p.state}` : null,
      p.city,
      p.state,
    ])
    .filter((l): l is string => !!l && l.trim().length > 0);

  console.log(`📊 Raw roles: ${[...new Set(rawRoles)].length} unique, locations: ${[...new Set(rawLocations)].length} unique`);

  // ── Step 3: Use LLM to normalize and deduplicate roles + locations ──────────

  let uniqueRoles: string[] = [...new Set(rawRoles.map((r) => r.trim()))];
  let uniqueLocations: string[] = [...new Set(rawLocations.map((l) => l.trim()))];

  if (gemini_api_key) {
    console.log("🤖 Calling Gemini to normalize and deduplicate roles + locations...");

    const prompt = `You are helping prepare job board search queries for bench sales recruiters.

Given these raw job roles from a recruiter's hotlist:
${JSON.stringify([...new Set(rawRoles)], null, 2)}

And these raw locations:
${JSON.stringify([...new Set(rawLocations)], null, 2)}

Tasks:
1. Deduplicate and normalize the roles (e.g. "Sr. Java Dev", "Senior Java Developer", "Java Sr Dev" → "Senior Java Developer")
2. Remove overly broad roles that would produce too many irrelevant results
3. Deduplicate and normalize the locations (e.g. "Seattle WA", "Seattle, Washington", "Seattle" → "Seattle, WA")
4. Remove vague locations like "Remote" or "Open to relocation" — keep specific cities/states/metros

Return ONLY valid JSON in exactly this format (no markdown, no explanation):
{
  "roles": ["Role 1", "Role 2"],
  "locations": ["City, ST", "City, ST"]
}`;

    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${gemini_api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
          }),
        }
      );

      if (geminiRes.ok) {
        const geminiData = await geminiRes.json();
        const raw = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed.roles) && parsed.roles.length > 0) {
            uniqueRoles = parsed.roles;
            console.log(`✅ LLM normalized to ${uniqueRoles.length} roles`);
          }
          if (Array.isArray(parsed.locations) && parsed.locations.length > 0) {
            uniqueLocations = parsed.locations;
            console.log(`✅ LLM normalized to ${uniqueLocations.length} locations`);
          }
        }
      } else {
        console.warn(`⚠️ Gemini API error ${geminiRes.status}, using raw deduplication`);
      }
    } catch (err) {
      console.warn(`⚠️ LLM call failed: ${(err as Error).message}, using raw deduplication`);
    }
  } else {
    console.log("ℹ️ No Gemini API key provided — using raw role/location deduplication");
  }

  // ── Step 4: Build all unique (role × location) combinations ────────────────

  const combinations: SearchCombination[] = [];
  for (const role of uniqueRoles) {
    for (const location of uniqueLocations) {
      combinations.push({ role, location });
    }
  }

  console.log(
    `🔀 Generated ${combinations.length} combinations (${uniqueRoles.length} roles × ${uniqueLocations.length} locations)`
  );

  if (dry_run) {
    console.log("🧪 DRY RUN — not triggering scrapers. Combinations:");
    combinations.forEach((c, i) => console.log(`  ${i + 1}. [${c.role}] @ [${c.location}]`));
    await Actor.setValue("OUTPUT", {
      dry_run: true,
      unique_roles: uniqueRoles,
      unique_locations: uniqueLocations,
      combinations,
      total_searches_would_trigger: combinations.length * boards.length,
    });
    return;
  }

  // ── Step 5: Trigger scrapers for each combination × board ───────────────────

  const results: BoardResult[] = [];
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${supabase_service_role_key}`,
  };

  // Process with concurrency limit of 10
  const MAX_CONCURRENT = 10;
  const tasks: Array<() => Promise<BoardResult>> = [];

  for (const combo of combinations) {
    for (const board of boards) {
      tasks.push(async (): Promise<BoardResult> => {
        const payload = buildPayload(board, combo.role, combo.location, max_results, posted_within);
        if (!payload) return { board, role: combo.role, location: combo.location, status: "skipped" };

        const fnName = BOARD_FUNCTION_MAP[board];
        if (!fnName) return { board, role: combo.role, location: combo.location, status: "skipped" };

        try {
          const res = await fetch(`${supabase_url}/functions/v1/${fnName}`, {
            method: "POST",
            headers,
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
            message: body?.message ?? body?.error,
          };
        } catch (err) {
          return {
            board,
            role: combo.role,
            location: combo.location,
            status: "error",
            message: (err as Error).message,
          };
        }
      });
    }
  }

  // Run tasks with concurrency control
  let idx = 0;
  const activeTasks: Promise<void>[] = [];

  async function runNext() {
    if (idx >= tasks.length) return;
    const task = tasks[idx++];
    const result = await task();
    results.push(result);
    console.log(
      `  [${result.status.toUpperCase()}] ${result.board} — "${result.role}" @ "${result.location}"` +
        (result.message ? ` (${result.message})` : "")
    );
  }

  // Fill initial pool
  for (let i = 0; i < Math.min(MAX_CONCURRENT, tasks.length); i++) {
    activeTasks.push(
      (async () => {
        while (idx < tasks.length) {
          await runNext();
        }
      })()
    );
  }
  await Promise.all(activeTasks);

  // ── Step 6: Save output ─────────────────────────────────────────────────────

  const summary = {
    profiles_fetched: profiles.length,
    unique_roles: uniqueRoles,
    unique_locations: uniqueLocations,
    total_combinations: combinations.length,
    total_searches_triggered: results.filter((r) => r.status !== "skipped").length,
    ok: results.filter((r) => r.status === "ok").length,
    queued: results.filter((r) => r.status === "queued").length,
    errors: results.filter((r) => r.status === "error").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    results,
  };

  console.log(
    `\n✅ Done! ${summary.ok} ok, ${summary.queued} queued, ${summary.errors} errors, ${summary.skipped} skipped`
  );

  await Actor.setValue("OUTPUT", summary);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const BOARD_FUNCTION_MAP: Record<string, string> = {
  linkedin: "linkedin-search",
  dice: "dice-search",
  indeed: "indeed-search",
  monster: "monster-search",
  careerbuilder: "careerbuilder-search",
};

function buildPayload(
  board: string,
  role: string,
  location: string,
  maxResults: number,
  postedWithin: string
): Record<string, unknown> | null {
  switch (board) {
    case "linkedin":
      return {
        job_title: role,
        location,
        posted_within: postedWithin,          // "Past 24 hours" | "Past Week" | "Past Month" | "Any Time"
        experience_level: "Mid-Senior",
        employment_type: "",
        work_arrangement: "",
        max_results: maxResults,
      };

    case "dice":
      return {
        keyword: role,
        location,
        posted_date: "Last 24 hours",          // "Last 24 hours" | "Last week" | "Last month" | "Any time"
        max_results: maxResults,
      };

    case "indeed":
      return {
        keyword: role,
        location,
        date_posted: "Last 24 hours",          // "Any time" | "Last 24 hours" | "Last 3 days" | "Last 7 days" | "Last 14 days"
        max_results: maxResults,
      };

    case "monster":
      return {
        keyword: role,
        location,
        date_posted: "Last 24 hours",          // "Any time" | "Last 24 hours" | "Last week" | "Last month"
        max_results: maxResults,
      };

    case "careerbuilder":
      return {
        keyword: role,
        location,
        date_posted: "Last 24 hours",          // "Any time" | "Last 24 hours" | "Last week" | "Last month"
        max_results: maxResults,
      };

    default:
      return null;
  }
}
