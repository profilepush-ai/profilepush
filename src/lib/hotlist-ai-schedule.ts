export type HotlistAiScheduleFrequency = 'disabled' | 'hourly' | 'daily' | 'twice_daily' | 'weekly';

export function isHotlistAiScheduleDue(
  lastRunAt: string | null | undefined,
  frequency: HotlistAiScheduleFrequency | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (frequency === 'disabled') return false;
  if (!lastRunAt) return true;

  const lastRun = new Date(lastRunAt);
  if (Number.isNaN(lastRun.getTime())) return true;

  const diffMs = now.getTime() - lastRun.getTime();
  const intervalMs = frequency === 'hourly'
    ? 60 * 60 * 1000
    : frequency === 'twice_daily'
      ? 12 * 60 * 60 * 1000
      : frequency === 'weekly'
        ? 7 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;

  return diffMs >= intervalMs;
}
