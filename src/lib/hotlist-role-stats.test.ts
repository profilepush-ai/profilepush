import { describe, expect, it } from 'vitest';
import { buildRoleFeedRowsFromMatches, buildRoleStatsSummary } from './hotlist-role-stats';

describe('buildRoleFeedRowsFromMatches', () => {
  it('builds feed rows from radar matches and social jobs', () => {
    const feedRows = buildRoleFeedRowsFromMatches(
      [
        { job_source: 'social', job_id: 'job-1', created_at: '2026-08-01T00:00:00.000Z' },
        { job_source: 'social', job_id: 'job-2', created_at: '2026-08-02T00:00:00.000Z' },
      ],
      [
        { id: 'job-1', job_title: 'Senior Full Stack Engineer', post_content: 'React Node.js AWS role', extracted_role_normalized: 'Full Stack' },
        { id: 'job-2', job_title: 'QA Engineer', post_content: 'Manual testing', extracted_role_normalized: 'QA' },
      ]
    );

    expect(feedRows).toEqual([
      { id: 'job-1', extracted_role_normalized: 'Full Stack', job_title: 'Senior Full Stack Engineer', post_content: 'React Node.js AWS role' },
      { id: 'job-2', extracted_role_normalized: 'QA', job_title: 'QA Engineer', post_content: 'Manual testing' },
    ]);
  });
});

describe('buildRoleStatsSummary', () => {
  it('counts feed rows that match the role the same way the pulse page does', () => {
    const roles = [
      { id: 'role-1', target_role: 'Senior Full Stack Engineer', priority_skills: 'React, Node.js, AWS' },
      { id: 'role-2', target_role: 'Backend Python Engineer', priority_skills: 'Python, FastAPI' },
    ];

    const feedRows = [
      {
        extracted_role_normalized: 'Full Stack',
        job_title: 'Senior Full Stack Engineer',
        post_content: 'React Node.js AWS role for a modern SaaS team',
      },
      {
        extracted_role_normalized: 'Backend',
        job_title: 'Backend Developer',
        post_content: 'Python FastAPI PostgreSQL role',
      },
      {
        extracted_role_normalized: 'QA',
        job_title: 'QA Engineer',
        post_content: 'Manual testing',
      },
    ];

    const watchRows = [
      { source_hotlist_role_id: 'role-1', is_watching: true },
      { source_hotlist_role_id: 'role-1', is_watching: false },
      { source_hotlist_role_id: 'role-2', is_watching: true },
    ];

    const summary = buildRoleStatsSummary(roles, feedRows, watchRows);

    expect(summary['role-1']).toEqual({ job_count: 1, watch_count: 2, active_watch_count: 1 });
    expect(summary['role-2']).toEqual({ job_count: 1, watch_count: 1, active_watch_count: 1 });
  });
});
