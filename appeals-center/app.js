"use strict";

const API_URL = "https://ubldjtsjfudogtgxakiq.supabase.co/functions/v1/appeals-api";
const API_KEY = "sb_publishable_Fhl-Co0p5QNJKJ7ou2Te2Q_FD8BIywM";
const REDIRECT_URI = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/appeals-center/";
const PROVIDERS = {
  twitch: { label: "Twitch", clientId: "ht2kbpz12tpv060f2259jn9recng0x", tokenKey: "thy_toxic_appeals_twitch_token" },
  discord: { label: "Discord", clientId: "1544711402873290873", tokenKey: "thy_toxic_appeals_discord_token" },
};
const ACTIVE_KEY = "thy_toxic_appeals_active_provider";
const OAUTH_STATE_KEY = "thy_toxic_appeals_oauth_state";
const OAUTH_PROVIDER_KEY = "thy_toxic_appeals_oauth_provider";
const OAUTH_PURPOSE_KEY = "thy_toxic_appeals_oauth_purpose";
const RETURN_KEY = "thy_toxic_appeals_return";
const AFTER_AUTH_VIEW_KEY = "thy_toxic_appeals_after_auth_view";
const LINK_PENDING_KEY = "thy_toxic_appeals_link_pending";
const OPEN_STATUSES = new Set(["submitted", "active", "appealed", "under_review", "needs_information", "accepted_pending_reversal"]);
const STATUS_LABELS = {
  pending: "Pending", active: "Active", submitted: "Submitted", appealed: "Appealed",
  under_review: "Under review", needs_information: "Needs information",
  accepted_pending_reversal: "Accepted · reversal pending", accepted: "Accepted",
  denied: "Denied", reversed: "Reversed", closed: "Closed", failed: "Action failed", archived: "Archived",
};
const STAFF_STATUSES = ["submitted", "under_review", "needs_information", "accepted", "denied", "closed", "archived"];
const appState = { viewer: null, identities: { twitch: null, discord: null }, staff: null, cases: [], selected: null, filter: "all", view: "submit" };
const byId = (id) => document.getElementById(id);
const providerLabel = (platform) => PROVIDERS[platform]?.label || platform;

function randomState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function activeProvider() {
  const stored = sessionStorage.getItem(ACTIVE_KEY);
  if (stored && PROVIDERS[stored] && sessionStorage.getItem(PROVIDERS[stored].tokenKey)) return stored;
  return Object.keys(PROVIDERS).find((key) => sessionStorage.getItem(PROVIDERS[key].tokenKey)) || "twitch";
}

function startAuth(platform, returnTo = "./", purpose = "signin") {
  if (!PROVIDERS[platform]) return;
  const state = randomState();
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  sessionStorage.setItem(OAUTH_PROVIDER_KEY, platform);
  sessionStorage.setItem(OAUTH_PURPOSE_KEY, purpose);
  const safeReturn = returnTo === "staff.html" ? "staff.html" : returnTo === "track" ? "track" : "./";
  sessionStorage.setItem(RETURN_KEY, safeReturn);
  const common = { response_type: "token", client_id: PROVIDERS[platform].clientId, redirect_uri: REDIRECT_URI, state };
  const query = new URLSearchParams(platform === "twitch"
    ? { ...common, scope: "user:read:email", force_verify: "true" }
    : { ...common, scope: "identify", prompt: "consent" });
  const endpoint = platform === "twitch" ? "https://id.twitch.tv/oauth2/authorize" : "https://discord.com/oauth2/authorize";
  location.assign(`${endpoint}?${query}`);
}

