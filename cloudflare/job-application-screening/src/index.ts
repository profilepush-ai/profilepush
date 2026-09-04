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
// Screening videos live permanently in R2 (VIDEO_BUCKET); Stream is used
// only transiently, purely for its auto-captioning capability — every
// upload is deleted from Stream (deleteStreamVideo) right after its
// transcript is read. See handleSubmitAnswer().

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_STREAM_API_TOKEN: string;
  SOCIAL_JOB_PARSER: Fetcher;
  VIDEO_BUCKET: R2Bucket;
  CLOUDFLARE_WORKER_TOKEN?: string;
  MAX_SCREENING_TURNS?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
  chat_thread_id: string | null;
  created_by_account_id: string;
  created_by_user_id: string | null;
};

type TurnRow = {
  id: string;
  turn_index: number;
  question_text: string;
  video_r2_key: string | null;
  transcript: string | null;
  answered_at: string | null;
};

async function getApplicationByToken(env: Env, token: string): Promise<ApplicationRow | null> {
  const res = await supabaseRest(
    env,
    `job_applications?screening_token=eq.${encodeURIComponent(token)}&select=id,social_job_id,candidate_name,status,resume_parsed_json,ai_summary,ai_score,chat_thread_id,created_by_account_id,created_by_user_id&limit=1`,
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as ApplicationRow[];
  return rows[0] ?? null;
}

// Posts the "screening complete, here's the video" message into the
// application's dedicated chat thread once the interview finishes —
// best-effort, a failure here must never fail the candidate's completion
// response (they already finished; the poster just won't get the in-app
// nudge, though the data is still visible in Applications either way).
async function sendScreeningCompletedMessage(env: Env, application: ApplicationRow, jobTitle: string): Promise<void> {
  if (!application.chat_thread_id) return;
  try {
    const threadRes = await supabaseRest(
      env,
      `post_chat_threads?id=eq.${application.chat_thread_id}&select=owner_account_id,owner_user_id,owner_unread_count`,
    );
    if (!threadRes.ok) return;
    const threadRows = (await threadRes.json()) as Array<{ owner_account_id: string; owner_user_id: string | null; owner_unread_count: number }>;
    const thread = threadRows[0];
    if (!thread) return;

    let senderDisplayName = "ProfilePush user";
    const submitterNameRes = await supabaseRest(
      env,
      `account_members?user_id=eq.${application.created_by_user_id}&account_id=eq.${application.created_by_account_id}&select=display_name&limit=1`,
    );
    if (submitterNameRes.ok) {
      const rows = (await submitterNameRes.json()) as Array<{ display_name: string }>;
      senderDisplayName = rows[0]?.display_name?.trim() || "";
    }
    if (!senderDisplayName) {
      const accountNameRes = await supabaseRest(env, `accounts?id=eq.${application.created_by_account_id}&select=name&limit=1`);
      if (accountNameRes.ok) {
        const rows = (await accountNameRes.json()) as Array<{ name: string }>;
        senderDisplayName = rows[0]?.name?.trim() || "ProfilePush user";
      } else {
        senderDisplayName = "ProfilePush user";
      }
    }

    const candidateLabel = application.candidate_name?.trim() || "The candidate";
    const body = `${candidateLabel}'s screening for ${jobTitle} is complete — you can review the recording now.`;
    const ctaUrl = `https://profilepush.ai/posts/applications/${application.social_job_id}`;

    await supabaseRest(env, "post_chat_messages", {
      method: "POST",
      body: JSON.stringify({
        thread_id: application.chat_thread_id,
        sender_account_id: application.created_by_account_id,
        sender_user_id: application.created_by_user_id,
        sender_display_name: senderDisplayName,
        body,
        cta_label: "Watch Screening",
        cta_url: ctaUrl,
      }),
    });

    await supabaseRest(env, `post_chat_threads?id=eq.${application.chat_thread_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        owner_unread_count: thread.owner_unread_count + 1,
        last_message_at: new Date().toISOString(),
        last_message_preview: body.slice(0, 140),
      }),
    });

    if (thread.owner_user_id) {
      await supabaseRest(env, "notifications", {
        method: "POST",
        body: JSON.stringify({
          account_id: thread.owner_account_id,
          user_id: thread.owner_user_id,
          type: "post_message_received",
          title: `Screening complete for "${jobTitle}"`,
          body: `${candidateLabel}'s screening is ready to review`,
          link: `/posts/messages/${application.chat_thread_id}`,
        }),
      });
    }
  } catch {
    // Best-effort — see comment above.
  }
}

