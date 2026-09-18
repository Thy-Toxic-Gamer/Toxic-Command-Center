import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") ?? "https://thy-toxic-gamer.github.io";
const SUPPORT_PAGE = `${SITE_ORIGIN}/Toxic-Command-Center/support/`;
const PAYPAL_CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID") ?? "";
const PAYPAL_CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET") ?? "";
const PAYPAL_WEBHOOK_ID = Deno.env.get("PAYPAL_WEBHOOK_ID") ?? "";
const PAYPAL_ENVIRONMENT = (Deno.env.get("PAYPAL_ENVIRONMENT") ?? "sandbox").toLowerCase();
const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const DONATIONS_CHANNEL_ID = Deno.env.get("DONATIONS_CHANNEL_ID") ?? "";
const STREAMERBOT_SHARED_SECRET = Deno.env.get("STREAMERBOT_SHARED_SECRET") ?? "";

const PAYPAL_BASE = PAYPAL_ENVIRONMENT === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

type Donation = {
  id: string;
  receipt_code: string;
  status: string;
  amount: number | string;
  currency: string;
  supporter_name: string | null;
  is_anonymous: boolean;
  support_message: string | null;
  allow_tts: boolean;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  discord_delivery_status: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflight(request);

  try {
    const path = normalizePath(new URL(request.url).pathname);

    if (request.method === "GET" && path === "/health") {
      return json({
        ok: true,
        service: "support-api",
        paymentMode: PAYPAL_ENVIRONMENT,
        paypalConfigured: Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET),
        webhookConfigured: Boolean(PAYPAL_WEBHOOK_ID),
        discordBotConfigured: Boolean(DISCORD_BOT_TOKEN),
        discordChannelConfigured: Boolean(DONATIONS_CHANNEL_ID),
        streamerBotConfigured: Boolean(STREAMERBOT_SHARED_SECRET),
      }, 200, request);
    }

    if (request.method === "GET" && path === "/config") {
      enforceSiteOrigin(request);
      const settings = await getSettings();
      return json({
        enabled: settings.enabled,
        minimumAmount: settings.minimum_amount,
        maximumAmount: settings.maximum_amount,
        currency: settings.currency,
        message: settings.public_message,
      }, 200, request);
    }

    if (request.method === "POST" && path === "/orders") {
      enforceSiteOrigin(request);
      await enforceRateLimit(request);
      return await createOrder(request);
    }

    const captureMatch = path.match(/^\/orders\/([A-Z0-9-]+)\/capture$/i);
    if (request.method === "POST" && captureMatch) {
      enforceSiteOrigin(request);
      return await captureOrder(request, captureMatch[1]);
    }

    if (request.method === "POST" && path === "/webhook") {
      return await handlePayPalWebhook(request);
    }

    if (request.method === "POST" && path === "/alerts/next") {
      requireStreamerBot(request);
      return await nextAlert(request);
    }

    const ackMatch = path.match(/^\/alerts\/([0-9a-f-]{36})\/ack$/i);
    if (request.method === "POST" && ackMatch) {
      requireStreamerBot(request);
      return await acknowledgeAlert(request, ackMatch[1]);
    }

    throw new ApiError("not_found", "Support endpoint not found.", 404);
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError("internal_error", "The Support Center could not complete this request.", 500);
    console.error(JSON.stringify({ code: apiError.code, message: error instanceof Error ? error.message : String(error) }));
    return json({ ok: false, code: apiError.code, message: apiError.message }, apiError.status, request);
  }
});