function completeOAuthReturn() {
  if (!location.hash || location.hash.length < 2) return false;
  const hash = new URLSearchParams(location.hash.slice(1));
  const expected = sessionStorage.getItem(OAUTH_STATE_KEY) || "";
  const platform = sessionStorage.getItem(OAUTH_PROVIDER_KEY) || "twitch";
  const purpose = sessionStorage.getItem(OAUTH_PURPOSE_KEY) || "signin";
  const token = hash.get("access_token");
  const error = hash.get("error_description") || hash.get("error");
  history.replaceState(null, "", REDIRECT_URI);
  [OAUTH_STATE_KEY, OAUTH_PROVIDER_KEY, OAUTH_PURPOSE_KEY].forEach((key) => sessionStorage.removeItem(key));
  if (error || !token || !expected || hash.get("state") !== expected || !PROVIDERS[platform]) {
    sessionStorage.setItem("thy_toxic_appeals_auth_error", error || "Sign-in could not be verified. Please try again.");
    return true;
  }
  sessionStorage.setItem(PROVIDERS[platform].tokenKey, token);
  if (purpose === "link") sessionStorage.setItem(LINK_PENDING_KEY, platform);
  else sessionStorage.setItem(ACTIVE_KEY, platform);
  const returnTo = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  if (returnTo === "staff.html") {
    sessionStorage.setItem(ACTIVE_KEY, "twitch");
    location.replace("staff.html");
    return "redirecting";
  }
  if (returnTo === "track") sessionStorage.setItem(AFTER_AUTH_VIEW_KEY, "track");
  return true;
}

function signOut(destination = null) {
  Object.values(PROVIDERS).forEach((provider) => sessionStorage.removeItem(provider.tokenKey));
  [ACTIVE_KEY, LINK_PENDING_KEY, AFTER_AUTH_VIEW_KEY].forEach((key) => sessionStorage.removeItem(key));
  const next = typeof destination === "string" ? destination : document.body.dataset.page === "staff" ? "staff.html" : "./";
  location.replace(next);
}

function switchTwitchAccount(returnTo = "./") {
  sessionStorage.removeItem(PROVIDERS.twitch.tokenKey);
  sessionStorage.setItem(ACTIVE_KEY, "twitch");
  startAuth("twitch", returnTo);
}

async function api(action, payload = {}, options = {}) {
  const platform = options.platform || activeProvider();
  const token = sessionStorage.getItem(PROVIDERS[platform]?.tokenKey || "");
  if (!token) throw Object.assign(new Error(`Sign in with ${providerLabel(platform)} to continue.`), { status: 401 });
  const headers = {
    "Content-Type": "application/json", apikey: API_KEY,
    Authorization: `Bearer ${token}`, "X-Appeals-Platform": platform,
  };
  if (options.linkPlatform) {
    const linkToken = sessionStorage.getItem(PROVIDERS[options.linkPlatform].tokenKey);
    if (!linkToken) throw new Error(`Verify ${providerLabel(options.linkPlatform)} before linking.`);
    headers["X-Link-Platform"] = options.linkPlatform;
    headers["X-Link-Authorization"] = `Bearer ${linkToken}`;
  }
  const response = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify({ action, ...payload }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) sessionStorage.removeItem(PROVIDERS[platform].tokenKey);
    throw Object.assign(new Error(data.error || "The Appeals service could not complete this request."), { status: response.status });
  }
  return data;
}

function setNotice(element, kind, message) {
  if (!element) return;
  if (!message) { element.hidden = true; element.textContent = ""; return; }
  element.className = `notice notice--${kind}`;
  element.replaceChildren();
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", kind === "success" ? "circle-check" : "triangle-alert");
  const text = document.createElement("span"); text.textContent = message;
  element.append(icon, text); element.hidden = false;
  if (window.lucide) window.lucide.createIcons();
}

function providerIcon(platform) {
  const span = document.createElement("span");
  span.className = `provider-icon provider-icon--${platform}`;
  span.innerHTML = platform === "twitch"
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 2 1 5v15h5v3l3-3h4l7-7V2H4Zm14 10-4 4h-4l-3 3v-3H3V4h15v8Zm-3-6h-2v6h2V6Zm-5 0H8v6h2V6Z"></path></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.5 5.34A16.3 16.3 0 0 0 15.44 4l-.5 1.03a15.1 15.1 0 0 0-5.86 0L8.56 4A16.5 16.5 0 0 0 4.5 5.35C1.93 9.16 1.24 12.88 1.6 16.55a16.7 16.7 0 0 0 4.98 2.5l1.2-1.64a10.6 10.6 0 0 1-1.88-.9l.46-.35c3.63 1.68 7.58 1.68 11.17 0l.47.35c-.6.35-1.24.65-1.89.9l1.2 1.64a16.6 16.6 0 0 0 4.98-2.5c.43-4.25-.74-7.94-2.79-11.21ZM8.52 14.3c-1.09 0-1.98-1-1.98-2.22s.87-2.22 1.98-2.22 2 .99 1.98 2.22c0 1.23-.88 2.22-1.98 2.22Zm6.96 0c-1.09 0-1.98-1-1.98-2.22s.87-2.22 1.98-2.22 2 .99 1.98 2.22c0 1.23-.87 2.22-1.98 2.22Z"></path></svg>';
  return span;
}

