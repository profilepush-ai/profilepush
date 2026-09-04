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
}

type PageStatus = 'loading' | 'invalid' | 'active' | 'completed' | 'worker_not_configured';
type RecordPhase = 'requesting_camera' | 'camera_denied' | 'preview' | 'recording' | 'recorded' | 'submitting';

const MAX_RECORDING_MS = 90_000;

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

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const recordedVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBlobRef = useRef<Blob | null>(null);
  const recordedUrlRef = useRef<string>('');
  const recordedMimeTypeRef = useRef<string>('');
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSession = useCallback(async () => {
    if (!token) { setPageStatus('invalid'); return; }
    try {
      const res = await fetch(`${WORKER_URL}/screen/${encodeURIComponent(token)}`);
      if (!res.ok) { setPageStatus('invalid'); return; }
      const data = (await res.json()) as SessionState;
      setSession(data);
      setPageStatus(data.done ? 'completed' : 'active');
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
    if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
    if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
  }, [stopCamera]);

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const mimeType = pickMimeType();
    recordedMimeTypeRef.current = mimeType || 'video/webm';
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 800_000,
      audioBitsPerSecond: 64_000,
    });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      if (maxDurationTimerRef.current) { clearTimeout(maxDurationTimerRef.current); maxDurationTimerRef.current = null; }
      const blob = new Blob(chunksRef.current, { type: recordedMimeTypeRef.current });
      recordedBlobRef.current = blob;
      if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
      recordedUrlRef.current = URL.createObjectURL(blob);
      if (recordedVideoRef.current) recordedVideoRef.current.src = recordedUrlRef.current;
      setRecordPhase('recorded');
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecordPhase('recording');
    // Hard stop so a candidate can't record indefinitely — bounds storage
    // cost per answer regardless of backend.
    maxDurationTimerRef.current = setTimeout(() => {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    }, MAX_RECORDING_MS);
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  function retake() {
    recordedBlobRef.current = null;
    if (recordedUrlRef.current) { URL.revokeObjectURL(recordedUrlRef.current); recordedUrlRef.current = ''; }
    setRecordPhase('preview');
  }

  async function submitAnswer() {
    const blob = recordedBlobRef.current;
    const turnIndex = session?.currentTurnIndex;
    if (!blob || turnIndex === null || turnIndex === undefined || !token) return;

    setRecordPhase('submitting');
    setErrorMessage('');
    try {
      const answerRes = await fetch(`${WORKER_URL}/screen/${encodeURIComponent(token)}/answer/${turnIndex}`, {
        method: 'POST',
        headers: { 'Content-Type': recordedMimeTypeRef.current || blob.type || 'video/webm' },
        body: blob,
      });
      const answerPayload = (await answerRes.json()) as { done?: boolean; nextTurnIndex?: number; nextQuestion?: string; error?: string };
      if (!answerRes.ok) throw new Error(answerPayload.error || 'Could not process your answer');

      if (answerPayload.done) {
        stopCamera();
        setPageStatus('completed');
        return;
      }

      setSession((prev) => prev && ({
        ...prev,
        turnsAnswered: prev.turnsAnswered + 1,
        currentTurnIndex: answerPayload.nextTurnIndex ?? null,
        currentQuestion: answerPayload.nextQuestion ?? null,
      }));
      retake();
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
            className={`w-full h-full object-cover ${recordPhase === 'recorded' || recordPhase === 'submitting' ? 'hidden' : ''}`}
          />
          <video
            ref={recordedVideoRef}
            controls
            playsInline
            className={`w-full h-full object-cover ${recordPhase === 'recorded' || recordPhase === 'submitting' ? '' : 'hidden'}`}
          />
          {recordPhase === 'recording' && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-red-600 text-white text-[11px] font-bold px-2 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              REC
            </div>
          )}
          {recordPhase === 'requesting_camera' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <LogoSpinner size={20} />
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
              <button
                onClick={retake}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm px-4 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <RotateCcw size={14} />
                Retake
              </button>
              <button
                onClick={() => void submitAnswer()}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-4 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-md shadow-emerald-900/20"
              >
                <CheckCircle2 size={15} />
                Submit & Next
              </button>
            </>
          )}
          {recordPhase === 'submitting' && (
            <button disabled className="w-full bg-emerald-600 opacity-70 text-white font-bold text-sm px-6 py-3 rounded-xl flex items-center justify-center gap-2">
              <LogoSpinner size={15} />
              Reviewing your answer…
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
