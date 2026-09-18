create table if not exists public.game_request_settings (
  id boolean primary key default true check (id),
  requests_open boolean not null default true,
  closed_message text not null default 'Game requests are temporarily closed.',
  updated_at timestamptz not null default now()
);

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
  status text not null check (status in ('pending', 'awaiting_payment', 'approved', 'scheduled', 'completed', 'denied', 'cancelled', 'expired')),
  discord_channel_id text,
  discord_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists game_requests_twitch_user_idx
  on public.game_requests (twitch_user_id, created_at desc);
create index if not exists game_requests_status_idx
  on public.game_requests (status, created_at desc);
create index if not exists game_requests_game_idx
  on public.game_requests (game_id, status);

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

alter table public.game_request_settings enable row level security;
alter table public.game_request_staff enable row level security;
alter table public.game_catalog enable row level security;
alter table public.game_requests enable row level security;
alter table public.game_request_events enable row level security;

revoke all on table public.game_request_settings from anon, authenticated;
revoke all on table public.game_request_staff from anon, authenticated;
revoke all on table public.game_catalog from anon, authenticated;
revoke all on table public.game_requests from anon, authenticated;
revoke all on table public.game_request_events from anon, authenticated;
revoke all on sequence public.game_requests_request_number_seq from anon, authenticated;
revoke all on sequence public.game_request_events_id_seq from anon, authenticated;

grant select, insert, update, delete on table public.game_request_settings to service_role;
grant select, insert, update, delete on table public.game_request_staff to service_role;
grant select, insert, update, delete on table public.game_catalog to service_role;
grant select, insert, update, delete on table public.game_requests to service_role;
grant select, insert, update, delete on table public.game_request_events to service_role;
grant usage, select on sequence public.game_requests_request_number_seq to service_role;
grant usage, select on sequence public.game_request_events_id_seq to service_role;
