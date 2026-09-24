import type { FunnelFlow } from '../lib/admin-funnel';
import { formatRate } from '../lib/admin-funnel';

// A Sankey, because the journey branches.
//
// Two earlier attempts here were wrong in instructive ways. Horizontal bars
// were not a funnel at all. The funnel that replaced them pinched to zero at
// "Generated a draft" and then widened again below it, because the nodes were
// counted independently and drawn as if they were nested — a funnel chart
// assumes every stage is a subset of the one above, and after AI Match that
// stops being true.
//
// A flow diagram is the form for branching paths, and buildFunnelFlow makes
// the flows conserve: every account leaving a node arrives at exactly one
// child, including a "stopped" child for those who went no further. So a
// ribbon can never be wider than its source, and the picture cannot claim
// more traffic than exists.
//
// Drawn by hand. A charting library was tried here before — recharts, 300kB —
// and came out because the shape collapsed whenever a band hit zero, which
// this data does routinely.

const NODE_W = 11;
const GAP_Y = 9;
const PAD_Y = 10;
const MIN_H = 3;

type Props = { flow: FunnelFlow; hex: string; rangeLabel: string; personaLabel: string; accent: string };

type Placed = { key: string; x: number; y: number; h: number };

export default function FunnelSankey({ flow, hex, rangeLabel, personaLabel, accent }: Props) {
  const { nodes, links, cohort, maxDepth } = flow;

  // Height is driven by the busiest column, so nothing overlaps at any range.
  const perDepth = new Map<number, typeof nodes>();
  for (const node of nodes) perDepth.set(node.depth, [...(perDepth.get(node.depth) ?? []), node]);
  const tallest = Math.max(...[...perDepth.values()].map((column) => column.length));
  const H = Math.max(210, tallest * 34 + PAD_Y * 2);
  const W = 100;
  const colX = (depth: number) => (maxDepth === 0 ? 0 : (depth / maxDepth) * (W - NODE_W));

  // A count of zero still gets a hairline: a gap where a node should be reads
  // as a broken render rather than as nobody getting there.
  const heightFor = (count: number) => {
    if (cohort === 0) return MIN_H;
    const usable = H - PAD_Y * 2 - (tallest - 1) * GAP_Y;
    return count === 0 ? MIN_H : Math.max(MIN_H, (count / cohort) * usable);
  };

  const placed = new Map<string, Placed>();
  for (const [depth, column] of perDepth) {
    const total = column.reduce((sum, n) => sum + heightFor(n.count), 0) + (column.length - 1) * GAP_Y;
    let y = Math.max(PAD_Y, (H - total) / 2);
    for (const node of column) {
      const h = heightFor(node.count);
      placed.set(node.key, { key: node.key, x: colX(depth), y, h });
      y += h + GAP_Y;
    }
  }

  const byKey = new Map(nodes.map((n) => [n.key, n]));

  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white">
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
        <div className="overflow-x-auto px-3 py-3">
          <div className="min-w-[680px]">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} role="img"
              aria-label={`${personaLabel} journey: ${nodes.map((n) => `${n.label} ${n.count}`).join(', ')}`}>
              {/* Ribbons first, so node blocks sit on top of where they join. */}
              {links.map((link) => {
                const from = placed.get(link.from);
                const to = placed.get(link.to);
                const target = byKey.get(link.to);
                if (!from || !to || !target) return null;
                const thickness = Math.max(0.8, heightFor(link.count));
                const x1 = from.x + NODE_W;
                const x2 = to.x;
                const mid = (x1 + x2) / 2;
                const y1 = from.y + from.h / 2;
                const y2 = to.y + to.h / 2;
                return (
                  <path
                    key={`${link.from}-${link.to}`}
                    d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                    stroke={hex}
                    strokeWidth={thickness}
                    strokeOpacity={target.stopped ? 0.14 : 0.32}
                    fill="none"
                  />
                );
              })}

              {nodes.map((node) => {
                const box = placed.get(node.key);
                if (!box) return null;
                return (
                  <rect
                    key={node.key}
                    x={box.x} y={box.y} width={NODE_W} height={box.h} rx={1.5}
                    fill={node.count === 0 ? '#e5e7eb' : hex}
                    opacity={node.stopped ? 0.4 : 1}
                  />
                );
              })}
            </svg>

            {/* Labels as HTML under the diagram rather than as SVG text: the
                viewBox scales horizontally, which would stretch any text
                drawn inside it. */}
            <div className="mt-2 grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: `repeat(${maxDepth + 1}, minmax(0, 1fr))` }}>
              {[...perDepth.entries()].sort((a, b) => a[0] - b[0]).map(([depth, column]) => (
                <div key={depth} className="min-w-0">
                  {column.map((node) => (
                    <p key={node.key} className={`truncate text-[10px] leading-snug ${node.stopped ? 'text-gray-400' : 'text-gray-700'}`}>
                      <span className="font-semibold tabular-nums">{node.count}</span>{' '}
                      {node.label}
                      <span className="text-gray-400">
                        {' · '}{formatRate(node.overallRate)}
                        {node.note ? ` · ${node.note}` : ''}
                      </span>
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
