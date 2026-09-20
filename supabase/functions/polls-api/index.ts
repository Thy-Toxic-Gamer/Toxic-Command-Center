import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const TWITCH_CLIENT_ID = "ht2kbpz12tpv060f2259jn9recng0x";
const DISCORD_CLIENT_ID = "1544711402873290873";
const DISCORD_API = "https://discord.com/api/v10";
const POLLS_CHANNEL_ID = "1540905290440900759";
const POLLS_URL = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/polls/";
const ALLOWED_ORIGIN = "https://thy-toxic-gamer.github.io";
const DISCORD_ADMINISTRATOR = 1n << 3n;
const DISCORD_STAFF_PERMISSIONS = (1n << 1n) | (1n << 2n) | (1n << 5n) | (1n << 13n) | (1n << 40n);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-polls-platform",
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
    try { for (const value of Object.values(JSON.parse(encoded))) if (typeof value === "string" && value) keys.add(value); }
    catch { throw new Error("Supabase key configuration is invalid."); }
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
  if (!match) throw new ApiError("Sign in is required.", 401);
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

async function authenticate(request: Request, forceTwitch = false): Promise<Identity> {
  const platform = String(request.headers.get("x-polls-platform") || "twitch").toLowerCase() as Platform;
  if (!(platform === "twitch" || platform === "discord")) throw new ApiError("Choose Twitch or Discord sign-in.");
  if (forceTwitch && platform !== "twitch") throw new ApiError("Poll voting requires Twitch sign-in.", 403);
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
      const owner = String(config.owner_user_id ?? "") === userId;
      const administrator = owner || stringIds(config.administrator_role_ids).some((id) => roleIds.has(id)) || (permissions & DISCORD_ADMINISTRATOR) !== 0n;
      const moderator = stringIds(config.moderator_role_ids).some((id) => roleIds.has(id)) || (permissions & DISCORD_STAFF_PERMISSIONS) !== 0n;
      if (administrator || moderator) return { role: owner ? "owner" : administrator ? "admin" : "staff" };
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
    const { data, error } = await admin.from("appeal_staff").select("role,active")
      .eq("platform", candidate.platform).eq("platform_user_id", candidate.id).eq("active", true).maybeSingle();
    if (error) throw new ApiError("Staff access could not be checked.", 500);
    if (data) return data;
  }
  const discordId = identity.platform === "discord" ? identity.id : link?.discord_user_id;
  return discordId ? await discordGuildStaff(admin, String(discordId)) : null;
}

function pollCode(row: any) { return `TTG-POLL-${String(row.poll_number).padStart(6, "0")}`; }
function discordTimestamp(value: string, style = "F") { return `<t:${Math.floor(new Date(value).getTime() / 1000)}:${style}>`; }

async function hydratePolls(admin: any, statuses: string[], limit = 50, viewer?: Identity) {
  const { data: rows, error } = await admin.from("polls").select("*").in("status", statuses).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new ApiError("Polls could not be loaded.", 500);
  const pollIds = (rows ?? []).map((row: any) => row.id);
  if (!pollIds.length) return [];
  const [{ data: options, error: optionError }, { data: votes, error: voteError }] = await Promise.all([
    admin.from("poll_options").select("id,poll_id,position,label").in("poll_id", pollIds).order("position"),
    admin.from("poll_votes").select("poll_id,option_id,voter_platform,voter_user_id").in("poll_id", pollIds),
  ]);
  if (optionError || voteError) throw new ApiError("Poll results could not be loaded.", 500);
  return (rows ?? []).map((row: any) => {
    const pollOptions = (options ?? []).filter((option: any) => option.poll_id === row.id);
    const pollVotes = (votes ?? []).filter((vote: any) => vote.poll_id === row.id);
    const totalVotes = pollVotes.length;
    const viewerVote = viewer ? pollVotes.find((vote: any) => vote.voter_platform === viewer.platform && vote.voter_user_id === viewer.id) : null;
    return {
      id: row.id,
      code: pollCode(row),
      question: row.question,
      description: row.description,
      status: row.status,
      closesAt: row.closes_at,
      closedAt: row.closed_at,
      createdAt: row.created_at,
      createdByName: row.created_by_name,
      totalVotes,
      viewerOptionId: viewerVote?.option_id ?? null,
      options: pollOptions.map((option: any) => {
        const count = pollVotes.filter((vote: any) => vote.option_id === option.id).length;
        return { id: option.id, position: option.position, label: option.label, count, percent: totalVotes ? Math.round((count / totalVotes) * 1000) / 10 : 0 };
      }),
    };
  });
}

