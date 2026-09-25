import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-live-status-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const discordChannelId = "1536919057939439626";
const discordMessageId = "1545562191053463573";
const discordLiveRoleId = "1537999918046777424";
const twitchUrl = "https://twitch.tv/thytoxicgamer";
const twitchVideosUrl = "https://www.twitch.tv/thytoxicgamer/videos";
const youtubeUrl = "https://www.youtube.com/@ThyToxicGamer";
const youtubeStreamsUrl = "https://www.youtube.com/@ThyToxicGamer/streams";
const kickUrl = "https://kick.com/thytoxicgamer";
const staleAfterMs = 5 * 60 * 1000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function textValue(value: unknown, fallback: string, max = 500) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

function canonicalYouTubeVodUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";

  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let videoId = "";

    if (
      (host === "youtube.com" || host === "m.youtube.com") &&
      url.pathname === "/watch"
    ) {
      videoId = url.searchParams.get("v") ?? "";
    } else if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
    }

    return /^[A-Za-z0-9_-]{6,20}$/.test(videoId)
      ? `https://www.youtube.com/watch?v=${videoId}`
      : "";
  } catch {
    return "";
  }
}

function buildOfflineDiscordContent(youtubeVodUrl: string) {
  if (youtubeVodUrl) {
    return [
      "Sorry you missed the stream, but **ThyToxicGamer is offline now.**",
      "",
      "▶ **Watch the YouTube VOD:**",
      youtubeVodUrl,
      "",
      "**More replays:**",
      `Twitch: <${twitchVideosUrl}>`,
      `Kick: <${kickUrl}>`,
    ].join("\n");
  }

  return [
    "Sorry you missed the stream, but **ThyToxicGamer is offline now.**",
    "Click one of these links to watch recent streams:",
    "",
    `YouTube: <${youtubeStreamsUrl}>`,
    `Twitch: <${twitchVideosUrl}>`,
    `Kick: <${kickUrl}>`,
  ].join("\n");
}

function platformStatus(name: string, url: string, isLive: boolean) {
  return `[${isLive ? "🟢 LIVE" : "⚫ OFFLINE"} — Open ${name}](${url})`;
}

function primaryUrl(twitch: boolean, youtube: boolean, kick: boolean) {
  if (twitch) return twitchUrl;
  if (youtube) return youtubeUrl;
  if (kick) return kickUrl;
  return twitchUrl;
}

function buildDiscordEmbed(
  twitch: boolean,
  youtube: boolean,
  kick: boolean,
  body: Record<string, unknown>,
) {
  const anyLive = twitch || youtube || kick;
  const title = anyLive
    ? textValue(body.title, "ThyToxicGamer is LIVE!", 256)
    : "ThyToxicGamer is OFFLINE";
  const announcement = textValue(
    body.announcement,
    "The Toxic Zone is live! Choose your platform and join the stream.",
    1000,
  );
  const game = textValue(body.game, "", 256);
  const description = anyLive
    ? announcement + (game ? `\n\n**Currently Playing:** ${game}` : "")
    : "Sorry you missed the stream, but ThyToxicGamer is offline now. Use the links below to watch recent broadcasts.";

  const embed: Record<string, unknown> = {
    title,
    url: primaryUrl(twitch, youtube, kick),
    description,
    color: anyLive ? 3800852 : 2829617,
    fields: [
      {
        name: "Twitch",
        value: platformStatus("Twitch", twitchUrl, twitch),
        inline: true,
      },
      {
        name: "YouTube",
        value: platformStatus("YouTube", youtubeUrl, youtube),
        inline: true,
      },
      {
        name: "Kick",
        value: platformStatus("Kick", kickUrl, kick),
        inline: true,
      },
    ],
    footer: { text: "ThyToxicGamer • The Toxic One" },
    timestamp: new Date().toISOString(),
  };

  if (twitch) {
    embed.image = {
      url:
        "https://static-cdn.jtvnw.net/previews-ttv/" +
        `live_user_thytoxicgamer-1280x720.jpg?cache=${Date.now()}`,
    };
  }

  return embed;
}

function discordHeaders(token: string) {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  };
}

