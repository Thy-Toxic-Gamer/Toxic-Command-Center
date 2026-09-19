import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const TWITCH_CLIENT_ID = "ht2kbpz12tpv060f2259jn9recng0x";
const DISCORD_CLIENT_ID = "1544711402873290873";
const DISCORD_API = "https://discord.com/api/v10";
const ALLOWED_ORIGIN = "https://thy-toxic-gamer.github.io";
const ACTIVE_STATUSES = ["pending", "awaiting_payment", "approved", "scheduled"];
const FINAL_STATUSES = ["completed", "denied", "cancelled", "expired"];
const ALL_STATUSES = new Set([...ACTIVE_STATUSES, ...FINAL_STATUSES]);
const CHANNELS: Record<string, string> = {
  pending: "1542688040353275994",
  awaiting_payment: "1542727353602543616",
  approved: "1542690394255532052",
  scheduled: "1544521683728338964",
  completed: "1543811262125965402",
  denied: "1542690094450872410",
  cancelled: "1542744432862957600",
  expired: "1542746875805831289",
};
const LOG_CHANNEL_ID = "1543750250097938562";
const YOUTUBE_LIVE_CHANNEL_ID = "1536919057939439626";
const DISCORD_ADMINISTRATOR = 1n << 3n;
const DISCORD_STAFF_PERMISSIONS = (1n << 1n) | (1n << 2n) | (1n << 5n) | (1n << 13n) | (1n << 40n);
const REQUEST_SELECT = "id,request_number,twitch_display_name,twitch_login,game_id,game_title,game_system,game_cover_url,request_type,base_price,amount_due,is_owner,payment_required,paypal_status,payment_requested_at,payment_expires_at,payment_completed_at,status,created_at,updated_at,completed_at,resolution_note,scheduled_for,youtube_vod_url,viewer_change_count,pending_change_game_id,pending_change_game_title,pending_change_game_system,pending_change_cover_url,pending_change_requested_at";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-game-platform",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

type Platform = "twitch" | "discord";
type Identity = { platform: Platform; id: string; login: string; displayName: string; avatarUrl: string };

class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

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

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = [...getKeySet("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY")][0];
  if (!url || !key) throw new Error("Database configuration is unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function validateProjectKey(request: Request) {
  const supplied = request.headers.get("apikey") ?? "";
  if (!supplied || !getKeySet("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY").has(supplied)) throw new ApiError("Invalid project key.", 401);
}

function bearer(request: Request) {
  const match = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError("Staff sign-in is required.", 401);
  return match[1];
}

async function twitchIdentity(token: string): Promise<Identity> {
  const validationResponse = await fetch("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${token}` } });
  const validation = await validationResponse.json().catch(() => null);
  if (!validationResponse.ok) throw new ApiError("Your Twitch session has expired. Sign in again.", 401);
  if (validation?.client_id !== TWITCH_CLIENT_ID || typeof validation?.user_id !== "string") throw new ApiError("This Twitch session is not valid.", 401);
  const response = await fetch("https://api.twitch.tv/helix/users", { headers: { Authorization: `Bearer ${token}`, "Client-Id": TWITCH_CLIENT_ID } });
  const body = await response.json().catch(() => null);
  const user = body?.data?.[0];
  if (!response.ok || !user || user.id !== validation.user_id) throw new ApiError("Twitch could not verify this account.", 502);
  return { platform: "twitch", id: user.id, login: user.login, displayName: user.display_name, avatarUrl: user.profile_image_url || "" };
}

async function discordIdentity(token: string): Promise<Identity> {
  const headers = { Authorization: `Bearer ${token}` };
  const authResponse = await fetch(`${DISCORD_API}/oauth2/@me`, { headers });
  const authorization = await authResponse.json().catch(() => null);
  if (!authResponse.ok) throw new ApiError("Your Discord session has expired. Sign in again.", 401);
  if (String(authorization?.application?.id ?? "") !== DISCORD_CLIENT_ID) throw new ApiError("This Discord session is not valid.", 401);
  const response = await fetch(`${DISCORD_API}/users/@me`, { headers });
  const user = await response.json().catch(() => null);
  if (!response.ok || typeof user?.id !== "string") throw new ApiError("Discord could not verify this account.", 502);
  const avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128` : "";
  return { platform: "discord", id: user.id, login: user.username, displayName: user.global_name || user.username, avatarUrl };
}

async function authenticate(request: Request): Promise<Identity> {
  const platform = String(request.headers.get("x-game-platform") || "twitch").toLowerCase() as Platform;
  if (!(["twitch", "discord"] as string[]).includes(platform)) throw new ApiError("Choose Twitch or Discord sign-in.");
  const token = bearer(request);
  return platform === "discord" ? await discordIdentity(token) : await twitchIdentity(token);
}

async function discordRequest(path: string, init: RequestInit = {}, allowNotFound = false) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("Discord bot connection is unavailable.");
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
  });
  if (allowNotFound && response.status === 404) return null;
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Discord request failed (${response.status}).`);
  return data;
}

