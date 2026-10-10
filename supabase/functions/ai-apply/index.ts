import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// AI Apply, for the ProfilePush Apply Chrome extension (see the ai_apply
// migration). The extension sends a career site's form fields; we answer
// them from the chosen profile: names and the resume by rule, everything
// else with Llama on Cloudflare (through pp-image-worker). Never invents
// facts: what the profile doesn't say is left for the user. Only a fill the
// AI answered questions for is charged.
//
//   POST { action: "profiles" }  -> { profiles, balance, balance_label }
//   POST { action: "fill", subject_id, url, title, fields: Field[] }
//     -> { answers: { key: value }, unanswered: string[], resume, charged, balance_label }
//   402 when the account has no credits (₹1 = 4 credits per application).

type Field = { key: string; type: string; label: string; required?: boolean; options?: string[]; name?: string; autocomplete?: string; accept?: string };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const respond = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const PRICE = 4;
const left = (balance: number) => `${Math.floor(balance / PRICE).toLocaleString("en-IN")} AI applies left`;

const SYSTEM = `You fill in job application forms for a job seeker, using only the facts given about them. For each field, give the value to enter.
Rules:
- For select, radio and listbox fields, answer with exactly one of the field's options, word for word, or "" if none fits.
- For checkboxes answer "yes" or "no"; agree to a privacy policy or terms checkbox ("yes").
- Never invent facts. If the facts don't cover a field (email, phone, street address, date of birth, SSN, salary history, references, employer names, schools, dates), answer "".
- Work authorization and sponsorship come from the visa: US citizens and green card holders are authorized and need no sponsorship now or later; H-1B holders are authorized and will need sponsorship; H4, L2 or GC EAD, OPT and CPT holders are authorized now, but leave any question about needing sponsorship (now or in the future) as "" for them to answer; if the visa is unknown, answer "".
- Questions about gender, race, ethnicity, veteran status or disability: pick the option that declines to answer (such as "I don't wish to answer"), or "".
- "How did you hear about us": pick "Job board" or "Other" if offered.
- Years of experience with a skill: use the years given when the skill is in their skills, otherwise "".
- Short written answers (why this role, about you, cover note): two or three plain sentences in the first person, specific to their skills and this job, no buzzwords.
Reply with JSON only: {"answers": {"<key>": "<value>"}}`;

