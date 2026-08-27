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
      credits_balance: 200,
      searches_count: 12,
      job_posts_count: 3,
      hotlist_posts_count: 1,
      job_previews_count: 6,
      hotlist_previews_count: 2,
      ai_pitches_count: 4,
      ai_requests_count: 1,
      chats_count: 2,
      vendor_downloads_count: 3,
      recruiter_downloads_count: 0,
      account_age_days: 90,
      session_count: 4,
      active_seconds: 3600,
      active_days: 2,
      last_activity_at: '2024-02-10T09:30:00.000Z',
      last_logged_in: '2024-02-10T09:00:00.000Z',
      is_trial: false,
    },
    {
      id: '2',
      name: 'Ben',
      created_at: '2024-02-01T00:00:00.000Z',
      user_name: 'ben',
      user_email: 'ben@example.com',
      credits_balance: 100,
      searches_count: 20,
      job_posts_count: 5,
      hotlist_posts_count: 2,
      job_previews_count: 9,
      hotlist_previews_count: 3,
      ai_pitches_count: 7,
      ai_requests_count: 3,
      chats_count: 8,
      vendor_downloads_count: 5,
      recruiter_downloads_count: 2,
      account_age_days: 59,
      session_count: 7,
      active_seconds: 7200,
      active_days: 3,
      last_activity_at: '2024-03-14T09:30:00.000Z',
      last_logged_in: '2024-03-14T09:00:00.000Z',
      is_trial: true,
    },
    {
      id: '3',
      name: 'Cora',
      created_at: '2024-03-01T00:00:00.000Z',
      user_name: 'cora',
      user_email: 'cora@example.com',
      credits_balance: 500,
      searches_count: 5,
      job_posts_count: 1,
      hotlist_posts_count: 3,
      job_previews_count: 2,
      hotlist_previews_count: 4,
      ai_pitches_count: 0,
      ai_requests_count: 2,
      chats_count: 1,
      vendor_downloads_count: 0,
      recruiter_downloads_count: 1,
      account_age_days: 30,
      session_count: 2,
      active_seconds: 1800,
      active_days: 1,
      last_activity_at: null,
      last_logged_in: '2024-01-15T09:00:00.000Z',
      is_trial: false,
    },
  ];

  it('filters by search text and date range, then sorts descending by numeric columns', () => {
    const result = filterAndSortAccountStats(rows, {
      query: 'example',
      startDate: '2024-02-01',
      endDate: '2024-03-31',
      sortKey: 'job_posts_count',
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

  it('sorts tracked activity metrics and keeps missing activity last', () => {
    const byTime = filterAndSortAccountStats(rows, {
      query: '',
      startDate: '',
      endDate: '',
      sortKey: 'active_seconds',
      sortDirection: 'desc',
    });
    const byLastActivity = filterAndSortAccountStats(rows, {
      query: '',
      startDate: '',
      endDate: '',
      sortKey: 'last_activity_at',
      sortDirection: 'desc',
    });

    expect(byTime.map((item) => item.id)).toEqual(['2', '1', '3']);
    expect(byLastActivity.map((item) => item.id)).toEqual(['2', '1', '3']);
  });

  it('sorts search counts and account age', () => {
    const bySearches = filterAndSortAccountStats(rows, {
      query: '',
      startDate: '',
      endDate: '',
      sortKey: 'searches_count',
      sortDirection: 'desc',
    });
    const byNewestAccount = filterAndSortAccountStats(rows, {
      query: '',
      startDate: '',
      endDate: '',
      sortKey: 'account_age_days',
      sortDirection: 'asc',
    });

    expect(bySearches.map((item) => item.id)).toEqual(['2', '1', '3']);
    expect(byNewestAccount.map((item) => item.id)).toEqual(['3', '2', '1']);
  });
});