function stringIds(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : []; }
function permissionValue(value: unknown): bigint { try { return BigInt(String(value ?? "0")); } catch { return 0n; } }

async function linkedIdentity(admin: any, identity: Identity) {
  const column = identity.platform === "twitch" ? "twitch_user_id" : "discord_user_id";
  const { data } = await admin.from("appeal_identity_links").select("*").eq(column, identity.id).maybeSingle();
  return data ?? null;
}

async function discordGuildStaff(admin: any, userId: string) {
  const { data: configs, error } = await admin.from("discord_bot_guilds")
    .select("guild_id,owner_user_id,moderator_role_ids,administrator_role_ids").eq("active", true);
  if (error) throw new ApiError("Discord staff access could not be checked.", 500);
  for (const config of configs ?? []) {
    try {
      const [member, roles] = await Promise.all([
        discordRequest(`/guilds/${config.guild_id}/members/${userId}`),
        discordRequest(`/guilds/${config.guild_id}/roles`),
      ]);
      const roleIds = new Set([String(config.guild_id), ...stringIds(member.roles)]);
      let permissions = 0n;
      for (const role of Array.isArray(roles) ? roles : []) if (roleIds.has(String(role.id))) permissions |= permissionValue(role.permissions);
      const administrator = String(config.owner_user_id ?? "") === userId || stringIds(config.administrator_role_ids).some((id) => roleIds.has(id)) || (permissions & DISCORD_ADMINISTRATOR) !== 0n;
      const moderator = stringIds(config.moderator_role_ids).some((id) => roleIds.has(id)) || (permissions & DISCORD_STAFF_PERMISSIONS) !== 0n;
      if (!administrator && !moderator) continue;
      return { role: administrator ? "admin" : "staff", username: member.user?.username || userId, display_name: member.nick || member.user?.global_name || member.user?.username || userId };
    } catch (error) { console.warn("Discord staff lookup failed", error); }
  }
  return null;
}

async function getStaff(admin: any, identity: Identity) {
  const link = await linkedIdentity(admin, identity);
  const candidates = [{ platform: identity.platform, id: identity.id }];
  if (link) {
    candidates.push({ platform: "twitch" as Platform, id: link.twitch_user_id });
    candidates.push({ platform: "discord" as Platform, id: link.discord_user_id });
  }
  for (const candidate of candidates) {
    if (!candidate.id) continue;
    const { data, error } = await admin.from("appeal_staff").select("username,display_name,role,active")
      .eq("platform", candidate.platform).eq("platform_user_id", candidate.id).eq("active", true).maybeSingle();
    if (error) throw new ApiError("Staff access could not be checked.", 500);
    if (data) return data;
  }
  const discordId = identity.platform === "discord" ? identity.id : link?.discord_user_id;
  return discordId ? await discordGuildStaff(admin, String(discordId)) : null;
}

async function availability(admin: any) {
  const now = Date.now();
  let { data: settings, error } = await admin.from("game_request_settings").select("*").eq("id", true).single();
  if (error) throw new ApiError("Game Request settings are unavailable.", 500);
  if (settings.manual_closed && settings.manual_reopens_at && new Date(settings.manual_reopens_at).getTime() <= now) {
    const result = await admin.from("game_request_settings").update({ manual_closed: false, manual_reopens_at: null, requests_open: true, updated_at: new Date().toISOString() }).eq("id", true).select("*").single();
    if (!result.error) settings = result.data;
  }
  const { data: activeRows, error: activeError } = await admin.from("game_requests").select("id,request_number,game_id,game_title,game_system,game_cover_url,status,scheduled_for").in("status", ACTIVE_STATUSES).order("created_at").limit(1);
  if (activeError) throw new ApiError("Active requests could not be checked.", 500);
  const active = activeRows?.[0] ?? null;
  const manual = settings.manual_closed && (!settings.manual_reopens_at || new Date(settings.manual_reopens_at).getTime() > now);
  const cooldown = settings.cooldown_until && new Date(settings.cooldown_until).getTime() > now;
  const open = !active && !manual && !cooldown;
  let mode = "open", message = "Game requests are open.", reopensAt: string | null = null;
  if (active) { mode = "active_request"; message = `Requests are closed while ${active.game_title} is being processed.`; }
  else if (manual) { mode = "manual"; message = settings.closed_message; reopensAt = settings.manual_reopens_at; }
  else if (cooldown) { mode = "cooldown"; message = "The streamer is resting after the previous request."; reopensAt = settings.cooldown_until; }
  return { open, mode, message, reopensAt, activeRequest: active ? { id: active.id, code: `GR-${String(active.request_number).padStart(6, "0")}`, gameId: active.game_id, gameTitle: active.game_title, gameSystem: active.game_system, coverUrl: active.game_cover_url, status: active.status, scheduledFor: active.scheduled_for } : null };
}

