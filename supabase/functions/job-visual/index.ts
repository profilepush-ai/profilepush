import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// Pictures for every match, made once per post and shared by all of its
// matches (see the match_visuals migration). Llama on Cloudflare writes the
// art direction from the post's own details and FLUX.2 on Cloudflare draws it.
//   A job: two versions of one scene, the same direction drawn with a woman
//   (a) and with a man (b), who never depend on the job's details.
//   A consultant profile: one picture with no person in it.
//
//   POST { drain: true }  (cron, every minute): draws the newest queued pictures.
//   POST { job_ids: string[], regenerate?: true }  (internal accounts): draws
//     those posts' pictures again, now.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Everything runs on Cloudflare Workers AI through our pp-image-worker.
const PROMPT_MODEL = "llama-3.3-70b";
// Drawn on Cloudflare Workers AI through our pp-image-worker (cloudflare/pp-image-worker).
const IMAGE_MODEL = "flux-2-klein-4b";
const BATCH = Number(Deno.env.get("JOB_VISUAL_BATCH") ?? "10") || 10;
// A ceiling on pictures a day, against a runaway loop (not a budget).
const DAILY_MAX = Number(Deno.env.get("JOB_VISUAL_DAILY_MAX") ?? "4000") || 0;

function respond(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, max = 10) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, max) : []);
const shuffle = <T,>(items: T[]) => items.map((v) => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

// Who a job's picture shows: version a from WOMEN, version b from MEN. Never
// chosen from the job's details, and a post's two versions always differ in
// skin tone, so no role gets one kind of face.
type Persona = { who: string; tone: string };
const WOMEN: Persona[] = [
  { who: "woman in her late 20s with curly dark hair, round glasses, light brown skin and a navy sweater", tone: "light brown" },
  { who: "woman in her 40s with a silver-streaked bob, light skin and a pale blue blazer", tone: "light" },
  { who: "East Asian woman in her 30s with long straight black hair and a pale blue jacket", tone: "east asian" },
  { who: "woman in her 20s with a short pink pixie cut, freckles, pale skin and a navy bomber jacket", tone: "light" },
  { who: "woman in her 30s wearing a patterned headscarf, with olive skin and a white top", tone: "olive" },
  { who: "woman in her 40s with braided hair, medium brown skin and a soft orange blouse", tone: "brown" },
  { who: "woman in her 50s with short grey curls, deep brown skin and a navy blazer", tone: "deep" },
  { who: "woman in her late 20s with a high ponytail, tan skin and an oversized pale blue sweater", tone: "tan" },
  { who: "woman in her 30s who uses a wheelchair, with wavy auburn hair, light skin and a denim shirt", tone: "light" },
  { who: "woman in her 20s with box braids, deep brown skin and a soft yellow hoodie", tone: "deep" },
  { who: "woman in her 60s with a white bun, reading glasses, tan skin and a navy cardigan", tone: "tan" },
  { who: "South Asian woman in her 30s with a long dark braid, brown skin and a soft yellow top", tone: "brown" },
];
const MEN: Persona[] = [
  { who: "man in his 30s with a short beard, warm brown skin and a denim jacket", tone: "brown" },
  { who: "man in his late 20s with locs tied back, deep brown skin and a soft orange hoodie", tone: "deep" },
  { who: "man in his 40s with salt-and-pepper hair, olive skin and a navy cardigan", tone: "olive" },
  { who: "man in his 30s with wavy hair, glasses, tan skin and a blue striped shirt", tone: "tan" },
  { who: "man in his 20s with a fade haircut, dark skin and a soft yellow windbreaker", tone: "deep" },
  { who: "man in his 30s with a turban, a neat beard, brown skin and a crisp white shirt", tone: "brown" },
  { who: "man in his 20s with messy red hair, pale skin and a navy turtleneck", tone: "light" },
  { who: "man in his 50s with a bald head, a grey goatee, light brown skin and a blue plaid shirt", tone: "light brown" },
  { who: "East Asian man in his 30s with short black hair and a blue bomber jacket", tone: "east asian" },
  { who: "man in his 40s with a hearing aid, a trimmed beard, light skin and a pale blue sweater", tone: "light" },
  { who: "man in his 20s with curly hair, a wide smile, tan skin and a white shirt", tone: "tan" },
  { who: "man in his 60s with white hair, a moustache, deep brown skin and a navy blazer", tone: "deep" },
];

// Pairs for a batch of jobs: fresh faces first (not in the last pictures
// made), never the same person twice in a batch.
async function personaPairs(admin: SupabaseClient, count: number): Promise<Array<{ a: Persona; b: Persona }>> {
  const { data } = await admin.from("match_visuals").select("persona").not("persona", "is", null)
    .order("updated_at", { ascending: false }).limit(16);
  const recent = new Set((data ?? []).map((r) => r.persona as string));
  const order = (pool: Persona[]) => [...shuffle(pool.filter((p) => !recent.has(p.who))), ...shuffle(pool.filter((p) => recent.has(p.who)))];
  let women = order(WOMEN);
  let men = order(MEN);
  const pairs: Array<{ a: Persona; b: Persona }> = [];
  for (let i = 0; i < count; i++) {
    if (women.length === 0) women = shuffle(WOMEN);
    const a = women.shift()!;
    if (men.length === 0) men = shuffle(MEN);
    const at = men.findIndex((m) => m.tone !== a.tone);
    const b = men.splice(at < 0 ? 0 : at, 1)[0];
    pairs.push({ a, b });
  }
  return pairs;
}

// Where the work happens, for the picture's background.
function workMode(place: string, text: string): string {
  if (/\bremote\b|anywhere/i.test(place)) return "remote";
  if (/\bhybrid\b/i.test(`${place} ${text}`)) return "hybrid";
  if (/\b(fully|100%|completely)\s+remote\b|location\s*[:-]?\s*remote\b|\bremote\s*\((us|usa|united states)\b/i.test(text)) return "remote";
  // A city wins over a stray "remote" in the post.
  if (place) return "onsite";
  return /\bremote\b|work from home|\bwfh\b/i.test(text) ? "remote" : "";
}

const STAND_INS = `Stand-ins to use when they fit: Java a steaming coffee cup; Spring or Spring Boot a green leaf; React a spinning atom with orbit rings; Angular a faceted shield crystal; Python a friendly coiled snake; JavaScript or TypeScript a bright lightning bolt; AWS, Azure or GCP a soft cloud; Docker a small whale carrying boxes; Kubernetes a ship's wheel; Terraform building blocks forming terrain; Kafka or streaming flowing ribbons; SQL or databases stacked cylinders; Snowflake a crystal snowflake; Spark or PySpark a sparkler; Tableau, Power BI or analytics a floating bar chart; Excel a green grid tile; security a padlock shield; testing or QA a magnifying glass; mobile a phone; AI or ML a soft brain shape; Agile or Scrum a sticky-note board; nursing or patient care a heart monitor line; finance a stack of coins; logistics a parcel on a conveyor. Invent equally simple stand-ins for anything else.`;

const PLACE = `The place is the whole background. If there is one location, the background is that city's most famous, instantly recognizable view: its skyline, a landmark or its landscape (for example Chicago's skyline over the lake, the Blue Ridge Mountains for Asheville, desert mountains and saguaros for Phoenix), at golden hour or dusk, a little soft so the foreground stands out. If the city has no famous view, use the best-known view of its region or state. For several locations, blend each city's landmark into one continuous skyline. Only when work_mode is "remote", a cozy home workspace with a big window onto that location's view (or a calm night city when there is no location); for "hybrid", the city's view seen through a home window. No signs with writing, no flags.`;

// Our brand colors, kept soft: calm on the eyes in a reel people watch for minutes.
const STYLE = `Style: stylized 3D art like a still from a modern animated film, with soft matte clay-like shading and gentle, diffused light. Colors only from the ProfilePush palette, kept subtle and low in saturation: deep navy #0B1A3A, ProfilePush blue #2563EB, pale blue #C8D7FA and warm white #F8FAFC, with small touches of sunflower yellow #FACC15 and orange #F97316, the place behind in the same soft palette at dusk. Objects are matte and softly lit, not glowing. No neon, no glow, no rim light, no oversaturated or clashing colors.`;

const JOB_DIRECTION = `You are the art director for ProfilePush's Today reel, where recruiters swipe through job matches like stories. Write ONE image prompt for a vertical poster that makes this job feel exciting and instantly clear at a glance.

The picture always has:
1. One persona: the professional who would do this job, waist-up, face clearly visible, expressive, confident and playful. The same scene is drawn twice with different people, so write the persona as the exact token [PERSONA] once (it is filled in later, as in "A confident [PERSONA], shown waist-up"). Never use he, she, his or her: say "they" or "the persona". Describe no other trait of the person.
2. The skills, held: three to five objects, each a playful visual stand-in for one of the job's most important skills. The persona really holds them: the most important one in one hand, another balanced on a fingertip or tucked under an arm, the rest orbiting close around them. Pick the skills a recruiter would recognize first, and skip soft skills (communication, empathy, listening, patience, teamwork): use the role's own tools instead (a nurse: a stethoscope and a heart-rate line; pediatrics: a small teddy bear). Draw each as an object, never as a logo, letter or brand mark. Name only the objects: never write a skill, tool or brand name anywhere in the prompt (not even in brackets), or the image model paints it as text. ${STAND_INS}
3. ${PLACE}
4. ${STYLE} Calm and uncluttered: the face and the held objects read first, the place right after.
5. The bottom third calm, plain and darker.
6. Nothing written anywhere and no logos, watermarks or real people; screens, notes and signs stay blank. Never use the words text, letters, words, captions or labels in the prompt, not even to forbid them: the image model draws whatever they name.

Reply with the prompt only, 110 to 170 words.`;

const PROFILE_DIRECTION = `You are the art director for ProfilePush's Today reel, where vendors swipe through consultant profiles matched to their jobs. Write ONE image prompt for a vertical poster that shows what this consultant brings, at a glance.

It stands for a real candidate, so it has NO people at all: no faces, figures, silhouettes, hands or body parts.

The picture always has:
1. The skills, on show: four to six objects, each a playful visual stand-in for one of the profile's most important skills, floating above a soft pedestal in the middle of the frame like a hero display. Pick the skills a recruiter would recognize first, and skip soft skills (communication, empathy, listening, patience, teamwork): use the role's own tools instead (a nurse: a stethoscope and a heart-rate line; pediatrics: a small teddy bear). Draw each as an object, never as a logo, letter or brand mark. Name only the objects: never write a skill, tool or brand name anywhere in the prompt (not even in brackets), or the image model paints it as text. ${STAND_INS}
2. ${PLACE} The locations are where this consultant is or will work.
3. ${STYLE} Calm and uncluttered: the objects read first, the place right after.
4. The bottom third calm, plain and darker.
5. Nothing written anywhere and no logos, watermarks or people; screens, notes and signs stay blank. Never use the words text, letters, words, captions or labels in the prompt, not even to forbid them: the image model draws whatever they name.

Reply with the prompt only, 90 to 150 words.`;

type Lead = { kind: "job" | "hotlist"; details: Record<string, unknown> };

async function loadLead(admin: SupabaseClient, kind: string, id: string): Promise<Lead | null> {
  if (kind === "job") {
    const { data: j } = await admin.from("social_jobs")
      .select("job_title, company_name, location, employment_type, salary_range, extracted_hourly_rate_max, extracted_skills, job_category, post_content")
      .eq("id", id).maybeSingle();
    if (!j) return null;
    return { kind: "job", details: {
      title: str(j.job_title, 200),
      company: str(j.company_name, 120),
      location: str(j.location, 160),
      work_mode: workMode(str(j.location, 160), `${str(j.job_title, 200)} ${str(j.post_content, 1500)}`),
      employment_type: str(j.employment_type, 60),
      pay: str(j.salary_range, 80) || (j.extracted_hourly_rate_max ? `$${j.extracted_hourly_rate_max}/hr` : ""),
      skills: list(j.extracted_skills),
      category: str(j.job_category, 30),
      post_excerpt: str(j.post_content, 700),
    } };
  }
  const { data: h } = await admin.from("social_hotlist")
    .select("role_title, core_skills, locations, years_experience, employment_type, candidate_summary, raw_post_content")
    .eq("id", id).maybeSingle();
  if (!h) return null;
  const locations = list(h.locations, 6).join(", ");
  return { kind: "hotlist", details: {
    role: str(h.role_title, 200),
    locations,
    work_mode: workMode(locations, `${str(h.role_title, 200)} ${str(h.candidate_summary, 800)}`),
    years: h.years_experience ?? null,
    employment_type: str(h.employment_type, 60),
    skills: list(h.core_skills),
    summary: str(h.candidate_summary, 500) || str(h.raw_post_content, 500),
  } };
}

// Skill stand-ins for the template below (the same ones the writer is given).
const OBJECTS: Array<[RegExp, string]> = [
  [/\bjava\b(?!script)/i, "a steaming coffee cup"], [/spring/i, "a green leaf"], [/react/i, "a spinning atom with orbit rings"],
  [/angular/i, "a faceted shield crystal"], [/python/i, "a friendly coiled snake"], [/javascript|typescript|node/i, "a bright lightning bolt"],
  [/aws|azure|gcp|cloud/i, "a soft cloud"], [/docker/i, "a small whale carrying boxes"], [/kubernetes|k8s/i, "a ship's wheel"],
  [/terraform|iac/i, "building blocks forming terrain"], [/kafka|stream/i, "flowing ribbons"], [/snowflake/i, "a crystal snowflake"],
  [/spark/i, "a sparkler"], [/sql|database|oracle|postgres|mongo/i, "stacked database cylinders"],
  [/tableau|power ?bi|analytic|report/i, "a floating bar chart"], [/excel/i, "a green grid tile"], [/secur|cyber/i, "a padlock shield"],
  [/test|qa\b|quality/i, "a magnifying glass"], [/mobile|ios|android/i, "a phone"], [/\bai\b|ml\b|machine learning/i, "a soft brain shape"],
  [/agile|scrum|jira/i, "a sticky-note board"], [/nurs|patient|rn\b|clinical/i, "a heart monitor line"], [/financ|account/i, "a stack of coins"],
  [/logistic|supply/i, "a parcel on a conveyor"], [/servicenow|itsm/i, "a service ticket"],
];

// Without the writer (busy or down): the same rules, filled in.
function templatePrompt(lead: Lead): string {
  const d = lead.details;
  const skills = (d.skills as string[]).slice(0, 4);
  const objects = [...new Set(skills.map((k) => OBJECTS.find(([re]) => re.test(k))?.[1] ?? `an object that stands for ${k}`))];
  const place = String(lead.kind === "job" ? d.location : d.locations ?? "");
  // Several cities: more than one part that isn't a two-letter state code.
  const several = place.split(/[;,]/).map((x) => x.trim()).filter((x) => x.length > 2).length > 1;
  const background = d.work_mode === "remote"
    ? `a cozy home workspace with a big window onto ${place ? `the famous view of ${place}` : "a calm night city"}`
    : place
      ? several
        ? `one continuous skyline blending the most famous landmarks of ${place}, at golden hour, a little soft`
        : `the most famous, instantly recognizable view of ${place} (its skyline, a landmark or its landscape), at golden hour, a little soft`
      : "a smooth gradient in bold colors";
  const things = objects.length ? objects.join(", ") : "objects that stand for the work";
  const style = `${STYLE} The bottom third calm, plain and darker. Nothing written anywhere, no logos or real people; screens and signs stay blank.`;
  return lead.kind === "job"
    ? `Vertical poster for a ${String(d.title || "job")} job. A confident, playful [PERSONA], shown waist-up, face clearly visible and expressive, really holding objects for the job's skills: ${things}; the most important one in one hand, the rest orbiting close. The background is ${background}. ${style}`
    : `Vertical poster for a ${String(d.role || "consultant")} profile, with no people at all. Objects for the profile's skills, ${things}, float above a soft pedestal in the middle like a hero display. The background is ${background}. ${style}`;
}

// One art direction per post. One that stops short (no background yet) gets
// one more try; if the writer can't answer, the template.
async function writePrompt(lead: Lead): Promise<{ prompt: string; by: string }> {
  try {
    return { prompt: await askWriter(lead), by: PROMPT_MODEL };
  } catch (error) {
    if (error instanceof RateLimited) throw error;
    console.warn("job-visual: writer unavailable, using the template", (error as Error).message?.slice(0, 120));
    return { prompt: templatePrompt(lead), by: "template" };
  }
}

// The gateway worker: /chat writes text, / draws, both behind one secret.
function worker(path: string, body: unknown) {
  return fetch(`${(Deno.env.get("IMAGE_WORKER_URL") ?? "").replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("IMAGE_WORKER_SECRET") ?? ""}`,
      "Content-Type": "application/json",
      "User-Agent": "ProfilePush-job-visual/1.0",
    },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify(body),
  });
}

