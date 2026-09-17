"use strict";

const API_URL = "https://ubldjtsjfudogtgxakiq.supabase.co/functions/v1/appeals-api";
const API_KEY = "sb_publishable_Fhl-Co0p5QNJKJ7ou2Te2Q_FD8BIywM";
const TWITCH_CLIENT_ID = "ht2kbpz12tpv060f2259jn9recng0x";
const REDIRECT_URI = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/appeals-center/";
const TOKEN_KEY = "thy_toxic_appeals_twitch_token";
const OAUTH_STATE_KEY = "thy_toxic_appeals_oauth_state";
const RETURN_KEY = "thy_toxic_appeals_return";
const OPEN_STATUSES = new Set(["submitted", "under_review", "needs_information"]);
const STATUS_LABELS = {
  submitted: "Submitted", under_review: "Under review", needs_information: "Needs information",
  accepted: "Accepted", denied: "Denied", closed: "Closed", archived: "Archived",
};

const appState = { viewer: null, staff: null, cases: [], selected: null, filter: "all" };
const byId = (id) => document.getElementById(id);

function randomState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function startTwitchAuth(returnTo = "./") {
  const state = randomState();
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  sessionStorage.setItem(RETURN_KEY, returnTo === "staff.html" ? "staff.html" : "./");
  const query = new URLSearchParams({
    response_type: "token",
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "user:read:email",
    state,
    force_verify: "true",
  });
  location.assign(`https://id.twitch.tv/oauth2/authorize?${query}`);
}

function completeOAuthReturn() {
  if (!location.hash || location.hash.length < 2) return false;
  const hash = new URLSearchParams(location.hash.slice(1));
  const returnedState = hash.get("state") || "";
  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY) || "";
  const token = hash.get("access_token");
  const error = hash.get("error_description") || hash.get("error");
  history.replaceState(null, "", REDIRECT_URI);
  sessionStorage.removeItem(OAUTH_STATE_KEY);

  if (error) {
    sessionStorage.setItem("thy_toxic_appeals_auth_error", error);
    return true;
  }
  if (!token || !expectedState || returnedState !== expectedState) {
    sessionStorage.setItem("thy_toxic_appeals_auth_error", "Twitch sign-in could not be verified. Please try again.");
    return true;
  }

  sessionStorage.setItem(TOKEN_KEY, token);
  const returnTo = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  if (returnTo === "staff.html") {
    location.replace("staff.html");
    return "redirecting";
  }
  return true;
}

function signOut(destination = null) {
  sessionStorage.removeItem(TOKEN_KEY);
  appState.viewer = null;
  appState.staff = null;
  const next = typeof destination === "string"
    ? destination
    : document.body.dataset.page === "staff" ? "staff.html" : "./";
  location.replace(next);
}

function switchTwitchAccount(returnTo = "./") {
  sessionStorage.removeItem(TOKEN_KEY);
  appState.viewer = null;
  appState.staff = null;
  startTwitchAuth(returnTo);
}

async function api(action, payload = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) throw Object.assign(new Error("Sign in with Twitch to continue."), { status: 401 });
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: API_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) sessionStorage.removeItem(TOKEN_KEY);
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
  const text = document.createElement("span");
  text.textContent = message;
  element.append(icon, text);
  element.hidden = false;
  if (window.lucide) window.lucide.createIcons();
}

function renderPortalAccount() {
  const slot = byId("account-slot");
  slot.replaceChildren();
  if (!appState.viewer) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "twitch-button twitch-button--small";
    button.textContent = "Sign in with Twitch";
    button.addEventListener("click", () => startTwitchAuth("./"));
    slot.append(button);
    byId("track-guest").hidden = false;
    byId("track-auth").hidden = true;
    byId("submit-button").textContent = "Sign in and continue";
    return;
  }

  if (appState.viewer.avatarUrl) {
    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.src = appState.viewer.avatarUrl;
    avatar.alt = "";
    slot.append(avatar);
  }
  const name = document.createElement("span");
  name.className = "account-name";
  name.textContent = appState.viewer.displayName || appState.viewer.login;
  slot.append(name);
  if (appState.staff) {
    const staff = document.createElement("a");
    staff.className = "staff-link";
    staff.href = "staff.html";
    staff.textContent = "Staff";
    slot.append(staff);
  }
  const switchAccount = document.createElement("button");
  switchAccount.type = "button";
  switchAccount.className = "icon-button";
  switchAccount.setAttribute("aria-label", "Switch Twitch account");
  switchAccount.title = "Switch Twitch account";
  switchAccount.innerHTML = '<i data-lucide="refresh-cw"></i>';
  switchAccount.addEventListener("click", () => switchTwitchAccount("./"));
  slot.append(switchAccount);
  const logout = document.createElement("button");
  logout.type = "button";
  logout.className = "icon-button";
  logout.setAttribute("aria-label", "Sign out");
  logout.innerHTML = '<i data-lucide="log-out"></i>';
  logout.addEventListener("click", signOut);
  slot.append(logout);

  byId("identity-title").textContent = `Verified as ${appState.viewer.displayName || appState.viewer.login}`;
  byId("identity-copy").textContent = `Twitch ID ${appState.viewer.id} · This verified identity will be attached to your appeal.`;
  byId("submit-button").innerHTML = 'Submit appeal <i data-lucide="arrow-right"></i>';
  byId("track-guest").hidden = true;
  byId("track-auth").hidden = false;
  if (window.lucide) window.lucide.createIcons();
}

