import { describe, expect, it } from 'vitest';
import { filterAndSortAccountStats } from './admin-dashboard-table';

describe('filterAndSortAccountStats', () => {
  const rows = [
    {
      id: '1',
      name: 'Ava',
      created_at: '2024-01-01T00:00:00.000Z',
      user_name: 'ava',
      user_email: 'ava@example.com',
      watching_count: 5,
      credits_balance: 200,
      reveals_count: 2,
      contacts_count: 1,
      last_logged_in: '2024-02-10T09:00:00.000Z',
      is_trial: false,
    },
    {
      id: '2',
      name: 'Ben',
      created_at: '2024-02-01T00:00:00.000Z',
      user_name: 'ben',
      user_email: 'ben@example.com',
      watching_count: 8,
      credits_balance: 100,
      reveals_count: 3,
      contacts_count: 2,
      last_logged_in: '2024-03-14T09:00:00.000Z',
      is_trial: true,
    },
    {
      id: '3',
      name: 'Cora',
      created_at: '2024-03-01T00:00:00.000Z',
      user_name: 'cora',
      user_email: 'cora@example.com',
      watching_count: 2,
      credits_balance: 500,
      reveals_count: 4,
      contacts_count: 3,
      last_logged_in: '2024-01-15T09:00:00.000Z',
      is_trial: false,
    },
  ];

  it('filters by search text and date range, then sorts descending by numeric columns', () => {
    const result = filterAndSortAccountStats(rows, {
      query: 'example',
      startDate: '2024-02-01',
      endDate: '2024-03-31',
      sortKey: 'watching_count',
      sortDirection: 'desc',
    });

    expect(result.map((item) => item.id)).toEqual(['2', '3']);
  });

  it('sorts date values from newest to oldest', () => {
    const result = filterAndSortAccountStats(rows, {
      query: '',
      startDate: '',
      endDate: '',
      sortKey: 'last_logged_in',
      sortDirection: 'desc',
    });

    expect(result.map((item) => item.id)).toEqual(['2', '1', '3']);
  });
});
