import { useEffect, useState } from 'react';

// Typewriter-cycles a search box placeholder through example queries: types a
// phrase out, pauses, deletes it, moves to the next. Same timing as the feed's
// search bar (PulsePage.tsx). With reduced motion it shows the first phrase.
export function useTypewriterPlaceholder(phrases: string[]): string {
  const [text, setText] = useState(phrases[0] ?? '');
  const key = phrases.join('\u0000');

  useEffect(() => {
    if (phrases.length === 0) { setText(''); return; }
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) { setText(phrases[0]); return; }

    let cancelled = false;
    let phraseIndex = 0;
    let charCount = 0;
    let isDeleting = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const TYPE_MS = 55;
    const DELETE_MS = 28;
    const PAUSE_AFTER_TYPE_MS = 1700;
    const PAUSE_AFTER_DELETE_MS = 300;

    const tick = () => {
      if (cancelled) return;
      const phrase = phrases[phraseIndex];
      if (!isDeleting) {
        charCount += 1;
        setText(phrase.slice(0, charCount));
        if (charCount >= phrase.length) {
          isDeleting = true;
          timeoutId = setTimeout(tick, PAUSE_AFTER_TYPE_MS);
          return;
        }
        timeoutId = setTimeout(tick, TYPE_MS);
        return;
      }
      charCount -= 1;
      setText(phrase.slice(0, charCount));
      if (charCount <= 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        timeoutId = setTimeout(tick, PAUSE_AFTER_DELETE_MS);
        return;
      }
      timeoutId = setTimeout(tick, DELETE_MS);
    };

    timeoutId = setTimeout(tick, TYPE_MS);
    return () => { cancelled = true; clearTimeout(timeoutId); };
    // phrases is compared by content via key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return text;
}
