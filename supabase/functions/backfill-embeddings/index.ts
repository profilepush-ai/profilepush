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
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    let profilesQueued = 0;
    let jobsQueued = 0;

    // Backfill profiles without embeddings created in last 3 days
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .is("profile_embedding", null)
      .gte("created_at", threeDaysAgo)
      .limit(500);

    if (profiles && profiles.length > 0) {
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
        // Small delay between batches to avoid rate limits
        if (i + BATCH_SIZE < profiles.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    // Backfill jobs without embeddings created in last 3 days
    for (const { table } of JOB_TABLES) {
      const { data: jobs } = await supabase
        .from(table)
        .select("id")
        .is("job_embedding", null)
        .gte("created_at", threeDaysAgo)
        .limit(500);

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
          if (i + BATCH_SIZE < jobs.length) {
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
    }

    return new Response(JSON.stringify({
      message: "Backfill completed",
      profiles_processed: profilesQueued,
      jobs_processed: jobsQueued,
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