function selectedPlatform() { return byId("appeal-platform")?.value || appState.viewer?.platform || "twitch"; }

function renderIdentityCard() {
  const platform = selectedPlatform();
  const identity = appState.identities[platform];
  const iconSlot = byId("identity-icon");
  if (!iconSlot) return;
  iconSlot.replaceChildren(providerIcon(platform));
  byId("identity-card").classList.toggle("identity-card--verified", Boolean(identity));
  if (identity) {
    byId("identity-title").textContent = `Verified as ${identity.displayName || identity.login}`;
    byId("identity-copy").textContent = `${providerLabel(platform)} ID ${identity.id} · This verified identity will be attached to your appeal.`;
    byId("submit-button").innerHTML = 'Submit appeal <i data-lucide="arrow-right"></i>';
  } else {
    byId("identity-title").textContent = `Verify your ${providerLabel(platform)} account`;
    byId("identity-copy").textContent = appState.viewer
      ? `Securely link ${providerLabel(platform)} before accessing its cases.`
      : "Your verified platform identity will be attached securely to this appeal.";
    byId("submit-button").innerHTML = `Verify ${providerLabel(platform)} and continue <i data-lucide="arrow-right"></i>`;
  }
  const reference = byId("punishment-reference");
  reference.required = platform === "discord";
  reference.placeholder = platform === "discord" ? "TTG-MOD-000006" : "Date, message, or case note";
  byId("reference-optional").textContent = platform === "discord" ? "required" : "optional";
  if (window.lucide) window.lucide.createIcons();
}

function addSignInChoice(container, platform) {
  const button = document.createElement("button");
  button.type = "button"; button.className = `provider-button provider-button--${platform}`;
  button.append(providerIcon(platform), document.createTextNode(`Continue with ${providerLabel(platform)}`));
  button.addEventListener("click", () => startAuth(platform, appState.view === "track" ? "track" : "./"));
  container.append(button);
}

function renderPortalAccount() {
  const slot = byId("account-slot"); slot.replaceChildren();
  if (!appState.viewer) {
    const wrapper = document.createElement("div"); wrapper.className = "signin-menu";
    const trigger = document.createElement("button"); trigger.type = "button"; trigger.className = "signin-trigger";
    trigger.innerHTML = 'Sign in <i data-lucide="chevron-down"></i>';
    const menu = document.createElement("div"); menu.className = "signin-menu__panel"; menu.hidden = true;
    addSignInChoice(menu, "twitch"); addSignInChoice(menu, "discord");
    trigger.addEventListener("click", () => { menu.hidden = !menu.hidden; });
    wrapper.append(trigger, menu); slot.append(wrapper);
    byId("track-guest").hidden = false; byId("track-auth").hidden = true;
    renderIdentityCard(); if (window.lucide) window.lucide.createIcons(); return;
  }
  if (appState.viewer.avatarUrl) {
    const avatar = document.createElement("img"); avatar.className = "avatar"; avatar.src = appState.viewer.avatarUrl; avatar.alt = ""; slot.append(avatar);
  } else slot.append(providerIcon(appState.viewer.platform));
  const name = document.createElement("span"); name.className = "account-name"; name.textContent = appState.viewer.displayName || appState.viewer.login; slot.append(name);
  if (appState.staff) {
    const staff = document.createElement("a"); staff.className = "staff-link"; staff.href = "staff.html"; staff.textContent = "Staff"; slot.append(staff);
  }
  const other = appState.viewer.platform === "twitch" ? "discord" : "twitch";
  if (!appState.identities[other]) {
    const link = document.createElement("button"); link.type = "button"; link.className = "link-account"; link.textContent = `Link ${providerLabel(other)}`;
    link.addEventListener("click", () => startAuth(other, appState.view === "track" ? "track" : "./", "link")); slot.append(link);
  }
  const logout = document.createElement("button"); logout.type = "button"; logout.className = "icon-button"; logout.setAttribute("aria-label", "Sign out");
  logout.innerHTML = '<i data-lucide="log-out"></i>'; logout.addEventListener("click", signOut); slot.append(logout);
  byId("track-guest").hidden = true; byId("track-auth").hidden = false; renderIdentityCard();
  if (window.lucide) window.lucide.createIcons();
}

