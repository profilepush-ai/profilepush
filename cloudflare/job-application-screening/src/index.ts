// Public (no-login) AI video screening flow for a candidate submitted via
// SubmitApplicationModal. Every route here is reachable by an anonymous
// browser — the ONLY thing standing in for auth is the unguessable
// job_applications.screening_token in the URL, same trust model this app's
// /onboard/:token flow already uses. Talks to Supabase via the service role
// key (bypassing RLS, same as other backend-only workers in this repo) and
// to the social-job-parser Worker for the actual Workers AI calls (that
// Worker already owns the AI binding and the JSON-parsing/retry helpers —
// this Worker orchestrates, it doesn't duplicate the AI plumbing).
//
// The interview is recorded as ONE continuous video (not one file per
// question) so it stays adaptive — question N+1 must react to what the
// candidate actually said answering question N — without needing three
// separate uploads. Each answer is transcribed fast via Workers AI Whisper
// (social-job-parser's /transcribe-screening-audio) on a small audio-only
// clip, well before the final combined video exists; the full video is
// only uploaded once, at the very end, via /finalize. See
// handleSegmentAnswer() and handleFinalize().

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
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
  video_offset_ms: number | null;
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
    `job_application_screening_turns?application_id=eq.${applicationId}&select=id,turn_index,question_text,video_offset_ms,transcript,answered_at&order=turn_index.asc`,
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