async function askWriter(lead: Lead): Promise<string> {
  const job = lead.kind === "job";
  let text = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await worker("/chat", {
      system: job ? JOB_DIRECTION : PROFILE_DIRECTION,
      prompt: `${job ? "Job" : "Profile"} details:\n${JSON.stringify(lead.details, null, 2)}`,
      max_tokens: 700,
    });
    if (res.status === 429) throw new RateLimited(`Writer busy: ${(await res.text()).slice(0, 200)}`);
    if (!res.ok) throw new Error(`Writer: ${res.status} ${(await res.text()).slice(0, 200)}`);
    // The image model paints what a prompt names: words in brackets ("a
    // coffee cup (Java)") and any sentence about text or labels come out.
    text = String(((await res.json()) as { text?: unknown }).text ?? "").trim().replace(/^["']|["']$/g, "").replace(/\s*\([^)]*\)/g, "")
      .split(/(?<=[.!?])\s+/).filter((sentence) => !/\b(text|texts|caption|letters?|words?|labels?|typography|overlay|writing)\b/i.test(sentence)).join(" ");
    if (text.length >= (job ? 600 : 450) && (!job || text.includes("[PERSONA]"))) return text;
    console.warn("job-visual short prompt", text.length);
  }
  if (text.length < 40) throw new Error("The art direction came back empty.");
  return job && !text.includes("[PERSONA]") ? `A confident [PERSONA], shown waist-up. ${text}` : text;
}

class RateLimited extends Error {}

// reference: a user's avatar, whose person the picture keeps.
async function drawImage(prompt: string, reference?: string): Promise<{ bytes: Uint8Array; type: string }> {
  const res = await worker("/draw", { prompt, width: 704, height: 1056, ...(reference ? { reference } : {}) });
  if (res.status === 429) throw new RateLimited(`Image model busy: ${(await res.text()).slice(0, 200)}`);
  const type = res.headers.get("Content-Type") ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new Error(`Image model: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type };
}

type Row = { lead_id: string; variant: "a" | "b"; lead_kind: "job" | "hotlist"; attempts: number };

// Draws claimed rows: one art direction per post, then each version.
async function draw(admin: SupabaseClient, rows: Row[]) {
  const byLead = new Map<string, Row[]>();
  for (const r of rows) byLead.set(r.lead_id, [...(byLead.get(r.lead_id) ?? []), r]);
  const pairs = await personaPairs(admin, byLead.size);
  const tally = { done: 0, failed: 0, requeued: 0 };
  const now = () => new Date().toISOString();

  await Promise.all([...byLead.entries()].map(async ([leadId, versions], i) => {
    const fail = async (r: Row, error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      // Busy (either model's rate limit): back in the queue, no try used up.
      if (error instanceof RateLimited || (error as { status?: number } | null)?.status === 429) {
        tally.requeued++;
        await admin.from("match_visuals").update({ status: "queued", attempts: Math.max(0, r.attempts - 1), error: message.slice(0, 500), updated_at: now() })
          .eq("lead_id", r.lead_id).eq("variant", r.variant);
        return;
      }
      tally.failed++;
      console.error("job-visual", leadId, r.variant, message);
      await admin.from("match_visuals").update({ status: "failed", error: message.slice(0, 500), updated_at: now() })
        .eq("lead_id", r.lead_id).eq("variant", r.variant);
    };
    let template: string;
    let by: string;
    try {
      const lead = await loadLead(admin, versions[0].lead_kind, leadId);
      if (!lead) {
        // The post is gone: nothing to draw, no retries.
        await admin.from("match_visuals").update({ status: "failed", attempts: 3, error: "Post not found.", updated_at: now() }).eq("lead_id", leadId);
        tally.failed += versions.length;
        return;
      }
      ({ prompt: template, by } = await writePrompt(lead));
    } catch (error) {
      for (const r of versions) await fail(r, error);
      return;
    }
    await Promise.all(versions.map(async (r) => {
      try {
        const persona = r.lead_kind === "job" ? pairs[i][r.variant].who : null;
        const prompt = persona ? template.replaceAll("[PERSONA]", persona) : template;
        await admin.from("match_visuals").update({ persona, updated_at: now() }).eq("lead_id", r.lead_id).eq("variant", r.variant);
        const { bytes, type } = await drawImage(prompt);
        const path = `${leadId}-${r.variant}.${type.includes("webp") ? "webp" : "jpg"}`;
        const { error: upErr } = await admin.storage.from("job-visuals").upload(path, bytes, { contentType: type, upsert: true });
        if (upErr) throw new Error(upErr.message);
        const url = `${admin.storage.from("job-visuals").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
        await admin.from("match_visuals").update({ status: "done", url, prompt, template: r.lead_kind === "job" ? template : null, error: null, model: `${by} + ${IMAGE_MODEL}`, updated_at: now() })
          .eq("lead_id", r.lead_id).eq("variant", r.variant);
        tally.done++;
      } catch (error) {
        await fail(r, error);
      }
    }));
  }));
  return tally;
}

