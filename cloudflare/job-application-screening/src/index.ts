// Public (no-login) AI video screening flow for a candidate submitted via
// SubmitApplicationModal. Every route here is reachable by an anonymous
// browser — the ONLY thing standing in for auth is the unguessable
// job_applications.screening_token in the URL, same trust model this app's
// /onboard/:token flow already uses. Talks to Supabase via the service role
// key (bypassing RLS, same as other backend-only workers in this repo) and
// to the social-job-parser Worker's /generate-screening-question route for
// the actual Workers AI calls (that Worker already owns the AI binding and
// the JSON-parsing/retry helpers — this Worker orchestrates, it doesn't
// duplicate the AI plumbing).
//
// NOTE: the Cloudflare Stream captions polling in handleAnswer() is built
// from Cloudflare's documented API shapes (POST .../captions/{lang}/generate
// returns {status: "inprogress"|"ready"|"error"}, GET .../captions/{lang}/vtt
// returns WebVTT text) but has not been exercised against a real recorded
// video yet — treat the first live run as the actual verification step.

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_STREAM_API_TOKEN: string;
  CLOUDFLARE_WORKER_URL: string;
  CLOUDFLARE_WORKER_TOKEN?: string;
  MAX_SCREENING_TURNS?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Supabase REST (service role — bypasses RLS, same pattern other workers
// in this repo use for their own tables) ────────────────────────────────────
async function supabaseRest(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: init.method === "PATCH" || init.method === "POST" ? "return=representation" : "",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

type ApplicationRow = {
  id: string;
  social_job_id: string;
  candidate_name: string;
  status: string;
  resume_parsed_json: Record<string, unknown> | null;
  ai_summary: string | null;
  ai_score: number | null;
};

type TurnRow = {
  id: string;
  turn_index: number;
  question_text: string;
  video_stream_uid: string | null;
  transcript: string | null;
  answered_at: string | null;
};

async function getApplicationByToken(env: Env, token: string): Promise<ApplicationRow | null> {
  const res = await supabaseRest(
    env,
    `job_applications?screening_token=eq.${encodeURIComponent(token)}&select=id,social_job_id,candidate_name,status,resume_parsed_json,ai_summary,ai_score&limit=1`,
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as ApplicationRow[];
  return rows[0] ?? null;
}

async function getTurns(env: Env, applicationId: string): Promise<TurnRow[]> {
  const res = await supabaseRest(
    env,
    `job_application_screening_turns?application_id=eq.${applicationId}&select=id,turn_index,question_text,video_stream_uid,transcript,answered_at&order=turn_index.asc`,
  );
  if (!res.ok) return [];
  return (await res.json()) as TurnRow[];
}

function buildResumeSummary(parsed: Record<string, unknown> | null): string {
  if (!parsed) return "";
  const lines: string[] = [];
  if (parsed.target_role) lines.push(`Target role: ${parsed.target_role}`);
  if (parsed.years_experience) lines.push(`Years of experience: ${parsed.years_experience}`);
  if (Array.isArray(parsed.core_skills) && parsed.core_skills.length > 0) {
    lines.push(`Core skills: ${(parsed.core_skills as string[]).join(", ")}`);
  }
  return lines.join("\n");
}

// ── Cloudflare Stream API ───────────────────────────────────────────────────
function streamUrl(env: Env, path: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/stream${path}`;
}

function streamHeaders(env: Env, json = false): Record<string, string> {
  return {
    Authorization: `Bearer ${env.CLOUDFLARE_STREAM_API_TOKEN}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function requestDirectUpload(env: Env): Promise<{ uploadUrl: string; uid: string }> {
  const res = await fetch(streamUrl(env, "/direct_upload"), {
    method: "POST",
    headers: streamHeaders(env, true),
    body: JSON.stringify({ maxDurationSeconds: 180 }),
  });
  const payload = await res.json() as { result?: { uploadURL?: string; uid?: string }; errors?: unknown };
  if (!res.ok || !payload.result?.uploadURL || !payload.result?.uid) {
    throw new Error(`Stream direct_upload failed: ${JSON.stringify(payload.errors ?? payload)}`);
  }
  return { uploadUrl: payload.result.uploadURL, uid: payload.result.uid };
}

// Strips WebVTT formatting (header, cue numbers, timestamp lines) down to
// plain spoken text for the AI prompt.
function vttToPlainText(vtt: string): string {
  return vtt
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "WEBVTT") return false;
      if (/^\d+$/.test(trimmed)) return false;
      if (trimmed.includes("-->")) return false;
      return true;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function waitForCaptionsAndGetTranscript(env: Env, videoUid: string, language = "en"): Promise<string> {
  await fetch(streamUrl(env, `/${videoUid}/captions/${language}/generate`), {
    method: "POST",
    headers: streamHeaders(env),
  });

  const maxAttempts = 15;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(2000);
    const listRes = await fetch(streamUrl(env, `/${videoUid}/captions`), { headers: streamHeaders(env) });
    if (listRes.ok) {
      const listPayload = await listRes.json() as { result?: Array<{ language?: string; status?: string }> };
      const caption = (listPayload.result ?? []).find((c) => c.language === language);
      if (caption?.status === "ready") {
        const vttRes = await fetch(streamUrl(env, `/${videoUid}/captions/${language}/vtt`), { headers: streamHeaders(env) });
        if (vttRes.ok) return vttToPlainText(await vttRes.text());
        break;
      }
      if (caption?.status === "error") break;
    }
  }
  // Captions never became ready in time — the answer is still recorded
  // (video_stream_uid is saved regardless), just without a transcript for
  // the next question to build on.
  return "";
}

// ── social-job-parser call (Workers AI question generation) ────────────────
async function generateNextQuestion(
  env: Env,
  resumeSummary: string,
  jobTitle: string,
  jobDescription: string,
  priorTurns: Array<{ question: string; answer: string }>,
): Promise<{ done: true; summary: string; score: number } | { done: false; question: string }> {
  const maxTurns = Math.min(6, Math.max(2, Number(env.MAX_SCREENING_TURNS) || 5));
  const res = await fetch(`${env.CLOUDFLARE_WORKER_URL.replace(/\/$/, "")}/generate-screening-question`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.CLOUDFLARE_WORKER_TOKEN ? { Authorization: `Bearer ${env.CLOUDFLARE_WORKER_TOKEN}` } : {}),
    },
    body: JSON.stringify({ resumeSummary, jobTitle, jobDescription, priorTurns, maxTurns }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await res.json() as { done?: boolean; question?: string; summary?: string; score?: number; error?: string };
  if (!res.ok) throw new Error(payload.error || `generate-screening-question ${res.status}`);
  if (payload.done) {
    return { done: true, summary: String(payload.summary ?? ""), score: Number(payload.score) || 0 };
  }
  return { done: false, question: String(payload.question ?? "") };
}

// ── Route handlers ──────────────────────────────────────────────────────────
async function handleGetSession(env: Env, token: string): Promise<Response> {
  const application = await getApplicationByToken(env, token);
  if (!application) return jsonResponse({ error: "Invalid or expired screening link" }, 404);

  const [jobRes, turns] = await Promise.all([
    supabaseRest(env, `social_jobs?id=eq.${application.social_job_id}&select=job_title,company_name`),
    getTurns(env, application.id),
  ]);
  const jobRows = jobRes.ok ? (await jobRes.json()) as Array<{ job_title: string; company_name: string }> : [];
  const job = jobRows[0];

  const currentTurn = turns.find((t) => !t.answered_at);

  return jsonResponse({
    candidateName: application.candidate_name,
    jobTitle: job?.job_title || "this role",
    companyName: job?.company_name || "",
    status: application.status,
    turnsAnswered: turns.filter((t) => t.answered_at).length,
    currentTurnIndex: currentTurn?.turn_index ?? null,
    currentQuestion: currentTurn?.question_text ?? null,
    done: application.status === "screening_completed",
    summary: application.status === "screening_completed" ? application.ai_summary : undefined,
  });
}

async function handleUploadUrl(env: Env, token: string): Promise<Response> {
  const application = await getApplicationByToken(env, token);
  if (!application) return jsonResponse({ error: "Invalid or expired screening link" }, 404);
  if (application.status === "screening_completed") return jsonResponse({ error: "Screening already completed" }, 400);

  try {
    const { uploadUrl, uid } = await requestDirectUpload(env);
    return jsonResponse({ uploadUrl, uid });
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 502);
  }
}

async function handleAnswer(env: Env, token: string, req: Request): Promise<Response> {
  const application = await getApplicationByToken(env, token);
  if (!application) return jsonResponse({ error: "Invalid or expired screening link" }, 404);
  if (application.status === "screening_completed") return jsonResponse({ error: "Screening already completed" }, 400);

  const body = await req.json().catch(() => ({})) as { turnIndex?: number; videoUid?: string };
  const turnIndex = Number(body.turnIndex);
  const videoUid = String(body.videoUid ?? "").trim();
  if (!Number.isInteger(turnIndex) || !videoUid) {
    return jsonResponse({ error: "turnIndex and videoUid are required" }, 400);
  }

  const turns = await getTurns(env, application.id);
  const turn = turns.find((t) => t.turn_index === turnIndex);
  if (!turn) return jsonResponse({ error: "Unknown turn" }, 404);
  if (turn.answered_at) return jsonResponse({ error: "This question was already answered" }, 400);

  await supabaseRest(env, `job_application_screening_turns?id=eq.${turn.id}`, {
    method: "PATCH",
    body: JSON.stringify({ video_stream_uid: videoUid }),
  });

  const transcript = await waitForCaptionsAndGetTranscript(env, videoUid);

  await supabaseRest(env, `job_application_screening_turns?id=eq.${turn.id}`, {
    method: "PATCH",
    body: JSON.stringify({ transcript, answered_at: new Date().toISOString() }),
  });

  const [jobRes] = await Promise.all([
    supabaseRest(env, `social_jobs?id=eq.${application.social_job_id}&select=job_title,job_description,post_content`),
  ]);
  const jobRows = jobRes.ok ? (await jobRes.json()) as Array<{ job_title: string; job_description: string; post_content: string }> : [];
  const job = jobRows[0];
  const jobTitle = job?.job_title || "this role";
  const jobDescription = job?.job_description || job?.post_content || "";
  const resumeSummary = buildResumeSummary(application.resume_parsed_json);

  const priorTurns = [...turns.filter((t) => t.answered_at), { ...turn, transcript, answered_at: new Date().toISOString() }]
    .sort((a, b) => a.turn_index - b.turn_index)
    .map((t) => ({ question: t.question_text, answer: t.transcript || "(no transcript captured)" }));

  let result;
  try {
    result = await generateNextQuestion(env, resumeSummary, jobTitle, jobDescription, priorTurns);
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 502);
  }

  if (result.done) {
    await supabaseRest(env, `job_applications?id=eq.${application.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "screening_completed", ai_summary: result.summary, ai_score: result.score }),
    });
    return jsonResponse({ done: true });
  }

  await supabaseRest(env, "job_application_screening_turns", {
    method: "POST",
    body: JSON.stringify({ application_id: application.id, turn_index: turnIndex + 1, question_text: result.question }),
  });

  return jsonResponse({ done: false, nextTurnIndex: turnIndex + 1, nextQuestion: result.question });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

    const url = new URL(req.url);
    const match = url.pathname.match(/^\/screen\/([^/]+)(\/upload-url|\/answer)?\/?$/);
    if (!match) return jsonResponse({ error: "Not found" }, 404);
    const [, token, subroute] = match;

    if (!subroute && req.method === "GET") return handleGetSession(env, token);
    if (subroute === "/upload-url" && req.method === "POST") return handleUploadUrl(env, token);
    if (subroute === "/answer" && req.method === "POST") return handleAnswer(env, token, req);

    return jsonResponse({ error: "Not found" }, 404);
  },
};
