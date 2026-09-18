create table if not exists public.support_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  minimum_amount numeric(10,2) not null default 1.00 check (minimum_amount >= 1),
  maximum_amount numeric(10,2) not null default 1000.00 check (maximum_amount >= minimum_amount),
  currency text not null default 'USD' check (currency = 'USD'),
  retention_months integer not null default 15 check (retention_months between 1 and 60),
  discord_channel_id text,
  public_message text not null default 'The official ThyToxicGamer Support Center is online.',
  updated_at timestamptz not null default now()
);

insert into public.support_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.donations (
  id uuid primary key default gen_random_uuid(),
  donation_number bigint generated always as identity unique,
  receipt_code text generated always as ('TTG-DON-' || lpad(donation_number::text, 6, '0')) stored unique,
  status text not null default 'created' check (status in ('created', 'approved', 'completed', 'denied', 'cancelled', 'refunded', 'reversed', 'failed')),
  amount numeric(10,2) not null check (amount between 1.00 and 1000.00),
  currency text not null default 'USD' check (currency = 'USD'),
  supporter_name text check (supporter_name is null or char_length(supporter_name) <= 60),
  is_anonymous boolean not null default false,
  support_message text check (support_message is null or char_length(support_message) <= 500),
  allow_tts boolean not null default false,
  paypal_order_id text unique,
  paypal_capture_id text unique,
  paypal_status text,
  discord_delivery_status text not null default 'pending' check (discord_delivery_status in ('pending', 'delivered', 'failed', 'skipped')),
  discord_message_id text,
  discord_error text check (discord_error is null or char_length(discord_error) <= 1000),
  completed_at timestamptz,
  purge_after timestamptz not null default (now() + interval '15 months'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists donations_status_created_idx on public.donations (status, created_at);
create index if not exists donations_purge_after_idx on public.donations (purge_after);

create table if not exists public.donation_events (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references public.donations(id) on delete cascade,
  event_type text not null check (event_type in ('order_created', 'payment_approved', 'payment_completed', 'payment_denied', 'payment_refunded', 'payment_reversed', 'discord_delivered', 'discord_failed', 'alert_claimed', 'alert_delivered', 'alert_failed')),
  message text check (message is null or char_length(message) <= 1000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists donation_events_donation_created_idx on public.donation_events (donation_id, created_at);

create table if not exists public.donation_alert_queue (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null unique references public.donations(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  claimed_at timestamptz,
  delivered_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists donation_alert_queue_status_created_idx on public.donation_alert_queue (status, created_at);

create table if not exists public.paypal_webhook_events (
  event_id text primary key,
  event_type text not null,
  resource_id text,
  processing_status text not null default 'received' check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  processing_error text check (processing_error is null or char_length(processing_error) <= 1000),
  processed_at timestamptz,
  purge_after timestamptz not null default (now() + interval '15 months'),
  created_at timestamptz not null default now()
);

create index if not exists paypal_webhook_events_purge_after_idx on public.paypal_webhook_events (purge_after);

create table if not exists public.support_rate_limits (
  client_hash text primary key,
  request_count integer not null default 1,
  window_started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 day')
);

alter table public.support_settings enable row level security;
alter table public.donations enable row level security;
alter table public.donation_events enable row level security;
alter table public.donation_alert_queue enable row level security;
alter table public.paypal_webhook_events enable row level security;
alter table public.support_rate_limits enable row level security;

revoke all on table public.support_settings from anon, authenticated;
revoke all on table public.donations from anon, authenticated;
revoke all on table public.donation_events from anon, authenticated;
revoke all on table public.donation_alert_queue from anon, authenticated;
revoke all on table public.paypal_webhook_events from anon, authenticated;
revoke all on table public.support_rate_limits from anon, authenticated;
revoke usage, select on sequence public.donations_donation_number_seq from anon, authenticated;

grant select, insert, update, delete on table public.support_settings to service_role;
grant select, insert, update, delete on table public.donations to service_role;
grant select, insert, update, delete on table public.donation_events to service_role;
grant select, insert, update, delete on table public.donation_alert_queue to service_role;
grant select, insert, update, delete on table public.paypal_webhook_events to service_role;
grant select, insert, update, delete on table public.support_rate_limits to service_role;
grant usage, select on sequence public.donations_donation_number_seq to service_role;

select cron.schedule(
  'support-center-retention',
  '23 4 * * *',
  $$
    delete from public.paypal_webhook_events where purge_after <= now();
    delete from public.donations where purge_after <= now();
    delete from public.support_rate_limits where expires_at <= now();
  $$
);

comment on table public.donations is 'Verified Support Center receipts. Payment credentials and financial instrument details are never stored here.';
comment on table public.donation_events is 'Append-only operational history for Support Center donations.';
comment on table public.donation_alert_queue is 'Private Streamer.bot donation alert queue. Access is only through the protected Support API.';
