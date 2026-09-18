import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const TWITCH_CLIENT_ID = "ht2kbpz12tpv060f2259jn9recng0x";
const DISCORD_CLIENT_ID = "1544711402873290873";
const DISCORD_API = "https://discord.com/api/v10";
const ALLOWED_ORIGIN = "https://thy-toxic-gamer.github.io";
const ACTIVE_STATUSES = ["pending", "awaiting_payment", "approved", "scheduled"];
const FINAL_STATUSES = ["completed", "denied", "cancelled", "expired"];
const ALL_STATUSES = new Set([...ACTIVE_STATUSES, ...FINAL_STATUSES]);
const DISCORD_ADMINISTRATOR = 1n << 3n;
const DISCORD_STAFF_PERMISSIONS = (1n << 1n) | (1n << 2n) | (1n << 5n) | (1n << 13n) | (1n << 40n);
const REQUEST_SELECT = "id,request_number,twitch_display_name,twitch_login,game_id,game_title,game_system,request_type,base_price,amount_due,is_owner,payment_required,status,created_at,updated_at,completed_at,resolution_note";
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

async function discordBot(path: string) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("Discord bot connection is unavailable.");
  const response = await fetch(`${DISCORD_API}${path}`, { headers: { Authorization: `Bot ${token}` } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Discord staff lookup failed (${response.status}).`);
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
        discordBot(`/guilds/${config.guild_id}/members/${userId}`),
        discordBot(`/guilds/${config.guild_id}/roles`),
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
  const { data: activeRows, error: activeError } = await admin.from("game_requests").select("id,request_number,game_title,status").in("status", ACTIVE_STATUSES).order("created_at").limit(1);
  if (activeError) throw new ApiError("Active requests could not be checked.", 500);
  const active = activeRows?.[0] ?? null;
  const manual = settings.manual_closed && (!settings.manual_reopens_at || new Date(settings.manual_reopens_at).getTime() > now);
  const cooldown = settings.cooldown_until && new Date(settings.cooldown_until).getTime() > now;
  const open = !active && !manual && !cooldown;
  let mode = "open", message = "Game requests are open.", reopensAt: string | null = null;
  if (active) { mode = "active_request"; message = `Requests are closed while ${active.game_title} is being processed.`; }
  else if (manual) { mode = "manual"; message = settings.closed_message; reopensAt = settings.manual_reopens_at; }
  else if (cooldown) { mode = "cooldown"; message = "The streamer is resting after the previous request."; reopensAt = settings.cooldown_until; }
  return { open, mode, message, reopensAt, activeRequest: active ? { id: active.id, code: `GR-${String(active.request_number).padStart(6, "0")}`, gameTitle: active.game_title, status: active.status } : null };
}

async function audit(admin: any, identity: Identity, staff: any, eventType: string, details: any, requestId: string | null = null) {
  await admin.from("game_request_system_events").insert({ event_type: eventType, actor_platform: identity.platform, actor_user_id: identity.id, actor_name: identity.displayName, actor_role: staff.role, request_id: requestId, details });
}

async function dashboard(admin: any, identity: Identity, staff: any) {
  const [state, queueResult, archiveResult] = await Promise.all([
    availability(admin),
    admin.from("game_requests").select(REQUEST_SELECT).in("status", ACTIVE_STATUSES).order("created_at", { ascending: false }).limit(100),
    admin.from("game_requests").select(REQUEST_SELECT).in("status", FINAL_STATUSES).order("updated_at", { ascending: false }).limit(250),
  ]);
  if (queueResult.error || archiveResult.error) throw new ApiError("Game Request records could not be loaded.", 500);
  return { staff: { platform: identity.platform, displayName: identity.displayName, avatarUrl: identity.avatarUrl, role: staff.role }, availability: state, queue: queueResult.data ?? [], archive: archiveResult.data ?? [] };
}

async function setAvailability(admin: any, identity: Identity, staff: any, body: any) {
  const desired = String(body.desired ?? "");
  if (!new Set(["open", "closed"]).has(desired)) throw new ApiError("Choose open or closed.");
  const current = await availability(admin);
  if (desired === "open" && current.activeRequest) throw new ApiError("Finish, deny, cancel, or expire the active request before reopening.", 409);
  const now = new Date();
  if (desired === "open") {
    await admin.from("game_request_settings").update({ requests_open: true, manual_closed: false, manual_reopens_at: null, cooldown_until: null, closed_message: "Game requests are temporarily closed.", updated_by_platform: identity.platform, updated_by_user_id: identity.id, updated_by_name: identity.displayName, updated_at: now.toISOString() }).eq("id", true);
    await audit(admin, identity, staff, "requests_opened", { early_reopen: current.mode === "cooldown" || current.mode === "manual" });
  } else {
    const rawReopens = body.reopensAt ? new Date(String(body.reopensAt)) : null;
    if (rawReopens && (!Number.isFinite(rawReopens.getTime()) || rawReopens.getTime() <= now.getTime())) throw new ApiError("Choose a future reopening time.");
    const message = String(body.message || "Game requests are temporarily closed.").trim().slice(0, 250) || "Game requests are temporarily closed.";
    await admin.from("game_request_settings").update({ requests_open: false, manual_closed: true, manual_reopens_at: rawReopens?.toISOString() ?? null, closed_message: message, updated_by_platform: identity.platform, updated_by_user_id: identity.id, updated_by_name: identity.displayName, updated_at: now.toISOString() }).eq("id", true);
    await audit(admin, identity, staff, "requests_closed", { message, reopens_at: rawReopens?.toISOString() ?? null });
  }
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
  const now = new Date();
  const update: any = { status, resolution_note: note || null, resolved_by_platform: identity.platform, resolved_by_user_id: identity.id, resolved_by_name: identity.displayName, updated_at: now.toISOString() };
  if (status === "completed") update.completed_at = now.toISOString();
  else if (existing.status === "completed") update.completed_at = null;
  const { error } = await admin.from("game_requests").update(update).eq("id", id);
  if (error?.code === "23505") throw new ApiError("Another request is already active.", 409);
  if (error) throw new ApiError("The request could not be updated.", 500);

  if (status === "completed") {
    const cooldownUntil = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    await admin.from("game_request_settings").update({ requests_open: false, current_request_id: null, cooldown_until: cooldownUntil, updated_by_platform: identity.platform, updated_by_user_id: identity.id, updated_by_name: identity.displayName, updated_at: now.toISOString() }).eq("id", true);
  } else if (FINAL_STATUSES.includes(status)) {
    const { data: settings } = await admin.from("game_request_settings").select("manual_closed,manual_reopens_at,cooldown_until").eq("id", true).single();
    const blocked = Boolean(settings?.manual_closed) || Boolean(settings?.cooldown_until && new Date(settings.cooldown_until).getTime() > now.getTime());
    await admin.from("game_request_settings").update({ requests_open: !blocked, current_request_id: null, cooldown_until: status === "completed" ? settings?.cooldown_until : null, updated_at: now.toISOString() }).eq("id", true);
  } else {
    await admin.from("game_request_settings").update({ requests_open: false, current_request_id: id, updated_at: now.toISOString() }).eq("id", true);
  }
  await admin.from("game_request_events").insert({ request_id: id, event_type: `status_${status}`, actor_twitch_user_id: identity.platform === "twitch" ? identity.id : null, details: { previous_status: existing.status, note, actor_platform: identity.platform, actor_name: identity.displayName, actor_role: staff.role } });
  await audit(admin, identity, staff, "request_status_changed", { previous_status: existing.status, status, note }, id);
  return await dashboard(admin, identity, staff);
}

async function deleteRequest(admin: any, identity: Identity, staff: any, body: any) {
  if (staff.role !== "owner") throw new ApiError("Only the owner can permanently delete archived requests.", 403);
  const id = String(body.id || "");
  const { data: existing, error } = await admin.from("game_requests").select("id,request_number,game_title,status").eq("id", id).maybeSingle();
  if (error || !existing) throw new ApiError("Archived request not found.", 404);
  if (!FINAL_STATUSES.includes(existing.status)) throw new ApiError("Only archived requests can be deleted.", 409);
  await audit(admin, identity, staff, "archived_request_deleted", { request_number: existing.request_number, game_title: existing.game_title, status: existing.status }, id);
  const result = await admin.from("game_requests").delete().eq("id", id);
  if (result.error) throw new ApiError("The archived request could not be deleted.", 500);
  return await dashboard(admin, identity, staff);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    validateProjectKey(request);
    const admin = adminClient();
    const body = await request.json().catch(() => ({}));
    if (body.action === "health") return json({ ok: true });
    const identity = await authenticate(request);
    const staff = await getStaff(admin, identity);
    if (!staff) throw new ApiError("This account does not have Game Request staff access.", 403);
    switch (body.action) {
      case "dashboard": return json(await dashboard(admin, identity, staff));
      case "set_availability": return json(await setAvailability(admin, identity, staff, body));
      case "update_request": return json(await updateRequest(admin, identity, staff, body));
      case "delete_request": return json(await deleteRequest(admin, identity, staff, body));
      default: throw new ApiError("Unknown action.", 404);
    }
  } catch (error) {
    console.error("Game Request staff API error", error);
    const status = error instanceof ApiError ? error.status : 500;
    return json({ error: error instanceof ApiError ? error.message : "The staff service could not complete this request." }, status);
  }
});
