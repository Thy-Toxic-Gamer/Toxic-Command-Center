import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const TWITCH_CLIENT_ID = "ht2kbpz12tpv060f2259jn9recng0x";
const DISCORD_CLIENT_ID = "1544711402873290873";
const ALLOWED_ORIGIN = "https://thy-toxic-gamer.github.io";
const DISCORD_API = "https://discord.com/api/v10";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-appeals-platform, x-link-platform, x-link-authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
const OPEN_STATUSES = ["submitted", "under_review", "needs_information"];
const CASE_STATUSES = new Set(["submitted", "under_review", "needs_information", "accepted", "denied", "closed", "archived"]);
const STAFF_CASE_FILTERS = new Set([...CASE_STATUSES, "active", "appealed", "accepted_pending_reversal", "reversed", "failed"]);
const FINAL_CASE_STATUSES = new Set(["accepted", "denied", "closed", "reversed", "archived"]);
const PUNISHMENTS = new Set(["ban", "timeout", "mute", "warning", "other"]);
const PLATFORMS = new Set(["twitch", "discord"]);
const INFRACTION_PLATFORMS = new Set(["twitch", "youtube", "kick", "discord", "tiktok", "instagram", "x_twitter"]);
const DISCORD_ADMINISTRATOR = 1n << 3n;
const DISCORD_STAFF_PERMISSIONS = (1n << 1n) | (1n << 2n) | (1n << 5n) | (1n << 13n) | (1n << 40n);
const CASE_SELECT = "id,case_number,platform,identity_platform,appellant_username,appellant_display_name,punishment_type,punishment_reference,appeal_reason,evidence,status,staff_response,submitted_at,created_at,updated_at,resolution_log_message_id";
const DISCORD_CASE_SELECT = "id,case_number,case_code,guild_id,subject_user_id,subject_username,subject_display_name,action,status,reason,evidence,appeal_reason,staff_response,appealed_at,created_at,updated_at,appeal_message_id,appeal_thread_id,action_succeeded,reversed_at,reversed_by_user_id,closed_at,resolution_log_message_id";

type Platform = "twitch" | "discord";
type Identity = {
  platform: Platform;
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string;
  accessToken: string;
};

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
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...CORS_HEADERS,
    },
  });
}

function getKeySet(name: string, fallbackName: string) {
  const keys = new Set<string>();
  const encoded = Deno.env.get(name);
  if (encoded) {
    try {
      for (const value of Object.values(JSON.parse(encoded))) {
        if (typeof value === "string" && value) keys.add(value);
      }
    } catch {
      throw new Error("Supabase key configuration is invalid.");
    }
  }
  const fallback = Deno.env.get(fallbackName);
  if (fallback) keys.add(fallback);
  return keys;
}