async function finishPendingLink() {
  const linkPlatform = sessionStorage.getItem(LINK_PENDING_KEY);
  if (!linkPlatform || !PROVIDERS[linkPlatform]) return false;
  const current = activeProvider();
  if (current === linkPlatform) return false;
  await api("link_accounts", {}, { platform: current, linkPlatform });
  sessionStorage.removeItem(LINK_PENDING_KEY);
  return true;
}

function setPortalView(view) {
  const allowed = new Set(["submit", "track", "rules"]);
  const selected = allowed.has(view) ? view : "submit";
  appState.view = selected;
  for (const name of allowed) byId(`view-${name}`).hidden = name !== selected;
  document.querySelectorAll("[data-view]").forEach((button) => {
    if (button.closest("nav")) button.classList.toggle("nav-active", button.dataset.view === selected);
  });
  if (selected === "track" && appState.viewer && !appState.cases.length) loadMyCases("");
}

function renderCases(cases) {
  const list = byId("case-list"); list.replaceChildren(); byId("case-empty").hidden = cases.length > 0;
  for (const item of cases) {
    const article = document.createElement("article"); article.className = "case-card";
    const top = document.createElement("div"); top.className = "case-card__top";
    const heading = document.createElement("div"); heading.className = "case-heading";
    const id = document.createElement("span"); id.className = "case-id"; id.textContent = item.case_code || `CASE #${item.case_number}`;
    const platform = document.createElement("span"); platform.className = `platform-badge platform-badge--${item.platform}`; platform.textContent = providerLabel(item.platform);
    heading.append(id, platform);
    const status = document.createElement("span"); status.className = `status status--${item.status}`; status.textContent = STATUS_LABELS[item.status] || item.status.replaceAll("_", " ");
    top.append(heading, status);
    const body = document.createElement("div"); body.className = "case-card__body";
    const action = document.createElement("div"); action.innerHTML = "<small>Action</small>";
    const actionValue = document.createElement("strong"); actionValue.textContent = String(item.punishment_type || "").replaceAll("_", " "); action.append(actionValue);
    const submitted = document.createElement("div"); submitted.innerHTML = "<small>Submitted</small>";
    const submittedValue = document.createElement("strong"); submittedValue.textContent = new Date(item.submitted_at).toLocaleDateString(); submitted.append(submittedValue);
    const reason = document.createElement("p"); reason.textContent = item.appeal_reason; body.append(action, submitted, reason); article.append(top, body);
    if (item.staff_response) {
      const response = document.createElement("div"); response.className = "staff-response";
      response.innerHTML = '<i data-lucide="shield-check"></i><div><small>Staff response</small></div>';
      const text = document.createElement("p"); text.textContent = item.staff_response; response.lastElementChild.append(text); article.append(response);
    } else {
      const pending = document.createElement("div"); pending.className = "pending-line"; pending.innerHTML = "<span></span>Awaiting staff update"; article.append(pending);
    }
    list.append(article);
  }
  if (window.lucide) window.lucide.createIcons();
}

async function loadMyCases(caseNumber = "") {
  const notice = byId("notice"); setNotice(notice, "error", "");
  try {
    const data = await api("get_my_cases", { caseNumber: String(caseNumber).trim() });
    appState.cases = data.cases || []; renderCases(appState.cases);
    if (caseNumber && !appState.cases.length) setNotice(notice, "error", "No matching case belongs to your verified Twitch or Discord identity.");
  } catch (error) { setNotice(notice, "error", error.message); }
}

