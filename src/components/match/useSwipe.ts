import { useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

// Left/right swipes on a scrolling view (touch and pen only, so dragging to
// select text with a mouse never counts). Vertical scrolling stays the
// browser's; a swipe that starts in a text field is ignored, and the tap a
// swipe could end on (say, a big Apply button) is swallowed.
export function useSwipe(onNext: () => void, onPrev: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  return {
    style: { touchAction: 'pan-y' as const },
    onPointerDown: (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      start.current = e.pointerType === 'mouse' || target.closest('input, textarea, select, [contenteditable="true"]')
        ? null : { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      swiped.current = true;
      window.setTimeout(() => { swiped.current = false; }, 350);
      if (dx < 0) onNext(); else onPrev();
    },
    onPointerCancel: () => { start.current = null; },
    onClickCapture: (e: MouseEvent) => {
      if (!swiped.current) return;
      e.stopPropagation();
      e.preventDefault();
      swiped.current = false;
    },
  };
}
