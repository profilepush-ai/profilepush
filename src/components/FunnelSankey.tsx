import type { FunnelGraph, FunnelNode } from '../lib/admin-funnel';
import { formatRate } from '../lib/admin-funnel';

// The journey drawn as flows rather than a taper.
//
// A funnel can only say how far people got. It cannot say which way they went,
// and after AI Match there is more than one way: previewing costs nothing,
// generating a draft costs a credit, and sending needs a mailbox connected
// first. Those are different decisions and they deserve different arms.
//
// Laid out by hand rather than with a charting library. The last chart here
// was recharts and it had to come out — 300kB for a shape that collapsed as
// soon as a band went to zero, which this data does routinely.
//
// Rows, not columns: there are eight or nine steps with long labels, and on a
// dashboard that is already two personas wide, a left-to-right Sankey gives
// each step about forty pixels and nowhere to put its name.

const ROW_H = 52;
const LINK_H = 26;
const BAR_MAX = 190;

type Props = { graph: FunnelGraph; hex: string; rangeLabel: string; personaLabel: string; accent: string };

function barWidth(node: FunnelNode, cohort: number): number {
  if (cohort === 0) return 0;
  // A node nobody reached still gets a sliver, otherwise the diagram just
  // stops and everything below it reads as a rendering fault rather than a
  // result. Anything above zero is at least visible.
  return node.count === 0 ? 3 : Math.max(6, (node.count / cohort) * BAR_MAX);
}

export default function FunnelSankey({ graph, hex, rangeLabel, personaLabel, accent }: Props) {
  const { nodes, links, cohort } = graph;
  const byKey = new Map(nodes.map((n) => [n.key, n]));

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
        <div className="px-3 py-3">
          {nodes.map((node) => {
            // Every link into this node, so a node fed by more than one arm
            // shows each of them rather than an unexplained total.
            const incoming = links.filter((l) => l.to === node.key);
            const width = barWidth(node, cohort);

            return (
              <div key={node.key}>
                {incoming.map((link) => {
                  const source = byKey.get(link.from);
                  if (!source) return null;
                  const lost = source.count - link.count;
                  const rate = source.count === 0 ? 0 : link.count / source.count;
                  return (
                    <div
                      key={`${link.from}-${link.to}`}
                      className="flex items-center gap-2"
                      style={{ height: LINK_H, paddingLeft: node.aside ? 26 : 0 }}
                    >
                      {/* The flow itself: as wide as the accounts that did
                          both ends, so it can never claim more than either. */}
                      <span
                        className="block shrink-0 rounded-full"
                        style={{
                          width: Math.max(2, barWidth({ ...source, count: link.count }, cohort)),
                          height: 6,
                          backgroundColor: hex,
                          opacity: 0.28,
                        }}
                      />
                      <span className="truncate text-[10px] text-gray-400">
                        {node.aside ? '↳ ' : ''}
                        {formatRate(rate)} of {source.label.toLowerCase()}
                        {lost > 0 && !node.aside ? ` · ${lost} lost` : ''}
                      </span>
                    </div>
                  );
                })}

                <div className="flex items-center gap-2" style={{ height: ROW_H, paddingLeft: node.aside ? 26 : 0 }}>
                  <span
                    className="block shrink-0 rounded"
                    style={{
                      width,
                      height: node.aside ? 14 : 22,
                      backgroundColor: node.count === 0 ? '#e5e7eb' : hex,
                      opacity: node.aside ? 0.55 : 1,
                    }}
                  />
                  <div className="min-w-0">
                    <p className={`truncate leading-tight ${node.aside ? 'text-[11px] text-gray-500' : 'text-[12px] font-medium text-gray-900'}`}>
                      {node.label}
                    </p>
                    <p className="text-[10px] leading-tight text-gray-400">
                      <span className="font-semibold tabular-nums text-gray-700">{node.count}</span>
                      {' · '}{formatRate(node.overallRate)} of top
                      {/* Said on the node, because a number that means
                          something narrower than its label is worse than no
                          number at all. */}
                      {node.note ? ` · ${node.note}` : ''}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