async function updatePermanentDiscordStatus(
  token: string,
  twitch: boolean,
  youtube: boolean,
  kick: boolean,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${discordChannelId}/messages/${discordMessageId}`,
    {
      method: "PATCH",
      headers: discordHeaders(token),
      body: JSON.stringify({
        content: "",
        allowed_mentions: { parse: [] },
        embeds: [buildDiscordEmbed(twitch, youtube, kick, body)],
      }),
    },
  );

  if (!response.ok) {
    console.error("Discord permanent status update failed with HTTP", response.status);
    throw new Error("Unable to update the permanent Discord status message.");
  }
}

async function createDiscordLiveNotice(
  token: string,
  twitch: boolean,
  youtube: boolean,
  kick: boolean,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${discordChannelId}/messages`,
    {
      method: "POST",
      headers: discordHeaders(token),
      body: JSON.stringify({
        content: `<@&${discordLiveRoleId}>`,
        allowed_mentions: { parse: [], roles: [discordLiveRoleId] },
        embeds: [buildDiscordEmbed(twitch, youtube, kick, body)],
      }),
    },
  );

  if (!response.ok) {
    console.error("Discord live notice failed with HTTP", response.status);
    throw new Error("Unable to create the Discord live notification.");
  }

  const message = await response.json();
  const messageId = String(message.id ?? "");
  if (!messageId) {
    throw new Error("Discord created the live notice without returning its message ID.");
  }

  return messageId;
}

async function editDiscordLiveNotice(
  token: string,
  messageId: string,
  twitch: boolean,
  youtube: boolean,
  kick: boolean,
  body: Record<string, unknown>,
) {
  const isLive = twitch || youtube || kick;
  const youtubeVodUrl = canonicalYouTubeVodUrl(body.youtubeVodUrl);
  const message = isLive
    ? {
      content: "",
      allowed_mentions: { parse: [] },
      embeds: [buildDiscordEmbed(twitch, youtube, kick, body)],
    }
    : {
      content: buildOfflineDiscordContent(youtubeVodUrl),
      allowed_mentions: { parse: [] },
      embeds: [],
    };

  const response = await fetch(
    `https://discord.com/api/v10/channels/${discordChannelId}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: discordHeaders(token),
      body: JSON.stringify(message),
    },
  );

  if (!response.ok) {
    console.error(
      "Discord live notice edit failed with HTTP",
      response.status,
      messageId,
    );
    throw new Error("Unable to update the Discord live notification.");
  }
}

async function findRecentLiveNoticeIds(token: string) {
  const matchingMessageIds: string[] = [];
  let before = "";

  // Discord returns at most 100 messages per request. Scan up to 500 so a
  // manual sweep can repair older stuck notices created before ID tracking.
  for (let page = 0; page < 5; page++) {
    const beforeQuery = before
      ? `&before=${encodeURIComponent(before)}`
      : "";
    const response = await fetch(
      `https://discord.com/api/v10/channels/${discordChannelId}/messages?limit=100${beforeQuery}`,
      { headers: discordHeaders(token) },
    );

    if (!response.ok) {
      console.error(
        "Discord live notice lookup failed with HTTP",
        response.status,
        "page",
        page + 1,
      );
      return [...new Set(matchingMessageIds)];
    }

    const messages = await response.json();
    if (!Array.isArray(messages) || messages.length === 0) break;

    for (const message of messages as Record<string, unknown>[]) {
      const embeds = Array.isArray(message.embeds) ? message.embeds : [];
      const matchesLiveNotice = embeds.some((embed: Record<string, unknown>) => {
        const footer = embed.footer as Record<string, unknown> | undefined;
        return Number(embed.color) === 3800852 &&
          String(footer?.text ?? "") === "ThyToxicGamer • The Toxic One";
      });

      if (matchesLiveNotice) {
        const messageId = String(message.id ?? "");
        if (messageId) matchingMessageIds.push(messageId);
      }
    }

    if (messages.length < 100) break;
    before = String(messages[messages.length - 1]?.id ?? "");
    if (!before) break;
  }

  return [...new Set(matchingMessageIds)];
}

