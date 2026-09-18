(() => {
  const games = Array.isArray(window.GAME_CATALOG) ? window.GAME_CATALOG : [];
  const covers = window.GAME_COVERS || {};
  const grid = document.querySelector('#gameGrid');
  const search = document.querySelector('#searchInput');
  const sort = document.querySelector('#sortSelect');
  const resultCount = document.querySelector('#resultCount');
  const activeLabel = document.querySelector('#activeLabel');
  const empty = document.querySelector('#emptyState');
  const dialog = document.querySelector('#requestDialog');
  const requestTitle = document.querySelector('#requestTitle');
  const requestMeta = document.querySelector('#requestMeta');
  const pageSize = 96;
  let activeFilter = 'all';

  const colors = {
    'PC': 'pc', 'Nintendo Switch': 'switch', 'Nintendo Switch 2': 'switch',
    'PlayStation 5': 'playstation', 'PlayStation 4': 'playstation-4',
    'Xbox Series X': 'xbox', 'Xbox 360': 'xbox-360', 'NSO: NES': 'nes',
    'NSO: SNES': 'snes', 'NSO: Game Boy': 'game-boy',
    'NSO: Game Boy Color': 'game-boy-color', 'NSO: Nintendo 64': 'nintendo-64',
    'NSO: Game Boy Advance': 'game-boy-advance', 'NSO: Sega Genesis': 'sega-genesis',
    'NSO: Virtual Boy': 'virtual-boy', 'NSO: GameCube': 'gamecube',
    'Emulation: SNES': 'emulation'
  };

  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
  const safeId = value => String(value).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function wireCovers() {
    document.querySelectorAll('.cover-art').forEach(img => {
      const show = () => {
        const frame = img.closest('.cover-frame');
        const card = img.closest('.game-card');
        const naturallyWide = img.naturalWidth > img.naturalHeight * 1.08;
        if (card?.classList.contains('pc') || naturallyWide) {
          frame?.classList.add('is-landscape');
          card?.classList.add('landscape-art');
        }
        frame?.classList.add('has-cover');
      };
      if (img.complete && img.naturalWidth) show();
      else img.addEventListener('load', show, { once: true });
      img.addEventListener('error', () => img.remove(), { once: true });
    });
  }

  function updateCounts() {
    const counts = games.reduce((acc, game) => {
      acc[game.category] = (acc[game.category] || 0) + 1;
      return acc;
    }, {});
    document.querySelector('#count-all').textContent = games.length;
    document.querySelector('#catalogCount').textContent = `${games.length.toLocaleString()} catalog entries`;
    document.querySelectorAll('.filter[data-filter]').forEach(button => {
      if (button.dataset.filter === 'all') return;
      const target = document.querySelector(`#count-${CSS.escape(safeId(button.dataset.filter))}`);
      if (target) target.textContent = counts[button.dataset.filter] || 0;
    });
  }

  function filteredGames() {
    const term = search.value.trim().toLocaleLowerCase();
    const result = games.filter(game => {
      const inCategory = activeFilter === 'all' || game.category === activeFilter;
      const haystack = `${game.id} ${game.title} ${game.system} ${game.genre || ''}`.toLocaleLowerCase();
      return inCategory && (!term || haystack.includes(term));
    });
    return result.sort((a, b) => {
      if (sort.value === 'title') return a.title.localeCompare(b.title);
      if (sort.value === 'year-desc') return (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title);
      if (sort.value === 'year-asc') return (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title);
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    });
  }

  function render() {
    const found = filteredGames();
    const shown = found.slice(0, pageSize);
    resultCount.textContent = `${found.length.toLocaleString()} ${found.length === 1 ? 'game' : 'games'}`;
    activeLabel.textContent = activeFilter === 'all' ? 'All systems' : activeFilter.replace('NSO: ', 'Nintendo Switch Online · ').replace('Emulation: ', 'Emulation · ');
    empty.hidden = found.length > 0;
    grid.hidden = found.length === 0;
    grid.innerHTML = shown.map(game => {
      const year = game.year || 'Year pending';
      const status = game.status && game.status !== 'Available' ? game.status : game.access;
      const coverUrl = covers[game.id];
      const landscape = game.category === 'PC';
      return `<article class="game-card ${colors[game.category] || ''}${landscape ? ' landscape-art' : ''}" tabindex="0">
        <div class="cover-frame${landscape ? ' is-landscape' : ''}">
          <div class="cover-fallback" aria-hidden="true"><span>Cover unavailable</span><b>${escapeHtml(game.title)}</b></div>
          ${coverUrl ? `<img class="cover-art" src="${escapeHtml(coverUrl)}" alt="${escapeHtml(game.title)} cover art" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
          <div class="card-top"><span class="game-id">${escapeHtml(game.id)}</span><span class="access-badge">${escapeHtml(status)}</span></div>
        </div>
        <div class="card-copy"><h2>${escapeHtml(game.title)}</h2><div class="system-line"><span>${escapeHtml(game.system)}</span><span>${escapeHtml(year)}</span></div></div>
        <div class="card-detail">
          <span class="detail-system">${escapeHtml(game.system)}</span>
          <p>${escapeHtml(game.summary)}</p>
          <div class="detail-meta">
            <span>${escapeHtml(year)}</span>
            ${game.genre ? `<span>${escapeHtml(game.genre)}</span>` : ''}
            <span>${escapeHtml(game.access)}</span>
          </div>
          ${game.storeUrl ? `<a class="store-link" href="${escapeHtml(game.storeUrl)}" target="_blank" rel="noopener noreferrer">PlayStation Store</a>` : ''}
          ${game.requestable === false
            ? '<button class="request-button unavailable" type="button" disabled>Requests unavailable</button>'
            : `<button class="request-button" data-request-id="${escapeHtml(game.id)}">Request this game</button>`}
        </div>
      </article>`;
    }).join('');
    if (found.length > pageSize) {
      grid.insertAdjacentHTML('beforeend', `<div class="empty" style="grid-column:1/-1;margin-top:0;padding:24px"><p>Showing the first ${pageSize} games. Search or choose a system to narrow the catalog.</p></div>`);
    }
    wireCovers();
  }

  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === button));
    render();
  }));
  search.addEventListener('input', render);
  sort.addEventListener('change', render);
  grid.addEventListener('click', event => {
    const button = event.target.closest('[data-request-id]');
    if (!button) return;
    const game = games.find(item => item.id === button.dataset.requestId);
    if (!game) return;
    requestTitle.textContent = game.title;
    requestMeta.textContent = `${game.id} · ${game.system} · ${game.year || 'Year pending'}`;
    dialog.querySelectorAll('.price-options button').forEach(item => item.classList.remove('selected'));
    dialog.showModal();
  });
  dialog.querySelector('.price-options').addEventListener('click', event => {
    const option = event.target.closest('button[data-plan]');
    if (!option) return;
    dialog.querySelectorAll('.price-options button').forEach(item => item.classList.toggle('selected', item === option));
  });

  updateCounts();
  render();
})();