// ── social-job-parser calls (Workers AI, via the existing service binding) ─
async function transcribeAudioChunk(env: Env, buffer: ArrayBuffer, contentType: string): Promise<string> {
  // Degrades to "" on any failure — matches this flow's established
  // precedent (the old Stream-captions path did the same on a timeout):
  // one answer losing its transcript should cost that answer's adaptivity,
  // not the whole interview.
  try {
    const res = await env.SOCIAL_JOB_PARSER.fetch("https://social-job-parser.internal/transcribe-screening-audio", {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        ...(env.CLOUDFLARE_WORKER_TOKEN ? { Authorization: `Bearer ${env.CLOUDFLARE_WORKER_TOKEN}` } : {}),
      },
      body: buffer,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return "";
    const payload = await res.json() as { text?: string };
    return String(payload.text ?? "").trim();
  } catch {
    return "";
  }
}

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

async function fetchJobContext(env: Env, socialJobId: string): Promise<{ jobTitle: string; jobDescription: string; companyName: string }> {
  const res = await supabaseRest(env, `social_jobs?id=eq.${socialJobId}&select=job_title,job_description,post_content,company_name`);
  const rows = res.ok ? (await res.json()) as Array<{ job_title: string; job_description: string; post_content: string; company_name: string }> : [];
  const job = rows[0];
  return {
    jobTitle: job?.job_title || "this role",
    jobDescription: job?.job_description || job?.post_content || "",
    companyName: job?.company_name || "",
  };
}

// ── Route handlers ──────────────────────────────────────────────────────────
async function handleGetSession(env: Env, token: string): Promise<Response> {
  const application = await getApplicationByToken(env, token);
  if (!application) return jsonResponse({ error: "Invalid or expired screening link" }, 404);

  const [{ jobTitle, companyName }, turns] = await Promise.all([
    fetchJobContext(env, application.social_job_id),
    getTurns(env, application.id),
  ]);

  const currentTurn = turns.find((t) => !t.answered_at);
  const done = application.status === "screening_completed";
  // All questions answered (ai_summary was written by the last /segment
  // call) but the final video hasn't landed yet — the candidate needs to
  // resume at the finalize step, not re-answer anything.
  const awaitingFinalVideo = !done && !currentTurn && Boolean(application.ai_summary);

  return jsonResponse({
    candidateName: application.candidate_name,
    jobTitle,
    companyName,
    status: application.status,
    turnsAnswered: turns.filter((t) => t.answered_at).length,
    currentTurnIndex: currentTurn?.turn_index ?? null,
    currentQuestion: currentTurn?.question_text ?? null,
    done,
    awaitingFinalVideo,
    summary: done ? application.ai_summary : undefined,
  });
}

const MAX_AUDIO_CHUNK_BYTES = 2 * 1024 * 1024; // a ~90s/64kbps answer clip is well under this

async function handleSegmentAnswer(env: Env, token: string, turnIndexParam: string, req: Request): Promise<Response> {
  const application = await getApplicationByToken(env, token);
  if (!application) return jsonResponse({ error: "Invalid or expired screening link" }, 404);
  if (application.status === "screening_completed") return jsonResponse({ error: "Screening already completed" }, 400);

  const turnIndex = Number(turnIndexParam);
  if (!Number.isInteger(turnIndex)) return jsonResponse({ error: "Invalid turn index" }, 400);

  const contentType = req.headers.get("Content-Type") || "audio/webm";
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength === 0) return jsonResponse({ error: "Empty recording" }, 400);
  if (buffer.byteLength > MAX_AUDIO_CHUNK_BYTES) return jsonResponse({ error: "Recording too large" }, 413);

  const videoOffsetMsHeader = req.headers.get("X-Video-Offset-Ms");
  const videoOffsetMs = videoOffsetMsHeader != null && Number.isFinite(Number(videoOffsetMsHeader))
    ? Math.max(0, Math.round(Number(videoOffsetMsHeader)))
    : null;

  const turns = await getTurns(env, application.id);
  const turn = turns.find((t) => t.turn_index === turnIndex);
  if (!turn) return jsonResponse({ error: "Unknown turn" }, 404);
  if (turn.answered_at) return jsonResponse({ error: "This question was already answered" }, 400);

  const transcript = await transcribeAudioChunk(env, buffer, contentType);

  await supabaseRest(env, `job_application_screening_turns?id=eq.${turn.id}`, {
    method: "PATCH",
    body: JSON.stringify({ transcript, video_offset_ms: videoOffsetMs, answered_at: new Date().toISOString() }),
  });

  const { jobTitle, jobDescription } = await fetchJobContext(env, application.social_job_id);
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
    // Score/summary are text-derived and ready now, but status stays
    // screening_sent (and no chat notification fires) until /finalize
    // actually lands the full video — the recruiter shouldn't be told a
    // recording is ready to watch before it exists.
    await supabaseRest(env, `job_applications?id=eq.${application.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ai_summary: result.summary, ai_score: result.score }),
    });
    return jsonResponse({ done: true, awaitingFinalVideo: true });
  }

  await supabaseRest(env, "job_application_screening_turns", {
    method: "POST",
    body: JSON.stringify({ application_id: application.id, turn_index: turnIndex + 1, question_text: result.question }),
  });

  return jsonResponse({ done: false, nextTurnIndex: turnIndex + 1, nextQuestion: result.question });
}

const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // ~4 attempts (3 questions + 1 capped retake) x 90s at the client's bitrate caps, plus container/VBR headroom

async function handleFinalize(env: Env, token: string, req: Request): Promise<Response> {
  const application = await getApplicationByToken(env, token);
  if (!application) return jsonResponse({ error: "Invalid or expired screening link" }, 404);
  if (application.status === "screening_completed") return jsonResponse({ done: true }); // idempotent retry
  if (!application.ai_summary) return jsonResponse({ error: "Screening is not yet complete" }, 400);

  const contentType = req.headers.get("Content-Type") || "video/webm";
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength === 0) return jsonResponse({ error: "Empty recording" }, 400);
  if (buffer.byteLength > MAX_VIDEO_BYTES) return jsonResponse({ error: "Recording too large" }, 413);

  const r2Key = `screenings/${application.id}/full`;

  // R2 is the only durable copy of the video — a failed write must hard-fail
  // so the candidate knows to retry finalize (the frontend keeps the blob
  // in memory for exactly this retry), same asymmetric-failure principle as
  // this flow has always used.
  try {
    await env.VIDEO_BUCKET.put(r2Key, buffer, { httpMetadata: { contentType } });
  } catch {
    return jsonResponse({ error: "Failed to store recording, please try again" }, 502);
  }

  await supabaseRest(env, `job_applications?id=eq.${application.id}`, {
    method: "PATCH",
    body: JSON.stringify({ video_r2_key: r2Key, video_content_type: contentType, status: "screening_completed" }),
  });

  const { jobTitle } = await fetchJobContext(env, application.social_job_id);
  await sendScreeningCompletedMessage(env, application, jobTitle);

  return jsonResponse({ done: true });
}

// Recruiter-facing video playback. Authorization is entirely delegated to
// Postgres RLS: the caller's own Supabase JWT is passed straight through to
// PostgREST (not the service-role key), so "can this recruiter already
// SELECT this application row" is the same question RLS already answers
// everywhere else in this app — no separate auth logic to write or get
// wrong here.
async function handleVideoPlayback(env: Env, applicationId: string, req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

  const res = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/job_applications?id=eq.${encodeURIComponent(applicationId)}&select=video_r2_key,video_content_type`,
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

    const segmentMatch = path.match(/^\/screen\/([^/]+)\/segment\/(\d+)\/?$/);
    if (segmentMatch && req.method === "POST") return handleSegmentAnswer(env, segmentMatch[1], segmentMatch[2], req);

    const finalizeMatch = path.match(/^\/screen\/([^/]+)\/finalize\/?$/);
    if (finalizeMatch && req.method === "POST") return handleFinalize(env, finalizeMatch[1], req);

    const videoMatch = path.match(/^\/video\/([^/]+)\/?$/);
    if (videoMatch && req.method === "GET") return handleVideoPlayback(env, videoMatch[1], req);

    return jsonResponse({ error: "Not found" }, 404);
  },
};
