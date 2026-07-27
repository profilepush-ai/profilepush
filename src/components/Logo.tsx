interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  /** Force the text to white (e.g. on dark backgrounds) */
  white?: boolean;
}

const sizeMap = {
  sm: { text: 'text-sm', h: 14 },
  md: { text: 'text-base', h: 16 },
  lg: { text: 'text-lg', h: 20 },
};

export default function Logo({ size = 'md', white = false }: LogoProps) {
  const { text, h } = sizeMap[size];
  const textCls = white ? 'text-white' : 'text-gray-900';

  // Icon dimensions derived from h (total height of the icon group)
  const r = h * 0.18;          // dot radius
  const gap = h * 0.1;         // gap between dots
  const dotsH = r * 2 * 2 + gap; // total dots height
  const topY = (h - dotsH) / 2; // top of first dot centre
  const cy1 = topY + r;
  const cy2 = cy1 + r * 2 + gap;
  const cx = r + 1;
  const chevX1 = cx * 2 + r + 2;
  const chevMid = h / 2;
  const chevW = h * 0.38;
  const totalW = chevX1 + chevW + 2;

  return (
    <span className={`inline-flex items-center gap-1.5 font-extrabold tracking-tight select-none ${text} ${textCls}`}>
      ProfilePush
      <svg
        width={totalW}
        height={h}
        viewBox={`0 0 ${totalW} ${h}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        {/* Yellow dot */}
        <circle cx={cx} cy={cy1} r={r} fill="#facc15" />
        {/* Orange dot */}
        <circle cx={cx} cy={cy2} r={r} fill="#f97316" />
        {/* Blue chevron — height spans both dots */}
        <polyline
          points={`${chevX1},${topY} ${chevX1 + chevW},${chevMid} ${chevX1},${topY + dotsH}`}
          stroke="#2563eb"
          strokeWidth={Math.max(2, h * 0.14)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