async function ask(system: string, prompt: string): Promise<Record<string, string>> {
  const res = await fetch(`${(Deno.env.get("IMAGE_WORKER_URL") ?? "").replace(/\/$/, "")}/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("IMAGE_WORKER_SECRET") ?? ""}`, "Content-Type": "application/json", "User-Agent": "ProfilePush-ai-apply/1.0" },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ system, prompt, max_tokens: 3000, json: true }),
  });
  if (!res.ok) throw new Error(`Answering failed (${res.status})`);
  const text = String(((await res.json()) as { text?: unknown }).text ?? "");
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { answers?: Record<string, unknown> };
  return Object.fromEntries(Object.entries(json.answers ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)]));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return respond({ error: "Please connect ProfilePush again." }, 401);
  const { data: account } = await admin.rpc("publisher_account_for_user", { p_user_id: user.id });
  if (!account) return respond({ error: "No ProfilePush account." }, 403);
  const balanceOf = async () => Number((await admin.from("accounts").select("credits_balance").eq("id", account).maybeSingle()).data?.credits_balance ?? 0);
  const body = await req.json().catch(() => ({})) as { action?: string; subject_id?: string; url?: string; title?: string; fields?: Field[] };

  try {
    if (body.action === "profiles") {
      const { data: rows } = await admin.from("social_hotlist")
        .select("id, candidate_name, role_title, created_at")
        .eq("created_by_account_id", account).eq("post_source", "user_post").is("hidden_at", null)
        .order("created_at", { ascending: false }).limit(100);
      const ids = (rows ?? []).map((r) => r.id as string);
      const { data: resumes } = ids.length ? await admin.from("hotlist_resumes").select("hotlist_id, url").in("hotlist_id", ids) : { data: [] };
      const hasResume = new Set((resumes ?? []).map((r) => r.hotlist_id as string));
      const balance = await balanceOf();
      return respond({
        profiles: (rows ?? []).map((r) => ({ id: r.id, name: r.candidate_name || r.role_title || "Profile", title: r.role_title, resume: hasResume.has(r.id as string) })),
        balance, balance_label: left(balance),
      });
    }

    if (body.action !== "fill") return respond({ error: "Unknown action." }, 400);
    const fields = (Array.isArray(body.fields) ? body.fields : []).slice(0, 120);
    if (!body.subject_id || fields.length === 0) return respond({ error: "Pick a profile and open the application form." }, 400);
    const { data: p } = await admin.from("social_hotlist")
      .select("id, candidate_name, role_title, core_skills, years_experience, visa_type, locations, hourly_rate_min, hourly_rate_max, employment_type, candidate_summary, created_by_account_id")
      .eq("id", body.subject_id).maybeSingle();
    if (!p || p.created_by_account_id !== account) return respond({ error: "That profile isn't in your account." }, 403);
    const origin = (() => { try { return new URL(String(body.url)).origin; } catch { return "unknown"; } })();

    // No credits and no charge for this site in the last 6 hours: stop before any work.
    const { data: recent } = await admin.from("ai_apply_log").select("id").eq("subject_id", p.id).eq("origin", origin).eq("charged", true)
      .gte("created_at", new Date(Date.now() - 6 * 3600_000).toISOString()).limit(1);
    if (!recent?.length && (await balanceOf()) < PRICE) return respond({ error: "no_credits", balance_label: left(await balanceOf()) }, 402);

    const { data: resume } = await admin.from("hotlist_resumes").select("url, file_name").eq("hotlist_id", p.id).maybeSingle();
    const name = String(p.candidate_name ?? "").trim();
    const [first, ...rest] = name.split(/\s+/);

    // By rule: names and the resume.
    const answers: Record<string, string> = {};
    const forAi: Field[] = [];
    for (const f of fields) {
      const label = `${f.label} ${f.name ?? ""} ${f.autocomplete ?? ""}`.toLowerCase();
      if (f.type === "file") { if (/resume|cv|curriculum/.test(label) || /pdf|doc/.test(f.accept ?? "") || !label.trim()) answers[f.key] = resume?.url ? "RESUME" : ""; continue; }
      if (name && /first.?name|given.?name|fname/.test(label)) { answers[f.key] = first; continue; }
      if (name && rest.length && /last.?name|surname|family.?name|lname/.test(label)) { answers[f.key] = rest.join(" "); continue; }
      if (name && /^(full )?name\b|legal name|your name/.test(f.label.toLowerCase().trim())) { answers[f.key] = name; continue; }
      forAi.push({ ...f, options: f.options?.slice(0, 40) });
    }

    // The rest with Llama on Cloudflare.
    let byAi = 0;
    if (forAi.length) {
      const facts = {
        name, current_title: p.role_title, years_experience: p.years_experience, skills: p.core_skills, visa: p.visa_type,
        locations: p.locations, hourly_rate: p.hourly_rate_min ? `$${p.hourly_rate_min}${p.hourly_rate_max ? `-${p.hourly_rate_max}` : ""}/hr` : null,
        employment_type: p.employment_type, summary: String(p.candidate_summary ?? "").slice(0, 1200),
      };
      const prompt = `Job page: ${String(body.title ?? "").slice(0, 200)} (${origin})\n\nFacts about the job seeker:\n${JSON.stringify(facts, null, 1)}\n\nForm fields:\n${JSON.stringify(forAi.map(({ key, type, label, required, options }) => ({ key, type, label, required, options })), null, 1)}`;
      const ai = await ask(SYSTEM, prompt);
      const valid = new Map(forAi.map((f) => [f.key, f]));
      for (const [key, value] of Object.entries(ai)) {
        const f = valid.get(key);
        if (!f || !value) continue;
        // Choices must be one of the options.
        if (f.options?.length && !f.options.some((o) => o.toLowerCase() === value.toLowerCase())) continue;
        answers[key] = value.slice(0, 2000);
        byAi++;
      }
    }

    const answered = Object.values(answers).filter(Boolean).length;
    // ₹1 only when the AI answered questions; names and the resume are free.
    const charge = byAi > 0
      ? (await admin.rpc("charge_ai_apply", { p_account: account, p_user: user.id, p_subject: p.id, p_origin: origin })).data as { ok: boolean; charged: boolean; balance: number }
      : { ok: true, charged: false, balance: await balanceOf() };
    if (!charge?.ok) return respond({ error: "no_credits", balance_label: left(Number(charge?.balance ?? 0)) }, 402);
    await admin.from("ai_apply_log").insert({ account_id: account, user_id: user.id, subject_id: p.id, origin, url: String(body.url ?? "").slice(0, 500), fields: fields.length, answered, charged: charge.charged });

    return respond({
      answers,
      unanswered: fields.filter((f) => !answers[f.key] && f.required).map((f) => f.label || f.name || "A field"),
      resume: resume?.url ? { url: resume.url, file_name: resume.file_name } : null,
      charged: charge.charged,
      balance_label: left(Number(charge.balance ?? 0)),
    });
  } catch (error) {
    console.error("ai-apply", error);
    return respond({ error: "Could not work out the answers right now. Try again." }, 500);
  }
});
