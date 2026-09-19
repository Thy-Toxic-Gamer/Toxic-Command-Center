import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const TWITCH_CLIENT_ID = "ht2kbpz12tpv060f2259jn9recng0x";
const ALLOWED_ORIGIN = "https://thy-toxic-gamer.github.io";
const PENDING_CHANNEL_ID = "1542688040353275994";
const AWAITING_PAYMENT_CHANNEL_ID = "1542727353602543616";
const APPROVED_CHANNEL_ID = "1542690394255532052";
const LOG_CHANNEL_ID = "1543750250097938562";
const GAME_PAGE = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/games/";
const PAYPAL_CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID") ?? "";
const PAYPAL_CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET") ?? "";
const PAYPAL_ENVIRONMENT = (Deno.env.get("PAYPAL_ENVIRONMENT") ?? "sandbox").toLowerCase();
const PAYPAL_BASE = PAYPAL_ENVIRONMENT === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
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
    .select("id,request_number,game_id,game_title,game_system,game_cover_url,status,scheduled_for")
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
      gameId: active.game_id,
      gameTitle: active.game_title,
      gameSystem: active.game_system,
      coverUrl: active.game_cover_url,
      status: active.status,
      scheduledFor: active.scheduled_for,
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
        ...(requestRow.game_cover_url ? { image: { url: requestRow.game_cover_url } } : {}),
        footer: { text: requestCode },
        timestamp: requestRow.created_at,
      }],
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.id) throw new Error(`Discord rejected the request record (${response.status}).`);
  return { channelId, messageId: String(data.id) };
}

function eventLine(event: any) {
  const labels: Record<string, string> = {
    request_submitted: "Request submitted",
    owner_request_approved: "Owner request submitted and approved",
    paypal_order_created: "PayPal checkout opened",
    payment_completed: "PayPal payment verified",
    game_change_requested: "Viewer requested a game change",
    game_change_applied: "Game change applied",
    game_change_denied: "Game change denied",
  };
  const type = String(event.event_type || "");
  const label = labels[type] || (type.startsWith("status_") ? `Status changed to ${type.slice(7).replaceAll("_", " ")}` : type.replaceAll("_", " "));
  const details = event.details || {};
  const extras = [details.actor_name, details.note, details.new_game_title ? `New game: ${details.new_game_title}` : null, details.scheduled_for ? `Scheduled: <t:${Math.floor(new Date(details.scheduled_for).getTime() / 1000)}:F>` : null].filter(Boolean);
  return `• <t:${Math.floor(new Date(event.created_at).getTime() / 1000)}:f> — **${label}**${extras.length ? ` · ${extras.join(" · ")}` : ""}`;
}

function timelineEmbeds(row: any, events: any[]) {
  const code = `GR-${String(row.request_number).padStart(6, "0")}`;
  const summary: any = {
    title: `Game Request History · ${code}`,
    color: row.status === "completed" ? 0x22c55e : row.status === "denied" ? 0xef4444 : row.status === "cancelled" ? 0x94a3b8 : 0xb5ff18,
    fields: [
      { name: "Current Game", value: `${row.game_title}\n${row.game_system}`, inline: false },
      { name: "Requester", value: row.twitch_display_name, inline: true },
      { name: "Request Type", value: row.request_type, inline: true },
      { name: "Current Status", value: String(row.status).replaceAll("_", " "), inline: true },
    ],
    ...(row.game_cover_url ? { thumbnail: { url: row.game_cover_url } } : {}),
    footer: { text: "This single log is updated through the final outcome." },
    timestamp: row.updated_at || row.created_at,
  };
  if (row.scheduled_for) summary.fields.push({ name: "Scheduled For", value: `<t:${Math.floor(new Date(row.scheduled_for).getTime() / 1000)}:F>`, inline: false });
  if (row.resolution_note) summary.fields.push({ name: "Outcome Reason", value: String(row.resolution_note).slice(0, 1024), inline: false });
  const lines = events.filter((event) => event.event_type !== "discord_record_failed").map(eventLine);
  const chunks: string[] = [];
  let chunk = "";
  for (const line of lines) {
    if (chunk && chunk.length + line.length + 1 > 3900) { chunks.push(chunk); chunk = ""; }
    chunk += `${chunk ? "\n" : ""}${line}`;
  }
  if (chunk || !chunks.length) chunks.push(chunk || "No history recorded yet.");
  return [summary, ...chunks.slice(0, 9).map((description, index) => ({ title: index ? `Timeline continued ${index + 1}` : "Complete Timeline", color: 0x252b26, description }))];
}

