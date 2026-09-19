(() => {
  "use strict";

  const API_URL = "https://ubldjtsjfudogtgxakiq.supabase.co/functions/v1/polls-api";
  const API_KEY = "sb_publishable_Fhl-Co0p5QNJKJ7ou2Te2Q_FD8BIywM";
  const TWITCH_CLIENT_ID = "ht2kbpz12tpv060f2259jn9recng0x";
  const REDIRECT_URI = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/appeals-center/";
  const TOKEN_KEY = "thy_toxic_appeals_twitch_token";
  const OAUTH_STATE_KEY = "thy_toxic_appeals_oauth_state";
  const OAUTH_PROVIDER_KEY = "thy_toxic_appeals_oauth_provider";
  const OAUTH_PURPOSE_KEY = "thy_toxic_appeals_oauth_purpose";
  const RETURN_KEY = "thy_toxic_appeals_return";
  const openPolls = document.querySelector("#openPolls");
  const closedPolls = document.querySelector("#closedPolls");
  const notice = document.querySelector("#notice");
  let state = { viewer: null, open: [], closed: [] };
  let busy = false;

  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

  function randomState() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function startAuth() {
    const oauthState = randomState();
    sessionStorage.setItem(OAUTH_STATE_KEY, oauthState);
    sessionStorage.setItem(OAUTH_PROVIDER_KEY, "twitch");
    sessionStorage.setItem(OAUTH_PURPOSE_KEY, "signin");
    sessionStorage.setItem(RETURN_KEY, "polls");
    const query = new URLSearchParams({ response_type: "token", client_id: TWITCH_CLIENT_ID, redirect_uri: REDIRECT_URI, state: oauthState, scope: "user:read:email", force_verify: "true" });
    location.assign(`https://id.twitch.tv/oauth2/authorize?${query}`);
  }

  async function api(action, payload = {}) {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const headers = { "Content-Type": "application/json", apikey: API_KEY, "X-Polls-Platform": "twitch" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify({ action, ...payload }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) sessionStorage.removeItem(TOKEN_KEY);
      throw Object.assign(new Error(data.error || "The Poll Center could not complete this request."), { status: response.status });
    }
    return data;
  }

  function setNotice(message, error = false) {
    notice.hidden = !message;
    notice.textContent = message || "";
    notice.className = `notice${error ? " error" : ""}`;
  }

  function formatDate(value) {
    if (!value) return "No automatic close";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  function remaining(value) {
    if (!value) return "Open until staff closes it";
    const difference = new Date(value).getTime() - Date.now();
    if (difference <= 0) return "Closing now";
    const days = Math.floor(difference / 86400000);
    const hours = Math.floor((difference % 86400000) / 3600000);
    const minutes = Math.floor((difference % 3600000) / 60000);
    const seconds = Math.floor((difference % 60000) / 1000);
    return `${days ? `${days}d ` : ""}${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }

  function pollCard(poll, closed = false) {
    const options = poll.options.map((option) => `<button class="poll-option${poll.viewerOptionId === option.id ? " selected" : ""}" style="--percent:${option.percent}%" type="button" data-poll-id="${escapeHtml(poll.id)}" data-option-id="${escapeHtml(option.id)}" ${closed || busy ? "disabled" : ""}><span class="option-label">${escapeHtml(option.label)}${poll.viewerOptionId === option.id ? " · Your vote" : ""}</span><span class="option-result">${option.count} · ${option.percent}%</span></button>`).join("");
    return `<article class="poll-card${closed ? " closed" : ""}">
      <div class="poll-meta"><span>${escapeHtml(poll.code)}</span><span>${closed ? "Final" : "Voting open"}</span></div>
      <h3>${escapeHtml(poll.question)}</h3>${poll.description ? `<p class="poll-description">${escapeHtml(poll.description)}</p>` : ""}
      ${!closed ? `<time class="poll-timer" data-deadline="${escapeHtml(poll.closesAt || "")}">${escapeHtml(remaining(poll.closesAt))}</time>` : ""}
      <div class="poll-options">${options}</div>
      <div class="poll-foot"><span>${poll.totalVotes} vote${poll.totalVotes === 1 ? "" : "s"}</span><span>${closed ? `Closed ${formatDate(poll.closedAt)}` : `Ends ${formatDate(poll.closesAt)}`}</span></div>
      ${!closed && !state.viewer ? '<p class="signin-hint">Sign in with Twitch to vote. Results remain visible to everyone.</p>' : ""}
    </article>`;
  }

  function render() {
    document.querySelector("#openCount").textContent = `${state.open.length} open`;
    openPolls.innerHTML = state.open.length ? state.open.map((poll) => pollCard(poll)).join("") : '<div class="empty">There are no open polls right now.</div>';
    closedPolls.innerHTML = state.closed.length ? state.closed.map((poll) => pollCard(poll, true)).join("") : '<div class="empty">No completed polls yet.</div>';
    const signIn = document.querySelector("#twitchSignIn");
    const viewer = document.querySelector("#viewer");
    const staffControlsLink = document.querySelector("#staffControlsLink");
    signIn.hidden = Boolean(state.viewer);
    viewer.hidden = !state.viewer;
    staffControlsLink.hidden = !state.viewer?.isStaff;
    if (state.viewer) {
      document.querySelector("#viewerAvatar").src = state.viewer.avatarUrl || "../tab-icon.png";
      document.querySelector("#viewerName").textContent = state.viewer.displayName;
      document.querySelector("#viewerRole").textContent = state.viewer.isStaff
        ? `${state.viewer.staffRole || "staff"} · Poll controls`
        : "Twitch voter";
    }
  }

  async function load(silent = false) {
    try {
      const action = sessionStorage.getItem(TOKEN_KEY) ? "viewer_state" : "public_state";
      state = await api(action);
      render();
      if (!silent) setNotice("");
    } catch (error) {
      if (error.status === 401) {
        state = await api("public_state");
        render();
      } else if (!silent) setNotice(error.message, true);
    }
  }

  document.querySelector("#twitchSignIn").addEventListener("click", startAuth);
  document.querySelector("#signOut").addEventListener("click", () => { sessionStorage.removeItem(TOKEN_KEY); state.viewer = null; load(); });
  openPolls.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-option-id]");
    if (!button || busy) return;
    if (!state.viewer) { setNotice("Sign in with Twitch, then choose your answer again."); startAuth(); return; }
    busy = true;
    render();
    try {
      state = await api("vote", { pollId: button.dataset.pollId, optionId: button.dataset.optionId });
      setNotice("Your vote is saved. You can change it until the poll closes.");
    } catch (error) { setNotice(error.message, true); }
    finally { busy = false; render(); }
  });

  setInterval(() => document.querySelectorAll("[data-deadline]").forEach((element) => { element.textContent = remaining(element.dataset.deadline); }), 1000);
  setInterval(() => { if (!busy && !document.hidden) load(true); }, 15000);
  load();
})();
