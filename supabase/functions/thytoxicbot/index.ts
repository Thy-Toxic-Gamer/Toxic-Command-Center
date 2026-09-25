import nacl from "tweetnacl";
import { APPLICATION_ID, APPEALS_CHANNEL_ID, DURATION_SECONDS, POLLS_CHANNEL_ID, POLLS_URL, T_COMMAND } from "./commands.ts";
import { COMMUNITY_INFO_CLEANUP_TITLES, COMMUNITY_INFO_MESSAGES } from "./community-info.ts";
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
const ADMIN_SECRET = Deno.env.get("LIVE_STATUS_SECRET") ?? "";
const OFFICIAL_LINKS_CHANNEL_ID = "1536919005099728898";
const OFFICIAL_LINKS_TITLE = "Official ThyToxicGamer Links";
const BOT_INFO_CHANNEL_ID = "1536918882143576166";
const BOT_INFO_TITLES = ["YouTube Bot", "UB3R-B0T", "Dyno"] as const;

const PERMISSIONS = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_GUILD: 1n << 5n,
  MANAGE_MESSAGES: 1n << 13n,
  MODERATE_MEMBERS: 1n << 40n,
};

type TicketType = "general" | "report" | "staff" | "suggestion";

const TICKET_LABELS: Record<TicketType, string> = {
  general: "General Support",
  report: "Report a User",
  staff: "Staff Inquiry",
  suggestion: "Suggestion",
};

const TICKET_COLORS: Record<TicketType, number> = {
  general: 0xb5ff18,
  report: 0xff3b93,
  staff: 0x48e69b,
  suggestion: 0x7d8cff,
};

const CHANNEL_ALLOW = (1n << 6n) | (1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 15n) | (1n << 16n);
const STAFF_CHANNEL_ALLOW = CHANNEL_ALLOW | (1n << 13n);

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

function officialLinksPayload(): AnyRecord {
  return {
    embeds: [{
      title: OFFICIAL_LINKS_TITLE,
      description: "Everything official for **ThyToxicGamer — The Toxic One**.",
      color: 0x72ff00,
      fields: [
        {
          name: "Watch Live",
          value: "[Twitch](https://www.twitch.tv/thytoxicgamer) • [YouTube](https://www.youtube.com/@ThyToxicGamer) • [Kick](https://kick.com/thytoxicgamer)",
          inline: false,
        },
        {
          name: "Community & Socials",
          value: "[Discord](https://discord.gg/SSwDcXHq57) • [X / Twitter](https://x.com/ThyToxicGamer) • [Instagram](https://www.instagram.com/thytoxicgamer/)",
          inline: false,
        },
        {
          name: "Toxic Command Center",
          value: "[Central Command](https://thy-toxic-gamer.github.io/Toxic-Command-Center/) • [Game Requests](https://thy-toxic-gamer.github.io/Toxic-Command-Center/games/) • [Poll Center](https://thy-toxic-gamer.github.io/Toxic-Command-Center/polls/)\n[Ticket Center](https://thy-toxic-gamer.github.io/Toxic-Command-Center/tickets/) • [Appeals Center](https://thy-toxic-gamer.github.io/Toxic-Command-Center/appeals-center/) • [Support Center](https://thy-toxic-gamer.github.io/Toxic-Command-Center/support/)",
          inline: false,
        },
      ],
      footer: { text: "ThyToxicBot • Official links only" },
      timestamp: new Date().toISOString(),
    }],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 5, label: "Twitch", url: "https://www.twitch.tv/thytoxicgamer" },
          { type: 2, style: 5, label: "YouTube", url: "https://www.youtube.com/@ThyToxicGamer" },
          { type: 2, style: 5, label: "Kick", url: "https://kick.com/thytoxicgamer" },
          { type: 2, style: 5, label: "Discord", url: "https://discord.gg/SSwDcXHq57" },
        ],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 5, label: "X / Twitter", url: "https://x.com/ThyToxicGamer" },
          { type: 2, style: 5, label: "Instagram", url: "https://www.instagram.com/thytoxicgamer/" },
          { type: 2, style: 5, label: "Command Center", url: "https://thy-toxic-gamer.github.io/Toxic-Command-Center/" },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

