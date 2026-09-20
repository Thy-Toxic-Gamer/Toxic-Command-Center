create table if not exists public.giveaways (
  id uuid primary key default gen_random_uuid(),
  giveaway_number bigint generated always as identity unique,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  prize_type text not null default 'physical' check (prize_type in ('physical','digital','twitch_subscription','game_key','other')),
  claim_schema jsonb not null default '[]'::jsonb,
  prize_image_path text,
  status text not null default 'draft' check (status in ('draft','winner_selected','claim_submitted','shipped','completed','closed')),
  winner_twitch_id text,
  winner_login text,
  winner_display_name text,
  selected_at timestamptz,
  claim_deadline timestamptz,
  created_by_platform text not null,
  created_by_user_id text not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.giveaway_claims (
  id uuid primary key default gen_random_uuid(),
  giveaway_id uuid not null unique references public.giveaways(id) on delete cascade,
  winner_twitch_id text not null,
  email text check (char_length(email) <= 320),
  full_name text check (char_length(full_name) <= 160),
  address_line1 text check (char_length(address_line1) <= 200),
  address_line2 text not null default '' check (char_length(address_line2) <= 200),
  city text check (char_length(city) <= 120),
  state_region text check (char_length(state_region) <= 120),
  postal_code text check (char_length(postal_code) <= 40),
  country text check (char_length(country) <= 100),
  delivery_notes text not null default '' check (char_length(delivery_notes) <= 1000),
  custom_answers jsonb not null default '{}'::jsonb,
  carrier text not null default '' check (char_length(carrier) <= 100),
  tracking_number text not null default '' check (char_length(tracking_number) <= 200),
  submitted_at timestamptz not null default now(),
  tracking_added_at timestamptz,
  winner_saved_tracking_at timestamptz,
  prize_received_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.giveaway_events (
  id bigint generated always as identity primary key,
  giveaway_id uuid references public.giveaways(id) on delete set null,
  event_type text not null,
  actor_platform text not null,
  actor_user_id text not null,
  actor_name text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists giveaway_events_giveaway_id_idx on public.giveaway_events(giveaway_id);

alter table public.giveaways enable row level security;
alter table public.giveaway_claims enable row level security;
alter table public.giveaway_events enable row level security;
revoke all on public.giveaways, public.giveaway_claims, public.giveaway_events from anon, authenticated;
grant all on public.giveaways, public.giveaway_claims, public.giveaway_events to service_role;
grant usage, select on all sequences in schema public to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('giveaway-prizes', 'giveaway-prizes', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=false, file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];
