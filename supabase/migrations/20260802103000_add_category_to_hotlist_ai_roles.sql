alter table public.hotlist_ai_roles
add column if not exists category text;

create index if not exists idx_hotlist_ai_roles_category
on public.hotlist_ai_roles(category);

update public.hotlist_ai_roles
set category = case
  when lower(coalesce(target_role, '')) ~ '(front\s*end|frontend|react|ui|angular|vue)' then 'front-end'
  when lower(coalesce(target_role, '')) ~ '(backend|api|node|python|fastapi|django)' then 'backend'
  when lower(coalesce(target_role, '')) ~ '(data|spark|airflow|etl|analytics|sql)' then 'data'
  when lower(coalesce(target_role, '')) ~ '(security|iam|soc|cloud security)' then 'security'
  when lower(coalesce(target_role, '')) ~ '(crm|salesforce|hubspot|zoho|customer relationship)' then 'crm'
  when lower(coalesce(target_role, '')) ~ '(qa|automation|selenium|playwright|cypress)' then 'qa'
  when lower(coalesce(target_role, '')) ~ '(business development|biz dev|partnership|sales|account executive|revenue)' then 'biz-dev'
  when lower(coalesce(target_role, '')) ~ '(machine learning|mlops|pytorch|tensorflow|model)' then 'ml'
  when lower(coalesce(target_role, '')) ~ '(^|[^a-z0-9])ai([^a-z0-9]|$)|llm|nlp|prompt' then 'ai'
  when lower(coalesce(target_role, '')) ~ '(devops|sre|kubernetes|terraform|aws|cloud)' then 'devops'
  else 'all'
end
where category is null or btrim(category) = '';