function setPortalView(view) {
  const allowed = new Set(["submit", "track", "rules"]);
  const selected = allowed.has(view) ? view : "submit";
  for (const name of allowed) byId(`view-${name}`).hidden = name !== selected;
  document.querySelectorAll("[data-view]").forEach((button) => {
    if (button.getAttribute("role") === "tab") button.setAttribute("aria-selected", String(button.dataset.view === selected));
    if (button.closest("nav")) button.classList.toggle("nav-active", button.dataset.view === selected);
  });
  if (selected === "track" && appState.viewer && !appState.cases.length) loadMyCases("");
  if (selected === "submit") scrollTo({ top: 0, behavior: "smooth" });
}

function renderCases(cases) {
  const list = byId("case-list");
  list.replaceChildren();
  byId("case-empty").hidden = cases.length > 0;
  for (const item of cases) {
    const article = document.createElement("article");
    article.className = "case-card";
    const top = document.createElement("div"); top.className = "case-card__top";
    const id = document.createElement("span"); id.className = "case-id"; id.textContent = `CASE #${item.case_number}`;
    const status = document.createElement("span"); status.className = `status status--${item.status}`; status.textContent = STATUS_LABELS[item.status] || item.status;
    top.append(id, status);
    const body = document.createElement("div"); body.className = "case-card__body";
    const action = document.createElement("div"); action.innerHTML = "<small>Action</small>";
    const actionValue = document.createElement("strong"); actionValue.textContent = String(item.punishment_type || "").replaceAll("_", " "); action.append(actionValue);
    const submitted = document.createElement("div"); submitted.innerHTML = "<small>Submitted</small>";
    const submittedValue = document.createElement("strong"); submittedValue.textContent = new Date(item.submitted_at).toLocaleDateString(); submitted.append(submittedValue);
    const reason = document.createElement("p"); reason.textContent = item.appeal_reason;
    body.append(action, submitted, reason);
    article.append(top, body);
    if (item.staff_response) {
      const response = document.createElement("div"); response.className = "staff-response";
      response.innerHTML = '<i data-lucide="shield-check"></i><div><small>Staff response</small></div>';
      const responseText = document.createElement("p"); responseText.textContent = item.staff_response;
      response.lastElementChild.append(responseText); article.append(response);
    } else {
      const pending = document.createElement("div"); pending.className = "pending-line"; pending.innerHTML = "<span></span>Awaiting staff update"; article.append(pending);
    }
    list.append(article);
  }
  if (window.lucide) window.lucide.createIcons();
}

