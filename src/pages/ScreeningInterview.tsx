import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Camera, CheckCircle2, PartyPopper, RotateCcw, Video } from 'lucide-react';
import Logo from '../components/Logo';
import LogoSpinner from '../components/LogoSpinner';

const WORKER_URL = (import.meta.env.VITE_SCREENING_WORKER_URL ?? '').trim();

interface SessionState {
  candidateName: string;
  jobTitle: string;
  companyName: string;
  status: string;
  turnsAnswered: number;
  currentTurnIndex: number | null;
  currentQuestion: string | null;
  done: boolean;
  awaitingFinalVideo: boolean;
  /** No resume on file — the consultant was invited, not submitted. */
  needsResume?: boolean;
  hasResume?: boolean;
  resumeFileName?: string | null;
}

type PageStatus = 'loading' | 'invalid' | 'active' | 'completed' | 'worker_not_configured' | 'recording_lost';
type RecordPhase = 'requesting_camera' | 'camera_denied' | 'preview' | 'recording' | 'recorded' | 'submitting' | 'finalizing';

// The whole interview is recorded as ONE continuous video (master recorder,
// start()'d once, paused/resumed at each question boundary, stopped only
// once at the very end) so it stays adaptive without needing three separate
// uploads. A second, ephemeral, audio-only recorder runs alongside it per
// question purely to get a small clip fast-transcribed (Workers AI Whisper)
// so the next question can react to what was actually said — it's never
// uploaded/stored, just discarded once its transcript is back.
const MAX_RECORDING_MS = 90_000;
const MAX_RETAKES_PER_QUESTION = 1;

function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return '';
}