function adminClient() {
  const keys = getKeySet("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const key = [...keys][0];
  const url = Deno.env.get("SUPABASE_URL");
  if (!url || !key) throw new Error("Supabase admin configuration is unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function healthCheck(admin: any) {
  const checks = await Promise.allSettled([
    admin.from("appeal_cases").select("id").limit(1),
    admin.from("discord_moderation_cases").select("id").limit(1),
    admin.from("appeal_identity_links").select("id").limit(1),
    admin.from("appeal_staff").select("id").limit(1),
  ]);
  const names = ["platform_cases", "discord_cases", "identity_links", "staff_access"];
  const services = Object.fromEntries(checks.map((result: any, index) => {
    if (result.status === "rejected") return [names[index], { ok: false, code: "NETWORK" }];
    return [names[index], { ok: !result.value.error, code: result.value.error?.code ?? null }];
  }));
  return json({ ok: Object.values(services).every((service: any) => service.ok), release: 26, services });
}

function validateProjectKey(request: Request) {
  const suppliedKey = request.headers.get("apikey") ?? "";
  const publishableKeys = getKeySet("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  if (!suppliedKey || !publishableKeys.has(suppliedKey)) throw new ApiError("Invalid project key.", 401);
}

function bearer(value: string | null, platform: Platform) {
  const match = (value ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError(`Sign in with ${platform === "twitch" ? "Twitch" : "Discord"} to continue.`, 401);
  return match[1];
}

async function identityFetch(url: string, init: RequestInit, provider: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) continue;
      return response;
    } catch (error) {
      if (attempt === 0) continue;
      console.error(`${provider} identity request failed`, error);
    }
  }
  throw new ApiError(`${provider} sign-in verification is temporarily unavailable. Please try again.`, 502);
}

async function twitchIdentity(accessToken: string): Promise<Identity> {
  const validationResponse = await identityFetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${accessToken}` },
  }, "Twitch");
  if (!validationResponse.ok) throw new ApiError("Your Twitch session has expired. Sign in again.", 401);
  const validation = await validationResponse.json().catch(() => null);
  if (validation?.client_id !== TWITCH_CLIENT_ID || typeof validation?.user_id !== "string" || typeof validation?.login !== "string") {
    throw new ApiError("This Twitch session is not valid for the Appeals Center.", 401);
  }
  const response = await identityFetch("https://api.twitch.tv/helix/users", {
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": TWITCH_CLIENT_ID },
  }, "Twitch");
  const body = await response.json().catch(() => null);
  const user = body?.data?.[0];
  if (!response.ok || !user || user.id !== validation.user_id) throw new ApiError("Twitch could not verify this account.", 502);
  return {
    platform: "twitch",
    id: user.id,
    login: user.login,
    displayName: user.display_name,
    avatarUrl: user.profile_image_url || "",
    accessToken,
  };
}

async function discordIdentity(accessToken: string): Promise<Identity> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const authorizationResponse = await identityFetch(`${DISCORD_API}/oauth2/@me`, { headers }, "Discord");
  if (!authorizationResponse.ok) throw new ApiError("Your Discord session has expired. Sign in again.", 401);
  const authorization = await authorizationResponse.json().catch(() => null);
  if (String(authorization?.application?.id ?? "") !== DISCORD_CLIENT_ID) {
    throw new ApiError("This Discord session is not valid for the Appeals Center.", 401);
  }
  const userResponse = await identityFetch(`${DISCORD_API}/users/@me`, { headers }, "Discord");
  const user = await userResponse.json().catch(() => null);
  if (!userResponse.ok || typeof user?.id !== "string" || typeof user?.username !== "string") {
    throw new ApiError("Discord could not verify this account.", 502);
  }
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128`
    : "";
  return {
    platform: "discord",
    id: user.id,
    login: user.username,
    displayName: user.global_name || user.username,
    avatarUrl,
    accessToken,
  };
}

async function authenticate(platformValue: string | null, authorization: string | null): Promise<Identity> {
  const platform = String(platformValue || "twitch").toLowerCase() as Platform;
  if (!PLATFORMS.has(platform)) throw new ApiError("Choose Twitch or Discord sign-in.", 400);
  const token = bearer(authorization, platform);
  return platform === "discord" ? await discordIdentity(token) : await twitchIdentity(token);
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

async function discordGuildStaff(admin: any, userId: string) {
  const { data: configs, error } = await admin.from("discord_bot_guilds")
    .select("guild_id,owner_user_id,moderator_role_ids,administrator_role_ids")
    .eq("active", true);
  if (error) throw new ApiError(`Discord staff configuration lookup failed (${error.code || "database"}).`, 500);

  for (const config of configs ?? []) {
    try {
      const [member, roles] = await Promise.all([
        discordBot(`/guilds/${config.guild_id}/members/${userId}`),
        discordBot(`/guilds/${config.guild_id}/roles`),
      ]);
      const memberRoleIds = new Set<string>([
        String(config.guild_id),
        ...stringIds(member.roles),
      ]);
      let permissions = 0n;
      for (const role of Array.isArray(roles) ? roles : []) {
        if (memberRoleIds.has(String(role.id))) permissions |= permissionValue(role.permissions);
      }

      const configuredAdmin = stringIds(config.administrator_role_ids).some((id) => memberRoleIds.has(id));
      const configuredModerator = stringIds(config.moderator_role_ids).some((id) => memberRoleIds.has(id));
      const administrator = String(config.owner_user_id ?? "") === userId || configuredAdmin ||
        (permissions & DISCORD_ADMINISTRATOR) !== 0n;
      const moderator = configuredModerator || (permissions & DISCORD_STAFF_PERMISSIONS) !== 0n;
      if (!administrator && !moderator) continue;

      const discordUser = member.user ?? {};
      return {
        id: null,
        username: discordUser.username || userId,
        display_name: member.nick || discordUser.global_name || discordUser.username || userId,
        role: administrator ? "admin" : "staff",
        active: true,
      };
    } catch (lookupError) {
      console.warn("Discord staff permission lookup failed", config.guild_id, userId, lookupError);
    }
  }
  return null;
}

async function getStaff(admin: any, identity: Identity) {
  const link = await getLink(admin, identity);
  const candidates = [{ platform: identity.platform, id: identity.id }];
  if (link) {
    candidates.push({ platform: "twitch" as Platform, id: link.twitch_user_id });
    candidates.push({ platform: "discord" as Platform, id: link.discord_user_id });
  }
  for (const candidate of candidates) {
    const { data, error } = await admin.from("appeal_staff")
      .select("id,username,display_name,role,active")
      .eq("platform", candidate.platform).eq("platform_user_id", candidate.id).eq("active", true).maybeSingle();
    if (error) throw new ApiError(`Staff access lookup failed (${error.code || "database"}).`, 500);
    if (data) return data;
  }
  const discordId = identity.platform === "discord" ? identity.id : link?.discord_user_id;
  return discordId ? await discordGuildStaff(admin, String(discordId)) : null;
}

async function getLink(admin: any, identity: Identity) {
  const column = identity.platform === "twitch" ? "twitch_user_id" : "discord_user_id";
  const { data, error } = await admin.from("appeal_identity_links").select("*").eq(column, identity.id).maybeSingle();
  if (error) throw new ApiError(`Linked-account lookup failed (${error.code || "database"}).`, 500);
  return data;
}

function publicUser(identity: Identity) {
  return {
    platform: identity.platform,
    id: identity.id,
    login: identity.login,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
  };
}

function identitiesFrom(identity: Identity, link: any) {
  const result: Record<Platform, any> = {
    twitch: null,
    discord: null,
  };
  result[identity.platform] = publicUser(identity);
  if (link) {
    result.twitch = {
      platform: "twitch",
      id: link.twitch_user_id,
      login: link.twitch_username,
      displayName: link.twitch_display_name || link.twitch_username,
      avatarUrl: identity.platform === "twitch" ? identity.avatarUrl : "",
    };
    result.discord = {
      platform: "discord",
      id: link.discord_user_id,
      login: link.discord_username,
      displayName: link.discord_display_name || link.discord_username,
      avatarUrl: identity.platform === "discord" ? identity.avatarUrl : "",
    };
  }
  return result;
}

async function linkAccounts(admin: any, identity: Identity, request: Request) {
  const otherPlatform = String(request.headers.get("x-link-platform") || "").toLowerCase() as Platform;
  if (!PLATFORMS.has(otherPlatform) || otherPlatform === identity.platform) {
    throw new ApiError("Verify one Twitch account and one Discord account to link them.", 400);
  }
  const other = await authenticate(otherPlatform, request.headers.get("x-link-authorization"));
  const twitch = identity.platform === "twitch" ? identity : other;
  const discord = identity.platform === "discord" ? identity : other;

  const { data: conflicts, error: conflictError } = await admin
    .from("appeal_identity_links")
    .select("twitch_user_id,discord_user_id")
    .or(`twitch_user_id.eq.${twitch.id},discord_user_id.eq.${discord.id}`);
  if (conflictError) throw conflictError;
  const conflict = (conflicts ?? []).find((row: any) => row.twitch_user_id !== twitch.id || row.discord_user_id !== discord.id);
  if (conflict) throw new ApiError("One of these accounts is already linked to a different verified account.", 409);

  const { data, error } = await admin.from("appeal_identity_links").upsert({
    twitch_user_id: twitch.id,
    twitch_username: twitch.login,
    twitch_display_name: twitch.displayName,
    discord_user_id: discord.id,
    discord_username: discord.login,
    discord_display_name: discord.displayName,
    updated_at: new Date().toISOString(),
  }, { onConflict: "twitch_user_id" }).select("*").single();
  if (error) throw error;
  return json({ linked: true, identities: identitiesFrom(identity, data) });
}

function cleanEvidence(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 5).filter((item) => {
    try {
      const url = new URL(item);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch { return false; }
  });
}

function requestedCase(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/^#/, "").replace(/^TTG-MOD-/i, "");
  if (!/^\d{1,18}$/.test(normalized)) throw new ApiError("Enter a valid case number.", 400);
  return normalized;
}

function discordAppealAction(value: unknown) {
  const action = String(value || "").toLowerCase();
  if (action === "warn") return "warning";
  if (["ban", "timeout", "mute"].includes(action)) return action;
  return "other";
}

function normalizeDiscordCase(item: any, staffView = false) {
  const appealSubmitted = Boolean(item.appealed_at);
  return {
    id: item.id,
    source: "discord_moderation",
    guild_id: item.guild_id,
    subject_user_id: item.subject_user_id,
    case_number: item.case_number,
    case_code: item.case_code || `TTG-MOD-${String(item.case_number).padStart(6, "0")}`,
    platform: "discord",
    appellant_username: item.subject_username,
    appellant_display_name: item.subject_display_name,
    punishment_type: item.action,
    punishment_reference: item.case_code,
    appeal_reason: appealSubmitted ? (item.appeal_reason || "No reason was provided.") : item.reason,
    evidence: item.evidence || [],
    status: staffView && item.status === "appealed" ? "submitted" : item.status,
    staff_response: item.staff_response,
    original_reason: item.reason,
    resolution_log_message_id: item.resolution_log_message_id,
    can_appeal: item.action !== "kick" && item.action_succeeded !== false && !["reversed", "archived"].includes(item.status) && !appealSubmitted,
    appeal_submitted: appealSubmitted,
    submitted_at: item.appealed_at || item.created_at,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

async function getMyCases(admin: any, identity: Identity, body: any) {
  const link = await getLink(admin, identity);
  const ids = identitiesFrom(identity, link);
  const caseNumber = requestedCase(body.caseNumber);
  const tasks: Array<{ label: string; query: any; discord: boolean }> = [];

  if (ids.twitch) {
    let query = admin.from("appeal_cases").select(CASE_SELECT)
      .eq("identity_platform", "twitch").eq("appellant_user_id", ids.twitch.id)
      .order("submitted_at", { ascending: false }).limit(caseNumber ? 1 : 20);
    if (caseNumber) query = query.eq("case_number", caseNumber);
    tasks.push({ label: "Twitch", query, discord: false });
  }
  if (ids.discord) {
    let appealQuery = admin.from("appeal_cases").select(CASE_SELECT)
      .eq("identity_platform", "discord").eq("appellant_user_id", ids.discord.id)
      .order("submitted_at", { ascending: false }).limit(caseNumber ? 1 : 20);
    if (caseNumber) appealQuery = appealQuery.eq("case_number", caseNumber);
    tasks.push({ label: "Platform", query: appealQuery, discord: false });

    let query = admin.from("discord_moderation_cases").select(DISCORD_CASE_SELECT)
      .eq("subject_user_id", ids.discord.id).order("created_at", { ascending: false }).limit(caseNumber ? 1 : 20);
    if (caseNumber) query = query.eq("case_number", caseNumber);
    tasks.push({ label: "Discord", query, discord: true });
  }

  const results = await Promise.allSettled(tasks.map(async (task) => {
    const result = await task.query;
    if (result.error) throw new ApiError(`${task.label} cases unavailable (${result.error.code || "database"}).`, 500);
    return { task, rows: result.data ?? [] };
  }));
  const loaded = results.filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled");
  if (!loaded.length) {
    const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    throw firstFailure?.reason ?? new ApiError("Your cases could not be loaded.", 500);
  }
  const cases: any[] = [];
  for (const result of loaded) {
    for (const item of result.value.rows) cases.push(result.value.task.discord ? normalizeDiscordCase(item) : item);
  }
  cases.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
  const warnings = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : "One connected case source is unavailable.");
  return json({ cases, warnings });
}

async function createGenericCase(admin: any, target: any, infractionPlatform: string, punishmentType: string, punishmentReference: string, reason: string, evidence: string[]) {
  const [settingsResult, blocksResult, openResult, latestResult] = await Promise.all([
    admin.from("appeal_settings").select("submissions_open,cooldown_hours,max_open_cases_per_user").eq("singleton", true).maybeSingle(),
    admin.from("appeal_blocks").select("reason,expires_at").eq("platform", target.platform).eq("platform_user_id", target.id).eq("active", true),
    admin.from("appeal_cases").select("id").eq("identity_platform", target.platform).eq("appellant_user_id", target.id).in("status", OPEN_STATUSES),
    admin.from("appeal_cases").select("submitted_at").eq("identity_platform", target.platform).eq("appellant_user_id", target.id).order("submitted_at", { ascending: false }).limit(1),
  ]);
  for (const result of [settingsResult, blocksResult, openResult, latestResult]) if (result.error) throw result.error;
  const settings = settingsResult.data ?? { submissions_open: true, cooldown_hours: 24, max_open_cases_per_user: 1 };
  if (!settings.submissions_open) throw new ApiError("Appeal submissions are temporarily closed.", 403);
  const now = Date.now();
  const activeBlock = (blocksResult.data ?? []).find((item: any) => !item.expires_at || new Date(item.expires_at).getTime() > now);
  if (activeBlock) throw new ApiError(activeBlock.reason || "Appeal submissions are unavailable for this account.", 403);
  if ((openResult.data ?? []).length >= settings.max_open_cases_per_user) throw new ApiError("You already have an open appeal. Please wait for a staff response.", 409);
  const latest = latestResult.data?.[0];
  if (latest) {
    const nextAllowed = new Date(latest.submitted_at).getTime() + settings.cooldown_hours * 3600000;
    if (nextAllowed > now) {
      const hours = Math.max(1, Math.ceil((nextAllowed - now) / 3600000));
      throw new ApiError(`Please wait about ${hours} more hour${hours === 1 ? "" : "s"} before submitting again.`, 429);
    }
  }
  const { data, error } = await admin.from("appeal_cases").insert({
    platform: infractionPlatform,
    identity_platform: target.platform,
    appellant_user_id: target.id,
    appellant_username: target.login,
    appellant_display_name: target.displayName,
    punishment_type: punishmentType,
    punishment_reference: punishmentReference || null,
    appeal_reason: reason,
    evidence,
  }).select("id,case_number,status,submitted_at,platform,punishment_type").single();
  if (error) {
    if (error.code === "23505") throw new ApiError("You already have an open appeal. Please wait for a staff response.", 409);
    throw error;
  }
  let deliveryFailure: string | null = null;
  try {
    await notifyGenericAppeal(admin, data, target, reason);
  } catch (notificationError) {
    deliveryFailure = "moderation channel";
    console.error("Website appeal moderation notification failed", notificationError);
  }
  return json({ case: data, delivery_failure: deliveryFailure }, 201);
}

async function discordBot(path: string, init: RequestInit = {}) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("Discord notification service is unavailable.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bot ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${DISCORD_API}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Discord notification failed (${response.status}): ${payload?.message || "unknown error"}`);
  return payload;
}

async function appealsLogChannel(admin: any, guildId?: string) {
  let query = admin.from("discord_bot_guilds")
    .select("appeals_log_channel_id").eq("active", true).not("appeals_log_channel_id", "is", null);
  if (guildId) query = query.eq("guild_id", guildId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  const channelId = data?.[0]?.appeals_log_channel_id;
  if (!channelId) throw new Error("The Appeals Log channel has not been configured.");
  return String(channelId);
}

function finalAppealPayload(caseRow: any, source: "discord_moderation" | "appeals_center", decidedBy: string) {
  const discordCase = source === "discord_moderation";
  const caseLabel = discordCase
    ? (caseRow.case_code || `TTG-MOD-${String(caseRow.case_number).padStart(6, "0")}`)
    : `APPEAL-${String(caseRow.case_number).padStart(6, "0")}`;
  const member = discordCase
    ? `${caseRow.subject_display_name || caseRow.subject_username}\n\`${caseRow.subject_user_id}\``
    : `${caseRow.appellant_display_name || caseRow.appellant_username}\n@${caseRow.appellant_username}`;
  const platform = discordCase ? "Discord" : String(caseRow.platform || "Unknown").replaceAll("_", " / ");
  const action = discordCase ? caseRow.action : caseRow.punishment_type;
  const originalStatement = discordCase ? (caseRow.appeal_reason || caseRow.reason) : caseRow.appeal_reason;
  const response = caseRow.staff_response || "Completed without an additional staff response.";
  return {
    embeds: [{
      color: ["accepted", "reversed"].includes(caseRow.status) ? 0x72ff00 : caseRow.status === "denied" ? 0xff2f8b : 0x8b98a5,
      title: `${caseLabel} • ${String(caseRow.status).replaceAll("_", " ").toUpperCase()}`,
      description: response.slice(0, 4000),
      fields: [
        { name: "Member", value: member.slice(0, 1024), inline: true },
        { name: "Platform", value: platform.slice(0, 1024), inline: true },
        { name: "Action", value: String(action || "Other").toUpperCase().slice(0, 1024), inline: true },
        { name: "Completed by", value: decidedBy.slice(0, 1024), inline: true },
        { name: "Appeal statement", value: String(originalStatement || "No reason was provided.").slice(0, 1024), inline: false },
      ],
      footer: { text: "Toxic Command Core • final appeal record • six-month retention" },
      timestamp: caseRow.closed_at || caseRow.updated_at || new Date().toISOString(),
    }],
    allowed_mentions: { parse: [] },
  };
}

async function publishFinalAppealLog(
  admin: any,
  caseRow: any,
  source: "discord_moderation" | "appeals_center",
  decidedBy: string,
) {
  if (!FINAL_CASE_STATUSES.has(String(caseRow.status))) return caseRow;
  const channelId = await appealsLogChannel(admin, source === "discord_moderation" ? caseRow.guild_id : undefined);
  const payload = finalAppealPayload(caseRow, source, decidedBy);
  let message: any = null;
  if (caseRow.resolution_log_message_id) {
    try {
      message = await discordBot(`/channels/${channelId}/messages/${caseRow.resolution_log_message_id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("(404)")) throw error;
    }
  }
  if (!message) {
    message = await discordBot(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
  if (String(message.id) === String(caseRow.resolution_log_message_id || "")) return caseRow;
  const table = source === "discord_moderation" ? "discord_moderation_cases" : "appeal_cases";
  const select = source === "discord_moderation" ? DISCORD_CASE_SELECT : CASE_SELECT;
  const { data, error } = await admin.from(table).update({ resolution_log_message_id: message.id })
    .eq("id", caseRow.id).select(select).maybeSingle();
  if (error) throw error;
  return data || { ...caseRow, resolution_log_message_id: message.id };
}

function discordAuditReason(value: string) {
  return encodeURIComponent(value.slice(0, 512));
}

async function reverseDiscordCase(admin: any, caseRow: any, actor: { id: string; name: string; type: string }) {
  const action = String(caseRow.action || "").toLowerCase();
  if (!["warn", "mute", "ban"].includes(action)) {
    return { caseRow, reversal: { attempted: false, success: null, action, message: "This action cannot be automatically reversed." } };
  }

  let failure: string | null = null;
  try {
    const headers = { "X-Audit-Log-Reason": discordAuditReason(`${caseRow.case_code} appeal accepted by ${actor.name}`) };
    if (action === "mute") {
      await discordBot(`/guilds/${caseRow.guild_id}/members/${caseRow.subject_user_id}`, {
        method: "PATCH", headers, body: JSON.stringify({ communication_disabled_until: null }),
      });
    } else if (action === "ban") {
      await discordBot(`/guilds/${caseRow.guild_id}/bans/${caseRow.subject_user_id}`, { method: "DELETE", headers });
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : "Discord reversal failed.";
  }

  const timestamp = new Date().toISOString();
  const { error: eventError } = await admin.from("discord_moderation_events").insert({
    case_id: caseRow.id,
    event_type: failure ? "reversal_failed" : "reversal_succeeded",
    actor_type: actor.type,
    actor_user_id: actor.id,
    actor_name: actor.name,
    visibility: "staff",
    message: failure
      ? `Automatic ${action} reversal failed: ${failure}`
      : `Original ${action} was reversed after the appeal was accepted.`,
    metadata: { action, source: "staff_review_website", automatic: true, error: failure },
  });
  if (eventError) console.error("Discord reversal event could not be recorded", eventError);

  if (failure) {
    return { caseRow, reversal: { attempted: true, success: false, action, message: failure } };
  }

  const { data, error } = await admin.from("discord_moderation_cases").update({
    status: "reversed", reversed_at: timestamp, reversed_by_user_id: actor.id, closed_at: timestamp,
  }).eq("id", caseRow.id).select(DISCORD_CASE_SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("Case not found after reversal.", 404);
  return {
    caseRow: data,
    reversal: { attempted: true, success: true, action, message: `The original ${action} was reversed.` },
  };
}

async function moderationChannel(admin: any) {
  const { data, error } = await admin.from("discord_bot_guilds")
    .select("moderation_channel_id").eq("active", true).not("moderation_channel_id", "is", null).limit(1).maybeSingle();
  if (error) throw error;
  if (!data?.moderation_channel_id) throw new Error("Moderation channel is not configured.");
  return data.moderation_channel_id;
}

async function notifyGenericAppeal(admin: any, caseRow: any, target: any, reason: string) {
  const channelId = await moderationChannel(admin);
  const statement = reason || "No reason was provided. Staff should request additional information.";
  await discordBot(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: `🌐 **New website appeal — Case #${caseRow.case_number}**`,
      embeds: [{
        color: 0x72ff00,
        title: `${String(caseRow.platform).toUpperCase()} • ${String(caseRow.punishment_type).toUpperCase()}`,
        description: statement.slice(0, 4000),
        fields: [
          { name: "Member", value: `${target.displayName || target.login}\n\`${target.id}\``, inline: true },
          { name: "Identity verified with", value: String(target.platform || "unknown"), inline: true },
          { name: "Submitted through", value: "Appeals Center", inline: true },
        ],
        footer: { text: "Protected appeal record • six-month retention" },
        timestamp: new Date().toISOString(),
      }],
      allowed_mentions: { parse: [] },
    }),
  });
}

async function notifyDiscordAppeal(admin: any, caseRow: any, identity: any, reason: string) {
  const { data: config, error: configError } = await admin.from("discord_bot_guilds")
    .select("moderation_channel_id,appeals_channel_id").eq("guild_id", caseRow.guild_id).eq("active", true).maybeSingle();
  if (configError) throw configError;
  const reviewChannelId = config?.moderation_channel_id ?? config?.appeals_channel_id;
  if (!reviewChannelId) throw new Error("Moderation channel is not configured.");
  const statement = reason || "No reason was provided. Staff should request additional information.";
  let threadId = caseRow.appeal_thread_id;
  let messageId = caseRow.appeal_message_id;
  if (!threadId) {
    const message = await discordBot(`/channels/${reviewChannelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: `New website appeal for **${caseRow.case_code}**.`,
        embeds: [{
          color: 0x72ff00,
          title: `${caseRow.case_code} • ${String(caseRow.action).toUpperCase()}`,
          description: statement,
          fields: [
            { name: "Member", value: `${caseRow.subject_display_name || caseRow.subject_username}\n\`${caseRow.subject_user_id}\``, inline: true },
            { name: "Platform", value: "Discord", inline: true },
            { name: "Submitted through", value: "Appeals Center", inline: true },
          ],
          footer: { text: "Protected appeal record • six-month retention" },
          timestamp: new Date().toISOString(),
        }],
        allowed_mentions: { parse: [] },
      }),
    });
    const thread = await discordBot(`/channels/${reviewChannelId}/messages/${message.id}/threads`, {
      method: "POST",
      body: JSON.stringify({ name: `${caseRow.case_code} • ${caseRow.subject_username}`.slice(0, 100), auto_archive_duration: 10080 }),
    });
    messageId = message.id;
    threadId = thread.id;
    await admin.from("discord_moderation_cases").update({ appeal_message_id: messageId, appeal_thread_id: threadId }).eq("id", caseRow.id);
  }
  await discordBot(`/channels/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: `🌐 **Website appeal — ${identity.displayName}**\n${statement}\n\nStaff reply with \`/t appealreply\` inside this thread.`,
      allowed_mentions: { parse: [] },
    }),
  });
  return { messageId, threadId };
}

