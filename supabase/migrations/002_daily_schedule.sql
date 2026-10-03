-- Runs the update-data edge function every weekday evening after the US close.
-- 01:30 UTC Tuesday-Saturday = 9:30 pm Eastern (daylight time) Monday-Friday.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Calls the data job. Run it by hand any time with: select public.run_data_job();
create or replace function public.run_data_job()
returns bigint
language sql
security definer
set search_path = public, extensions
as $$
  select net.http_post(
    url := 'https://xiexkzzmntcojnsorbyd.supabase.co/functions/v1/update-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-job-secret', (select value from public.app_secrets where key = 'job_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$;
revoke all on function public.run_data_job() from public, anon, authenticated;

select cron.unschedule('pfw-sif-daily-update') where exists (select 1 from cron.job where jobname = 'pfw-sif-daily-update');
select cron.schedule('pfw-sif-daily-update', '30 1 * * 2-6', 'select public.run_data_job();');
