import { ROLE_LABEL, applied, type AccountRow, type RoleFilter } from './admin-account-stats';

/** Columns are AccountRow fields, plus `applied` (email + site + Ask Resume). */
export type AdminStatsSortKey = keyof AccountRow | 'applied';
export type AdminStatsSortDirection = 'asc' | 'desc';

export interface AdminStatsFilterState {
  query: string;
  role: RoleFilter;
  sortKey: AdminStatsSortKey;
  sortDirection: AdminStatsSortDirection;
}

const DATE_KEYS = new Set<AdminStatsSortKey>(['created_at', 'last_active', 'last_match_at']);

export function formatUserType(role: AccountRow['role'] | null | undefined) {
  return role ? ROLE_LABEL[role] : '-';
}

function toDateValue(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function sortValue(row: AccountRow, key: AdminStatsSortKey): unknown {
  return key === 'applied' ? applied(row) : row[key];
}

export function filterAndSortAccountStats(rows: AccountRow[], filterState: AdminStatsFilterState) {
  const query = filterState.query.trim().toLowerCase();
  const direction = filterState.sortDirection === 'asc' ? 1 : -1;
  const key = filterState.sortKey;

  const filtered = rows.filter((row) => {
    if (filterState.role !== 'all' && row.role !== filterState.role) return false;
    if (!query) return true;
    const haystack = [row.name, row.email, formatUserType(row.role)].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  });

  return filtered.sort((a, b) => {
    const aValue = sortValue(a, key);
    const bValue = sortValue(b, key);

    // Dates, with "never" last whichever way the column is sorted.
    if (DATE_KEYS.has(key)) {
      const aDate = toDateValue(aValue);
      const bDate = toDateValue(bValue);
      if (aDate == null && bDate == null) return 0;
      if (aDate == null) return 1;
      if (bDate == null) return -1;
      return (aDate - bDate) * direction;
    }
    if (typeof aValue === 'number' || typeof bValue === 'number') {
      return ((Number(aValue) || 0) - (Number(bValue) || 0)) * direction;
    }
    if (typeof aValue === 'boolean' || typeof bValue === 'boolean') {
      return ((aValue ? 1 : 0) - (bValue ? 1 : 0)) * direction;
    }
    return String(aValue ?? '').toLowerCase().localeCompare(String(bValue ?? '').toLowerCase()) * direction;
  });
}
