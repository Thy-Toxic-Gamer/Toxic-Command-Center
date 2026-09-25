-- Stores the exact YouTube broadcast URL for the current or most recent
-- stream so the Discord offline notification can retain a playable VOD preview.
alter table public.live_status
  add column if not exists youtube_vod_url text;
