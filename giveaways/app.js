(() => {
  "use strict";
  const API =
      "https://ubldjtsjfudogtgxakiq.supabase.co/functions/v1/giveaways-api",
    KEY = "sb_publishable_Fhl-Co0p5QNJKJ7ou2Te2Q_FD8BIywM",
    TOKEN = "thy_toxic_appeals_twitch_token",
    STATE = "thy_toxic_appeals_oauth_state";
  const q = (s) => document.querySelector(s),
    esc = (s) =>
      String(s ?? "").replace(
        /[&<>\"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '\"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  function auth() {
    const state = crypto.getRandomValues(new Uint32Array(4)).join("");
    sessionStorage.setItem(STATE, state);
    sessionStorage.setItem("thy_toxic_appeals_oauth_provider", "twitch");
    sessionStorage.setItem("thy_toxic_appeals_oauth_purpose", "signin");
    sessionStorage.setItem("thy_toxic_appeals_return", "giveaways");
    location.assign(
      "https://id.twitch.tv/oauth2/authorize?" +
        new URLSearchParams({
          response_type: "token",
          client_id: "ht2kbpz12tpv060f2259jn9recng0x",
          redirect_uri:
            "https://thy-toxic-gamer.github.io/Toxic-Command-Center/appeals-center/",
          scope: "user:read:email",
          force_verify: "true",
          state,
        }),
    );
  }
  async function api(action, payload = {}) {
    const token = sessionStorage.getItem(TOKEN);
    if (!token)
      throw Object.assign(new Error("Twitch sign-in is required."), {
        status: 401,
      });
    const r = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: KEY,
        Authorization: `Bearer ${token}`,
        "X-Giveaways-Platform": "twitch",
      },
      body: JSON.stringify({ action, ...payload }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok)
      throw Object.assign(
        new Error(
          d.error || "The giveaway service could not complete this request.",
        ),
        { status: r.status },
      );
    return d;
  }
  function notice(message, error = false) {
    q("#notice").hidden = !message;
    q("#notice").textContent = message || "";
    q("#notice").className = `notice${error ? " error" : ""}`;
  }
  function claimFields(g) {
    if (["digital", "game_key"].includes(g.prizeType))
      return '<label class="full">Email<input name="email" type="email" maxlength="320" required></label>';
    if (g.prizeType === "other")
      return (g.claimSchema || [])
        .map(
          (field) =>
            `<label class="full">${esc(field.label)}${field.required ? "" : " <small>optional</small>"}<input name="custom_${esc(field.key)}" maxlength="500" ${field.required ? "required" : ""}></label>`,
        )
        .join("");
    return '<label>Email<input name="email" type="email" maxlength="320" required></label><label>Recipient full name<input name="fullName" maxlength="160" required></label><label class="full">Address line 1<input name="address1" maxlength="200" required></label><label class="full">Address line 2 <small>optional</small><input name="address2" maxlength="200"></label><label>City<input name="city" maxlength="120" required></label><label>State / region<input name="region" maxlength="120" required></label><label>Postal code<input name="postalCode" maxlength="40" required></label><label>Country<input name="country" maxlength="100" required></label><label class="full">Delivery notes <small>optional</small><textarea name="notes" maxlength="1000" rows="3"></textarea></label>';
  }
  function card(g) {
    const claimed = !!g.claimSubmitted,
      closed = ["completed", "closed"].includes(g.status);
    return `<article class="card" data-id="${esc(g.id)}">${g.imageUrl ? `<img class="prize" src="${esc(g.imageUrl)}" alt="${esc(g.title)}">` : ""}<span class="status">${esc(g.status.replaceAll("_", " "))}</span><h2>${esc(g.title)}</h2><p class="muted">${esc(g.description)}</p>${claimed ? `<div class="safe">${g.prizeType === "twitch_subscription" ? "Your Twitch account is verified. No additional information is needed." : "Your claim was received."}${g.trackingNumber ? `<br><strong>${esc(g.carrier || "Tracking")}:</strong> ${esc(g.trackingNumber)}` : ""}</div>${g.trackingNumber && !g.winnerSavedTrackingAt ? '<button class="button primary saveTracking">I saved my tracking number</button>' : ""}${g.status === "shipped" && !g.prizeReceivedAt ? '<button class="button received">I received my prize</button>' : ""}${g.prizeReceivedAt ? '<div class="safe">Prize receipt confirmed. The owner has been notified.</div>' : ""}` : closed ? '<div class="safe">Fulfillment is complete and the private claim information has been removed.</div>' : `<form class="claimForm"><div class="fields">${claimFields(g)}</div><button class="button primary" type="submit">Submit private claim</button></form>`}</article>`;
  }
  async function load() {
    if (!sessionStorage.getItem(TOKEN)) return;
    try {
      const d = await api("winner_dashboard");
      q("#gate").hidden = true;
      q("#winnerArea").hidden = false;
      q("#viewer").hidden = false;
      q("#avatar").src = d.viewer.avatarUrl || "../tab-icon.png";
      q("#viewerName").textContent = d.viewer.displayName;
      q("#winnerCards").innerHTML = d.giveaways.length
        ? d.giveaways.map(card).join("")
        : '<div class="panel">No active prize is assigned to this Twitch account.</div>';
      notice("");
    } catch (e) {
      notice(e.message, true);
    }
  }
  q("#twitchSignIn").onclick = auth;
  q("#signOut").onclick = () => {
    sessionStorage.removeItem(TOKEN);
    location.reload();
  };
  q("#winnerCards").addEventListener("submit", async (e) => {
    if (!e.target.matches(".claimForm")) return;
    e.preventDefault();
    const f = new FormData(e.target),
      id = e.target.closest("[data-id]").dataset.id;
    try {
      await api("submit_claim", {
        id,
        claim: {
          email: f.get("email"),
          fullName: f.get("fullName"),
          address1: f.get("address1"),
          address2: f.get("address2"),
          city: f.get("city"),
          region: f.get("region"),
          postalCode: f.get("postalCode"),
          country: f.get("country"),
          notes: f.get("notes"),
          customAnswers: Object.fromEntries(
            [...f.entries()]
              .filter(([key]) => key.startsWith("custom_"))
              .map(([key, value]) => [key.slice(7), value]),
          ),
        },
      });
      notice("Your private claim was submitted to the owner.");
      load();
    } catch (x) {
      notice(x.message, true);
    }
  });
  q("#winnerCards").addEventListener("click", async (e) => {
    const b = e.target.closest("button"),
      id = b?.closest("[data-id]")?.dataset.id;
    if (!id) return;
    try {
      if (b.classList.contains("saveTracking")) {
        await api("tracking_saved", { id });
        await load();
        notice("Tracking confirmation saved.");
      }
      if (b.classList.contains("received")) {
        b.disabled = true;
        await api("prize_received", { id });
        await load();
        notice("Prize receipt confirmed. The owner has been notified in Discord.");
      }
    } catch (x) {
      notice(x.message, true);
    }
  });
  load();
})();
