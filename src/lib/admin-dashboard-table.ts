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
  last_logged_in: string | null;
  is_trial: boolean;
}

export type AdminStatsSortKey = 'name' | 'user_name' | 'user_email' | 'watching_count' | 'credits_balance' | 'reveals_count' | 'contacts_count' | 'last_logged_in' | 'created_at';
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

    if (filterState.sortKey === 'last_logged_in') {
      const aDate = toDateValue(a.last_logged_in);
      const bDate = toDateValue(b.last_logged_in);
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