async function syncDiscordHistoryLog(admin: any, requestRow: any) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("Discord bot connection is unavailable.");
  const [{ data: row }, { data: events }] = await Promise.all([
    admin.from("game_requests").select("*").eq("id", requestRow.id).single(),
    admin.from("game_request_events").select("event_type,details,created_at").eq("request_id", requestRow.id).order("created_at", { ascending: true }).limit(500),
  ]);
  if (!row) throw new Error("Game request history could not be loaded.");
  const payload = JSON.stringify({ allowed_mentions: { parse: [] }, embeds: timelineEmbeds(row, events || []) });
  if (row.discord_log_message_id) {
    const updated = await fetch(`https://discord.com/api/v10/channels/${LOG_CHANNEL_ID}/messages/${row.discord_log_message_id}`, {
      method: "PATCH",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: payload,
    });
    if (updated.ok) return;
    if (updated.status !== 404) throw new Error(`Discord rejected the request history update (${updated.status}).`);
  }
  const response = await fetch(`https://discord.com/api/v10/channels/${LOG_CHANNEL_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: payload,
  });
  const created = await response.json().catch(() => ({}));
  if (!response.ok || !created.id) throw new Error(`Discord rejected the request history (${response.status}).`);
  await admin.from("game_requests").update({ discord_log_message_id: String(created.id) }).eq("id", row.id);
}

function publicRequest(row: any) {
  return {
    id: row.id,
    gameId: row.game_id,
    code: `GR-${String(row.request_number).padStart(6, "0")}`,
    gameTitle: row.game_title,
    gameSystem: row.game_system,
    coverUrl: row.game_cover_url || null,
    requestType: row.request_type,
    status: row.status,
    amountDue: Number(row.amount_due),
    currency: row.payment_currency || "USD",
    paymentRequired: Boolean(row.payment_required),
    paypalStatus: row.paypal_status || null,
    paymentRequestedAt: row.payment_requested_at || null,
    paymentExpiresAt: row.payment_expires_at || null,
    scheduledFor: row.scheduled_for || null,
    viewerChangeCount: Number(row.viewer_change_count || 0),
    pendingChange: row.pending_change_game_id ? { gameId: row.pending_change_game_id, gameTitle: row.pending_change_game_title, gameSystem: row.pending_change_game_system, coverUrl: row.pending_change_cover_url || null } : null,
    createdAt: row.created_at,
  };
}

function requirePayPal() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new ApiError("PayPal checkout is not connected yet.", 503);
}

async function getPayPalAccessToken() {
  const credentials = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new ApiError("PayPal authentication failed. Please try again shortly.", 502);
  return String(body.access_token);
}

async function paypalRequest(path: string, accessToken: string, init: RequestInit) {
  const response = await fetch(`${PAYPAL_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
}

function completedCapture(order: any) {
  const captures = order?.purchase_units?.flatMap((unit: any) => unit?.payments?.captures ?? []) ?? [];
  return captures.find((capture: any) => capture.status === "COMPLETED") ?? null;
}

async function findOwnedRequest(admin: any, requestId: string, identity: TwitchIdentity) {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new ApiError("Game request not found.", 404);
  const { data, error } = await admin.from("game_requests").select("*").eq("id", requestId).eq("twitch_user_id", identity.id).maybeSingle();
  if (error || !data) throw new ApiError("Game request not found.", 404);
  return data;
}

async function myRequest(admin: any, identity: TwitchIdentity) {
  const { data, error } = await admin.from("game_requests").select("*").eq("twitch_user_id", identity.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new ApiError("Your request could not be loaded.", 500);
  return { request: data ? publicRequest(data) : null, paymentMode: PAYPAL_ENVIRONMENT };
}

async function createPayment(admin: any, identity: TwitchIdentity, body: any) {
  requirePayPal();
  const row = await findOwnedRequest(admin, String(body.requestId || ""), identity);
  if (row.is_owner || Number(row.amount_due) === 0) throw new ApiError("Owner requests do not require payment.", 409);
  if (row.paypal_status === "COMPLETED") return { request: publicRequest(row), completed: true };
  if (row.status !== "awaiting_payment") throw new ApiError("Payment is not open for this request yet.", 409);
  if (row.payment_expires_at && new Date(row.payment_expires_at).getTime() <= Date.now()) throw new ApiError("The 24-hour payment window has expired.", 409);
  if (Number(row.payment_attempts || 0) >= 5) throw new ApiError("Too many checkout attempts. Ask staff to review this request.", 429);

  const accessToken = await getPayPalAccessToken();
  if (row.paypal_order_id) {
    const existing = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(row.paypal_order_id)}`, accessToken, { method: "GET" });
    const approvalUrl = existing.body?.links?.find((link: any) => link.rel === "payer-action" || link.rel === "approve")?.href;
    if (existing.ok && approvalUrl) return { requestId: row.id, approvalUrl, reused: true };
  }

  const requestCode = `GR-${String(row.request_number).padStart(6, "0")}`;
  const response = await paypalRequest("/v2/checkout/orders", accessToken, {
    method: "POST",
    headers: { "PayPal-Request-Id": `game-request-${row.id}-${Number(row.payment_attempts || 0) + 1}`, Prefer: "return=representation" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: row.id,
        custom_id: `game-request:${row.id}`,
        description: `${requestCode} · ${row.game_title} · ${row.request_type}`.slice(0, 127),
        amount: { currency_code: "USD", value: Number(row.amount_due).toFixed(2) },
      }],
      payment_source: { paypal: { experience_context: {
        brand_name: "ThyToxicGamer Game Requests",
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
        return_url: `${GAME_PAGE}?paypal=approved&request=${encodeURIComponent(row.id)}`,
        cancel_url: `${GAME_PAGE}?paypal=cancelled&request=${encodeURIComponent(row.id)}`,
      } } },
    }),
  });
  const approvalUrl = response.body?.links?.find((link: any) => link.rel === "payer-action" || link.rel === "approve")?.href;
  if (!response.ok || !response.body?.id || !approvalUrl) throw new ApiError("PayPal could not open checkout. Please try again.", 502);
  await admin.from("game_requests").update({
    paypal_order_id: response.body.id,
    paypal_status: response.body.status || "CREATED",
    payment_attempts: Number(row.payment_attempts || 0) + 1,
    payment_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  await admin.from("game_request_events").insert({ request_id: row.id, event_type: "paypal_order_created", actor_twitch_user_id: identity.id, details: { order_id: response.body.id, mode: PAYPAL_ENVIRONMENT } });
  await syncDiscordHistoryLog(admin, row).catch((error) => console.error("Game request history update failed", error));
  return { requestId: row.id, approvalUrl };
}

async function patchDiscordRecord(row: any) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token || !row.discord_channel_id || !row.discord_message_id) return;
  const fields: any[] = [
    { name: "Game", value: `${row.game_title}\n${row.game_system}`, inline: false },
    { name: "Requester", value: row.twitch_display_name, inline: true },
    { name: "Request Type", value: row.request_type, inline: true },
    { name: "Amount", value: row.is_owner ? "$0.00 · Owner" : `$${Number(row.amount_due).toFixed(2)}`, inline: true },
    { name: "Status", value: String(row.status).replaceAll("_", " "), inline: true },
  ];
  if (row.pending_change_game_id) fields.push({ name: "Requested Game Change", value: `${row.pending_change_game_title}\n${row.pending_change_game_system}\nWaiting for staff review`, inline: false });
  const response = await fetch(`https://discord.com/api/v10/channels/${row.discord_channel_id}/messages/${row.discord_message_id}`, {
    method: "PATCH",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [{ title: "Game Request", color: row.pending_change_game_id ? 0xffc107 : 0xb5ff18, fields, ...(row.game_cover_url ? { image: { url: row.game_cover_url } } : {}), footer: { text: `GR-${String(row.request_number).padStart(6, "0")}` }, timestamp: row.updated_at || row.created_at }] }),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Discord rejected the game request update (${response.status}).`);
}

async function requestGameChange(admin: any, identity: TwitchIdentity, isOwner: boolean, body: any) {
  const row = await findOwnedRequest(admin, String(body.requestId || ""), identity);
  if (!ACTIVE_STATUSES.includes(row.status)) throw new ApiError("Archived requests cannot be changed.", 409);
  if (!isOwner && Number(row.viewer_change_count || 0) >= 1) throw new ApiError("You have already used the one game change allowed for this request.", 409);
  if (!isOwner && row.pending_change_game_id) throw new ApiError("Your game change is already waiting for staff review.", 409);
  const gameId = String(body.gameId || "").trim();
  const { data: game, error } = await admin.from("game_catalog").select("id,title,system,cover_url,requestable").eq("id", gameId).maybeSingle();
  if (error) throw new ApiError("The replacement game could not be checked.", 500);
  if (!game || !game.requestable) throw new ApiError("That replacement game is not available for requests.", 409);
  if (game.id === row.game_id) throw new ApiError("Choose a different game.", 409);
  const now = new Date().toISOString();
  if (isOwner) {
    const { data: updated, error: updateError } = await admin.from("game_requests").update({
      game_id: game.id, game_title: game.title, game_system: game.system, game_cover_url: game.cover_url,
      pending_change_game_id: null, pending_change_game_title: null, pending_change_game_system: null, pending_change_cover_url: null, pending_change_requested_at: null,
      ...(row.paypal_status === "COMPLETED" ? {} : { paypal_order_id: null, paypal_status: null, payment_error: null, payment_attempts: 0 }),
      updated_at: now,
    }).eq("id", row.id).select("*").single();
    if (updateError || !updated) throw new ApiError("The game could not be changed.", 500);
    await admin.from("game_request_events").insert({ request_id: row.id, event_type: "game_change_applied", actor_twitch_user_id: identity.id, details: { actor_name: identity.displayName, actor_role: "owner", previous_game_title: row.game_title, new_game_title: game.title, source: "owner" } });
    await patchDiscordRecord(updated).catch((discordError) => console.error("Discord game change update failed", discordError));
    await syncDiscordHistoryLog(admin, updated).catch((discordError) => console.error("Discord request history update failed", discordError));
    return { request: publicRequest(updated), applied: true };
  }
  const { data: updated, error: updateError } = await admin.from("game_requests").update({
    viewer_change_count: 1,
    pending_change_game_id: game.id,
    pending_change_game_title: game.title,
    pending_change_game_system: game.system,
    pending_change_cover_url: game.cover_url,
    pending_change_requested_at: now,
    updated_at: now,
  }).eq("id", row.id).eq("viewer_change_count", 0).select("*").maybeSingle();
  if (updateError || !updated) throw new ApiError("Your one game change has already been used.", 409);
  await admin.from("game_request_events").insert({ request_id: row.id, event_type: "game_change_requested", actor_twitch_user_id: identity.id, details: { actor_name: identity.displayName, previous_game_title: row.game_title, new_game_title: game.title } });
  await patchDiscordRecord(updated).catch((discordError) => console.error("Discord game change request update failed", discordError));
  await syncDiscordHistoryLog(admin, updated).catch((discordError) => console.error("Discord request history update failed", discordError));
  return { request: publicRequest(updated), applied: false };
}

async function movePaidRequestToApproved(admin: any, row: any) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) return;
  const requestCode = `GR-${String(row.request_number).padStart(6, "0")}`;
  const payload = {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: "Game Request Approved · Payment Verified",
      color: 0xb5ff18,
      fields: [
        { name: "Game", value: `${row.game_title}\n${row.game_system}`, inline: false },
        { name: "Requester", value: row.twitch_display_name, inline: true },
        { name: "Request Type", value: row.request_type, inline: true },
        { name: "Verified Amount", value: `$${Number(row.amount_due).toFixed(2)} USD`, inline: true },
        { name: "Status", value: "Approved", inline: true },
      ],
      ...(row.game_cover_url ? { image: { url: row.game_cover_url } } : {}),
      footer: { text: `${requestCode} · PayPal verified` },
      timestamp: new Date().toISOString(),
    }],
  };
  const response = await fetch(`https://discord.com/api/v10/channels/${APPROVED_CHANNEL_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const created = await response.json().catch(() => ({}));
  if (!response.ok || !created.id) throw new Error(`Discord returned ${response.status}.`);
  const oldChannel = row.discord_channel_id;
  const oldMessage = row.discord_message_id;
  await admin.from("game_requests").update({ discord_channel_id: APPROVED_CHANNEL_ID, discord_message_id: String(created.id), discord_last_error: null }).eq("id", row.id);
  if (oldChannel && oldMessage) await fetch(`https://discord.com/api/v10/channels/${oldChannel}/messages/${oldMessage}`, { method: "DELETE", headers: { Authorization: `Bot ${token}` } }).catch(() => null);
  await syncDiscordHistoryLog(admin, { ...row, status: "approved" }).catch(() => null);
}

