import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const DISCORD_CLIENT_ID = "1544711402873290873";
const DISCORD_API = "https://discord.com/api/v10";
const ALLOWED_ORIGIN = "https://thy-toxic-gamer.github.io";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
const DISCORD_ADMINISTRATOR = 1n << 3n;
const DISCORD_STAFF_PERMISSIONS = (1n << 1n) | (1n << 2n) | (1n << 5n) | (1n << 13n) | (1n << 40n);
const TICKET_TYPES = new Set(["general", "report", "staff", "suggestion"]);
const TICKET_STATUSES = new Set(["creating", "open", "closing", "closed", "failed"]);

class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...CORS_HEADERS },
  });
}

function keySet(name: string, fallbackName: string) {
  const values = new Set<string>();
  const encoded = Deno.env.get(name);
  if (encoded) {
    try {
      for (const value of Object.values(JSON.parse(encoded))) if (typeof value === "string" && value) values.add(value);
    } catch {
      throw new Error("Supabase key configuration is invalid.");
    }
  }
  const fallback = Deno.env.get(fallbackName);
  if (fallback) values.add(fallback);
  return values;
}

function adminClient() {
  const key = [...keySet("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY")][0];
  const url = Deno.env.get("SUPABASE_URL");
  if (!url || !key) throw new Error("Supabase admin configuration is unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function validateProjectKey(request: Request) {
  const supplied = request.headers.get("apikey") ?? "";
  if (!supplied || !keySet("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY").has(supplied)) {
    throw new ApiError("Invalid project key.", 401);
  }
}

function bearer(value: string | null) {
  const match = (value ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError("Sign in with Discord to continue.", 401);
  return match[1];
}

async function discordFetch(url: string, init: RequestInit, label: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) continue;
      return response;
    } catch (error) {
      if (attempt === 0) continue;
      console.error(`${label} request failed`, error);
    }
  }
  throw new ApiError(`${label} is temporarily unavailable. Please try again.`, 502);
}

async function discordIdentity(accessToken: string) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const authorizationResponse = await discordFetch(`${DISCORD_API}/oauth2/@me`, { headers }, "Discord authorization");
  if (!authorizationResponse.ok) throw new ApiError("Your Discord session has expired. Sign in again.", 401);
  const authorization = await authorizationResponse.json().catch(() => null);
  if (String(authorization?.application?.id ?? "") !== DISCORD_CLIENT_ID) {
    throw new ApiError("This Discord session is not valid for the Ticket Center.", 401);
  }
  const userResponse = await discordFetch(`${DISCORD_API}/users/@me`, { headers }, "Discord identity");
  const user = await userResponse.json().catch(() => null);
  if (!userResponse.ok || typeof user?.id !== "string") throw new ApiError("Discord could not verify this account.", 502);
  return { id: user.id, username: user.username, displayName: user.global_name || user.username };
}

async function discordBot(path: string) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("Discord staff verification is unavailable.");
  const response = await fetch(`${DISCORD_API}${path}`, { headers: { Authorization: `Bot ${token}` } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || `Discord request failed (${response.status}).`);
  return body;
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function permissionValue(value: unknown): bigint {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    return 0n;
  }
}

async function requireStaff(admin: any, user: { id: string; username: string; displayName: string }) {
  const { data: configs, error } = await admin.from("discord_bot_guilds")
    .select("guild_id,owner_user_id,moderator_role_ids,administrator_role_ids").eq("active", true);
  if (error) throw new ApiError(`Staff configuration lookup failed (${error.code || "database"}).`, 500);
  for (const config of configs ?? []) {
    try {
      const [member, roles] = await Promise.all([
        discordBot(`/guilds/${config.guild_id}/members/${user.id}`),
        discordBot(`/guilds/${config.guild_id}/roles`),
      ]);
      const memberRoles = new Set<string>([String(config.guild_id), ...stringIds(member.roles)]);
      let permissions = 0n;
      for (const role of Array.isArray(roles) ? roles : []) if (memberRoles.has(String(role.id))) permissions |= permissionValue(role.permissions);
      const owner = String(config.owner_user_id ?? "") === user.id;
      const adminRole = stringIds(config.administrator_role_ids).some((id) => memberRoles.has(id));
      const moderatorRole = stringIds(config.moderator_role_ids).some((id) => memberRoles.has(id));
      const administrator = owner || adminRole || (permissions & DISCORD_ADMINISTRATOR) !== 0n;
      const moderator = moderatorRole || (permissions & DISCORD_STAFF_PERMISSIONS) !== 0n;
      if (!administrator && !moderator) continue;
      return {
        guildId: String(config.guild_id),
        role: owner ? "owner" : administrator ? "admin" : "staff",
        username: member.user?.username || user.username,
        displayName: member.nick || member.user?.global_name || user.displayName,
      };
    } catch (error) {
      console.warn("Ticket staff lookup failed", config.guild_id, user.id, error);
    }
  }
  throw new ApiError("This Discord account does not have Ticket Center staff access.", 403);
}

