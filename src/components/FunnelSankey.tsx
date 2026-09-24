import type { FunnelFlow, FlowNode } from '../lib/admin-funnel';
import { formatRate } from '../lib/admin-funnel';

// The journey as an indented tree.
//
// Three shapes were tried here before this one. Horizontal bars were not a
// funnel. A funnel pinched to zero and then widened, because after AI Match
// the stages stop being subsets of each other and a funnel chart cannot say
// that. A hand-drawn Sankey then rendered as a blob, because a 100-unit
// viewBox stretched across 800 pixels inflates every stroke with it.
//
// This is a tree, which is what GA4 and the other path-exploration tools use
// for exactly this shape of question, and it has three things the others did
// not. Branching is native — a node simply has more than one child. Nothing
// is distorted, because the only geometry is a bar whose width is a
// percentage. And it stays readable at these numbers: a cohort here is nine
// accounts, and nine accounts do not need a flow diagram, they need to be
// legible.
//
// Percentages are of the parent, not of the top. "Half of the people who got
// this far continued" is the question being asked at each step; share of the
// original cohort is already on the summary cards above.

type Props = { flow: FunnelFlow; hex: string; rangeLabel: string; personaLabel: string; accent: string };

export default function FunnelSankey({ flow, hex, rangeLabel, personaLabel, accent }: Props) {
  const { nodes, links, cohort } = flow;
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const childrenOf = (key: string) =>
    links.filter((l) => l.from === key).map((l) => byKey.get(l.to)).filter((n): n is FlowNode => Boolean(n));

  const root = byKey.get('cohort');

  const renderNode = (node: FlowNode, parent: FlowNode | null, depth: number, isLast: boolean) => {
    const children = childrenOf(node.key);
    const shareOfParent = !parent || parent.count === 0 ? 1 : node.count / parent.count;
    const barPct = cohort === 0 ? 0 : (node.count / cohort) * 100;

    return (
      <div key={node.key}>
        <div className="flex items-center gap-2 py-[3px]" style={{ paddingLeft: depth * 18 }}>
          {depth > 0 && (
            <span className="select-none font-mono text-[11px] leading-none text-gray-300" aria-hidden="true">
              {isLast ? '└' : '├'}
            </span>
          )}

          <span className="w-[26px] shrink-0 text-right text-[12px] font-semibold tabular-nums text-gray-900">
            {node.count}
          </span>

          {/* Width is a plain percentage of the cohort, so nothing can be
              distorted by the container the way the SVG was. */}
          <span className="h-[7px] w-[84px] shrink-0 overflow-hidden rounded-full bg-gray-100">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${node.count === 0 ? 0 : Math.max(4, barPct)}%`,
                backgroundColor: hex,
                opacity: node.stopped ? 0.35 : 1,
              }}
            />
          </span>

          <span className={`min-w-0 truncate text-[12px] ${node.stopped ? 'text-gray-400' : 'text-gray-800'}`}>
            {node.label}
          </span>

          <span className="ml-auto shrink-0 pl-2 text-[10px] tabular-nums text-gray-400">
            {parent ? `${formatRate(shareOfParent)} of ${parent.count}` : `${cohort} total`}
            {node.note ? ` · ${node.note}` : ''}
          </span>
        </div>

        {children.map((child, index) => renderNode(child, node, depth + 1, index === children.length - 1))}
      </div>
    );
  };

  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white">
      <div className="flex items-baseline justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${accent}`} />
          <h2 className="text-sm font-semibold text-gray-900">{personaLabel}</h2>
        </div>
        <span className="text-[10px] text-gray-400">{rangeLabel}</span>
      </div>

      {cohort === 0 || !root ? (
        <p className="px-4 py-10 text-center text-sm text-gray-400">
          No {personaLabel.toLowerCase()} signed up in this range.
        </p>
      ) : (
        <div className="overflow-x-auto px-3 py-3">
          <div className="min-w-[440px]">{renderNode(root, null, 0, true)}</div>
        </div>
      )}
    </div>
  );
}