export default function ScreeningInterview() {
  const { token } = useParams<{ token: string }>();
  const [pageStatus, setPageStatus] = useState<PageStatus>('loading');
  const [session, setSession] = useState<SessionState | null>(null);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [resumeError, setResumeError] = useState('');
  // The resume step runs for everyone: an invited candidate uploads one, a
  // submitted candidate confirms the one already on file. Same two steps in
  // both cases rather than two different-feeling flows.
  const [resumeStepDone, setResumeStepDone] = useState(false);
  const [recordPhase, setRecordPhase] = useState<RecordPhase>('requesting_camera');
  const [errorMessage, setErrorMessage] = useState('');
  const [retakesUsed, setRetakesUsed] = useState(0);
  const [consentGiven, setConsentGiven] = useState(false);
  const [declinedConsent, setDeclinedConsent] = useState(false);
  const [submittedVideoUrl, setSubmittedVideoUrl] = useState<string | null>(null);

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const masterRecorderRef = useRef<MediaRecorder | null>(null);
  const masterChunksRef = useRef<Blob[]>([]);
  const masterBlobRef = useRef<Blob | null>(null);
  const masterMimeTypeRef = useRef<string>('');

  const ephemeralRecorderRef = useRef<MediaRecorder | null>(null);
  const ephemeralChunksRef = useRef<Blob[]>([]);
  const ephemeralBlobRef = useRef<Blob | null>(null);

  // Sum of every active-recording interval, including retaken/discarded
  // attempts — those seconds are still physically encoded in the master
  // file, so this must match the file's own internal timeline exactly for
  // video_offset_ms (recruiter "jump to this answer") to stay accurate.
  const elapsedActiveMsRef = useRef(0);
  const activeSegmentStartRef = useRef(0);
  // Where the CURRENT attempt's audio begins in the master timeline —
  // recomputed on every (re)start, so it always ends up pointing at
  // whichever attempt is ultimately submitted, never a discarded retake.
  const acceptedOffsetMsRef = useRef(0);

  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSession = useCallback(async () => {
    if (!token) { setPageStatus('invalid'); return; }
    try {
      const res = await fetch(`${WORKER_URL}/screen/${encodeURIComponent(token)}`);
      if (!res.ok) { setPageStatus('invalid'); return; }
      const data = (await res.json()) as SessionState;
      setSession(data);
      if (data.done) { setPageStatus('completed'); return; }
      // All questions were answered in an earlier browser session that
      // never reached /finalize (e.g. the tab was closed) — the recording
      // only ever existed in that session's memory, so there's nothing to
      // resume here. No automated recovery for this; tell the candidate
      // plainly instead of showing a broken interview.
      if (data.awaitingFinalVideo) { setPageStatus('recording_lost'); return; }
      setPageStatus('active');
    } catch {
      setPageStatus('invalid');
    }
  }, [token]);

  useEffect(() => {
    if (!WORKER_URL) { setPageStatus('worker_not_configured'); return; }
    void loadSession();
  }, [loadSession]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const setupCamera = useCallback(async () => {
    setRecordPhase('requesting_camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
      }
      setRecordPhase('preview');
    } catch {
      setRecordPhase('camera_denied');
    }
  }, []);

  useEffect(() => {
    if (pageStatus !== 'active' || !consentGiven) return;
    void setupCamera();
    return () => stopCamera();
  }, [pageStatus, consentGiven, setupCamera, stopCamera]);

  // The object URL is only ever created once (finalizeInterview sets it a
  // single time, right before the page moves to 'completed'), so this only
  // needs to revoke on unmount, not on every change.
  useEffect(() => () => {
    if (submittedVideoUrl) URL.revokeObjectURL(submittedVideoUrl);
  }, [submittedVideoUrl]);

  useEffect(() => () => {
    stopCamera();
    if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
    // A long-lived master recorder won't get GC'd just from the component
    // unmounting the way today's short per-question recorders did — stop it
    // explicitly so a candidate navigating away doesn't leave it running.
    if (masterRecorderRef.current && masterRecorderRef.current.state !== 'inactive') {
      masterRecorderRef.current.onstop = null;
      masterRecorderRef.current.stop();
    }
  }, [stopCamera]);

  async function finalizeInterview() {
    const blob = masterBlobRef.current;
    if (!blob || !token) return;
    setErrorMessage('');
    try {
      const res = await fetch(`${WORKER_URL}/screen/${encodeURIComponent(token)}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': masterMimeTypeRef.current || blob.type || 'video/webm' },
        body: blob,
      });
      const payload = (await res.json()) as { done?: boolean; error?: string };
      if (!res.ok) throw new Error(payload.error || 'Could not submit your recording');
      stopCamera();
      setSubmittedVideoUrl(URL.createObjectURL(blob));
      setPageStatus('completed');
    } catch (error) {
      // The blob is still in masterBlobRef — retry re-sends the same bytes
      // rather than forcing the candidate to redo the whole interview over
      // what might just be a network blip on this last step.
      setErrorMessage(error instanceof Error ? error.message : 'Could not submit your recording. Please try again.');
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;

    if (!masterRecorderRef.current) {
      const mimeType = pickMimeType();
      masterMimeTypeRef.current = mimeType || 'video/webm';
      const master = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 800_000,
        audioBitsPerSecond: 64_000,
      });
      master.ondataavailable = (e) => { if (e.data.size > 0) masterChunksRef.current.push(e.data); };
      master.onstop = () => {
        masterBlobRef.current = new Blob(masterChunksRef.current, { type: masterMimeTypeRef.current });
        void finalizeInterview();
      };
      masterRecorderRef.current = master;
      master.start();
    } else {
      masterRecorderRef.current.resume();
    }

    acceptedOffsetMsRef.current = elapsedActiveMsRef.current;
    activeSegmentStartRef.current = Date.now();

    ephemeralChunksRef.current = [];
    const audioStream = new MediaStream(stream.getAudioTracks());
    const ephemeral = new MediaRecorder(audioStream);
    ephemeral.ondataavailable = (e) => { if (e.data.size > 0) ephemeralChunksRef.current.push(e.data); };
    ephemeral.onstop = () => {
      ephemeralBlobRef.current = new Blob(ephemeralChunksRef.current, { type: ephemeral.mimeType || 'audio/webm' });
      setRecordPhase('recorded');
    };
    ephemeralRecorderRef.current = ephemeral;
    ephemeral.start();

    setRecordPhase('recording');
    maxDurationTimerRef.current = setTimeout(() => {
      if (masterRecorderRef.current?.state === 'recording') stopRecording();
    }, MAX_RECORDING_MS);
  }

  function stopRecording() {
    if (maxDurationTimerRef.current) { clearTimeout(maxDurationTimerRef.current); maxDurationTimerRef.current = null; }
    elapsedActiveMsRef.current += Date.now() - activeSegmentStartRef.current;
    masterRecorderRef.current?.pause();
    ephemeralRecorderRef.current?.stop();
  }

  function retake() {
    if (retakesUsed >= MAX_RETAKES_PER_QUESTION) return;
    setRetakesUsed((n) => n + 1);
    ephemeralBlobRef.current = null;
    setRecordPhase('preview');
  }

  async function submitAnswer() {
    const audioBlob = ephemeralBlobRef.current;
    const turnIndex = session?.currentTurnIndex;
    if (!audioBlob || turnIndex === null || turnIndex === undefined || !token) return;

    setRecordPhase('submitting');
    setErrorMessage('');
    try {
      const res = await fetch(`${WORKER_URL}/screen/${encodeURIComponent(token)}/segment/${turnIndex}`, {
        method: 'POST',
        headers: {
          'Content-Type': audioBlob.type || 'audio/webm',
          'X-Video-Offset-Ms': String(acceptedOffsetMsRef.current),
        },
        body: audioBlob,
      });
      const payload = (await res.json()) as { done?: boolean; nextTurnIndex?: number; nextQuestion?: string; error?: string };
      if (!res.ok) throw new Error(payload.error || 'Could not process your answer');

      if (payload.done) {
        setRecordPhase('finalizing');
        masterRecorderRef.current?.stop();
        return;
      }

      setRetakesUsed(0);
      ephemeralBlobRef.current = null;
      setSession((prev) => prev && ({
        ...prev,
        turnsAnswered: prev.turnsAnswered + 1,
        currentTurnIndex: payload.nextTurnIndex ?? null,
        currentQuestion: payload.nextQuestion ?? null,
      }));
      setRecordPhase('preview');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
      setRecordPhase('recorded');
    }
  }

  if (pageStatus === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LogoSpinner size={24} />
      </div>
    );
  }

  if (pageStatus === 'invalid' || pageStatus === 'worker_not_configured') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={24} className="text-red-400" />
          </div>
          <h1 className="text-base font-bold text-gray-900 mb-2">Link Not Found</h1>
          <p className="text-sm text-gray-500">This screening link is invalid or has expired. Please contact your recruiter.</p>
        </div>
      </div>
    );
  }

  if (pageStatus === 'recording_lost') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={24} className="text-red-400" />
          </div>
          <h1 className="text-base font-bold text-gray-900 mb-2">Recording Didn't Finish</h1>
          <p className="text-sm text-gray-500">It looks like your screening answers were recorded, but the video didn't finish submitting. Please contact your recruiter for a new link.</p>
        </div>
      </div>
    );
  }

  if (pageStatus === 'completed') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 sm:p-10 max-w-lg w-full text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <PartyPopper size={26} className="text-emerald-500" />
          </div>
          <h1 className="text-base font-bold text-gray-900 mb-2">Screening Complete</h1>
          <p className="text-sm text-gray-500 mb-5">
            Thanks{session?.candidateName ? `, ${session.candidateName.split(/\s+/)[0]}` : ''}! Your recruiter will review your answers and follow up with you.
          </p>
          {submittedVideoUrl && (
            <div className="text-left">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">What you submitted</p>
              <video controls src={submittedVideoUrl} className="w-full rounded-xl bg-gray-900 aspect-video" />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (pageStatus === 'active' && declinedConsent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={24} className="text-gray-400" />
          </div>
          <h1 className="text-base font-bold text-gray-900 mb-2">Consent Required</h1>
          <p className="text-sm text-gray-500 mb-5">This screening can't continue without your consent to be recorded and evaluated by AI. If you have questions, please contact your recruiter directly.</p>
          <button
            onClick={() => setDeclinedConsent(false)}
            className="text-sm font-semibold text-blue-600 hover:underline"
          >
            Back to consent screen
          </button>
        </div>
      </div>
    );
  }

  // Asked before consent, not after: the questions are generated from the
  // resume, so without it the interview is generic and the candidate has
  // recorded themselves answering nothing specific.
  if (pageStatus === 'active' && !resumeStepDone && !consentGiven) {
    async function handleResumeUpload(file: File) {
      setUploadingResume(true);
      setResumeError('');
      try {
        const form = new FormData();
        form.append('resume', file, file.name);
        const res = await fetch(`${WORKER_URL}/screen/${encodeURIComponent(token ?? '')}/resume`, {
          method: 'POST',
          body: form,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.ok) throw new Error(body?.error || 'Could not read that file');
        setSession((prev) => prev && ({ ...prev, needsResume: false, hasResume: true, resumeFileName: file.name }));
        setResumeStepDone(true);
      } catch (err) {
        setResumeError(err instanceof Error ? err.message : 'Could not read that file');
      } finally {
        setUploadingResume(false);
      }
    }

    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 sm:p-8 max-w-lg w-full">
          <div className="flex items-center gap-1.5 font-bold text-blue-600 text-sm mb-5">
            <Logo size="sm" />
          </div>
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mb-4">
            <Video size={20} className="text-blue-600" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mb-2">
            {session?.hasResume ? 'Check your resume' : 'First, add your resume'}
          </h1>
          <p className="text-sm text-gray-600 mb-4">
            This is a short screening for <strong>{session?.jobTitle}</strong>
            {session?.companyName ? ` at ${session.companyName}` : ''}: your resume, then a five-minute
            video interview. The questions are built from the resume, so the interview is about your
            actual experience rather than generic questions.
          </p>
          {session?.hasResume && (
            <p className="mb-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
              On file: <strong>{session.resumeFileName || 'your resume'}</strong>
            </p>
          )}
          <label className="block">
            <input
              type="file"
              accept=".pdf,.docx,.rtf,.txt"
              disabled={uploadingResume}
              onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleResumeUpload(file); }}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700 disabled:opacity-50"
            />
          </label>
          <p className="mt-2 text-xs text-gray-400">
            PDF, DOCX, RTF or TXT, up to 10MB. No account needed.
          </p>
          {session?.hasResume && (
            <button
              type="button"
              onClick={() => setResumeStepDone(true)}
              className="mt-4 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Continue to the interview
            </button>
          )}
          {uploadingResume && <p className="mt-3 text-sm text-blue-600">Reading your resume…</p>}
          {resumeError && <p className="mt-3 text-sm text-red-600">{resumeError}</p>}
        </div>
      </div>
    );
  }

  if (pageStatus === 'active' && !consentGiven) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 sm:p-8 max-w-lg w-full">
          <div className="flex items-center gap-1.5 font-bold text-blue-600 text-sm mb-5">
            <Logo size="sm" />
          </div>
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mb-4">
            <Video size={20} className="text-blue-600" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mb-2">Before you start: this interview is recorded</h1>
          <p className="text-sm text-gray-600 mb-4">
            You're applying to <strong>{session?.jobTitle}</strong>{session?.companyName ? ` at ${session.companyName}` : ''}. This is an AI-run video interview:
          </p>
          <ul className="space-y-2 text-sm text-gray-600 mb-5 list-disc pl-5">
            <li>Your camera and microphone will be recorded for the full interview.</li>
            <li>AI will transcribe each answer and ask follow-up questions based on what you say.</li>
            <li>Once you finish, AI generates a written summary and score from your answers.</li>
            <li>Your recruiter will see the full video, the AI summary, and your resume together.</li>
          </ul>
          <p className="text-xs text-gray-400 mb-6">By continuing, you consent to being recorded and evaluated by AI as part of this application.</p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setConsentGiven(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-6 py-3 rounded-xl transition-colors shadow-md shadow-blue-900/20"
            >
              I Consent & Continue
            </button>
            <button
              onClick={() => setDeclinedConsent(true)}
              className="w-full text-gray-400 hover:text-gray-600 text-xs font-semibold py-2 transition-colors"
            >
              I don't consent
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Three bands, fixed to the viewport: camera across the top, the question in
  // the middle, the action at the bottom.
  //
  // It was one scrolling card — logo, question, a boxed aspect-video, button.
  // On a phone that made the person's own face smaller than the text above it,
  // and a long question pushed Start Recording toward the fold, so the one
  // control that matters was the least reliable thing on the screen. Only the
  // middle band scrolls now; the button cannot move.
  return (
    <div className="flex h-screen flex-col items-center bg-gray-50 sm:py-8" style={{ height: '100dvh' }}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-white sm:max-w-lg sm:rounded-2xl sm:border sm:border-gray-200 sm:shadow-lg md:max-w-4xl md:flex-row">

        {/* Phone: the top 30%, edge to edge. Desktop: the left 60%, full
            height — there is width to spend there, and stacking bands down a
            wide screen would leave the camera a letterbox strip.
            Heights are split by breakpoint rather than set inline, so the
            md rule is not fighting an inline style it cannot beat. dvh keeps
            the phone's collapsing address bar from resizing the camera
            mid-answer; the vh rule is the fallback where dvh is unsupported. */}
        <div className="relative overflow-hidden bg-gray-900 max-md:h-[30vh] max-md:min-h-[168px] max-md:shrink-0 max-md:supports-[height:1dvh]:h-[30dvh] sm:rounded-t-2xl md:h-full md:w-3/5 md:shrink-0 md:rounded-l-2xl md:rounded-tr-none">
          <video
            ref={videoPreviewRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />

          {/* Branding and role ride over the video under a scrim rather than
              taking a row of their own — they are reassurance, not content. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent px-4 pb-6 pt-3">
            <Logo size="sm" white />
            <p className="min-w-0 truncate text-[10px] text-white/70" title={`${session?.jobTitle ?? ''}${session?.companyName ? ` · ${session.companyName}` : ''}`}>
              {session?.jobTitle}{session?.companyName ? ` · ${session.companyName}` : ''}
            </p>
          </div>

          {recordPhase === 'recording' && (
            <div className="absolute bottom-3 left-4 flex items-center gap-1.5 bg-red-600 text-white text-[11px] font-bold px-2 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              REC
            </div>
          )}
          {recordPhase === 'recorded' && (
            <div className="absolute bottom-3 left-4 flex items-center gap-1.5 bg-emerald-600 text-white text-[11px] font-bold px-2 py-1 rounded-full">
              <CheckCircle2 size={12} />
              Recorded
            </div>
          )}
          {(recordPhase === 'requesting_camera' || recordPhase === 'submitting' || recordPhase === 'finalizing') && (
            <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
              <LogoSpinner size={20} />
              {recordPhase === 'submitting' && <p className="text-xs text-white/80">Processing your answer…</p>}
              {recordPhase === 'finalizing' && !errorMessage && <p className="text-xs text-white/80">Submitting your recording…</p>}
            </div>
          )}
          {recordPhase === 'camera_denied' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
              <Camera size={22} className="text-gray-400" />
              <p className="text-xs text-gray-300">Camera and microphone access is required to answer. Please allow access and try again.</p>
            </div>
          )}
        </div>

        {/* Question and action travel together: stacked under the camera on a
            phone, the right-hand 40% column beside it on desktop. */}
        <div className="flex min-h-0 flex-1 flex-col md:border-l md:border-gray-100">

        {/* The only band that scrolls, so a long question never reaches the
            button. Centred vertically while it is short enough to fit. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5 md:px-6">
          {/* my-auto, not justify-center: a centred flex container clips the
              top of content taller than itself and leaves it unscrollable. */}
          <div className="my-auto">
            <p className="text-[11px] font-semibold text-blue-500 uppercase tracking-wide mb-1.5">
              Question {(session?.turnsAnswered ?? 0) + 1}
            </p>
            <p className="text-[19px] font-bold text-gray-900 leading-snug md:text-[22px]">{session?.currentQuestion}</p>
            {errorMessage && <p className="text-xs text-red-500 mt-3">{errorMessage}</p>}
          </div>
        </div>

        {/* Pinned. pb clears the home indicator on iOS. */}
        <div className="shrink-0 border-t border-gray-100 bg-white px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6 md:pb-5">
        <div className="flex gap-2">
          {recordPhase === 'camera_denied' && (
            <button
              onClick={() => void setupCamera()}
              className="w-full bg-gray-900 hover:bg-gray-800 text-white font-bold text-sm px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              Try Again
            </button>
          )}
          {recordPhase === 'preview' && (
            <button
              onClick={startRecording}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-md shadow-blue-900/20"
            >
              <Video size={15} />
              Start Recording
            </button>
          )}
          {recordPhase === 'recording' && (
            <button
              onClick={stopRecording}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              Stop Recording
            </button>
          )}
          {recordPhase === 'recorded' && (
            <>
              {retakesUsed < MAX_RETAKES_PER_QUESTION && (
                <button
                  onClick={retake}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm px-4 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
                >
                  <RotateCcw size={14} />
                  Retake
                </button>
              )}
              <button
                onClick={() => void submitAnswer()}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-4 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-md shadow-emerald-900/20"
              >
                <CheckCircle2 size={15} />
                Submit & Next
              </button>
            </>
          )}
          {recordPhase === 'finalizing' && errorMessage && (
            <button
              onClick={() => void finalizeInterview()}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              Retry Submit
            </button>
          )}
        </div>

        <p className="mt-2.5 text-center text-[11px] text-gray-400">
          No account needed. Your answers help your recruiter present you to this role.
        </p>
        </div>

        </div>
      </div>
    </div>
  );
}
