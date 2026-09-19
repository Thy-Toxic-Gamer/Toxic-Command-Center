(() => {
  "use strict";

  const API_URL = "https://ubldjtsjfudogtgxakiq.supabase.co/functions/v1/polls-api";
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
  const notice = document.querySelector("#staffNotice");
  const choiceInputs = document.querySelector("#choiceInputs");
  let data = null;
  let busy = false;

  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

  function randomState() {
    const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function activeProvider() {
    const stored = sessionStorage.getItem(ACTIVE_KEY);
    if (stored && PROVIDERS[stored] && sessionStorage.getItem(PROVIDERS[stored].tokenKey)) return stored;
    return Object.keys(PROVIDERS).find((platform) => sessionStorage.getItem(PROVIDERS[platform].tokenKey)) || null;
  }

  function startAuth(platform) {
    const provider = PROVIDERS[platform];
    const oauthState = randomState();
    sessionStorage.setItem(OAUTH_STATE_KEY, oauthState);
    sessionStorage.setItem(OAUTH_PROVIDER_KEY, platform);
    sessionStorage.setItem(OAUTH_PURPOSE_KEY, "signin");
    sessionStorage.setItem(RETURN_KEY, "polls-staff");
    const common = { response_type: "token", client_id: provider.clientId, redirect_uri: REDIRECT_URI, state: oauthState };
    const query = new URLSearchParams(platform === "twitch" ? { ...common, scope: "user:read:email", force_verify: "true" } : { ...common, scope: "identify", prompt: "consent" });
    location.assign(`${platform === "twitch" ? "https://id.twitch.tv/oauth2/authorize" : "https://discord.com/oauth2/authorize"}?${query}`);
  }

  async function api(action, payload = {}) {
    const platform = activeProvider();
    const token = platform ? sessionStorage.getItem(PROVIDERS[platform].tokenKey) : null;
    if (!platform || !token) throw Object.assign(new Error("Staff sign-in is required."), { status: 401 });
    const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json", apikey: API_KEY, Authorization: `Bearer ${token}`, "X-Polls-Platform": platform }, body: JSON.stringify({ action, ...payload }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) sessionStorage.removeItem(PROVIDERS[platform].tokenKey);
      throw Object.assign(new Error(result.error || "The poll staff service could not complete this request."), { status: response.status });
    }
    return result;
  }

  function setNotice(message, error = false) { notice.hidden = !message; notice.textContent = message || ""; notice.className = `notice${error ? " error" : ""}`; }
  function formatDate(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "No automatic close"; }

  function pollCard(poll, closed = false) {
    const options = poll.options.map((option) => `<div class="poll-option" style="--percent:${option.percent}%"><span class="option-label">${escapeHtml(option.label)}</span><span class="option-result">${option.count} · ${option.percent}%</span></div>`).join("");
    return `<article class="poll-card${closed ? " closed" : ""}" data-poll-id="${escapeHtml(poll.id)}"><div class="poll-meta"><span>${escapeHtml(poll.code)}</span><span>${closed ? "Closed" : "Open"}</span></div><h3>${escapeHtml(poll.question)}</h3>${poll.description ? `<p class="poll-description">${escapeHtml(poll.description)}</p>` : ""}<div class="poll-options">${options}</div><div class="poll-foot"><span>${poll.totalVotes} votes</span><span>${closed ? `Closed ${formatDate(poll.closedAt)}` : `Ends ${formatDate(poll.closesAt)}`}</span></div>${closed ? "" : '<button class="close-poll" type="button">Close poll and publish final results</button>'}</article>`;
  }

  function render(next) {
    data = next;
    gate.hidden = true; workspace.hidden = false;
    document.querySelector("#staffAccount").hidden = false;
    document.querySelector("#staffAvatar").src = next.staff.avatarUrl || "../tab-icon.png";
    document.querySelector("#staffName").textContent = next.staff.displayName;
    document.querySelector("#staffRole").textContent = next.staff.role === "owner" ? "Owner" : next.staff.role === "admin" ? "Administrator" : "Moderator";
    document.querySelector("#staffOpenPolls").innerHTML = next.open.length ? next.open.map((poll) => pollCard(poll)).join("") : '<div class="empty">No open polls.</div>';
    document.querySelector("#staffClosedPolls").innerHTML = next.closed.length ? next.closed.map((poll) => pollCard(poll, true)).join("") : '<div class="empty">No closed polls.</div>';
    document.querySelector("#dangerZone").hidden = next.staff.role !== "owner";
  }

  function addChoice(value = "") {
    if (choiceInputs.children.length >= 10) return;
    const row = document.createElement("div"); row.className = "choice-row";
    row.innerHTML = `<b>${choiceInputs.children.length + 1}</b><input maxlength="100" required placeholder="Choice ${choiceInputs.children.length + 1}" value="${escapeHtml(value)}"><button type="button" aria-label="Remove choice">×</button>`;
    choiceInputs.append(row);
  }

  function renumberChoices() { [...choiceInputs.children].forEach((row, index) => { row.querySelector("b").textContent = index + 1; row.querySelector("input").placeholder = `Choice ${index + 1}`; }); }

  async function load(silent = false) {
    if (!activeProvider()) return;
    try { render(await api("dashboard")); if (!silent) setNotice(""); }
    catch (error) {
      if (error.status === 401 || error.status === 403) { gate.hidden = false; workspace.hidden = true; document.querySelector("#staffAccount").hidden = true; document.querySelector("#staffGateError").hidden = false; document.querySelector("#staffGateError").textContent = error.message; }
      else if (!silent) setNotice(error.message, true);
    }
  }

  document.querySelectorAll("[data-staff-signin]").forEach((button) => button.addEventListener("click", () => startAuth(button.dataset.staffSignin)));
  document.querySelector("#staffSignOut").addEventListener("click", () => { const platform = activeProvider(); if (platform) sessionStorage.removeItem(PROVIDERS[platform].tokenKey); sessionStorage.removeItem(ACTIVE_KEY); location.reload(); });
  document.querySelector("#addChoice").addEventListener("click", () => addChoice());
  choiceInputs.addEventListener("click", (event) => { const button = event.target.closest("button"); if (!button || choiceInputs.children.length <= 2) return; button.closest(".choice-row").remove(); renumberChoices(); });
  document.querySelector("#createPollForm").addEventListener("submit", async (event) => {
    event.preventDefault(); if (busy) return;
    const options = [...choiceInputs.querySelectorAll("input")].map((input) => input.value.trim()).filter(Boolean);
    busy = true; event.submitter.disabled = true;
    try {
      const next = await api("create_poll", { question: document.querySelector("#pollQuestion").value, description: document.querySelector("#pollDescription").value, options, durationMinutes: Number(document.querySelector("#pollDuration").value) });
      render(next); event.target.reset(); choiceInputs.innerHTML = ""; addChoice(); addChoice(); setNotice("Poll created and posted to Discord.");
    } catch (error) { setNotice(error.message, true); }
    finally { busy = false; event.submitter.disabled = false; }
  });
  document.querySelector("#staffOpenPolls").addEventListener("click", async (event) => {
    const button = event.target.closest(".close-poll"); if (!button || busy) return;
    if (!confirm("Close this poll now and publish the final results?")) return;
    busy = true; button.disabled = true;
    try { render(await api("close_poll", { id: button.closest("[data-poll-id]").dataset.pollId })); setNotice("Poll closed and final results published."); }
    catch (error) { setNotice(error.message, true); }
    finally { busy = false; }
  });
  document.querySelector("#clearPolls").addEventListener("click", async () => {
    const confirmation = prompt("Type CLEAR ALL POLLS to archive every poll.");
    if (confirmation === null) return;
    try { render(await api("clear_polls", { confirmation })); setNotice("All polls were archived. Discord final records were preserved."); }
    catch (error) { setNotice(error.message, true); }
  });

  addChoice(); addChoice();
  setInterval(() => { if (!busy && !document.hidden && activeProvider()) load(true); }, 15000);
  load();
})();
