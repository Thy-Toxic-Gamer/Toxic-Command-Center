import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const DISCORD_API = "https://discord.com/api/v10";
const EXPIRED_CHANNEL_ID = "1542746875805831289";
const LOG_CHANNEL_ID = "1543750250097938562";
const EXPIRED_NOTE = "Payment was not completed within the 24-hour payment window.";

function getKeySet(name: string, fallbackName: string) {
  const keys = new Set<string>();
  const encoded = Deno.env.get(name);
  if (encoded) {
    try {
      for (const value of Object.values(JSON.parse(encoded))) if (typeof value === "string" && value) keys.add(value);
    } catch { throw new Error("Supabase key configuration is invalid."); }
  }
  const fallback = Deno.env.get(fallbackName);
  if (fallback) keys.add(fallback);
  return keys;
}

function validateProjectKey(request: Request) {
  const supplied = request.headers.get("apikey") ?? "";
  return Boolean(supplied && getKeySet("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY").has(supplied));
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = [...getKeySet("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY")][0];
  if (!url || !key) throw new Error("Database configuration is unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requestCode(row: any) {
  return `GR-${String(row.request_number).padStart(6, "0")}`;
}

function discordTimestamp(value: string) {
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:F>`;
}

function expiredEmbed(row: any) {
  const fields: any[] = [
    { name: "Game", value: `${row.game_title}\n${row.game_system}`, inline: false },
    { name: "Requester", value: row.twitch_display_name, inline: true },
    { name: "Request Type", value: row.request_type, inline: true },
    { name: "Amount", value: `$${Number(row.amount_due).toFixed(2)}`, inline: true },
    { name: "Status", value: "Expired", inline: true },
  ];
  if (row.payment_expires_at) fields.push({ name: "Payment Deadline", value: discordTimestamp(row.payment_expires_at), inline: false });
  fields.push({ name: "Reason", value: EXPIRED_NOTE, inline: false });
  return {
    title: "Game Request Expired",
    color: 0xf97316,
    fields,
    ...(row.game_cover_url ? { image: { url: row.game_cover_url } } : {}),
    footer: { text: requestCode(row) },
    timestamp: row.updated_at || new Date().toISOString(),
  };
}

async function discordRequest(path: string, init: RequestInit = {}, allowNotFound = false) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("Discord bot connection is unavailable.");
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (allowNotFound && response.status === 404) return null;
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Discord request failed (${response.status}).`);
  return data;
}

async function syncExpiredDiscord(admin: any, row: any) {
  if (row.discord_channel_id === EXPIRED_CHANNEL_ID && row.discord_message_id) {
    const updated = await discordRequest(`/channels/${EXPIRED_CHANNEL_ID}/messages/${row.discord_message_id}`, {
      method: "PATCH",
      body: JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [expiredEmbed(row)] }),
    }, true);
    if (updated?.id) return;
  }

  const created = await discordRequest(`/channels/${EXPIRED_CHANNEL_ID}/messages`, {
    method: "POST",
    body: JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [expiredEmbed(row)] }),
  });
  if (!created?.id) throw new Error("Discord did not return a message ID.");
  const oldChannelId = row.discord_channel_id;
  const oldMessageId = row.discord_message_id;
  await admin.from("game_requests").update({
    discord_channel_id: EXPIRED_CHANNEL_ID,
    discord_message_id: String(created.id),
    discord_last_error: null,
  }).eq("id", row.id);
  if (oldChannelId && oldMessageId) {
    await discordRequest(`/channels/${oldChannelId}/messages/${oldMessageId}`, { method: "DELETE" }, true).catch(() => null);
  }
}

