# ThyToxicBot moderation and appeals

This Supabase Edge Function is the Discord interaction endpoint for the fresh
Toxic Command Core appeals system. It does not contain credentials.

## Required Edge Function secrets

Set these in Supabase project `ubldjtsjfudogtgxakiq` under **Edge Functions →
Secrets**:

- `DISCORD_APPLICATION_ID=1544711402873290873`
- `DISCORD_APPEALS_CHANNEL_ID=1537193380864598037`
- `DISCORD_PUBLIC_KEY` from the Discord Developer Portal General Information page
- `DISCORD_BOT_TOKEN` from the Discord Developer Portal Bot page

Never commit or paste the bot token into chat. Reset it first if it has ever been
shared outside a secret manager.

## Discord endpoint

Set the application's Interactions Endpoint URL to:

`https://ubldjtsjfudogtgxakiq.supabase.co/functions/v1/thytoxicbot`

Discord's signed endpoint check triggers a safe bootstrap. The function derives
the server from the configured appeals channel, registers the `/t` command,
stores the application owner as the owner-only identity, and posts or updates the
staff guide in the appeals channel.

## Bot permissions

Use application commands, view channels, send messages, embed links, read
message history, manage messages, create/manage threads, send messages in
threads, moderate members, kick members, and ban members. Keep the bot role
above members it must moderate. Administrator is not required.

Install/update link:

`https://discord.com/oauth2/authorize?client_id=1544711402873290873&permissions=1425929268230&integration_type=0&scope=bot%20applications.commands`

## Behavior

- Discord requests are verified with the application's Ed25519 public key.
- Moderation work is deferred after Discord's three-second acknowledgement.
- Every action receives a `TTG-MOD-######` case and audit history.
- The bot attempts to open the member DM before the action, then sends the
  result and appeal link after the action. This improves delivery reliability
  for bans while keeping the notice post-action.
- Member replies and staff replies remain attached to the protected case.
- Accepted appeals that still require a reversal become
  `accepted_pending_reversal`; an administrator must run the matching reversal.
- Records and staff notes automatically purge after six months.
