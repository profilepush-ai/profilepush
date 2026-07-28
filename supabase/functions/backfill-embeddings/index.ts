import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const JOB_TABLES = [
  { table: "linkedin_jobs", source: "linkedin" },
  { table: "dice_jobs", source: "dice" },
  { table: "indeed_jobs", source: "indeed" },
  { table: "monster_jobs", source: "monster" },
  { table: "careerbuilder_jobs", source: "careerbuilder" },
  { table: "social_jobs", source: "social" },
];

const BATCH_SIZE = 10;

interface BackfillRequest {
  days?: number;
  limitPerTable?: number;
  profilesLimit?: number;
  offsetPerTable?: number;
  jobsOnly?: boolean;
  profilesOnly?: boolean;
  tables?: string[];
  forceRetest?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const body = (req.method === "POST" ? await req.json().catch(() => ({})) : {}) as BackfillRequest;
    const days = Math.max(Number(body.days ?? 3), 1);
    const limitPerTable = Math.max(Number(body.limitPerTable ?? 500), 1);
    const profilesLimit = Math.max(Number(body.profilesLimit ?? limitPerTable), 1);
    const offsetPerTable = Math.max(Number(body.offsetPerTable ?? 0), 0);
    const jobsOnly = Boolean(body.jobsOnly);
    const profilesOnly = Boolean(body.profilesOnly);
    const forceRetest = Boolean(body.forceRetest);
    const requestedTables = Array.isArray(body.tables)
      ? body.tables.map((t) => String(t).trim()).filter((t) => t.length > 0)
      : [];
    const selectedTables = requestedTables.length > 0
      ? JOB_TABLES.filter((t) => requestedTables.includes(t.table))
      : JOB_TABLES;

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let profilesQueued = 0;
    let jobsQueued = 0;
    const tableSummary: Array<{ table: string; selected: number; queued: number; batches: number }> = [];

    // Backfill profiles without embeddings created in last 3 days
    if (!jobsOnly) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id")
        .is("profile_embedding", null)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(profilesLimit);

      if (profiles && profiles.length > 0) {
        let profileBatches = 0;
        for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
          const batch = profiles.slice(i, i + BATCH_SIZE);
          const payload = batch.map(p => ({ type: "profile" as const, id: p.id }));

          await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceRoleKey}`,
              "Apikey": serviceRoleKey,
            },
            body: JSON.stringify(payload),
          });

          profilesQueued += batch.length;
          profileBatches += 1;
          // Small delay between batches to avoid rate limits
          if (i + BATCH_SIZE < profiles.length) {
            await new Promise(r => setTimeout(r, 500));
          }
        }

        tableSummary.push({
          table: "profiles",
          selected: profiles.length,
          queued: profilesQueued,
          batches: profileBatches,
        });
      } else {
        tableSummary.push({ table: "profiles", selected: 0, queued: 0, batches: 0 });
      }
    }

    // Backfill jobs without embeddings created in last 3 days
    if (!profilesOnly) {
      for (const { table } of selectedTables) {
        let query = supabase
          .from(table)
          .select("id")
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false })
          .range(offsetPerTable, offsetPerTable + limitPerTable - 1)
          .limit(limitPerTable);

        if (!forceRetest) {
          query = query.is("job_embedding", null);
        }

        const { data: jobs } = await query;

        let queuedForTable = 0;
        let tableBatches = 0;

        if (jobs && jobs.length > 0) {
          for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
            const batch = jobs.slice(i, i + BATCH_SIZE);
            const payload = batch.map(j => ({ type: "job" as const, id: j.id, table }));

            await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${serviceRoleKey}`,
                "Apikey": serviceRoleKey,
              },
              body: JSON.stringify(payload),
            });

            jobsQueued += batch.length;
            queuedForTable += batch.length;
            tableBatches += 1;
            if (i + BATCH_SIZE < jobs.length) {
              await new Promise(r => setTimeout(r, 500));
            }
          }
        }

        tableSummary.push({
          table,
          selected: jobs?.length ?? 0,
          queued: queuedForTable,
          batches: tableBatches,
        });
      }
    }

    return new Response(JSON.stringify({
      message: "Backfill completed",
      profiles_processed: profilesQueued,
      jobs_processed: jobsQueued,
      params: {
        days,
        limit_per_table: limitPerTable,
        profiles_limit: profilesLimit,
        offset_per_table: offsetPerTable,
        jobs_only: jobsOnly,
        profiles_only: profilesOnly,
        force_retest: forceRetest,
        requested_tables: requestedTables,
        selected_tables: selectedTables.map((t) => t.table),
      },
      tables: tableSummary,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
