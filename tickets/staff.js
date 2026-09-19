"use strict";

const API_URL = "https://ubldjtsjfudogtgxakiq.supabase.co/functions/v1/tickets-api";
const API_KEY = "sb_publishable_Fhl-Co0p5QNJKJ7ou2Te2Q_FD8BIywM";
const DISCORD_CLIENT_ID = "1544711402873290873";
const AUTH_REDIRECT_URI = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/appeals-center/";
const TOKEN_KEY = "thy_toxic_appeals_discord_token";
const OAUTH_STATE_KEY = "thy_toxic_appeals_oauth_state";
const OAUTH_PROVIDER_KEY = "thy_toxic_appeals_oauth_provider";
const OAUTH_PURPOSE_KEY = "thy_toxic_appeals_oauth_purpose";
const RETURN_KEY = "thy_toxic_appeals_return";
const ACTIVE_KEY = "thy_toxic_appeals_active_provider";
const LABELS = { general: "General Support", report: "Report a User", staff: "Staff Inquiry", suggestion: "Suggestion" };
const state = { tickets: [], selected: null, staff: null, status: "all", type: "all" };
const byId = (id) => document.getElementById(id);

function randomState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function signIn() {
  const oauthState = randomState();
  sessionStorage.setItem(OAUTH_STATE_KEY, oauthState);
  sessionStorage.setItem(OAUTH_PROVIDER_KEY, "discord");
  sessionStorage.setItem(OAUTH_PURPOSE_KEY, "signin");
  sessionStorage.setItem(RETURN_KEY, "tickets-staff");
  sessionStorage.setItem(ACTIVE_KEY, "discord");
  const query = new URLSearchParams({ response_type: "token", client_id: DISCORD_CLIENT_ID, redirect_uri: AUTH_REDIRECT_URI, state: oauthState, scope: "identify", prompt: "consent" });
  location.assign(`https://discord.com/oauth2/authorize?${query}`);
}

function signOut() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(ACTIVE_KEY);
  location.replace("staff.html");
}

async function api(action, payload = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) throw Object.assign(new Error("Sign in with an authorized Discord account to continue."), { status: 401 });
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: API_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) sessionStorage.removeItem(TOKEN_KEY);
    throw Object.assign(new Error(data.error || "The Ticket Center could not complete this request."), { status: response.status });
  }
  return data;
}

function notice(kind, message) {
  const element = byId("staff-notice");
  if (!message) { element.hidden = true; element.replaceChildren(); return; }
  element.className = `staff-notice staff-notice--${kind}`;
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", kind === "success" ? "circle-check" : "triangle-alert");
  const text = document.createElement("span");
  text.textContent = message;
  element.replaceChildren(icon, text);
  element.hidden = false;
  window.lucide?.createIcons();
}

function formatDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function statusLabel(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

function filteredTickets() {
  const search = byId("ticket-search").value.trim().toLowerCase();
  return state.tickets.filter((ticket) => {
    if (state.status !== "all" && ticket.status !== state.status) return false;
    if (state.type !== "all" && ticket.ticket_type !== state.type) return false;
    if (!search) return true;
    return [ticket.ticket_code, ticket.requester_username, ticket.requester_display_name, ticket.requester_user_id, LABELS[ticket.ticket_type]]
      .some((value) => String(value || "").toLowerCase().includes(search));
  });
}

function renderList() {
  const root = byId("ticket-list");
  const tickets = filteredTickets();
  byId("ticket-count").textContent = `${tickets.length} record${tickets.length === 1 ? "" : "s"}`;
  root.replaceChildren();
  if (!tickets.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No ticket records match these filters.";
    root.append(empty);
    return;
  }
  for (const ticket of tickets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ticket-record-button ticket-record-button--${ticket.ticket_type}${state.selected === ticket.id ? " active" : ""}`;
    const top = document.createElement("span"); top.className = "record-button-top";
    const code = document.createElement("strong"); code.textContent = ticket.ticket_code;
    const status = document.createElement("em"); status.className = `record-status record-status--${ticket.status}`; status.textContent = statusLabel(ticket.status);
    top.append(code, status);
    const name = document.createElement("span"); name.textContent = ticket.requester_display_name || ticket.requester_username;
    const meta = document.createElement("small"); meta.textContent = `${LABELS[ticket.ticket_type] || ticket.ticket_type} • ${formatDate(ticket.closed_at || ticket.opened_at)}`;
    button.append(top, name, meta);
    button.addEventListener("click", () => loadDetail(ticket.id));
    root.append(button);
  }
}

function metaItem(label, value) {
  const item = document.createElement("div");
  const small = document.createElement("small"); small.textContent = label;
  const strong = document.createElement("strong"); strong.textContent = value;
  item.append(small, strong);
  return item;
}

function renderTranscript(messages) {
  const root = document.createElement("div");
  root.className = "transcript";
  const heading = document.createElement("div"); heading.className = "transcript-heading";
  const title = document.createElement("h3"); title.textContent = "Saved conversation";
  const count = document.createElement("span"); count.textContent = `${messages.length} message${messages.length === 1 ? "" : "s"}`;
  heading.append(title, count); root.append(heading);
  if (!messages.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No conversation has been archived for this ticket yet."; root.append(empty); return root;
  }
  for (const message of messages) {
    const article = document.createElement("article"); article.className = `transcript-message${message.author?.bot ? " transcript-message--bot" : ""}`;
    const head = document.createElement("header");
    const author = document.createElement("strong"); author.textContent = message.author?.display_name || message.author?.username || "Unknown";
    const time = document.createElement("time"); time.dateTime = message.created_at || ""; time.textContent = formatDate(message.created_at);
    head.append(author, time); article.append(head);
    if (message.content) { const content = document.createElement("p"); content.textContent = message.content; article.append(content); }
    for (const embed of message.embeds || []) {
      if (!embed.title && !embed.description) continue;
      const box = document.createElement("div"); box.className = "saved-embed";
      if (embed.title) { const embedTitle = document.createElement("strong"); embedTitle.textContent = embed.title; box.append(embedTitle); }
      if (embed.description) { const embedText = document.createElement("p"); embedText.textContent = embed.description; box.append(embedText); }
      article.append(box);
    }
    if (message.attachments?.length) {
      const attachments = document.createElement("div"); attachments.className = "saved-attachments";
      for (const file of message.attachments) { const link = document.createElement("a"); link.href = file.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = file.filename || "Attachment"; attachments.append(link); }
      article.append(attachments);
    }
    root.append(article);
  }
  return root;
}

function renderDetail(ticket) {
  const root = byId("ticket-record"); root.replaceChildren();
  const header = document.createElement("div"); header.className = "record-detail-header";
  const titleWrap = document.createElement("div");
  const eyebrow = document.createElement("p"); eyebrow.className = "eyebrow"; eyebrow.textContent = LABELS[ticket.ticket_type] || ticket.ticket_type;
  const title = document.createElement("h2"); title.textContent = ticket.ticket_code;
  titleWrap.append(eyebrow, title);
  const badge = document.createElement("span"); badge.className = `record-status record-status--${ticket.status}`; badge.textContent = statusLabel(ticket.status);
  header.append(titleWrap, badge);
  const meta = document.createElement("div"); meta.className = "record-meta";
  meta.append(
    metaItem("Requester", ticket.requester_display_name || ticket.requester_username),
    metaItem("Discord ID", ticket.requester_user_id),
    metaItem("Assigned staff", ticket.assigned_to_name || "Unclaimed"),
    metaItem("Claimed", formatDate(ticket.claimed_at)),
    metaItem("Opened", formatDate(ticket.opened_at)),
    metaItem("Closed", formatDate(ticket.closed_at)),
    metaItem("Closed by", ticket.closed_by_name || "Not closed"),
    metaItem("Deletes automatically", formatDate(ticket.purge_after)),
  );
  root.append(header, meta, renderTranscript(ticket.transcript || []));
  if (ticket.deletion_error) { const warning = document.createElement("p"); warning.className = "record-warning"; warning.textContent = `Discord cleanup warning: ${ticket.deletion_error}`; root.append(warning); }
  if (state.staff?.role === "owner" && ["closed", "failed"].includes(ticket.status)) {
    const actions = document.createElement("div"); actions.className = "record-actions";
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger-button"; remove.textContent = "Delete record permanently";
    remove.addEventListener("click", async () => {
      const confirmation = prompt(`Type DELETE ${ticket.ticket_code} to permanently delete this record.`);
      if (!confirmation) return;
      remove.disabled = true;
      try { await api("delete", { id: ticket.id, confirmation }); notice("success", `${ticket.ticket_code} was permanently deleted.`); state.selected = null; await loadTickets(); }
      catch (error) { notice("error", error.message); remove.disabled = false; }
    });
    actions.append(remove); root.append(actions);
  }
}

async function loadDetail(id) {
  state.selected = id; renderList(); notice("error", "");
  const root = byId("ticket-record"); root.replaceChildren();
  const loading = document.createElement("p"); loading.className = "empty-state"; loading.textContent = "Loading protected ticket record…"; root.append(loading);
  try { const data = await api("detail", { id }); renderDetail(data.ticket); }
  catch (error) { notice("error", error.message); root.replaceChildren(); }
}

async function loadTickets() {
  const data = await api("list");
  state.tickets = data.tickets || [];
  state.staff = data.staff;
  const access = byId("staff-access");
  const accessIcon = document.createElement("i"); accessIcon.setAttribute("data-lucide", "shield-check");
  const accessText = document.createTextNode(`${state.staff.displayName} • ${state.staff.role}`);
  access.replaceChildren(accessIcon, accessText);
  byId("staff-signin").hidden = true;
  byId("staff-signout").hidden = false;
  byId("staff-workspace").hidden = false;
  if (!state.selected) byId("ticket-record").innerHTML = '<div class="empty-record"><i data-lucide="messages-square"></i><h2>Select a ticket</h2><p>Choose a saved record to review its private conversation and attachments.</p></div>';
  renderList(); window.lucide?.createIcons();
}

async function init() {
  byId("staff-signin").addEventListener("click", signIn);
  byId("staff-signout").addEventListener("click", signOut);
  byId("ticket-search").addEventListener("input", renderList);
  byId("status-filters").addEventListener("click", (event) => { const button = event.target.closest("button[data-status]"); if (!button) return; state.status = button.dataset.status; document.querySelectorAll("[data-status]").forEach((item) => item.classList.toggle("active", item === button)); renderList(); });
  byId("type-filters").addEventListener("click", (event) => { const button = event.target.closest("button[data-type]"); if (!button) return; state.type = button.dataset.type; document.querySelectorAll("[data-type]").forEach((item) => item.classList.toggle("active", item === button)); renderList(); });
  window.lucide?.createIcons();
  if (new URLSearchParams(location.search).get("auth") === "error") notice("error", "Discord sign-in could not be completed. Please try again.");
  if (!sessionStorage.getItem(TOKEN_KEY)) return;
  try { await loadTickets(); }
  catch (error) { notice("error", error.message); byId("staff-signin").hidden = false; }
}

init();