function requestCode(row: any) { return `GR-${String(row.request_number).padStart(6, "0")}`; }
function displayStatus(status: string) { return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function discordTimestamp(value: string) { return `<t:${Math.floor(new Date(value).getTime() / 1000)}:F>`; }

function youtubeUrl(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || !(host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be")) return null;
    return url.toString().slice(0, 500);
  } catch { return null; }
}

function youtubeVideoId(value: unknown) {
  const match = String(value || "").match(/(?:youtube\.com\/(?:watch\?[^\s#]*v=|live\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
  return match?.[1] || null;
}

async function latestYoutubeVodFromDiscord() {
  const messages = await discordRequest(`/channels/${YOUTUBE_LIVE_CHANNEL_ID}/messages?limit=25`);
  for (const message of Array.isArray(messages) ? messages : []) {
    const videoId = youtubeVideoId(JSON.stringify(message));
    if (!videoId) continue;
    const embed = Array.isArray(message.embeds) ? message.embeds[0] : null;
    return {
      videoId,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      title: String(embed?.title || "Latest YouTube livestream"),
      publishedAt: typeof message.timestamp === "string" ? message.timestamp : null,
      thumbnailUrl: String(embed?.image?.url || embed?.thumbnail?.url || ""),
      source: "discord_live_notification",
    };
  }
  throw new ApiError("No recent YouTube livestream link was found in Discord.", 404);
}

async function latestYoutubeVod() {
  const apiKey = Deno.env.get("YOUTUBE_API_KEY") ?? "";
  if (!apiKey) return await latestYoutubeVodFromDiscord();

  try {
    let channelId = (Deno.env.get("YOUTUBE_CHANNEL_ID") ?? "").trim();
    if (!channelId) {
      const channelParams = new URLSearchParams({
        part: "id",
        forHandle: Deno.env.get("YOUTUBE_HANDLE") || "ThyToxicGamer",
        key: apiKey,
      });
      const channelResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?${channelParams}`);
      const channelBody = await channelResponse.json().catch(() => null);
      channelId = String(channelBody?.items?.[0]?.id || "");
      if (!channelResponse.ok || !channelId) throw new Error("The YouTube channel could not be found.");
    }

    const searchParams = new URLSearchParams({
      part: "snippet",
      channelId,
      eventType: "completed",
      type: "video",
      order: "date",
      maxResults: "10",
      key: apiKey,
    });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`);
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error("YouTube could not load the latest completed livestream.");
    const item = Array.isArray(body?.items)
      ? body.items.find((candidate: any) => typeof candidate?.id?.videoId === "string")
      : null;
    if (!item) throw new Error("No completed YouTube livestream was found.");

    const videoId = String(item.id.videoId);
    const snippet = item.snippet ?? {};
    return {
      videoId,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      title: String(snippet.title || "Latest completed livestream"),
      publishedAt: typeof snippet.publishedAt === "string" ? snippet.publishedAt : null,
      thumbnailUrl: String(snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || ""),
      source: "youtube_api",
    };
  } catch (error) {
    console.warn("YouTube API VOD lookup failed; using the Discord live notification record.", error);
    return await latestYoutubeVodFromDiscord();
  }
}

function requestEmbed(row: any) {
  const colors: Record<string, number> = { pending: 0xff3b93, awaiting_payment: 0xffc107, approved: 0xb5ff18, scheduled: 0x5865f2, completed: 0x22c55e, denied: 0xef4444, cancelled: 0x94a3b8, expired: 0xf97316 };
  const titles: Record<string, string> = { pending: "New Game Request", awaiting_payment: "Game Request Awaiting Payment", approved: "Game Request Approved", scheduled: "Game Request Scheduled", completed: "Game Request Completed", denied: "Game Request Denied", cancelled: "Game Request Cancelled", expired: "Game Request Expired" };
  const fields: any[] = [
    { name: "Game", value: `${row.game_title}\n${row.game_system}`, inline: false },
    { name: "Requester", value: row.twitch_display_name, inline: true },
    { name: "Request Type", value: row.request_type, inline: true },
    { name: "Amount", value: row.is_owner ? "$0.00 · Owner" : `$${Number(row.amount_due).toFixed(2)}`, inline: true },
    { name: "Status", value: displayStatus(row.status), inline: true },
  ];
  if (row.scheduled_for) fields.push({ name: "Scheduled For", value: discordTimestamp(row.scheduled_for), inline: false });
  if (row.status === "awaiting_payment" && row.payment_expires_at) fields.push({ name: "Payment Deadline", value: discordTimestamp(row.payment_expires_at), inline: false });
  if (row.status === "completed" && row.youtube_vod_url) fields.push({ name: "YouTube VOD", value: `[Watch the completed request](${row.youtube_vod_url})`, inline: false });
  if (row.resolution_note) fields.push({ name: "Staff Note", value: String(row.resolution_note).slice(0, 1000), inline: false });
  if (row.pending_change_game_id) fields.push({ name: "Requested Game Change", value: `${row.pending_change_game_title}\n${row.pending_change_game_system}\nWaiting for staff review`, inline: false });
  fields.push({ name: "Catalog ID", value: row.game_id, inline: true });
  return { title: titles[row.status] || "Game Request", color: colors[row.status] || 0xb5ff18, fields, ...(row.game_cover_url ? { image: { url: row.game_cover_url } } : {}), footer: { text: requestCode(row) }, timestamp: row.updated_at || row.created_at };
}

async function routeDiscordRecord(existing: any, next: any) {
  const targetChannel = CHANNELS[next.status];
  if (!targetChannel) throw new Error("The Discord destination channel is not configured.");
  const payload = JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [requestEmbed(next)] });
  if (existing.discord_channel_id === targetChannel && existing.discord_message_id) {
    const updated = await discordRequest(`/channels/${targetChannel}/messages/${existing.discord_message_id}`, { method: "PATCH", body: payload }, true);
    if (updated?.id) return { channelId: targetChannel, messageId: String(updated.id), oldChannelId: null, oldMessageId: null, created: false };
  }
  const created = await discordRequest(`/channels/${targetChannel}/messages`, { method: "POST", body: payload });
  if (!created?.id) throw new Error("Discord did not return a message ID.");
  return { channelId: targetChannel, messageId: String(created.id), oldChannelId: existing.discord_channel_id || null, oldMessageId: existing.discord_message_id || null, created: true };
}

async function removeDiscordMessage(channelId: string | null, messageId: string | null) {
  if (!channelId || !messageId) return;
  await discordRequest(`/channels/${channelId}/messages/${messageId}`, { method: "DELETE" }, true);
}

async function sendDiscordLog(title: string, fields: any[], color = 0xb5ff18) {
  await discordRequest(`/channels/${LOG_CHANNEL_ID}/messages`, {
    method: "POST",
    body: JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [{ title, color, fields, timestamp: new Date().toISOString() }] }),
  });
}

function eventLine(event: any) {
  const labels: Record<string, string> = { request_submitted: "Request submitted", owner_request_approved: "Owner request submitted and approved", paypal_order_created: "PayPal checkout opened", payment_completed: "PayPal payment verified", game_change_requested: "Viewer requested a game change", game_change_applied: "Game change applied", game_change_denied: "Game change denied" };
  const type = String(event.event_type || "");
  const label = labels[type] || (type.startsWith("status_") ? `Status changed to ${type.slice(7).replaceAll("_", " ")}` : type.replaceAll("_", " "));
  const details = event.details || {};
  const extras = [details.actor_name, details.note, details.new_game_title ? `New game: ${details.new_game_title}` : null, details.scheduled_for ? `Scheduled: ${discordTimestamp(details.scheduled_for)}` : null].filter(Boolean);
  return `• <t:${Math.floor(new Date(event.created_at).getTime() / 1000)}:f> — **${label}**${extras.length ? ` · ${extras.join(" · ")}` : ""}`;
}

function historyEmbeds(row: any, events: any[]) {
  const summary: any = { title: `Game Request History · ${requestCode(row)}`, color: row.status === "completed" ? 0x22c55e : row.status === "denied" ? 0xef4444 : row.status === "cancelled" ? 0x94a3b8 : 0xb5ff18, fields: [{ name: "Current Game", value: `${row.game_title}\n${row.game_system}`, inline: false }, { name: "Requester", value: row.twitch_display_name, inline: true }, { name: "Request Type", value: row.request_type, inline: true }, { name: "Current Status", value: displayStatus(row.status), inline: true }], ...(row.game_cover_url ? { thumbnail: { url: row.game_cover_url } } : {}), footer: { text: "This single log is updated through the final outcome." }, timestamp: row.updated_at || row.created_at };
  if (row.scheduled_for) summary.fields.push({ name: "Scheduled For", value: discordTimestamp(row.scheduled_for), inline: false });
  if (row.resolution_note) summary.fields.push({ name: "Outcome Reason", value: String(row.resolution_note).slice(0, 1024), inline: false });
  const lines = events.filter((event) => event.event_type !== "discord_record_failed").map(eventLine);
  const chunks: string[] = [];
  let chunk = "";
  for (const line of lines) { if (chunk && chunk.length + line.length + 1 > 3900) { chunks.push(chunk); chunk = ""; } chunk += `${chunk ? "\n" : ""}${line}`; }
  if (chunk || !chunks.length) chunks.push(chunk || "No history recorded yet.");
  return [summary, ...chunks.slice(0, 9).map((description, index) => ({ title: index ? `Timeline continued ${index + 1}` : "Complete Timeline", color: 0x252b26, description }))];
}

async function syncDiscordHistoryLog(admin: any, requestId: string) {
  const [{ data: row, error: rowError }, { data: events, error: eventsError }] = await Promise.all([
    admin.from("game_requests").select("*").eq("id", requestId).single(),
    admin.from("game_request_events").select("event_type,details,created_at").eq("request_id", requestId).order("created_at", { ascending: true }).limit(500),
  ]);
  if (rowError || eventsError || !row) throw new Error("Game request history could not be loaded.");
  const payload = JSON.stringify({ allowed_mentions: { parse: [] }, embeds: historyEmbeds(row, events || []) });
  if (row.discord_log_message_id) {
    const updated = await discordRequest(`/channels/${LOG_CHANNEL_ID}/messages/${row.discord_log_message_id}`, { method: "PATCH", body: payload }, true);
    if (updated?.id) return;
  }
  const created = await discordRequest(`/channels/${LOG_CHANNEL_ID}/messages`, { method: "POST", body: payload });
  if (!created?.id) throw new Error("Discord did not return a request history message ID.");
  await admin.from("game_requests").update({ discord_log_message_id: String(created.id) }).eq("id", requestId);
}

async function audit(admin: any, identity: Identity, staff: any, eventType: string, details: any, requestId: string | null = null) {
  await admin.from("game_request_system_events").insert({ event_type: eventType, actor_platform: identity.platform, actor_user_id: identity.id, actor_name: identity.displayName, actor_role: staff.role, request_id: requestId, details });
}

async function dashboard(admin: any, identity: Identity, staff: any) {
  const [state, queueResult, archiveResult, catalogResult] = await Promise.all([
    availability(admin),
    admin.from("game_requests").select(REQUEST_SELECT).in("status", ACTIVE_STATUSES).order("created_at", { ascending: false }).limit(100),
    admin.from("game_requests").select(REQUEST_SELECT).in("status", FINAL_STATUSES).order("updated_at", { ascending: false }).limit(250),
    admin.from("game_catalog").select("id,title,system,cover_url,display_id,search_aliases").eq("requestable", true).order("title", { ascending: true }),
  ]);
  if (queueResult.error || archiveResult.error || catalogResult.error) throw new ApiError("Game Request records could not be loaded.", 500);
  return { staff: { platform: identity.platform, displayName: identity.displayName, avatarUrl: identity.avatarUrl, role: staff.role }, availability: state, queue: queueResult.data ?? [], archive: archiveResult.data ?? [], catalog: catalogResult.data ?? [] };
}

async function setAvailability(admin: any, identity: Identity, staff: any, body: any) {
  const desired = String(body.desired ?? "");
  if (!new Set(["open", "closed"]).has(desired)) throw new ApiError("Choose open or closed.");
  const current = await availability(admin);
  if (desired === "open" && current.activeRequest) throw new ApiError("Finish, deny, cancel, or expire the active request before reopening.", 409);
  const now = new Date();
  let logFields: any[];
  if (desired === "open") {
    const result = await admin.from("game_request_settings").update({ requests_open: true, manual_closed: false, manual_reopens_at: null, cooldown_until: null, closed_message: "Game requests are temporarily closed.", updated_by_platform: identity.platform, updated_by_user_id: identity.id, updated_by_name: identity.displayName, updated_at: now.toISOString() }).eq("id", true);
    if (result.error) throw new ApiError("Game requests could not be opened.", 500);
    await audit(admin, identity, staff, "requests_opened", { early_reopen: current.mode === "cooldown" || current.mode === "manual" });
    logFields = [{ name: "Action", value: "Requests opened", inline: true }, { name: "Staff", value: identity.displayName, inline: true }];
  } else {
    const rawReopens = body.reopensAt ? new Date(String(body.reopensAt)) : null;
    if (rawReopens && (!Number.isFinite(rawReopens.getTime()) || rawReopens.getTime() <= now.getTime())) throw new ApiError("Choose a future reopening time.");
    const message = String(body.message || "Game requests are temporarily closed.").trim().slice(0, 250) || "Game requests are temporarily closed.";
    const result = await admin.from("game_request_settings").update({ requests_open: false, manual_closed: true, manual_reopens_at: rawReopens?.toISOString() ?? null, closed_message: message, updated_by_platform: identity.platform, updated_by_user_id: identity.id, updated_by_name: identity.displayName, updated_at: now.toISOString() }).eq("id", true);
    if (result.error) throw new ApiError("Game requests could not be closed.", 500);
    await audit(admin, identity, staff, "requests_closed", { message, reopens_at: rawReopens?.toISOString() ?? null });
    logFields = [{ name: "Action", value: "Requests closed", inline: true }, { name: "Staff", value: identity.displayName, inline: true }, { name: "Reason", value: message, inline: false }];
    if (rawReopens) logFields.push({ name: "Scheduled Reopening", value: discordTimestamp(rawReopens.toISOString()), inline: false });
  }
  try { await sendDiscordLog("Game Request Availability Changed", logFields); } catch (error) { console.error("Discord availability log failed", error); }
  return await dashboard(admin, identity, staff);
}

async function updateRequest(admin: any, identity: Identity, staff: any, body: any) {
  const id = String(body.id || "");
  const status = String(body.status || "");
  const note = String(body.note || "").trim().slice(0, 1000);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError("Request not found.", 404);
  if (!ALL_STATUSES.has(status)) throw new ApiError("Choose a valid request status.");
  const { data: existing, error: existingError } = await admin.from("game_requests").select("*").eq("id", id).maybeSingle();
  if (existingError || !existing) throw new ApiError("Request not found.", 404);
  if (FINAL_STATUSES.includes(existing.status)) throw new ApiError("Archived requests cannot be changed.", 409);
  if (status === "cancelled" && !note) throw new ApiError("A cancellation reason is required.");
  if (!existing.is_owner && ["approved", "scheduled", "completed"].includes(status) && existing.paypal_status !== "COMPLETED") {
    throw new ApiError("Payment must be verified before this request can be approved, scheduled, or completed.", 409);
  }

  const now = new Date();
  let scheduledFor: string | null = null;
  if (status === "scheduled") {
    const candidate = body.scheduledFor || existing.scheduled_for;
    const parsed = candidate ? new Date(String(candidate)) : null;
    if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.getTime() <= now.getTime()) throw new ApiError("Choose a future date and time before marking this request scheduled.");
    scheduledFor = parsed.toISOString();
  }
  const vodUrl = status === "completed" ? youtubeUrl(body.youtubeVodUrl || existing.youtube_vod_url) : null;
  if (status === "completed" && !vodUrl) throw new ApiError("Add a valid YouTube VOD link before marking this request completed.");

  const deleteAt = new Date(now);
  deleteAt.setUTCMonth(deleteAt.getUTCMonth() + 9);
  const paymentRequestedAt = status === "awaiting_payment"
    ? (existing.status === "awaiting_payment" && existing.payment_requested_at ? existing.payment_requested_at : now.toISOString())
    : null;
  const paymentExpiresAt = paymentRequestedAt
    ? new Date(new Date(paymentRequestedAt).getTime() + 24 * 60 * 60 * 1000).toISOString()
    : null;
  const update: any = {
    status,
    payment_requested_at: paymentRequestedAt,
    payment_expires_at: paymentExpiresAt,
    resolution_note: note || null,
    scheduled_for: scheduledFor,
    youtube_vod_url: vodUrl,
    completed_at: status === "completed" ? now.toISOString() : null,
    discord_delete_at: status === "completed" ? deleteAt.toISOString() : null,
    discord_deleted_at: null,
    discord_last_error: null,
    resolved_by_platform: identity.platform,
    resolved_by_user_id: identity.id,
    resolved_by_name: identity.displayName,
    updated_at: now.toISOString(),
  };
  const next = { ...existing, ...update };

  let route: any;
  try { route = await routeDiscordRecord(existing, next); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Discord routing failed.";
    await admin.from("game_requests").update({ discord_last_error: message.slice(0, 1000) }).eq("id", id);
    throw new ApiError("Discord could not move this request. Nothing was changed. Check the bot's channel permissions.", 502);
  }
  update.discord_channel_id = route.channelId;
  update.discord_message_id = route.messageId;

  const { error } = await admin.from("game_requests").update(update).eq("id", id);
  if (error) {
    if (route.created) await removeDiscordMessage(route.channelId, route.messageId).catch(() => null);
    if (error.code === "23505") throw new ApiError("Another request is already active.", 409);
    throw new ApiError("The request could not be updated.", 500);
  }

  if (status === "completed") {
    const cooldownUntil = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    await admin.from("game_request_settings").update({ requests_open: false, current_request_id: null, cooldown_until: cooldownUntil, updated_by_platform: identity.platform, updated_by_user_id: identity.id, updated_by_name: identity.displayName, updated_at: now.toISOString() }).eq("id", true);
  } else if (FINAL_STATUSES.includes(status)) {
    const { data: settings } = await admin.from("game_request_settings").select("manual_closed,manual_reopens_at,cooldown_until").eq("id", true).single();
    const blocked = Boolean(settings?.manual_closed) || Boolean(settings?.cooldown_until && new Date(settings.cooldown_until).getTime() > now.getTime());
    await admin.from("game_request_settings").update({ requests_open: !blocked, current_request_id: null, cooldown_until: null, updated_at: now.toISOString() }).eq("id", true);
  } else {
    await admin.from("game_request_settings").update({ requests_open: false, current_request_id: id, updated_at: now.toISOString() }).eq("id", true);
  }

  if (route.oldChannelId && route.oldMessageId) {
    try { await removeDiscordMessage(route.oldChannelId, route.oldMessageId); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Old Discord record could not be removed.";
      await admin.from("game_requests").update({ discord_last_error: message.slice(0, 1000) }).eq("id", id);
      console.error("Old Discord request record removal failed", error);
    }
  }

  const eventDetails = { previous_status: existing.status, note, scheduled_for: scheduledFor, payment_expires_at: paymentExpiresAt, youtube_vod_attached: Boolean(vodUrl), actor_platform: identity.platform, actor_name: identity.displayName, actor_role: staff.role };
  await admin.from("game_request_events").insert({ request_id: id, event_type: `status_${status}`, actor_twitch_user_id: identity.platform === "twitch" ? identity.id : null, details: eventDetails });
  await audit(admin, identity, staff, "request_status_changed", { previous_status: existing.status, status, note, scheduled_for: scheduledFor, youtube_vod_attached: Boolean(vodUrl) }, id);
  await syncDiscordHistoryLog(admin, id).catch((error) => console.error("Discord request history update failed", error));
  return await dashboard(admin, identity, staff);
}

