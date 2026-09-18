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
    const statuses = ["pending", "awaiting_payment", "approved", "scheduled", "completed", "denied", "cancelled", "expired"];
    return `<article class="staff-request" data-request-id="${escapeHtml(row.id)}">
      <div><h3>${escapeHtml(row.game_title)}</h3><div class="staff-request-meta"><span>${requestCode(row)}</span><span>${escapeHtml(row.game_system)}</span><span>${escapeHtml(row.request_type)}</span><span>${escapeHtml(row.status.replaceAll("_", " "))}</span><span>${row.is_owner ? "$0 · Owner" : `$${Number(row.amount_due).toFixed(2)}`}</span><span>${escapeHtml(row.twitch_display_name)}</span></div><p>Submitted ${formatDate(row.created_at)}</p></div>
      <div class="request-actions"><select aria-label="Request status">${statuses.map((status) => `<option value="${status}"${status === row.status ? " selected" : ""}>${status.replaceAll("_", " ")}</option>`).join("")}</select><button type="button" data-update-request>Update</button><input maxlength="1000" placeholder="Optional staff note" aria-label="Staff note"></div>
    </article>`;
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
    const button = event.target.closest("[data-update-request]");
    if (!button) return;
    const card = button.closest("[data-request-id]");
    button.disabled = true;
    try { render(await api("update_request", { id: card.dataset.requestId, status: card.querySelector("select").value, note: card.querySelector("input").value })); setNotice("Request updated."); }
    catch (error) { setNotice(error.message, true); button.disabled = false; }
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