async function createDiscordAppeal(admin: any, target: any, body: any, punishmentType: string, reason: string, evidence: string[]) {
  const caseNumber = requestedCase(body.punishmentReference);
  if (!caseNumber) throw new ApiError("Enter the TTG-MOD case number from your Discord moderation notice.", 400);
  const { data: caseRow, error } = await admin.from("discord_moderation_cases").select("*")
    .eq("case_number", caseNumber).eq("subject_user_id", target.id).maybeSingle();
  if (error) throw error;
  if (!caseRow) throw new ApiError("That Discord case was not found for this verified account.", 404);
  if (caseRow.action === "kick") throw new ApiError("Kicks do not require an appeal. Rejoin the Discord server to return.", 409);
  const caseAction = discordAppealAction(caseRow.action);
  if (punishmentType !== caseAction) {
    throw new ApiError(`The selected action does not match ${caseRow.case_code}. Choose its ${caseAction} action or select a different ticket.`, 409);
  }
  if (caseRow.action_succeeded === false || ["reversed", "archived"].includes(caseRow.status)) {
    throw new ApiError("That Discord case is not eligible for a new appeal.", 409);
  }
  if (caseRow.appealed_at) throw new ApiError("An appeal has already been submitted for that Discord case.", 409);
  const now = new Date().toISOString();
  const combinedEvidence = [...(Array.isArray(caseRow.evidence) ? caseRow.evidence : []), ...evidence.map((url) => ({ filename: "Website evidence", url }))];
  const { data: updated, error: updateError } = await admin.from("discord_moderation_cases").update({
    status: "appealed",
    appeal_reason: reason,
    appealed_at: now,
    evidence: combinedEvidence,
  }).eq("id", caseRow.id).select("*").single();
  if (updateError) throw updateError;
  const { error: eventError } = await admin.from("discord_moderation_events").insert({
    case_id: caseRow.id,
    event_type: "member_message",
    actor_type: "member",
    actor_user_id: target.id,
    actor_name: target.displayName || target.login,
    visibility: "member",
    message: reason || "No reason was provided.",
    metadata: { source: "appeals_center", evidence },
  });
  if (eventError) throw eventError;
  let deliveryFailure: string | null = null;
  try {
    await notifyDiscordAppeal(admin, updated, target, reason);
  } catch (notificationError) {
    deliveryFailure = "moderation channel or appeal thread";
    console.error("Discord appeal notification failure", notificationError);
  }
  return json({ case: normalizeDiscordCase(updated), delivery_failure: deliveryFailure }, 201);
}

