// Lightweight hand-rolled SVG chart primitives for the /pulse dashboard —
// matches the existing no-dependency approach already used in
// BillingPage.tsx (MiniDonut/Sparkline) rather than adding a charting
// library for a handful of small visuals.

export type FunnelStage = { label: string; value: number };

// Horizontal bars that shrink stage-to-stage, with the conversion
// percentage (relative to the PREVIOUS stage, not the total) shown between
// each pair — this is what "funnel" means here, not just a bar chart.
export function FunnelChart({ stages, color }: { stages: FunnelStage[]; color: string }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div className="space-y-1.5">
      {stages.map((stage, i) => {
        const widthPct = Math.max((stage.value / max) * 100, stage.value > 0 ? 4 : 0);
        const prev = i > 0 ? stages[i - 1] : null;
        const conversionPct = prev && prev.value > 0 ? Math.round((stage.value / prev.value) * 100) : null;
        return (
          <div key={stage.label}>
            {conversionPct != null && (
              <p className="mb-0.5 pl-1 text-[10px] font-semibold text-gray-400">↓ {conversionPct}% of {prev!.label.toLowerCase()}</p>
            )}
            <div className="flex items-center gap-2">
              <div className="h-6 flex-1 overflow-hidden rounded bg-gray-100">
                {stage.value > 0 && (
                  <div
                    className="flex h-full items-center rounded px-2 text-[11px] font-bold text-white transition-all"
                    style={{ width: `${widthPct}%`, backgroundColor: color, minWidth: '28px' }}
                  >
                    {stage.value}
                  </div>
                )}
              </div>
              <span className="w-28 shrink-0 text-[11px] font-medium text-gray-600">{stage.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// Daily bar chart — two series (e.g. previews vs applications) as paired
// bars per day, with a legend, visible value labels above each bar (when
// there's room), and a date axis below. Height-normalized to the max value
// across both series so the two are visually comparable.
export function DailyBarChart({ data, series, height = 100 }: {
  data: Array<Record<string, number | string>>;
  series: Array<{ key: string; label: string; color: string }>;
  height?: number;
}) {
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const barGroupWidth = 100 / Math.max(data.length, 1);
  const showValueLabels = data.length <= 14;
  const dateLabelStep = data.length <= 10 ? 1 : data.length <= 31 ? 5 : 14;
  return (
    <div>
      <div className="flex items-end gap-0.5" style={{ height: height + (showValueLabels ? 16 : 0) }}>
        {data.map((d) => (
          <div key={String(d.date)} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5" style={{ maxWidth: `${barGroupWidth}%` }}>
            {showValueLabels && (
              <div className="flex items-end gap-[1.5px] text-[9px] font-bold leading-none text-gray-500">
                {series.map((s) => {
                  const value = Number(d[s.key]) || 0;
                  return <span key={s.key} className="min-w-[3px] text-center">{value > 0 ? value : ''}</span>;
                })}
              </div>
            )}
            <div className="flex w-full flex-1 items-end justify-center gap-[1.5px]" style={{ height }}>
              {series.map((s) => {
                const value = Number(d[s.key]) || 0;
                const h = Math.max((value / max) * (height - 4), value > 0 ? 2 : 0);
                return (
                  <div
                    key={s.key}
                    title={`${d.date}: ${value} ${s.label}`}
                    className="flex-1 rounded-t-sm transition-all"
                    style={{ height: h, backgroundColor: s.color, minWidth: '3px' }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex items-end gap-0.5">
        {data.map((d, i) => (
          <div key={String(d.date)} className="flex-1 text-center" style={{ maxWidth: `${barGroupWidth}%` }}>
            {i % dateLabelStep === 0 && (
              <span className="text-[9px] text-gray-400">{formatShortDate(String(d.date))}</span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// A single-row activity heatmap — one cell per day in range, color
// intensity scaled to that day's combined activity volume.
export function HeatmapStrip({ data, valueKeys, color }: {
  data: Array<Record<string, number | string>>;
  valueKeys: string[];
  color: string;
}) {
  const totals = data.map((d) => valueKeys.reduce((sum, k) => sum + (Number(d[k]) || 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <div className="flex gap-1">
      {data.map((d, i) => {
        const intensity = totals[i] / max;
        const opacity = totals[i] === 0 ? 0.06 : 0.15 + intensity * 0.85;
        return (
          <div
            key={String(d.date)}
            title={`${d.date}: ${totals[i]}`}
            className="h-5 flex-1 rounded-sm"
            style={{ backgroundColor: color, opacity }}
          />
        );
      })}
    </div>
  );
}
