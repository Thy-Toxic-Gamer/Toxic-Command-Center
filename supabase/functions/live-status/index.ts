import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-live-status-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const discordChannelId = "1536919005099728898";
const discordMessageId = "1545562191053463573";
const discordLiveRoleId = "1537999918046777424";
const twitchUrl = "https://twitch.tv/thytoxicgamer";
const youtubeUrl = "https://www.youtube.com/@ThyToxicGamer";
const kickUrl = "https://kick.com/thytoxicgamer";
const staleAfterMs = 24 * 60 * 60 * 1000;

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
    : "The Toxic Zone is currently offline. Check back for the next stream.";

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

    const { data: previous, error: previousError } = await db
      .from("live_status")
      .select("twitch,youtube,kick,updated_at")
      .eq("id", "current")
      .maybeSingle();

    if (previousError) {
      return json({ error: "Unable to read the previous live status." }, 500);
    }

    const previousUpdatedAt = Date.parse(previous?.updated_at ?? "");
    const previousIsFresh =
      Number.isFinite(previousUpdatedAt) &&
      Date.now() - previousUpdatedAt <= staleAfterMs;
    const wasLive = previousIsFresh && Boolean(
      previous?.twitch || previous?.youtube || previous?.kick,
    );
    const isLive = body.twitch || body.youtube || body.kick;
    const shouldCreateNotice = isLive && !wasLive;

    const token = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
    if (!token) {
      return json({ error: "Discord status integration is not configured." }, 502);
    }

    try {
      await updatePermanentDiscordStatus(
        token,
        body.twitch,
        body.youtube,
        body.kick,
        body,
      );

      if (shouldCreateNotice) {
        await createDiscordLiveNotice(
          token,
          body.twitch,
          body.youtube,
          body.kick,
          body,
        );
      }
    } catch (error) {
      console.error(error);
      return json(
        {
          error: error instanceof Error
            ? error.message
            : "Unable to synchronize Discord live status.",
        },
        502,
      );
    }

    const { data, error } = await db
      .from("live_status")
      .upsert({
        id: "current",
        twitch: body.twitch,
        youtube: body.youtube,
        kick: body.kick,
        updated_at: new Date().toISOString(),
      })
      .select("twitch,youtube,kick,updated_at")
      .single();

    if (error) return json({ error: "Unable to update live status." }, 500);

    return json({ ...data, notice_created: shouldCreateNotice });
  }

  return json({ error: "Method not allowed." }, 405);
});