async function createCase(admin: any, identity: Identity, body: any) {
  const platform = String(body.platform || "").toLowerCase();
  if (!INFRACTION_PLATFORMS.has(platform)) throw new ApiError("Choose the platform where the moderation action happened.", 400);
  const punishmentType = typeof body.punishmentType === "string" ? body.punishmentType : "";
  const punishmentReference = typeof body.punishmentReference === "string" ? body.punishmentReference.trim().slice(0, 250) : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const evidence = cleanEvidence(body.evidence);
  if (!PUNISHMENTS.has(punishmentType)) throw new ApiError("Choose the moderation action you are appealing.", 400);
  if (reason.length > 5000) throw new ApiError("Your appeal cannot exceed 5,000 characters.", 400);
  const link = await getLink(admin, identity);
  const identities = identitiesFrom(identity, link);
  if (platform === "discord") {
    if (!identities.discord) throw new ApiError("Verify and link your Discord account before appealing a Discord case.", 403);
    return await createDiscordAppeal(admin, identities.discord, body, punishmentType, reason, evidence);
  }
  if (platform === "twitch") {
    if (!identities.twitch) throw new ApiError("Verify and link your Twitch account before appealing a Twitch action.", 403);
    return await createGenericCase(admin, identities.twitch, platform, punishmentType, punishmentReference, reason, evidence);
  }
  const target = identities[identity.platform];
  return await createGenericCase(admin, target, platform, punishmentType, punishmentReference, reason, evidence);
}

