import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Ask the poster: a user taps Ask on a post that leaves out the rate, the visa
// or the location. We record it and email the poster (when the post has an
// email) that this user is interested and asked, with the user's name and
// email so the poster can reply to them directly.
//
// Emails go only when someone asks, at most one per post and question every
// 3 days; later askers are recorded and counted in the next email. Posters
// are not ProfilePush users, so mail goes on the email worker's outreach lane.
//
//   POST { lead_id, question: "rate" | "visa" | "location" }
//   -> { status: "asked" | "already", emailed: boolean }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_GAP_HOURS = 72;
const DAILY_ASKS = 30;

function respond(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const firstName = (name: string) => name.split(/\s+/)[0] || "there";

const QUESTIONS: Record<string, { job: string; profile: string; topic: string }> = {
  rate: { job: "What is the rate for this role?", profile: "What is this consultant's rate?", topic: "the rate" },
  visa: { job: "Which visas (work authorizations) can this role take?", profile: "What is this consultant's visa status?", topic: "the visa" },
  location: { job: "Where is this role based, and is it onsite, hybrid or remote?", profile: "Where is this consultant based, and are they open to relocate?", topic: "the location" },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });

  try {
    const { data: { user } } = await asUser.auth.getUser();
    if (!user?.email) return respond({ error: "Unauthorized" }, 401);
    const body = await req.json() as Record<string, unknown>;
    const leadId = str(body.lead_id, 100);
    const question = str(body.question, 20);
    if (!UUID.test(leadId) || !QUESTIONS[question]) return respond({ error: "lead_id and question are required" }, 400);

    const { data: member } = await admin.from("account_members").select("account_id")
      .eq("user_id", user.id).eq("status", "active").order("created_at").limit(1).maybeSingle();
    const accountId = member?.account_id as string | undefined;
    if (!accountId) return respond({ error: "no_account" }, 400);

    // The post and who posted it.
    let kind: "job" | "hotlist" = "job";
    let to = "", posterName = "", title = "", org = "";
    const { data: job } = await admin.from("social_jobs").select("poster_email, posted_by_name, job_title, company_name").eq("id", leadId).maybeSingle();
    if (job) {
      to = str(job.poster_email, 200); posterName = str(job.posted_by_name); title = str(job.job_title) || "job"; org = str(job.company_name);
    } else {
      const { data: h } = await admin.from("social_hotlist").select("bench_sales_recruiter_email, bench_sales_recruiter_name, role_title, bench_sales_company_name").eq("id", leadId).maybeSingle();
      if (!h) return respond({ error: "not_found" }, 404);
      kind = "hotlist";
      to = str(h.bench_sales_recruiter_email, 200); posterName = str(h.bench_sales_recruiter_name); title = str(h.role_title) || "consultant"; org = str(h.bench_sales_company_name);
    }
    to = to.split(/[,;\s]+/).find((e) => /^\S+@\S+\.\S+$/.test(e)) ?? "";
    if (!to) return respond({ error: "no_email" }, 400);

    // A few dozen asks a day per account is plenty; more looks like spam.
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count: today } = await admin.from("post_questions").select("id", { count: "exact", head: true }).eq("account_id", accountId).gte("created_at", since);
    if ((today ?? 0) >= DAILY_ASKS) return respond({ error: "daily_limit" }, 429);

    const { data: inserted, error: insErr } = await admin.from("post_questions")
      .upsert({ lead_kind: kind, lead_id: leadId, question, account_id: accountId, user_id: user.id }, { onConflict: "lead_id,question,account_id", ignoreDuplicates: true })
      .select("id");
    if (insErr) return respond({ error: insErr.message }, 500);
    if (!inserted || inserted.length === 0) return respond({ status: "already", emailed: false });
    const rowId = inserted[0].id as string;

    // One email per post and question every 3 days.
    const gapSince = new Date(Date.now() - EMAIL_GAP_HOURS * 3_600_000).toISOString();
    const { count: recentEmails } = await admin.from("post_questions").select("id", { count: "exact", head: true })
      .eq("lead_id", leadId).eq("question", question).gte("emailed_at", gapSince);
    if ((recentEmails ?? 0) > 0) return respond({ status: "asked", emailed: false });

    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { count: askers } = await admin.from("post_questions").select("id", { count: "exact", head: true })
      .eq("lead_id", leadId).eq("question", question).gte("created_at", weekAgo);
    const others = Math.max(0, (askers ?? 1) - 1);

    const { data: account } = await admin.from("accounts").select("name").eq("id", accountId).maybeSingle();
    const askerName = str(user.user_metadata?.full_name as string) || user.email.split("@")[0];
    const company = str(account?.name);
    const q = QUESTIONS[question];
    const ask = kind === "job" ? q.job : q.profile;
    const what = kind === "job" ? `${title} post` : `${title} profile`;
    const subject = `${askerName} asked about ${q.topic} for your ${what}`;
    const lines = [
      `Hi ${firstName(posterName)},`,
      `${askerName}${company ? ` from ${company}` : ""} saw your ${what}${org && kind === "job" ? ` (${org})` : ""} and is interested.`,
      `They asked: ${ask}`,
      `Reply to ${firstName(askerName)} directly at ${user.email}${kind === "job" ? " and they can send you a matching consultant." : "."}`,
      others > 0 ? `${others} other ${others === 1 ? "recruiter" : "recruiters"} asked the same this week.` : "",
      "ProfilePush matches recruiters' consultants with open requirements.",
    ].filter(Boolean);
    const text = lines.join("\n\n");
    const html = lines.map((l) => `<p>${esc(l).replace(esc(user.email), `<a href="mailto:${esc(user.email)}">${esc(user.email)}</a>`)}</p>`).join("");

    const workerUrl = (Deno.env.get("EMAIL_WORKER_URL") ?? "").replace(/\/$/, "");
    const workerToken = Deno.env.get("EMAIL_WORKER_TOKEN") ?? "";
    if (!workerUrl || !workerToken) return respond({ status: "asked", emailed: false });
    const sent = await fetch(`${workerUrl}/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ to, subject, html, text, lane: "outreach", category: "post_question" }),
    });
    if (!sent.ok) {
      console.error("ask-poster send failed", sent.status, (await sent.text()).slice(0, 200));
      return respond({ status: "asked", emailed: false });
    }
    await admin.from("post_questions").update({ emailed_at: new Date().toISOString() }).eq("id", rowId);
    return respond({ status: "asked", emailed: true });
  } catch (error) {
    console.error("ask-poster", error);
    return respond({ error: "Could not ask right now." }, 500);
  }
});
