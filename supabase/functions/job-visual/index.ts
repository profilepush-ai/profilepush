import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";

// A picture for every job, made from its own details. Claude writes the art
// direction (a persona doing this job, in this place, with this job's tools
// as simple props) and the image model draws it. Stored once per job in the
// public job-visuals bucket and recorded in job_visuals.
//
//   POST { job_ids: string[], regenerate?: true }  (up to 3; Today asks a few
//   cards ahead; regenerate redoes existing pictures, internal accounts only)
//   -> { visuals: { [job_id]: { status: "done" | "pending" | "failed" | "off", url?: string } } }
//
// Spend: at most JOB_VISUAL_DAILY_CAP new images a day across everyone
// (0, the default, turns it off). Internal accounts can always make previews.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROMPT_MODEL = "claude-sonnet-5-5";
const IMAGE_MODEL = "gpt-image-1";

function respond(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Who the picture shows. Varied on purpose, and never chosen from the job's
// details, so no role gets one kind of face. Outfits differ too, so two
// pictures side by side don't read as the same person.
const PERSONAS = [
  "a woman in her late 20s with curly dark hair, round glasses and a mustard sweater",
  "a man in his 30s with a short beard, warm brown skin and a denim jacket",
  "a woman in her 40s with a silver-streaked bob, light skin and a teal blazer",
  "a man in his late 20s with locs tied back, deep brown skin and an orange hoodie",
  "a woman in her 30s with long straight black hair, a bright smile and a red jacket",
  "a man in his 40s with salt-and-pepper hair, olive skin and a navy cardigan",
  "a woman in her 20s with a short pink pixie cut, freckles and a green bomber jacket",
  "a man in his 30s with wavy hair, glasses, tan skin and a striped shirt",
  "a woman in her 30s wearing a patterned headscarf, a confident smile and a lilac top",
  "a man in his 20s with a fade haircut, dark skin and a yellow windbreaker",
  "a woman in her 40s with braided hair, medium brown skin and a coral blouse",
  "a man in his 30s with a turban, a neat beard and a crisp white shirt",
  "a woman in her 50s with short grey curls, brown skin and a cobalt blazer",
  "a man in his 20s with messy red hair, pale skin and a black turtleneck",
  "a woman in her late 20s with a high ponytail, East Asian features and an oversized purple sweater",
  "a man in his 50s with a bald head, a grey goatee, light brown skin and a plaid shirt",
];
const shuffle = <T,>(list: T[]) => list.map((v) => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

// One persona per picture, avoiding the ones the last few pictures used.
async function pickPersonas(admin: SupabaseClient, count: number): Promise<string[]> {
  const { data } = await admin.from("job_visuals").select("persona").not("persona", "is", null)
    .order("updated_at", { ascending: false }).limit(8);
  const recent = new Set((data ?? []).map((r) => r.persona as string));
  const fresh = shuffle(PERSONAS.filter((p) => !recent.has(p)));
  return [...fresh, ...shuffle(PERSONAS.filter((p) => recent.has(p)))].slice(0, count);
}

// Where the job happens, for the picture's background.
function workMode(job: Record<string, unknown>): string {
  const place = str(job.location, 160);
  const text = `${str(job.job_title, 200)} ${str(job.post_content, 1500)}`;
  if (/\bremote\b|anywhere/i.test(place)) return "remote";
  if (/\bhybrid\b/i.test(`${place} ${text}`)) return "hybrid";
  if (/\b(fully|100%|completely)\s+remote\b|location\s*[:-]?\s*remote\b|\bremote\s*\((us|usa|united states)\b/i.test(text)) return "remote";
  // A city wins over a stray "remote" in the post.
  if (place) return "onsite";
  return /\bremote\b|work from home|\bwfh\b/i.test(text) ? "remote" : "";
}

const DIRECTION = `You are the art director for ProfilePush's Today reel, where recruiters swipe through job matches like stories. Write ONE image prompt for a vertical poster that makes this job feel exciting and instantly clear at a glance.

The picture always has:
1. One persona: the professional who would do this job, waist-up, face clearly visible, confident and playful. Use the persona you are given exactly.
2. The skills, held: three to five glowing 3D objects, each a playful visual stand-in for one of the job's most important skills. The persona really holds them: the most important one in one hand, another balanced on a fingertip or tucked under an arm, the rest orbiting close around them. Pick the skills a recruiter would recognize first. Draw each as an object, never as a logo, letter or brand mark. Stand-ins to use when they fit: Java a steaming coffee cup; Spring or Spring Boot a glowing green leaf; React a spinning atom with orbit rings; Angular a faceted shield crystal; Python a friendly coiled snake; JavaScript or TypeScript a bright lightning bolt; AWS, Azure or GCP a glowing cloud; Docker a small whale carrying boxes; Kubernetes a ship's wheel; Terraform building blocks forming terrain; Kafka or streaming flowing light ribbons; SQL or databases stacked glowing cylinders; Snowflake a crystal snowflake; Spark or PySpark a sparkler; Tableau, Power BI or analytics a floating bar chart; Excel a green grid tile; security a padlock shield; testing or QA a magnifying glass; mobile a glowing phone; AI or ML a brain made of light; Agile or Scrum a sticky-note board; nursing or patient care a heart monitor line; finance a stack of coins; logistics a parcel on a conveyor. Invent equally simple stand-ins for anything else.
3. The place is the whole background. If the job has one location, the background is that city's most famous, instantly recognizable view: its skyline, a landmark or its landscape (for example Chicago's skyline over the lake, the Blue Ridge Mountains for Asheville, desert mountains and saguaros for Phoenix), at golden hour or dusk, a little soft so the persona stands out. If the city has no famous view, use the best-known view of its region or state. For several locations, blend each city's landmark into one continuous skyline behind the persona. Only when work_mode is "remote", a cozy home workspace with a big window onto that location's view (or a glowing night city when there is no location); for "hybrid", the city's view seen through a home window. No signs with writing, no flags.
4. Style: stylized 3D character art like a still from a modern animated film. Soft clay-like shading, expressive face, bold saturated colors, neon rim light, glossy sticker-like objects, and the place behind in the same stylized look with colors that suit the role. Energetic but uncluttered: the face and the held objects read first, the place right after.
5. The bottom third calm and darker so text can sit on it.
6. No text, letters, numbers, logos, watermarks or real people anywhere; screens, notes and signs stay blank of writing.

Reply with the prompt only, 110 to 170 words.`;

async function writePrompt(job: Record<string, unknown>, persona: string): Promise<string> {
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "" });
  const details = {
    title: str(job.job_title, 200),
    company: str(job.company_name, 120),
    location: str(job.location, 160),
    work_mode: workMode(job),
    employment_type: str(job.employment_type, 60),
    pay: str(job.salary_range, 80) || (job.extracted_hourly_rate_max ? `$${job.extracted_hourly_rate_max}/hr` : ""),
    skills: Array.isArray(job.extracted_skills) ? (job.extracted_skills as unknown[]).filter((s) => typeof s === "string").slice(0, 10) : [],
    category: str(job.job_category, 30),
    post_excerpt: str(job.post_content, 700),
  };
  // A prompt that stops short (no background yet) gets one more try.
  let text = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const message = await client.messages.create({
      model: PROMPT_MODEL,
      max_tokens: 700,
      system: DIRECTION,
      messages: [{ role: "user", content: `Persona: ${persona}\n\nJob details:\n${JSON.stringify(details, null, 2)}` }],
    });
    if (message.stop_reason === "refusal") throw new Error("Claude declined to describe this job.");
    text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (message.stop_reason === "end_turn" && text.length >= 600) return text;
    console.warn("job-visual short prompt", message.stop_reason, text.length);
  }
  if (text.length < 40) throw new Error("The art direction came back empty.");
  return text;
}

