(() => {
  "use strict";

  const API_URL = "https://ubldjtsjfudogtgxakiq.supabase.co/functions/v1/game-requests-api";
  const API_KEY = "sb_publishable_Fhl-Co0p5QNJKJ7ou2Te2Q_FD8BIywM";
  const TWITCH_CLIENT_ID = "ht2kbpz12tpv060f2259jn9recng0x";
  const AUTH_REDIRECT_URI = "https://thy-toxic-gamer.github.io/Toxic-Command-Center/appeals-center/";
  const TOKEN_KEY = "thy_toxic_appeals_twitch_token";
  const OAUTH_STATE_KEY = "thy_toxic_appeals_oauth_state";
  const OAUTH_PROVIDER_KEY = "thy_toxic_appeals_oauth_provider";
  const OAUTH_PURPOSE_KEY = "thy_toxic_appeals_oauth_purpose";
  const RETURN_KEY = "thy_toxic_appeals_return";
  const PENDING_GAME_KEY = "thy_toxic_games_pending_game";
  const PENDING_PLAN_KEY = "thy_toxic_games_pending_plan";

  const games = Array.isArray(window.GAME_CATALOG) ? window.GAME_CATALOG : [];
  const covers = window.GAME_COVERS || {};
  const grid = document.querySelector("#gameGrid");
  const search = document.querySelector("#searchInput");
  const sort = document.querySelector("#sortSelect");
  const resultCount = document.querySelector("#resultCount");
  const activeLabel = document.querySelector("#activeLabel");
  const empty = document.querySelector("#emptyState");
  const dialog = document.querySelector("#requestDialog");
  const requestForm = document.querySelector("#requestForm");
  const requestTitle = document.querySelector("#requestTitle");
  const requestMeta = document.querySelector("#requestMeta");
  const requestIdentity = document.querySelector("#requestIdentity");
  const requestNotice = document.querySelector("#requestNotice");
  const submitRequest = document.querySelector("#submitRequest");
  const twitchSignIn = document.querySelector("#twitchSignIn");
  const twitchSignOut = document.querySelector("#twitchSignOut");
  const viewerAccount = document.querySelector("#viewerAccount");
  const viewerAvatar = document.querySelector("#viewerAvatar");
  const viewerName = document.querySelector("#viewerName");
  const viewerRole = document.querySelector("#viewerRole");
  const requestStatus = document.querySelector("#requestStatus");
  const availabilityTitle = document.querySelector("#availabilityTitle");
  const availabilityMessage = document.querySelector("#availabilityMessage");
  const availabilityCountdown = document.querySelector("#availabilityCountdown");
  const publicSchedule = document.querySelector("#publicSchedule");
  const publicScheduleCover = document.querySelector("#publicScheduleCover");
  const publicScheduleGame = document.querySelector("#publicScheduleGame");
  const publicScheduleMeta = document.querySelector("#publicScheduleMeta");
  const publicScheduleDate = document.querySelector("#publicScheduleDate");
  const viewerRequestPanel = document.querySelector("#viewerRequestPanel");
  const viewerRequestTitle = document.querySelector("#viewerRequestTitle");
  const viewerRequestMeta = document.querySelector("#viewerRequestMeta");
  const viewerRequestAmount = document.querySelector("#viewerRequestAmount");
  const viewerRequestPay = document.querySelector("#viewerRequestPay");
  const viewerRequestChange = document.querySelector("#viewerRequestChange");
  const viewerRequestMessage = document.querySelector("#viewerRequestMessage");
  const pageSize = 96;
  let activeFilter = "all";
  let viewer = null;
  let selectedGame = null;
  let selectedPlan = null;
  let requestComplete = false;
  let availabilityState = { open: false, mode: "loading", message: "Connecting to the request service…", reopensAt: null };
  let countdownTimer = null;
  let viewerRequest = null;
  let paymentMode = null;

  const colors = {
    PC: "pc", "Nintendo Switch": "switch", "Nintendo Switch 2": "switch",
    "PlayStation 5": "playstation", "PlayStation 4": "playstation-4",
    "Xbox Series X": "xbox", "Xbox 360": "xbox-360", "NSO: NES": "nes",
    "NSO: SNES": "snes", "NSO: Game Boy": "game-boy",
    "NSO: Game Boy Color": "game-boy-color", "NSO: Nintendo 64": "nintendo-64",
    "NSO: Game Boy Advance": "game-boy-advance", "NSO: Sega Genesis": "sega-genesis",
    "NSO: Virtual Boy": "virtual-boy", "NSO: GameCube": "gamecube",
    "Emulation: SNES": "emulation",
  };

  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
  const safeId = (value) => String(value).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const randomizedGames = [...games];
  for (let index = randomizedGames.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const swapWith = random[0] % (index + 1);
    [randomizedGames[index], randomizedGames[swapWith]] = [randomizedGames[swapWith], randomizedGames[index]];
  }
  const randomOrder = new Map(randomizedGames.map((game, index) => [game.id, index]));

  function randomState() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function startTwitchAuth() {
    if (selectedGame) sessionStorage.setItem(PENDING_GAME_KEY, selectedGame.id);
    if (selectedPlan) sessionStorage.setItem(PENDING_PLAN_KEY, selectedPlan);
    const state = randomState();
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
    sessionStorage.setItem(OAUTH_PROVIDER_KEY, "twitch");
    sessionStorage.setItem(OAUTH_PURPOSE_KEY, "signin");
    sessionStorage.setItem(RETURN_KEY, "games");
    const query = new URLSearchParams({
      response_type: "token",
      client_id: TWITCH_CLIENT_ID,
      redirect_uri: AUTH_REDIRECT_URI,
      state,
      scope: "user:read:email",
      force_verify: "true",
    });
    location.assign(`https://id.twitch.tv/oauth2/authorize?${query}`);
  }

  async function api(action, payload = {}) {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const headers = { "Content-Type": "application/json", apikey: API_KEY };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) sessionStorage.removeItem(TOKEN_KEY);
      throw Object.assign(new Error(data.error || "The Game Request service could not complete this request."), { status: response.status });
    }
    return data;
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

  function paymentRemainingLabel(value) {
    const remaining = new Date(value).getTime() - Date.now();
    if (remaining <= 0) return "the payment window has expired";
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }

  function updateAvailabilityBanner() {
    const state = availabilityState;
    requestStatus.className = `request-status request-status--${state.mode === "loading" ? "loading" : state.open ? "open" : "closed"}`;
    availabilityTitle.textContent = state.mode === "loading" ? "Checking availability" : state.open ? "Requests open" : "Requests closed";
    availabilityMessage.textContent = state.message;
    clearInterval(countdownTimer);
    if (state.reopensAt) {
      availabilityCountdown.hidden = false;
      const update = () => { availabilityCountdown.textContent = `Reopens in ${remainingLabel(state.reopensAt)}`; };
      update();
      countdownTimer = setInterval(update, 1000);
    } else {
      availabilityCountdown.hidden = true;
      availabilityCountdown.textContent = "";
    }
    const active = state.activeRequest;
    publicSchedule.hidden = !active;
    if (active) {
      publicScheduleGame.textContent = active.gameTitle;
      publicScheduleMeta.textContent = `${active.code} · ${active.gameSystem} · ${statusLabel(active.status)}`;
      if (active.coverUrl) {
        publicScheduleCover.src = active.coverUrl;
        publicScheduleCover.alt = `${active.gameTitle} cover art`;
        publicScheduleCover.hidden = false;
      } else {
        publicScheduleCover.removeAttribute("src");
        publicScheduleCover.alt = "";
        publicScheduleCover.hidden = true;
      }
      publicScheduleDate.textContent = active.scheduledFor
        ? `Scheduled ${new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" }).format(new Date(active.scheduledFor))}`
        : "Schedule date not selected yet";
    }
  }

  async function loadAvailability() {
    try {
      const data = await api("availability");
      availabilityState = data.availability;
    } catch (error) {
      availabilityState = { open: false, mode: "error", message: "Availability could not be verified. Please try again shortly.", reopensAt: null };
      console.error(error);
    }
    updateAvailabilityBanner();
    render();
  }

  function setNotice(kind, message) {
    requestNotice.hidden = !message;
    requestNotice.className = `request-notice${kind ? ` ${kind}` : ""}`;
    requestNotice.textContent = message || "";
  }

  function setViewer(nextViewer) {
    viewer = nextViewer;
    const signedIn = Boolean(viewer?.user);
    twitchSignIn.hidden = signedIn;
    viewerAccount.hidden = !signedIn;
    if (signedIn) {
      viewerAvatar.src = viewer.user.avatarUrl || "thytoxicgamer-tab-icon.png";
      viewerAvatar.alt = `${viewer.user.displayName} Twitch avatar`;
      viewerName.textContent = viewer.user.displayName;
      viewerRole.textContent = viewer.isOwner ? "Owner · requests free" : "Twitch viewer";
    } else {
      viewerAvatar.removeAttribute("src");
      viewerAvatar.alt = "";
      viewerName.textContent = "";
      viewerRole.textContent = "Twitch viewer";
      viewerRequest = null;
      viewerRequestPanel.hidden = true;
    }
    updateRequestDialog();
  }

  function statusLabel(value) {
    return String(value || "pending").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function renderViewerRequest(message = "", isError = false) {
    if (!viewer?.user || !viewerRequest) {
      viewerRequestPanel.hidden = true;
      return;
    }
    const request = viewerRequest;
    viewerRequestPanel.hidden = false;
    viewerRequestPanel.classList.toggle("is-paid", request.paypalStatus === "COMPLETED" || ["approved", "scheduled", "completed"].includes(request.status));
    viewerRequestPanel.classList.toggle("is-error", isError);
    viewerRequestTitle.textContent = request.gameTitle;
    viewerRequestMeta.textContent = `${request.code} · ${request.gameSystem} · ${request.requestType} · ${statusLabel(request.status)}`;
    viewerRequestAmount.textContent = request.paymentRequired ? `$${Number(request.amountDue).toFixed(2)} ${request.currency}` : request.paypalStatus === "COMPLETED" ? "Payment verified" : "$0 · Owner";
    viewerRequestPay.hidden = request.status !== "awaiting_payment" || !request.paymentRequired || request.paypalStatus === "COMPLETED";
    viewerRequestPay.disabled = false;
    viewerRequestPay.textContent = paymentMode === "sandbox" ? "Test with PayPal Sandbox" : "Pay securely with PayPal";
    const canRequestChange = ["pending", "awaiting_payment", "approved", "scheduled"].includes(request.status)
      && !request.pendingChange
      && (viewer.isOwner || Number(request.viewerChangeCount || 0) < 1);
    viewerRequestChange.hidden = !canRequestChange;
    viewerRequestChange.textContent = viewer.isOwner ? "Change game" : "Request game change";
    if (message) viewerRequestMessage.textContent = message;
    else if (request.pendingChange) viewerRequestMessage.textContent = `Your one game change to ${request.pendingChange.gameTitle} is waiting for staff review.`;
    else if (request.status === "pending") viewerRequestMessage.textContent = "Staff is reviewing this request. Payment will open only after staff moves it to Awaiting Payment.";
    else if (request.status === "awaiting_payment") {
      const deadline = request.paymentExpiresAt ? ` Time remaining: ${paymentRemainingLabel(request.paymentExpiresAt)}.` : "";
      viewerRequestMessage.textContent = (paymentMode === "sandbox" ? "Checkout is connected in PayPal Sandbox test mode. No live money will be charged." : "Your request is ready for secure PayPal checkout.") + deadline;
    }
    else if (request.status === "scheduled") viewerRequestMessage.textContent = request.scheduledFor ? `Scheduled for ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(request.scheduledFor))}.` : "This request is scheduled.";
    else if (request.paypalStatus === "COMPLETED") viewerRequestMessage.textContent = "PayPal verified the payment. Your request is approved and ready for staff to schedule.";
    else viewerRequestMessage.textContent = `This request is ${statusLabel(request.status).toLowerCase()}.`;
  }

  function cleanPayPalQuery() {
    const url = new URL(location.href);
    ["paypal", "request", "token", "PayerID"].forEach((key) => url.searchParams.delete(key));
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function loadViewerRequest(handleReturn = false) {
    if (!viewer?.user) return;
    try {
      const data = await api("my_request");
      viewerRequest = data.request;
      paymentMode = data.paymentMode;
      renderViewerRequest();
      render();
      if (!handleReturn) return;
      const params = new URLSearchParams(location.search);
      const result = params.get("paypal");
      const requestId = params.get("request");
      const orderId = params.get("token");
      if (result === "cancelled") {
        renderViewerRequest("PayPal checkout was cancelled. Your request is still saved and you can try again.");
        cleanPayPalQuery();
      } else if (result === "approved" && requestId && orderId) {
        renderViewerRequest("Confirming the PayPal payment…");
        const captured = await api("capture_payment", { requestId, orderId });
        viewerRequest = captured.request;
        renderViewerRequest("Payment verified. Your request is approved and Discord has been updated.");
        cleanPayPalQuery();
        await loadAvailability();
      }
    } catch (error) {
      renderViewerRequest(error.message, true);
      if (handleReturn && new URLSearchParams(location.search).has("paypal")) cleanPayPalQuery();
      if (error.status !== 401) console.error(error);
    }
  }

  async function loadViewer() {
    const authError = sessionStorage.getItem("thy_toxic_appeals_auth_error");
    if (authError) sessionStorage.removeItem("thy_toxic_appeals_auth_error");
    if (!sessionStorage.getItem(TOKEN_KEY)) {
      setViewer(null);
      const pendingId = sessionStorage.getItem(PENDING_GAME_KEY);
      if (pendingId) {
        sessionStorage.removeItem(PENDING_GAME_KEY);
        const pending = games.find((game) => game.id === pendingId);
        if (pending) {
          openRequest(pending);
          if (authError) setNotice("error", authError);
        }
      }
      return;
    }
    try {
      setViewer(await api("session"));
      await loadViewerRequest(true);
      const pendingId = sessionStorage.getItem(PENDING_GAME_KEY);
      if (pendingId) {
        sessionStorage.removeItem(PENDING_GAME_KEY);
        const pending = games.find((game) => game.id === pendingId);
        if (pending) openRequest(pending);
      }
    } catch (error) {
      setViewer(null);
      if (error.status !== 401) console.error(error);
    }
  }

  function wireCovers() {
    document.querySelectorAll(".cover-art").forEach((img) => {
      const show = () => {
        const frame = img.closest(".cover-frame");
        const card = img.closest(".game-card");
        const naturallyWide = img.naturalWidth > img.naturalHeight * 1.08;
        if (card?.classList.contains("pc") || naturallyWide) {
          frame?.classList.add("is-landscape");
          card?.classList.add("landscape-art");
        }
        frame?.classList.add("has-cover");
      };
      if (img.complete && img.naturalWidth) show();
      else img.addEventListener("load", show, { once: true });
      img.addEventListener("error", () => img.remove(), { once: true });
    });
  }

  function updateCounts() {
    const counts = games.reduce((acc, game) => {
      acc[game.category] = (acc[game.category] || 0) + 1;
      return acc;
    }, {});
    document.querySelector("#count-all").textContent = games.length;
    document.querySelector("#catalogCount").textContent = `${games.length.toLocaleString()} catalog entries`;
    document.querySelectorAll(".filter[data-filter]").forEach((button) => {
      if (button.dataset.filter === "all") return;
      const target = document.querySelector(`#count-${CSS.escape(safeId(button.dataset.filter))}`);
      if (target) target.textContent = counts[button.dataset.filter] || 0;
    });
  }

  function filteredGames() {
    const term = search.value.trim().toLocaleLowerCase();
    const result = games.filter((game) => {
      const inCategory = activeFilter === "all" || game.category === activeFilter;
      const haystack = `${game.id} ${game.title} ${game.system} ${game.genre || ""}`.toLocaleLowerCase();
      return inCategory && (!term || haystack.includes(term));
    });
    return result.sort((a, b) => {
      if (sort.value === "random") return activeFilter === "all"
        ? (randomOrder.get(a.id) ?? 0) - (randomOrder.get(b.id) ?? 0)
        : a.id.localeCompare(b.id, undefined, { numeric: true });
      if (sort.value === "title") return a.title.localeCompare(b.title);
      if (sort.value === "year-desc") return (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title);
      if (sort.value === "year-asc") return (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title);
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    });
  }

  function render() {
    const found = filteredGames();
    const shown = found.slice(0, pageSize);
    resultCount.textContent = `${found.length.toLocaleString()} ${found.length === 1 ? "game" : "games"}`;
    activeLabel.textContent = activeFilter === "all" ? "All systems" : activeFilter.replace("NSO: ", "Nintendo Switch Online · ").replace("Emulation: ", "Emulation · ");
    empty.hidden = found.length > 0;
    grid.hidden = found.length === 0;
    grid.innerHTML = shown.map((game) => {
      const year = game.year || "Year pending";
      const status = game.status && game.status !== "Available" ? game.status : game.access;
      const coverUrl = covers[game.id];
      const landscape = game.category === "PC";
      const changeEligible = viewer?.user && viewerRequest && ["pending", "awaiting_payment", "approved", "scheduled"].includes(viewerRequest.status) && !viewerRequest.pendingChange && (viewer.isOwner || Number(viewerRequest.viewerChangeCount || 0) < 1) && viewerRequest.gameId !== game.id;
      return `<article class="game-card ${colors[game.category] || ""}${landscape ? " landscape-art" : ""}" tabindex="0">
        <div class="cover-frame${landscape ? " is-landscape" : ""}">
          <div class="cover-fallback" aria-hidden="true"><span>Cover unavailable</span><b>${escapeHtml(game.title)}</b></div>
          ${coverUrl ? `<img class="cover-art" src="${escapeHtml(coverUrl)}" alt="${escapeHtml(game.title)} cover art" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}
          <div class="card-top"><span class="game-id">${escapeHtml(game.id)}</span><span class="access-badge">${escapeHtml(status)}</span></div>
        </div>
        <div class="card-copy"><h2>${escapeHtml(game.title)}</h2><div class="system-line"><span>${escapeHtml(game.system)}</span><span>${escapeHtml(year)}</span></div></div>
        <div class="card-detail">
          <span class="detail-system">${escapeHtml(game.system)}</span>
          <p>${escapeHtml(game.summary)}</p>
          <div class="detail-meta">
            <span>${escapeHtml(year)}</span>
            ${game.genre ? `<span>${escapeHtml(game.genre)}</span>` : ""}
            <span>${escapeHtml(game.access)}</span>
          </div>
          ${game.storeUrl ? `<a class="store-link" href="${escapeHtml(game.storeUrl)}" target="_blank" rel="noopener noreferrer">PlayStation Store</a>` : ""}
          ${game.requestable === false
            ? '<button class="request-button unavailable" type="button" disabled>Requests unavailable</button>'
            : !availabilityState.open
              ? changeEligible
                ? `<button class="request-button change-game-button" data-change-id="${escapeHtml(game.id)}">${viewer.isOwner ? "Change request to this game" : "Use one game change"}</button>`
                : `<button class="request-button unavailable" type="button" disabled>${availabilityState.mode === "loading" ? "Checking availability" : "Requests closed"}</button>`
            : `<button class="request-button" data-request-id="${escapeHtml(game.id)}">Request this game</button>`}
        </div>
      </article>`;
    }).join("");
    if (found.length > pageSize) {
      grid.insertAdjacentHTML("beforeend", `<div class="empty" style="grid-column:1/-1;margin-top:0;padding:24px"><p>Showing the first ${pageSize} games. Search or choose a system to narrow the catalog.</p></div>`);
    }
    wireCovers();
  }

  function updateRequestDialog() {
    if (!selectedGame) return;
    const priceButtons = dialog.querySelectorAll(".price-options button");
    priceButtons.forEach((button) => {
      const price = Number(button.dataset.price);
      button.querySelector("b").textContent = viewer?.isOwner ? "$0" : `$${price}`;
      button.disabled = requestComplete;
    });
    if (!viewer?.user) {
      requestIdentity.innerHTML = '<span>Sign in with Twitch to submit this request.</span><button type="button" data-dialog-signin>Sign in</button>';
    } else {
      requestIdentity.innerHTML = `<span>Signed in as <strong>${escapeHtml(viewer.user.displayName)}</strong>${viewer.isOwner ? " · Owner requests are free" : ""}</span>`;
    }
    submitRequest.disabled = requestComplete || !viewer?.user || !selectedPlan;
    if (requestComplete) submitRequest.textContent = "Request submitted";
    else if (!viewer?.user) submitRequest.textContent = "Sign in to request";
    else if (!selectedPlan) submitRequest.textContent = "Select a request type";
    else submitRequest.textContent = viewer.isOwner ? "Submit free owner request" : "Submit request";
  }

  function openRequest(game) {
    selectedGame = game;
    selectedPlan = sessionStorage.getItem(PENDING_PLAN_KEY);
    sessionStorage.removeItem(PENDING_PLAN_KEY);
    requestComplete = false;
    requestTitle.textContent = game.title;
    requestMeta.textContent = `${game.id} · ${game.system} · ${game.year || "Year pending"}`;
    dialog.querySelectorAll(".price-options button").forEach((button) => {
      button.classList.toggle("selected", button.dataset.plan === selectedPlan);
      button.disabled = false;
    });
    dialog.querySelector(".price-options").hidden = false;
    dialog.querySelector(".dialog-note").hidden = false;
    setNotice("", "");
    updateRequestDialog();
    if (!dialog.open) dialog.showModal();
  }

  function closeRequest() {
    if (dialog.open) dialog.close();
    selectedGame = null;
    selectedPlan = null;
    requestComplete = false;
    sessionStorage.removeItem(PENDING_GAME_KEY);
    sessionStorage.removeItem(PENDING_PLAN_KEY);
  }

  document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach((item) => item.classList.toggle("active", item === button));
    render();
  }));
  search.addEventListener("input", render);
  sort.addEventListener("change", render);
  grid.addEventListener("click", (event) => {
    const changeButton = event.target.closest("[data-change-id]");
    if (changeButton) {
      const game = games.find((item) => item.id === changeButton.dataset.changeId);
      if (game) requestGameChange(game);
      return;
    }
    const button = event.target.closest("[data-request-id]");
    if (!button) return;
    const game = games.find((item) => item.id === button.dataset.requestId);
    if (game) openRequest(game);
  });
  async function requestGameChange(game) {
    if (!viewerRequest || !viewer?.user) return;
    const wording = viewer.isOwner
      ? `Change ${viewerRequest.gameTitle} to ${game.title}? This owner change will be applied immediately.`
      : `Use your one allowed game change to request ${game.title}? Staff must approve it, and this cannot be used again.`;
    if (!confirm(wording)) return;
    try {
      const data = await api("request_game_change", { requestId: viewerRequest.id, gameId: game.id });
      viewerRequest = data.request;
      renderViewerRequest(data.applied ? `The request was changed to ${game.title}.` : `Your change to ${game.title} is waiting for staff review.`);
      render();
      await loadAvailability();
    } catch (error) {
      renderViewerRequest(error.message, true);
    }
  }
  viewerRequestChange.addEventListener("click", () => {
    viewerRequestMessage.textContent = viewer?.isOwner
      ? "Choose any different game below to change this request immediately."
      : "Choose a different game below. Staff will review your one allowed change request.";
    document.querySelector(".catalog-shell")?.scrollIntoView({ behavior: "smooth", block: "start" });
    search.focus({ preventScroll: true });
  });
  dialog.querySelector(".price-options").addEventListener("click", (event) => {
    const option = event.target.closest("button[data-plan]");
    if (!option || requestComplete) return;
    selectedPlan = option.dataset.plan;
    dialog.querySelectorAll(".price-options button").forEach((item) => item.classList.toggle("selected", item === option));
    setNotice("", "");
    updateRequestDialog();
  });
  requestIdentity.addEventListener("click", (event) => {
    if (event.target.closest("[data-dialog-signin]")) startTwitchAuth();
  });
  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedGame || !selectedPlan || !viewer?.user || requestComplete) return;
    submitRequest.disabled = true;
    submitRequest.textContent = "Submitting request…";
    setNotice("", "");
    try {
      const data = await api("submit", { gameId: selectedGame.id, plan: selectedPlan });
      const result = data.request;
      requestComplete = true;
      dialog.querySelector(".price-options").hidden = true;
      dialog.querySelector(".dialog-note").hidden = true;
      setNotice("success", result.isOwner
        ? `${result.code} is approved as a free owner request.${data.discordPosted ? " The Discord record has been created." : " The request is saved; its Discord record is pending."}`
        : `${result.code} was submitted for review. Payment will open only after approval.`);
      updateRequestDialog();
      loadAvailability();
      loadViewerRequest();
    } catch (error) {
      setNotice("error", error.message);
      submitRequest.disabled = false;
      updateRequestDialog();
    }
  });
  document.querySelector("#requestClose").addEventListener("click", closeRequest);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeRequest(); });
  twitchSignIn.addEventListener("click", startTwitchAuth);
  twitchSignOut.addEventListener("click", () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setViewer(null);
  });
  viewerRequestPay.addEventListener("click", async () => {
    if (!viewerRequest) return;
    renderViewerRequest("Creating a secure PayPal checkout…");
    viewerRequestPay.disabled = true;
    viewerRequestPay.textContent = "Opening PayPal…";
    try {
      const data = await api("create_payment", { requestId: viewerRequest.id });
      if (data.completed) {
        viewerRequest = data.request;
        renderViewerRequest("This payment is already verified.");
        return;
      }
      location.assign(data.approvalUrl);
    } catch (error) {
      viewerRequestPay.disabled = false;
      renderViewerRequest(error.message, true);
    }
  });

  updateCounts();
  updateAvailabilityBanner();
  render();
  loadAvailability();
  loadViewer();
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    loadAvailability();
    if (viewer?.user) loadViewerRequest();
  }, 30000);
})();
