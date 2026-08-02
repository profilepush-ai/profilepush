-- Backfill hotlist_ai_roles.category to normalized category IDs based on role text.

with classified as (
  select
    r.id,
    case
      when lower(concat_ws(' ', r.target_role, r.priority_skills, r.preferred_locations)) ~ '(front\s*end|frontend|react|ui|angular|vue)' then 'front-end'
      when lower(concat_ws(' ', r.target_role, r.priority_skills, r.preferred_locations)) ~ '(backend|api|node|python|fastapi|django)' then 'backend'
      when lower(concat_ws(' ', r.target_role, r.priority_skills, r.preferred_locations)) ~ '(data|spark|airflow|etl|analytics|sql)' then 'data'
      when lower(concat_ws(' ', r.target_role, r.priority_skills, r.preferred_locations)) ~ '(security|iam|soc|cloud security)' then 'security'
      when lower(concat_ws(' ', r.target_role, r.priority_skills, r.preferred_locations)) ~ '(crm|salesforce|hubspot|zoho|customer relationship)' then 'crm'
      when lower(concat_ws(' ', r.target_role, r.priority_skills, r.preferred_locations)) ~ '(qa|automation|selenium|playwright|cypress)' then 'qa'
      when lower(concat_ws(' ', r.target_role, r.priority_skills, r.preferred_locations)) ~ '(business development|biz dev|partnership|sales|account executive|revenue)' then 'biz-dev'
      when lower(concat_ws(' ', r.target_role, r.priority_skills, r.preferred_locations)) ~ '(machine learning|mlops|pytorch|tensorflow|model)' then 'ml'
      when lower(concat_ws(' ', r.target_role, r.priority_skills, r.preferred_locations)) ~ '(\yai\y|llm|nlp|prompt)' then 'ai'
      when lower(concat_ws(' ', r.target_role, r.priority_skills, r.preferred_locations)) ~ '(devops|sre|kubernetes|terraform|aws|cloud)' then 'devops'
      else 'all'
    end as inferred_category
  from public.hotlist_ai_roles r
)
update public.hotlist_ai_roles r
set
  category = c.inferred_category,
  updated_at = now()
from classified c
where r.id = c.id
  and r.category is distinct from c.inferred_category;
