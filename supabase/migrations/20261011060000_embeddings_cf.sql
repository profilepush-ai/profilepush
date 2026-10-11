/*
# Cloudflare embeddings, side by side

We're moving matching's embeddings from OpenAI (text-embedding-3-small) to
Cloudflare Workers AI (EmbeddingGemma). The two can't be compared with each
other, so the Cloudflare vectors are built here first, next to the live ones,
to check match quality before switching. Nothing reads this table for
matching yet. embed-backfill fills it.
*/

create table if not exists public.embeddings_cf (
  post_id uuid primary key,
  kind text not null check (kind in ('job', 'hotlist')),
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now()
);
alter table public.embeddings_cf enable row level security;

-- What's left to embed: posts that have an OpenAI vector (so matching uses
-- them) and no Cloudflare one yet, newest first. shard '0-3' splits by the
-- id's first hex digit so several runs can go in parallel.
create or replace function public.embeddings_cf_todo(p_kind text, p_limit integer, p_shard text default null)
returns table(id uuid) language sql stable security definer set search_path to 'public' as $$
  select x.id from (
    select j.id, coalesce(j.posted_at, j.created_at) at from public.social_jobs j
    where p_kind = 'job' and j.job_embedding is not null
    union all
    select h.id, coalesce(h.posted_at, h.created_at) from public.social_hotlist h
    where p_kind = 'hotlist' and h.hotlist_embedding is not null
  ) x
  where not exists (select 1 from public.embeddings_cf e where e.post_id = x.id)
    and (p_shard is null or substr(x.id::text, 1, 1) between split_part(p_shard, '-', 1) and split_part(p_shard, '-', 2))
  order by x.at desc
  limit p_limit
$$;
revoke all on function public.embeddings_cf_todo(text, integer, text) from public, anon, authenticated;
