import type { CSSProperties } from 'react';

// The ProfilePush loader, from the logo: the yellow and orange dots drop in
// and click together (a match), then the blue chevron pushes along the match
// score line in ticks, filling it, while the % at its end ticks up. Brand
// colours only. The motion lives in index.css (.pp-ld-*).

type Geometry = { w: number; h: number; dotX: number; dotA: number; dotB: number; r: number; ring: number; x0: number; len: number; y: number; stroke: number; chev: string; drop: number };

// The big one (splash, page loads) and the small one (inline, in buttons).
const BIG: Geometry = { w: 240, h: 48, dotX: 12, dotA: 15, dotB: 33, r: 7, ring: 17, x0: 34, len: 192, y: 24, stroke: 6, chev: '-7,12 5,24 -7,36', drop: 14 };
const SMALL: Geometry = { w: 46, h: 24, dotX: 5, dotA: 7.5, dotB: 16.5, r: 3.6, ring: 8.5, x0: 13, len: 29, y: 12, stroke: 3.2, chev: '-3.2,6 2.8,12 -3.2,18', drop: 7 };

export function LoaderMark({ small = false, height }: { small?: boolean; height: number }) {
  const g = small ? SMALL : BIG;
  const vars = { '--x0': `${g.x0}px`, '--len': `${g.len}px`, '--drop': `${g.drop}px` } as CSSProperties;
  return (
    <svg width={(height * g.w) / g.h} height={height} viewBox={`0 0 ${g.w} ${g.h}`} fill="none" aria-hidden="true" style={{ flexShrink: 0, display: 'inline-block', overflow: 'visible' }}>
      <circle className="pp-ld-ring" cx={g.dotX} cy={g.y} r={g.ring} stroke="#2563EB" strokeWidth={small ? 1.2 : 2} />
      <circle className="pp-ld-dot-a" style={vars} cx={g.dotX} cy={g.dotA} r={g.r} fill="#FACC15" />
      <circle className="pp-ld-dot-b" style={vars} cx={g.dotX} cy={g.dotB} r={g.r} fill="#F97316" />
      {/* The match score line, and its fill behind the chevron. */}
      <line x1={g.x0} y1={g.y} x2={g.x0 + g.len} y2={g.y} stroke="#C8D7FA" strokeWidth={g.stroke} strokeLinecap="round" />
      <line className="pp-ld-fill" x1={g.x0} y1={g.y} x2={g.x0 + g.len} y2={g.y} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1}
        stroke="#2563EB" strokeWidth={g.stroke} strokeLinecap="round" />
      <polyline className="pp-ld-push" style={vars} points={g.chev} stroke="#2563EB" strokeWidth={g.stroke + (small ? 0.4 : 1)} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function BrandLoader({ width = 220, label, pct = true }: { width?: number; label?: string; pct?: boolean }) {
  return (
    <span role="status" aria-label={label ?? 'Loading'} className="inline-flex flex-col items-center gap-2.5">
      <span className="inline-flex items-center gap-2.5">
        <LoaderMark height={(width * BIG.h) / BIG.w} />
        {pct && <b aria-hidden="true" className="pp-ld-pct w-[3.2ch] text-left text-[15px] font-extrabold tabular-nums text-[#0B1A3A]" />}
      </span>
      {label && <span className="text-[13px] font-semibold text-gray-500">{label}</span>}
    </span>
  );
}
