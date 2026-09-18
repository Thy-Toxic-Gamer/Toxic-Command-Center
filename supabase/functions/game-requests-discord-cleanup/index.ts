import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const DISCORD_API = "https://discord.com/api/v10";

function getKeySet(name: string, fallbackName: string) {
  const keys = new Set<string>();
  const encoded = Deno.env.get(name);
  if (encoded) {
    try {
      for (const value of Object.values(JSON.parse(encoded))) if (typeof value === "string" && value) keys.add(value);
    } catch { throw new Error("Supabase key configuration is invalid."); }
  }
  const fallback = Deno.env.get(fallbackName);
  if (fallback) keys.add(fallback);
  return keys;
}

function validateProjectKey(request: Request) {
  const supplied = request.headers.get("apikey") ?? "";
  return Boolean(supplied && getKeySet("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY").has(supplied));
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = [...getKeySet("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY")][0];
  if (!url || !key) throw new Error("Database configuration is unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function removeDiscordMessage(channelId: string, messageId: string) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("Discord bot connection is unavailable.");
  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
    headers: { Authorization: `Bot ${token}` },
  });
  if (!response.ok && response.status !== 404) throw new Error(`Discord request failed (${response.status}).`);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  if (!validateProjectKey(request)) return Response.json({ error: "Invalid project key." }, { status: 401 });
  try {
    const admin = adminClient();
    const { data: rows, error } = await admin.from("game_requests")
      .select("id,discord_channel_id,discord_message_id")
      .eq("status", "completed")
      .not("discord_channel_id", "is", null)
      .not("discord_message_id", "is", null)
      .lte("discord_delete_at", new Date().toISOString())
      .limit(100);
    if (error) throw new Error("Cleanup records could not be loaded.");

    let deleted = 0;
    let failed = 0;
    for (const row of rows ?? []) {
      try {
        await removeDiscordMessage(row.discord_channel_id, row.discord_message_id);
        await admin.from("game_requests").update({
          discord_channel_id: null,
          discord_message_id: null,
          discord_deleted_at: new Date().toISOString(),
          discord_last_error: null,
        }).eq("id", row.id);
        deleted += 1;
      } catch (cleanupError) {
        const message = cleanupError instanceof Error ? cleanupError.message : "Discord cleanup failed.";
        await admin.from("game_requests").update({ discord_last_error: message.slice(0, 1000) }).eq("id", row.id);
        failed += 1;
      }
    }
    return Response.json({ ok: failed === 0, checked: rows?.length ?? 0, deleted, failed });
  } catch (error) {
    console.error("Game request Discord cleanup failed", error);
    return Response.json({ error: "Game request Discord cleanup failed." }, { status: 500 });
  }
});