async function publishOfficialLinks(): Promise<AnyRecord> {
  const payload = officialLinksPayload();
  let existing: AnyRecord | undefined;
  try {
    const messages = await discord(`/channels/${OFFICIAL_LINKS_CHANNEL_ID}/messages?limit=100`);
    existing = Array.isArray(messages)
      ? messages.find((message: AnyRecord) =>
        String(message.author?.id ?? "") === APPLICATION_ID &&
        (message.embeds ?? []).some((embed: AnyRecord) => String(embed.title ?? "") === OFFICIAL_LINKS_TITLE)
      )
      : undefined;
  } catch (error) {
    if (!(error instanceof DiscordError) || error.status !== 403) throw error;
    console.warn("official links history unavailable", safeMessage(error));
  }

  const operation = existing ? "updated" : "created";
  const message = existing
    ? await discord(`/channels/${OFFICIAL_LINKS_CHANNEL_ID}/messages/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
    : await discord(`/channels/${OFFICIAL_LINKS_CHANNEL_ID}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

  const verified = await discord(`/channels/${OFFICIAL_LINKS_CHANNEL_ID}/messages/${message.id}`);
  const verifiedTitle = String(verified?.embeds?.[0]?.title ?? "");
  if (verifiedTitle !== OFFICIAL_LINKS_TITLE) throw new Error("Discord returned the message, but the official links embed could not be verified.");
  return { operation, channel_id: OFFICIAL_LINKS_CHANNEL_ID, message_id: String(message.id), verified: true };
}


function botInformationPayloads(): AnyRecord[] {
  const footer = { text: "ThyToxicBot • Bot information" };
  return [
    {
      embeds: [{
        title: "YouTube Bot",
        description: "The dedicated YouTube notification bot for **ThyToxicGamer**. It keeps the server informed when new YouTube content is published.",
        color: 0xff0000,
        fields: [
          {
            name: "Purpose",
            value: "Posts notifications from the **ThyToxicGamer YouTube channel** into the server so members can quickly open new videos and livestream pages.",
            inline: false,
          },
          {
            name: "What It Handles",
            value: "• YouTube uploads and stream-page notifications\n• Direct links back to the YouTube content\n• Custom notification text and channel routing",
            inline: false,
          },
          {
            name: "Management Commands",
            value: "`/notify add` — add or configure a YouTube feed\n`/notify list` — review configured feeds\n`/notify reset` — remove/reset a feed",
            inline: false,
          },
          {
            name: "Server Configuration",
            value: "Channel being followed: **@ThyToxicGamer**\nDestination: the dedicated **YouTube notifications channel**.",
            inline: false,
          },
          {
            name: "Staff Notes",
            value: "Only authorized staff should change the feed. YouTube may publish a scheduled stream page before the broadcast actually begins, so a notice can appear before the exact go-live moment.",
            inline: false,
          },
          {
            name: "Official Links",
            value: "[Bot page](https://top.gg/bot/456633518882160642) • [ThyToxicGamer on YouTube](https://www.youtube.com/@ThyToxicGamer)",
            inline: false,
          },
        ],
        footer,
      }],
      components: [{
        type: 1,
        components: [
          { type: 2, style: 5, label: "Open Bot Page", url: "https://top.gg/bot/456633518882160642" },
          { type: 2, style: 5, label: "Open YouTube", url: "https://www.youtube.com/@ThyToxicGamer" },
        ],
      }],
      allowed_mentions: { parse: [] },
    },
    {
      embeds: [{
        title: "UB3R-B0T",
        description: "The dedicated Twitch notification bot for **ThyToxicGamer**. Its main job in this server is announcing Twitch streams.",
        color: 0x9146ff,
        fields: [
          {
            name: "Purpose",
            value: "Watches the **thytoxicgamer** Twitch account and sends a notification to the selected Discord channel when a Twitch stream is detected.",
            inline: false,
          },
          {
            name: "What It Handles",
            value: "• Twitch go-live notifications\n• Stream title and Twitch link\n• Optional role mention and custom announcement text\n• Other feed types are available, but are not its assigned job here",
            inline: false,
          },
          {
            name: "Server Configuration",
            value: "Twitch account: **thytoxicgamer**\nDestination: **🟣・twitch**\nDefault bot prefix: `.`",
            inline: false,
          },
          {
            name: "Management",
            value: "Feed settings are managed from the UB3R-B0T dashboard. Staff can change the destination, extra announcement text, and feed options without touching the website or Streamer.bot.",
            inline: false,
          },
          {
            name: "Staff Notes",
            value: "Keep unrelated greeting, farewell, censor, and novelty-response features disabled unless they are intentionally added later. This prevents overlap with the server's other bots.",
            inline: false,
          },
          {
            name: "Official Links",
            value: "[Dashboard](https://admin.ub3r-b0t.com/) • [Website](https://ub3r-b0t.com/) • [Notification documentation](https://ub3r-b0t.com/docs/articles/notifications.html)",
            inline: false,
          },
        ],
        footer,
      }],
      components: [{
        type: 1,
        components: [
          { type: 2, style: 5, label: "Open Dashboard", url: "https://admin.ub3r-b0t.com/" },
          { type: 2, style: 5, label: "Open Documentation", url: "https://ub3r-b0t.com/docs/articles/notifications.html" },
        ],
      }],
      allowed_mentions: { parse: [] },
    },
    {
      embeds: [{
        title: "Dyno",
        description: "The server's dedicated moderation and AutoMod bot. Dyno helps staff control spam and rule-breaking while keeping moderation separate from stream notifications.",
        color: 0x5865f2,
        fields: [
          {
            name: "Purpose",
            value: "Provides Discord moderation, automated rule enforcement, and staff logs. It supports the moderation team; it does not replace ThyToxicBot's custom systems.",
            inline: false,
          },
          {
            name: "What It Handles",
            value: "• AutoMod and anti-spam protection\n• Moderator actions such as warnings, mutes, kicks, and bans\n• Action logs for staff review\n• Additional safety modules enabled by server administrators",
            inline: false,
          },
          {
            name: "Role in This Setup",
            value: "Dyno is for **Discord moderation**. YouTube notifications stay with YouTube Bot, Twitch notifications stay with UB3R-B0T, and stream-chat commands stay with Nightbot/StreamElements.",
            inline: false,
          },
          {
            name: "Permissions & Role Order",
            value: "Dyno's role must stay below Owner/Admin/Staff roles and above the regular member roles it needs to moderate. Only grant the permissions required by the enabled modules.",
            inline: false,
          },
          {
            name: "Staff Notes",
            value: "Configure modules from the Dyno dashboard. Avoid enabling duplicate welcome messages, stream notifications, or public commands that are already handled elsewhere.",
            inline: false,
          },
          {
            name: "Official Links",
            value: "[Dashboard](https://dyno.gg/account) • [Bot information](https://dyno.gg/bot)",
            inline: false,
          },
        ],
        footer,
      }],
      components: [{
        type: 1,
        components: [
          { type: 2, style: 5, label: "Open Dashboard", url: "https://dyno.gg/account" },
          { type: 2, style: 5, label: "Open Bot Page", url: "https://dyno.gg/bot" },
        ],
      }],
      allowed_mentions: { parse: [] },
    },
  ];
}

async function publishBotInformation(): Promise<AnyRecord> {
  const payloads = botInformationPayloads();
  let messages: AnyRecord[] = [];
  try {
    const history = await discord(`/channels/${BOT_INFO_CHANNEL_ID}/messages?limit=100`);
    messages = Array.isArray(history) ? history : [];
  } catch (error) {
    if (!(error instanceof DiscordError) || error.status !== 403) throw error;
    console.warn("bot information history unavailable", safeMessage(error));
  }

  const results: AnyRecord[] = [];
  for (let index = 0; index < payloads.length; index++) {
    const payload = payloads[index];
    const title = BOT_INFO_TITLES[index];
    const existing = messages.find((message: AnyRecord) =>
      String(message.author?.id ?? "") === APPLICATION_ID &&
      (message.embeds ?? []).some((embed: AnyRecord) => String(embed.title ?? "") === title)
    );
    const operation = existing ? "updated" : "created";
    const message = existing
      ? await discord(`/channels/${BOT_INFO_CHANNEL_ID}/messages/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })
      : await discord(`/channels/${BOT_INFO_CHANNEL_ID}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    const verified = await discord(`/channels/${BOT_INFO_CHANNEL_ID}/messages/${message.id}`);
    const verifiedTitle = String(verified?.embeds?.[0]?.title ?? "");
    if (verifiedTitle !== title) throw new Error(`Discord returned the message, but the ${title} embed could not be verified.`);
    results.push({ title, operation, message_id: String(message.id), verified: true });
  }
  return { channel_id: BOT_INFO_CHANNEL_ID, messages: results };
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

async function ticketConfig(guildId: string): Promise<AnyRecord | null> {
  const rows = await dbSelect("discord_ticket_config", {
    select: "*",
    guild_id: `eq.${guildId}`,
    active: "eq.true",
    limit: "1",
  });
  return rows[0] ?? null;
}

function ticketTypeFromCustomId(customId: string): TicketType | null {
  const value = customId.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (["ticket_general", "ticket_general_support", "general_support", "general", "support"].includes(value)) return "general";
  if (["ticket_report", "ticket_report_user", "report_user", "report_a_user", "report"].includes(value)) return "report";
  if (["ticket_staff", "ticket_staff_inquiry", "ticket_staff_inquiries", "staff_inquiry", "staff_inquiries", "staff"].includes(value)) return "staff";
  if (["ticket_suggestion", "ticket_suggestions", "suggestion", "suggestions"].includes(value)) return "suggestion";
  if (!value.includes("ticket")) return null;
  if (value.includes("report")) return "report";
  if (value.includes("staff")) return "staff";
  if (value.includes("suggest")) return "suggestion";
  if (value.includes("general") || value.includes("support")) return "general";
  return null;
}

function ticketCategory(config: AnyRecord, type: TicketType): string {
  return String(config[`${type}_category_id`] ?? "");
}

function channelSlug(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "member";
}

async function insertTicketEvent(ticketId: string, eventType: string, actor: AnyRecord | null, details: Json = {}): Promise<void> {
  await dbInsert("discord_ticket_events", {
    ticket_id: ticketId,
    event_type: eventType,
    actor_user_id: actor?.id ?? null,
    actor_name: actor ? displayName(actor) : null,
    details,
  });
}

function ticketStatusEmbed(ticket: AnyRecord, state: "open" | "closed", transcriptCount = 0): AnyRecord {
  const label = TICKET_LABELS[ticket.ticket_type as TicketType] ?? "Ticket";
  const fields: AnyRecord[] = [
    { name: "Member", value: `${ticket.requester_display_name ?? ticket.requester_username}\n\`${ticket.requester_user_id}\``, inline: true },
    { name: "Type", value: label, inline: true },
    { name: "Status", value: state === "open" ? "Open" : "Closed and archived", inline: true },
  ];
  if (ticket.assigned_to_name) fields.push({ name: "Claimed by", value: String(ticket.assigned_to_name), inline: true });
  if (state === "open" && ticket.channel_id) fields.push({ name: "Private channel", value: `<#${ticket.channel_id}>`, inline: false });
  if (state === "closed") fields.push({ name: "Saved messages", value: String(transcriptCount), inline: true });
  return {
    color: state === "open" ? TICKET_COLORS[ticket.ticket_type as TicketType] : 0x768078,
    title: `${ticket.ticket_code} • ${label}`,
    fields,
    footer: { text: state === "open" ? "ThyToxicBot • Private ticket active" : "Toxic Command Center • six-month retention" },
    timestamp: state === "open" ? ticket.opened_at : ticket.closed_at,
  };
}

function ticketControlEmbed(ticket: AnyRecord): AnyRecord {
  const type = ticket.ticket_type as TicketType;
  const fields: AnyRecord[] = [
    { name: "Opened by", value: ticket.requester_display_name ?? ticket.requester_username, inline: true },
    { name: "Ticket type", value: TICKET_LABELS[type], inline: true },
    { name: "Assigned staff", value: ticket.assigned_to_name ?? "Unclaimed", inline: true },
  ];
  return {
    color: TICKET_COLORS[type],
    title: `${ticket.ticket_code} • ${TICKET_LABELS[type]}`,
    description: "Explain what you need and include any useful dates, screenshots, message links, or other evidence. Only you and authorized staff can view this channel.",
    fields,
    footer: { text: "Closing archives the conversation to the protected website record and removes this Discord channel." },
    timestamp: ticket.opened_at,
  };
}

function ticketControlComponents(ticket: AnyRecord): AnyRecord[] {
  const claimed = Boolean(ticket.assigned_to_user_id);
  return [{
    type: 1,
    components: [
      {
        type: 2,
        style: claimed ? 2 : 3,
        label: claimed ? `Claimed by ${String(ticket.assigned_to_name ?? "Staff").slice(0, 62)}` : "Claim Ticket",
        custom_id: `ticket_claim:${ticket.id}`,
        disabled: claimed,
      },
      { type: 2, style: 4, label: "Close Ticket", custom_id: `ticket_close:${ticket.id}` },
    ],
  }];
}

const TICKET_TIME_ZONE = "America/New_York";

function ticketDay(value: string | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TICKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function ticketStatusDashboardEmbed(tickets: AnyRecord[]): AnyRecord {
  const today = ticketDay(new Date().toISOString());
  const active = tickets.filter((ticket) => ["creating", "open", "closing"].includes(String(ticket.status)));
  const waiting = active.filter((ticket) => !ticket.assigned_to_user_id).length;
  const claimed = active.filter((ticket) => Boolean(ticket.assigned_to_user_id)).length;
  const openedToday = tickets.filter((ticket) => ticketDay(ticket.opened_at) === today);
  const closedToday = tickets.filter((ticket) => ticketDay(ticket.closed_at) === today);
  const replySeconds = openedToday
    .filter((ticket) => ticket.opened_at && ticket.claimed_at)
    .map((ticket) => Math.max(0, Math.round((new Date(ticket.claimed_at).getTime() - new Date(ticket.opened_at).getTime()) / 1000)))
    .filter(Number.isFinite);
  const averageReply = replySeconds.length
    ? `${Math.round(replySeconds.reduce((total, seconds) => total + seconds, 0) / replySeconds.length)} sec`
    : "Not available yet";
  const locationLines = (Object.keys(TICKET_LABELS) as TicketType[]).map((type) => {
    const open = active.filter((ticket) => ticket.ticket_type === type).length;
    const opened = openedToday.filter((ticket) => ticket.ticket_type === type).length;
    const icon = type === "general" ? "📬" : type === "report" ? "🚨" : type === "staff" ? "🛡️" : "💡";
    return `${icon} **${TICKET_LABELS[type]}**\nOpen: ${open} · Opened today: ${opened}`;
  });
  return {
    color: 0x48e69b,
    title: "📌 Support Status",
    description: "A live look at how the ThyToxicBot support queue is doing.",
    fields: [
      {
        name: "Current queue",
        value: `📌 ${active.length} open right now · ${waiting} waiting for staff\n🛡️ ${claimed} currently claimed`,
        inline: false,
      },
      {
        name: "Today",
        value: `↗️ ${openedToday.length} opened · ✅ ${closedToday.length} closed\nAverage first reply: ${averageReply}`,
        inline: false,
      },
      { name: "Ticket locations", value: locationLines.join("\n\n"), inline: false },
    ],
    footer: { text: "ThyToxicBot • Live Ticket Status • Updates automatically" },
    timestamp: new Date().toISOString(),
  };
}

async function refreshTicketStatusDashboard(config: AnyRecord): Promise<string | null> {
  try {
    const [tickets, messages] = await Promise.all([
      dbSelect("discord_tickets", {
        select: "ticket_type,status,assigned_to_user_id,opened_at,closed_at,claimed_at",
        guild_id: `eq.${config.guild_id}`,
        order: "created_at.desc",
        limit: "1000",
      }),
      discord(`/channels/${config.ticket_status_channel_id}/messages?limit=100`),
    ]);
    const dashboard = Array.isArray(messages) ? messages.find((message: AnyRecord) =>
      String(message.author?.id ?? "") === APPLICATION_ID &&
      String(message.embeds?.[0]?.title ?? "").includes("Support Status")) : null;
    const staleTicketMessages = Array.isArray(messages) ? messages.filter((message: AnyRecord) =>
      String(message.author?.id ?? "") === APPLICATION_ID &&
      String(message.embeds?.[0]?.title ?? "").startsWith("TTG-TKT-")) : [];
    await Promise.all(staleTicketMessages.map((message: AnyRecord) =>
      discord(`/channels/${config.ticket_status_channel_id}/messages/${message.id}`, { method: "DELETE" })
        .catch((error) => console.warn("stale ticket status cleanup failed", safeMessage(error)))));
    const payload = { embeds: [ticketStatusDashboardEmbed(tickets)], allowed_mentions: { parse: [] } };
    const message = dashboard
      ? await discord(`/channels/${config.ticket_status_channel_id}/messages/${dashboard.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })
      : await discord(`/channels/${config.ticket_status_channel_id}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    return String(message.id);
  } catch (error) {
    console.warn("ticket status dashboard refresh failed", safeMessage(error));
    return null;
  }
}

async function refreshTicketStatusDashboardForGuild(guildId: string): Promise<string | null> {
  const config = await ticketConfig(guildId);
  if (!config) return null;
  return await refreshTicketStatusDashboard(config);
}

function ticketLogPayload(ticket: AnyRecord, transcriptCount: number): Json {
  return {
    content: "Archived record: https://thy-toxic-gamer.github.io/Toxic-Command-Center/tickets/staff.html",
    embeds: [ticketStatusEmbed(ticket, "closed", transcriptCount)],
    allowed_mentions: { parse: [] },
  };
}

async function ensureBotChannelAccess(channelId: string): Promise<void> {
  await discord(`/channels/${channelId}/permissions/${APPLICATION_ID}`, {
    method: "PUT",
    body: JSON.stringify({
      type: 1,
      allow: String(STAFF_CHANNEL_ALLOW),
      deny: "0",
    }),
  });
}

async function postTicketLog(config: AnyRecord, ticket: AnyRecord, transcriptCount: number): Promise<AnyRecord> {
  const send = () => discord(`/channels/${config.ticket_log_channel_id}/messages`, {
    method: "POST",
    body: JSON.stringify(ticketLogPayload(ticket, transcriptCount)),
  });
  try {
    return await send();
  } catch (error) {
    if (!(error instanceof DiscordError) || error.status !== 403) throw error;
    await ensureBotChannelAccess(String(config.ticket_log_channel_id));
    return await send();
  }
}

async function repairMissingTicketLogs(guildId: string): Promise<number> {
  const config = await ticketConfig(guildId);
  if (!config?.ticket_log_channel_id) return 0;
  const tickets = await dbSelect("discord_tickets", {
    select: "*",
    guild_id: `eq.${guildId}`,
    status: "eq.closed",
    log_message_id: "is.null",
    order: "closed_at.asc",
    limit: "25",
  });
  let repaired = 0;
  for (const ticket of tickets) {
    try {
      const count = Array.isArray(ticket.transcript) ? ticket.transcript.length : 0;
      const log = await postTicketLog(config, ticket, count);
      await dbUpdate("discord_tickets", `id=eq.${ticket.id}`, {
        log_message_id: String(log.id),
        deletion_error: null,
        updated_at: new Date().toISOString(),
      });
      repaired += 1;
    } catch (error) {
      console.warn("ticket log repair failed", ticket.ticket_code, safeMessage(error));
      await dbUpdate("discord_tickets", `id=eq.${ticket.id}`, {
        deletion_error: `Ticket log delivery failed: ${safeMessage(error)}`.slice(0, 1000),
        updated_at: new Date().toISOString(),
      });
      break;
    }
  }
  return repaired;
}

async function openTicket(interaction: AnyRecord, type: TicketType): Promise<Json> {
  const guildId = String(interaction.guild_id ?? "");
  if (!guildId) return ephemeral("Tickets can only be opened inside the server.");
  const [config, guild] = await Promise.all([ticketConfig(guildId), guildConfig(guildId)]);
  if (!config || !guild) return ephemeral("The Ticket Center is not configured for this server.");
  if (String(interaction.channel_id) !== String(config.ticket_center_channel_id)) {
    return ephemeral(`Open tickets from <#${config.ticket_center_channel_id}>.`);
  }
  const user = appUser(interaction);
  const existing = (await dbSelect("discord_tickets", {
    select: "id,ticket_code,channel_id,status",
    guild_id: `eq.${guildId}`,
    requester_user_id: `eq.${user.id}`,
    status: "in.(creating,open,closing)",
    limit: "1",
  }))[0];
  if (existing?.channel_id) return ephemeral(`You already have an active ticket: <#${existing.channel_id}> (${existing.ticket_code}).`);
  if (existing) return ephemeral(`Your ticket ${existing.ticket_code} is still being prepared. Please wait a moment.`);

  const ticket = await dbInsert("discord_tickets", {
    guild_id: guildId,
    ticket_type: type,
    requester_user_id: String(user.id),
    requester_username: String(user.username ?? user.id),
    requester_display_name: displayName(user, interaction.member),
    status: "creating",
  });
  await insertTicketEvent(ticket.id, "created", user, { ticket_type: type });

  const categoryId = ticketCategory(config, type);
  if (!categoryId) throw new Error(`The ${TICKET_LABELS[type]} category is not configured.`);
  const staffRoleIds = [...new Set([
    ...(Array.isArray(guild.moderator_role_ids) ? guild.moderator_role_ids : []),
    ...(Array.isArray(guild.administrator_role_ids) ? guild.administrator_role_ids : []),
  ].map(String))];
  const overwrites = [
    { id: guildId, type: 0, deny: String(1n << 10n) },
    { id: String(user.id), type: 1, allow: String(CHANNEL_ALLOW) },
    { id: APPLICATION_ID, type: 1, allow: String(STAFF_CHANNEL_ALLOW) },
    ...staffRoleIds.map((id) => ({ id, type: 0, allow: String(STAFF_CHANNEL_ALLOW) })),
  ];
  let channel: AnyRecord | null = null;
  try {
    channel = await discordAction(`/guilds/${guildId}/channels`, "POST", {
      name: `${type}-${channelSlug(displayName(user, interaction.member))}-${String(ticket.ticket_number).padStart(6, "0")}`.slice(0, 100),
      type: 0,
      parent_id: categoryId,
      topic: `${ticket.ticket_code} • ${TICKET_LABELS[type]} • requester ${user.id}`.slice(0, 1024),
      permission_overwrites: overwrites,
    }, ticket.ticket_code, `Private ${TICKET_LABELS[type]} ticket opened by ${user.username ?? user.id}`);
    const openedAt = new Date().toISOString();
    const opened = await dbUpdate("discord_tickets", `id=eq.${ticket.id}`, {
      channel_id: channel.id,
      status: "open",
      opened_at: openedAt,
      updated_at: openedAt,
    });
    const controlMessage = await discord(`/channels/${channel.id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: `<@${user.id}> your private ticket is ready. ${staffRoleIds.map((id) => `<@&${id}>`).join(" ")}`.trim(),
        allowed_mentions: { users: [String(user.id)], roles: staffRoleIds, parse: [] },
        embeds: [ticketControlEmbed(opened)],
        components: ticketControlComponents(opened),
      }),
    });
    opened.control_message_id = String(controlMessage.id);
    await dbUpdate("discord_tickets", `id=eq.${ticket.id}`, { control_message_id: controlMessage.id });
    await insertTicketEvent(ticket.id, "opened", user, { channel_id: channel.id, category_id: categoryId });
    await refreshTicketStatusDashboard(config);
    return ephemeral(`Your private ticket is ready: <#${channel.id}>`);
  } catch (error) {
    if (channel?.id) await discord(`/channels/${channel.id}`, { method: "DELETE" }).catch(() => null);
    await dbUpdate("discord_tickets", `id=eq.${ticket.id}`, {
      status: "failed",
      deletion_error: safeMessage(error).slice(0, 1000),
      updated_at: new Date().toISOString(),
    });
    await insertTicketEvent(ticket.id, "failed", user, { error: safeMessage(error) });
    throw error;
  }
}

async function claimTicket(interaction: AnyRecord, ticketId: string): Promise<Json> {
  const guildId = String(interaction.guild_id ?? "");
  const [guild, config] = await Promise.all([guildConfig(guildId), ticketConfig(guildId)]);
  if (!guild || !config) return ephemeral("The Ticket Center is not configured.");
  if (!isStaff(interaction, guild)) return ephemeral("Only an authorized Moderator, Administrator, or the server owner can claim tickets.");
  const ticket = (await dbSelect("discord_tickets", { select: "*", id: `eq.${ticketId}`, guild_id: `eq.${guildId}`, limit: "1" }))[0];
  if (!ticket) return ephemeral("That ticket record was not found.");
  if (ticket.status !== "open") return ephemeral("Only an open ticket can be claimed.");
  if (String(ticket.channel_id) !== String(interaction.channel_id)) return ephemeral("Use the Claim Ticket button inside the ticket channel.");
  const actor = appUser(interaction);
  if (ticket.assigned_to_user_id) {
    return ephemeral(String(ticket.assigned_to_user_id) === String(actor.id)
      ? `You already claimed ${ticket.ticket_code}.`
      : `${ticket.ticket_code} is already claimed by ${ticket.assigned_to_name ?? "another staff member"}.`);
  }
  const claimedAt = new Date().toISOString();
  const actorName = displayName(actor, interaction.member);
  const claimed = await dbUpdate("discord_tickets", `id=eq.${ticket.id}&status=eq.open&assigned_to_user_id=is.null`, {
    assigned_to_user_id: String(actor.id),
    assigned_to_name: actorName,
    claimed_at: claimedAt,
    control_message_id: ticket.control_message_id ?? interaction.message?.id ?? null,
    updated_at: claimedAt,
  });
  if (!claimed) {
    const latest = (await dbSelect("discord_tickets", { select: "ticket_code,assigned_to_name", id: `eq.${ticket.id}`, limit: "1" }))[0];
    return ephemeral(`${latest?.ticket_code ?? ticket.ticket_code} was just claimed by ${latest?.assigned_to_name ?? "another staff member"}.`);
  }
  await insertTicketEvent(ticket.id, "claimed", actor, { assigned_to_name: actorName });
  const controlMessageId = String(claimed.control_message_id ?? interaction.message?.id ?? "");
  if (controlMessageId) {
    await discord(`/channels/${ticket.channel_id}/messages/${controlMessageId}`, {
      method: "PATCH",
      body: JSON.stringify({
        content: interaction.message?.content ?? `<@${ticket.requester_user_id}> your private ticket is ready.`,
        embeds: [ticketControlEmbed(claimed)],
        components: ticketControlComponents(claimed),
        allowed_mentions: { parse: [] },
      }),
    });
  }
  await refreshTicketStatusDashboard(config);
  await discord(`/channels/${ticket.channel_id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: `<@${actor.id}> claimed this ticket.`, allowed_mentions: { users: [String(actor.id)], parse: [] } }),
  });
  return ephemeral(`You claimed ${ticket.ticket_code}.`);
}

async function channelTranscript(channelId: string): Promise<AnyRecord[]> {
  const messages: AnyRecord[] = [];
  let before = "";
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);
    const batch = await discord(`/channels/${channelId}/messages?${query.toString()}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const message of batch) {
      messages.push({
        id: String(message.id),
        author: {
          id: String(message.author?.id ?? ""),
          username: String(message.author?.username ?? "Unknown"),
          display_name: String(message.member?.nick ?? message.author?.global_name ?? message.author?.username ?? "Unknown"),
          bot: Boolean(message.author?.bot),
        },
        content: String(message.content ?? ""),
        attachments: (message.attachments ?? []).map((item: AnyRecord) => ({
          id: String(item.id), filename: String(item.filename ?? "Attachment"), url: String(item.url ?? ""),
          content_type: item.content_type ?? null, size: item.size ?? null,
        })),
        embeds: (message.embeds ?? []).map((item: AnyRecord) => ({
          title: item.title ?? null, description: item.description ?? null, url: item.url ?? null,
        })),
        created_at: message.timestamp,
        edited_at: message.edited_timestamp ?? null,
      });
    }
    if (batch.length < 100) break;
    before = String(batch[batch.length - 1].id);
  }
  return messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

async function closeTicket(interaction: AnyRecord, ticketId: string): Promise<{ ticket: AnyRecord; config: AnyRecord }> {
  const guildId = String(interaction.guild_id ?? "");
  const [guild, config] = await Promise.all([guildConfig(guildId), ticketConfig(guildId)]);
  if (!guild || !config) throw new Error("The Ticket Center is not configured.");
  const ticket = (await dbSelect("discord_tickets", { select: "*", id: `eq.${ticketId}`, guild_id: `eq.${guildId}`, limit: "1" }))[0];
  if (!ticket) throw new Error("That ticket record was not found.");
  const actor = appUser(interaction);
  if (String(ticket.requester_user_id) !== String(actor.id) && !isStaff(interaction, guild)) {
    throw new Error("Only the ticket requester or authorized staff can close this ticket.");
  }
  if (ticket.status !== "open") throw new Error("This ticket is already closed or unavailable.");
  if (String(ticket.channel_id) !== String(interaction.channel_id)) throw new Error("Use the Close Ticket button inside the ticket channel.");

  await dbUpdate("discord_tickets", `id=eq.${ticket.id}`, { status: "closing", updated_at: new Date().toISOString() });
  await insertTicketEvent(ticket.id, "close_requested", actor);
  let transcript: AnyRecord[];
  try {
    transcript = await channelTranscript(ticket.channel_id);
  } catch (error) {
    await dbUpdate("discord_tickets", `id=eq.${ticket.id}`, { status: "open", deletion_error: safeMessage(error), updated_at: new Date().toISOString() });
    throw new Error(`The ticket could not be archived, so the Discord channel was kept open. ${safeMessage(error)}`);
  }

  const closedAt = new Date().toISOString();
  const purge = new Date();
  purge.setUTCMonth(purge.getUTCMonth() + Number(config.retention_months ?? 6));
  const closedPreview = {
    ...ticket,
    status: "closed",
    transcript,
    close_reason: "Closed from the Discord ticket channel.",
    closed_by_user_id: String(actor.id),
    closed_by_name: displayName(actor, interaction.member),
    closed_at: closedAt,
    purge_after: purge.toISOString(),
    updated_at: closedAt,
  };
  let log: AnyRecord;
  try {
    log = await postTicketLog(config, closedPreview, transcript.length);
  } catch (error) {
    const message = `Ticket log delivery failed: ${safeMessage(error)}`.slice(0, 1000);
    await dbUpdate("discord_tickets", `id=eq.${ticket.id}`, {
      status: "open",
      deletion_error: message,
      updated_at: new Date().toISOString(),
    });
    await insertTicketEvent(ticket.id, "failed", actor, { stage: "ticket_log", error: safeMessage(error) });
    throw new Error("I couldn't post the completed ticket to ticket-logs, so this private channel was kept open. Check ThyToxicBot's channel permissions and try again.");
  }

  const closed = await dbUpdate("discord_tickets", `id=eq.${ticket.id}`, {
    status: "closed",
    transcript,
    close_reason: closedPreview.close_reason,
    closed_by_user_id: closedPreview.closed_by_user_id,
    closed_by_name: closedPreview.closed_by_name,
    closed_at: closedAt,
    purge_after: purge.toISOString(),
    log_message_id: String(log.id),
    deletion_error: null,
    updated_at: closedAt,
  });
  await insertTicketEvent(ticket.id, "closed", actor, { message_count: transcript.length, log_message_id: String(log.id) });

  await refreshTicketStatusDashboard(config);
  return { ticket: closed, config };
}

async function closeTicketAndDelete(interaction: AnyRecord, ticketId: string): Promise<void> {
  try {
    const { ticket } = await closeTicket(interaction, ticketId);
    await editOriginal(interaction, ephemeral(`${ticket.ticket_code} was archived to the Ticket Center. This Discord channel is now closing.`));
    try {
      await discordAction(`/channels/${ticket.channel_id}`, "DELETE", undefined, ticket.ticket_code, `Ticket closed by ${displayName(appUser(interaction), interaction.member)}`);
      await dbUpdate("discord_tickets", `id=eq.${ticket.id}`, { channel_deleted_at: new Date().toISOString(), deletion_error: null });
      await insertTicketEvent(ticket.id, "channel_deleted", appUser(interaction), { channel_id: ticket.channel_id });
    } catch (error) {
      await dbUpdate("discord_tickets", `id=eq.${ticket.id}`, { deletion_error: safeMessage(error).slice(0, 1000) });
      console.error("ticket channel deletion failed", safeMessage(error));
    }
  } catch (error) {
    console.error("ticket close failed", safeMessage(error));
    await editOriginal(interaction, ephemeral(`I couldn't close this ticket: ${safeMessage(error)}`));
  }
}

async function insertEvent(caseId: string, data: Json): Promise<void> {
  await dbInsert("discord_moderation_events", { case_id: caseId, ...data });
}

function guideMessageMatches(message: AnyRecord, payload: AnyRecord): boolean {
  const actual = (message.embeds ?? []).map((embed: AnyRecord) => ({
    color: embed.color ?? null,
    title: embed.title ?? null,
    description: embed.description ?? null,
    fields: (embed.fields ?? []).map((field: AnyRecord) => ({
      name: field.name ?? null,
      value: field.value ?? null,
      inline: Boolean(field.inline),
    })),
    footer: embed.footer?.text ? { text: embed.footer.text } : null,
  }));
  const expected = (payload.embeds ?? []).map((embed: AnyRecord) => ({
    color: embed.color ?? null,
    title: embed.title ?? null,
    description: embed.description ?? null,
    fields: (embed.fields ?? []).map((field: AnyRecord) => ({
      name: field.name ?? null,
      value: field.value ?? null,
      inline: Boolean(field.inline),
    })),
    footer: embed.footer?.text ? { text: embed.footer.text } : null,
  }));
  return JSON.stringify(actual) === JSON.stringify(expected);
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
        const current = await discord(`/channels/${channelId}/messages/${existingId}`);
        if (guideMessageMatches(current, payload)) {
          message = current;
        } else {
          message = await discord(`/channels/${channelId}/messages/${existingId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
        }
      } catch (error) {
        const replaceInstead = error instanceof DiscordError && (error.status === 404 || error.status === 429);
        if (!replaceInstead) throw error;
      }
    }
    if (!message) {
      message = await discord(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (existingId && existingId !== String(message.id)) {
        try {
          await discord(`/channels/${channelId}/messages/${existingId}`, { method: "DELETE" });
        } catch (error) {
          console.warn("old guide cleanup skipped", safeMessage(error));
        }
      }
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

async function bootstrap(): Promise<number> {
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
    polls_channel_id: existing?.polls_channel_id ?? POLLS_CHANNEL_ID,
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
  const repairedLogs = await repairMissingTicketLogs(String(channel.guild_id));
  await refreshTicketStatusDashboardForGuild(String(channel.guild_id));
  console.log("ThyToxicBot bootstrap complete for guild", channel.guild_id, "repaired ticket logs", repairedLogs);
  return repairedLogs;
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

const OPEN_INFRACTION_STATUSES = ["active", "appealed", "under_review", "needs_information", "accepted_pending_reversal"];

async function openInfractions(guildId: string, action?: string): Promise<AnyRecord[]> {
  const rows: AnyRecord[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await dbSelect("discord_moderation_cases", {
      select: "*",
      guild_id: `eq.${guildId}`,
      status: `in.(${OPEN_INFRACTION_STATUSES.join(",")})`,
      ...(action ? { action: `eq.${action}` } : {}),
      order: "subject_display_name.asc,created_at.asc,id.asc",
      limit: "100",
      offset: String(offset),
    });
    rows.push(...page);
    if (page.length < 100) break;
  }
  return rows;
}

async function infractionsCommand(interaction: AnyRecord, config: AnyRecord, values: Record<string, any>): Promise<Json> {
  if (!isStaff(interaction, config)) return ephemeral("This command is restricted to authorized staff.");
  const action = values.action ? String(values.action) : undefined;
  const rows = await openInfractions(interaction.guild_id, action);
  if (!rows.length) return ephemeral(action ? `No current **${action}** infractions were found.` : "No current infractions were found.");
  const heading = `**Current infractions — ${rows.length}${action ? ` ${action}` : " total"}**`;
  const lines: string[] = [heading];
  for (const row of rows) {
    const line = `• **${row.subject_display_name ?? row.subject_username}** · ${row.action} · ${row.case_code} · ${row.status.replaceAll("_", " ")}`;
    if ([...lines, line].join("\n").length > 1850) break;
    lines.push(line);
  }
  if (lines.length - 1 < rows.length) lines.push(`…and ${rows.length - (lines.length - 1)} more. Use \`/t cases\` to search a member or case.`);
  return ephemeral(lines.join("\n"));
}

async function clearAllInfractionsCommand(interaction: AnyRecord, config: AnyRecord, values: Record<string, any>): Promise<Json> {
  if (!isOwner(interaction, config)) return ephemeral("The all-clear command is restricted to the application owner.");
  if (String(values.confirmation ?? "").trim().toUpperCase() !== "CLEAR ALL INFRACTIONS") {
    return ephemeral("Confirmation did not match. Type exactly: `CLEAR ALL INFRACTIONS`");
  }
  const rows = await openInfractions(interaction.guild_id);
  if (!rows.length) return ephemeral("There are no current infractions to clear.");
  const actor = appUser(interaction);
  const actorName = displayName(actor, interaction.member);
  const now = new Date().toISOString();
  let cleared = 0;
  const failed: string[] = [];

  for (const row of rows) {
    let failure: string | null = null;
    try {
      if (row.action === "mute") {
        await discordAction(`/guilds/${interaction.guild_id}/members/${row.subject_user_id}`, "PATCH", { communication_disabled_until: null }, row.case_code, "Owner all-clear");
      } else if (row.action === "ban") {
        await discordAction(`/guilds/${interaction.guild_id}/bans/${row.subject_user_id}`, "DELETE", undefined, row.case_code, "Owner all-clear");
      }
    } catch (error) {
      if (!(error instanceof DiscordError) || error.status !== 404) failure = safeMessage(error);
    }

    if (failure) {
      failed.push(`${row.case_code}: ${failure}`);
      await insertEvent(row.id, {
        event_type: "reversal_failed",
        actor_type: "owner",
        actor_user_id: actor.id,
        actor_name: actorName,
        visibility: "staff",
        message: `Owner all-clear failed: ${failure}`,
        metadata: { global_clear: true, previous_status: row.status },
      });
      continue;
    }

    const updated = await dbUpdate("discord_moderation_cases", `id=eq.${row.id}`, {
      status: "reversed",
      reversed_at: now,
      reversed_by_user_id: actor.id,
    });
    await insertEvent(row.id, {
      event_type: "reversal_succeeded",
      actor_type: "owner",
      actor_user_id: actor.id,
      actor_name: actorName,
      visibility: "staff",
      message: "Cleared by the owner-wide all-clear command.",
      metadata: { global_clear: true, previous_status: row.status },
    });
    try { await sendStaffReply(updated, `The infraction recorded in ${row.case_code} was cleared by the server owner.`); }
    catch (error) { console.warn("all-clear DM failed", safeMessage(error)); }
    try { await postCaseConversation(config, updated, `↩️ **Infraction cleared by ${actorName}**\nOwner-wide all-clear.`); }
    catch (error) { console.warn("all-clear case log failed", safeMessage(error)); }
    cleared += 1;
  }

  const failureSummary = failed.length ? ` ${failed.length} could not be cleared and remain active: ${failed.slice(0, 3).join(" | ")}` : "";
  return ephemeral(`All-clear finished. **${cleared}** infraction${cleared === 1 ? "" : "s"} cleared.${failureSummary}`.slice(0, 1950));
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

function pollCode(row: AnyRecord): string {
  return `TTG-POLL-${String(row.poll_number).padStart(6, "0")}`;
}

function pollDiscordTimestamp(value: string, style = "F"): string {
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:${style}>`;
}

async function pollSnapshot(pollId: string): Promise<AnyRecord | null> {
  const rows = await dbSelect("polls", { select: "*", id: `eq.${pollId}`, limit: "1" });
  const row = rows[0];
  if (!row) return null;
  const [options, votes] = await Promise.all([
    dbSelect("poll_options", { select: "id,position,label", poll_id: `eq.${pollId}`, order: "position.asc" }),
    dbSelect("poll_votes", { select: "option_id", poll_id: `eq.${pollId}` }),
  ]);
  const totalVotes = votes.length;
  return {
    ...row,
    code: pollCode(row),
    totalVotes,
    options: options.map((option) => {
      const count = votes.filter((vote) => vote.option_id === option.id).length;
      return { ...option, count, percent: totalVotes ? Math.round((count / totalVotes) * 1000) / 10 : 0 };
    }),
  };
}

function pollDiscordPayload(poll: AnyRecord): AnyRecord {
  const closed = poll.status !== "open";
  const winner = closed && poll.totalVotes ? Math.max(...poll.options.map((option: AnyRecord) => option.count)) : -1;
  const lines = poll.options.map((option: AnyRecord) => {
    const marker = closed && winner > 0 && option.count === winner ? "🏆" : `${option.position}.`;
    return `${marker} **${option.label}** — ${option.count} vote${option.count === 1 ? "" : "s"} (${option.percent}%)`;
  });
  const timing = poll.closes_at && !closed
    ? `Voting closes ${pollDiscordTimestamp(poll.closes_at)} · ${pollDiscordTimestamp(poll.closes_at, "R")}`
    : closed ? `Closed${poll.closed_at ? ` ${pollDiscordTimestamp(poll.closed_at, "R")}` : ""}` : "No automatic closing time";
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

async function syncPollDiscord(pollId: string): Promise<void> {
  const poll = await pollSnapshot(pollId);
  if (!poll) return;
  const channelId = poll.discord_channel_id || POLLS_CHANNEL_ID;
  let message: AnyRecord | null = null;
  if (poll.discord_message_id) {
    try {
      message = await discord(`/channels/${channelId}/messages/${poll.discord_message_id}`, {
        method: "PATCH",
        body: JSON.stringify(pollDiscordPayload(poll)),
      });
    } catch (error) {
      if (!(error instanceof DiscordError) || error.status !== 404) throw error;
    }
  }
  if (!message && poll.status !== "archived") {
    message = await discord(`/channels/${POLLS_CHANNEL_ID}/messages`, {
      method: "POST",
      body: JSON.stringify(pollDiscordPayload(poll)),
    });
  }
  await dbUpdate("polls", `id=eq.${pollId}`, {
    discord_channel_id: message?.channel_id ?? channelId,
    discord_message_id: message?.id ?? poll.discord_message_id ?? null,
    discord_last_error: null,
    updated_at: new Date().toISOString(),
  });
}

async function closeExpiredPolls(): Promise<void> {
  const now = new Date().toISOString();
  const due = await dbSelect("polls", { select: "id", status: "eq.open", closes_at: `lte.${now}`, limit: "100" });
  for (const row of due) {
    const updated = await dbUpdate("polls", `id=eq.${row.id}&status=eq.open`, { status: "closed", closed_at: now, updated_at: now });
    if (!updated) continue;
    await dbInsert("poll_events", { poll_id: row.id, event_type: "poll_closed", actor_platform: "system", actor_user_id: "poll-expiry", actor_name: "Automatic poll timer" });
    await syncPollDiscord(row.id);
  }
}

async function pollsCommand(): Promise<Json> {
  await closeExpiredPolls();
  const rows = await dbSelect("polls", { select: "poll_number,question,closes_at", status: "eq.open", order: "created_at.desc", limit: "10" });
  const lines = rows.length
    ? rows.map((row) => `• **${pollCode(row)}** — ${row.question}${row.closes_at ? ` · closes ${pollDiscordTimestamp(row.closes_at, "R")}` : ""}`).join("\n")
    : "There are no open polls right now.";
  return {
    content: `${lines}\n\nVoting happens only on the official Poll Center.`,
    flags: 64,
    allowed_mentions: { parse: [] },
    components: [{ type: 1, components: [{ type: 2, style: 5, label: "Open Poll Center", url: POLLS_URL }] }],
  };
}

const POLL_DURATION_SECONDS: Record<string, number> = {
  "15m": 900, "30m": 1800, "1h": 3600, "90m": 5400, "3h": 10800, "6h": 21600,
  "12h": 43200, "1d": 86400, "3d": 259200, "7d": 604800, none: 0,
};

async function pollCreateCommand(interaction: AnyRecord, config: AnyRecord, values: Record<string, any>): Promise<Json> {
  if (!isStaff(interaction, config)) return ephemeral("This command is restricted to authorized staff.");
  const question = String(values.question || "").trim();
  const options = [...new Set([values.option1, values.option2, values.option3, values.option4, values.option5, values.option6].map((value) => String(value || "").trim()).filter(Boolean))];
  if (options.length < 2) return ephemeral("Add at least two different poll choices.");
  const duration = String(values.duration || "1h");
  const seconds = POLL_DURATION_SECONDS[duration];
  if (seconds === undefined) return ephemeral("Choose a valid poll duration.");
  const actor = appUser(interaction);
  const now = Date.now();
  const poll = await dbInsert("polls", {
    question,
    status: "open",
    closes_at: seconds ? new Date(now + seconds * 1000).toISOString() : null,
    created_by_platform: "discord",
    created_by_user_id: actor.id,
    created_by_name: displayName(actor, interaction.member),
    discord_channel_id: POLLS_CHANNEL_ID,
  });
  if (!poll) throw new Error("The poll record could not be created.");
  try {
    await dbRequest("poll_options", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify(options.map((label, index) => ({ poll_id: poll.id, position: index + 1, label }))),
    });
  } catch (error) {
    await dbDelete("polls", `id=eq.${poll.id}`);
    throw error;
  }
  await dbInsert("poll_events", { poll_id: poll.id, event_type: "poll_created", actor_platform: "discord", actor_user_id: actor.id, actor_name: displayName(actor, interaction.member), details: { duration } });
  await syncPollDiscord(poll.id);
  return ephemeral(`**${pollCode(poll)}** is open in <#${POLLS_CHANNEL_ID}> and on the Poll Center.`);
}

async function pollCloseCommand(interaction: AnyRecord, config: AnyRecord, values: Record<string, any>): Promise<Json> {
  if (!isStaff(interaction, config)) return ephemeral("This command is restricted to authorized staff.");
  const number = Number(values.poll_number);
  const rows = await dbSelect("polls", { select: "id,poll_number,status", poll_number: `eq.${number}`, limit: "1" });
  const row = rows[0];
  if (!row) return ephemeral("That poll number could not be found.");
  if (row.status !== "open") return ephemeral(`**${pollCode(row)}** is already closed or archived.`);
  const actor = appUser(interaction);
  const now = new Date().toISOString();
  await dbUpdate("polls", `id=eq.${row.id}&status=eq.open`, { status: "closed", closed_at: now, updated_at: now });
  await dbInsert("poll_events", { poll_id: row.id, event_type: "poll_closed", actor_platform: "discord", actor_user_id: actor.id, actor_name: displayName(actor, interaction.member) });
  await syncPollDiscord(row.id);
  return ephemeral(`**${pollCode(row)}** is closed and its final results are published.`);
}

async function pollClearCommand(interaction: AnyRecord, config: AnyRecord, values: Record<string, any>): Promise<Json> {
  if (!isOwner(interaction, config)) return ephemeral("Only the bot owner can clear all polls.");
  if (String(values.confirmation || "") !== "CLEAR ALL POLLS") return ephemeral("Type **CLEAR ALL POLLS** exactly to confirm.");
  const rows = await dbSelect("polls", { select: "id", status: "neq.archived", limit: "500" });
  const now = new Date().toISOString();
  for (const row of rows) {
    await dbUpdate("polls", `id=eq.${row.id}`, { status: "archived", closed_at: now, updated_at: now });
    await syncPollDiscord(row.id);
  }
  const actor = appUser(interaction);
  await dbInsert("poll_events", { poll_id: null, event_type: "all_polls_cleared", actor_platform: "discord", actor_user_id: actor.id, actor_name: displayName(actor, interaction.member), details: { count: rows.length } });
  return ephemeral(`${rows.length} poll${rows.length === 1 ? " was" : "s were"} archived. Discord records were preserved.`);
}

async function guideCommand(interaction: AnyRecord, config: AnyRecord): Promise<Json> {
  if (!isAdministrator(interaction, config)) return ephemeral("Only an authorized administrator can refresh the staff guide.");
  const repairedLogs = await bootstrap();
  const repairedMessage = repairedLogs === 1
    ? " One missing completed-ticket log was restored."
    : repairedLogs > 1 ? ` ${repairedLogs} missing completed-ticket logs were restored.` : "";
  return ephemeral(`ThyToxicBot commands and the pinned Appeals & Moderation Review guide are updated.${repairedMessage}`);
}

async function communityInfoCommand(interaction: AnyRecord, config: AnyRecord): Promise<Json> {
  if (!isOwner(interaction, config)) return ephemeral("Only the bot owner can refresh the community information panels.");
  const channelId = String(interaction.channel_id ?? "");
  if (!channelId) return ephemeral("Run this command inside the channel that should receive the information panels.");

  let currentMessages: AnyRecord[] = [];
  let cleanupSkipped = false;
  try {
    const messages = await discord(`/channels/${channelId}/messages?limit=100`);
    currentMessages = Array.isArray(messages) ? messages : [];
  } catch (error) {
    if (!(error instanceof DiscordError) || error.status !== 403) throw error;
    cleanupSkipped = true;
    console.warn("community information history unavailable", safeMessage(error));
  }
  const oldPanels = Array.isArray(currentMessages)
    ? currentMessages.filter((message: AnyRecord) =>
      String(message.author?.id ?? "") === APPLICATION_ID &&
      (message.embeds ?? []).some((embed: AnyRecord) => COMMUNITY_INFO_CLEANUP_TITLES.includes(String(embed.title ?? "") as any))
    )
    : [];

  for (const message of oldPanels) {
    try {
      await discord(`/channels/${channelId}/messages/${message.id}`, { method: "DELETE" });
    } catch (error) {
      if (!(error instanceof DiscordError) || error.status !== 403) throw error;
      cleanupSkipped = true;
      console.warn("old community information cleanup skipped", safeMessage(error));
    }
  }
  try {
    for (const payload of COMMUNITY_INFO_MESSAGES) {
      await discord(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
  } catch (error) {
    if (error instanceof DiscordError && error.status === 403) {
      return ephemeral(`I could not post in <#${channelId}>. Give the ThyToxicBot role **View Channel**, **Send Messages**, and **Embed Links** in that channel, then run \`/t communityinfo\` again.`);
    }
    throw error;
  }
  const cleanupNote = cleanupSkipped
    ? " Discord did not allow me to remove the older panels, so they may need to be deleted manually."
    : "";
  return ephemeral(`The ${COMMUNITY_INFO_MESSAGES.length} updated Community information panels were posted in <#${channelId}>.${cleanupNote}`);
}

async function handleCommand(interaction: AnyRecord): Promise<Json> {
  if (!interaction.guild_id) return ephemeral("Moderation commands must be used inside the server.");
  const config = await guildConfig(interaction.guild_id);
  if (!config) return ephemeral("ThyToxicBot is not configured for this server yet.");
  const { subcommand, values } = optionMap(interaction);
  if (["warn", "mute", "kick", "ban"].includes(subcommand)) return await createModerationCase(interaction, config, subcommand, values);
  if (["unwarn", "unmute", "unban"].includes(subcommand)) return await reverseAction(interaction, config, subcommand, values);
  if (subcommand === "cases") return await casesCommand(interaction, config, values);
  if (subcommand === "infractions") return await infractionsCommand(interaction, config, values);
  if (subcommand === "caseinfo") return await caseInfoCommand(interaction, config, values);
  if (subcommand === "appealreply") return await appealReplyCommand(interaction, config, values);
  if (subcommand === "staffnote") return await staffNoteCommand(interaction, config, values);
  if (subcommand === "notes") return await notesCommand(interaction, config, values);
  if (subcommand === "caseupdate") return await caseUpdateCommand(interaction, config, values);
  if (subcommand === "caseclose") return await caseCloseCommand(interaction, config, values);
  if (subcommand === "casedelete") return await deleteCaseCommand(interaction, config, values);
  if (subcommand === "clearinfractions") return await clearAllInfractionsCommand(interaction, config, values);
  if (subcommand === "poll" || subcommand === "polls") return await pollsCommand();
  if (subcommand === "pollcreate") return await pollCreateCommand(interaction, config, values);
  if (subcommand === "pollclose") return await pollCloseCommand(interaction, config, values);
  if (subcommand === "pollclear") return await pollClearCommand(interaction, config, values);
  if (subcommand === "communityinfo") return await communityInfoCommand(interaction, config);
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
  const suppliedAdminSecret = req.headers.get("x-thytoxicbot-admin-secret") ?? "";
  if (req.method === "POST" && suppliedAdminSecret) {
    if (!ADMIN_SECRET || suppliedAdminSecret !== ADMIN_SECRET) return json({ error: "Unauthorized" }, 401);
    let adminRequest: AnyRecord;
    try {
      adminRequest = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (!["publish_official_links", "publish_bot_information"].includes(String(adminRequest.action ?? ""))) {
      return json({ error: "Unknown admin action" }, 400);
    }
    try {
      const result = adminRequest.action === "publish_bot_information"
        ? await publishBotInformation()
        : await publishOfficialLinks();
      return json({ ok: true, ...result });
    } catch (error) {
      console.error("admin publish failed", safeMessage(error));
      return json({ ok: false, error: safeMessage(error) }, 500);
    }
  }
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
  const componentId = String(interaction.data?.custom_id ?? "");
  if (interaction.type === 3 && componentId.startsWith("ticket_claim:")) {
    const ticketId = componentId.slice("ticket_claim:".length);
    EdgeRuntime.waitUntil(runDeferred(interaction, () => claimTicket(interaction, ticketId)));
    return json({ type: 5, data: { flags: 64 } });
  }
  if (interaction.type === 3 && componentId.startsWith("ticket_close_confirm:")) {
    const ticketId = componentId.slice("ticket_close_confirm:".length);
    EdgeRuntime.waitUntil(closeTicketAndDelete(interaction, ticketId));
    return json({ type: 5, data: { flags: 64 } });
  }
  if (interaction.type === 3 && componentId.startsWith("ticket_close_cancel:")) {
    return json({ type: 7, data: { content: "Ticket close cancelled. The ticket remains open.", components: [], allowed_mentions: { parse: [] } } });
  }
  if (interaction.type === 3 && componentId.startsWith("ticket_close:")) {
    const ticketId = componentId.slice("ticket_close:".length);
    return json({
      type: 4,
      data: {
        ...ephemeral("Close this ticket? Its conversation will be saved to the protected website record, then this Discord channel will be deleted."),
        components: [{
          type: 1,
          components: [
            { type: 2, style: 4, label: "Confirm Close", custom_id: `ticket_close_confirm:${ticketId}` },
            { type: 2, style: 2, label: "Keep Open", custom_id: `ticket_close_cancel:${ticketId}` },
          ],
        }],
      },
    });
  }
  if (interaction.type === 3) {
    const ticketType = ticketTypeFromCustomId(componentId);
    if (ticketType) {
      EdgeRuntime.waitUntil(runDeferred(interaction, () => openTicket(interaction, ticketType)));
      return json({ type: 5, data: { flags: 64 } });
    }
  }
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
