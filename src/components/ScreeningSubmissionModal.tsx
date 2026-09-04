import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Video, X } from 'lucide-react';
import { buildSupabaseFunctionHeaders, supabase } from '../lib/supabase';
import LogoSpinner from './LogoSpinner';

const WORKER_URL = (import.meta.env.VITE_SCREENING_WORKER_URL ?? '').trim();

export interface ScreeningTurn {
  id: string;
  turn_index: number;
  question_text: string;
  video_offset_ms: number | null;
  answered_at: string | null;
}

// The interview is one continuous video now (not one clip per question), so
// this fetches it once and seeks a persistent <video> to each question's
// stored offset on Previous/Next, instead of swapping between separate
// per-turn clips.
export default function ScreeningSubmissionModal({
  applicationId,
  turns,
  onClose,
  showToast,
}: {
  applicationId: string;
  turns: ScreeningTurn[];
  onClose: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const sorted = [...turns].sort((a, b) => a.turn_index - b.turn_index);
  const [index, setIndex] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Distinguishes "no recording exists for this application" (expected for
  // applications from before video was tracked per-application, or one that
  // never finished the interview) from a genuine load failure — these need
  // different messaging, not one generic error.
  const [notFound, setNotFound] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const current = sorted[index];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    void (async () => {
      try {
        const headers = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
        const res = await fetch(`${WORKER_URL}/video/${applicationId}`, { headers: headers as Record<string, string> });
        if (cancelled) return;
        if (res.status === 404) {
          setLoading(false);
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          setLoading(false);
          showToast('Could not load this video', 'error');
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        setVideoUrl(URL.createObjectURL(blob));
        setLoading(false);
      } catch {
        if (!cancelled) {
          setLoading(false);
          showToast('Could not load this video', 'error');
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => {
    if (!videoRef.current || !current || current.video_offset_ms == null) return;
    videoRef.current.currentTime = current.video_offset_ms / 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, videoUrl]);

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-[#1B1D21]">
        <div className="flex items-start gap-2.5 border-b border-gray-100 p-4 dark:border-white/10">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
            <Video size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#94A3B8]">
              Question {index + 1} of {sorted.length}
            </p>
            <p className="text-[13px] font-semibold leading-snug text-gray-900 dark:text-slate-100">{current.question_text}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="aspect-video w-full bg-black">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              className="h-full w-full"
              controls
              playsInline
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-6 text-center">
              {loading ? <LogoSpinner size={20} /> : notFound ? (
                <p className="text-[12px] text-white/60">No recording is available for this application.</p>
              ) : (
                <p className="text-[12px] text-white/60">Could not load this video</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 p-3 dark:border-white/10">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/5"
          >
            <ChevronLeft size={14} />
            Previous
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(sorted.length - 1, i + 1))}
            disabled={index === sorted.length - 1}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/5"
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
