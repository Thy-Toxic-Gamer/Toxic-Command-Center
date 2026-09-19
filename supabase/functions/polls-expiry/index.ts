import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const DISCORD_API = "https://discord.com/api/v10";
const POLLS_URL = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/polls/";

function getKeySet(name: string, fallbackName: string) {
  const keys = new Set<string>();
  const encoded = Deno.env.get(name);
  if (encoded) {
    try { for (const value of Object.values(JSON.parse(encoded))) if (typeof value === "string" && value) keys.add(value); }
    catch { throw new Error("Supabase key configuration is invalid."); }
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

function pollCode(row: any) { return `TTG-POLL-${String(row.poll_number).padStart(6, "0")}`; }
function discordTimestamp(value: string, style = "R") { return `<t:${Math.floor(new Date(value).getTime() / 1000)}:${style}>`; }

async function discordRequest(path: string, init: RequestInit = {}) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("Discord bot connection is unavailable.");
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (response.status === 404) return null;
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Discord request failed (${response.status}).`);
  return data;
}

async function closedPayload(admin: any, row: any) {
  const [{ data: options }, { data: votes }] = await Promise.all([
    admin.from("poll_options").select("id,position,label").eq("poll_id", row.id).order("position"),
    admin.from("poll_votes").select("option_id").eq("poll_id", row.id),
  ]);
  const total = votes?.length ?? 0;
  const results = (options ?? []).map((option: any) => {
    const count = (votes ?? []).filter((vote: any) => vote.option_id === option.id).length;
    return { ...option, count, percent: total ? Math.round((count / total) * 1000) / 10 : 0 };
  });
  const winner = total ? Math.max(...results.map((option: any) => option.count)) : -1;
  const lines = results.map((option: any) => `${option.count === winner && winner > 0 ? "🏆" : `${option.position}.`} **${option.label}** — ${option.count} vote${option.count === 1 ? "" : "s"} (${option.percent}%)`);
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `📊 ${pollCode(row)} · CLOSED`,
      description: `## ${row.question}\n${row.description ? `${row.description}\n\n` : ""}${lines.join("\n")}\n\n**Total votes:** ${total}\nClosed ${discordTimestamp(row.closed_at)}`.slice(0, 4000),
      color: 0x64748b,
      footer: { text: "Final results · Votes were collected on the official website" },
      timestamp: row.closed_at,
    }],
    components: [],
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  if (!validateProjectKey(request)) return Response.json({ error: "Invalid project key." }, { status: 401 });
  try {
    const admin = adminClient();
    const now = new Date().toISOString();
    const { data: due, error } = await admin.from("polls").select("*").eq("status", "open").not("closes_at", "is", null).lte("closes_at", now).limit(100);
    if (error) throw new Error("Expired polls could not be loaded.");
    let closed = 0;
    let synced = 0;
    for (const row of due ?? []) {
      const { data: updated } = await admin.from("polls").update({ status: "closed", closed_at: now, updated_at: now }).eq("id", row.id).eq("status", "open").select("*").maybeSingle();
      if (!updated) continue;
      closed += 1;
      await admin.from("poll_events").insert({ poll_id: row.id, event_type: "poll_closed", actor_platform: "system", actor_user_id: "poll-expiry", actor_name: "Automatic poll timer" });
      if (updated.discord_channel_id && updated.discord_message_id) {
        try {
          await discordRequest(`/channels/${updated.discord_channel_id}/messages/${updated.discord_message_id}`, { method: "PATCH", body: JSON.stringify(await closedPayload(admin, updated)) });
          await admin.from("polls").update({ discord_last_error: null }).eq("id", updated.id);
          synced += 1;
        } catch (discordError) {
          const message = discordError instanceof Error ? discordError.message : "Discord sync failed.";
          await admin.from("polls").update({ discord_last_error: message.slice(0, 1000) }).eq("id", updated.id);
        }
      }
    }
    return Response.json({ ok: true, checked: due?.length ?? 0, closed, synced, pollsUrl: POLLS_URL });
  } catch (error) {
    console.error("Poll expiry failed", error);
    return Response.json({ error: "Poll expiry failed." }, { status: 500 });
  }
});