async function getStaffCases(admin: any, identity: Identity, body: any) {
  const staff = await getStaff(admin, identity);
  if (!staff) throw new ApiError("This account does not have staff access.", 403);
  const status = typeof body.status === "string" ? body.status : "all";
  const source = ["all", "platform", "discord"].includes(body.source) ? body.source : "all";
  if (status !== "all" && !STAFF_CASE_FILTERS.has(status)) throw new ApiError("Choose a valid case status.", 400);
  const cases: any[] = [];
  const loads: Promise<{ rows: any[] }>[] = [];
  if (source !== "discord") {
    let websiteQuery = admin.from("appeal_cases").select(CASE_SELECT).order("submitted_at", { ascending: false }).limit(100);
    if (status !== "all") websiteQuery = websiteQuery.eq("status", status);
    loads.push((async () => {
      const result = await websiteQuery;
      if (result.error) throw new ApiError(`Platform queue unavailable (${result.error.code || "database"}).`, 500);
      return { rows: result.data ?? [] };
    })());
  }
  if (source !== "platform") {
    loads.push((async () => {
      const result = await admin.from("discord_moderation_cases").select("*")
        .order("appealed_at", { ascending: false }).limit(200);
      if (result.error) throw new ApiError(`Discord queue unavailable (${result.error.code || "database"}).`, 500);
      return { rows: (result.data ?? [])
        // Authorized staff need the complete moderation history, including
        // active cases that have not yet received an appeal.
        .map((item: any) => normalizeDiscordCase(item, true))
        .filter((item: any) => status === "all" || item.status === status) };
    })());
  }
  const results = await Promise.allSettled(loads);
  const loaded = results.filter((result): result is PromiseFulfilledResult<{ rows: any[] }> => result.status === "fulfilled");
  if (!loaded.length) {
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    throw failure?.reason ?? new ApiError("The review queue could not be loaded.", 500);
  }
  for (const result of loaded) cases.push(...result.value.rows);
  const warnings = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : "One case queue is unavailable.");
  cases.sort((a: any, b: any) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
  const missingFinalLogs = cases.filter((item: any) =>
    FINAL_CASE_STATUSES.has(String(item.status)) && !item.resolution_log_message_id
  );
  if (missingFinalLogs.length) {
    const repairs = await Promise.allSettled(missingFinalLogs.map((item: any) =>
      publishFinalAppealLog(
        admin,
        item,
        item.source === "discord_moderation" ? "discord_moderation" : "appeals_center",
        "Appeals Center automatic recovery",
      )
    ));
    const failedRepairs = repairs.filter((result) => result.status === "rejected");
    if (failedRepairs.length) {
      warnings.push(`${failedRepairs.length} completed case log${failedRepairs.length === 1 ? "" : "s"} could not be repaired automatically.`);
      for (const failure of failedRepairs) {
        if (failure.status === "rejected") console.error("Final appeal log recovery failed", failure.reason);
      }
    }
  }
  return json({ cases, staff, warnings });
}

