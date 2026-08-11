update public.linkedin_keyword_scraper_config
set
  is_enabled = true,
  schedule_interval_hours = 1,
  updated_at = now()
where id = true;