// A viewer's own picture of a job: the job's scene with their avatar as the
// person (match_visuals_me). The scene is the one already written for the
// job when there is one.
type MyRow = { lead_id: string; user_id: string; attempts: number };
const AS_AVATAR = "the character from the reference image, with exactly the same face, hair, skin tone and glasses";

async function drawMine(admin: SupabaseClient, rows: MyRow[]) {
  const tally = { done: 0, failed: 0, requeued: 0 };
  const now = () => new Date().toISOString();
  const users = [...new Set(rows.map((r) => r.user_id))];
  const { data: avatars } = await admin.from("user_avatars").select("user_id, url").in("user_id", users).eq("status", "active");
  const avatarOf = new Map((avatars ?? []).map((a) => [a.user_id as string, a.url as string]));
  const leads = [...new Set(rows.map((r) => r.lead_id))];
  const { data: scenes } = await admin.from("match_visuals").select("lead_id, template").in("lead_id", leads).not("template", "is", null);
  const sceneOf = new Map((scenes ?? []).map((v) => [v.lead_id as string, v.template as string]));
  await Promise.all(rows.map(async (r) => {
    const set = (patch: Record<string, unknown>) => admin.from("match_visuals_me").update({ ...patch, updated_at: now() }).eq("lead_id", r.lead_id).eq("user_id", r.user_id);
    try {
      const avatar = avatarOf.get(r.user_id);
      if (!avatar) { await set({ status: "failed", attempts: 3, error: "No active avatar." }); tally.failed++; return; }
      let template = sceneOf.get(r.lead_id);
      if (!template) {
        const lead = await loadLead(admin, "job", r.lead_id);
        if (!lead) { await set({ status: "failed", attempts: 3, error: "Post not found." }); tally.failed++; return; }
        template = (await writePrompt(lead)).prompt;
      }
      const prompt = template.replaceAll("[PERSONA]", AS_AVATAR);
      const { bytes, type } = await drawImage(prompt, avatar);
      // An unguessable path: these pictures show a real person's likeness.
      const path = `me/${crypto.randomUUID()}.${type.includes("webp") ? "webp" : "jpg"}`;
      const { error: upErr } = await admin.storage.from("job-visuals").upload(path, bytes, { contentType: type });
      if (upErr) throw new Error(upErr.message);
      const { data: old } = await admin.from("match_visuals_me").select("url").eq("lead_id", r.lead_id).eq("user_id", r.user_id).maybeSingle();
      await set({ status: "done", url: admin.storage.from("job-visuals").getPublicUrl(path).data.publicUrl, prompt, error: null });
      const stale = (old?.url as string | undefined)?.split("/job-visuals/")[1]?.split("?")[0];
      if (stale) await admin.storage.from("job-visuals").remove([stale]);
      tally.done++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RateLimited) { tally.requeued++; await set({ status: "queued", attempts: Math.max(0, r.attempts - 1), error: message.slice(0, 500) }); return; }
      tally.failed++;
      console.error("job-visual mine", r.lead_id, message);
      await set({ status: "failed", error: message.slice(0, 500) });
    }
  }));
  return tally;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  try {
    // The queue: only what matches have queued, so it needs no secret.
    if (body.drain === true) {
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      const { count } = await admin.from("match_visuals").select("lead_id", { count: "exact", head: true })
        .eq("status", "done").gte("updated_at", dayStart.toISOString());
      const room = DAILY_MAX > 0 ? Math.min(BATCH, DAILY_MAX - (count ?? 0)) : BATCH;
      if (room <= 0) return respond({ paused: "daily_max", made_today: count });
      // Up to a third of each run goes to people's own avatar pictures.
      const { data: mine, error: mineErr } = await admin.rpc("claim_my_visuals", { p_limit: Math.max(1, Math.ceil(room / 3)) });
      if (mineErr) throw mineErr;
      const { data: rows, error } = await admin.rpc("claim_match_visuals", { p_limit: Math.max(1, room - (mine?.length ?? 0)) });
      if (error) throw error;
      if (!rows?.length && !mine?.length) return respond({ idle: true });
      const [shared, own] = await Promise.all([
        rows?.length ? draw(admin, rows as Row[]) : null,
        mine?.length ? drawMine(admin, mine as MyRow[]) : null,
      ]);
      return respond({ claimed: (rows?.length ?? 0) + (mine?.length ?? 0), shared, own });
    }

    // Internal accounts: draw these posts' pictures again, now.
    const authHeader = req.headers.get("Authorization") ?? "";
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);
    const { data: member } = await admin.from("account_members").select("account_id, accounts(is_internal)")
      .eq("user_id", user.id).eq("status", "active").order("created_at").limit(1).maybeSingle();
    if (!(member as { accounts?: { is_internal?: boolean } } | null)?.accounts?.is_internal) return respond({ error: "Internal accounts only." }, 403);
    const ids = [...new Set((Array.isArray(body.job_ids) ? body.job_ids : []).map(String).filter((id) => UUID.test(id)))].slice(0, 3);
    if (ids.length === 0) return respond({ visuals: {} });
    const { data: jobs } = await admin.from("social_jobs").select("id").in("id", ids);
    const isJob = new Set((jobs ?? []).map((j) => j.id as string));
    const rows: Row[] = ids.flatMap((id) => {
      const variants: Array<"a" | "b"> = isJob.has(id) ? ["a", "b"] : ["a"];
      return variants.map((variant) => ({ lead_id: id, variant, lead_kind: isJob.has(id) ? "job" : "hotlist", attempts: 1 }));
    });
    await admin.from("match_visuals").upsert(rows.map((r) => ({ ...r, status: "pending", error: null, updated_at: new Date().toISOString() })));
    const tally = await draw(admin, rows);
    const { data: made } = await admin.from("match_visuals").select("lead_id, variant, status, url").in("lead_id", ids);
    return respond({ ...tally, visuals: made ?? [] });
  } catch (error) {
    console.error("job-visual", error);
    return respond({ error: "Could not make the pictures right now." }, 500);
  }
});