async function updateCase(admin: any, identity: Identity, body: any) {
  const staff = await getStaff(admin, identity);
  if (!staff) throw new ApiError("Staff access required.", 403);
  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new ApiError("Case not found.", 404);
  const status = typeof body.status === "string" ? body.status : "";
  const staffResponse = typeof body.response === "string" ? body.response.trim().slice(0, 5000) : "";
  if (!CASE_STATUSES.has(status)) throw new ApiError("Choose a valid case status.", 400);
  if (["accepted", "denied", "needs_information"].includes(status) && staffResponse.length < 3) throw new ApiError("Add a response before sending this status.", 400);
  const timestamp = new Date().toISOString();
  const source = body.source === "discord_moderation" ? "discord_moderation" : "appeals_center";
  if (source === "discord_moderation") {
    const actorType = staff.role === "owner" ? "owner" : staff.role === "admin" ? "administrator" : "moderator";
    const { data: existing, error: existingError } = await admin.from("discord_moderation_cases")
      .select(DISCORD_CASE_SELECT).eq("id", id).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) throw new ApiError("Case not found.", 404);
    const reversible = ["warn", "mute", "ban"].includes(String(existing.action).toLowerCase());
    const shouldReverse = status === "accepted" && reversible && existing.status !== "reversed";
    const effectiveStatus = status === "accepted" && existing.status === "reversed"
      ? "reversed"
      : shouldReverse ? "accepted_pending_reversal" : status;
    const update: Record<string, unknown> = { status: effectiveStatus, staff_response: staffResponse || null };
    if (["accepted", "denied", "closed", "archived"].includes(effectiveStatus)) update.closed_at = timestamp;
    const { data: updated, error } = await admin.from("discord_moderation_cases").update(update)
      .eq("id", id).select(DISCORD_CASE_SELECT).maybeSingle();
    if (error) throw error;
    if (!updated) throw new ApiError("Case not found.", 404);
    const link = await getLink(admin, identity);
    const actorId = identity.platform === "discord" ? identity.id : link?.discord_user_id || identity.id;
    const actorName = staff.display_name || staff.username || identity.login;
    const { error: eventError } = await admin.from("discord_moderation_events").insert({
      case_id: id, event_type: staffResponse ? "staff_reply" : "status_change", actor_type: actorType,
      actor_user_id: actorId, actor_name: actorName,
      visibility: staffResponse ? "member" : "staff", message: staffResponse || `Status changed to ${effectiveStatus}.`,
      metadata: { status: effectiveStatus, requested_status: status, source: "staff_review_website" },
    });
    if (eventError) throw eventError;
    let data = updated;
    let reversal = { attempted: false, success: null as boolean | null, action: String(updated.action), message: "" };
    if (shouldReverse) {
      const result = await reverseDiscordCase(admin, updated, { id: actorId, name: actorName, type: actorType });
      data = result.caseRow;
      reversal = result.reversal;
    } else if (status === "accepted" && !reversible) {
      reversal = { attempted: false, success: null, action: String(updated.action), message: "Kicks cannot be reversed; the appeal was accepted and closed." };
    }
    const publishedStatus = data.status;
    const reversalLine = reversal.success ? `\n**Reversal:** Original ${reversal.action} reversed automatically.` : "";
    const notificationFailures: string[] = [];
    try {
      const { data: config, error: configError } = await admin.from("discord_bot_guilds")
        .select("moderation_channel_id").eq("guild_id", data.guild_id).eq("active", true).maybeSingle();
      if (configError) throw configError;
      if (config?.moderation_channel_id) {
        await discordBot(`/channels/${config.moderation_channel_id}/messages`, {
          method: "POST",
          body: JSON.stringify({
            content: `🛡️ **Appeal update — ${data.case_code}**\n**Member:** ${data.subject_display_name || data.subject_username}\n**Status:** ${publishedStatus.replaceAll("_", " ")}${reversalLine}${staffResponse ? `\n\n${staffResponse.slice(0, 1600)}` : ""}`,
            allowed_mentions: { parse: [] },
          }),
        });
      }
    } catch (notificationError) {
      notificationFailures.push("moderation channel");
      console.error("Discord moderation channel notification failed", notificationError);
    }
    try {
      if (data.appeal_thread_id) {
        await discordBot(`/channels/${data.appeal_thread_id}/messages`, {
          method: "POST",
          body: JSON.stringify({
            content: `🛡️ **Staff update by ${actorName}**\n**Status:** ${publishedStatus.replaceAll("_", " ")}${reversalLine}${staffResponse ? `\n\n${staffResponse.slice(0, 1750)}` : ""}`,
            allowed_mentions: { parse: [] },
          }),
        });
      }
    } catch (notificationError) {
      notificationFailures.push("appeal thread");
      console.error("Discord appeal thread notification failed", notificationError);
    }
    try {
      if (staffResponse) {
        const dm = await discordBot("/users/@me/channels", {
          method: "POST", body: JSON.stringify({ recipient_id: data.subject_user_id }),
        });
        await discordBot(`/channels/${dm.id}/messages`, {
          method: "POST",
          body: JSON.stringify({
            content: `🛡️ **Appeal update — ${data.case_code}**\n**Status:** ${publishedStatus.replaceAll("_", " ")}${reversalLine}\n\n${staffResponse.slice(0, 1750)}`,
            allowed_mentions: { parse: [] },
          }),
        });
      }
    } catch (notificationError) {
      notificationFailures.push("member DM");
      console.error("Discord member DM notification failed", notificationError);
    }
    if (FINAL_CASE_STATUSES.has(String(data.status))) {
      try {
        data = await publishFinalAppealLog(admin, data, "discord_moderation", actorName);
      } catch (notificationError) {
        notificationFailures.push("appeals log");
        console.error("Discord final appeal log failed", notificationError);
      }
    }
    if (notificationFailures.length) console.error("Discord update delivery incomplete", notificationFailures);
    return json({ case: normalizeDiscordCase(data, true), delivery_failures: notificationFailures, reversal });
  }

  const update: Record<string, unknown> = { status, staff_response: staffResponse || null };
  if (staff.id) update.assigned_staff_id = staff.id;
  if (["under_review", "needs_information"].includes(status)) update.reviewed_at = timestamp;
  if (["accepted", "denied"].includes(status)) update.decided_at = timestamp;
  if (status === "closed") update.closed_at = timestamp;
  if (status === "archived") update.archived_at = timestamp;
  const { data, error } = await admin.from("appeal_cases").update(update).eq("id", id).select(CASE_SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("Case not found.", 404);
  if (staffResponse) {
    const { error: eventError } = await admin.from("appeal_case_events").insert({
      case_id: id, event_type: "staff_response", actor_type: "staff", actor_user_id: identity.id,
      actor_name: staff.display_name || staff.username || identity.login, visibility: "public",
      message: staffResponse, metadata: { status, staff_id: staff.id },
    });
    if (eventError) throw eventError;
  }
  const notificationFailures: string[] = [];
  let finalData = data;
  if (FINAL_CASE_STATUSES.has(String(data.status))) {
    try {
      finalData = await publishFinalAppealLog(
        admin,
        data,
        "appeals_center",
        staff.display_name || staff.username || identity.login,
      );
    } catch (notificationError) {
      notificationFailures.push("appeals log");
      console.error("Website final appeal log failed", notificationError);
    }
  }
  return json({ case: finalData, delivery_failures: notificationFailures });
}

