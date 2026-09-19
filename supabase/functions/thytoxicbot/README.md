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

Running `/t guide` later refreshes both the registered command set and the
pinned staff guide after a function update.

## Bot permissions

Use application commands, manage channels, view channels, send messages, embed
links, read message history, manage messages, create/manage threads, send
messages in threads, moderate members, kick members, and ban members. Keep the
bot role above members it must moderate. Administrator is not required.

Install/update link:

`https://discord.com/oauth2/authorize?client_id=1544711402873290873&permissions=1425929268246&integration_type=0&scope=bot%20applications.commands`

The bot also needs a channel-specific allow in `ticket-logs` for View Channel,
Send Messages, Embed Links, and Read Message History. This keeps the private log
channel restricted without granting the bot broad Manage Roles access.

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
- `/t infractions` gives authorized staff a compact list of every current
  infraction, with an optional action filter.
- `/t clearinfractions` is owner-only, requires the exact confirmation
  `CLEAR ALL INFRACTIONS`, reverses current warnings/timeouts/bans, and keeps
  the protected case and event history for audit purposes.
- `/t poll` and `/t polls` list every open poll and provide the official Poll
  Center button. Voting remains website-only.
- The four Ticket Center buttons create private channels under their matching
  Discord categories. Authorized moderators, administrators, and the server
  owner can claim an open ticket; the assigned staff member is saved in the
  status message and protected website record. Closing first saves the full
  conversation to the protected website Ticket Center and posts a permanent
  summary in ticket-logs, then deletes the Discord channel. If log delivery
  fails, the private ticket channel stays open instead of silently disappearing.
- Closed ticket records automatically purge after six months.
- Records and staff notes automatically purge after six months.
