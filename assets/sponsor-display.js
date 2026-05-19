(() => {
  const P = window.PepsSponsor;
  const qs = new URLSearchParams(location.search);
  const isPreview = qs.get("preview") === "1";
  let state = P.loadState();
  let currentIndex = state.currentIndex || 0;
  let timer = null;
  let visible = state.isVisible !== false;
  let paused = !!state.isPaused;
  let lastCommandTs = state.command?.ts || 0;

  const stage = document.getElementById("displayStage");
  const layer = document.getElementById("sponsorLayer");
  const emptyState = document.getElementById("emptyState");
  const safeAreaGuide = document.getElementById("safeAreaGuide");

  function activeMode() {
    const p = P.getActivePlaylist(state);
    return p?.mode || state.settings.skin || "bottom_bar";
  }

  async function render() {
    P.applyCssVars(state);
    visible = state.isVisible !== false;
    paused = !!state.isPaused;

    const playlist = P.getActivePlaylist(state);
    const sponsors = P.getPlaylistSponsors(state, playlist);
    const mode = activeMode();
    const position = state.settings.position || "bottom";

    stage.className = `display-stage skin-${mode} position-${position} shadow-${state.settings.shadow || "soft"}`;
    stage.classList.toggle("is-hidden", !visible);
    safeAreaGuide.classList.toggle("show", !!state.settings.safeArea || isPreview);

    if (!sponsors.length) {
      layer.innerHTML = "";
      emptyState.classList.add("show");
      return;
    }

    emptyState.classList.remove("show");
    const safeIndex = ((currentIndex % sponsors.length) + sponsors.length) % sponsors.length;

    if (mode === "ticker") {
      await renderTicker(sponsors);
    } else if (mode === "grid") {
      await renderGrid(sponsors);
    } else if (mode === "corner_badge") {
      await renderCorner(sponsors[safeIndex]);
    } else if (mode === "side_tower") {
      await renderSide(sponsors.slice(0, 5));
    } else if (mode === "fullscreen_break") {
      await renderBreak(sponsors);
    } else if (mode === "goal_popup") {
      await renderGoal(sponsors[safeIndex]);
    } else {
      await renderBottom(sponsors.slice(0, Math.min(6, sponsors.length)));
    }

    scheduleNext();
  }

  async function sponsorTile(sponsor, onlyLogo = false) {
    const src = await P.dbGetImageUrl(sponsor.imageKey);
    const nameHtml = state.settings.showNames && !onlyLogo
      ? `<span class="logo-name"><strong>${escapeHtml(sponsor.name)}</strong>${state.settings.showTier ? `<span>${escapeHtml(P.tierLabels[sponsor.tier] || sponsor.tier)}</span>` : ""}</span>`
      : "";
    return `<article class="logo-tile ${nameHtml ? "" : "only-logo"}">
      <img src="${src}" alt="${escapeHtml(sponsor.name)}">
      ${nameHtml}
    </article>`;
  }

  async function renderBottom(sponsors) {
    const items = [];
    for (const s of sponsors) items.push(await sponsorTile(s));
    layer.innerHTML = `<div class="sponsor-strip">${items.join("")}</div>`;
  }

  async function renderCorner(sponsor) {
    layer.innerHTML = `<div class="sponsor-corner">${await sponsorTile(sponsor)}</div>`;
  }

  async function renderSide(sponsors) {
    const items = [];
    for (const s of sponsors) items.push(await sponsorTile(s, false));
    layer.innerHTML = `<div class="sponsor-side">${items.join("")}</div>`;
  }

  async function renderTicker(sponsors) {
    const doubled = [...sponsors, ...sponsors, ...sponsors];
    const items = [];
    for (const s of doubled) items.push(await sponsorTile(s));
    layer.innerHTML = `<div class="sponsor-ticker ${paused ? "paused" : ""}">
      <div class="sponsor-ticker-track">${items.join("")}</div>
    </div>`;
  }

  async function renderGrid(sponsors) {
    const items = [];
    for (const s of sponsors) items.push(await sponsorTile(s));
    layer.innerHTML = `<div class="sponsor-grid">${items.join("")}</div>`;
  }

  async function renderBreak(sponsors) {
    const items = [];
    for (const s of sponsors.slice(0, 8)) items.push(await sponsorTile(s, false));
    layer.innerHTML = `<div class="sponsor-break">
      <div class="sponsor-break-card">
        <h1 class="sponsor-break-title">Presented By</h1>
        <div class="sponsor-break-logos">${items.join("")}</div>
      </div>
    </div>`;
  }

  async function renderGoal(sponsor) {
    const src = await P.dbGetImageUrl(sponsor.imageKey);
    layer.innerHTML = `<div class="sponsor-goal">
      <article class="sponsor-goal-card">
        <img src="${src}" alt="${escapeHtml(sponsor.name)}">
        <div class="goal-copy">
          <b>GOAL</b>
          <span>Presented by ${escapeHtml(sponsor.name)}</span>
        </div>
      </article>
    </div>`;
  }

  function scheduleNext() {
    clearTimeout(timer);
    const playlist = P.getActivePlaylist(state);
    const sponsors = P.getPlaylistSponsors(state, playlist);
    if (!state.settings.autoPlay || paused || !sponsors.length) return;
    const sponsor = sponsors[((currentIndex % sponsors.length) + sponsors.length) % sponsors.length];
    const duration = Number(sponsor.duration || playlist?.defaultDuration || 6) * 1000;
    timer = setTimeout(() => {
      currentIndex += 1;
      render();
    }, Math.max(1500, duration));
  }

  async function handleCommand(command) {
    if (!command || command.ts <= lastCommandTs) return;
    lastCommandTs = command.ts;

    const playlist = P.getActivePlaylist(state);
    const sponsors = P.getPlaylistSponsors(state, playlist);

    if (command.type === "show") {
      visible = true;
      state.isVisible = true;
    } else if (command.type === "hide") {
      visible = false;
      state.isVisible = false;
    } else if (command.type === "next") {
      currentIndex += 1;
    } else if (command.type === "prev") {
      currentIndex -= 1;
    } else if (command.type === "pause") {
      paused = !paused;
      state.isPaused = paused;
    } else if (command.type === "reload") {
      location.reload();
      return;
    } else if (command.type === "break") {
      const prevMode = playlist?.mode;
      if (playlist) playlist.mode = "fullscreen_break";
      await render();
      setTimeout(() => {
        if (playlist) playlist.mode = prevMode || state.settings.skin;
        render();
      }, Number(command.payload?.duration || 10) * 1000);
      return;
    } else if (command.type === "goal") {
      const prevMode = playlist?.mode;
      if (playlist) playlist.mode = "goal_popup";
      if (sponsors.length) currentIndex = ((currentIndex % sponsors.length) + sponsors.length) % sponsors.length;
      await render();
      setTimeout(() => {
        if (playlist) playlist.mode = prevMode || state.settings.skin;
        render();
      }, Number(command.payload?.duration || 5) * 1000);
      return;
    }

    render();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  P.subscribe((message) => {
    if (!message) return;
    if (message.type === "state") {
      state = P.loadState();
      currentIndex = state.currentIndex || currentIndex;
      render();
    }
    if (message.type === "command") {
      state = message.state || P.loadState();
      handleCommand(message.command || state.command);
    }
  });

  window.addEventListener("focus", () => {
    state = P.loadState();
    render();
  });

  P.seedSamplesIfEmpty().then((nextState) => {
    state = nextState || P.loadState();
    render();
  });
})();