async function deleteCase(admin: any, identity: Identity, body: any) {
  const staff = await getStaff(admin, identity);
  if (!staff || staff.role !== "owner") throw new ApiError("Owner access required to permanently delete a case.", 403);
  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new ApiError("Case not found.", 404);
  const source = body.source === "discord_moderation" ? "discord_moderation_cases" : "appeal_cases";
  const { data, error } = await admin.from(source).delete().eq("id", id).select("id,case_number").maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("Case not found.", 404);
  return json({ case: data });
}

export default {
  async fetch(request: Request) {
    const origin = request.headers.get("origin");
    if (origin && origin !== ALLOWED_ORIGIN) return Response.json({ error: "Origin not allowed." }, { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    try {
      validateProjectKey(request);
      let body: any;
      try { body = await request.json(); } catch { throw new ApiError("The request could not be read.", 400); }
      const admin = adminClient();
      if (body?.action === "health") return await healthCheck(admin);
      const identity = await authenticate(request.headers.get("x-appeals-platform"), request.headers.get("authorization"));
      switch (body?.action) {
        case "me": {
          const [staff, link] = await Promise.all([getStaff(admin, identity), getLink(admin, identity)]);
          return json({ user: publicUser(identity), staff, identities: identitiesFrom(identity, link) });
        }
        case "link_accounts": return await linkAccounts(admin, identity, request);
        case "get_my_cases": return await getMyCases(admin, identity, body);
        case "create_case": return await createCase(admin, identity, body);
        case "get_staff_cases": return await getStaffCases(admin, identity, body);
        case "update_case": return await updateCase(admin, identity, body);
        case "delete_case": return await deleteCase(admin, identity, body);
        default: throw new ApiError("Unknown Appeals action.", 400);
      }
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      console.error("appeals-api failure", error);
      const code = typeof (error as any)?.code === "string" ? (error as any).code : "INTERNAL";
      return json({ error: `The Appeals service could not complete this request (${code}).` }, 500);
    }
  },
};
