-- Deactivate all scheduled cron jobs — ingestion now handled by receive-social-job directly.
do $$
declare
  jobs text[] := array[
    'job-watch-trigger-social-30min',
    'job-watch-trigger-social-3hours',
    'job-watch-trigger-boards-daily',
    'daily-match-summary-6pm',
    'send-daily-match-notifications',
    'purge-old-hotlist-rows'
  ];
  j text;
begin
  foreach j in array jobs loop
    begin
      perform cron.unschedule(j);
    exception when others then
      null; -- skip if already removed
    end;
  end loop;
end $$;
