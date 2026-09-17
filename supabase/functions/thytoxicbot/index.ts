import nacl from "tweetnacl";
import { APPLICATION_ID, APPEALS_CHANNEL_ID, DURATION_SECONDS, T_COMMAND } from "./commands.ts";
import { APPEAL_URL, STAFF_GUIDE_MESSAGES } from "./guide.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

type Json = Record<string, unknown>;
type AnyRecord = Record<string, any>;

const DISCORD_API = "https://discord.com/api/v10";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY") ?? "";
const LEGACY_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";

const PERMISSIONS = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_GUILD: 1n << 5n,
  MANAGE_MESSAGES: 1n << 13n,
  MODERATE_MEMBERS: 1n << 40n,
};

function adminKey(): string {
  if (SECRET_KEYS) {
    try {
      return JSON.parse(SECRET_KEYS).default ?? LEGACY_SERVICE_KEY;
    } catch {
      return LEGACY_SERVICE_KEY;
    }
  }
  return LEGACY_SERVICE_KEY;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function hexBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return new Uint8Array();
  return new Uint8Array(value.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)));
}

function verifyDiscordRequest(req: Request, rawBody: string): boolean {
  const signature = req.headers.get("x-signature-ed25519") ?? "";
  const timestamp = req.headers.get("x-signature-timestamp") ?? "";
  if (!PUBLIC_KEY || !signature || !timestamp) return false;
  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(timestamp + rawBody),
      hexBytes(signature),
      hexBytes(PUBLIC_KEY),
    );
  } catch {
    return false;
  }
}

function dbHeaders(extra: HeadersInit = {}): Headers {
  const key = adminKey();
  const headers = new Headers(extra);
  headers.set("apikey", key);
  if (key.startsWith("eyJ")) headers.set("authorization", `Bearer ${key}`);
  headers.set("content-type", "application/json");
  return headers;
}

async function dbRequest(path: string, init: RequestInit = {}): Promise<any> {
  if (!SUPABASE_URL || !adminKey()) throw new Error("Supabase server credentials are unavailable.");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: dbHeaders(init.headers),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Database ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : null;
}

async function dbSelect(table: string, params: Record<string, string>): Promise<any[]> {
  const search = new URLSearchParams(params);
  return await dbRequest(`${table}?${search.toString()}`, { method: "GET" });
}

