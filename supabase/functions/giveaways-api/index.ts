import { createClient } from "npm:@supabase/supabase-js@2.95.0";
const TWITCH_CLIENT_ID = "ht2kbpz12tpv060f2259jn9recng0x",
  DISCORD_CLIENT_ID = "1544711402873290873",
  GIVEAWAY_LOG_CHANNEL_ID = "1551028963126673408",
  ORIGIN = "https://thy-toxic-gamer.github.io";
const CORS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-giveaways-platform",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};
type Identity = {
  platform: "twitch" | "discord";
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string;
};
class ApiError extends Error {
  status: number;
  constructor(m: string, s = 400) {
    super(m);
    this.status = s;
  }
}
const reply = (d: unknown, s = 200) =>
  Response.json(d, {
    status: s,
    headers: {
      ...CORS,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
function keys(name: string, fallback: string) {
  const out = new Set<string>();
  const raw = Deno.env.get(name);
  if (raw)
    for (const v of Object.values(JSON.parse(raw)))
      if (typeof v === "string") out.add(v);
  const f = Deno.env.get(fallback);
  if (f) out.add(f);
  return out;
}
function admin() {
  const url = Deno.env.get("SUPABASE_URL"),
    key = [...keys("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY")][0];
  if (!url || !key) throw new Error("Database configuration unavailable.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function projectKey(r: Request) {
  if (
    !keys("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY").has(
      r.headers.get("apikey") || "",
    )
  )
    throw new ApiError("Invalid project key.", 401);
}
async function identity(r: Request): Promise<Identity> {
  const token = (r.headers.get("authorization") || "").match(
    /^Bearer\s+(.+)$/i,
  )?.[1];
  if (!token) throw new ApiError("Sign in is required.", 401);
  const p = (r.headers.get("x-giveaways-platform") || "twitch").toLowerCase();
  if (p === "twitch") {
    const vr = await fetch("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: `OAuth ${token}` },
      }),
      v = await vr.json().catch(() => null);
    if (!vr.ok || v?.client_id !== TWITCH_CLIENT_ID)
      throw new ApiError("Your Twitch session expired. Sign in again.", 401);
    const ur = await fetch("https://api.twitch.tv/helix/users", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Client-Id": TWITCH_CLIENT_ID,
        },
      }),
      u = (await ur.json().catch(() => null))?.data?.[0];
    if (!ur.ok || !u || u.id !== v.user_id)
      throw new ApiError("Twitch could not verify this account.", 502);
    return {
      platform: "twitch",
      id: u.id,
      login: u.login,
      displayName: u.display_name,
      avatarUrl: u.profile_image_url || "",
    };
  }
  if (p === "discord") {
    const h = { Authorization: `Bearer ${token}` },
      ar = await fetch("https://discord.com/api/v10/oauth2/@me", {
        headers: h,
      }),
      a = await ar.json().catch(() => null);
    if (!ar.ok || String(a?.application?.id) !== DISCORD_CLIENT_ID)
      throw new ApiError("Your Discord session expired. Sign in again.", 401);
    const ur = await fetch("https://discord.com/api/v10/users/@me", {
        headers: h,
      }),
      u = await ur.json();
    if (!ur.ok)
      throw new ApiError("Discord could not verify this account.", 502);
    return {
      platform: "discord",
      id: u.id,
      login: u.username,
      displayName: u.global_name || u.username,
      avatarUrl: u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.webp?size=128`
        : "",
    };
  }
  throw new ApiError("Choose Twitch or Discord sign-in.");
}
async function discordBot(path: string) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("Discord bot unavailable.");
  const r = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!r.ok) throw new Error("Discord staff lookup failed.");
  return await r.json();
}
async function postGiveawayLog(g: any, i: Identity) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("Discord bot unavailable.");
  const code = `TTG-GIVE-${String(g.giveaway_number).padStart(6, "0")}`;
  const response = await fetch(`https://discord.com/api/v10/channels/${GIVEAWAY_LOG_CHANNEL_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{
        title: "Giveaway receipt confirmed",
        description: `**${code}**\n**Prize:** ${g.title}\n**Winner:** ${g.winner_display_name || i.displayName} (@${g.winner_login || i.login})\n**Status:** Winner confirmed the prize was received.\n\nPrivate fulfillment information is intentionally excluded.`,
        color: 0xb5ff18,
        timestamp: new Date().toISOString(),
        footer: { text: "ThyToxicGamer Giveaway Log" },
      }],
    }),
  });
  if (!response.ok) throw new Error(`Discord giveaway log failed (${response.status}).`);
}
async function guildStaff(db: any, userId: string) {
  const { data: configs } = await db
    .from("discord_bot_guilds")
    .select("guild_id,owner_user_id,moderator_role_ids,administrator_role_ids")
    .eq("active", true);
  for (const c of configs || []) {
    try {
      const [m, roles] = await Promise.all([
          discordBot(`/guilds/${c.guild_id}/members/${userId}`),
          discordBot(`/guilds/${c.guild_id}/roles`),
        ]),
        ids = new Set([String(c.guild_id), ...(m.roles || []).map(String)]);
      let perms = 0n;
      for (const r of roles || [])
        if (ids.has(String(r.id))) perms |= BigInt(String(r.permissions || 0));
      const owner = String(c.owner_user_id || "") === userId,
        admin =
          owner ||
          (c.administrator_role_ids || [])
            .map(String)
            .some((x: string) => ids.has(x)) ||
          (perms & (1n << 3n)) !== 0n,
        mod =
          (c.moderator_role_ids || [])
            .map(String)
            .some((x: string) => ids.has(x)) ||
          (perms &
            ((1n << 1n) |
              (1n << 2n) |
              (1n << 5n) |
              (1n << 13n) |
              (1n << 40n))) !==
            0n;
      if (admin || mod)
        return {
          role: owner ? "owner" : admin ? "admin" : "moderator",
          active: true,
        };
    } catch (e) {
      console.warn(e);
    }
  }
  return null;
}
async function staff(db: any, i: Identity) {
  const col = i.platform === "twitch" ? "twitch_user_id" : "discord_user_id";
  const { data: link } = await db
    .from("appeal_identity_links")
    .select("twitch_user_id,discord_user_id")
    .eq(col, i.id)
    .maybeSingle();
  const ids = [
    { p: i.platform, id: i.id },
    { p: "twitch", id: link?.twitch_user_id },
    { p: "discord", id: link?.discord_user_id },
  ];
  for (const x of ids) {
    if (!x.id) continue;
    const { data } = await db
      .from("appeal_staff")
      .select("role,active")
      .eq("platform", x.p)
      .eq("platform_user_id", x.id)
      .eq("active", true)
      .maybeSingle();
    if (data) return data;
  }
  const discordId = i.platform === "discord" ? i.id : link?.discord_user_id;
  return discordId ? await guildStaff(db, String(discordId)) : null;
}
const clean = (v: unknown, max: number, required = false) => {
  const s = String(v ?? "").trim();
  if (required && !s) throw new ApiError("Complete every required field.");
  if (s.length > max) throw new ApiError("One or more fields are too long.");
  return s;
};
function claimSchema(value: unknown) {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ApiError("Custom winner questions are invalid.");
    }
  }
  if (!Array.isArray(parsed) || parsed.length > 12)
    throw new ApiError("Add no more than 12 custom questions.");
  return parsed.map((field: any, index) => ({
    key: `field_${index + 1}`,
    label: clean(field?.label, 100, true),
    required: !!field?.required,
  }));
}
async function signed(db: any, path: string | null) {
  if (!path) return null;
  const { data } = await db.storage
    .from("giveaway-prizes")
    .createSignedUrl(path, 900);
  return data?.signedUrl || null;
}
async function event(
  db: any,
  gid: string | null,
  type: string,
  i: Identity,
  details: Record<string, unknown> = {},
) {
  await db.from("giveaway_events").insert({
    giveaway_id: gid,
    event_type: type,
    actor_platform: i.platform,
    actor_user_id: i.id,
    actor_name: i.displayName,
    details,
  });
}
async function dashboards(db: any, i: Identity, role: string) {
  const { data: rows, error } = await db
    .from("giveaways")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new ApiError("Giveaways could not be loaded.", 500);
  const ids = (rows || []).map((x: any) => x.id);
  const { data: claims } = ids.length
    ? await db.from("giveaway_claims").select("*").in("giveaway_id", ids)
    : { data: [] };
  return {
    staff: { displayName: i.displayName, avatarUrl: i.avatarUrl, role },
    giveaways: await Promise.all(
      (rows || []).map(async (g: any) => {
        const c = (claims || []).find((x: any) => x.giveaway_id === g.id);
        return {
          id: g.id,
          code: `TTG-GIVE-${String(g.giveaway_number).padStart(6, "0")}`,
          title: g.title,
          description: g.description,
          prizeType: g.prize_type,
          status: g.status,
          winnerLogin: g.winner_login,
          winnerDisplayName: g.winner_display_name,
          claimSubmitted: !!c,
          imageUrl: await signed(db, g.prize_image_path),
          claim:
            role === "owner" && c
              ? {
                  email: c.email,
                  fullName: c.full_name,
                  address1: c.address_line1,
                  address2: c.address_line2,
                  city: c.city,
                  region: c.state_region,
                  postalCode: c.postal_code,
                  country: c.country,
                  notes: c.delivery_notes,
                  carrier: c.carrier,
                  trackingNumber: c.tracking_number,
                  prizeReceivedAt: c.prize_received_at,
                  customAnswers: (g.claim_schema || []).map((field: any) => ({
                    label: field.label,
                    value: c.custom_answers?.[field.key] || "",
                  })),
                }
              : undefined,
        };
      }),
    ),
  };
}
Deno.serve(async (r) => {
  if (r.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS });
  if (r.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  try {
    projectKey(r);
    const db = admin(),
      i = await identity(r),
      ct = r.headers.get("content-type") || "";
    let body: any, action: string;
    if (ct.includes("multipart/form-data")) {
      body = await r.formData();
      action = String(body.get("action") || "");
    } else {
      body = await r.json().catch(() => ({}));
      action = String(body.action || "");
    }
    if (action === "winner_dashboard") {
      if (i.platform !== "twitch")
        throw new ApiError("Winner access requires Twitch.", 403);
      const { data: rows } = await db
        .from("giveaways")
        .select("*")
        .or(
          `winner_twitch_id.eq.${i.id},and(winner_twitch_id.is.null,winner_login.ilike.${i.login})`,
        )
        .in("status", [
          "winner_selected",
          "claim_submitted",
          "shipped",
          "completed",
        ])
        .order("created_at", { ascending: false });
      const out = [];
      for (const g of rows || []) {
        if (!g.winner_twitch_id) {
          await db
            .from("giveaways")
            .update({
              winner_twitch_id: i.id,
              winner_display_name: i.displayName,
              updated_at: new Date().toISOString(),
            })
            .eq("id", g.id)
            .is("winner_twitch_id", null);
        }
        if (g.prize_type === "twitch_subscription") {
          const { data: existing } = await db
            .from("giveaway_claims")
            .select("id")
            .eq("giveaway_id", g.id)
            .maybeSingle();
          if (!existing) {
            await db
              .from("giveaway_claims")
              .insert({ giveaway_id: g.id, winner_twitch_id: i.id });
            await db
              .from("giveaways")
              .update({
                status: "claim_submitted",
                updated_at: new Date().toISOString(),
              })
              .eq("id", g.id);
            await event(db, g.id, "twitch_identity_verified", i);
            g.status = "claim_submitted";
          }
        }
        const { data: c } = await db
          .from("giveaway_claims")
          .select("tracking_number,carrier,winner_saved_tracking_at,prize_received_at")
          .eq("giveaway_id", g.id)
          .maybeSingle();
        out.push({
          id: g.id,
          title: g.title,
          description: g.description,
          prizeType: g.prize_type,
          claimSchema: g.claim_schema || [],
          status: g.status,
          imageUrl: await signed(db, g.prize_image_path),
          claimSubmitted: !!c,
          trackingNumber: c?.tracking_number || "",
          carrier: c?.carrier || "",
          winnerSavedTrackingAt: c?.winner_saved_tracking_at,
          prizeReceivedAt: c?.prize_received_at,
        });
      }
      return reply({
        viewer: { displayName: i.displayName, avatarUrl: i.avatarUrl },
        giveaways: out,
      });
    }
    if (["submit_claim", "tracking_saved", "prize_received"].includes(action)) {
      if (i.platform !== "twitch")
        throw new ApiError("Winner access requires Twitch.", 403);
      const { data: g } = await db
        .from("giveaways")
        .select("*")
        .eq("id", body.id)
        .maybeSingle();
      if (!g || String(g.winner_twitch_id || "") !== i.id)
        throw new ApiError(
          "This prize is not assigned to your Twitch account.",
          403,
        );
      if (action === "submit_claim") {
        if (!["winner_selected", "claim_submitted"].includes(g.status))
          throw new ApiError("This claim is not open.");
        if (g.prize_type === "twitch_subscription")
          throw new ApiError(
            "No additional claim information is required for this prize.",
          );
        const c = body.claim || {},
          physical = g.prize_type === "physical",
          emailOnly = ["digital", "game_key"].includes(g.prize_type);
        const answers: Record<string, string> = {};
        if (g.prize_type === "other")
          for (const field of g.claim_schema || [])
            answers[field.key] = clean(
              c.customAnswers?.[field.key],
              500,
              !!field.required,
            );
        const row = {
          giveaway_id: g.id,
          winner_twitch_id: i.id,
          email: clean(c.email, 320, physical || emailOnly) || null,
          full_name: clean(c.fullName, 160, physical) || null,
          address_line1: clean(c.address1, 200, physical) || null,
          address_line2: clean(c.address2, 200),
          city: clean(c.city, 120, physical) || null,
          state_region: clean(c.region, 120, physical) || null,
          postal_code: clean(c.postalCode, 40, physical) || null,
          country: clean(c.country, 100, physical) || null,
          delivery_notes: clean(c.notes, 1000),
          custom_answers: answers,
          updated_at: new Date().toISOString(),
        };
        const { error } = await db
          .from("giveaway_claims")
          .upsert(row, { onConflict: "giveaway_id" });
        if (error) throw new ApiError("Your claim could not be saved.", 500);
        await db
          .from("giveaways")
          .update({
            status: "claim_submitted",
            updated_at: new Date().toISOString(),
          })
          .eq("id", g.id);
        await event(db, g.id, "claim_submitted", i);
        return reply({ ok: true });
      }
      if (action === "tracking_saved") {
        await db
          .from("giveaway_claims")
          .update({
            winner_saved_tracking_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("giveaway_id", g.id);
        await event(db, g.id, "tracking_saved", i);
        return reply({ ok: true });
      }
      const { data: currentClaim } = await db.from("giveaway_claims").select("prize_received_at,receipt_log_sent_at").eq("giveaway_id", g.id).maybeSingle();
      if (!currentClaim) throw new ApiError("The claim record could not be found.", 404);
      if (currentClaim.prize_received_at && currentClaim.receipt_log_sent_at) return reply({ ok: true, alreadyConfirmed: true });
      const confirmedAt = currentClaim.prize_received_at || new Date().toISOString();
      if (!currentClaim.prize_received_at) {
        await db.from("giveaway_claims").update({ prize_received_at: confirmedAt, updated_at: confirmedAt }).eq("giveaway_id", g.id);
        await event(db, g.id, "prize_received", i);
      }
      try {
        await postGiveawayLog(g, i);
        await db.from("giveaway_claims").update({ receipt_log_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("giveaway_id", g.id);
      } catch (logError) {
        console.error(logError);
        await event(db, g.id, "giveaway_log_failed", i, { channelId: GIVEAWAY_LOG_CHANNEL_ID });
        throw new ApiError("Your receipt was saved, but the Discord log could not be posted. Press the button again to retry the log.", 502);
      }
      return reply({ ok: true });
    }
    const s = await staff(db, i);
    if (!s)
      throw new ApiError(
        "This account is not authorized for giveaway controls.",
        403,
      );
    const role = s.role === "staff" ? "moderator" : s.role;
    if (action === "staff_dashboard")
      return reply(await dashboards(db, i, role));
    if (action === "create_giveaway") {
      const title = clean(body.get("title"), 160, true),
        description = clean(body.get("description"), 2000),
        prizeType = clean(body.get("prizeType"), 30, true),
        file = body.get("image");
      if (
        ![
          "physical",
          "digital",
          "game_key",
          "twitch_subscription",
          "other",
        ].includes(prizeType)
      )
        throw new ApiError("Choose a valid prize type.");
      const schema =
        prizeType === "other" ? claimSchema(body.get("claimSchema")) : [];
      if (prizeType === "other" && !schema.length)
        throw new ApiError("Add at least one winner-information question.");
      const hasImage = file instanceof File && file.size > 0;
      if (
        hasImage &&
        (file.size > 5242880 ||
          !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
            file.type,
          ))
      )
        throw new ApiError("Choose a JPG, PNG, WEBP, or GIF image up to 5 MB.");
      const id = crypto.randomUUID();
      let path: string | null = null;
      if (hasImage) {
        const ext = (
          {
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "image/gif": "gif",
          } as any
        )[file.type];
        path = `${id}/prize.${ext}`;
        const { error: up } = await db.storage
          .from("giveaway-prizes")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (up) throw new ApiError("Prize image could not be uploaded.", 500);
      }
      const { error } = await db.from("giveaways").insert({
        id,
        title,
        description,
        prize_type: prizeType,
        prize_image_path: path,
        claim_schema: schema,
        created_by_platform: i.platform,
        created_by_user_id: i.id,
        created_by_name: i.displayName,
      });
      if (error) {
        if (path) await db.storage.from("giveaway-prizes").remove([path]);
        throw new ApiError("Giveaway could not be created.", 500);
      }
      await event(db, id, "giveaway_created", i, { title });
      return reply(await dashboards(db, i, role));
    }
    const { data: g } = await db
      .from("giveaways")
      .select("*")
      .eq("id", body.id)
      .maybeSingle();
    if (!g) throw new ApiError("Giveaway not found.", 404);
    if (action === "select_winner") {
      const winner = clean(body.winner, 25, true)
        .replace(/^@/, "")
        .toLowerCase();
      if (!/^[a-z0-9_]{4,25}$/.test(winner))
        throw new ApiError(
          "Enter the exact Twitch username shown by Nightbot.",
        );
      await db
        .from("giveaways")
        .update({
          winner_login: winner,
          winner_display_name: winner,
          winner_twitch_id: null,
          status: "winner_selected",
          selected_at: new Date().toISOString(),
          claim_deadline: new Date(Date.now() + 72 * 3600000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", g.id);
      await event(db, g.id, "winner_selected", i, { winnerLogin: winner });
      return reply(await dashboards(db, i, role));
    }
    if (action === "save_tracking") {
      if (role !== "owner")
        throw new ApiError("Only the owner can manage tracking.", 403);
      const tracking = clean(body.tracking, 200),
        carrier = clean(body.carrier, 100);
      const { data: c } = await db
        .from("giveaway_claims")
        .update({
          tracking_number: tracking,
          carrier,
          tracking_added_at: tracking ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("giveaway_id", g.id)
        .select("id")
        .maybeSingle();
      if (!c) throw new ApiError("The winner has not submitted a claim yet.");
      await db
        .from("giveaways")
        .update({
          status: tracking ? "shipped" : "claim_submitted",
          updated_at: new Date().toISOString(),
        })
        .eq("id", g.id);
      await event(db, g.id, "tracking_updated", i, { hasTracking: !!tracking });
      return reply(await dashboards(db, i, role));
    }
    if (action === "complete") {
      if (g.prize_image_path)
        await db.storage.from("giveaway-prizes").remove([g.prize_image_path]);
      await db
        .from("giveaways")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          prize_image_path: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", g.id);
      await event(db, g.id, "giveaway_completed", i);
      return reply(await dashboards(db, i, role));
    }
    if (action === "close") {
      await db
        .from("giveaways")
        .update({ status: "closed", updated_at: new Date().toISOString() })
        .eq("id", g.id);
      await event(db, g.id, "giveaway_closed", i);
      return reply(await dashboards(db, i, role));
    }
    if (action === "delete_claim") {
      if (role !== "owner" || body.confirmation !== "DELETE PRIVATE CLAIM")
        throw new ApiError("Owner confirmation is required.", 403);
      await db.from("giveaway_claims").delete().eq("giveaway_id", g.id);
      await event(db, g.id, "private_claim_deleted", i);
      return reply(await dashboards(db, i, role));
    }
    throw new ApiError("Unknown action.", 404);
  } catch (e) {
    console.error(e);
    return reply(
      { error: e instanceof Error ? e.message : "Unexpected service error." },
      e instanceof ApiError ? e.status : 500,
    );
  }
});