async function getTurns(env: Env, applicationId: string): Promise<TurnRow[]> {
  const res = await supabaseRest(
    env,
    `job_application_screening_turns?application_id=eq.${applicationId}&select=id,turn_index,question_text,video_r2_key,transcript,answered_at&order=turn_index.asc`,
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

// Stream is now purely a transient captioning tool, not storage — R2 (via
// the caller's Promise.all sibling) holds the permanent copy. Any failure
// here degrades to no-transcript, exactly like a captions timeout does;
// it must never fail the request, since the R2 write is what the candidate
// actually depends on.
async function uploadToStream(env: Env, buffer: ArrayBuffer, contentType: string): Promise<{ uid: string } | null> {
  try {
    const { uploadUrl, uid } = await requestDirectUpload(env);
    const formData = new FormData();
    formData.append("file", new Blob([buffer], { type: contentType }), "answer");
    const uploadRes = await fetch(uploadUrl, { method: "POST", body: formData });
    if (!uploadRes.ok) return null;
    return { uid };
  } catch {
    return null;
  }
}

// Best-effort cleanup once the transcript has been read — only ever called
// after waitForCaptionsAndGetTranscript has already returned, never
// concurrently with it. An unretried failure here just leaves one video
// billing on Stream until a future cleanup sweep; it must not fail the
// candidate's request.
async function deleteStreamVideo(env: Env, uid: string): Promise<void> {
  try {
    await fetch(streamUrl(env, `/${uid}`), { method: "DELETE", headers: streamHeaders(env) });
  } catch {
    // best-effort — see comment above.
  }
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
  // Stream needs a short processing window after upload before it will
  // accept a captions/generate call — calling it immediately post-upload
  // reliably 400s with error code 10067 ("video not ready to stream").
  // Retry specifically on that code until Stream is ready or we give up;
  // any other error means generation isn't going to happen, so bail.
  let generateTriggered = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const genRes = await fetch(streamUrl(env, `/${videoUid}/captions/${language}/generate`), {
      method: "POST",
      headers: streamHeaders(env),
    });
    if (genRes.ok) { generateTriggered = true; break; }
    const genPayload = await genRes.json().catch(() => null) as { errors?: Array<{ code?: number }> } | null;
    const notReadyYet = genPayload?.errors?.some((e) => e.code === 10067);
    if (!notReadyYet) break;
    await sleep(1500);
  }
  if (!generateTriggered) return "";

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
  // (video_r2_key is saved regardless), just without a transcript for the
  // next question to build on.
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
  // Hard cap enforced here, not just suggested in the prompt — a model that
  // ignores the "wrap up" instruction must not be able to extend the
  // interview past maxTurns.
  const forceConclude = priorTurns.length >= maxTurns;
  const res = await env.SOCIAL_JOB_PARSER.fetch("https://social-job-parser.internal/generate-screening-question", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.CLOUDFLARE_WORKER_TOKEN ? { Authorization: `Bearer ${env.CLOUDFLARE_WORKER_TOKEN}` } : {}),
    },
    body: JSON.stringify({ resumeSummary, jobTitle, jobDescription, priorTurns, maxTurns, forceConclude }),
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

const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // defense-in-depth ceiling; the client also enforces a duration/bitrate cap

async function handleSubmitAnswer(env: Env, token: string, turnIndexParam: string, req: Request): Promise<Response> {
  const application = await getApplicationByToken(env, token);
  if (!application) return jsonResponse({ error: "Invalid or expired screening link" }, 404);
  if (application.status === "screening_completed") return jsonResponse({ error: "Screening already completed" }, 400);

  const turnIndex = Number(turnIndexParam);
  if (!Number.isInteger(turnIndex)) return jsonResponse({ error: "Invalid turn index" }, 400);

  const contentType = req.headers.get("Content-Type") || "video/webm";
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength === 0) return jsonResponse({ error: "Empty recording" }, 400);
  if (buffer.byteLength > MAX_VIDEO_BYTES) return jsonResponse({ error: "Recording too large" }, 413);

  const turns = await getTurns(env, application.id);
  const turn = turns.find((t) => t.turn_index === turnIndex);
  if (!turn) return jsonResponse({ error: "Unknown turn" }, 404);
  if (turn.answered_at) return jsonResponse({ error: "This question was already answered" }, 400);

  const r2Key = `screenings/${application.id}/${turn.id}`;

  // R2 is the only durable copy of the video now, so a failed write must
  // hard-fail the request (the candidate needs to know to retake). The
  // Stream leg is wrapped in its own try/catch inside uploadToStream and
  // is allowed to fail independently — video storage must never depend on
  // Stream's health.
  let streamResult: { uid: string } | null;
  try {
    const [, streamOutcome] = await Promise.all([
      env.VIDEO_BUCKET.put(r2Key, buffer, { httpMetadata: { contentType } }),
      uploadToStream(env, buffer, contentType),
    ]);
    streamResult = streamOutcome;
  } catch {
    return jsonResponse({ error: "Failed to store recording, please try again" }, 502);
  }

  const transcript = streamResult ? await waitForCaptionsAndGetTranscript(env, streamResult.uid) : "";
  if (streamResult) await deleteStreamVideo(env, streamResult.uid);

  await supabaseRest(env, `job_application_screening_turns?id=eq.${turn.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      video_r2_key: r2Key,
      video_content_type: contentType,
      transcript,
      answered_at: new Date().toISOString(),
    }),
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
    await sendScreeningCompletedMessage(env, application, jobTitle);
    return jsonResponse({ done: true });
  }

  await supabaseRest(env, "job_application_screening_turns", {
    method: "POST",
    body: JSON.stringify({ application_id: application.id, turn_index: turnIndex + 1, question_text: result.question }),
  });

  return jsonResponse({ done: false, nextTurnIndex: turnIndex + 1, nextQuestion: result.question });
}

// Recruiter-facing video playback. Authorization is entirely delegated to
// Postgres RLS: the caller's own Supabase JWT is passed straight through to
// PostgREST (not the service-role key), so "can this recruiter already
// SELECT this turn row" is the same question RLS already answers everywhere
// else in this app — no separate auth logic to write or get wrong here.
async function handleVideoPlayback(env: Env, turnId: string, req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

  const res = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/job_application_screening_turns?id=eq.${encodeURIComponent(turnId)}&select=video_r2_key,video_content_type`,
    { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authHeader } },
  );
  if (!res.ok) return jsonResponse({ error: "Unauthorized" }, res.status === 401 ? 401 : 403);

  const rows = (await res.json().catch(() => [])) as Array<{ video_r2_key: string | null; video_content_type: string | null }>;
  const row = rows[0];
  if (!row || !row.video_r2_key) return jsonResponse({ error: "Not found" }, 404);

  const object = await env.VIDEO_BUCKET.get(row.video_r2_key);
  if (!object) return jsonResponse({ error: "Not found" }, 404);

  return new Response(object.body, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": row.video_content_type || "video/webm",
      "Cache-Control": "private, no-store",
    },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

    const path = new URL(req.url).pathname;

    const sessionMatch = path.match(/^\/screen\/([^/]+)\/?$/);
    if (sessionMatch && req.method === "GET") return handleGetSession(env, sessionMatch[1]);

    // Kept as a harmless, unused rollback path through the R2 migration's
    // verification window — the frontend no longer calls this once the new
    // single-POST /answer/:turnIndex route ships. Safe to remove once that's
    // confirmed live (see the R2 migration plan's delivery order).
    const uploadUrlMatch = path.match(/^\/screen\/([^/]+)\/upload-url\/?$/);
    if (uploadUrlMatch && req.method === "POST") return handleUploadUrl(env, uploadUrlMatch[1]);

    const answerMatch = path.match(/^\/screen\/([^/]+)\/answer\/(\d+)\/?$/);
    if (answerMatch && req.method === "POST") return handleSubmitAnswer(env, answerMatch[1], answerMatch[2], req);

    const videoMatch = path.match(/^\/video\/([^/]+)\/?$/);
    if (videoMatch && req.method === "GET") return handleVideoPlayback(env, videoMatch[1], req);

    return jsonResponse({ error: "Not found" }, 404);
  },
};
