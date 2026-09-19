alter table public.game_requests add column if not exists payment_requested_at timestamptz;
alter table public.game_requests add column if not exists payment_expires_at timestamptz;

create index if not exists game_requests_payment_expiry_idx
on public.game_requests (payment_expires_at)
where status = 'awaiting_payment' and payment_expires_at is not null;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'game-request-payment-expiry';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end $$;

select cron.schedule(
  'game-request-payment-expiry',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'game_requests_project_url') || '/functions/v1/game-requests-payment-expiry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'game_requests_publishable_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