async function drawImage(prompt: string): Promise<Uint8Array> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY") ?? ""}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: IMAGE_MODEL, prompt, n: 1, size: "1024x1536",
      quality: Deno.env.get("JOB_VISUAL_QUALITY") || "medium",
      output_format: "webp", output_compression: 80,
    }),
  });
  const json = await res.json().catch(() => ({}));
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`Image model: ${res.status} ${JSON.stringify(json?.error ?? json).slice(0, 200)}`);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function makeVisual(admin: SupabaseClient, jobId: string, userId: string, persona: string) {
  const { data: job } = await admin.from("social_jobs")
    .select("job_title, company_name, location, employment_type, salary_range, extracted_hourly_rate_max, extracted_skills, job_category, post_content")
    .eq("id", jobId).maybeSingle();
  if (!job) return { status: "failed" as const };
  await admin.from("job_visuals").upsert({ job_id: jobId, status: "pending", requested_by: userId, persona, error: null, updated_at: new Date().toISOString() });
  try {
    const prompt = await writePrompt(job, persona);
    const bytes = await drawImage(prompt);
    const path = `${jobId}.webp`;
    const { error: upErr } = await admin.storage.from("job-visuals").upload(path, bytes, { contentType: "image/webp", upsert: true });
    if (upErr) throw new Error(upErr.message);
    const url = admin.storage.from("job-visuals").getPublicUrl(path).data.publicUrl;
    await admin.from("job_visuals").update({ status: "done", url, prompt, model: `${PROMPT_MODEL} + ${IMAGE_MODEL}`, updated_at: new Date().toISOString() }).eq("job_id", jobId);
    return { status: "done" as const, url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("job-visual", jobId, message);
    await admin.from("job_visuals").update({ status: "failed", error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("job_id", jobId);
    return { status: "failed" as const };
  }
}

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
    if (!user) return respond({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const ids = [...new Set((Array.isArray(body.job_ids) ? body.job_ids : []).map(String).filter((id) => UUID.test(id)))].slice(0, 3);
    // Internal accounts can redo a picture (to compare art directions).
    const regenerate = body.regenerate === true;
    if (ids.length === 0) return respond({ visuals: {} });

    const { data: member } = await admin.from("account_members").select("account_id, accounts(is_internal)")
      .eq("user_id", user.id).eq("status", "active").order("created_at").limit(1).maybeSingle();
    const internal = Boolean((member as { accounts?: { is_internal?: boolean } } | null)?.accounts?.is_internal);

    const visuals: Record<string, { status: string; url?: string }> = {};
    const { data: existing } = await admin.from("job_visuals").select("job_id, status, url, updated_at").in("job_id", ids);
    const todo: string[] = [];
    for (const id of ids) {
      const row = regenerate && internal ? undefined : (existing ?? []).find((r) => r.job_id === id);
      const age = row ? Date.now() - new Date(row.updated_at).getTime() : Infinity;
      if (row?.status === "done") visuals[id] = { status: "done", url: row.url };
      else if (row?.status === "pending" && age < 5 * 60_000) visuals[id] = { status: "pending" };
      else if (row?.status === "failed" && age < 6 * 3_600_000) visuals[id] = { status: "failed" };
      else todo.push(id);
    }
    if (todo.length === 0) return respond({ visuals });

    // The day's budget across everyone; internal accounts aren't limited by it.
    const cap = Number(Deno.env.get("JOB_VISUAL_DAILY_CAP") ?? "0") || 0;
    let room = todo.length;
    if (!internal) {
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      const { count } = await admin.from("job_visuals").select("job_id", { count: "exact", head: true })
        .in("status", ["done", "pending"]).gte("created_at", dayStart.toISOString());
      room = Math.max(0, cap - (count ?? 0));
    }
    const go = todo.slice(0, room);
    for (const id of todo.slice(room)) visuals[id] = { status: "off" };
    const personas = await pickPersonas(admin, go.length);
    const made = await Promise.all(go.map((id, i) => makeVisual(admin, id, user.id, personas[i])));
    go.forEach((id, i) => { visuals[id] = made[i]; });
    return respond({ visuals });
  } catch (error) {
    console.error("job-visual", error);
    return respond({ error: "Could not make the picture right now." }, 500);
  }
});
