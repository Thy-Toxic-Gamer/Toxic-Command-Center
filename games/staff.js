(() => {
  "use strict";

  const API_URL = "https://ubldjtsjfudogtgxakiq.supabase.co/functions/v1/game-requests-staff-api";
  const API_KEY = "sb_publishable_Fhl-Co0p5QNJKJ7ou2Te2Q_FD8BIywM";
  const REDIRECT_URI = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/appeals-center/";
  const PROVIDERS = {
    twitch: { clientId: "ht2kbpz12tpv060f2259jn9recng0x", tokenKey: "thy_toxic_appeals_twitch_token" },
    discord: { clientId: "1544711402873290873", tokenKey: "thy_toxic_appeals_discord_token" },
  };
  const ACTIVE_KEY = "thy_toxic_appeals_active_provider";
  const OAUTH_STATE_KEY = "thy_toxic_appeals_oauth_state";
  const OAUTH_PROVIDER_KEY = "thy_toxic_appeals_oauth_provider";
  const OAUTH_PURPOSE_KEY = "thy_toxic_appeals_oauth_purpose";
  const RETURN_KEY = "thy_toxic_appeals_return";
  const gate = document.querySelector("#staffGate");
  const workspace = document.querySelector("#staffWorkspace");
  const gateError = document.querySelector("#staffGateError");
  const notice = document.querySelector("#staffNotice");
  const queue = document.querySelector("#requestQueue");
  const archive = document.querySelector("#archiveList");
  const liveState = document.querySelector("#staffLiveState");
  const countdown = document.querySelector("#staffCountdown");
  let dashboardData = null;
  let countdownTimer = null;

  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const requestCode = (row) => `GR-${String(row.request_number).padStart(6, "0")}`;

  function randomState() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function activeProvider() {
    const stored = sessionStorage.getItem(ACTIVE_KEY);
    if (stored && PROVIDERS[stored] && sessionStorage.getItem(PROVIDERS[stored].tokenKey)) return stored;
    return Object.keys(PROVIDERS).find((platform) => sessionStorage.getItem(PROVIDERS[platform].tokenKey)) || null;
  }

  function startAuth(platform) {
    const provider = PROVIDERS[platform];
    if (!provider) return;
    const state = randomState();
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
    sessionStorage.setItem(OAUTH_PROVIDER_KEY, platform);
    sessionStorage.setItem(OAUTH_PURPOSE_KEY, "signin");
    sessionStorage.setItem(RETURN_KEY, "games-staff");
    const common = { response_type: "token", client_id: provider.clientId, redirect_uri: REDIRECT_URI, state };
    const query = new URLSearchParams(platform === "twitch"
      ? { ...common, scope: "user:read:email", force_verify: "true" }
      : { ...common, scope: "identify", prompt: "consent" });
    location.assign(`${platform === "twitch" ? "https://id.twitch.tv/oauth2/authorize" : "https://discord.com/oauth2/authorize"}?${query}`);
  }

  async function api(action, payload = {}) {
    const platform = activeProvider();
    const token = platform ? sessionStorage.getItem(PROVIDERS[platform].tokenKey) : null;
    if (!platform || !token) throw Object.assign(new Error("Staff sign-in is required."), { status: 401 });
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: API_KEY, Authorization: `Bearer ${token}`, "X-Game-Platform": platform },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) sessionStorage.removeItem(PROVIDERS[platform].tokenKey);
      throw Object.assign(new Error(data.error || "The staff service could not complete this request."), { status: response.status });
    }
    return data;
  }

  function setNotice(message, error = false) {
    notice.hidden = !message;
    notice.className = `staff-notice${error ? " error" : ""}`;
    notice.textContent = message || "";
  }

  function formatDate(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  function localDateTimeValue(value) {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function remainingLabel(value) {
    const remaining = new Date(value).getTime() - Date.now();
    if (remaining <= 0) return "Reopening now";
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }

  function renderAvailability(state) {
    liveState.classList.toggle("closed", !state.open);
    liveState.querySelector("strong").textContent = state.open ? "Requests open" : "Requests closed";
    liveState.querySelector("small").textContent = state.message;
    clearInterval(countdownTimer);
    if (state.reopensAt) {
      const update = () => { countdown.textContent = `Reopens in ${remainingLabel(state.reopensAt)}`; };
      update();
      countdownTimer = setInterval(update, 1000);
    } else countdown.textContent = state.activeRequest ? `${state.activeRequest.code} · ${state.activeRequest.status}` : "No reopening scheduled";
  }

  function requestCard(row) {
    const gameOptions = (dashboardData?.catalog || []).map((game) => `<option value="${escapeHtml(game.id)}"${game.id === row.game_id ? " selected" : ""}>${escapeHtml(game.title)} · ${escapeHtml(game.system)}</option>`).join("");
    const next = row.status === "pending"
      ? { status: row.is_owner ? "approved" : "awaiting_payment", label: row.is_owner ? "Approve request" : "Approve & request payment" }
      : row.status === "approved"
        ? { status: "scheduled", label: "Schedule request" }
        : row.status === "scheduled"
          ? { status: "completed", label: "Complete request" }
          : null;
    const paymentDeadline = row.status === "awaiting_payment" && row.payment_expires_at
      ? `<div class="workflow-state"><strong>Awaiting payment</strong><span>Expires ${formatDate(row.payment_expires_at)} · ${remainingLabel(row.payment_expires_at)} remaining</span></div>`
      : "";
    return `<article class="staff-request" data-request-id="${escapeHtml(row.id)}">
      <div class="staff-request-summary">${row.game_cover_url ? `<img class="staff-request-cover" src="${escapeHtml(row.game_cover_url)}" alt="${escapeHtml(row.game_title)} cover art">` : ""}<div><h3>${escapeHtml(row.game_title)}</h3><div class="staff-request-meta"><span>${requestCode(row)}</span><span>${escapeHtml(row.game_system)}</span><span>${escapeHtml(row.request_type)}</span><span>${escapeHtml(row.status.replaceAll("_", " "))}</span><span>${row.is_owner ? "$0 · Owner" : `$${Number(row.amount_due).toFixed(2)}`}</span><span>${row.is_owner ? "Payment exempt" : row.paypal_status === "COMPLETED" ? "PayPal verified" : "Payment pending"}</span><span>${escapeHtml(row.twitch_display_name)}</span></div><p>Submitted ${formatDate(row.created_at)}${row.payment_completed_at ? ` · Paid ${formatDate(row.payment_completed_at)}` : ""}</p></div></div>
      <div class="request-actions">
        ${row.pending_change_game_id ? `<div class="pending-game-change"><strong>Viewer game change requested</strong><span>${escapeHtml(row.pending_change_game_title)} · ${escapeHtml(row.pending_change_game_system)}</span><div><button type="button" data-resolve-change="apply">Apply change</button><button class="change-deny" type="button" data-resolve-change="deny">Deny change</button></div></div>` : ""}
        ${paymentDeadline}
        ${row.status === "approved" ? `<label class="action-field status-field schedule-field"><span>Scheduled date and time</span><input data-scheduled-for type="datetime-local" value="${escapeHtml(localDateTimeValue(row.scheduled_for))}" required></label>` : '<input data-scheduled-for type="hidden">'}
        ${row.status === "scheduled" ? `<div class="action-field status-field vod-field"><span>YouTube VOD link</span><div class="vod-control"><input data-youtube-vod type="url" inputmode="url" maxlength="500" aria-label="YouTube VOD link" placeholder="Automatically uses the latest completed stream" value="${escapeHtml(row.youtube_vod_url || "")}"><button type="button" data-latest-vod>Use latest VOD</button></div><small data-vod-result>The latest completed YouTube livestream will be attached.</small></div>` : '<input data-youtube-vod type="hidden">'}
        ${next ? `<button class="workflow-primary" type="button" data-next-status="${next.status}">${next.label}</button>` : ""}
        <label class="action-field note-field"><span>Staff note <small>optional</small></span><input data-staff-note maxlength="1000" placeholder="Reason or update details"></label>
        <label class="action-field secondary-field"><span>Other action</span><select data-secondary-status><option value="">Choose only when needed</option><option value="denied">Deny request</option><option value="cancelled">Cancel request</option><option value="expired">Expire now</option></select></label>
        <button class="secondary-action" type="button" data-secondary-action>Apply other action</button>
        <label class="action-field game-change-field"><span>Staff game correction <small>unlimited</small></span><select data-game-change>${gameOptions}</select></label>
        <button class="change-game" type="button" data-change-game>Change game</button>
      </div>
    </article>`;
  }

  function setWorkflowFields(card) {
    const scheduledInput = card.querySelector("[data-scheduled-for]");
    if (scheduledInput?.type === "datetime-local") scheduledInput.min = localDateTimeValue(new Date(Date.now() + 60000).toISOString());
  }

  async function loadLatestVod(card, automatic = false) {
    const input = card.querySelector("[data-youtube-vod]");
    const button = card.querySelector("[data-latest-vod]");
    const result = card.querySelector("[data-vod-result]");
    if (!input || !button || !result) return;
    button.disabled = true;
    result.textContent = "Loading the latest completed YouTube livestream…";
    try {
      const data = await api("latest_youtube_vod");
      input.value = data.vod.url;
      const published = data.vod.publishedAt ? ` · ${formatDate(data.vod.publishedAt)}` : "";
      result.textContent = `${data.vod.title}${published}`;
      if (!automatic) setNotice("The latest completed YouTube VOD is ready.");
    } catch (error) {
      result.textContent = `${error.message} You can still paste the VOD link manually.`;
      if (!automatic) setNotice(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function archiveCard(row, isOwner) {
    return `<article class="staff-request archive" data-request-id="${escapeHtml(row.id)}">
      <div><h3>${escapeHtml(row.game_title)}</h3><div class="staff-request-meta"><span>${requestCode(row)}</span><span>${escapeHtml(row.status)}</span><span>${escapeHtml(row.request_type)}</span><span>${escapeHtml(row.twitch_display_name)}</span><span>${formatDate(row.updated_at)}</span></div>${row.resolution_note ? `<p>${escapeHtml(row.resolution_note)}</p>` : ""}</div>
      ${isOwner ? '<div class="request-actions"><button class="delete-archive" type="button" data-delete-request>Delete permanently</button></div>' : ""}
    </article>`;
  }

  function render(data) {
    dashboardData = data;
    gate.hidden = true;
    workspace.hidden = false;
    document.querySelector("#staffAccount").hidden = false;
    document.querySelector("#staffAvatar").src = data.staff.avatarUrl || "thytoxicgamer-tab-icon.png";
    document.querySelector("#staffAvatar").alt = `${data.staff.displayName} avatar`;
    document.querySelector("#staffName").textContent = data.staff.displayName;
    document.querySelector("#staffRole").textContent = data.staff.role === "owner" ? "Owner" : data.staff.role === "admin" ? "Administrator" : "Moderator";
    renderAvailability(data.availability);
    document.querySelector("#queueCount").textContent = `${data.queue.length} active`;
    document.querySelector("#archiveCount").textContent = `${data.archive.length} archived`;
    queue.innerHTML = data.queue.length ? data.queue.map(requestCard).join("") : '<div class="empty-staff">No active request.</div>';
    queue.querySelectorAll("[data-request-id]").forEach(setWorkflowFields);
    archive.innerHTML = data.archive.length ? data.archive.map((row) => archiveCard(row, data.staff.role === "owner")).join("") : '<div class="empty-staff">No archived requests yet.</div>';
  }

  async function loadDashboard() {
    if (!activeProvider()) return;
    try { render(await api("dashboard")); }
    catch (error) {
      gate.hidden = false;
      workspace.hidden = true;
      document.querySelector("#staffAccount").hidden = true;
      gateError.hidden = false;
      gateError.textContent = error.message;
    }
  }

  document.querySelectorAll("[data-staff-signin]").forEach((button) => button.addEventListener("click", () => startAuth(button.dataset.staffSignin)));
  document.querySelector("#staffSignOut").addEventListener("click", () => {
    const platform = activeProvider();
    if (platform) sessionStorage.removeItem(PROVIDERS[platform].tokenKey);
    sessionStorage.removeItem(ACTIVE_KEY);
    location.reload();
  });
  document.querySelector("#openRequests").addEventListener("click", async () => {
    setNotice("Opening requests…");
    try { render(await api("set_availability", { desired: "open" })); setNotice("Game requests are open."); }
    catch (error) { setNotice(error.message, true); }
  });
  document.querySelector("#closeRequestsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = document.querySelector("#reopensAt").value;
    const reopensAt = raw ? new Date(raw).toISOString() : null;
    setNotice("Closing requests…");
    try { render(await api("set_availability", { desired: "closed", message: document.querySelector("#closedMessage").value, reopensAt })); setNotice(reopensAt ? `Requests will reopen ${formatDate(reopensAt)}.` : "Requests are closed until staff reopens them."); }
    catch (error) { setNotice(error.message, true); }
  });
  queue.addEventListener("click", async (event) => {
    const vodButton = event.target.closest("[data-latest-vod]");
    if (vodButton) {
      await loadLatestVod(vodButton.closest("[data-request-id]"));
      return;
    }
    const changeButton = event.target.closest("[data-change-game]");
    const resolveButton = event.target.closest("[data-resolve-change]");
    if (changeButton || resolveButton) {
      const card = (changeButton || resolveButton).closest("[data-request-id]");
      const note = card.querySelector("[data-staff-note]").value.trim();
      const mode = resolveButton ? resolveButton.dataset.resolveChange : "direct";
      if (mode === "deny" && !note) { setNotice("Add a reason before denying the viewer's game change.", true); card.querySelector("[data-staff-note]").focus(); return; }
      const button = changeButton || resolveButton;
      button.disabled = true;
      try {
        render(await api("change_game", { id: card.dataset.requestId, mode, gameId: card.querySelector("[data-game-change]").value, note }));
        setNotice(mode === "deny" ? "Viewer game change denied and added to the request history." : "Game changed in the website, Discord record, and request history.");
      } catch (error) { setNotice(error.message, true); button.disabled = false; }
      return;
    }
    const primaryButton = event.target.closest("[data-next-status]");
    const secondaryButton = event.target.closest("[data-secondary-action]");
    if (!primaryButton && !secondaryButton) return;
    const button = primaryButton || secondaryButton;
    const card = button.closest("[data-request-id]");
    const status = primaryButton ? primaryButton.dataset.nextStatus : card.querySelector("[data-secondary-status]").value;
    const noteInput = card.querySelector("[data-staff-note]");
    if (!status) { setNotice("Choose an action first.", true); return; }
    if (status === "cancelled" && !noteInput.value.trim()) { setNotice("Add a cancellation reason first.", true); noteInput.focus(); return; }
    const scheduledInput = card.querySelector("[data-scheduled-for]");
    if (status === "scheduled" && !scheduledInput.reportValidity()) return;
    const vodInput = card.querySelector("[data-youtube-vod]");
    button.disabled = true;
    if (status === "completed" && !vodInput.value) {
      await loadLatestVod(card, true);
      if (!vodInput.value) { button.disabled = false; setNotice("Add a YouTube VOD link before completing the request.", true); return; }
    }
    const scheduledRaw = scheduledInput.value;
    try {
      render(await api("update_request", {
        id: card.dataset.requestId,
        status,
        note: noteInput.value,
        scheduledFor: scheduledRaw ? new Date(scheduledRaw).toISOString() : null,
        youtubeVodUrl: vodInput.value,
      }));
      setNotice(status === "awaiting_payment" ? "Payment requested. The 24-hour timer is running." : status === "scheduled" ? "Request scheduled." : status === "completed" ? "Request completed with the YouTube VOD attached." : "Request updated in the website and Discord.");
    } catch (error) { setNotice(error.message, true); button.disabled = false; }
  });
  archive.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-request]");
    if (!button) return;
    if (!confirm("Permanently delete this archived request? This cannot be undone.")) return;
    button.disabled = true;
    try { render(await api("delete_request", { id: button.closest("[data-request-id]").dataset.requestId })); setNotice("Archived request permanently deleted."); }
    catch (error) { setNotice(error.message, true); button.disabled = false; }
  });

  const authError = sessionStorage.getItem("thy_toxic_appeals_auth_error");
  if (authError) { sessionStorage.removeItem("thy_toxic_appeals_auth_error"); gateError.hidden = false; gateError.textContent = authError; }
  loadDashboard();
  setInterval(() => { if (dashboardData && document.visibilityState === "visible") loadDashboard(); }, 30000);
})();
