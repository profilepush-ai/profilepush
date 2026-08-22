export interface AdminAccountStatsRow {
  id: string;
  name: string;
  created_at: string;
  user_name: string;
  user_email: string;
  watching_count: number;
  credits_balance: number;
  reveals_count: number;
  contacts_count: number;
  searches_count: number;
  posts_count: number;
  previews_count: number;
  ai_pitches_count: number;
  ai_requests_count: number;
  account_age_days: number;
  session_count: number;
  active_seconds: number;
  active_days: number;
  last_activity_at: string | null;
  last_logged_in: string | null;
  is_trial: boolean;
}

export type AdminStatsSortKey = 'name' | 'user_name' | 'user_email' | 'watching_count' | 'credits_balance' | 'reveals_count' | 'contacts_count' | 'searches_count' | 'posts_count' | 'previews_count' | 'ai_pitches_count' | 'ai_requests_count' | 'account_age_days' | 'session_count' | 'active_seconds' | 'active_days' | 'last_activity_at' | 'last_logged_in' | 'created_at';
export type AdminStatsSortDirection = 'asc' | 'desc';

export interface AdminStatsFilterState {
  query: string;
  startDate: string;
  endDate: string;
  sortKey: AdminStatsSortKey;
  sortDirection: AdminStatsSortDirection;
}

function toDateValue(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export function filterAndSortAccountStats(
  rows: AdminAccountStatsRow[],
  filterState: AdminStatsFilterState
) {
  const query = filterState.query.trim().toLowerCase();
  const startDate = filterState.startDate ? new Date(`${filterState.startDate}T00:00:00.000Z`).getTime() : null;
  const endDate = filterState.endDate ? new Date(`${filterState.endDate}T23:59:59.999Z`).getTime() : null;

  const filtered = rows.filter((row) => {
    const haystack = [row.name, row.user_name, row.user_email].filter(Boolean).join(' ').toLowerCase();
    const matchesQuery = !query || haystack.includes(query);

    const createdAt = toDateValue(row.created_at);
    const matchesDateRange = (!startDate || (createdAt != null && createdAt >= startDate)) && (!endDate || (createdAt != null && createdAt <= endDate));

    return matchesQuery && matchesDateRange;
  });

  return filtered.sort((a, b) => {
    const direction = filterState.sortDirection === 'asc' ? 1 : -1;

    if (filterState.sortKey === 'last_logged_in' || filterState.sortKey === 'last_activity_at') {
      const aDate = toDateValue(a[filterState.sortKey]);
      const bDate = toDateValue(b[filterState.sortKey]);
      if (aDate == null && bDate == null) return 0;
      if (aDate == null) return 1;
      if (bDate == null) return -1;
      return (aDate - bDate) * direction;
    }

    if (filterState.sortKey === 'created_at') {
      const aDate = toDateValue(a.created_at);
      const bDate = toDateValue(b.created_at);
      if (aDate == null && bDate == null) return 0;
      if (aDate == null) return 1;
      if (bDate == null) return -1;
      return (aDate - bDate) * direction;
    }

    const aValue = a[filterState.sortKey] as string | number;
    const bValue = b[filterState.sortKey] as string | number;

    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return (aValue - bValue) * direction;
    }

    const aText = String(aValue ?? '').toLowerCase();
    const bText = String(bValue ?? '').toLowerCase();
    return aText.localeCompare(bText) * direction;
  });
}