function discordPayload(poll: any) {
  const closed = poll.status !== "open";
  const winner = closed && poll.totalVotes ? Math.max(...poll.options.map((option: any) => option.count)) : -1;
  const lines = poll.options.map((option: any) => {
    const marker = closed && option.count === winner && winner > 0 ? "🏆" : `${option.position}.`;
    return `${marker} **${option.label}** — ${option.count} vote${option.count === 1 ? "" : "s"} (${option.percent}%)`;
  });
  const timing = poll.closesAt && !closed
    ? `Voting closes ${discordTimestamp(poll.closesAt)} · ${discordTimestamp(poll.closesAt, "R")}`
    : closed ? `Closed${poll.closedAt ? ` ${discordTimestamp(poll.closedAt, "R")}` : ""}` : "No automatic closing time";
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `📊 ${poll.code} · ${closed ? "CLOSED" : "OPEN"}`,
      description: `## ${poll.question}\n${poll.description ? `${poll.description}\n\n` : ""}${lines.join("\n")}\n\n**Total votes:** ${poll.totalVotes}\n${timing}`.slice(0, 4000),
      color: closed ? 0x64748b : 0xb5ff18,
      footer: { text: closed ? "Final results · Votes were collected on the official website" : "Website-only voting · You may change your vote until this poll closes" },
      timestamp: new Date().toISOString(),
    }],
    components: closed ? [] : [{ type: 1, components: [{ type: 2, style: 5, label: "Vote on the website", url: POLLS_URL }] }],
  };
}

