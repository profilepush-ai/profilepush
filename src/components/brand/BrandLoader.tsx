import type { CSSProperties } from 'react';

// The ProfilePush loader, from the logo: its yellow and orange dots drop in
// and click together (a match), then its blue chevron pushes forward in
// beats with a faint echo behind it. The big one adds a separate bar below
// that fills a step with each push while the % ticks up. Brand colours only.
// The motion lives in index.css (.pp-ld-*).

// The logo mark: two stacked dots and the chevron, as in Logo.tsx.
export function LoaderMark({ height }: { height: number }) {
  const vars = { '--drop': '7px', '--push': '3px' } as CSSProperties;
  return (
    <svg width={(height * 26) / 24} height={height} viewBox="0 0 26 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, display: 'inline-block', overflow: 'visible' }}>
      <circle className="pp-ld-ring" cx="5" cy="12" r="8" stroke="#2563EB" strokeWidth="1.2" />
      <circle className="pp-ld-dot-a" style={vars} cx="5" cy="7.6" r="3.6" fill="#FACC15" />
      <circle className="pp-ld-dot-b" style={vars} cx="5" cy="16.4" r="3.6" fill="#F97316" />
      <polyline className="pp-ld-echo" style={vars} points="13,4.5 20,12 13,19.5" stroke="#2563EB" strokeOpacity=".3" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline className="pp-ld-push" style={vars} points="13,4.5 20,12 13,19.5" stroke="#2563EB" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function BrandLoader({ width = 200, label, pct = true }: { width?: number; label?: string; pct?: boolean }) {
  return (
    <span role="status" aria-label={label ?? 'Loading'} className="inline-flex flex-col items-center gap-4">
      <LoaderMark height={Math.round(width * 0.24)} />
      {/* A plain progress bar, apart from the mark. */}
      <span className="inline-flex items-center gap-2.5">
        <span className="block h-1.5 overflow-hidden rounded-full bg-[#C8D7FA]" style={{ width: width * 0.8 }}>
          <i className="pp-ld-bar block h-full rounded-full bg-[#2563EB]" />
        </span>
        {pct && <b aria-hidden="true" className="pp-ld-pct w-[3.2ch] text-left text-[13px] font-extrabold tabular-nums text-[#0B1A3A]" />}
      </span>
      {label && <span className="text-[13px] font-semibold text-gray-500">{label}</span>}
    </span>
  );
}
