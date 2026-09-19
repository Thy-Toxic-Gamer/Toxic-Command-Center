alter table public.discord_tickets
  add column if not exists control_message_id text,
  add column if not exists assigned_to_user_id text,
  add column if not exists assigned_to_name text,
  add column if not exists claimed_at timestamptz;

alter table public.discord_ticket_events
  drop constraint if exists discord_ticket_events_event_type_check;

alter table public.discord_ticket_events
  add constraint discord_ticket_events_event_type_check
  check (event_type in ('created', 'opened', 'claimed', 'close_requested', 'closed', 'channel_deleted', 'failed'));
