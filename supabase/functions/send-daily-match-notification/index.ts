import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface AccountDailySummary {
  summary_date: string;
  account_id: string;
  owner_id: string;
  owner_email: string;
  profiles_with_matches: number;
  total_new_matches: number;
  candidate_names: string[];
  profiles_breakdown: Array<{
    profile_id: string;
    candidate_name: string;
    match_count: number;
    boards: string[];
    match_sources: Array<{ board: string; count: number }>;
  }>;
  boards_breakdown: Record<string, number>;
  created_at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json().catch(() => ({}));
    const { action = "send_notifications", owner_email: filterEmail = null } = body;

    if (action !== "send_notifications") {
      return respond({ error: "Invalid action" }, 400);
    }

    // Fetch account-level summaries for today, optionally filtered by owner email
    let summaryQuery = supabase.from("account_daily_match_summaries").select("*");
    if (filterEmail) {
      summaryQuery = summaryQuery.eq("owner_email", filterEmail);
    }
    const { data: summaries, error: summaryErr } = await summaryQuery;

    if (summaryErr) {
      return respond({
        error: `Failed to fetch account summaries: ${summaryErr.message}`,
        notifications_sent: 0,
      }, 400);
    }

    if (!summaries || summaries.length === 0) {
      return respond({
        message: "No accounts with new matches today",
        notifications_sent: 0,
      });
    }

    // Webhook URL for daily match notifications (GoHighLevel / LeadConnector)
    const webhookUrl = Deno.env.get("WEBHOOK_NOTIFICATION_URL") ??
      "https://services.leadconnectorhq.com/hooks/48XyGfN1WxneooOcHGHn/webhook-trigger/24d4fb66-a55b-4858-9008-342f9ba289ac";

    // Send webhook notification for each account
    const notificationPromises = (summaries as AccountDailySummary[]).map(
      async (summary) => {
        try {
          const payload = {
            event_type: "daily_match_summary",
            timestamp: new Date().toISOString(),
            account_id: summary.account_id,
            owner_id: summary.owner_id,
            owner_email: summary.owner_email,
            summary_date: summary.summary_date,
            total_new_matches: summary.total_new_matches,
            profiles_with_matches: summary.profiles_with_matches,
            candidate_names: summary.candidate_names,
            profiles_breakdown: summary.profiles_breakdown,
            boards_breakdown: summary.boards_breakdown,
          };

          const res = await fetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          return {
            account_id: summary.account_id,
            owner_email: summary.owner_email,
            success: res.ok,
            status: res.status,
          };
        } catch (err) {
          return {
            account_id: summary.account_id,
            owner_email: summary.owner_email,
            success: false,
            error: (err as Error).message,
          };
        }
      },
    );

    const results = await Promise.allSettled(notificationPromises);
    const successCount = results.filter(
      (r) => r.status === "fulfilled" && (r.value as Record<string, unknown>).success,
    ).length;

    return respond({
      message: "Notification sending complete",
      notifications_sent: successCount,
      total_accounts: summaries.length,
      results: results.map((r) => r.status === "fulfilled" ? r.value : { error: "Failed" }),
      summaries,
    });
  } catch (err) {
    return respond(
      {
        error: (err as Error).message,
        notifications_sent: 0,
      },
      500,
    );
  }
});

function respond(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
