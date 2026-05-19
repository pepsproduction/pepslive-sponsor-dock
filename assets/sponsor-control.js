(() => {
  const P = window.PepsSponsor;
  let state = P.loadState();
  let obs = null;
  let obsConnected = false;
  let renderToken = 0;

  const $ = (id) => document.getElementById(id);

  const els = {
    saveStatus: $("saveStatus"),
    projectStatus: $("projectStatus"),
    sponsorCount: $("sponsorCount"),
    playlistStatus: $("playlistStatus"),
    obsStatus: $("obsStatus"),
    projectName: $("projectName"),
    skin: $("skin"),
    position: $("position"),
    logoSize: $("logoSize"),
    gap: $("gap"),
    speed: $("speed"),
    radius: $("radius"),
    opacity: $("opacity"),
    shadow: $("shadow"),
    autoPlay: $("autoPlay"),
    safeArea: $("safeArea"),
    showNames: $("showNames"),
    showTier: $("showTier"),
    obsHost: $("obsHost"),
    obsPort: $("obsPort"),
    obsPassword: $("obsPassword"),
    obsSourceName: $("obsSourceName"),
    activePlaylist: $("activePlaylist"),
    playlistName: $("playlistName"),
    playlistMode: $("playlistMode"),
    playlistDuration: $("playlistDuration"),
    sponsorList: $("sponsorList"),
    sponsorSearch: $("sponsorSearch"),
    tierFilter: $("tierFilter"),
    playlistItems: $("playlistItems"),
    sponsorFiles: $("sponsorFiles"),
    importProjectInput: $("importProjectInput"),
    previewFrame: $("previewFrame")
  };

  function setStatus(text, tone = "") {
    els.saveStatus.textContent = text;
    els.saveStatus.className = `pill ${tone}`.trim();
  }

  function persist(label = "Saved") {
    state = P.saveState(state);
    setStatus(label);
    refreshStatus();
    P.broadcast({ type: "state", state });
  }

  function command(type, payload = {}) {
    state.command = { type, payload, ts: Date.now() };
    if (type === "show") state.isVisible = true;
    if (type === "hide") state.isVisible = false;
    if (type === "pause") state.isPaused = !state.isPaused;
    if (type === "next") state.currentIndex += 1;
    if (type === "prev") state.currentIndex = Math.max(0, state.currentIndex - 1);
    persist(`Command: ${type}`);
    P.broadcast({ type: "command", command: state.command, state });
  }

  function refreshStatus() {
    const playlist = P.getActivePlaylist(state);
    els.projectStatus.textContent = state.projectName || "-";
    els.sponsorCount.textContent = state.sponsors.length;
    els.playlistStatus.textContent = playlist ? playlist.name : "-";
    els.obsStatus.textContent = obsConnected ? "Connected" : "Disconnected";
    els.obsStatus.style.color = obsConnected ? "var(--success)" : "inherit";
  }

  function bindFieldsFromState() {
    els.projectName.value = state.projectName;
    els.skin.value = state.settings.skin;
    els.position.value = state.settings.position;
    els.logoSize.value = state.settings.logoSize;
    els.gap.value = state.settings.gap;
    els.speed.value = state.settings.speed;
    els.radius.value = state.settings.radius;
    els.opacity.value = state.settings.opacity;
    els.shadow.value = state.settings.shadow;
    els.autoPlay.checked = !!state.settings.autoPlay;
    els.safeArea.checked = !!state.settings.safeArea;
    els.showNames.checked = !!state.settings.showNames;
    els.showTier.checked = !!state.settings.showTier;

    els.obsHost.value = state.obs.host;
    els.obsPort.value = state.obs.port;
    els.obsPassword.value = state.obs.password || "";
    els.obsSourceName.value = state.obs.sourceName;

    updateRangeLabels();
  }

  function updateRangeLabels() {
    $("logoSizeValue").textContent = `${els.logoSize.value}px`;
    $("gapValue").textContent = `${els.gap.value}px`;
    $("speedValue").textContent = `${els.speed.value}s`;
    $("radiusValue").textContent = `${els.radius.value}px`;
    $("opacityValue").textContent = `${els.opacity.value}%`;
  }

  function collectSettings() {
    state.projectName = els.projectName.value.trim() || "PepsLive Match Sponsor";
    state.settings.skin = els.skin.value;
    state.settings.position = els.position.value;
    state.settings.logoSize = Number(els.logoSize.value);
    state.settings.gap = Number(els.gap.value);
    state.settings.speed = Number(els.speed.value);
    state.settings.radius = Number(els.radius.value);
    state.settings.opacity = Number(els.opacity.value);
    state.settings.shadow = els.shadow.value;
    state.settings.autoPlay = els.autoPlay.checked;
    state.settings.safeArea = els.safeArea.checked;
    state.settings.showNames = els.showNames.checked;
    state.settings.showTier = els.showTier.checked;

    state.obs.host = els.obsHost.value.trim() || "127.0.0.1";
    state.obs.port = Number(els.obsPort.value || 4455);
    state.obs.password = els.obsPassword.value;
    state.obs.sourceName = els.obsSourceName.value.trim() || "PEPS_SPONSOR_DISPLAY";
  }

  async function renderSponsorList() {
    const token = ++renderToken;
    const search = els.sponsorSearch.value.trim().toLowerCase();
    const tier = els.tierFilter.value;
    els.sponsorList.innerHTML = "";

    const list = state.sponsors.filter((s) => {
      const okSearch = !search || s.name.toLowerCase().includes(search);
      const okTier = tier === "all" || s.tier === tier;
      return okSearch && okTier;
    });

    if (!list.length) {
      els.sponsorList.innerHTML = `<div class="note">ยังไม่มีโลโก้ในเงื่อนไขนี้</div>`;
      return;
    }

    const template = $("sponsorCardTemplate");
    for (const sponsor of list) {
      if (token !== renderToken) return;
      const node = template.content.cloneNode(true);
      const card = node.querySelector(".sponsor-card");
      const img = node.querySelector(".sponsor-logo");
      const name = node.querySelector(".sponsor-name");
      const tierSelect = node.querySelector(".sponsor-tier");
      const duration = node.querySelector(".sponsor-duration");
      const enabled = node.querySelector(".sponsor-enabled");

      card.dataset.id = sponsor.id;
      img.alt = sponsor.name;
      img.src = await P.dbGetImageUrl(sponsor.imageKey);
      name.value = sponsor.name;
      tierSelect.value = sponsor.tier || "partner";
      duration.value = sponsor.duration || 6;
      enabled.checked = sponsor.enabled !== false;

      name.addEventListener("change", () => updateSponsor(sponsor.id, { name: name.value.trim() || "Sponsor" }));
      tierSelect.addEventListener("change", () => updateSponsor(sponsor.id, { tier: tierSelect.value }));
      duration.addEventListener("change", () => updateSponsor(sponsor.id, { duration: Number(duration.value || 6) }));
      enabled.addEventListener("change", () => updateSponsor(sponsor.id, { enabled: enabled.checked }));

      node.querySelector(".remove-sponsor").addEventListener("click", () => removeSponsor(sponsor.id));
      node.querySelector(".add-to-playlist").addEventListener("click", () => addSponsorToActivePlaylist(sponsor.id));

      els.sponsorList.appendChild(node);
    }
  }

  function updateSponsor(id, patch) {
    const sponsor = state.sponsors.find((s) => s.id === id);
    if (!sponsor) return;
    Object.assign(sponsor, patch);
    persist("Sponsor saved");
    renderSponsorList();
    renderPlaylistItems();
  }

  async function removeSponsor(id) {
    const ok = confirm("ลบ Sponsor นี้ออกจากโปรเจกต์?");
    if (!ok) return;
    const sponsor = state.sponsors.find((s) => s.id === id);
    state.sponsors = state.sponsors.filter((s) => s.id !== id);
    state.playlists = state.playlists.map((p) => ({
      ...p,
      sponsorIds: (p.sponsorIds || []).filter((sid) => sid !== id)
    }));
    if (sponsor?.imageKey) await P.dbDeleteImage(sponsor.imageKey);
    persist("Sponsor removed");
    await renderSponsorList();
    renderPlaylists();
  }

  async function addSponsorsFromFiles(files) {
    const addedIds = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const id = P.uid("sp");
      await P.dbPutImage(id, file, { name: file.name, type: file.type });
      state.sponsors.push({
        id,
        imageKey: id,
        name: file.name.replace(/\.[^.]+$/, ""),
        tier: "partner",
        duration: 6,
        enabled: true,
        createdAt: P.nowIso()
      });
      addedIds.push(id);
    }

    const playlist = P.getActivePlaylist(state);
    if (playlist) {
      playlist.sponsorIds = Array.from(new Set([...(playlist.sponsorIds || []), ...addedIds]));
    }
    persist(`${addedIds.length} sponsor added`);
    await renderSponsorList();
    renderPlaylists();
  }

  function renderPlaylists() {
    els.activePlaylist.innerHTML = "";
    for (const p of state.playlists) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      els.activePlaylist.appendChild(opt);
    }
    els.activePlaylist.value = state.activePlaylist;
    bindPlaylistFields();
    renderPlaylistItems();
  }

  function bindPlaylistFields() {
    const p = P.getActivePlaylist(state);
    if (!p) return;
    els.playlistName.value = p.name;
    els.playlistMode.value = p.mode || state.settings.skin;
    els.playlistDuration.value = p.defaultDuration || 6;
  }

  async function renderPlaylistItems() {
    els.playlistItems.innerHTML = "";
    const p = P.getActivePlaylist(state);
    if (!p) return;
    const byId = new Map(state.sponsors.map((s) => [s.id, s]));
    const ids = p.sponsorIds || [];
    if (!ids.length) {
      els.playlistItems.innerHTML = `<div class="note">Playlist นี้ยังว่าง กด "ใส่ Playlist" จาก Sponsor Library</div>`;
      return;
    }

    for (let index = 0; index < ids.length; index += 1) {
      const sponsor = byId.get(ids[index]);
      if (!sponsor) continue;
      const row = document.createElement("div");
      row.className = "playlist-row";
      row.dataset.id = sponsor.id;
      const src = await P.dbGetImageUrl(sponsor.imageKey);
      row.innerHTML = `
        <div class="drag-handle">${index + 1}</div>
        <img class="playlist-thumb" alt="" src="${src}">
        <strong>${escapeHtml(sponsor.name)}</strong>
        <span>${P.tierLabels[sponsor.tier] || sponsor.tier}</span>
        <div class="button-row" style="margin:0">
          <button class="btn tiny move-up" type="button">ขึ้น</button>
          <button class="btn tiny move-down" type="button">ลง</button>
          <button class="btn tiny danger remove-from-playlist" type="button">เอาออก</button>
        </div>
      `;
      row.querySelector(".move-up").addEventListener("click", () => movePlaylistItem(index, -1));
      row.querySelector(".move-down").addEventListener("click", () => movePlaylistItem(index, 1));
      row.querySelector(".remove-from-playlist").addEventListener("click", () => removeFromPlaylist(sponsor.id));
      els.playlistItems.appendChild(row);
    }
  }

  function addSponsorToActivePlaylist(id) {
    const p = P.getActivePlaylist(state);
    if (!p) return;
    p.sponsorIds = Array.from(new Set([...(p.sponsorIds || []), id]));
    persist("Added to playlist");
    renderPlaylistItems();
  }

  function removeFromPlaylist(id) {
    const p = P.getActivePlaylist(state);
    if (!p) return;
    p.sponsorIds = (p.sponsorIds || []).filter((sid) => sid !== id);
    persist("Removed from playlist");
    renderPlaylistItems();
  }

  function movePlaylistItem(index, delta) {
    const p = P.getActivePlaylist(state);
    if (!p) return;
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= p.sponsorIds.length) return;
    const ids = [...p.sponsorIds];
    const [item] = ids.splice(index, 1);
    ids.splice(nextIndex, 0, item);
    p.sponsorIds = ids;
    persist("Playlist reordered");
    renderPlaylistItems();
  }

  function savePlaylistFields() {
    const p = P.getActivePlaylist(state);
    if (!p) return;
    p.name = els.playlistName.value.trim() || "Playlist";
    p.mode = els.playlistMode.value;
    p.defaultDuration = Number(els.playlistDuration.value || 6);
    state.settings.skin = p.mode;
    persist("Playlist saved");
    bindFieldsFromState();
    renderPlaylists();
  }

  function addPlaylist() {
    const id = P.uid("pl");
    state.playlists.push({
      id,
      name: "Playlist ใหม่",
      mode: state.settings.skin,
      defaultDuration: 6,
      sponsorIds: []
    });
    state.activePlaylist = id;
    persist("Playlist added");
    renderPlaylists();
  }

  function deletePlaylist() {
    if (state.playlists.length <= 1) {
      alert("ต้องมี Playlist อย่างน้อย 1 ชุด");
      return;
    }
    const p = P.getActivePlaylist(state);
    if (!p) return;
    if (!confirm(`ลบ Playlist "${p.name}" ?`)) return;
    state.playlists = state.playlists.filter((item) => item.id !== p.id);
    state.activePlaylist = state.playlists[0].id;
    persist("Playlist deleted");
    renderPlaylists();
  }

  function shufflePlaylist() {
    const p = P.getActivePlaylist(state);
    if (!p) return;
    const ids = [...(p.sponsorIds || [])];
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    p.sponsorIds = ids;
    persist("Playlist shuffled");
    renderPlaylistItems();
  }

  async function exportProject() {
    collectSettings();
    const output = P.clone(state);
    output.exportedAt = P.nowIso();
    output.images = {};
    for (const sponsor of output.sponsors) {
      const rec = await P.dbGetImageRecord(sponsor.imageKey);
      if (rec?.blob) {
        output.images[sponsor.imageKey] = {
          name: rec.name,
          type: rec.type,
          dataUrl: await P.blobToDataUrl(rec.blob)
        };
      }
    }
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${safeFileName(output.projectName)}-sponsor-project.json`);
  }

  async function importProject(file) {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (imported.images) {
      for (const [id, img] of Object.entries(imported.images)) {
        if (img.dataUrl) {
          await P.dbPutImage(id, P.dataUrlToBlob(img.dataUrl), { name: img.name, type: img.type });
        }
      }
      delete imported.images;
    }
    state = P.saveState(imported);
    bindFieldsFromState();
    await renderSponsorList();
    renderPlaylists();
    persist("Project imported");
  }

  async function loadSample() {
    await P.dbClearImages();
    P.resetState();
    state = await P.seedSamplesIfEmpty();
    bindFieldsFromState();
    await renderSponsorList();
    renderPlaylists();
    persist("Sample loaded");
  }

  async function resetProject() {
    if (!confirm("Reset โปรเจกต์ทั้งหมด รวมถึงรูปในเครื่องนี้?")) return;
    await P.dbClearImages();
    P.resetState();
    state = P.defaultState();
    state = P.saveState(state);
    bindFieldsFromState();
    await renderSponsorList();
    renderPlaylists();
    persist("Reset complete");
  }

  async function connectObs() {
    collectSettings();
    if (!window.OBSWebSocket) {
      alert("โหลด obs-websocket-js ไม่สำเร็จ ตรวจอินเทอร์เน็ตหรือ CDN");
      return;
    }
    try {
      obs = new window.OBSWebSocket();
      await obs.connect(`ws://${state.obs.host}:${state.obs.port}`, state.obs.password || undefined);
      obsConnected = true;
      refreshStatus();
      persist("OBS connected");
    } catch (error) {
      obsConnected = false;
      refreshStatus();
      alert(`เชื่อมต่อ OBS ไม่สำเร็จ: ${error.message || error}`);
    }
  }

  async function createBrowserSource() {
    if (!obsConnected || !obs) {
      alert("ต้อง Connect OBS ก่อน");
      return;
    }
    collectSettings();
    const url = new URL("./sponsor-display.html", window.location.href).href;
    try {
      const sceneResp = await obs.call("GetCurrentProgramScene");
      const sceneName = sceneResp.currentProgramSceneName;
      const sourceName = state.obs.sourceName;

      const inputSettings = {
        url,
        width: state.obs.width,
        height: state.obs.height,
        css: "body { background-color: rgba(0, 0, 0, 0); margin: 0; overflow: hidden; }",
        shutdown: false,
        restart_when_active: false
      };

      try {
        await obs.call("GetInputSettings", { inputName: sourceName });
        await obs.call("SetInputSettings", {
          inputName: sourceName,
          inputSettings,
          overlay: true
        });
      } catch {
        await obs.call("CreateInput", {
          sceneName,
          inputName: sourceName,
          inputKind: "browser_source",
          inputSettings,
          sceneItemEnabled: true
        });
      }
      persist("OBS source ready");
    } catch (error) {
      alert(`สร้าง Browser Source ไม่สำเร็จ: ${error.message || error}`);
    }
  }

  async function refreshBrowserSource() {
    if (!obsConnected || !obs) {
      alert("ต้อง Connect OBS ก่อน");
      return;
    }
    try {
      await obs.call("PressInputPropertiesButton", {
        inputName: state.obs.sourceName,
        propertyName: "refreshnocache"
      });
      command("reload");
    } catch (error) {
      alert(`Refresh ไม่สำเร็จ: ${error.message || error}`);
    }
  }

  async function setSourceVisibility(visible) {
    if (!obsConnected || !obs) {
      command(visible ? "show" : "hide");
      return;
    }
    try {
      const sceneResp = await obs.call("GetCurrentProgramScene");
      const sceneName = sceneResp.currentProgramSceneName;
      const item = await obs.call("GetSceneItemId", {
        sceneName,
        sourceName: state.obs.sourceName
      });
      await obs.call("SetSceneItemEnabled", {
        sceneName,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: visible
      });
      command(visible ? "show" : "hide");
    } catch (error) {
      alert(`สั่ง Source ไม่สำเร็จ: ${error.message || error}`);
    }
  }

  function downloadBlob(blob, fileName) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function safeFileName(name) {
    return String(name || "pepslive")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .toLowerCase();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function wireEvents() {
    const settingIds = [
      "projectName", "skin", "position", "logoSize", "gap", "speed",
      "radius", "opacity", "shadow", "autoPlay", "safeArea", "showNames", "showTier",
      "obsHost", "obsPort", "obsPassword", "obsSourceName"
    ];

    for (const id of settingIds) {
      const el = $(id);
      el.addEventListener("input", () => {
        collectSettings();
        updateRangeLabels();
        persist("Saved");
      });
      el.addEventListener("change", () => {
        collectSettings();
        updateRangeLabels();
        persist("Saved");
      });
    }

    $("saveNowBtn").addEventListener("click", () => {
      collectSettings();
      persist("Saved now");
    });

    els.sponsorFiles.addEventListener("change", async (event) => {
      await addSponsorsFromFiles([...event.target.files]);
      event.target.value = "";
    });

    els.sponsorSearch.addEventListener("input", renderSponsorList);
    els.tierFilter.addEventListener("change", renderSponsorList);

    els.activePlaylist.addEventListener("change", () => {
      state.activePlaylist = els.activePlaylist.value;
      bindPlaylistFields();
      persist("Playlist changed");
      renderPlaylistItems();
    });

    $("savePlaylistBtn").addEventListener("click", savePlaylistFields);
    $("addPlaylistBtn").addEventListener("click", addPlaylist);
    $("deletePlaylistBtn").addEventListener("click", deletePlaylist);
    $("shufflePlaylistBtn").addEventListener("click", shufflePlaylist);

    $("cmdShow").addEventListener("click", () => command("show"));
    $("cmdHide").addEventListener("click", () => command("hide"));
    $("cmdPrev").addEventListener("click", () => command("prev"));
    $("cmdNext").addEventListener("click", () => command("next"));
    $("cmdPause").addEventListener("click", () => command("pause"));
    $("cmdBreak").addEventListener("click", () => command("break", { duration: 10 }));
    $("cmdGoal").addEventListener("click", () => command("goal", { duration: 5 }));
    $("cmdReload").addEventListener("click", () => command("reload"));

    $("connectObsBtn").addEventListener("click", connectObs);
    $("createSourceBtn").addEventListener("click", createBrowserSource);
    $("refreshSourceBtn").addEventListener("click", refreshBrowserSource);
    $("showSourceBtn").addEventListener("click", () => setSourceVisibility(true));
    $("hideSourceBtn").addEventListener("click", () => setSourceVisibility(false));

    $("exportProjectBtn").addEventListener("click", exportProject);
    els.importProjectInput.addEventListener("change", async (event) => {
      const [file] = event.target.files;
      if (file) await importProject(file);
      event.target.value = "";
    });
    $("loadSampleBtn").addEventListener("click", loadSample);
    $("resetProjectBtn").addEventListener("click", resetProject);
  }

  async function init() {
    state = await P.seedSamplesIfEmpty();
    bindFieldsFromState();
    wireEvents();
    await renderSponsorList();
    renderPlaylists();
    refreshStatus();
    persist("Ready");
  }

  init();
})();