async function syncHistory(admin: any, row: any) {
  const { data: events } = await admin.from("game_request_events")
    .select("event_type,details,created_at")
    .eq("request_id", row.id)
    .order("created_at", { ascending: true })
    .limit(100);
  const lines = (events || []).map((event: any) => {
    const label = event.event_type === "status_expired" ? "Payment window expired" : String(event.event_type).replaceAll("_", " ");
    return `• <t:${Math.floor(new Date(event.created_at).getTime() / 1000)}:f> — **${label}**`;
  });
  const payload = JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [{
    title: `Game Request History · ${requestCode(row)}`,
    color: 0xf97316,
    fields: [
      { name: "Current Game", value: `${row.game_title}\n${row.game_system}`, inline: false },
      { name: "Requester", value: row.twitch_display_name, inline: true },
      { name: "Current Status", value: "Expired", inline: true },
      { name: "Outcome Reason", value: EXPIRED_NOTE, inline: false },
    ],
    description: lines.join("\n").slice(0, 3900) || "Payment window expired.",
    ...(row.game_cover_url ? { thumbnail: { url: row.game_cover_url } } : {}),
    footer: { text: "This single log is updated through the final outcome." },
    timestamp: row.updated_at,
  }] });

  if (row.discord_log_message_id) {
    const updated = await discordRequest(`/channels/${LOG_CHANNEL_ID}/messages/${row.discord_log_message_id}`, { method: "PATCH", body: payload }, true);
    if (updated?.id) return;
  }
  const created = await discordRequest(`/channels/${LOG_CHANNEL_ID}/messages`, { method: "POST", body: payload });
  if (created?.id) await admin.from("game_requests").update({ discord_log_message_id: String(created.id) }).eq("id", row.id);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  if (!validateProjectKey(request)) return Response.json({ error: "Invalid project key." }, { status: 401 });
  try {
    const admin = adminClient();
    const now = new Date().toISOString();
    const { data: dueRows, error } = await admin.from("game_requests")
      .select("*")
      .eq("status", "awaiting_payment")
      .not("payment_expires_at", "is", null)
      .lte("payment_expires_at", now)
      .limit(100);
    if (error) throw new Error("Expired payment requests could not be loaded.");

    let expired = 0;
    let synced = 0;
    let failed = 0;
    for (const row of dueRows || []) {
      const { data: updated, error: updateError } = await admin.from("game_requests").update({
        status: "expired",
        resolution_note: EXPIRED_NOTE,
        completed_at: null,
        scheduled_for: null,
        updated_at: now,
      }).eq("id", row.id).eq("status", "awaiting_payment").select("*").maybeSingle();
      if (updateError || !updated) continue;
      expired += 1;
      await admin.from("game_request_events").insert({
        request_id: row.id,
        event_type: "status_expired",
        actor_twitch_user_id: null,
        details: { previous_status: "awaiting_payment", note: EXPIRED_NOTE, actor_platform: "system", actor_name: "Automatic payment timer", actor_role: "system" },
      });
      await admin.from("game_request_system_events").insert({
        event_type: "request_status_changed",
        actor_platform: "system",
        actor_user_id: "payment-expiry",
        actor_name: "Automatic payment timer",
        actor_role: "system",
        request_id: row.id,
        details: { previous_status: "awaiting_payment", status: "expired", note: EXPIRED_NOTE },
      });
      const { data: settings } = await admin.from("game_request_settings").select("manual_closed,manual_reopens_at,cooldown_until,current_request_id").eq("id", true).single();
      if (settings?.current_request_id === row.id) {
        const blocked = Boolean(settings.manual_closed) || Boolean(settings.cooldown_until && new Date(settings.cooldown_until).getTime() > Date.now());
        await admin.from("game_request_settings").update({ requests_open: !blocked, current_request_id: null, cooldown_until: null, updated_at: now }).eq("id", true);
      }
      try {
        await syncExpiredDiscord(admin, updated);
        const { data: refreshed } = await admin.from("game_requests").select("*").eq("id", row.id).single();
        await syncHistory(admin, refreshed || updated);
        synced += 1;
      } catch (discordError) {
        const message = discordError instanceof Error ? discordError.message : "Discord routing failed.";
        await admin.from("game_requests").update({ discord_last_error: message.slice(0, 1000) }).eq("id", row.id);
        failed += 1;
      }
    }

    const { data: retryRows } = await admin.from("game_requests")
      .select("*")
      .eq("status", "expired")
      .not("payment_expires_at", "is", null)
      .or(`discord_channel_id.is.null,discord_channel_id.neq.${EXPIRED_CHANNEL_ID}`)
      .limit(100);
    for (const row of retryRows || []) {
      try {
        await syncExpiredDiscord(admin, row);
        const { data: refreshed } = await admin.from("game_requests").select("*").eq("id", row.id).single();
        await syncHistory(admin, refreshed || row);
        synced += 1;
      } catch (discordError) {
        const message = discordError instanceof Error ? discordError.message : "Discord routing failed.";
        await admin.from("game_requests").update({ discord_last_error: message.slice(0, 1000) }).eq("id", row.id);
        failed += 1;
      }
    }

    return Response.json({ ok: failed === 0, checked: dueRows?.length ?? 0, expired, synced, failed });
  } catch (error) {
    console.error("Game request payment expiry failed", error);
    return Response.json({ error: "Game request payment expiry failed." }, { status: 500 });
  }
});
