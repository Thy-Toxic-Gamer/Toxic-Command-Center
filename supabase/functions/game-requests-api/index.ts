import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const TWITCH_CLIENT_ID = "ht2kbpz12tpv060f2259jn9recng0x";
const ALLOWED_ORIGIN = "https://thy-toxic-gamer.github.io";
const PENDING_CHANNEL_ID = "1542688040353275994";
const APPROVED_CHANNEL_ID = "1542690394255532052";
const PRICE_BY_PLAN: Record<string, number> = { Play: 5, Speed: 10, "100%": 15 };
const ACTIVE_STATUSES = ["pending", "awaiting_payment", "approved", "scheduled"];
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

type TwitchIdentity = {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string;
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
      ...CORS_HEADERS,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
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
  const url = Deno.env.get("SUPABASE_URL");
  const key = [...getKeySet("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY")][0];
  if (!url || !key) throw new Error("Database configuration is unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function validateProjectKey(request: Request) {
  const supplied = request.headers.get("apikey") ?? "";
  const allowed = getKeySet("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  if (!supplied || !allowed.has(supplied)) throw new ApiError("Invalid project key.", 401);
}

function bearer(request: Request) {
  const match = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError("Sign in with Twitch to continue.", 401);
  return match[1];
}

async function twitchIdentity(accessToken: string): Promise<TwitchIdentity> {
  const validationResponse = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  const validation = await validationResponse.json().catch(() => null);
  if (!validationResponse.ok) throw new ApiError("Your Twitch session has expired. Sign in again.", 401);
  if (validation?.client_id !== TWITCH_CLIENT_ID || typeof validation?.user_id !== "string") {
    throw new ApiError("This Twitch session is not valid for Game Requests.", 401);
  }

  const userResponse = await fetch("https://api.twitch.tv/helix/users", {
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": TWITCH_CLIENT_ID },
  });
  const body = await userResponse.json().catch(() => null);
  const user = body?.data?.[0];
  if (!userResponse.ok || !user || user.id !== validation.user_id) {
    throw new ApiError("Twitch could not verify this account.", 502);
  }
  return {
    id: user.id,
    login: user.login,
    displayName: user.display_name,
    avatarUrl: user.profile_image_url || "",
  };
}

async function ownerStatus(admin: any, twitchUserId: string) {
  const { data, error } = await admin.from("game_request_staff")
    .select("role")
    .eq("twitch_user_id", twitchUserId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new ApiError("Owner access could not be verified.", 500);
  return data?.role === "owner";
}

async function requestAvailability(admin: any) {
  const now = Date.now();
  let { data: settings, error: settingsError } = await admin.from("game_request_settings")
    .select("*").eq("id", true).single();
  if (settingsError) throw new ApiError("Game Request settings are unavailable.", 500);

  if (settings.manual_closed && settings.manual_reopens_at && new Date(settings.manual_reopens_at).getTime() <= now) {
    const reopened = await admin.from("game_request_settings").update({
      manual_closed: false,
      manual_reopens_at: null,
      requests_open: true,
      updated_at: new Date().toISOString(),
    }).eq("id", true).select("*").single();
    if (!reopened.error) settings = reopened.data;
  }

  const { data: activeRows, error: activeError } = await admin.from("game_requests")
    .select("id,request_number,game_title,status")
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: true })
    .limit(1);
  if (activeError) throw new ApiError("Active requests could not be checked.", 500);
  const active = activeRows?.[0] ?? null;
  const cooldownActive = settings.cooldown_until && new Date(settings.cooldown_until).getTime() > now;
  const manualActive = Boolean(settings.manual_closed) && (!settings.manual_reopens_at || new Date(settings.manual_reopens_at).getTime() > now);
  const open = !active && !manualActive && !cooldownActive;
  let mode = "open";
  let message = "Game requests are open.";
  let reopensAt: string | null = null;
  if (active) {
    mode = "active_request";
    message = `Requests are closed while ${active.game_title} is being processed.`;
  } else if (manualActive) {
    mode = "manual";
    message = settings.closed_message || "Game requests are temporarily closed.";
    reopensAt = settings.manual_reopens_at;
  } else if (cooldownActive) {
    mode = "cooldown";
    message = "The streamer is resting after the previous request.";
    reopensAt = settings.cooldown_until;
  }
  if (settings.requests_open !== open || settings.current_request_id !== active?.id) {
    await admin.from("game_request_settings").update({
      requests_open: open,
      current_request_id: active?.id ?? null,
      updated_at: new Date().toISOString(),
    }).eq("id", true);
  }
  return {
    open,
    mode,
    message,
    reopensAt,
    activeRequest: active ? {
      code: `GR-${String(active.request_number).padStart(6, "0")}`,
      gameTitle: active.game_title,
      status: active.status,
    } : null,
  };
}

async function sendDiscordRecord(requestRow: any) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("Discord bot connection is unavailable.");
  const channelId = requestRow.is_owner ? APPROVED_CHANNEL_ID : PENDING_CHANNEL_ID;
  const requestCode = `GR-${String(requestRow.request_number).padStart(6, "0")}`;
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{
        title: requestRow.is_owner ? "Owner Game Request Approved" : "New Game Request",
        color: requestRow.is_owner ? 0xb5ff18 : 0xff3b93,
        fields: [
          { name: "Game", value: `${requestRow.game_title}\n${requestRow.game_system}`, inline: false },
          { name: "Requester", value: requestRow.twitch_display_name, inline: true },
          { name: "Request Type", value: requestRow.request_type, inline: true },
          { name: "Amount", value: requestRow.is_owner ? "$0.00 · Owner" : `$${Number(requestRow.amount_due).toFixed(2)}`, inline: true },
          { name: "Status", value: requestRow.status.replaceAll("_", " "), inline: true },
          { name: "Catalog ID", value: requestRow.game_id, inline: true },
        ],
        footer: { text: requestCode },
        timestamp: requestRow.created_at,
      }],
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.id) throw new Error(`Discord rejected the request record (${response.status}).`);
  return { channelId, messageId: String(data.id) };
}