async function loadViewer() {
  const data = await api("me");
  appState.viewer = data.user; appState.staff = data.staff || null;
  appState.identities = data.identities || { twitch: null, discord: null };
  const platformSelect = byId("appeal-platform");
  if (platformSelect && appState.viewer?.platform && !appState.identities[platformSelect.value]) {
    platformSelect.value = appState.viewer.platform;
  }
}

async function initPortal() {
  const notice = byId("notice");
  const authError = sessionStorage.getItem("thy_toxic_appeals_auth_error");
  if (authError) { sessionStorage.removeItem("thy_toxic_appeals_auth_error"); setNotice(notice, "error", authError); }
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setPortalView(button.dataset.view)));
  byId("appeal-platform").addEventListener("change", renderIdentityCard);
  byId("identity-card").addEventListener("click", () => {
    const platform = selectedPlatform();
    if (!appState.identities[platform]) startAuth(platform, "./", appState.viewer ? "link" : "signin");
  });
  document.querySelectorAll("[data-provider-signin]").forEach((button) => button.addEventListener("click", () => startAuth(button.dataset.providerSignin, "track")));
  byId("all-cases").addEventListener("click", () => { byId("case-number").value = ""; loadMyCases(""); });
  byId("case-search").addEventListener("submit", (event) => { event.preventDefault(); loadMyCases(byId("case-number").value); });
  byId("appeal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const platform = selectedPlatform();
    if (!appState.identities[platform]) { startAuth(platform, "./", appState.viewer ? "link" : "signin"); return; }
    const button = byId("submit-button"); const form = new FormData(event.currentTarget);
    button.disabled = true; button.textContent = "Securing appeal…"; setNotice(notice, "error", "");
    try {
      const data = await api("create_case", {
        platform, punishmentType: form.get("punishmentType"), punishmentReference: form.get("punishmentReference"),
        reason: form.get("reason"), evidence: String(form.get("evidence") || "").split(/\r?\n/),
      });
      event.currentTarget.reset(); byId("appeal-platform").value = platform; renderIdentityCard();
      const label = data.case.case_code || `#${data.case.case_number}`;
      byId("case-number").value = data.case.case_code || String(data.case.case_number);
      setNotice(notice, "success", `Appeal ${label} is secured and in the review queue.`);
      setPortalView("track"); await loadMyCases(data.case.case_code || String(data.case.case_number));
    } catch (error) { setNotice(notice, "error", error.message); }
    finally { button.disabled = false; renderIdentityCard(); }
  });
  if (sessionStorage.getItem(PROVIDERS[activeProvider()].tokenKey)) {
    try {
      const linked = await finishPendingLink(); await loadViewer();
      if (linked) setNotice(notice, "success", "Your verified Twitch and Discord accounts are linked. Cases from both platforms now load together.");
    } catch (error) {
      sessionStorage.removeItem(LINK_PENDING_KEY);
      setNotice(notice, "error", error.status === 401
        ? "Your sign-in could not be verified. Please sign in again with the platform connected to your case."
        : error.message);
    }
  }
  renderPortalAccount();
  if (appState.viewer) loadMyCases("");
  const requestedView = sessionStorage.getItem(AFTER_AUTH_VIEW_KEY) || new URLSearchParams(location.search).get("view");
  sessionStorage.removeItem(AFTER_AUTH_VIEW_KEY);
  if (requestedView) setPortalView(requestedView);
}

function staffNotice(kind, message) { setNotice(byId("staff-notice"), kind, message); }

