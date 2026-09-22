import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  buildHighlights,
  buildIssues,
  experimentsForWeek,
  weekStartOf,
  type BriefLine,
  type MetricSeries,
} from '../lib/admin-briefing';

type Props = {
  metrics: MetricSeries[];
  /** Things known to be broken outside the data, ranked above anything derived. */
  blockers?: BriefLine[];
};

type Tick = { experiment_key: string; tried: boolean };

async function callChecklist(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('admin-checklist', {
    body: { password: sessionStorage.getItem('admin_authed') || '', ...body },
  });
  if (error || data?.error) throw new Error(error?.message || data.error);
  return data;
}

export default function AdminDailyBriefing({ metrics, blockers = [] }: Props) {
  const week = weekStartOf();
  const experiments = experimentsForWeek(week);
  const highlights = buildHighlights(metrics);
  const issues = buildIssues(metrics, blockers);

  const [tried, setTried] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await callChecklist({ action: 'list', week_start: week });
      const map: Record<string, boolean> = {};
      for (const tick of (data.ticks as Tick[]) ?? []) map[tick.experiment_key] = tick.tried;
      setTried(map);
      setError('');
    } catch (err) {
      // The briefing still reads correctly without ticks, so a failure here
      // must not blank the highlights and issues beside it.
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [week]);

  useEffect(() => { void load(); }, [load]);

  async function toggle(key: string) {
    const next = !tried[key];
    setSaving(key);
    // Optimistic: the tick is the whole interaction, and waiting on a round
    // trip to see a checkbox move makes it feel broken.
    setTried((current) => ({ ...current, [key]: next }));
    try {
      await callChecklist({ action: 'toggle', week_start: week, experiment_key: key, tried: next });
      setError('');
    } catch (err) {
      setTried((current) => ({ ...current, [key]: !next }));
      setError((err as Error).message);
    } finally {
      setSaving(null);
    }
  }

  const column = (
    title: string,
    Icon: typeof CheckCircle2,
    iconClass: string,
    lines: BriefLine[],
    emptyText: string,
  ) => (
    <div className="min-w-0 flex-1 border-b border-gray-200 p-3 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon size={13} className={iconClass} />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      </div>
      {lines.length === 0 ? (
        <p className="text-xs text-gray-400">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {lines.map((line) => (
            <li key={line.key} className="flex gap-1.5 text-xs leading-snug text-gray-700">
              <span
                className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${
                  line.tone === 'good' ? 'bg-green-500' : line.tone === 'bad' ? 'bg-red-500' : 'bg-gray-300'
                }`}
              />
              <span className="min-w-0">{line.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-col md:flex-row">
        {column('Highlights', CheckCircle2, 'text-green-600', highlights, 'Nothing stood out in this range.')}
        {column('Fix now', AlertTriangle, 'text-red-600', issues, 'Nothing needs attention right now.')}

        <div className="min-w-0 flex-1 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <FlaskConical size={13} className="text-blue-600" />
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Try this week</h3>
            </div>
            {loading && <Loader2 size={11} className="animate-spin text-gray-300" />}
          </div>
          <ul className="space-y-1.5">
            {experiments.map((experiment) => (
              <li key={experiment.key}>
                <label className="flex cursor-pointer gap-2 text-xs leading-snug text-gray-700">
                  <input
                    type="checkbox"
                    checked={Boolean(tried[experiment.key])}
                    disabled={saving === experiment.key}
                    onChange={() => void toggle(experiment.key)}
                    className="mt-0.5 h-3 w-3 shrink-0 cursor-pointer rounded border-gray-300 text-blue-600"
                  />
                  <span className={`min-w-0 ${tried[experiment.key] ? 'text-gray-400 line-through' : ''}`}>
                    <span
                      className={`mr-1.5 rounded px-1 py-px text-[9px] font-semibold uppercase ${
                        experiment.owner === 'claude' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'
                      }`}
                      title={experiment.owner === 'claude'
                        ? 'Can be handed to Claude in chat — ticking records it as tried, it does not trigger anything'
                        : 'Needs a person: this one involves contacting real people'}
                    >
                      {experiment.owner === 'claude' ? 'Claude' : 'You'}
                    </span>
                    {experiment.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {error && <p className="mt-2 text-[11px] text-red-600">Ticks not saved: {error}</p>}
        </div>
      </div>
    </div>
  );
}