async function changeGame(admin: any, identity: Identity, staff: any, body: any) {
  const id = String(body.id || "");
  const mode = String(body.mode || "direct");
  const note = String(body.note || "").trim().slice(0, 1000);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError("Request not found.", 404);
  if (!new Set(["direct", "apply", "deny"]).has(mode)) throw new ApiError("Choose a valid game-change action.");
  const { data: existing, error } = await admin.from("game_requests").select("*").eq("id", id).maybeSingle();
  if (error || !existing) throw new ApiError("Request not found.", 404);
  if (FINAL_STATUSES.includes(existing.status)) throw new ApiError("Archived requests cannot be changed.", 409);
  if ((mode === "apply" || mode === "deny") && !existing.pending_change_game_id) throw new ApiError("There is no viewer game change waiting for review.", 409);
  if (mode === "deny" && !note) throw new ApiError("Add a reason for denying the viewer's game change.");

  let next: any;
  let eventType: string;
  let details: any;
  if (mode === "deny") {
    next = { ...existing, pending_change_game_id: null, pending_change_game_title: null, pending_change_game_system: null, pending_change_cover_url: null, pending_change_requested_at: null, updated_at: new Date().toISOString() };
    eventType = "game_change_denied";
    details = { actor_name: identity.displayName, actor_role: staff.role, requested_game_title: existing.pending_change_game_title, note };
  } else {
    const gameId = mode === "apply" ? existing.pending_change_game_id : String(body.gameId || "");
    const { data: game, error: gameError } = await admin.from("game_catalog").select("id,title,system,cover_url,requestable").eq("id", gameId).maybeSingle();
    if (gameError) throw new ApiError("The replacement game could not be checked.", 500);
    if (!game || !game.requestable) throw new ApiError("Choose an available replacement game.");
    if (game.id === existing.game_id) throw new ApiError("Choose a different game.");
    next = { ...existing, game_id: game.id, game_title: game.title, game_system: game.system, game_cover_url: game.cover_url, pending_change_game_id: null, pending_change_game_title: null, pending_change_game_system: null, pending_change_cover_url: null, pending_change_requested_at: null, ...(existing.paypal_status === "COMPLETED" ? {} : { paypal_order_id: null, paypal_status: null, payment_error: null, payment_attempts: 0 }), updated_at: new Date().toISOString() };
    eventType = "game_change_applied";
    details = { actor_name: identity.displayName, actor_role: staff.role, previous_game_title: existing.game_title, new_game_title: game.title, source: mode === "apply" ? "viewer_request" : "staff_direct", note };
  }

  let route: any;
  try { route = await routeDiscordRecord(existing, next); }
  catch (discordError) { throw new ApiError("Discord could not update the request game. Nothing was changed.", 502); }
  const update: any = {
    game_id: next.game_id,
    game_title: next.game_title,
    game_system: next.game_system,
    game_cover_url: next.game_cover_url,
    pending_change_game_id: null,
    pending_change_game_title: null,
    pending_change_game_system: null,
    pending_change_cover_url: null,
    pending_change_requested_at: null,
    discord_channel_id: route.channelId,
    discord_message_id: route.messageId,
    updated_at: next.updated_at,
  };
  if (existing.paypal_status !== "COMPLETED" && mode !== "deny") Object.assign(update, { paypal_order_id: null, paypal_status: null, payment_error: null, payment_attempts: 0 });
  const updated = await admin.from("game_requests").update(update).eq("id", id);
  if (updated.error) throw new ApiError("The request game could not be changed.", 500);
  if (route.oldChannelId && route.oldMessageId) await removeDiscordMessage(route.oldChannelId, route.oldMessageId).catch(() => null);
  await admin.from("game_request_events").insert({ request_id: id, event_type: eventType, actor_twitch_user_id: identity.platform === "twitch" ? identity.id : null, details });
  await audit(admin, identity, staff, eventType, details, id);
  await syncDiscordHistoryLog(admin, id).catch((historyError) => console.error("Discord request history update failed", historyError));
  return await dashboard(admin, identity, staff);
}