function renderStaffQueue() {
  const list = byId("queue-list"); list.replaceChildren();
  const needle = byId("staff-search").value.trim().toLowerCase();
  const visible = appState.cases.filter((item) => !needle || String(item.case_number).includes(needle) || item.appellant_username.toLowerCase().includes(needle));
  if (!visible.length) { const empty = document.createElement("div"); empty.className = "empty-queue"; empty.textContent = "No cases match this view."; list.append(empty); return; }
  for (const item of visible) {
    const button = document.createElement("button"); button.type = "button"; button.className = `queue-item${appState.selected?.id === item.id ? " active" : ""}`;
    const signal = document.createElement("span"); signal.className = `queue-signal queue-signal--${item.status}`;
    const detail = document.createElement("span");
    const title = document.createElement("strong"); title.textContent = `#${item.case_number} · ${item.appellant_display_name || item.appellant_username}`;
    const meta = document.createElement("small"); meta.textContent = `${providerLabel(item.platform)} • ${item.punishment_type} • ${new Date(item.submitted_at).toLocaleDateString()}`;
    detail.append(title, meta);
    const status = document.createElement("em"); status.textContent = STATUS_LABELS[item.status] || item.status;
    button.append(signal, detail, status); button.addEventListener("click", () => { appState.selected = item; renderStaffQueue(); renderCaseReview(); }); list.append(button);
  }
}

function addMeta(container, label, value) {
  const block = document.createElement("div"); const small = document.createElement("small"); small.textContent = label;
  const strong = document.createElement("strong"); strong.textContent = value; block.append(small, strong); container.append(block);
}

function renderCaseReview() {
  const root = byId("case-review"); root.replaceChildren(); const item = appState.selected;
  if (!item) { root.innerHTML = '<div class="empty-review"><i data-lucide="user-round"></i><h2>Select a case</h2><p>Choose an appeal from the queue to review its full record.</p></div>'; if (window.lucide) window.lucide.createIcons(); return; }
  const header = document.createElement("header"); const heading = document.createElement("div");
  const caseId = document.createElement("span"); caseId.className = "case-id"; caseId.textContent = `CASE #${item.case_number}`;
  const name = document.createElement("h2"); name.textContent = item.appellant_display_name || item.appellant_username;
  const login = document.createElement("p"); login.textContent = `@${item.appellant_username} on ${providerLabel(item.platform)}`; heading.append(caseId, name, login);
  const badge = document.createElement("span"); badge.className = `status status--${item.status}`; badge.textContent = STATUS_LABELS[item.status] || item.status; header.append(heading, badge);
  const meta = document.createElement("div"); meta.className = "case-meta";
  addMeta(meta, "Action", item.punishment_type); addMeta(meta, "Reference", item.punishment_reference || "None provided"); addMeta(meta, "Submitted", new Date(item.submitted_at).toLocaleString());
  const statement = document.createElement("article"); statement.className = "appeal-statement";
  const statementLabel = document.createElement("small"); statementLabel.textContent = "APPELLANT STATEMENT";
  const statementText = document.createElement("p"); statementText.textContent = item.appeal_reason; statement.append(statementLabel, statementText); root.append(header, meta, statement);
  if (item.evidence?.length) {
    const evidence = document.createElement("div"); evidence.className = "evidence-list";
    const label = document.createElement("small"); label.textContent = "EVIDENCE"; evidence.append(label);
    for (const url of item.evidence) { const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = url; evidence.append(link); }
    root.append(evidence);
  }
  const form = document.createElement("form"); form.className = "decision-form";
  const statusLabel = document.createElement("label"); statusLabel.innerHTML = "<span>Decision status</span>";
  const select = document.createElement("select"); select.name = "status";
  for (const value of STAFF_STATUSES) { const option = document.createElement("option"); option.value = value; option.textContent = STATUS_LABELS[value]; option.selected = value === item.status; select.append(option); }
  statusLabel.append(select);
  const responseLabel = document.createElement("label"); responseLabel.innerHTML = "<span>Response to appellant</span>";
  const response = document.createElement("textarea"); response.name = "response"; response.rows = 7; response.placeholder = "Explain the decision or ask for the exact information still needed…"; response.value = item.staff_response || ""; responseLabel.append(response);
  const save = document.createElement("button"); save.className = "submit-button button"; save.type = "submit"; save.innerHTML = '<i data-lucide="circle-check"></i>Save and publish update';
  const actions = document.createElement("div"); actions.className = "decision-actions"; actions.append(save);
  if (appState.staff?.role === "owner") {
    const remove = document.createElement("button"); remove.className = "button button--danger"; remove.type = "button"; remove.innerHTML = '<i data-lucide="trash-2"></i>Delete permanently';
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Permanently delete case #${item.case_number} and its complete event history? This cannot be undone.`)) return;
      remove.disabled = true; save.disabled = true; remove.textContent = "Deleting…"; staffNotice("error", "");
      try {
        const data = await api("delete_case", { id: item.id }, { platform: "twitch" });
        appState.cases = appState.cases.filter((entry) => entry.id !== item.id); appState.selected = null;
        byId("active-count").textContent = String(appState.cases.filter((entry) => OPEN_STATUSES.has(entry.status)).length);
        renderStaffQueue(); renderCaseReview(); staffNotice("success", `Case #${data.case.case_number} was permanently deleted.`);
      } catch (error) { staffNotice("error", error.message); remove.disabled = false; save.disabled = false; remove.innerHTML = '<i data-lucide="trash-2"></i>Delete permanently'; }
    });
    actions.append(remove);
  }
  form.append(statusLabel, responseLabel, actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); save.disabled = true; save.textContent = "Saving…"; staffNotice("error", "");
    try {
      const data = await api("update_case", { id: item.id, status: select.value, response: response.value }, { platform: "twitch" });
      appState.cases = appState.cases.map((entry) => entry.id === item.id ? data.case : entry); appState.selected = data.case;
      renderStaffQueue(); renderCaseReview(); staffNotice("success", `Case #${data.case.case_number} was updated.`);
    } catch (error) { staffNotice("error", error.message); save.disabled = false; save.innerHTML = '<i data-lucide="circle-check"></i>Save and publish update'; }
  });
  root.append(form); if (window.lucide) window.lucide.createIcons();
}

