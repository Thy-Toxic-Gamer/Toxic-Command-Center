(() => {
  "use strict";
  function resetDeleteButton(button) {
    if (!button) return;
    button.classList.remove("confirm-delete");
    button.dataset.confirmDelete = "false";
    if (button.dataset.deleteOriginalHtml)
      button.innerHTML = button.dataset.deleteOriginalHtml;
  }
  function armDeleteButton(button) {
    if (button.dataset.confirmDelete === "true") return true;
    button.dataset.confirmDelete = "true";
    button.dataset.deleteOriginalHtml = button.innerHTML;
    button.classList.add("confirm-delete");
    button.textContent = "Confirm Delete";
    window.setTimeout(() => {
      if (button.isConnected && button.dataset.confirmDelete === "true")
        resetDeleteButton(button);
    }, 8000);
    return false;
  }

  const API =
      "https://ubldjtsjfudogtgxakiq.supabase.co/functions/v1/giveaways-api",
    KEY = "sb_publishable_Fhl-Co0p5QNJKJ7ou2Te2Q_FD8BIywM",
    REDIRECT =
      "https://thy-toxic-gamer.github.io/Toxic-Command-Center/appeals-center/",
    P = {
      twitch: {
        id: "ht2kbpz12tpv060f2259jn9recng0x",
        token: "thy_toxic_appeals_twitch_token",
      },
      discord: {
        id: "1544711402873290873",
        token: "thy_toxic_appeals_discord_token",
      },
    };
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
  const PRESET_FIELDS = [
    { key: "email", label: "Email", kind: "email" },
    { key: "full_name", label: "Recipient full name", kind: "text" },
    { key: "address_line1", label: "Address line 1", kind: "text" },
    { key: "address_line2", label: "Address line 2", kind: "text" },
    { key: "city", label: "City", kind: "text" },
    { key: "state_region", label: "State / region", kind: "text" },
    { key: "postal_code", label: "Postal code", kind: "text" },
    { key: "country", label: "Country", kind: "text" },
    { key: "delivery_notes", label: "Delivery notes", kind: "textarea" },
  ];
  let state = null;
  function provider() {
    const a = sessionStorage.getItem("thy_toxic_appeals_active_provider");
    return a && sessionStorage.getItem(P[a]?.token)
      ? a
      : Object.keys(P).find((x) => sessionStorage.getItem(P[x].token));
  }
  function auth(p) {
    const s = crypto.getRandomValues(new Uint32Array(4)).join("");
    sessionStorage.setItem("thy_toxic_appeals_oauth_state", s);
    sessionStorage.setItem("thy_toxic_appeals_oauth_provider", p);
    sessionStorage.setItem("thy_toxic_appeals_oauth_purpose", "signin");
    sessionStorage.setItem("thy_toxic_appeals_return", "giveaways-staff");
    location.assign(
      (p === "twitch"
        ? "https://id.twitch.tv/oauth2/authorize?"
        : "https://discord.com/oauth2/authorize?") +
        new URLSearchParams({
          response_type: "token",
          client_id: P[p].id,
          redirect_uri: REDIRECT,
          scope: p === "twitch" ? "user:read:email" : "identify",
          state: s,
          force_verify: "true",
        }),
    );
  }
  async function api(action, payload = {}, form = false) {
    const p = provider(),
      token = p && sessionStorage.getItem(P[p].token);
    if (!token)
      throw Object.assign(new Error("Staff sign-in is required."), {
        status: 401,
      });
    const body = form ? payload : JSON.stringify({ action, ...payload });
    if (form) body.append("action", action);
    const r = await fetch(API, {
      method: "POST",
      headers: {
        ...(form ? {} : { "Content-Type": "application/json" }),
        apikey: KEY,
        Authorization: `Bearer ${token}`,
        "X-Giveaways-Platform": p,
      },
      body,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok)
      throw Object.assign(new Error(d.error || "Giveaway controls failed."), {
        status: r.status,
      });
    return d;
  }
  function notice(m, e = false) {
    q("#notice").hidden = !m;
    q("#notice").textContent = m || "";
    q("#notice").className = `notice${e ? " error" : ""}`;
  }
  function customAnswerDetails(claim) {
    return (claim.customAnswers || [])
      .map(
        (answer) =>
          `<div><b>${esc(answer.label)}</b>${esc(answer.value || "Not provided")}</div>`,
      )
      .join("");
  }
  function card(g, archived = false) {
    const owner = state.staff.role === "owner",
      details = g.claim
        ? `<div class="details private">${g.claim.fullName ? `<div><b>Full name</b>${esc(g.claim.fullName)}</div>` : ""}${g.claim.email ? `<div><b>Email</b>${esc(g.claim.email)}</div>` : ""}${g.claim.address1 ? `<div><b>Shipping address</b>${esc(g.claim.address1)} ${esc(g.claim.address2)}<br>${esc(g.claim.city)}, ${esc(g.claim.region)} ${esc(g.claim.postalCode)}<br>${esc(g.claim.country)}</div>` : ""}${g.claim.notes ? `<div><b>Delivery notes</b>${esc(g.claim.notes)}</div>` : ""}${customAnswerDetails(g.claim)}${g.claim.prizeReceivedAt ? `<div><b>Receipt status</b>Winner confirmed receipt on ${esc(new Date(g.claim.prizeReceivedAt).toLocaleString())}</div>` : ""}</div>`
        : g.claimSubmitted
          ? '<div class="safe">Claim submitted. Private information is visible only to the owner.</div>'
          : "",
      actions = archived
        ? owner && g.claimSubmitted
          ? '<button class="button danger deleteClaim">Delete private claim data</button>'
          : ""
        : `${g.prizeType !== "physical" && g.status !== "completed" ? '<button class="button complete">Mark completed</button>' : ""}${g.status !== "closed" ? '<button class="button close">Close</button>' : ""}${owner && g.claimSubmitted ? '<button class="button danger deleteClaim">Delete private claim data</button>' : ""}`;
    return `<article class="card${archived ? " archived-card" : ""}" data-id="${esc(g.id)}">${g.imageUrl ? `<img class="prize" src="${esc(g.imageUrl)}" alt="${esc(g.title)}">` : ""}<span class="status">${esc(g.status.replaceAll("_", " "))}</span><h3>${esc(g.code)} · ${esc(g.title)}</h3><p class="muted">${esc(g.description)}</p>${archived && g.completedAt ? `<p class="muted archive-date">Completed ${esc(new Date(g.completedAt).toLocaleString())}</p>` : ""}${g.winnerLogin ? `<div class="safe">Winner: ${esc(g.winnerDisplayName || g.winnerLogin)} (@${esc(g.winnerLogin)})</div>` : archived ? "" : `<form class="winnerForm"><label>Nightbot winner's exact Twitch username<input name="winner" required pattern="[A-Za-z0-9_]{4,25}"></label><button class="button primary">Activate winner claim</button></form>`}${details}${!archived && owner && g.claimSubmitted && g.prizeType === "physical" ? `<form class="trackingForm"><div class="fields"><label>Carrier<input name="carrier" value="${esc(g.claim?.carrier)}"></label><label>Tracking number<input name="tracking" value="${esc(g.claim?.trackingNumber)}"></label></div><button class="button">Save tracking</button></form>` : ""}${actions ? `<div class="actions">${actions}</div>` : ""}</article>`;
  }
  function syncCustomBuilder() {
    const other = q('[name="prizeType"]').value === "other";
    q("#customBuilder").hidden = !other;
  }
  function renderPresetFields() {
    q("#customFields").innerHTML = PRESET_FIELDS.map((field) =>
      `<label class="custom-field" data-key="${field.key}" data-label="${field.label}" data-kind="${field.kind}"><span>${field.label}</span><select aria-label="${field.label} requirement"><option value="off">Don't ask</option><option value="optional">Optional</option><option value="required">Required</option></select></label>`
    ).join("");
  }
  function render(d) {
    state = d;
    q("#gate").hidden = true;
    q("#workspace").hidden = false;
    q("#viewer").hidden = false;
    q("#avatar").src = d.staff.avatarUrl || "../tab-icon.png";
    q("#viewerName").textContent = d.staff.displayName;
    q("#viewerRole").textContent = d.staff.role;
    const active = d.giveaways.filter((g) => g.status !== "completed"),
      archived = d.giveaways.filter((g) => g.status === "completed");
    q("#cards").innerHTML = active.length
      ? active.map((g) => card(g)).join("")
      : '<p class="muted">No active giveaways.</p>';
    q("#archives").innerHTML = archived.length
      ? archived.map((g) => card(g, true)).join("")
      : '<p class="muted">No archived giveaways.</p>';
    q("#clearArchives").hidden =
      d.staff.role !== "owner" || !archived.length;
  }
  async function load() {
    if (!provider()) return;
    try {
      render(await api("staff_dashboard"));
      notice("");
    } catch (e) {
      notice(e.message, true);
    }
  }
  document
    .querySelectorAll("[data-signin]")
    .forEach((b) => (b.onclick = () => auth(b.dataset.signin)));
  q("#signOut").onclick = () => {
    const p = provider();
    if (p) sessionStorage.removeItem(P[p].token);
    sessionStorage.removeItem("thy_toxic_appeals_active_provider");
    location.reload();
  };
  q("#createForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      file = f.get("image");
    if (file?.size > 5242880)
      return notice("Prize image must be 5 MB or smaller.", true);
    const customFields = [...q("#customFields").querySelectorAll(".custom-field")]
      .map((row) => ({ key: row.dataset.key, label: row.dataset.label, kind: row.dataset.kind, mode: row.querySelector("select").value }))
      .filter((field) => field.mode !== "off")
      .map((field) => ({ key: field.key, label: field.label, kind: field.kind, required: field.mode === "required" }));
    if (f.get("prizeType") === "other" && !customFields.length)
      return notice(
        "Add at least one winner-information question for an Other prize.",
        true,
      );
    f.set("claimSchema", JSON.stringify(customFields));
    try {
      render(await api("create_giveaway", f, true));
      e.target.reset();
      renderPresetFields();
      syncCustomBuilder();
      notice("Giveaway created. Open Nightbot when you are ready to draw.");
    } catch (x) {
      notice(x.message, true);
    }
  };
  q('[name="prizeType"]').addEventListener("change", syncCustomBuilder);
  q("#cards").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = e.target.closest("[data-id]").dataset.id,
      f = new FormData(e.target);
    try {
      if (e.target.matches(".winnerForm"))
        render(
          await api("select_winner", {
            id,
            winner: String(f.get("winner")).trim(),
          }),
        );
      if (e.target.matches(".trackingForm"))
        render(
          await api("save_tracking", {
            id,
            carrier: f.get("carrier"),
            tracking: f.get("tracking"),
          }),
        );
      notice("Giveaway updated.");
    } catch (x) {
      notice(x.message, true);
    }
  });
  async function handleCardClick(e) {
    const b = e.target.closest("button"),
      id = b?.closest("[data-id]")?.dataset.id;
    if (!id || !b) return;
    try {
      if (
        b.classList.contains("complete") &&
        confirm("Mark completed, move this giveaway into the archives, and post one Discord log?")
      ) {
        b.disabled = true;
        render(await api("complete", { id }));
      }
      if (b.classList.contains("close") && confirm("Close this giveaway?"))
        render(await api("close", { id }));
      if (b.classList.contains("deleteClaim")) {
        if (!armDeleteButton(b)) return;
        render(
          await api("delete_claim", {
            id,
            confirmed: true,
          }),
        );
      }
      notice("Giveaway updated.");
    } catch (x) {
      if (b?.classList.contains("complete")) b.disabled = false;
      if (b?.classList.contains("deleteClaim")) {
        b.disabled = false;
        resetDeleteButton(b);
      }
      notice(x.message, true);
    }
  }
  q("#cards").addEventListener("click", handleCardClick);
  q("#archives").addEventListener("click", handleCardClick);
  q("#clearArchives").onclick = async () => {
    const button = q("#clearArchives");
    if (!armDeleteButton(button)) return;
    button.disabled = true;
    try {
      render(
        await api("clear_archives", {
          confirmed: true,
        }),
      );
      button.disabled = false;
      resetDeleteButton(button);
      notice("Giveaway archives cleared.");
    } catch (x) {
      button.disabled = false;
      resetDeleteButton(button);
      notice(x.message, true);
    }
  };
  renderPresetFields();
  syncCustomBuilder();
  load();
})();