async function completeGamePayment(admin: any, row: any, capture: any) {
  const amount = Number(capture?.amount?.value);
  const currency = String(capture?.amount?.currency_code || "");
  if (!Number.isFinite(amount) || amount !== Number(row.amount_due) || currency !== "USD") {
    await admin.from("game_requests").update({ payment_error: "PayPal amount or currency mismatch.", paypal_status: "REVIEW_REQUIRED" }).eq("id", row.id);
    throw new ApiError("The payment amount needs staff review. Your request was not automatically approved.", 409);
  }
  if (row.paypal_status === "COMPLETED") return row;
  const now = new Date().toISOString();
  const { data: updated, error } = await admin.from("game_requests").update({
    status: "approved",
    payment_required: false,
    paypal_status: "COMPLETED",
    paypal_capture_id: capture.id,
    payment_completed_at: now,
    payment_expires_at: null,
    payment_error: null,
    updated_at: now,
  }).eq("id", row.id).eq("status", "awaiting_payment").select("*").maybeSingle();
  if (error) throw new ApiError("PayPal confirmed payment, but the request needs staff review.", 500);
  if (!updated) {
    const { data: current, error: currentError } = await admin.from("game_requests").select("*").eq("id", row.id).maybeSingle();
    if (currentError || !current) throw new ApiError("PayPal confirmed payment, but the request needs staff review.", 500);
    return current;
  }
  await admin.from("game_request_events").insert({ request_id: row.id, event_type: "payment_completed", actor_twitch_user_id: row.twitch_user_id, details: { capture_id: capture.id, amount, currency } });
  try { await movePaidRequestToApproved(admin, updated); }
  catch (discordError) {
    const message = discordError instanceof Error ? discordError.message : "Discord routing failed.";
    await admin.from("game_requests").update({ discord_last_error: message.slice(0, 1000) }).eq("id", row.id);
  }
  return updated;
}