async function loadMyCases(caseNumber = "") {
  const notice = byId("notice");
  setNotice(notice, "error", "");
  try {
    const data = await api("get_my_cases", { caseNumber: String(caseNumber).trim().replace(/^#/, "") });
    appState.cases = data.cases || [];
    renderCases(appState.cases);
    if (caseNumber && !appState.cases.length) setNotice(notice, "error", "No appeal with that case number belongs to this Twitch account.");
  } catch (error) {
    setNotice(notice, "error", error.message);
    if (error.status === 401) { appState.viewer = null; renderPortalAccount(); }
  }
}

async function initPortal() {
  const notice = byId("notice");
  const authError = sessionStorage.getItem("thy_toxic_appeals_auth_error");
  if (authError) { sessionStorage.removeItem("thy_toxic_appeals_auth_error"); setNotice(notice, "error", authError); }

  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setPortalView(button.dataset.view)));
  byId("identity-card").addEventListener("click", () => { if (!appState.viewer) startTwitchAuth("./"); });
  byId("track-signin").addEventListener("click", () => startTwitchAuth("./"));
  byId("all-cases").addEventListener("click", () => { byId("case-number").value = ""; loadMyCases(""); });
  byId("case-search").addEventListener("submit", (event) => { event.preventDefault(); loadMyCases(byId("case-number").value); });
  byId("appeal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!appState.viewer) { startTwitchAuth("./"); return; }
    const button = byId("submit-button");
    const form = new FormData(event.currentTarget);
    button.disabled = true; button.textContent = "Securing appeal…"; setNotice(notice, "error", "");
    try {
      const data = await api("create_case", {
        punishmentType: form.get("punishmentType"), punishmentReference: form.get("punishmentReference"),
        reason: form.get("reason"), evidence: String(form.get("evidence") || "").split(/\r?\n/),
      });
      event.currentTarget.reset();
      byId("case-number").value = String(data.case.case_number);
      setNotice(notice, "success", `Appeal #${data.case.case_number} is secured and in the review queue.`);
      setPortalView("track"); await loadMyCases(String(data.case.case_number));
    } catch (error) { setNotice(notice, "error", error.message); }
    finally { button.disabled = false; button.innerHTML = 'Submit appeal <i data-lucide="arrow-right"></i>'; if (window.lucide) window.lucide.createIcons(); }
  });

  if (sessionStorage.getItem(TOKEN_KEY)) {
    try {
      const data = await api("me"); appState.viewer = data.user; appState.staff = data.staff || null;
    } catch (error) { if (error.status !== 401) setNotice(notice, "error", error.message); }
  }
  renderPortalAccount();
  const requestedView = new URLSearchParams(location.search).get("view");
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
    const meta = document.createElement("small"); meta.textContent = `${item.punishment_type} • ${new Date(item.submitted_at).toLocaleDateString()}`;
    detail.append(title, meta);
    const status = document.createElement("em"); status.textContent = STATUS_LABELS[item.status] || item.status;
    button.append(signal, detail, status); button.addEventListener("click", () => { appState.selected = item; renderStaffQueue(); renderCaseReview(); }); list.append(button);
  }
}

function addMeta(container, label, value) {
  const block = document.createElement("div"); const small = document.createElement("small"); small.textContent = label; const strong = document.createElement("strong"); strong.textContent = value; block.append(small, strong); container.append(block);
}

function renderCaseReview() {
  const root = byId("case-review"); root.replaceChildren(); const item = appState.selected;
  if (!item) { root.innerHTML = '<div class="empty-review"><i data-lucide="user-round"></i><h2>Select a case</h2><p>Choose an appeal from the queue to review its full record.</p></div>'; if (window.lucide) window.lucide.createIcons(); return; }
  const header = document.createElement("header"); const heading = document.createElement("div");
  const caseId = document.createElement("span"); caseId.className = "case-id"; caseId.textContent = `CASE #${item.case_number}`;
  const name = document.createElement("h2"); name.textContent = item.appellant_display_name || item.appellant_username;
  const login = document.createElement("p"); login.textContent = `@${item.appellant_username} on Twitch`; heading.append(caseId, name, login);
  const badge = document.createElement("span"); badge.className = `status status--${item.status}`; badge.textContent = STATUS_LABELS[item.status] || item.status; header.append(heading, badge);
  const meta = document.createElement("div"); meta.className = "case-meta"; addMeta(meta, "Action", item.punishment_type); addMeta(meta, "Reference", item.punishment_reference || "None provided"); addMeta(meta, "Submitted", new Date(item.submitted_at).toLocaleString());
  const statement = document.createElement("article"); statement.className = "appeal-statement"; const statementLabel = document.createElement("small"); statementLabel.textContent = "APPELLANT STATEMENT"; const statementText = document.createElement("p"); statementText.textContent = item.appeal_reason; statement.append(statementLabel, statementText);
  root.append(header, meta, statement);
  if (item.evidence?.length) {
    const evidence = document.createElement("div"); evidence.className = "evidence-list"; const label = document.createElement("small"); label.textContent = "EVIDENCE"; evidence.append(label);
    for (const url of item.evidence) { const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = url; evidence.append(link); } root.append(evidence);
  }
  const form = document.createElement("form"); form.className = "decision-form";
  const statusLabel = document.createElement("label"); statusLabel.innerHTML = "<span>Decision status</span>"; const select = document.createElement("select"); select.name = "status";
  for (const value of Object.keys(STATUS_LABELS)) { const option = document.createElement("option"); option.value = value; option.textContent = STATUS_LABELS[value]; option.selected = value === item.status; select.append(option); } statusLabel.append(select);
  const responseLabel = document.createElement("label"); responseLabel.innerHTML = "<span>Response to appellant</span>"; const response = document.createElement("textarea"); response.name = "response"; response.rows = 7; response.placeholder = "Explain the decision or ask for the exact information still needed…"; response.value = item.staff_response || ""; responseLabel.append(response);
  const save = document.createElement("button"); save.className = "submit-button button"; save.type = "submit"; save.innerHTML = '<i data-lucide="circle-check"></i>Save and publish update';
  const actions = document.createElement("div"); actions.className = "decision-actions"; actions.append(save);
  if (appState.staff?.role === "owner") {
    const remove = document.createElement("button");
    remove.className = "button button--danger";
    remove.type = "button";
    remove.innerHTML = '<i data-lucide="trash-2"></i>Delete permanently';
    remove.addEventListener("click", async () => {
      const confirmed = window.confirm(`Permanently delete case #${item.case_number} and its complete event history? This cannot be undone.`);
      if (!confirmed) return;
      remove.disabled = true; save.disabled = true; remove.textContent = "Deleting…"; staffNotice("error", "");
      try {
        const data = await api("delete_case", { id: item.id });
        appState.cases = appState.cases.filter((entry) => entry.id !== item.id);
        appState.selected = null;
        byId("active-count").textContent = String(appState.cases.filter((entry) => OPEN_STATUSES.has(entry.status)).length);
        renderStaffQueue(); renderCaseReview(); staffNotice("success", `Case #${data.case.case_number} was permanently deleted.`);
      } catch (error) {
        staffNotice("error", error.message); remove.disabled = false; save.disabled = false; remove.innerHTML = '<i data-lucide="trash-2"></i>Delete permanently';
        if (window.lucide) window.lucide.createIcons();
      }
    });
    actions.append(remove);
  }
  form.append(statusLabel, responseLabel, actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); save.disabled = true; save.textContent = "Saving…"; staffNotice("error", "");
    try {
      const data = await api("update_case", { id: item.id, status: select.value, response: response.value });
      appState.cases = appState.cases.map((entry) => entry.id === item.id ? data.case : entry); appState.selected = data.case;
      renderStaffQueue(); renderCaseReview(); staffNotice("success", `Case #${data.case.case_number} was updated.`);
    } catch (error) { staffNotice("error", error.message); save.disabled = false; save.innerHTML = '<i data-lucide="circle-check"></i>Save and publish update'; }
  });
  root.append(form); if (window.lucide) window.lucide.createIcons();
}