async function deleteRequest(admin: any, identity: Identity, staff: any, body: any) {
  if (staff.role !== "owner") throw new ApiError("Only the owner can permanently delete archived requests.", 403);
  const id = String(body.id || "");
  const { data: existing, error } = await admin.from("game_requests").select("id,request_number,game_title,status,discord_channel_id,discord_message_id,discord_log_message_id").eq("id", id).maybeSingle();
  if (error || !existing) throw new ApiError("Archived request not found.", 404);
  if (!FINAL_STATUSES.includes(existing.status)) throw new ApiError("Only archived requests can be deleted.", 409);
  await audit(admin, identity, staff, "archived_request_deleted", { request_number: existing.request_number, game_title: existing.game_title, status: existing.status }, id);
  const result = await admin.from("game_requests").delete().eq("id", id);
  if (result.error) throw new ApiError("The archived request could not be deleted.", 500);
  await removeDiscordMessage(existing.discord_channel_id, existing.discord_message_id).catch((discordError) => console.error("Deleted archive Discord cleanup failed", discordError));
  await removeDiscordMessage(LOG_CHANNEL_ID, existing.discord_log_message_id).catch((discordError) => console.error("Deleted archive Discord history cleanup failed", discordError));
  await sendDiscordLog("Game Request Archive Deleted", [
    { name: "Request", value: `${requestCode(existing)} · ${existing.game_title}`, inline: false },
    { name: "Previous Status", value: displayStatus(existing.status), inline: true },
    { name: "Owner", value: identity.displayName, inline: true },
  ], 0xef4444).catch((discordError) => console.error("Discord archive deletion log failed", discordError));
  return await dashboard(admin, identity, staff);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    validateProjectKey(request);
    const admin = adminClient();
    const body = await request.json().catch(() => ({}));
    if (body.action === "health") return json({ ok: true, discordWorkflow: true, statuses: Object.keys(CHANNELS) });
    const identity = await authenticate(request);
    const staff = await getStaff(admin, identity);
    if (!staff) throw new ApiError("This account does not have Game Request staff access.", 403);
    switch (body.action) {
      case "dashboard": return json(await dashboard(admin, identity, staff));
      case "latest_youtube_vod": return json({ vod: await latestYoutubeVod() });
      case "set_availability": return json(await setAvailability(admin, identity, staff, body));
      case "update_request": return json(await updateRequest(admin, identity, staff, body));
      case "change_game": return json(await changeGame(admin, identity, staff, body));
      case "delete_request": return json(await deleteRequest(admin, identity, staff, body));
      default: throw new ApiError("Unknown action.", 404);
    }
  } catch (error) {
    console.error("Game Request staff API error", error);
    const status = error instanceof ApiError ? error.status : 500;
    return json({ error: error instanceof ApiError ? error.message : "The staff service could not complete this request." }, status);
  }
});