async function createOrder(request: Request) {
  requirePayPal();
  const settings = await getSettings();
  if (!settings.enabled) throw new ApiError("support_closed", settings.public_message, 503);

  const body = await readJson(request);
  const amount = money(body.amount);
  const minimum = Number(settings.minimum_amount);
  const maximum = Number(settings.maximum_amount);
  if (amount < minimum || amount > maximum) {
    throw new ApiError("invalid_amount", `Choose an amount between $${minimum.toFixed(2)} and $${maximum.toFixed(2)}.`);
  }

  const supporterName = cleanText(body.supporterName, 60);
  const isAnonymous = body.anonymous === true;
  const supportMessage = cleanText(body.message, 500);
  const allowTts = body.allowTts === true && Boolean(supportMessage);

  const { data: donation, error: insertError } = await db.from("donations").insert({
    amount,
    currency: "USD",
    supporter_name: supporterName || null,
    is_anonymous: isAnonymous,
    support_message: supportMessage || null,
    allow_tts: allowTts,
    status: "created",
    purge_after: retentionDate(settings.retention_months),
  }).select("*").single();
  if (insertError || !donation) throw new ApiError("record_failed", "The secure support record could not be created.", 500);

  try {
    const accessToken = await getPayPalAccessToken();
    const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": donation.id,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: donation.id,
          custom_id: donation.id,
          description: "Support ThyToxicGamer",
          amount: { currency_code: "USD", value: amount.toFixed(2) },
        }],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "ThyToxicGamer",
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              return_url: `${SUPPORT_PAGE}?paypal=approved&donation=${encodeURIComponent(donation.id)}`,
              cancel_url: `${SUPPORT_PAGE}?paypal=cancelled&donation=${encodeURIComponent(donation.id)}`,
            },
          },
        },
      }),
    });
    const order = await response.json();
    if (!response.ok) {
      console.error("PayPal create order failed", JSON.stringify(order));
      throw new ApiError("paypal_create_failed", "PayPal could not open the secure checkout.", 502);
    }

    const approvalUrl = order.links?.find((link: { rel?: string }) => link.rel === "payer-action" || link.rel === "approve")?.href;
    if (!order.id || !approvalUrl) throw new ApiError("paypal_link_missing", "PayPal did not return a checkout link.", 502);

    await db.from("donations").update({ paypal_order_id: order.id, paypal_status: order.status, updated_at: new Date().toISOString() }).eq("id", donation.id);
    await addEvent(donation.id, "order_created", "PayPal order created.", { paypalOrderId: order.id, mode: PAYPAL_ENVIRONMENT });
    return json({ ok: true, donationId: donation.id, approvalUrl }, 201, request);
  } catch (error) {
    await db.from("donations").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", donation.id);
    throw error;
  }
}

async function captureOrder(request: Request, orderId: string) {
  requirePayPal();
  const body = await readJson(request);
  const donationId = String(body.donationId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(donationId)) throw new ApiError("invalid_donation", "The support receipt reference is invalid.");

  const donation = await findDonation(donationId);
  if (donation.paypal_order_id !== orderId) throw new ApiError("order_mismatch", "The PayPal order does not match this support receipt.", 403);
  if (donation.status === "completed") return completedResponse(donation, request);
  if (["refunded", "reversed"].includes(donation.status)) throw new ApiError("payment_reversed", "This payment is no longer completed.", 409);

  const accessToken = await getPayPalAccessToken();
  let capture = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, accessToken, {
    method: "POST",
    headers: { "PayPal-Request-Id": `capture-${donation.id}` },
    body: "{}",
  });

  if (!capture.ok && capture.status === 422) {
    capture = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, accessToken, { method: "GET" });
  }
  if (!capture.ok) {
    console.error("PayPal capture failed", JSON.stringify(capture.body));
    throw new ApiError("paypal_capture_failed", "PayPal has not confirmed the payment yet. You can safely retry confirmation.", 502);
  }

  const captureRecord = extractCompletedCapture(capture.body);
  if (!captureRecord) throw new ApiError("payment_not_completed", "PayPal has not marked this payment complete yet.", 409);
  const verified = await completeDonation(donation, captureRecord);
  return completedResponse(verified, request);
}