async function loadStaffCases(status = appState.filter) {
  const list = byId("queue-list"); list.innerHTML = '<div class="loading-row">Loading cases…</div>'; staffNotice("error", "");
  try {
    const data = await api("get_staff_cases", { status }); appState.cases = data.cases || []; appState.filter = status;
    byId("active-count").textContent = String(appState.cases.filter((item) => OPEN_STATUSES.has(item.status)).length);
    if (appState.selected) appState.selected = appState.cases.find((item) => item.id === appState.selected.id) || null;
    renderStaffQueue(); renderCaseReview();
  } catch (error) { staffNotice("error", error.message); list.replaceChildren(); }
}

async function initStaff() {
  byId("staff-signin").addEventListener("click", () => startTwitchAuth("staff.html"));
  byId("staff-switch").addEventListener("click", () => switchTwitchAccount("staff.html"));
  byId("staff-logout").addEventListener("click", signOut);
  byId("staff-search").addEventListener("input", renderStaffQueue);
  byId("filter-row").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-status]"); if (!button) return;
    document.querySelectorAll("#filter-row button").forEach((item) => item.classList.toggle("active", item === button)); loadStaffCases(button.dataset.status);
  });
  if (!sessionStorage.getItem(TOKEN_KEY)) { byId("staff-signin").hidden = false; staffNotice("error", "Sign in with your authorized Twitch account to open the staff queue."); return; }
  try {
    const data = await api("me"); appState.viewer = data.user; appState.staff = data.staff;
    if (!appState.staff) throw Object.assign(new Error("This Twitch account does not have staff access."), { status: 403 });
    byId("staff-role").innerHTML = `<i data-lucide="shield-check"></i>${appState.staff.role}`;
    byId("staff-switch").hidden = false; byId("staff-logout").hidden = false; byId("staff-workspace").hidden = false; await loadStaffCases("all");
  } catch (error) {
    staffNotice("error", error.status === 403 ? "This Twitch account does not have staff access. Switch to an authorized Twitch account." : error.message);
    byId("staff-signin").textContent = error.status === 403 ? "Use another Twitch account" : "Sign in with Twitch";
    byId("staff-signin").hidden = false;
  }
  if (window.lucide) window.lucide.createIcons();
}

document.addEventListener("DOMContentLoaded", () => {
  const returned = completeOAuthReturn();
  if (returned === "redirecting") return;
  if (window.lucide) window.lucide.createIcons();
  if (document.body.dataset.page === "staff") initStaff(); else initPortal();
});
