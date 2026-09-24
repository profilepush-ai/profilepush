import type { FunnelGraph, FunnelNode } from '../lib/admin-funnel';
import { formatRate } from '../lib/admin-funnel';

// A funnel that branches.
//
// The shape is the tapering funnel, not a row of bars — bars were tried here
// before and rejected, because a bar chart with steps down it is a bar chart,
// and the thing worth seeing is the narrowing.
//
// What is new is that the narrowing forks. After AI Match there is more than
// one thing to do, and they are not the same decision: previewing costs
// nothing, generating a draft costs a credit, and sending needs a mailbox
// connected first. The spine is the paying line — generate, connect, send —
// and the side paths peel off it.
//
// Mass is deliberately not conserved at a fork, and it would be wrong to draw
// it as if it were. Previewing and generating are not exclusive: the same
// account can do both, so a true Sankey ribbon splitting one into two would
// claim a division that does not exist. A side path is drawn as an arm off
// the spine, and the spine keeps its full width.
//
// Hand-drawn SVG. The last charting library here was recharts and it came
// out: 300kB for a shape that collapsed whenever a band hit zero, which this
// data does routinely.

const ROW_H = 46;
const W = 100;
const ASIDE_CX = 74;

type Props = { graph: FunnelGraph; hex: string; rangeLabel: string; personaLabel: string; accent: string };

export default function FunnelSankey({ graph, hex, rangeLabel, personaLabel, accent }: Props) {
  const { nodes, links, cohort } = graph;
  const spine = nodes.filter((n) => !n.aside);
  const asideOf = (key: string) => nodes.find((n) => n.aside && links.some((l) => l.from === key && l.to === n.key));

  // A node nobody reached still needs a visible neck, or the funnel appears to
  // stop and every row under it reads as a rendering fault.
  const widthOf = (node: FunnelNode | undefined) =>
    !node || cohort === 0 ? 0 : Math.max(4, (node.count / cohort) * W);

  const linkRate = (from: string, to: string) => {
    const link = links.find((l) => l.from === from && l.to === to);
    const source = nodes.find((n) => n.key === from);
    if (!link || !source || source.count === 0) return 0;
    return link.count / source.count;
  };

  return (
    <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white">
      <div className="flex items-baseline justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${accent}`} />
          <h2 className="text-sm font-semibold text-gray-900">{personaLabel}</h2>
        </div>
        <span className="text-[10px] text-gray-400">{rangeLabel}</span>
      </div>

      {cohort === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-gray-400">
          No {personaLabel.toLowerCase()} signed up in this range.
        </p>
      ) : (
        <div className="px-3 py-2">
          {spine.map((node, index) => {
            const next = spine[index + 1];
            const wTop = widthOf(node);
            // The last row tapers gently rather than to a point, so the funnel
            // ends looking finished instead of truncated.
            const wBottom = next ? widthOf(next) : wTop * 0.75;
            const aside = asideOf(node.key);
            const wAside = widthOf(aside);
            const empty = node.count === 0;

            return (
              <div key={node.key}>
                <div className="flex items-stretch" style={{ height: ROW_H }}>
                  <div className="flex w-[104px] shrink-0 items-center justify-end pr-2 sm:w-[124px]">
                    <span className="truncate text-right text-[11px] leading-tight text-gray-600">{node.label}</span>
                  </div>

                  <div className="relative min-w-0 flex-1">
                    <svg viewBox={`0 0 ${W} ${ROW_H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
                      {/* The arm, drawn under the spine so the spine keeps its
                          edge where the two meet. */}
                      {aside && (
                        <polygon
                          points={`${(W + wTop) / 2 - 2},${ROW_H * 0.28} ${ASIDE_CX - wAside / 2},${ROW_H} ${ASIDE_CX + wAside / 2},${ROW_H} ${(W + wTop) / 2 - 2},${ROW_H * 0.52}`}
                          fill={hex}
                          opacity={0.3}
                        />
                      )}
                      <polygon
                        points={`${(W - wTop) / 2},0 ${(W + wTop) / 2},0 ${(W + wBottom) / 2},${ROW_H} ${(W - wBottom) / 2},${ROW_H}`}
                        fill={empty ? '#e5e7eb' : hex}
                        opacity={empty ? 1 : 1 - index * 0.08}
                      />
                    </svg>
                  </div>

                  <div className="flex w-[80px] shrink-0 flex-col items-end justify-center pl-2">
                    <span className="text-sm font-semibold leading-none tabular-nums text-gray-900">{node.count}</span>
                    <span className="mt-0.5 text-[10px] leading-none text-gray-400">{formatRate(node.overallRate)} of top</span>
                  </div>
                </div>

                {/* The arm's own label and count, indented so it reads as
                    hanging off the row above rather than continuing it. */}
                {aside && (
                  <div className="flex items-center" style={{ height: 26 }}>
                    <div className="w-[104px] shrink-0 sm:w-[124px]" />
                    <div className="min-w-0 flex-1 pl-[50%]">
                      <span className="truncate text-[10px] text-gray-500">
                        ↳ {aside.label} <span className="font-semibold tabular-nums text-gray-700">{aside.count}</span>
                        <span className="text-gray-400">
                          {' · '}{formatRate(linkRate(node.key, aside.key))} of {node.label.toLowerCase()}
                          {aside.note ? ` · ${aside.note}` : ''}
                        </span>
                      </span>
                    </div>
                    <div className="w-[80px] shrink-0" />
                  </div>
                )}

                {next && (
                  <div className="flex items-center" style={{ height: 16 }}>
                    <div className="w-[104px] shrink-0 sm:w-[124px]" />
                    <div className="min-w-0 flex-1 text-center">
                      <span className="text-[10px] text-gray-400">
                        {formatRate(linkRate(node.key, next.key))} continue
                        {node.count - next.count > 0 ? ` · ${node.count - next.count} lost` : ''}
                        {next.note ? ` · ${next.note}` : ''}
                      </span>
                    </div>
                    <div className="w-[80px] shrink-0" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
