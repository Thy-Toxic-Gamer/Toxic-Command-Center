create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  poll_number bigint generated always as identity unique,
  question text not null check (char_length(question) between 3 and 240),
  description text check (description is null or char_length(description) <= 1000),
  status text not null default 'open' check (status in ('open', 'closed', 'archived')),
  closes_at timestamptz,
  closed_at timestamptz,
  created_by_platform text not null check (created_by_platform in ('twitch', 'discord')),
  created_by_user_id text not null,
  created_by_name text not null,
  discord_channel_id text,
  discord_message_id text,
  discord_last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  position smallint not null check (position between 1 and 10),
  label text not null check (char_length(label) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (poll_id, position),
  unique (id, poll_id)
);

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null,
  voter_platform text not null default 'twitch' check (voter_platform = 'twitch'),
  voter_user_id text not null,
  voter_login text not null,
  voter_display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (poll_id, voter_platform, voter_user_id),
  foreign key (option_id, poll_id) references public.poll_options(id, poll_id) on delete cascade
);

create table if not exists public.poll_events (
  id bigint generated always as identity primary key,
  poll_id uuid references public.polls(id) on delete cascade,
  event_type text not null,
  actor_platform text,
  actor_user_id text,
  actor_name text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists polls_status_closes_idx on public.polls (status, closes_at);
create index if not exists polls_created_idx on public.polls (created_at desc);
create index if not exists poll_options_poll_idx on public.poll_options (poll_id, position);
create index if not exists poll_votes_poll_idx on public.poll_votes (poll_id, option_id);
create index if not exists poll_votes_option_poll_idx on public.poll_votes (option_id, poll_id);
create index if not exists poll_events_poll_idx on public.poll_events (poll_id, created_at desc);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.poll_events enable row level security;

revoke all on table public.polls from anon, authenticated;
revoke all on table public.poll_options from anon, authenticated;
revoke all on table public.poll_votes from anon, authenticated;
revoke all on table public.poll_events from anon, authenticated;
revoke all on sequence public.polls_poll_number_seq from anon, authenticated;
revoke all on sequence public.poll_events_id_seq from anon, authenticated;

grant select, insert, update, delete on table public.polls to service_role;
grant select, insert, update, delete on table public.poll_options to service_role;
grant select, insert, update, delete on table public.poll_votes to service_role;
grant select, insert, update, delete on table public.poll_events to service_role;
grant usage, select on sequence public.polls_poll_number_seq to service_role;
grant usage, select on sequence public.poll_events_id_seq to service_role;

alter table public.discord_bot_guilds add column if not exists polls_channel_id text;
update public.discord_bot_guilds
set polls_channel_id = '1540905290440900759'
where active = true and polls_channel_id is null;