async function diagnoseDiscordChannel(token: string) {
  const headers = discordHeaders(token);
  const channelResponse = await fetch(
    `https://discord.com/api/v10/channels/${discordChannelId}`,
    { headers },
  );

  if (!channelResponse.ok) {
    return {
      reachable: false,
      channel_http_status: channelResponse.status,
      can_view: false,
      can_send: false,
      can_embed: false,
      can_mention_roles: false,
    };
  }

  const channel = await channelResponse.json();
  const guildId = String(channel.guild_id ?? "");
  if (!guildId) {
    return {
      reachable: true,
      channel_name: String(channel.name ?? ""),
      channel_type: channel.type,
      can_view: true,
      can_send: false,
      can_embed: false,
      can_mention_roles: false,
      error: "The configured Discord destination is not a guild channel.",
    };
  }

  const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
    headers,
  });
  if (!userResponse.ok) {
    return {
      reachable: true,
      channel_name: String(channel.name ?? ""),
      channel_type: channel.type,
      can_view: true,
      can_send: false,
      can_embed: false,
      can_mention_roles: false,
      error: "Unable to identify the Discord bot account.",
      user_http_status: userResponse.status,
    };
  }

  const user = await userResponse.json();
  const [memberResponse, rolesResponse] = await Promise.all([
    fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${String(user.id)}`,
      { headers },
    ),
    fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers }),
  ]);

  if (!userResponse.ok || !memberResponse.ok || !rolesResponse.ok) {
    return {
      reachable: true,
      channel_name: String(channel.name ?? ""),
      channel_type: channel.type,
      can_view: true,
      can_send: false,
      can_embed: false,
      can_mention_roles: false,
      error: "Unable to calculate the bot permissions for this channel.",
      member_http_status: memberResponse.status,
      roles_http_status: rolesResponse.status,
    };
  }

  const member = await memberResponse.json();
  const roles = await rolesResponse.json();
  const memberRoleIds = new Set<string>([
    guildId,
    ...((member.roles ?? []).map((value: unknown) => String(value))),
  ]);

  let permissions = 0n;
  for (const role of roles) {
    if (memberRoleIds.has(String(role.id))) {
      permissions |= BigInt(String(role.permissions ?? "0"));
    }
  }

  const administrator = 1n << 3n;
  if ((permissions & administrator) !== administrator) {
    const overwrites = Array.isArray(channel.permission_overwrites)
      ? channel.permission_overwrites
      : [];
    const everyone = overwrites.find(
      (overwrite: Record<string, unknown>) =>
        String(overwrite.id) === guildId && Number(overwrite.type) === 0,
    );
    if (everyone) {
      permissions &= ~BigInt(String(everyone.deny ?? "0"));
      permissions |= BigInt(String(everyone.allow ?? "0"));
    }

    let roleDeny = 0n;
    let roleAllow = 0n;
    for (const overwrite of overwrites) {
      if (
        Number(overwrite.type) === 0 &&
        memberRoleIds.has(String(overwrite.id)) &&
        String(overwrite.id) !== guildId
      ) {
        roleDeny |= BigInt(String(overwrite.deny ?? "0"));
        roleAllow |= BigInt(String(overwrite.allow ?? "0"));
      }
    }
    permissions &= ~roleDeny;
    permissions |= roleAllow;

    const memberOverwrite = overwrites.find(
      (overwrite: Record<string, unknown>) =>
        String(overwrite.id) === String(user.id) && Number(overwrite.type) === 1,
    );
    if (memberOverwrite) {
      permissions &= ~BigInt(String(memberOverwrite.deny ?? "0"));
      permissions |= BigInt(String(memberOverwrite.allow ?? "0"));
    }
  }

  const allowed = (bit: bigint) =>
    (permissions & administrator) === administrator ||
    (permissions & bit) === bit;
  const liveRole = roles.find(
    (role: Record<string, unknown>) => String(role.id) === discordLiveRoleId,
  );
  const liveRoleMentionable = Boolean(liveRole?.mentionable);

  return {
    reachable: true,
    channel_name: String(channel.name ?? ""),
    channel_type: channel.type,
    can_view: allowed(1n << 10n),
    can_send: allowed(1n << 11n),
    can_embed: allowed(1n << 14n),
    can_mention_roles: allowed(1n << 17n) || liveRoleMentionable,
    live_role_mentionable: liveRoleMentionable,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, serviceRoleKey);

  if (req.method === "GET") {
    const { data, error } = await db
      .from("live_status")
      .select("twitch,youtube,kick,updated_at")
      .eq("id", "current")
      .single();

    if (error) return json({ error: "Unable to read live status." }, 500);

    const updatedAt = Date.parse(data.updated_at);
    const stale =
      (data.twitch || data.youtube || data.kick) &&
      (!Number.isFinite(updatedAt) || Date.now() - updatedAt > staleAfterMs);

    return json(stale
      ? {
        twitch: false,
        youtube: false,
        kick: false,
        updated_at: data.updated_at,
        stale: true,
      }
      : { ...data, stale: false });
  }

  if (req.method === "POST") {
    const expectedSecret = Deno.env.get("LIVE_STATUS_SECRET") ?? "";
    const suppliedSecret = req.headers.get("x-live-status-secret") ?? "";

    if (!expectedSecret || suppliedSecret !== expectedSecret) {
      return json({ error: "Unauthorized." }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }

    if (body.diagnose_discord === true) {
      const token = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
      if (!token) {
        return json({ error: "Discord status integration is not configured." }, 502);
      }

      return json({
        discord_channel_id: discordChannelId,
        ...(await diagnoseDiscordChannel(token)),
      });
    }

    if (
      typeof body.twitch !== "boolean" ||
      typeof body.youtube !== "boolean" ||
      typeof body.kick !== "boolean"
    ) {
      return json(
        { error: "twitch, youtube, and kick must be booleans." },
        400,
      );
    }

    const suppliedYoutubeVodUrl = canonicalYouTubeVodUrl(body.youtubeVodUrl);

    const { data: previousStatus, error: previousStatusError } = await db
      .from("live_status")
      .select("twitch,youtube,kick,updated_at,discord_message_id,youtube_vod_url")
      .eq("id", "current")
      .maybeSingle();

    if (previousStatusError) {
      return json({ error: "Unable to read the previous live status." }, 500);
    }

    const previousMessageId = String(previousStatus?.discord_message_id ?? "");
    const isLive = body.twitch || body.youtube || body.kick;
    const previousWasLive = Boolean(
      previousStatus?.twitch || previousStatus?.youtube || previousStatus?.kick,
    );
    const previousUpdatedAt = Date.parse(previousStatus?.updated_at ?? "");
    const previousIsFresh =
      Number.isFinite(previousUpdatedAt) &&
      Date.now() - previousUpdatedAt <= staleAfterMs;
    const startsNewSession = isLive && (!previousWasLive || !previousIsFresh);
    const previousYoutubeVodUrl = canonicalYouTubeVodUrl(
      previousStatus?.youtube_vod_url,
    );
    const youtubeVodUrl = suppliedYoutubeVodUrl ||
      (startsNewSession ? "" : previousYoutubeVodUrl);
    const discordBody = { ...body, youtubeVodUrl };
    const claimedAt = new Date().toISOString();
    const statusPayload = {
      twitch: body.twitch,
      youtube: body.youtube,
      kick: body.kick,
      youtube_vod_url: youtubeVodUrl || null,
      updated_at: claimedAt,
    };

    // Atomically claim a new live transition. Only the request that changes
    // the row from offline (or stale) to live is allowed to ping Discord.
    let claimedStatus: Record<string, unknown> | null = null;

    if (isLive) {
      const { data: offlineClaim, error: offlineClaimError } = await db
        .from("live_status")
        .update(statusPayload)
        .eq("id", "current")
        .eq("twitch", false)
        .eq("youtube", false)
        .eq("kick", false)
        .select("twitch,youtube,kick,updated_at,discord_message_id,youtube_vod_url")
        .maybeSingle();

      if (offlineClaimError) {
        return json({ error: "Unable to claim the live transition." }, 500);
      }

      claimedStatus = offlineClaim;

      if (!claimedStatus) {
        const staleCutoff = new Date(Date.now() - staleAfterMs).toISOString();
        const { data: staleClaim, error: staleClaimError } = await db
          .from("live_status")
          .update(statusPayload)
          .eq("id", "current")
          .lt("updated_at", staleCutoff)
          .select("twitch,youtube,kick,updated_at,discord_message_id,youtube_vod_url")
          .maybeSingle();

        if (staleClaimError) {
          return json({ error: "Unable to claim the stale live transition." }, 500);
        }

        claimedStatus = staleClaim;
      }
    }

    const shouldCreateNotice = isLive && Boolean(claimedStatus);
    const token = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
    if (!token) {
      return json({ error: "Discord status integration is not configured." }, 502);
    }

    let noticeCreated = false;
    let noticeMessageId = "";
    let noticeError = "";

    if (shouldCreateNotice) {
      try {
        noticeMessageId = await createDiscordLiveNotice(
          token,
          body.twitch,
          body.youtube,
          body.kick,
          discordBody,
        );
        noticeCreated = true;

        const { error: storeMessageError } = await db
          .from("live_status")
          .update({ discord_message_id: noticeMessageId })
          .eq("id", "current")
          .eq("updated_at", claimedAt);

        if (storeMessageError) {
          console.error("Unable to store the Discord live message ID.");
        }
      } catch (error) {
        console.error(error);
        noticeError = error instanceof Error
          ? error.message
          : "Unable to create the Discord live notification.";
      }
    }

    if (shouldCreateNotice && !noticeCreated) {
      const { error: releaseError } = await db
        .from("live_status")
        .update({
          twitch: false,
          youtube: false,
          kick: false,
          discord_message_id: null,
          youtube_vod_url: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", "current")
        .eq("updated_at", claimedAt);

      if (releaseError) {
        console.error("Unable to release failed live-notice claim.");
      }

      return json(
        {
          error: noticeError || "Unable to create the Discord live notification.",
          retryable: true,
        },
        502,
      );
    }

    let data = claimedStatus;

    if (!data) {
      const { data: savedStatus, error: saveError } = await db
        .from("live_status")
        .upsert({
          id: "current",
          ...statusPayload,
        })
        .select("twitch,youtube,kick,updated_at,discord_message_id,youtube_vod_url")
        .single();

      if (saveError) {
        return json({ error: "Unable to update live status." }, 500);
      }

      data = savedStatus;
    }

    let activeMessageId = noticeMessageId || previousMessageId;
    let discordMessageUpdated = false;
    let repairedMessageCount = 0;

    try {
      if (isLive && activeMessageId && !noticeCreated) {
        await editDiscordLiveNotice(
          token,
          activeMessageId,
          body.twitch,
          body.youtube,
          body.kick,
          discordBody,
        );
        discordMessageUpdated = true;
      }

      if (!isLive) {
        let messageIds = activeMessageId
          ? [activeMessageId]
          : await findRecentLiveNoticeIds(token);

        messageIds = [...new Set(messageIds)];

        for (const messageId of messageIds) {
          await editDiscordLiveNotice(
            token,
            messageId,
            false,
            false,
            false,
            discordBody,
          );
          repairedMessageCount++;
        }

        if (messageIds.length > 0) {
          const { error: clearMessageError } = await db
            .from("live_status")
            .update({ discord_message_id: null })
            .eq("id", "current");

          if (clearMessageError) {
            console.error("Unable to clear the completed Discord message ID.");
          }
        }

        discordMessageUpdated = repairedMessageCount > 0;
      }
    } catch (error) {
      console.error(error);
      return json(
        {
          error: error instanceof Error
            ? error.message
            : "Unable to update the Discord live notification.",
          retryable: true,
          ...data,
        },
        502,
      );
    }

    return json({
      ...data,
      notice_created: noticeCreated,
      discord_message_id: noticeMessageId || previousMessageId || undefined,
      discord_message_updated: discordMessageUpdated,
      repaired_message_count: repairedMessageCount,
    });
  }

  return json({ error: "Method not allowed." }, 405);
});
