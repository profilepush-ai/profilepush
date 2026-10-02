import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Star, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { FEEDBACK_EVENT, takePendingFeedback } from '../lib/feedback';

// "How's ProfilePush working for you?" right after an AI Submit is sent:
// 1-5 stars, an optional comment, and consent to show the comment on
// profilepush.ai. Not again for 90 days after rating or 14 after closing
// (the server decides). Kept separate from Google Play's own review dialog,
// which Google doesn't allow to follow a question like this one.

const LABELS = ['', 'Not working for me', 'Needs work', 'It’s OK', 'Good', 'Love it'];

export default function FeedbackPrompt() {
  const { account } = useAuth();
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState('ai_submit');
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [canPublish, setCanPublish] = useState(false);
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!account?.id) return;
    const check = () => {
      const pending = takePendingFeedback();
      if (!pending) return;
      void supabase.rpc('claim_feedback_prompt' as never).then(({ data }) => {
        if (data === true) {
          setContext(pending);
          setRating(0);
          setComment('');
          setCanPublish(false);
          setState('idle');
          setError('');
          setOpen(true);
        }
      });
    };
    check();
    window.addEventListener(FEEDBACK_EVENT, check);
    return () => window.removeEventListener(FEEDBACK_EVENT, check);
  }, [account?.id]);

  if (!open) return null;

  function close() {
    if (state !== 'done') void supabase.rpc('dismiss_feedback_prompt' as never);
    setOpen(false);
  }

  async function submit() {
    if (!rating) return;
    setState('saving');
    setError('');
    const { error: rpcError } = await supabase.rpc('submit_app_feedback' as never, {
      p_rating: rating,
      p_comment: comment.trim() || null,
      p_can_publish: canPublish && comment.trim().length > 0,
      p_context: context,
      p_platform: Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web',
    } as never);
    if (rpcError) {
      setState('idle');
      setError('Couldn’t save that. Please try again.');
      return;
    }
    setState('done');
    window.setTimeout(() => setOpen(false), 1800);
  }

  const shown = hover || rating;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[85] flex justify-center p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:p-0">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
        {state === 'done' ? (
          <div className="py-2 text-center">
            <p className="text-[15px] font-bold text-gray-900">Thank you!</p>
            <p className="mt-1 text-[13px] text-gray-500">This helps us make ProfilePush better.</p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-bold text-gray-900">Sent! How&apos;s ProfilePush working for you?</p>
                <p className="mt-0.5 text-[12px] text-gray-500">Takes two seconds.</p>
              </div>
              <button type="button" onClick={close} className="-mr-1 -mt-1 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
                <X size={15} />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-1" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHover(n)}
                  className="rounded-md p-1 transition-transform hover:scale-110"
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                >
                  <Star size={28} className={n <= shown ? 'fill-amber-400 text-amber-400' : 'text-gray-300'} />
                </button>
              ))}
              {shown > 0 && <span className="ml-2 text-[12px] font-medium text-gray-600">{LABELS[shown]}</span>}
            </div>

            {rating > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                <textarea
                  id="feedback-comment"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={rating >= 4 ? 'What do you like most? (optional)' : 'What should we fix first? (optional)'}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] focus:border-blue-400 focus:outline-none"
                />
                {comment.trim().length > 0 && (
                  <label className="flex items-start gap-2 text-[12px] text-gray-600">
                    <input
                      id="feedback-can-publish"
                      type="checkbox"
                      checked={canPublish}
                      onChange={(e) => setCanPublish(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300"
                    />
                    OK to show my comment on profilepush.ai, with my first name and company
                  </label>
                )}
                {error && <p className="text-[12px] text-red-600">{error}</p>}
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={state === 'saving'}
                  className="h-10 rounded-xl bg-blue-600 text-[13px] font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {state === 'saving' ? 'Sending…' : 'Send feedback'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
