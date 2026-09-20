import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Daily engagement nudge for bench sales: "22 new jobs match your 3
// consultants". Counts jobs that arrived in the last 24 hours and sit close to
// one of the account's open consultants in embedding space — the same vectors
// AI Match searches, so the number means what the product would show.
//
// Delivered in-app (a row in the bell) and as a push, honouring
// notification_preferences like every other notification. Accounts with no new
// matches are skipped rather than sent a zero: a "0 new jobs" push is how
// people turn notifications off. That also means quiet weekends stay quiet,
// which is when job inflow drops from ~900/day to ~40.
//
// Triggered by the daily cron in the profilepush-email-notifications worker,
// authenticated with the shared DIGEST_NOTIFY_TOKEN that drives the digest.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const NOTIF_TYPE = "job_matches_daily";
const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_MIN_SIMILARITY = 0.7;
// Where the notification leads: their own consultants, each with a Matches
// button. Not straight into a run, which spends credits.
const NOTIF_LINK = "/posts/hotlist";

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type MatchRow = {
  account_id: string;
  consultant_count: number;
  matched_jobs: number;
  sample_title: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const expectedToken = (Deno.env.get("DIGEST_NOTIFY_TOKEN") ?? "").trim();
  if (!expectedToken || body?.token !== expectedToken) return respond({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const windowHours = Number(body?.window_hours) > 0 ? Number(body.window_hours) : DEFAULT_WINDOW_HOURS;
  const minSimilarity = Number(body?.min_similarity) > 0 ? Number(body.min_similarity) : DEFAULT_MIN_SIMILARITY;
  // Lets the job be inspected — what it would send, to whom — without sending.
  const dryRun = body?.dry_run === true;

  try {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.rpc("new_job_matches_since", {
      p_since: since,
      p_min_similarity: minSimilarity,
    });
    if (error) return respond({ error: `Match count failed: ${error.message}` }, 500);

    const rows = (data ?? []) as MatchRow[];
    if (rows.length === 0) return respond({ ok: true, accounts: 0, sent: 0, skipped: 0, dry_run: dryRun });

    // One lookup for every recipient rather than per account.
    const accountIds = rows.map((row) => row.account_id);
    const { data: members } = await supabase
      .from("account_members")
      .select("account_id, user_id")
      .in("account_id", accountIds)
      .eq("status", "active")
      .not("user_id", "is", null);

    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("user_id, in_app_enabled")
      .eq("notif_type", NOTIF_TYPE);
    // No row means not yet configured, which is opt-in by default — the same
    // rule send-notification applies.
    const inAppOff = new Set((prefs ?? []).filter((p) => p.in_app_enabled === false).map((p) => p.user_id));

    const byAccount = new Map(rows.map((row) => [row.account_id, row]));
    const planned: Array<{ user_id: string; account_id: string; title: string; body: string }> = [];
    for (const member of members ?? []) {
      const row = byAccount.get(member.account_id as string);
      if (!row || row.matched_jobs < 1) continue;
      if (inAppOff.has(member.user_id)) continue;
      const jobWord = row.matched_jobs === 1 ? "job" : "jobs";
      const consultantWord = row.consultant_count === 1 ? "consultant" : "consultants";
      planned.push({
        user_id: member.user_id as string,
        account_id: member.account_id as string,
        title: `${row.matched_jobs} new ${jobWord} match your ${row.consultant_count} ${consultantWord}`,
        body: row.sample_title ? `Top match: ${row.sample_title}` : "Tap to see your consultants",
      });
    }

    if (dryRun) {
      return respond({ ok: true, dry_run: true, accounts: rows.length, would_send: planned.length, sample: planned.slice(0, 5) });
    }

    let sent = 0;
    for (const item of planned) {
      const { data: inserted, error: insertError } = await supabase
        .from("notifications")
        .insert({
          user_id: item.user_id,
          account_id: item.account_id,
          type: NOTIF_TYPE,
          title: item.title,
          body: item.body,
          link: NOTIF_LINK,
          read: false,
        })
        .select("id")
        .single();
      if (insertError || !inserted) {
        console.error("notify-job-matches insert failed", insertError?.message);
        continue;
      }
      sent += 1;

      // Push is best-effort: the bell row is the record, and a push failure
      // must not stop the rest of the run.
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
          },
          body: JSON.stringify({
            id: inserted.id,
            user_id: item.user_id,
            title: item.title,
            body: item.body,
            link: NOTIF_LINK,
            type: NOTIF_TYPE,
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (pushError) {
        console.error("notify-job-matches push failed", (pushError as Error).message);
      }
    }

    return respond({ ok: true, accounts: rows.length, sent, planned: planned.length });
  } catch (error) {
    return respond({ error: (error as Error).message }, 500);
  }
});
