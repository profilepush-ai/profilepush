interface LogoSpinnerProps {
  size?: number;
}

/**
 * Animated logo icon used in place of loading spinners.
 * Sequence (2 s loop): dot1 appears → dot2 appears → chevron slides right → reset.
 */
export default function LogoSpinner({ size = 16 }: LogoSpinnerProps) {
  const h = size;
  const r = h * 0.18;
  const gap = h * 0.1;
  const dotsH = r * 2 * 2 + gap;
  const topY = (h - dotsH) / 2;
  const cy1 = topY + r;
  const cy2 = cy1 + r * 2 + gap;
  const cx = r + 1;
  const chevX1 = cx * 2 + r + 2;
  const chevMid = h / 2;
  const chevW = h * 0.38;
  const totalW = chevX1 + chevW + 4;
  const sw = Math.max(1.5, h * 0.14);

  return (
    <svg
      width={totalW}
      height={h}
      viewBox={`0 0 ${totalW} ${h}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'inline-block' }}
    >
      {/* Dot 1 — yellow, appears at 0 % */}
      <circle cx={cx} cy={cy1} r={r} fill="#facc15">
        <animate
          attributeName="opacity"
          values="0;1;1;1;0"
          keyTimes="0;0.12;0.6;0.85;1"
          dur="2s"
          repeatCount="indefinite"
        />
      </circle>

      {/* Dot 2 — orange, appears at ~25 % */}
      <circle cx={cx} cy={cy2} r={r} fill="#f97316">
        <animate
          attributeName="opacity"
          values="0;0;1;1;0"
          keyTimes="0;0.25;0.4;0.85;1"
          dur="2s"
          repeatCount="indefinite"
        />
      </circle>

      {/* Chevron — blue, slides right between 50–75 % */}
      <polyline
        points={`${chevX1},${topY} ${chevX1 + chevW},${chevMid} ${chevX1},${topY + dotsH}`}
        stroke="#2563eb"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <animate
          attributeName="opacity"
          values="0;0;1;1;0"
          keyTimes="0;0.45;0.55;0.85;1"
          dur="2s"
          repeatCount="indefinite"
        />
        <animateTransform
          attributeName="transform"
          type="translate"
          values={`-${chevW * 0.5},0; -${chevW * 0.5},0; ${chevW * 0.4},0; ${chevW * 0.4},0; ${chevW * 0.4},0`}
          keyTimes="0;0.45;0.75;0.85;1"
          dur="2s"
          repeatCount="indefinite"
        />
      </polyline>
    </svg>
  );
}
