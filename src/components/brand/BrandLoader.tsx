// The ProfilePush loader is the match score line: a pale blue track filling
// in brand blue a step at a time, the % at its end ticking up with it, like a
// match being scored. The motion lives in index.css (.pp-ld-bar, .pp-ld-pct).

/** The line alone, any size: inline spinners and buttons use a short one. */
export function ScoreLine({ width, thickness = 6 }: { width: number; thickness?: number }) {
  return (
    <span aria-hidden="true" className="inline-block shrink-0 overflow-hidden rounded-full bg-[#C8D7FA] align-middle" style={{ width, height: thickness }}>
      <i className="pp-ld-bar block h-full rounded-full bg-gradient-to-r from-[#2563EB] to-[#3b82f6]" />
    </span>
  );
}

/** The full loader: the line, its % and the word match; a label below if given. */
export default function BrandLoader({ width = 200, label, pct = true }: { width?: number; label?: string; pct?: boolean }) {
  return (
    <span role="status" aria-label={label ?? 'Loading'} className="inline-flex flex-col items-center gap-3">
      <span className="inline-flex items-center gap-2.5">
        <ScoreLine width={width} thickness={Math.max(6, Math.round(width / 26))} />
        {pct && (
          <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
            <b aria-hidden="true" className="pp-ld-pct w-[3.2ch] text-left text-[18px] font-extrabold tabular-nums text-[#0B1A3A]" />
            <small className="text-[12px] font-semibold text-gray-500">match</small>
          </span>
        )}
      </span>
      {label && <span className="text-[13px] font-semibold text-gray-500">{label}</span>}
    </span>
  );
}