async function dbInsert(table: string, body: Json): Promise<any> {
  const rows = await dbRequest(table, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  return rows?.[0] ?? null;
}

async function dbUpsert(table: string, body: Json, conflict: string): Promise<any> {
  const rows = await dbRequest(`${table}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(body),
  });
  return rows?.[0] ?? null;
}

async function dbUpdate(table: string, filter: string, body: Json): Promise<any> {
  const rows = await dbRequest(`${table}?${filter}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  return rows?.[0] ?? null;
}

async function dbDelete(table: string, filter: string): Promise<void> {
  await dbRequest(`${table}?${filter}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
}

class DiscordError extends Error {
  status: number;
  code?: number;
  constructor(status: number, message: string, code?: number) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function discord(path: string, init: RequestInit = {}, retry = true): Promise<any> {
  if (!BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN has not been configured.");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bot ${BOT_TOKEN}`);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${DISCORD_API}${path}`, { ...init, headers });
  const text = await response.text();
  let payload: AnyRecord | null = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text ? { message: text } : null;
  }
  if (response.status === 429 && retry) {
    const waitMs = Math.min(Number(payload?.retry_after ?? 1) * 1000, 2500);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return await discord(path, init, false);
  }
  if (!response.ok) {
    throw new DiscordError(response.status, String(payload?.message ?? `Discord request failed (${response.status})`), payload?.code);
  }
  return payload;
}

function auditReason(caseCode: string, reason: string): string {
  return encodeURIComponent(`${caseCode}: ${reason}`.slice(0, 500));
}

async function discordAction(path: string, method: string, body: unknown, caseCode: string, reason: string): Promise<any> {
  return await discord(path, {
    method,
    headers: { "x-audit-log-reason": auditReason(caseCode, reason) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function safeMessage(error: unknown): string {
  if (error instanceof DiscordError) {
    if (error.status === 403) return "Discord denied the action. Check the bot role position and permissions.";
    if (error.status === 404) return "Discord could not find that member, case resource, or channel.";
    return `Discord error ${error.status}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "Unknown error";
}

function appUser(interaction: AnyRecord): AnyRecord {
  return interaction.member?.user ?? interaction.user ?? {};
}

function displayName(user: AnyRecord, member?: AnyRecord): string {
  return member?.nick ?? user.global_name ?? user.username ?? user.id ?? "Unknown user";
}

function optionMap(interaction: AnyRecord): { subcommand: string; values: Record<string, any> } {
  const sub = interaction.data?.options?.[0] ?? {};
  const values: Record<string, any> = {};
  for (const option of sub.options ?? []) values[option.name] = option.value;
  return { subcommand: sub.name ?? "", values };
}

function interactionPermissions(interaction: AnyRecord): bigint {
  try {
    return BigInt(interaction.member?.permissions ?? "0");
  } catch {
    return 0n;
  }
}

function hasPermission(interaction: AnyRecord, permission: bigint): boolean {
  const actual = interactionPermissions(interaction);
  return (actual & PERMISSIONS.ADMINISTRATOR) !== 0n || (actual & permission) !== 0n;
}

function hasConfiguredRole(interaction: AnyRecord, ids: unknown): boolean {
  if (!Array.isArray(ids)) return false;
  const roles = new Set(interaction.member?.roles ?? []);
  return ids.some((id) => roles.has(String(id)));
}

function isOwner(interaction: AnyRecord, config: AnyRecord): boolean {
  return Boolean(config?.owner_user_id && appUser(interaction).id === config.owner_user_id);
}

function isAdministrator(interaction: AnyRecord, config: AnyRecord): boolean {
  return isOwner(interaction, config) || hasPermission(interaction, PERMISSIONS.ADMINISTRATOR) ||
    hasConfiguredRole(interaction, config?.administrator_role_ids);
}

function isStaff(interaction: AnyRecord, config: AnyRecord): boolean {
  const perms = interactionPermissions(interaction);
  const staffBits = PERMISSIONS.MODERATE_MEMBERS | PERMISSIONS.KICK_MEMBERS | PERMISSIONS.BAN_MEMBERS |
    PERMISSIONS.MANAGE_MESSAGES | PERMISSIONS.MANAGE_GUILD;
  return isAdministrator(interaction, config) || (perms & staffBits) !== 0n ||
    hasConfiguredRole(interaction, config?.moderator_role_ids);
}

function ephemeral(content: string): Json {
  return { content, flags: 64, allowed_mentions: { parse: [] } };
}

async function editOriginal(interaction: AnyRecord, data: Json): Promise<void> {
  await fetch(`${DISCORD_API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...data }),
  });
}

async function runDeferred(interaction: AnyRecord, task: () => Promise<Json | string>): Promise<void> {
  try {
    const result = await task();
    await editOriginal(interaction, typeof result === "string" ? { content: result } : result);
  } catch (error) {
    console.error("interaction task failed", safeMessage(error));
    await editOriginal(interaction, ephemeral(`I couldn't complete that action: ${safeMessage(error)}`));
  }
}

async function guildConfig(guildId: string): Promise<AnyRecord | null> {
  const rows = await dbSelect("discord_bot_guilds", {
    select: "*",
    guild_id: `eq.${guildId}`,
    active: "eq.true",
    limit: "1",
  });
  return rows[0] ?? null;
}

async function insertEvent(caseId: string, data: Json): Promise<void> {
  await dbInsert("discord_moderation_events", { case_id: caseId, ...data });
}

async function publishGuide(config: AnyRecord): Promise<string> {
  const channelId = config.appeals_channel_id;
  const existingIds = Array.isArray(config.staff_guide_message_ids)
    ? config.staff_guide_message_ids.map(String)
    : config.staff_guide_message_id ? [String(config.staff_guide_message_id)] : [];
  const messageIds: string[] = [];

  for (let index = 0; index < STAFF_GUIDE_MESSAGES.length; index += 1) {
    const payload = STAFF_GUIDE_MESSAGES[index];
    const existingId = existingIds[index];
    let message: AnyRecord | null = null;
    if (existingId) {
      try {
        message = await discord(`/channels/${channelId}/messages/${existingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (!(error instanceof DiscordError) || error.status !== 404) throw error;
      }
    }
    if (!message) {
      message = await discord(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    messageIds.push(String(message.id));
    try {
      await discord(`/channels/${channelId}/pins/${message.id}`, { method: "PUT" });
    } catch (error) {
      console.warn("guide pin skipped", safeMessage(error));
    }
  }

  await dbUpdate("discord_bot_guilds", `guild_id=eq.${encodeURIComponent(config.guild_id)}`, {
    staff_guide_message_id: messageIds[0],
    staff_guide_message_ids: messageIds,
  });
  return messageIds[0];
}

async function bootstrap(): Promise<void> {
  if (!BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is missing.");
  const channel = await discord(`/channels/${APPEALS_CHANNEL_ID}`);
  if (!channel.guild_id) throw new Error("The configured appeals channel is not a guild channel.");
  const application = await discord("/oauth2/applications/@me");
  const ownerId = application.team?.owner_user_id ?? application.owner?.id ?? null;
  const existing = (await dbSelect("discord_bot_guilds", {
    select: "*",
    guild_id: `eq.${channel.guild_id}`,
    limit: "1",
  }))[0];
  const config = await dbUpsert("discord_bot_guilds", {
    guild_id: channel.guild_id,
    application_id: APPLICATION_ID,
    appeals_channel_id: APPEALS_CHANNEL_ID,
    log_channel_id: existing?.log_channel_id ?? APPEALS_CHANNEL_ID,
    owner_user_id: existing?.owner_user_id ?? ownerId,
    moderator_role_ids: existing?.moderator_role_ids ?? [],
    administrator_role_ids: existing?.administrator_role_ids ?? [],
    staff_guide_message_id: existing?.staff_guide_message_id ?? null,
    retention_months: existing?.retention_months ?? 6,
    active: true,
  }, "guild_id");
  await discord(`/applications/${APPLICATION_ID}/guilds/${channel.guild_id}/commands`, {
    method: "PUT",
    body: JSON.stringify([T_COMMAND]),
  });
  await publishGuide(config);
  console.log("ThyToxicBot bootstrap complete for guild", channel.guild_id);
}

function resolvedUser(interaction: AnyRecord, userId: string): { user: AnyRecord; member: AnyRecord } {
  const user = interaction.data?.resolved?.users?.[userId] ?? { id: userId, username: userId };
  const member = interaction.data?.resolved?.members?.[userId] ?? {};
  return { user, member };
}

function evidenceFrom(interaction: AnyRecord, attachmentId?: string): AnyRecord[] {
  if (!attachmentId) return [];
  const item = interaction.data?.resolved?.attachments?.[attachmentId];
  if (!item) return [];
  return [{
    source: "discord",
    attachment_id: item.id,
    filename: item.filename,
    content_type: item.content_type ?? null,
    size: item.size ?? null,
    url: item.url,
    proxy_url: item.proxy_url ?? null,
  }];
}

async function openDm(userId: string): Promise<string> {
  const channel = await discord("/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: userId }),
  });
  return channel.id;
}

function caseButton(caseId: string): AnyRecord[] {
  return [{
    type: 1,
    components: [
      { type: 2, style: 1, label: "Reply to Staff", custom_id: `appeal_reply:${caseId}` },
      { type: 2, style: 5, label: "Open Appeals Center", url: APPEAL_URL },
    ],
  }];
}

async function sendCaseNotice(caseRow: AnyRecord, dmChannelId: string, extra?: string): Promise<void> {
  const isBan = caseRow.action === "ban";
  const appealLine = isBan
    ? `You can appeal this ban at ${APPEAL_URL}`
    : `You can appeal this action at ${APPEAL_URL}`;
  await discord(`/channels/${dmChannelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: `${extra ? `${extra}\n\n` : ""}${appealLine}`,
      allowed_mentions: { parse: [] },
      embeds: [{
        color: 0x72ff00,
        title: `${caseRow.case_code} • ${String(caseRow.action).toUpperCase()}`,
        description: caseRow.reason,
        fields: [
          { name: "Status", value: caseRow.status === "failed" ? "Action failed" : "Recorded", inline: true },
          { name: "Case number", value: caseRow.case_code, inline: true },
        ],
        footer: { text: "Use Reply to Staff to keep communication in the protected case record." },
      }],
      components: caseButton(caseRow.id),
    }),
  });
}

async function sendStaffReply(caseRow: AnyRecord, message: string): Promise<void> {
  const dmId = caseRow.dm_channel_id ?? await openDm(caseRow.subject_user_id);
  await discord(`/channels/${dmId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: `**Staff response for ${caseRow.case_code}**\n${message}`,
      allowed_mentions: { parse: [] },
      components: caseButton(caseRow.id),
    }),
  });
  if (!caseRow.dm_channel_id) {
    await dbUpdate("discord_moderation_cases", `id=eq.${caseRow.id}`, { dm_channel_id: dmId });
  }
}

function logEmbed(caseRow: AnyRecord): AnyRecord {
  const evidence = Array.isArray(caseRow.evidence) && caseRow.evidence.length
    ? caseRow.evidence.map((item: AnyRecord) => `[${item.filename ?? "Evidence"}](${item.url})`).join("\n").slice(0, 1000)
    : "None attached";
  return {
    color: caseRow.action_succeeded === false ? 0xff335f : 0x72ff00,
    title: `${caseRow.case_code} • ${String(caseRow.action).toUpperCase()}`,
    description: caseRow.reason,
    fields: [
      { name: "Member", value: `${caseRow.subject_display_name ?? caseRow.subject_username}\n\`${caseRow.subject_user_id}\``, inline: true },
      { name: "Moderator", value: `${caseRow.moderator_username}\n\`${caseRow.moderator_user_id}\``, inline: true },
      { name: "Status", value: String(caseRow.status).replaceAll("_", " "), inline: true },
      { name: "DM delivery", value: String(caseRow.dm_delivery_status).replaceAll("_", " "), inline: true },
      { name: "Evidence", value: evidence, inline: false },
    ],
    footer: { text: "Toxic Command Core • six-month retention" },
    timestamp: caseRow.created_at,
  };
}

async function postCaseLog(config: AnyRecord, caseRow: AnyRecord): Promise<void> {
  const channelId = config.log_channel_id ?? config.appeals_channel_id;
  const message = await discord(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ embeds: [logEmbed(caseRow)], allowed_mentions: { parse: [] } }),
  });
  let threadId: string | null = null;
  try {
    const thread = await discord(`/channels/${channelId}/messages/${message.id}/threads`, {
      method: "POST",
      body: JSON.stringify({
        name: `${caseRow.case_code} • ${caseRow.subject_username}`.slice(0, 100),
        auto_archive_duration: 10080,
      }),
    });
    threadId = thread.id;
    await discord(`/channels/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: `Protected appeal conversation for **${caseRow.case_code}**. Staff reply here with \`/t appealreply\`.`,
        allowed_mentions: { parse: [] },
      }),
    });
  } catch (error) {
    console.warn("case thread creation skipped", safeMessage(error));
  }
  await dbUpdate("discord_moderation_cases", `id=eq.${caseRow.id}`, {
    log_message_id: message.id,
    appeal_thread_id: threadId,
  });
}