async function loadStaffCases(status = appState.filter) {
  const list = byId("queue-list"); list.innerHTML = '<div class="loading-row">Loading cases…</div>'; staffNotice("error", "");
  try {
    const data = await api("get_staff_cases", { status }, { platform: "twitch" }); appState.cases = data.cases || []; appState.filter = status;
    byId("active-count").textContent = String(appState.cases.filter((item) => OPEN_STATUSES.has(item.status)).length);
    if (appState.selected) appState.selected = appState.cases.find((item) => item.id === appState.selected.id) || null;
    renderStaffQueue(); renderCaseReview();
  } catch (error) { staffNotice("error", error.message); list.replaceChildren(); }
}

async function initStaff() {
  sessionStorage.setItem(ACTIVE_KEY, "twitch");
  byId("staff-signin").addEventListener("click", () => startAuth("twitch", "staff.html"));
  byId("staff-switch").addEventListener("click", () => switchTwitchAccount("staff.html"));
  byId("staff-logout").addEventListener("click", signOut);
  byId("staff-search").addEventListener("input", renderStaffQueue);
  byId("filter-row").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-status]"); if (!button) return;
    document.querySelectorAll("#filter-row button").forEach((item) => item.classList.toggle("active", item === button)); loadStaffCases(button.dataset.status);
  });
  if (!sessionStorage.getItem(PROVIDERS.twitch.tokenKey)) { byId("staff-signin").hidden = false; staffNotice("error", "Sign in with your authorized Twitch account to open the staff queue."); return; }
  try {
    const data = await api("me", {}, { platform: "twitch" }); appState.viewer = data.user; appState.staff = data.staff;
    if (!appState.staff) throw Object.assign(new Error("This Twitch account does not have staff access."), { status: 403 });
    byId("staff-role").innerHTML = `<i data-lucide="shield-check"></i>${appState.staff.role}`;
    byId("staff-switch").hidden = false; byId("staff-logout").hidden = false; byId("staff-workspace").hidden = false; await loadStaffCases("all");
  } catch (error) {
    staffNotice("error", error.status === 403 ? "This Twitch account does not have staff access. Switch to an authorized Twitch account." : error.message);
    byId("staff-signin").textContent = error.status === 403 ? "Use another Twitch account" : "Sign in with Twitch"; byId("staff-signin").hidden = false;
  }
  if (window.lucide) window.lucide.createIcons();
}

document.addEventListener("DOMContentLoaded", () => {
  const returned = completeOAuthReturn();
  if (returned === "redirecting") return;
  if (window.lucide) window.lucide.createIcons();
  if (document.body.dataset.page === "staff") initStaff(); else initPortal();
});
