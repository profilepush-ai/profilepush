create table if not exists public.linkedin_groups (
  group_id text primary key check (group_id ~ '^[0-9]+$'),
  group_name text,
  is_active boolean not null default true,
  last_scraped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_linkedin_groups_active
  on public.linkedin_groups (is_active, group_id);

alter table public.linkedin_groups enable row level security;

create policy select_all_linkedin_groups
  on public.linkedin_groups for select using (true);

create policy insert_all_linkedin_groups
  on public.linkedin_groups for insert with check (true);

create policy update_all_linkedin_groups
  on public.linkedin_groups for update using (true) with check (true);

create policy delete_all_linkedin_groups
  on public.linkedin_groups for delete using (true);

insert into public.linkedin_groups (group_id)
select group_id
from unnest(array[
  '8451916', '4299996', '10365343', '6638052', '12097743', '14135697', '2704845', '8446525',
  '14164012', '10536594', '7021870', '12561411', '14007871', '10337347', '10387662', '9354069',
  '9235849', '13914219', '9292192', '10441702', '12066189', '14160771', '9209978', '9277049',
  '6602142', '14076193', '14319077', '10385988', '9381632', '10301182', '14281329', '10529117',
  '14210659', '14432379', '4964177', '14023327', '7027943', '10023193', '8957008', '9232303',
  '6995415', '14368498', '12189329', '10506161', '14210022', '9240605', '12156008', '9399312',
  '10394769', '10348747', '14275455', '13946320', '12735094', '7010338', '12682046', '14307899',
  '14290047', '14256089', '14412094', '10462269', '12284621', '14428664', '10447380', '14495369',
  '14443088', '14202486', '10493757', '12530819', '9504968', '10496795', '14189353', '9233377',
  '14382453', '14517477', '18069008', '9123004', '13146204', '9303497', '14597419', '14210385',
  '14687189', '14692106', '18040044', '14291026', '14142060', '10545322', '14198382', '8283344',
  '12873500', '14008888', '14426382', '9107648', '19259008', '10499493', '13835716', '14688484',
  '15513007', '13264161', '14601282', '9205107'
]::text[]) as group_id
on conflict (group_id) do nothing;