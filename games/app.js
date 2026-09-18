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
  const pageSize = 96;
  let activeFilter = "all";
  let viewer = null;
  let selectedGame = null;
  let selectedPlan = null;
  let requestComplete = false;

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
    }
    updateRequestDialog();
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
    const button = event.target.closest("[data-request-id]");
    if (!button) return;
    const game = games.find((item) => item.id === button.dataset.requestId);
    if (game) openRequest(game);
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

  updateCounts();
  render();
  loadViewer();
})();
