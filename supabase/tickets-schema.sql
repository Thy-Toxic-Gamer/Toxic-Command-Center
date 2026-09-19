create table if not exists public.discord_ticket_config (
  guild_id text primary key references public.discord_bot_guilds(guild_id) on delete cascade,
  ticket_center_channel_id text not null,
  ticket_status_channel_id text not null,
  ticket_log_channel_id text not null,
  general_category_id text not null,
  report_category_id text not null,
  staff_category_id text not null,
  suggestion_category_id text not null,
  retention_months integer not null default 6 check (retention_months between 1 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.discord_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint generated always as identity unique,
  ticket_code text generated always as ('TTG-TKT-' || lpad(ticket_number::text, 6, '0')) stored unique,
  guild_id text not null references public.discord_bot_guilds(guild_id) on delete cascade,
  ticket_type text not null check (ticket_type in ('general', 'report', 'staff', 'suggestion')),
  requester_user_id text not null,
  requester_username text not null,
  requester_display_name text,
  channel_id text unique,
  control_message_id text,
  status_message_id text,
  log_message_id text,
  assigned_to_user_id text,
  assigned_to_name text,
  claimed_at timestamptz,
  status text not null default 'creating' check (status in ('creating', 'open', 'closing', 'closed', 'failed')),
  transcript jsonb not null default '[]'::jsonb check (jsonb_typeof(transcript) = 'array'),
  close_reason text check (close_reason is null or char_length(close_reason) <= 1000),
  closed_by_user_id text,
  closed_by_name text,
  opened_at timestamptz,
  closed_at timestamptz,
  channel_deleted_at timestamptz,
  deletion_error text check (deletion_error is null or char_length(deletion_error) <= 1000),
  purge_after timestamptz not null default (now() + interval '6 months'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists discord_tickets_one_open_per_requester
on public.discord_tickets (guild_id, requester_user_id)
where status in ('creating', 'open', 'closing');

create index if not exists discord_tickets_status_created_idx
on public.discord_tickets (status, created_at desc);

create index if not exists discord_tickets_purge_after_idx
on public.discord_tickets (purge_after);

create table if not exists public.discord_ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.discord_tickets(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'opened', 'claimed', 'close_requested', 'closed', 'channel_deleted', 'failed')),
  actor_user_id text,
  actor_name text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists discord_ticket_events_ticket_created_idx
on public.discord_ticket_events (ticket_id, created_at);

alter table public.discord_ticket_config enable row level security;
alter table public.discord_tickets enable row level security;
alter table public.discord_ticket_events enable row level security;

revoke all on table public.discord_ticket_config from anon, authenticated;
revoke all on table public.discord_tickets from anon, authenticated;
revoke all on table public.discord_ticket_events from anon, authenticated;
revoke usage, select on sequence public.discord_tickets_ticket_number_seq from anon, authenticated;
revoke usage, select on sequence public.discord_ticket_events_id_seq from anon, authenticated;

grant select, insert, update, delete on table public.discord_ticket_config to service_role;
grant select, insert, update, delete on table public.discord_tickets to service_role;
grant select, insert, update, delete on table public.discord_ticket_events to service_role;
grant usage, select on sequence public.discord_tickets_ticket_number_seq to service_role;
grant usage, select on sequence public.discord_ticket_events_id_seq to service_role;

insert into public.discord_ticket_config (
  guild_id,
  ticket_center_channel_id,
  ticket_status_channel_id,
  ticket_log_channel_id,
  general_category_id,
  report_category_id,
  staff_category_id,
  suggestion_category_id
) values (
  '1536917090756460588',
  '1536971857088086026',
  '1537873056326754375',
  '1536972726273576971',
  '1537679253070680135',
  '1537679672610136174',
  '1537679450731188304',
  '1537679540854198332'
) on conflict (guild_id) do update set
  ticket_center_channel_id = excluded.ticket_center_channel_id,
  ticket_status_channel_id = excluded.ticket_status_channel_id,
  ticket_log_channel_id = excluded.ticket_log_channel_id,
  general_category_id = excluded.general_category_id,
  report_category_id = excluded.report_category_id,
  staff_category_id = excluded.staff_category_id,
  suggestion_category_id = excluded.suggestion_category_id,
  active = true,
  updated_at = now();

update public.discord_bot_guilds
set moderator_role_ids = '["1536920426133856278"]'::jsonb,
    administrator_role_ids = '["1536920342914662433"]'::jsonb,
    updated_at = now()
where guild_id = '1536917090756460588';

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'discord-ticket-retention';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end $$;

select cron.schedule(
  'discord-ticket-retention',
  '31 4 * * *',
  $$delete from public.discord_tickets where status in ('closed', 'failed') and purge_after <= now();$$
);

comment on table public.discord_tickets is 'Private Discord ticket records and closed-channel transcripts retained for six months.';
comment on table public.discord_ticket_events is 'Protected lifecycle audit trail for ThyToxicBot tickets.';