async function completeDonation(donation: Donation, capture: Record<string, any>) {
  const capturedAmount = money(capture.amount?.value);
  const capturedCurrency = String(capture.amount?.currency_code ?? "");
  if (capturedAmount !== Number(donation.amount) || capturedCurrency !== donation.currency) {
    await addEvent(donation.id, "payment_denied", "Captured amount did not match the requested support amount.", { capturedAmount, capturedCurrency });
    throw new ApiError("amount_mismatch", "PayPal returned an unexpected payment amount. The alert was stopped for review.", 409);
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await db.from("donations").update({
    status: "completed",
    paypal_status: "COMPLETED",
    paypal_capture_id: capture.id,
    completed_at: now,
    updated_at: now,
  }).eq("id", donation.id).select("*").single();
  if (error || !updated) throw new ApiError("capture_record_failed", "Payment completed, but the receipt needs staff review.", 500);

  await addEvent(updated.id, "payment_completed", "PayPal confirmed the payment.", { paypalCaptureId: capture.id });
  await db.from("donation_alert_queue").upsert({ donation_id: updated.id, status: "pending", updated_at: now }, { onConflict: "donation_id", ignoreDuplicates: true });
  await sendDiscordDonation(updated as Donation);
  return updated as Donation;
}

async function handlePayPalWebhook(request: Request) {
  requirePayPal();
  if (!PAYPAL_WEBHOOK_ID) throw new ApiError("webhook_not_configured", "PayPal webhook verification is not configured.", 503);
  const rawBody = await request.text();
  let event: Record<string, any>;
  try { event = JSON.parse(rawBody); } catch { throw new ApiError("invalid_webhook", "Invalid webhook payload."); }

  const accessToken = await getPayPalAccessToken();
  const verification = await paypalRequest("/v1/notifications/verify-webhook-signature", accessToken, {
    method: "POST",
    body: JSON.stringify({
      transmission_id: request.headers.get("paypal-transmission-id"),
      transmission_time: request.headers.get("paypal-transmission-time"),
      cert_url: request.headers.get("paypal-cert-url"),
      auth_algo: request.headers.get("paypal-auth-algo"),
      transmission_sig: request.headers.get("paypal-transmission-sig"),
      webhook_id: PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    }),
  });
  if (!verification.ok || verification.body?.verification_status !== "SUCCESS") {
    throw new ApiError("invalid_webhook_signature", "PayPal webhook signature was rejected.", 401);
  }

  const eventId = String(event.id ?? "");
  const eventType = String(event.event_type ?? "");
  const resource = event.resource ?? {};
  if (!eventId || !eventType) throw new ApiError("invalid_webhook", "Webhook event details are missing.");

  const { error: eventInsertError } = await db.from("paypal_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
    resource_id: resource.id ?? null,
  });
  if (eventInsertError?.code === "23505") return json({ ok: true, duplicate: true }, 200, request);
  if (eventInsertError) throw new ApiError("webhook_record_failed", "Webhook receipt could not be recorded.", 500);

  try {
    const orderId = resource.supplementary_data?.related_ids?.order_id ?? null;
    const captureId = resource.supplementary_data?.related_ids?.capture_id ?? resource.id ?? null;
    let donation: Donation | null = null;
    if (orderId) {
      const result = await db.from("donations").select("*").eq("paypal_order_id", orderId).maybeSingle();
      donation = result.data as Donation | null;
    } else if (captureId) {
      const result = await db.from("donations").select("*").eq("paypal_capture_id", captureId).maybeSingle();
      donation = result.data as Donation | null;
    }

    if (!donation) {
      await finishWebhookEvent(eventId, "ignored", null);
      return json({ ok: true, ignored: true }, 200, request);
    }

    if (eventType === "PAYMENT.CAPTURE.COMPLETED" && donation.status !== "completed") {
      await completeDonation(donation, resource);
    } else if (eventType === "PAYMENT.CAPTURE.REFUNDED") {
      await updatePaymentState(donation.id, "refunded", "payment_refunded", captureId);
    } else if (eventType === "PAYMENT.CAPTURE.REVERSED") {
      await updatePaymentState(donation.id, "reversed", "payment_reversed", captureId);
    } else if (eventType === "PAYMENT.CAPTURE.DENIED") {
      await updatePaymentState(donation.id, "denied", "payment_denied", captureId);
    }

    await finishWebhookEvent(eventId, "processed", null);
    return json({ ok: true }, 200, request);
  } catch (error) {
    await finishWebhookEvent(eventId, "failed", error instanceof Error ? error.message.slice(0, 1000) : "Unknown processing error");
    throw error;
  }
}

