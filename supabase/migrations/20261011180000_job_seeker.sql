/*
# Job seekers

A third choice after sign-up: someone looking for a job for themselves. They
use ProfilePush like bench sales does (a profile matched to jobs, then
apply), so they keep active_persona = 'bench_sales' and every screen works
as it is; accounts.job_seeker only changes the words (their profile, "you").
set_active_persona takes 'job_seeker' too.
*/

alter table public.accounts add column if not exists job_seeker boolean not null default false;

create or replace function public.set_active_persona(p_persona text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_account_id uuid;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  if p_persona not in ('vendor', 'bench_sales', 'job_seeker') then raise exception 'Invalid persona'; end if;
  select am.account_id into v_account_id
  from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active'
  order by am.created_at asc limit 1;
  if v_account_id is null then raise exception 'No active account membership found'; end if;
  update public.accounts
  set active_persona = case when p_persona = 'job_seeker' then 'bench_sales' else p_persona end,
      job_seeker = (p_persona = 'job_seeker')
  where id = v_account_id;
end;
$$;
