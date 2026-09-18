create table if not exists public.game_request_settings (
  id boolean primary key default true check (id),
  requests_open boolean not null default true,
  closed_message text not null default 'Game requests are temporarily closed.',
  manual_closed boolean not null default false,
  manual_reopens_at timestamptz,
  cooldown_until timestamptz,
  current_request_id uuid,
  updated_by_platform text,
  updated_by_user_id text,
  updated_by_name text,
  updated_at timestamptz not null default now()
);

alter table public.game_request_settings add column if not exists manual_closed boolean not null default false;
alter table public.game_request_settings add column if not exists manual_reopens_at timestamptz;
alter table public.game_request_settings add column if not exists cooldown_until timestamptz;
alter table public.game_request_settings add column if not exists current_request_id uuid;
alter table public.game_request_settings add column if not exists updated_by_platform text;
alter table public.game_request_settings add column if not exists updated_by_user_id text;
alter table public.game_request_settings add column if not exists updated_by_name text;

insert into public.game_request_settings (id, requests_open)
values (true, true)
on conflict (id) do nothing;

create table if not exists public.game_request_staff (
  twitch_user_id text primary key,
  twitch_username text,
  role text not null check (role in ('owner', 'admin', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.game_request_staff (twitch_user_id, twitch_username, role, active)
select platform_user_id, username, role, active
from public.appeal_staff
where platform = 'twitch' and role = 'owner'
on conflict (twitch_user_id) do update
set twitch_username = excluded.twitch_username,
    role = excluded.role,
    active = excluded.active,
    updated_at = now();

create table if not exists public.game_catalog (
  id text primary key,
  title text not null,
  system text not null,
  requestable boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.game_requests (
  id uuid primary key default gen_random_uuid(),
  request_number bigint generated always as identity unique,
  twitch_user_id text not null,
  twitch_login text not null,
  twitch_display_name text not null,
  twitch_avatar_url text,
  game_id text not null references public.game_catalog(id),
  game_title text not null,
  game_system text not null,
  request_type text not null check (request_type in ('Play', 'Speed', '100%')),
  base_price numeric(8,2) not null check (base_price >= 0),
  amount_due numeric(8,2) not null check (amount_due >= 0),
  is_owner boolean not null default false,
  payment_required boolean not null default true,
  payment_currency text not null default 'USD' check (payment_currency = 'USD'),
  paypal_order_id text,
  paypal_capture_id text,
  paypal_status text,
  payment_completed_at timestamptz,
  payment_error text,
  payment_attempts integer not null default 0 check (payment_attempts >= 0 and payment_attempts <= 10),
  status text not null check (status in ('pending', 'awaiting_payment', 'approved', 'scheduled', 'completed', 'denied', 'cancelled', 'expired')),
  discord_channel_id text,
  discord_message_id text,
  discord_delete_at timestamptz,
  discord_deleted_at timestamptz,
  discord_last_error text,
  scheduled_for timestamptz,
  youtube_vod_url text,
  completed_at timestamptz,
  resolved_by_platform text,
  resolved_by_user_id text,
  resolved_by_name text,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.game_requests add column if not exists completed_at timestamptz;
alter table public.game_requests add column if not exists discord_delete_at timestamptz;
alter table public.game_requests add column if not exists discord_deleted_at timestamptz;
alter table public.game_requests add column if not exists discord_last_error text;
alter table public.game_requests add column if not exists scheduled_for timestamptz;
alter table public.game_requests add column if not exists youtube_vod_url text;
alter table public.game_requests add column if not exists payment_currency text not null default 'USD';
alter table public.game_requests add column if not exists paypal_order_id text;
alter table public.game_requests add column if not exists paypal_capture_id text;
alter table public.game_requests add column if not exists paypal_status text;
alter table public.game_requests add column if not exists payment_completed_at timestamptz;
alter table public.game_requests add column if not exists payment_error text;
alter table public.game_requests add column if not exists payment_attempts integer not null default 0;
alter table public.game_requests add column if not exists resolved_by_platform text;
alter table public.game_requests add column if not exists resolved_by_user_id text;
alter table public.game_requests add column if not exists resolved_by_name text;
alter table public.game_requests add column if not exists resolution_note text;

create index if not exists game_requests_twitch_user_idx
  on public.game_requests (twitch_user_id, created_at desc);
create index if not exists game_requests_status_idx
  on public.game_requests (status, created_at desc);
create index if not exists game_requests_game_idx
  on public.game_requests (game_id, status);
create index if not exists game_requests_discord_cleanup_idx
  on public.game_requests (discord_delete_at)
  where discord_message_id is not null and discord_delete_at is not null;
create unique index if not exists game_requests_paypal_order_idx
  on public.game_requests (paypal_order_id)
  where paypal_order_id is not null;
create unique index if not exists game_requests_paypal_capture_idx
  on public.game_requests (paypal_capture_id)
  where paypal_capture_id is not null;
create unique index if not exists game_requests_one_active_idx
  on public.game_requests ((true))
  where status in ('pending', 'awaiting_payment', 'approved', 'scheduled');

create table if not exists public.game_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.game_requests(id) on delete cascade,
  event_type text not null,
  actor_twitch_user_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists game_request_events_request_idx
  on public.game_request_events (request_id, created_at);

create table if not exists public.game_request_system_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  actor_platform text,
  actor_user_id text,
  actor_name text,
  actor_role text,
  request_id uuid references public.game_requests(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists game_request_system_events_created_idx
  on public.game_request_system_events (created_at desc);
create index if not exists game_request_system_events_request_idx
  on public.game_request_system_events (request_id)
  where request_id is not null;

alter table public.game_request_settings enable row level security;
alter table public.game_request_staff enable row level security;
alter table public.game_catalog enable row level security;
alter table public.game_requests enable row level security;
alter table public.game_request_events enable row level security;
alter table public.game_request_system_events enable row level security;

revoke all on table public.game_request_settings from anon, authenticated;
revoke all on table public.game_request_staff from anon, authenticated;
revoke all on table public.game_catalog from anon, authenticated;
revoke all on table public.game_requests from anon, authenticated;
revoke all on table public.game_request_events from anon, authenticated;
revoke all on table public.game_request_system_events from anon, authenticated;
revoke all on sequence public.game_requests_request_number_seq from anon, authenticated;
revoke all on sequence public.game_request_events_id_seq from anon, authenticated;
revoke all on sequence public.game_request_system_events_id_seq from anon, authenticated;

grant select, insert, update, delete on table public.game_request_settings to service_role;
grant select, insert, update, delete on table public.game_request_staff to service_role;
grant select, insert, update, delete on table public.game_catalog to service_role;
grant select, insert, update, delete on table public.game_requests to service_role;
grant select, insert, update, delete on table public.game_request_events to service_role;
grant select, insert, update, delete on table public.game_request_system_events to service_role;
grant usage, select on sequence public.game_requests_request_number_seq to service_role;
grant usage, select on sequence public.game_request_events_id_seq to service_role;
grant usage, select on sequence public.game_request_system_events_id_seq to service_role;
