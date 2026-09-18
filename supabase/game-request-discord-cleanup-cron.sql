create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'game_requests_project_url') then
    perform vault.create_secret(
      'https://ubldjtsjfudogtgxakiq.supabase.co',
      'game_requests_project_url',
      'Supabase project URL used by the game-request Discord retention job'
    );
  end if;
  if not exists (select 1 from vault.secrets where name = 'game_requests_publishable_key') then
    perform vault.create_secret(
      'sb_publishable_Fhl-Co0p5QNJKJ7ou2Te2Q_FD8BIywM',
      'game_requests_publishable_key',
      'Publishable key used only to invoke the game-request Discord retention function'
    );
  end if;
end
$$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'game-request-discord-cleanup';

select cron.schedule(
  'game-request-discord-cleanup',
  '17 5 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'game_requests_project_url') || '/functions/v1/game-requests-discord-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'game_requests_publishable_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
