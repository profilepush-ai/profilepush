export type GlossaryTerm = { term: string; definition: string };

export default function GlossaryList({ terms }: { terms: GlossaryTerm[] }) {
  return (
    <dl className="divide-y divide-gray-100">
      {terms.map((entry) => (
        <div key={entry.term} className="py-3 first:pt-0">
          <dt className="text-sm font-semibold text-gray-800">{entry.term}</dt>
          <dd className="mt-1 text-sm leading-6 text-gray-600">{entry.definition}</dd>
        </div>
      ))}
    </dl>
  );
}