async function capturePayment(admin: any, identity: TwitchIdentity, body: any) {
  requirePayPal();
  const orderId = String(body.orderId || "");
  const row = await findOwnedRequest(admin, String(body.requestId || ""), identity);
  if (!orderId || row.paypal_order_id !== orderId) throw new ApiError("The PayPal order does not match this request.", 403);
  if (row.paypal_status === "COMPLETED") return { request: publicRequest(row) };
  if (row.payment_expires_at && new Date(row.payment_expires_at).getTime() <= Date.now()) throw new ApiError("The 24-hour payment window has expired.", 409);
  const accessToken = await getPayPalAccessToken();
  let response = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, accessToken, {
    method: "POST",
    headers: { "PayPal-Request-Id": `capture-game-request-${row.id}` },
    body: "{}",
  });
  if (!response.ok && response.status === 422) response = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, accessToken, { method: "GET" });
  const capture = completedCapture(response.body);
  if (!response.ok || !capture) throw new ApiError("PayPal has not confirmed the payment yet. You can safely try confirmation again.", 409);
  return { request: publicRequest(await completeGamePayment(admin, row, capture)) };
}

async function createRequest(admin: any, identity: TwitchIdentity, isOwner: boolean, body: any) {
  const gameId = String(body.gameId ?? "").trim();
  const plan = String(body.plan ?? "").trim();
  if (!gameId || !(plan in PRICE_BY_PLAN)) throw new ApiError("Choose a game and request type.");

  const [availability, { data: game, error: gameError }] = await Promise.all([
    requestAvailability(admin),
    admin.from("game_catalog").select("id,title,system,cover_url,requestable").eq("id", gameId).maybeSingle(),
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
    game_cover_url: game.cover_url || null,
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
    await syncDiscordHistoryLog(admin, created).catch((logError) => console.error("Game request Discord history failed", logError));
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
      return json({ ok: !error, catalogCount: count ?? 0, paymentMode: PAYPAL_ENVIRONMENT, paypalConfigured: Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET) });
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
    if (action === "my_request") return json(await myRequest(admin, identity));
    if (action === "create_payment") return json(await createPayment(admin, identity, body));
    if (action === "capture_payment") return json(await capturePayment(admin, identity, body));
    if (action === "request_game_change") return json(await requestGameChange(admin, identity, isOwner, body));
    if (action === "submit") return json(await createRequest(admin, identity, isOwner, body), 201);
    throw new ApiError("Unknown action.", 404);
  } catch (error) {
    console.error("Game Requests API error", error);
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError ? error.message : "The Game Request service could not complete this request.";
    return json({ error: message }, status);
  }
});
