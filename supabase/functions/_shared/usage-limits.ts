export const FREE_PLAN_DAILY_SEARCH_LIMIT = 5;
export const FREE_PLAN_LIVE_MATCH_LIMIT = 5;
export const DAILY_USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function getIsPaidPlan(supabase: { from: (table: string) => { select: (cols: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data?: { status?: string; plan_amount_usd?: number | null } | null }> } } } }, accountId: string | null): Promise<boolean> {
  if (!accountId) return false;

  const { data: sub } = await supabase.from("subscriptions").select("status, plan_amount_usd").eq("account_id", accountId).maybeSingle();
  const status = (sub?.status as string | undefined) ?? "";
  const amount = Number((sub?.plan_amount_usd as number | null | undefined) ?? 0);
  return status === "active" && amount > 0;
}

export function countRecentUsageEvents(timestamps: Array<number | string>, now: number, windowMs: number): number {
  return timestamps.filter((ts) => {
    const value = typeof ts === 'number' ? ts : Date.parse(ts);
    if (Number.isNaN(value)) return false;
    return now - value < windowMs;
  }).length;
}

export function isUsageAllowed(currentCount: number, limit: number): boolean {
  return currentCount < limit;
}

export function buildUsageLimitError(limit: number, featureName: string): string {
  return `You have used all ${limit} ${featureName} in the last 24 hours.`;
}
