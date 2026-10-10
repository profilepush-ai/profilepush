// The "push" when the deck moves on: a snapshot of the card that's leaving
// slides off one side while the next card slides in from the other, as if
// shoved out by it. Returns false when motion is reduced (nothing moves).
export const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export const PUSH_MS = 360;
export const PUSH_EASE = 'cubic-bezier(.25,.8,.25,1)';

export function pushGhost(shell: HTMLElement | null, nodes: Array<HTMLElement | null>, to: 1 | -1): boolean {
  if (!shell || reducedMotion()) return false;
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '15' });
  for (const node of nodes) {
    if (!node) continue;
    const ghost = node.cloneNode(true) as HTMLElement;
    // Where it sits without any drag (offsets ignore transforms), and how it's dragged now.
    const from = node.style.transform || 'none';
    Object.assign(ghost.style, {
      position: 'absolute', margin: '0', left: `${node.offsetLeft}px`, top: `${node.offsetTop}px`,
      width: `${node.offsetWidth}px`, height: `${node.offsetHeight}px`, transition: 'none', animation: 'none', opacity: '1',
    });
    // Its parts show as they are now, not replaying their entrances.
    ghost.querySelectorAll<HTMLElement>('*').forEach((el) => { el.style.animation = 'none'; });
    layer.appendChild(ghost);
    ghost.animate(
      [{ transform: from, opacity: 1 }, { transform: `translateX(${to * 100}%) rotate(${to * 3}deg)`, opacity: 0.4 }],
      { duration: PUSH_MS, easing: PUSH_EASE, fill: 'forwards' },
    );
  }
  shell.appendChild(layer);
  window.setTimeout(() => layer.remove(), PUSH_MS + 40);
  return true;
}