async function syncDiscord(admin: any, pollId: string) {
  const polls = await hydratePolls(admin, ["open", "closed", "archived"], 200);
  const poll = polls.find((item: any) => item.id === pollId);
  if (!poll) return;
  const { data: row } = await admin.from("polls").select("discord_channel_id,discord_message_id").eq("id", pollId).single();
  const channelId = row?.discord_channel_id || POLLS_CHANNEL_ID;
  try {
    let message = null;
    if (row?.discord_message_id) {
      message = await discordRequest(`/channels/${channelId}/messages/${row.discord_message_id}`, { method: "PATCH", body: JSON.stringify(discordPayload(poll)) }, true);
    }
    if (!message && poll.status !== "archived") {
      message = await discordRequest(`/channels/${POLLS_CHANNEL_ID}/messages`, { method: "POST", body: JSON.stringify(discordPayload(poll)) });
    }
    await admin.from("polls").update({
      discord_channel_id: message?.channel_id || channelId,
      discord_message_id: message?.id || row?.discord_message_id || null,
      discord_last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", pollId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discord sync failed.";
    await admin.from("polls").update({ discord_last_error: message.slice(0, 1000) }).eq("id", pollId);
  }
}

async function closeExpired(admin: any) {
  const now = new Date().toISOString();
  const { data: due } = await admin.from("polls").select("id").eq("status", "open").not("closes_at", "is", null).lte("closes_at", now).limit(100);
  for (const row of due ?? []) {
    const { data: closed } = await admin.from("polls").update({ status: "closed", closed_at: now, updated_at: now }).eq("id", row.id).eq("status", "open").select("id").maybeSingle();
    if (!closed) continue;
    await admin.from("poll_events").insert({ poll_id: row.id, event_type: "poll_closed", actor_platform: "system", actor_user_id: "poll-expiry", actor_name: "Automatic poll timer" });
    await syncDiscord(admin, row.id);
  }
}

async function publicState(admin: any, viewer?: Identity) {
  await closeExpired(admin);
  const polls = await hydratePolls(admin, ["open", "closed"], 60, viewer);
  const staff = viewer ? await getStaff(admin, viewer) : null;
  return {
    viewer: viewer ? {
      displayName: viewer.displayName,
      avatarUrl: viewer.avatarUrl,
      isStaff: Boolean(staff),
      staffRole: staff?.role ?? null,
    } : null,
    open: polls.filter((poll: any) => poll.status === "open"),
    closed: polls.filter((poll: any) => poll.status === "closed").slice(0, 20),
  };
}

async function staffContext(request: Request, admin: any) {
  const identity = await authenticate(request);
  const staff = await getStaff(admin, identity);
  if (!staff) throw new ApiError("This account is not authorized for poll controls.", 403);
  return { identity, staff };
}

async function dashboard(admin: any, identity: Identity, staff: any) {
  await closeExpired(admin);
  const polls = await hydratePolls(admin, ["open", "closed", "archived"], 100);
  return {
    staff: { displayName: identity.displayName, avatarUrl: identity.avatarUrl, role: staff.role, platform: identity.platform },
    open: polls.filter((poll: any) => poll.status === "open"),
    closed: polls.filter((poll: any) => poll.status === "closed"),
    archivedCount: polls.filter((poll: any) => poll.status === "archived").length,
  };
}

async function createPoll(admin: any, identity: Identity, staff: any, body: any) {
  const question = String(body.question || "").trim();
  const description = String(body.description || "").trim();
  const options = [...new Set((Array.isArray(body.options) ? body.options : []).map((value: any) => String(value || "").trim()).filter(Boolean))];
  const durationMinutes = Number(body.durationMinutes ?? 0);
  if (question.length < 3 || question.length > 240) throw new ApiError("The poll question must be 3–240 characters.");
  if (description.length > 1000) throw new ApiError("The description must be 1,000 characters or fewer.");
  if (options.length < 2 || options.length > 10) throw new ApiError("Add between 2 and 10 different choices.");
  if (options.some((value) => value.length > 100)) throw new ApiError("Each choice must be 100 characters or fewer.");
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 10080 || (durationMinutes > 0 && durationMinutes < 5)) throw new ApiError("Choose no timer or a duration from 5 minutes to 7 days.");
  const now = new Date();
  const closesAt = durationMinutes ? new Date(now.getTime() + durationMinutes * 60000).toISOString() : null;
  const { data: poll, error } = await admin.from("polls").insert({
    question, description: description || null, closes_at: closesAt,
    created_by_platform: identity.platform, created_by_user_id: identity.id, created_by_name: identity.displayName,
    discord_channel_id: POLLS_CHANNEL_ID,
  }).select("*").single();
  if (error || !poll) throw new ApiError("The poll could not be created.", 500);
  const { error: optionError } = await admin.from("poll_options").insert(options.map((label, index) => ({ poll_id: poll.id, position: index + 1, label })));
  if (optionError) {
    await admin.from("polls").delete().eq("id", poll.id);
    throw new ApiError("The poll choices could not be saved.", 500);
  }
  await admin.from("poll_events").insert({ poll_id: poll.id, event_type: "poll_created", actor_platform: identity.platform, actor_user_id: identity.id, actor_name: identity.displayName, details: { duration_minutes: durationMinutes, role: staff.role } });
  await syncDiscord(admin, poll.id);
  return await dashboard(admin, identity, staff);
}

async function closePoll(admin: any, identity: Identity, staff: any, body: any) {
  const id = String(body.id || "");
  const now = new Date().toISOString();
  const { data: row, error } = await admin.from("polls").update({ status: "closed", closed_at: now, updated_at: now }).eq("id", id).eq("status", "open").select("id").maybeSingle();
  if (error || !row) throw new ApiError("That open poll could not be found.", 404);
  await admin.from("poll_events").insert({ poll_id: id, event_type: "poll_closed", actor_platform: identity.platform, actor_user_id: identity.id, actor_name: identity.displayName, details: { role: staff.role } });
  await syncDiscord(admin, id);
  return await dashboard(admin, identity, staff);
}

async function clearPolls(admin: any, identity: Identity, staff: any, body: any) {
  if (staff.role !== "owner") throw new ApiError("Only the owner can clear all polls.", 403);
  if (body.confirmed !== true) throw new ApiError("Owner confirmation is required.");
  const now = new Date().toISOString();
  const { data: rows, error } = await admin.from("polls").update({ status: "archived", closed_at: now, updated_at: now }).neq("status", "archived").select("id");
  if (error) throw new ApiError("Polls could not be cleared.", 500);
  for (const row of rows ?? []) await syncDiscord(admin, row.id);
  await admin.from("poll_events").insert({ poll_id: null, event_type: "all_polls_cleared", actor_platform: identity.platform, actor_user_id: identity.id, actor_name: identity.displayName, details: { count: rows?.length ?? 0 } });
  return await dashboard(admin, identity, staff);
}

async function vote(admin: any, identity: Identity, body: any) {
  const pollId = String(body.pollId || "");
  const optionId = String(body.optionId || "");
  const { data: poll } = await admin.from("polls").select("id,status,closes_at").eq("id", pollId).maybeSingle();
  if (!poll) throw new ApiError("That poll could not be found.", 404);
  if (poll.status !== "open" || (poll.closes_at && new Date(poll.closes_at).getTime() <= Date.now())) {
    await closeExpired(admin);
    throw new ApiError("Voting for this poll has closed.", 409);
  }
  const { data: option } = await admin.from("poll_options").select("id").eq("id", optionId).eq("poll_id", pollId).maybeSingle();
  if (!option) throw new ApiError("Choose a valid poll option.");
  const { error } = await admin.from("poll_votes").upsert({
    poll_id: pollId, option_id: optionId, voter_platform: "twitch", voter_user_id: identity.id,
    voter_login: identity.login, voter_display_name: identity.displayName, updated_at: new Date().toISOString(),
  }, { onConflict: "poll_id,voter_platform,voter_user_id" });
  if (error) throw new ApiError("Your vote could not be saved.", 500);
  await admin.from("poll_events").insert({ poll_id: pollId, event_type: "vote_saved", actor_platform: "twitch", actor_user_id: identity.id, actor_name: identity.displayName, details: { option_id: optionId } });
  await syncDiscord(admin, pollId);
  return await publicState(admin, identity);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    validateProjectKey(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "public_state");
    const admin = adminClient();
    if (action === "public_state") return json(await publicState(admin));
    if (action === "viewer_state") return json(await publicState(admin, await authenticate(request, true)));
    if (action === "vote") return json(await vote(admin, await authenticate(request, true), body));
    const { identity, staff } = await staffContext(request, admin);
    if (action === "dashboard") return json(await dashboard(admin, identity, staff));
    if (action === "create_poll") return json(await createPoll(admin, identity, staff, body));
    if (action === "close_poll") return json(await closePoll(admin, identity, staff, body));
    if (action === "clear_polls") return json(await clearPolls(admin, identity, staff, body));
    throw new ApiError("Unknown poll action.", 404);
  } catch (error) {
    console.error("Polls API error", error);
    return json({ error: error instanceof ApiError ? error.message : "The Poll Center could not complete this request." }, error instanceof ApiError ? error.status : 500);
  }
});