async function createRequest(admin: any, identity: TwitchIdentity, isOwner: boolean, body: any) {
  const gameId = String(body.gameId ?? "").trim();
  const plan = String(body.plan ?? "").trim();
  if (!gameId || !(plan in PRICE_BY_PLAN)) throw new ApiError("Choose a game and request type.");

  const [availability, { data: game, error: gameError }] = await Promise.all([
    requestAvailability(admin),
    admin.from("game_catalog").select("id,title,system,requestable").eq("id", gameId).maybeSingle(),
  ]);
  if (!availability.open) throw new ApiError(availability.message, 409);
  if (gameError) throw new ApiError("The game catalog could not be verified.", 500);
  if (!game) throw new ApiError("That game is not in the current catalog.", 404);
  if (!game.requestable) throw new ApiError("Requests are unavailable for this game.", 409);

  if (!isOwner) {
    const { data: duplicate, error: duplicateError } = await admin.from("game_requests")
      .select("id")
      .eq("twitch_user_id", identity.id)
      .eq("game_id", game.id)
      .in("status", ACTIVE_STATUSES)
      .limit(1);
    if (duplicateError) throw new ApiError("Existing requests could not be checked.", 500);
    if (duplicate?.length) throw new ApiError("You already have an active request for this game.", 409);

    const { data: recent, error: recentError } = await admin.from("game_requests")
      .select("created_at")
      .eq("twitch_user_id", identity.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (recentError) throw new ApiError("Request limits could not be checked.", 500);
    const latest = recent?.[0]?.created_at ? new Date(recent[0].created_at).getTime() : 0;
    if (latest && Date.now() - latest < 30_000) throw new ApiError("Please wait a moment before submitting another request.", 429);
  }

  const basePrice = PRICE_BY_PLAN[plan];
  const row = {
    twitch_user_id: identity.id,
    twitch_login: identity.login,
    twitch_display_name: identity.displayName,
    twitch_avatar_url: identity.avatarUrl || null,
    game_id: game.id,
    game_title: game.title,
    game_system: game.system,
    request_type: plan,
    base_price: basePrice,
    amount_due: isOwner ? 0 : basePrice,
    is_owner: isOwner,
    payment_required: !isOwner,
    status: isOwner ? "approved" : "pending",
  };
  const { data: created, error } = await admin.from("game_requests").insert(row).select("*").single();
  if (error?.code === "23505") throw new ApiError("Another request was just submitted. Game requests are now closed.", 409);
  if (error) throw new ApiError("The request could not be saved. Please try again.", 500);

  await admin.from("game_request_settings").update({
    requests_open: false,
    current_request_id: created.id,
    updated_at: new Date().toISOString(),
  }).eq("id", true);

  await admin.from("game_request_events").insert({
    request_id: created.id,
    event_type: isOwner ? "owner_request_approved" : "request_submitted",
    actor_twitch_user_id: identity.id,
    details: { request_type: plan, amount_due: created.amount_due },
  });

  let discordPosted = false;
  try {
    const record = await sendDiscordRecord(created);
    await admin.from("game_requests").update({
      discord_channel_id: record.channelId,
      discord_message_id: record.messageId,
      updated_at: new Date().toISOString(),
    }).eq("id", created.id);
    discordPosted = true;
  } catch (error) {
    console.error("Game request Discord record failed", error);
    await admin.from("game_request_events").insert({
      request_id: created.id,
      event_type: "discord_record_failed",
      details: { message: error instanceof Error ? error.message : "Discord record failed" },
    });
  }

  return {
    request: {
      code: `GR-${String(created.request_number).padStart(6, "0")}`,
      status: created.status,
      amountDue: Number(created.amount_due),
      paymentRequired: created.payment_required,
      isOwner: created.is_owner,
      gameTitle: created.game_title,
      requestType: created.request_type,
    },
    discordPosted,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    validateProjectKey(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const admin = adminClient();
    if (action === "health") {
      const { count, error } = await admin.from("game_catalog").select("id", { count: "exact", head: true });
      return json({ ok: !error, catalogCount: count ?? 0 });
    }
    if (action === "availability") return json({ availability: await requestAvailability(admin) });
    const identity = await twitchIdentity(bearer(request));
    const isOwner = await ownerStatus(admin, identity.id);
    if (action === "session") {
      return json({
        user: { id: identity.id, login: identity.login, displayName: identity.displayName, avatarUrl: identity.avatarUrl },
        isOwner,
      });
    }
    if (action === "submit") return json(await createRequest(admin, identity, isOwner, body), 201);
    throw new ApiError("Unknown action.", 404);
  } catch (error) {
    console.error("Game Requests API error", error);
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError ? error.message : "The Game Request service could not complete this request.";
    return json({ error: message }, status);
  }
});