async function postCaseConversation(config: AnyRecord, caseRow: AnyRecord, content: string): Promise<void> {
  const channelId = caseRow.appeal_thread_id ?? config.log_channel_id ?? config.appeals_channel_id;
  await discord(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
}

async function createModerationCase(interaction: AnyRecord, config: AnyRecord, action: string, values: Record<string, any>): Promise<Json> {
  const requiredPermission = action === "ban" ? PERMISSIONS.BAN_MEMBERS
    : action === "kick" ? PERMISSIONS.KICK_MEMBERS
    : PERMISSIONS.MODERATE_MEMBERS;
  if (!isStaff(interaction, config) || !hasPermission(interaction, requiredPermission)) {
    return ephemeral("You do not have the Discord permission required for that action.");
  }
  const targetId = String(values.user);
  const { user, member } = resolvedUser(interaction, targetId);
  if (targetId === appUser(interaction).id) return ephemeral("You cannot apply a moderation action to yourself.");
  const moderator = appUser(interaction);
  const durationSeconds = action === "mute" ? DURATION_SECONDS[String(values.duration)] : null;
  const evidence = evidenceFrom(interaction, values.evidence);
  let dmChannelId: string | null = null;
  let dmOpenError: string | null = null;
  try {
    dmChannelId = await openDm(targetId);
  } catch (error) {
    dmOpenError = safeMessage(error);
  }
  let caseRow = await dbInsert("discord_moderation_cases", {
    guild_id: interaction.guild_id,
    subject_user_id: targetId,
    subject_username: user.username ?? targetId,
    subject_display_name: displayName(user, member),
    moderator_user_id: moderator.id,
    moderator_username: displayName(moderator, interaction.member),
    action,
    status: "pending",
    reason: String(values.reason),
    evidence,
    duration_seconds: durationSeconds,
    delete_message_seconds: action === "ban" ? Number(values.delete_history ?? 0) : null,
    dm_channel_id: dmChannelId,
    dm_error: dmOpenError,
  });
  await insertEvent(caseRow.id, {
    event_type: "case_created",
    actor_type: isOwner(interaction, config) ? "owner" : isAdministrator(interaction, config) ? "administrator" : "moderator",
    actor_user_id: moderator.id,
    actor_name: displayName(moderator, interaction.member),
    visibility: "staff",
    message: `${action} case created.`,
  });
  let actionError: string | null = null;
  try {
    if (action === "mute") {
      const until = new Date(Date.now() + Number(durationSeconds) * 1000).toISOString();
      await discordAction(`/guilds/${interaction.guild_id}/members/${targetId}`, "PATCH", { communication_disabled_until: until }, caseRow.case_code, values.reason);
    } else if (action === "kick") {
      await discordAction(`/guilds/${interaction.guild_id}/members/${targetId}`, "DELETE", undefined, caseRow.case_code, values.reason);
    } else if (action === "ban") {
      await discordAction(`/guilds/${interaction.guild_id}/bans/${targetId}`, "PUT", { delete_message_seconds: Number(values.delete_history ?? 0) }, caseRow.case_code, values.reason);
    }
  } catch (error) {
    actionError = safeMessage(error);
  }
  caseRow = await dbUpdate("discord_moderation_cases", `id=eq.${caseRow.id}`, {
    status: actionError ? "failed" : "active",
    action_succeeded: !actionError,
    action_error: actionError,
  });
  await insertEvent(caseRow.id, {
    event_type: actionError ? "action_failed" : "action_succeeded",
    actor_type: "bot",
    visibility: "staff",
    message: actionError ?? `${action} completed successfully.`,
  });
  let dmError = dmOpenError;
  if (dmChannelId) {
    try {
      await sendCaseNotice(caseRow, dmChannelId);
      dmError = null;
    } catch (error) {
      dmError = safeMessage(error);
    }
  }
  caseRow = await dbUpdate("discord_moderation_cases", `id=eq.${caseRow.id}`, {
    dm_delivery_status: dmError ? "failed" : "delivered",
    dm_error: dmError,
  });
  await insertEvent(caseRow.id, {
    event_type: dmError ? "dm_failed" : "dm_delivered",
    actor_type: "bot",
    visibility: "staff",
    message: dmError ?? "Private moderation notice delivered.",
  });
  try {
    await postCaseLog(config, caseRow);
  } catch (error) {
    console.error("case log failed", safeMessage(error));
  }
  if (actionError) return ephemeral(`**${caseRow.case_code}** was recorded, but the Discord action failed. ${actionError}`);
  return ephemeral(`**${caseRow.case_code}** completed. Member DM: **${caseRow.dm_delivery_status.replaceAll("_", " ")}**.`);
}

function normalizeCaseCode(value: string): string {
  const raw = value.trim().toUpperCase();
  if (/^TTG-MOD-\d{1,12}$/.test(raw)) {
    const number = raw.split("-").at(-1)!;
    return `TTG-MOD-${number.padStart(6, "0")}`;
  }
  if (/^\d{1,12}$/.test(raw)) return `TTG-MOD-${raw.padStart(6, "0")}`;
  return raw;
}

async function findCase(guildId: string, caseCode: string): Promise<AnyRecord | null> {
  const rows = await dbSelect("discord_moderation_cases", {
    select: "*",
    guild_id: `eq.${guildId}`,
    case_code: `eq.${normalizeCaseCode(caseCode)}`,
    limit: "1",
  });
  return rows[0] ?? null;
}

async function reverseAction(interaction: AnyRecord, config: AnyRecord, command: string, values: Record<string, any>): Promise<Json> {
  const action = command.replace(/^un/, "");
  const requiredPermission = action === "ban" ? PERMISSIONS.BAN_MEMBERS : PERMISSIONS.MODERATE_MEMBERS;
  if (!isAdministrator(interaction, config) || !hasPermission(interaction, requiredPermission)) {
    return ephemeral("Only an authorized administrator with the required Discord permission can reverse this action.");
  }
  const caseRow = await findCase(interaction.guild_id, String(values.case_number));
  if (!caseRow) return ephemeral("That case was not found.");
  if (caseRow.action !== action) return ephemeral(`That case is a **${caseRow.action}** case, not a ${action} case.`);
  const targetId = command === "unban" ? String(values.user_id) : String(values.user);
  if (targetId !== caseRow.subject_user_id) return ephemeral("The selected user does not match the original case.");
  let errorMessage: string | null = null;
  try {
    if (command === "unmute") {
      await discordAction(`/guilds/${interaction.guild_id}/members/${targetId}`, "PATCH", { communication_disabled_until: null }, caseRow.case_code, values.reason);
    } else if (command === "unban") {
      await discordAction(`/guilds/${interaction.guild_id}/bans/${targetId}`, "DELETE", undefined, caseRow.case_code, values.reason);
    }
  } catch (error) {
    errorMessage = safeMessage(error);
  }
  const actor = appUser(interaction);
  await insertEvent(caseRow.id, {
    event_type: errorMessage ? "reversal_failed" : "reversal_succeeded",
    actor_type: isOwner(interaction, config) ? "owner" : "administrator",
    actor_user_id: actor.id,
    actor_name: displayName(actor, interaction.member),
    visibility: "staff",
    message: errorMessage ?? `Reversed: ${values.reason}`,
    metadata: { evidence: evidenceFrom(interaction, values.evidence) },
  });
  if (errorMessage) return ephemeral(`Reversal failed: ${errorMessage}`);
  const updated = await dbUpdate("discord_moderation_cases", `id=eq.${caseRow.id}`, {
    status: "reversed",
    reversed_at: new Date().toISOString(),
    reversed_by_user_id: actor.id,
  });
  try {
    await sendStaffReply(updated, `The ${action} recorded in ${caseRow.case_code} was reversed.\nReason: ${values.reason}`);
  } catch (error) {
    console.warn("reversal DM failed", safeMessage(error));
  }
  await postCaseConversation(config, updated, `↩️ **Action reversed by ${displayName(actor, interaction.member)}**\n${values.reason}`);
  return ephemeral(`**${caseRow.case_code}** has been reversed and recorded.`);
}

function cleanSearch(value: string): string {
  return value.replace(/[(),.*%]/g, "").trim().slice(0, 80);
}

async function searchCases(guildId: string, query: string, userId?: string, status?: string, limit = 10): Promise<AnyRecord[]> {
  const params: Record<string, string> = {
    select: "id,case_code,subject_user_id,subject_username,subject_display_name,action,status,created_at,appeal_thread_id,reason,dm_delivery_status,moderator_username",
    guild_id: `eq.${guildId}`,
    order: "created_at.desc,id.desc",
    limit: String(limit),
  };
  if (userId) params.subject_user_id = `eq.${userId}`;
  if (status) params.status = `eq.${status}`;
  const cleaned = cleanSearch(query);
  if (cleaned) {
    const code = normalizeCaseCode(cleaned);
    params.or = `(case_code.eq.${code},subject_user_id.eq.${cleaned},subject_username.ilike.*${cleaned}*,subject_display_name.ilike.*${cleaned}*)`;
  }
  return await dbSelect("discord_moderation_cases", params);
}

async function casesCommand(interaction: AnyRecord, config: AnyRecord, values: Record<string, any>): Promise<Json> {
  if (!isStaff(interaction, config)) return ephemeral("This command is restricted to authorized staff.");
  const rows = await searchCases(interaction.guild_id, String(values.query ?? ""), values.user ? String(values.user) : undefined, values.status, 10);
  if (!rows.length) return ephemeral("No cases matched that search.");
  const lines = rows.map((row) => {
    const thread = row.appeal_thread_id ? ` · <#${row.appeal_thread_id}>` : "";
    return `**${row.case_code}** · ${row.subject_display_name ?? row.subject_username} · ${row.action} · ${row.status.replaceAll("_", " ")}${thread}`;
  });
  return ephemeral(lines.join("\n").slice(0, 1900));
}

async function caseInfoCommand(interaction: AnyRecord, config: AnyRecord, values: Record<string, any>): Promise<Json> {
  if (!isStaff(interaction, config)) return ephemeral("This command is restricted to authorized staff.");
  const row = await findCase(interaction.guild_id, String(values.case_number));
  if (!row) return ephemeral("That case was not found.");
  const events = await dbSelect("discord_moderation_events", {
    select: "event_type,actor_name,message,created_at",
    case_id: `eq.${row.id}`,
    order: "created_at.desc,id.desc",
    limit: "5",
  });
  const history = events.map((event) => `• ${event.event_type.replaceAll("_", " ")}${event.actor_name ? ` — ${event.actor_name}` : ""}`).join("\n") || "No events";
  const content = [
    `**${row.case_code} · ${row.action.toUpperCase()} · ${row.status.replaceAll("_", " ")}**`,
    `Member: **${row.subject_display_name ?? row.subject_username}** (\`${row.subject_user_id}\`)`,
    `Moderator: **${row.moderator_username}**`,
    `DM: **${row.dm_delivery_status.replaceAll("_", " ")}**`,
    `Reason: ${row.reason}`,
    row.action_error ? `Action error: ${row.action_error}` : "",
    row.appeal_thread_id ? `Thread: <#${row.appeal_thread_id}>` : "",
    `\nRecent history:\n${history}`,
  ].filter(Boolean).join("\n");
  return ephemeral(content.slice(0, 1950));
}

async function appealReplyCommand(interaction: AnyRecord, config: AnyRecord, values: Record<string, any>): Promise<Json> {
  if (!isStaff(interaction, config)) return ephemeral("This command is restricted to authorized staff.");
  let row: AnyRecord | null = null;
  if (values.case_number) row = await findCase(interaction.guild_id, String(values.case_number));
  if (!row) {
    const rows = await dbSelect("discord_moderation_cases", {
      select: "*",
      guild_id: `eq.${interaction.guild_id}`,
      appeal_thread_id: `eq.${interaction.channel_id}`,
      limit: "1",
    });
    row = rows[0] ?? null;
  }
  if (!row) return ephemeral("I could not identify the case. Run this inside its thread or provide the case number.");
  const actor = appUser(interaction);
  await sendStaffReply(row, String(values.message));
  await insertEvent(row.id, {
    event_type: "staff_reply",
    actor_type: isOwner(interaction, config) ? "owner" : isAdministrator(interaction, config) ? "administrator" : "moderator",
    actor_user_id: actor.id,
    actor_name: displayName(actor, interaction.member),
    visibility: "member",
    message: String(values.message),
  });
  await postCaseConversation(config, row, `🛡️ **Staff reply — ${displayName(actor, interaction.member)}**\n${values.message}`);
  return ephemeral(`Reply delivered and recorded in **${row.case_code}**.`);
}

async function staffNoteCommand(interaction: AnyRecord, config: AnyRecord, values: Record<string, any>): Promise<Json> {
  if (!isStaff(interaction, config)) return ephemeral("This command is restricted to authorized staff.");
  const { user, member } = resolvedUser(interaction, String(values.user));
  const actor = appUser(interaction);
  await dbInsert("discord_staff_notes", {
    guild_id: interaction.guild_id,
    subject_user_id: String(values.user),
    subject_username: displayName(user, member),
    staff_user_id: actor.id,
    staff_username: displayName(actor, interaction.member),
    note: String(values.note),
  });
  return ephemeral(`Private note saved for **${displayName(user, member)}**.`);
}

async function notesCommand(interaction: AnyRecord, config: AnyRecord, values: Record<string, any>): Promise<Json> {
  if (!isStaff(interaction, config)) return ephemeral("This command is restricted to authorized staff.");
  const rows = await dbSelect("discord_staff_notes", {
    select: "note,staff_username,created_at",
    guild_id: `eq.${interaction.guild_id}`,
    subject_user_id: `eq.${values.user}`,
    order: "created_at.desc,id.desc",
    limit: "10",
  });
  if (!rows.length) return ephemeral("No staff notes were found for that member.");
  return ephemeral(rows.map((row) => `• **${row.staff_username}** · <t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:d>\n${row.note}`).join("\n\n").slice(0, 1950));
}

async function caseUpdateCommand(interaction: AnyRecord, config: AnyRecord, values: Record<string, any>): Promise<Json> {
  if (!isAdministrator(interaction, config)) return ephemeral("Only an authorized administrator can correct a case.");
  const row = await findCase(interaction.guild_id, String(values.case_number));
  if (!row) return ephemeral("That case was not found.");
  const oldReason = row.reason;
  const evidence = [...(Array.isArray(row.evidence) ? row.evidence : []), ...evidenceFrom(interaction, values.evidence)];
  const updated = await dbUpdate("discord_moderation_cases", `id=eq.${row.id}`, { reason: String(values.reason), evidence });
  const actor = appUser(interaction);
  await insertEvent(row.id, {
    event_type: "reason_updated",
    actor_type: isOwner(interaction, config) ? "owner" : "administrator",
    actor_user_id: actor.id,
    actor_name: displayName(actor, interaction.member),
    visibility: "staff",
    message: String(values.reason),
    metadata: { previous_reason: oldReason },
  });
  await postCaseConversation(config, updated, `✏️ **Case reason corrected by ${displayName(actor, interaction.member)}**\n${values.reason}`);
  return ephemeral(`**${row.case_code}** was updated and the correction was recorded.`);
}

async function caseCloseCommand(interaction: AnyRecord, config: AnyRecord, values: Record<string, any>): Promise<Json> {
  if (!isAdministrator(interaction, config)) return ephemeral("Only an authorized administrator can decide or close a case.");
  const row = await findCase(interaction.guild_id, String(values.case_number));
  if (!row) return ephemeral("That case was not found.");
  let status = String(values.outcome);
  if (status === "accepted" && ["warn", "mute", "ban"].includes(row.action) && row.status !== "reversed") {
    status = "accepted_pending_reversal";
  }
  const now = new Date().toISOString();
  const updated = await dbUpdate("discord_moderation_cases", `id=eq.${row.id}`, {
    status,
    closed_at: ["accepted", "denied", "closed"].includes(status) ? now : null,
  });
  const actor = appUser(interaction);
  await insertEvent(row.id, {
    event_type: status === "closed" ? "closed" : "status_changed",
    actor_type: isOwner(interaction, config) ? "owner" : "administrator",
    actor_user_id: actor.id,
    actor_name: displayName(actor, interaction.member),
    visibility: "member",
    message: String(values.response),
    metadata: { previous_status: row.status, status },
  });
  let dmResult = "delivered";
  try {
    await sendStaffReply(updated, String(values.response));
  } catch (error) {
    dmResult = `failed: ${safeMessage(error)}`;
  }
  await postCaseConversation(config, updated, `✅ **Decision — ${status.replaceAll("_", " ")}**\n${values.response}`);
  const reversalNote = status === "accepted_pending_reversal"
    ? ` Use the matching \`/t un${row.action}\` command to complete the reversal.`
    : "";
  return ephemeral(`**${row.case_code}** is now **${status.replaceAll("_", " ")}**. Member DM ${dmResult}.${reversalNote}`);
}

async function deleteCaseCommand(interaction: AnyRecord, config: AnyRecord, values: Record<string, any>): Promise<Json> {
  if (!isOwner(interaction, config)) return ephemeral("Permanent case deletion is restricted to the application owner.");
  const code = normalizeCaseCode(String(values.case_number));
  if (String(values.confirmation).trim().toUpperCase() !== `DELETE ${code}`) {
    return ephemeral(`Confirmation did not match. Type exactly: \`DELETE ${code}\``);
  }
  const row = await findCase(interaction.guild_id, code);
  if (!row) return ephemeral("That case was not found.");
  await dbDelete("discord_moderation_cases", `id=eq.${row.id}`);
  return ephemeral(`**${code}** and its event history were permanently deleted.`);
}

async function guideCommand(interaction: AnyRecord, config: AnyRecord): Promise<Json> {
  if (!isAdministrator(interaction, config)) return ephemeral("Only an authorized administrator can refresh the staff guide.");
  await publishGuide(config);
  return ephemeral("The Appeals & Moderation Review staff message is updated and pinned.");
}

async function handleCommand(interaction: AnyRecord): Promise<Json> {
  if (!interaction.guild_id) return ephemeral("Moderation commands must be used inside the server.");
  const config = await guildConfig(interaction.guild_id);
  if (!config) return ephemeral("ThyToxicBot is not configured for this server yet.");
  const { subcommand, values } = optionMap(interaction);
  if (["warn", "mute", "kick", "ban"].includes(subcommand)) return await createModerationCase(interaction, config, subcommand, values);
  if (["unwarn", "unmute", "unban"].includes(subcommand)) return await reverseAction(interaction, config, subcommand, values);
  if (subcommand === "cases") return await casesCommand(interaction, config, values);
  if (subcommand === "caseinfo") return await caseInfoCommand(interaction, config, values);
  if (subcommand === "appealreply") return await appealReplyCommand(interaction, config, values);
  if (subcommand === "staffnote") return await staffNoteCommand(interaction, config, values);
  if (subcommand === "notes") return await notesCommand(interaction, config, values);
  if (subcommand === "caseupdate") return await caseUpdateCommand(interaction, config, values);
  if (subcommand === "caseclose") return await caseCloseCommand(interaction, config, values);
  if (subcommand === "casedelete") return await deleteCaseCommand(interaction, config, values);
  if (subcommand === "guide") return await guideCommand(interaction, config);
  return ephemeral("Unknown ThyToxicBot command.");
}

function modalText(interaction: AnyRecord): string {
  for (const row of interaction.data?.components ?? []) {
    for (const component of row.components ?? []) {
      if (component.custom_id === "appeal_message") return String(component.value ?? "").trim();
    }
  }
  return "";
}

async function memberReply(interaction: AnyRecord, caseId: string): Promise<Json> {
  const rows = await dbSelect("discord_moderation_cases", { select: "*", id: `eq.${caseId}`, limit: "1" });
  const row = rows[0];
  if (!row) return ephemeral("That case is no longer available.");
  const user = appUser(interaction);
  if (user.id !== row.subject_user_id) return ephemeral("Only the person named in this case can reply.");
  const message = modalText(interaction);
  if (!message) return ephemeral("Your reply was empty.");
  const config = await guildConfig(row.guild_id);
  if (!config) return ephemeral("This case is temporarily unavailable.");
  await insertEvent(row.id, {
    event_type: "member_message",
    actor_type: "member",
    actor_user_id: user.id,
    actor_name: displayName(user),
    visibility: "member",
    message,
  });
  const update: Json = { status: "appealed" };
  if (!row.appealed_at) update.appealed_at = new Date().toISOString();
  const updated = await dbUpdate("discord_moderation_cases", `id=eq.${row.id}`, update);
  await postCaseConversation(config, updated, `💬 **Member reply — ${displayName(user)}**\n${message}`);
  return ephemeral(`Your message was delivered to staff and recorded in **${row.case_code}**.`);
}

async function autocomplete(interaction: AnyRecord): Promise<Response> {
  const guildId = interaction.guild_id;
  if (!guildId) return json({ type: 8, data: { choices: [] } });
  const config = await guildConfig(guildId);
  if (!config || !isStaff(interaction, config)) return json({ type: 8, data: { choices: [] } });
  const sub = interaction.data?.options?.[0] ?? {};
  const focused = (sub.options ?? []).find((option: AnyRecord) => option.focused);
  const query = String(focused?.value ?? "");
  const rows = await searchCases(guildId, query, undefined, undefined, 20);
  return json({
    type: 8,
    data: {
      choices: rows.map((row) => ({
        name: `${row.case_code} • ${row.subject_display_name ?? row.subject_username} • ${row.action}`.slice(0, 100),
        value: row.case_code,
      })).slice(0, 25),
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    return json({ ok: true, service: "ThyToxicBot", configured: Boolean(BOT_TOKEN && PUBLIC_KEY) });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const rawBody = await req.text();
  if (!verifyDiscordRequest(req, rawBody)) return json({ error: "Invalid Discord signature" }, 401);
  let interaction: AnyRecord;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (String(interaction.application_id ?? APPLICATION_ID) !== APPLICATION_ID) {
    return json({ error: "Wrong Discord application" }, 401);
  }
  if (interaction.type === 1) {
    EdgeRuntime.waitUntil(bootstrap().catch((error) => console.error("bootstrap failed", safeMessage(error))));
    return json({ type: 1 });
  }
  if (interaction.type === 4) return await autocomplete(interaction);
  if (interaction.type === 3 && String(interaction.data?.custom_id ?? "").startsWith("appeal_reply:")) {
    const caseId = String(interaction.data.custom_id).split(":")[1];
    const rows = await dbSelect("discord_moderation_cases", { select: "id,case_code,subject_user_id", id: `eq.${caseId}`, limit: "1" });
    const row = rows[0];
    if (!row || appUser(interaction).id !== row.subject_user_id) return json({ type: 4, data: ephemeral("Only the person named in this case can reply.") });
    return json({
      type: 9,
      data: {
        custom_id: `appeal_reply_modal:${caseId}`,
        title: `Reply • ${row.case_code}`.slice(0, 45),
        components: [{
          type: 1,
          components: [{
            type: 4,
            custom_id: "appeal_message",
            label: "Message to staff",
            style: 2,
            min_length: 1,
            max_length: 1800,
            required: true,
            placeholder: "Explain what staff should know…",
          }],
        }],
      },
    });
  }
  if (interaction.type === 5 && String(interaction.data?.custom_id ?? "").startsWith("appeal_reply_modal:")) {
    const caseId = String(interaction.data.custom_id).split(":")[1];
    EdgeRuntime.waitUntil(runDeferred(interaction, () => memberReply(interaction, caseId)));
    return json({ type: 5, data: { flags: 64 } });
  }
  if (interaction.type === 2 && interaction.data?.name === "t") {
    EdgeRuntime.waitUntil(runDeferred(interaction, () => handleCommand(interaction)));
    return json({ type: 5, data: { flags: 64 } });
  }
  return json({ type: 4, data: ephemeral("Unsupported interaction.") });
});
