import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';

export type FaqEntry = { q: string; a: string };

function FaqRow({ q, a }: FaqEntry) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-100 py-3 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-gray-800">{q}</span>
        {open ? <Minus size={14} className="shrink-0 text-gray-400" /> : <Plus size={14} className="shrink-0 text-gray-400" />}
      </button>
      {open && <p className="mt-2 text-sm leading-6 text-gray-600">{a}</p>}
    </div>
  );
}

export default function FaqAccordion({ items }: { items: FaqEntry[] }) {
  return (
    <div className="mt-3">
      {items.map((item) => (
        <FaqRow key={item.q} q={item.q} a={item.a} />
      ))}
    </div>
  );
}