function summary(row: any) {
  const transcript = Array.isArray(row.transcript) ? row.transcript : [];
  return {
    id: row.id,
    ticket_number: row.ticket_number,
    ticket_code: row.ticket_code,
    ticket_type: row.ticket_type,
    requester_user_id: row.requester_user_id,
    requester_username: row.requester_username,
    requester_display_name: row.requester_display_name,
    assigned_to_user_id: row.assigned_to_user_id,
    assigned_to_name: row.assigned_to_name,
    claimed_at: row.claimed_at,
    status: row.status,
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    closed_by_name: row.closed_by_name,
    close_reason: row.close_reason,
    channel_deleted_at: row.channel_deleted_at,
    deletion_error: row.deletion_error,
    purge_after: row.purge_after,
    message_count: transcript.length,
  };
}

async function listTickets(admin: any, staff: any, body: any) {
  let query = admin.from("discord_tickets").select("*").eq("guild_id", staff.guildId).order("created_at", { ascending: false }).limit(200);
  const status = String(body.status ?? "all");
  const type = String(body.ticketType ?? "all");
  if (status !== "all") {
    if (!TICKET_STATUSES.has(status)) throw new ApiError("Choose a valid ticket status.");
    query = query.eq("status", status);
  }
  if (type !== "all") {
    if (!TICKET_TYPES.has(type)) throw new ApiError("Choose a valid ticket type.");
    query = query.eq("ticket_type", type);
  }
  const { data, error } = await query;
  if (error) throw new ApiError(`Ticket records could not be loaded (${error.code || "database"}).`, 500);
  return json({ tickets: (data ?? []).map(summary), staff });
}

async function ticketDetail(admin: any, staff: any, body: any) {
  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError("Choose a valid ticket.");
  const { data, error } = await admin.from("discord_tickets").select("*").eq("id", id).eq("guild_id", staff.guildId).maybeSingle();
  if (error) throw new ApiError(`Ticket record could not be loaded (${error.code || "database"}).`, 500);
  if (!data) throw new ApiError("That ticket was not found.", 404);
  return json({ ticket: { ...summary(data), transcript: Array.isArray(data.transcript) ? data.transcript : [] }, staff });
}

async function deleteTicket(admin: any, staff: any, body: any) {
  if (staff.role !== "owner") throw new ApiError("Only the server owner can permanently delete a ticket record.", 403);
  const id = String(body.id ?? "");
  const { data: row, error: loadError } = await admin.from("discord_tickets").select("id,ticket_code,status").eq("id", id).eq("guild_id", staff.guildId).maybeSingle();
  if (loadError) throw new ApiError(`Ticket lookup failed (${loadError.code || "database"}).`, 500);
  if (!row) throw new ApiError("That ticket was not found.", 404);
  if (!["closed", "failed"].includes(row.status)) throw new ApiError("Close the Discord ticket before deleting its saved record.", 409);
  if (body.confirmed !== true) throw new ApiError("Owner confirmation is required.");
  const { error } = await admin.from("discord_tickets").delete().eq("id", row.id).eq("guild_id", staff.guildId);
  if (error) throw new ApiError(`Ticket deletion failed (${error.code || "database"}).`, 500);
  return json({ deleted: true, ticket_code: row.ticket_code });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method === "GET") return json({ ok: true, service: "tickets-api", release: 1 });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    if (request.headers.get("origin") !== ALLOWED_ORIGIN) throw new ApiError("This request must come from the official ThyToxicGamer site.", 403);
    validateProjectKey(request);
    const body = await request.json().catch(() => ({}));
    const identity = await discordIdentity(bearer(request.headers.get("authorization")));
    const admin = adminClient();
    const staff = await requireStaff(admin, identity);
    if (body.action === "me") return json({ user: identity, staff });
    if (body.action === "list") return await listTickets(admin, staff, body);
    if (body.action === "detail") return await ticketDetail(admin, staff, body);
    if (body.action === "delete") return await deleteTicket(admin, staff, body);
    throw new ApiError("Unsupported Ticket Center action.", 404);
  } catch (error) {
    console.error("tickets-api", error);
    return json({ error: error instanceof Error ? error.message : "The Ticket Center could not complete this request." }, error instanceof ApiError ? error.status : 500);
  }
});
