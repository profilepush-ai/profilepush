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
  const [recordPhase, setRecordPhase] = useState<RecordPhase>('requesting_camera');
  const [errorMessage, setErrorMessage] = useState('');
  const [retakesUsed, setRetakesUsed] = useState(0);

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
    if (pageStatus !== 'active') return;
    void setupCamera();
    return () => stopCamera();
  }, [pageStatus, setupCamera, stopCamera]);

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <PartyPopper size={26} className="text-emerald-500" />
          </div>
          <h1 className="text-base font-bold text-gray-900 mb-2">Screening Complete</h1>
          <p className="text-sm text-gray-500">
            Thanks{session?.candidateName ? `, ${session.candidateName.split(/\s+/)[0]}` : ''}! Your recruiter will review your answers and follow up with you.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 sm:p-8 max-w-lg w-full">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-1.5 font-bold text-blue-600 text-sm">
            <Logo size="sm" />
          </div>
          <p className="min-w-0 truncate text-[10px] text-gray-400" title={`${session?.jobTitle ?? ''}${session?.companyName ? ` · ${session.companyName}` : ''}`}>
            {session?.jobTitle}{session?.companyName ? ` · ${session.companyName}` : ''}
          </p>
        </div>

        <p className="text-[11px] font-semibold text-blue-500 uppercase tracking-wide mb-1.5">
          Question {(session?.turnsAnswered ?? 0) + 1}
        </p>
        <p className="text-lg font-bold text-gray-900 mb-5 leading-snug">{session?.currentQuestion}</p>

        <div className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video mb-4">
          <video
            ref={videoPreviewRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
          {recordPhase === 'recording' && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-red-600 text-white text-[11px] font-bold px-2 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              REC
            </div>
          )}
          {recordPhase === 'recorded' && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-emerald-600 text-white text-[11px] font-bold px-2 py-1 rounded-full">
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

        {errorMessage && <p className="text-xs text-red-500 mb-3">{errorMessage}</p>}

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

        <p className="text-center text-[11px] text-gray-400 mt-4">
          No account needed. Your answers help your recruiter present you to this role.
        </p>
      </div>
    </div>
  );
}