async function nextAlert(request: Request) {
  const stale = new Date(Date.now() - 5 * 60_000).toISOString();
  await db.from("donation_alert_queue").update({ status: "pending", claimed_at: null, updated_at: new Date().toISOString() }).eq("status", "claimed").lt("claimed_at", stale).lt("attempts", 5);

  const { data: queueItem, error } = await db.from("donation_alert_queue").select("*").eq("status", "pending").lt("attempts", 5).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new ApiError("queue_failed", "The donation alert queue could not be read.", 500);
  if (!queueItem) return json({ ok: true, alert: null }, 200, request);

  const { data: claimed } = await db.from("donation_alert_queue").update({
    status: "claimed",
    attempts: queueItem.attempts + 1,
    claimed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", queueItem.id).eq("status", "pending").select("*").maybeSingle();
  if (!claimed) return json({ ok: true, alert: null }, 200, request);

  const donation = await findDonation(queueItem.donation_id);
  await addEvent(donation.id, "alert_claimed", "Streamer.bot claimed the donation alert.", { queueId: claimed.id, attempt: claimed.attempts });
  return json({
    ok: true,
    alert: {
      id: claimed.id,
      receiptCode: donation.receipt_code,
      supporterName: donation.is_anonymous ? "Anonymous" : donation.supporter_name || "Supporter",
      amount: Number(donation.amount).toFixed(2),
      currency: donation.currency,
      message: donation.support_message || "",
      allowTts: donation.allow_tts && Boolean(donation.support_message),
    },
  }, 200, request);
}

async function acknowledgeAlert(request: Request, alertId: string) {
  const body = await readJson(request);
  const delivered = body.delivered === true;
  const lastError = delivered ? null : cleanText(body.error, 1000) || "Streamer.bot reported an alert failure.";
  const { data: queueItem, error } = await db.from("donation_alert_queue").select("*").eq("id", alertId).single();
  if (error || !queueItem) throw new ApiError("alert_not_found", "Donation alert not found.", 404);
  if (queueItem.status === "delivered") return json({ ok: true, duplicate: true }, 200, request);

  const finalFailure = !delivered && queueItem.attempts >= 5;
  const status = delivered ? "delivered" : finalFailure ? "failed" : "pending";
  await db.from("donation_alert_queue").update({
    status,
    delivered_at: delivered ? new Date().toISOString() : null,
    claimed_at: null,
    last_error: lastError,
    updated_at: new Date().toISOString(),
  }).eq("id", alertId);
  await addEvent(queueItem.donation_id, delivered ? "alert_delivered" : "alert_failed", delivered ? "Streamer.bot played the verified donation alert." : lastError, { queueId: alertId, willRetry: !delivered && !finalFailure });
  return json({ ok: true, status }, 200, request);
}

async function sendDiscordDonation(donation: Donation) {
  const settings = await getSettings();
  const channelId = settings.discord_channel_id || DONATIONS_CHANNEL_ID;
  if (!DISCORD_BOT_TOKEN || !channelId) {
    await db.from("donations").update({ discord_delivery_status: "skipped", discord_error: "Discord destination is not configured.", updated_at: new Date().toISOString() }).eq("id", donation.id);
    return;
  }

  const displayName = donation.is_anonymous ? "Anonymous" : donation.supporter_name || "Supporter";
  const fields = [
    { name: "Supporter", value: displayName, inline: true },
    { name: "Amount", value: `$${Number(donation.amount).toFixed(2)} ${donation.currency}`, inline: true },
    { name: "TTS", value: donation.allow_tts && donation.support_message ? "Allowed • review required" : "Not requested", inline: true },
  ];
  if (donation.support_message) fields.push({ name: "Message", value: donation.support_message.slice(0, 1024), inline: false });

  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [{
          color: 0x7cff00,
          title: "Donation Received",
          description: "PayPal confirmed a new Support Center donation.",
          fields,
          footer: { text: `${donation.receipt_code} • Verified payment` },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `Discord returned ${response.status}`);
    await db.from("donations").update({ discord_delivery_status: "delivered", discord_message_id: result.id, discord_error: null, updated_at: new Date().toISOString() }).eq("id", donation.id);
    await addEvent(donation.id, "discord_delivered", "Verified donation sent to Discord.", { messageId: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown Discord delivery error";
    await db.from("donations").update({ discord_delivery_status: "failed", discord_error: message, updated_at: new Date().toISOString() }).eq("id", donation.id);
    await addEvent(donation.id, "discord_failed", message);
  }
}

async function getSettings() {
  const { data, error } = await db.from("support_settings").select("*").eq("singleton", true).single();
  if (error || !data) throw new ApiError("settings_failed", "The Support Center settings could not be loaded.", 500);
  return data;
}

async function findDonation(id: string): Promise<Donation> {
  const { data, error } = await db.from("donations").select("*").eq("id", id).single();
  if (error || !data) throw new ApiError("donation_not_found", "Support receipt not found.", 404);
  return data as Donation;
}

async function addEvent(donationId: string, eventType: string, message: string, metadata: Record<string, unknown> = {}) {
  const { error } = await db.from("donation_events").insert({ donation_id: donationId, event_type: eventType, message, metadata });
  if (error) console.error("Donation event insert failed", error.message);
}

async function updatePaymentState(donationId: string, status: string, eventType: string, captureId: string | null) {
  await db.from("donations").update({ status, paypal_status: status.toUpperCase(), updated_at: new Date().toISOString() }).eq("id", donationId);
  await addEvent(donationId, eventType, `PayPal marked the payment ${status}.`, { paypalCaptureId: captureId });
}

async function finishWebhookEvent(eventId: string, status: string, error: string | null) {
  await db.from("paypal_webhook_events").update({ processing_status: status, processing_error: error, processed_at: new Date().toISOString() }).eq("event_id", eventId);
}

async function getPayPalAccessToken() {
  const credentials = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new ApiError("paypal_auth_failed", "The Support Center could not authenticate with PayPal.", 502);
  return body.access_token as string;
}

async function paypalRequest(path: string, accessToken: string, options: RequestInit) {
  const response = await fetch(`${PAYPAL_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

function extractCompletedCapture(order: Record<string, any>) {
  const captures = order.purchase_units?.flatMap((unit: Record<string, any>) => unit.payments?.captures ?? []) ?? [];
  return captures.find((capture: Record<string, any>) => capture.status === "COMPLETED") ?? null;
}

async function enforceRateLimit(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("cf-connecting-ip") || "unknown";
  const clientHash = await sha256(`${forwarded}|support-orders|${Deno.env.get("RATE_LIMIT_SALT") ?? SUPABASE_URL}`);
  const { data } = await db.from("support_rate_limits").select("*").eq("client_hash", clientHash).maybeSingle();
  const now = Date.now();
  if (!data || new Date(data.window_started_at).getTime() < now - 10 * 60_000) {
    await db.from("support_rate_limits").upsert({ client_hash: clientHash, request_count: 1, window_started_at: new Date().toISOString(), expires_at: new Date(now + 24 * 60 * 60_000).toISOString() });
    return;
  }
  if (data.request_count >= 5) throw new ApiError("rate_limited", "Too many checkout attempts. Wait ten minutes and try again.", 429);
  await db.from("support_rate_limits").update({ request_count: data.request_count + 1 }).eq("client_hash", clientHash);
}

function enforceSiteOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== SITE_ORIGIN) throw new ApiError("origin_rejected", "This request must come from the official ThyToxicGamer site.", 403);
}

function requirePayPal() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new ApiError("paypal_not_configured", "PayPal checkout is not connected yet.", 503);
}

function requireStreamerBot(request: Request) {
  const provided = request.headers.get("x-streamerbot-key") ?? "";
  if (!STREAMERBOT_SHARED_SECRET || !constantTimeEqual(provided, STREAMERBOT_SHARED_SECRET)) {
    throw new ApiError("unauthorized", "Streamer.bot authentication failed.", 401);
  }
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) mismatch |= (a[index % Math.max(a.length, 1)] ?? 0) ^ (b[index % Math.max(b.length, 1)] ?? 0);
  return mismatch === 0;
}

function money(input: unknown) {
  const value = Number(input);
  if (!Number.isFinite(value)) throw new ApiError("invalid_amount", "Enter a valid support amount.");
  return Math.round(value * 100) / 100;
}

function cleanText(input: unknown, maxLength: number) {
  if (typeof input !== "string") return "";
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function retentionDate(months: number) {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + Number(months || 15));
  return date.toISOString();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJson(request: Request) {
  try { return await request.json(); } catch { throw new ApiError("invalid_json", "Request body must be valid JSON."); }
}

function normalizePath(pathname: string) {
  return pathname.replace(/^\/functions\/v1\/support-api/, "").replace(/^\/support-api/, "") || "/";
}

function completedResponse(donation: Donation, request: Request) {
  return json({ ok: true, receiptCode: donation.receipt_code, amount: Number(donation.amount), currency: donation.currency, status: donation.status }, 200, request);
}

function preflight(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== SITE_ORIGIN) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin === SITE_ORIGIN ? SITE_ORIGIN : SITE_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-streamerbot-key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, request: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
