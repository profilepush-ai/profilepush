import { PUSH_EASE, PUSH_MS } from '../../lib/push';

// The ProfilePush mark (two dots and the chevron) riding the seam between the
// card leaving and the card coming in, with two fading chevrons behind it.
// `to` is where the cards move: -1 left (next, pass), 1 right (apply, back).
export default function PushStreak({ to }: { to: 1 | -1 }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[25] overflow-hidden">
      <div className="absolute inset-0" style={{ animation: `${to < 0 ? 'ppSeamL' : 'ppSeamR'} ${PUSH_MS}ms ${PUSH_EASE} both` }}>
        <svg width="112" height="64" viewBox="0 0 112 64" fill="none" className="absolute top-1/2 drop-shadow-[0_6px_14px_rgba(37,99,235,.35)]"
          style={to < 0 ? { left: -10, transform: 'translateY(-50%) scaleX(-1)' } : { right: -10, transform: 'translateY(-50%)' }}>
          <polyline points="4,14 22,32 4,50" stroke="#C8D7FA" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="26,12 46,32 26,52" stroke="#2563EB" strokeOpacity=".45" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="62" cy="21" r="7.5" fill="#FACC15" />
          <circle cx="62" cy="43" r="7.5" fill="#F97316" />
          <polyline points="78,8 102,32 78,56" stroke="#2563EB" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
