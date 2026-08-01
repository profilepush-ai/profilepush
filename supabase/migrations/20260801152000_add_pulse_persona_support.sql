-- Pulse module minimal support for environments where hotlist_ai_roles already exists:
-- 1) Add avatar_url for role personas (if missing)
-- 2) Expose leaderboard RPC with global active watcher counts
--
-- Note: persona avatar storage bucket/policies are intentionally omitted in this minimal migration.

alter table if exists public.hotlist_ai_roles
  add column if not exists avatar_url text;

create or replace function public.get_pulse_persona_leaderboard(limit_count integer default 10)
returns table (
  target_role text,
  summary text,
  active_watchers bigint,
  avatar_url text,
  rank integer
)
language sql
security definer
set search_path = public
as $$
  with personas as (
    select * from (values
      ('Senior Full Stack Engineer', 'Modern SaaS product engineering with React, Node.js, and cloud delivery.'),
      ('Backend Python Engineer', 'API-heavy platform engineering with FastAPI and PostgreSQL.'),
      ('Data Engineer', 'Analytics and data pipeline work with SQL, Spark, and Airflow.'),
      ('DevOps Engineer', 'Infrastructure reliability with AWS, Kubernetes, and Terraform.'),
      ('QA Automation Engineer', 'Fast-moving quality engineering for modern web products.'),
      ('Product Manager', 'Cross-functional product leadership for SaaS teams.'),
      ('Frontend React Engineer', 'High-quality frontend delivery with React, TypeScript, and UI polish.'),
      ('Machine Learning Engineer', 'Applied ML and model deployment for production systems.'),
      ('Security Engineer', 'Security operations and cloud protection for modern platforms.'),
      ('Solutions Architect', 'Enterprise architecture and technical leadership across complex stacks.')
    ) as x(target_role, summary)
  ),
  watcher_counts as (
    select
      p.target_role,
      count(*) filter (
        where r.is_active = true
          and coalesce(r.schedule_frequency, 'daily') <> 'disabled'
      ) as active_watchers,
      (
        select r2.avatar_url
        from public.hotlist_ai_roles r2
        where lower(trim(r2.target_role)) = lower(trim(p.target_role))
          and coalesce(r2.avatar_url, '') <> ''
        order by r2.updated_at desc nulls last, r2.created_at desc
        limit 1
      ) as avatar_url
    from personas p
    left join public.hotlist_ai_roles r
      on lower(trim(r.target_role)) = lower(trim(p.target_role))
    group by p.target_role
  ),
  ranked as (
    select
      p.target_role,
      p.summary,
      coalesce(w.active_watchers, 0)::bigint as active_watchers,
      w.avatar_url,
      row_number() over (
        order by coalesce(w.active_watchers, 0) desc, p.target_role asc
      )::integer as rank
    from personas p
    left join watcher_counts w on w.target_role = p.target_role
  )
  select
    target_role,
    summary,
    active_watchers,
    avatar_url,
    rank
  from ranked
  order by rank asc
  limit greatest(1, least(coalesce(limit_count, 10), 50));
$$;

revoke all on function public.get_pulse_persona_leaderboard(integer) from public;
grant execute on function public.get_pulse_persona_leaderboard(integer) to authenticated;
