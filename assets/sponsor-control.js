(() => {
  "use strict";

  const P = window.PepsSponsor;
  const Modes = window.PepsSponsorModes;
  if (!P || !Modes) throw new Error("Sponsor control dependencies are missing");

  const VALID_VIEWS = ["live", "library", "modes", "settings"];
  const RECOMMENDED_MODE_IDS = new Set([
    "lower_third", "rotator", "broadcast_ticker", "corner_badge",
    "side_tower", "sponsor_break", "goal_popup"
  ]);
  const ADDITIONAL_MODE_IDS = new Set(["cover3d", "spotlight", "float"]);
  const OBS_LIBRARY_URL = "https://cdn.jsdelivr.net/npm/obs-websocket-js@5.0.4/dist/obs-ws.min.js";
  const MAX_IMPORT_BYTES = P.MAX_PROJECT_BYTES;
  const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

  let state = P.defaultState();
  let persistenceBase = P.defaultState();
  let persistenceQueue = Promise.resolve();
  let persistencePending = 0;
  let persistenceRequestId = 0;
  let obs = null;
  let obsConnected = false;
  let saveTimer = null;
  let sponsorRenderToken = 0;
  let groupRenderToken = 0;
  let playlistRenderToken = 0;
  let playbackImageToken = 0;
  let playback = null;
  let pendingManualIndex = null;
  let lastDisplayPlaybackAt = 0;
  let confirmResolver = null;
  let effectUiTimer = null;
  let progressTimer = null;
  let previewContextKey = "";
  let unsubscribe = null;
  let previewResizeObserver = null;

  const $ = (id) => document.getElementById(id);
  const els = {
    saveStatus: $("saveStatus"),
    obsStatus: $("obsStatus"),
    obsConnectionBadge: $("obsConnectionBadge"),
    obsFeedback: $("obsFeedback"),
    obsConnectLabel: $("obsConnectLabel"),
    projectStatus: $("projectStatus"),
    sponsorCount: $("sponsorCount"),
    navSponsorCount: $("navSponsorCount"),
    libraryCount: $("libraryCount"),
    playlistStatus: $("playlistStatus"),
    displayStatus: $("displayStatus"),
    projectName: $("projectName"),
    opacity: $("opacity"),
    opacityValue: $("opacityValue"),
    autoPlay: $("autoPlay"),
    safeArea: $("safeArea"),
    showNames: $("showNames"),
    showTier: $("showTier"),
    obsHost: $("obsHost"),
    obsPort: $("obsPort"),
    obsPassword: $("obsPassword"),
    obsSourceName: $("obsSourceName"),
    obsWidth: $("obsWidth"),
    obsHeight: $("obsHeight"),
    livePlaylist: $("livePlaylist"),
    activePlaylist: $("activePlaylist"),
    playlistName: $("playlistName"),
    playlistMode: $("playlistMode"),
    playlistGroup: $("playlistGroup"),
    playlistDuration: $("playlistDuration"),
    playlistModeHelp: $("playlistModeHelp"),
    playlistCapacity: $("playlistCapacity"),
    playlistItems: $("playlistItems"),
    playlistItemCount: $("playlistItemCount"),
    playlistAddSponsor: $("playlistAddSponsor"),
    groupSelect: $("groupSelect"),
    groupName: $("groupName"),
    groupMembers: $("groupMembers"),
    groupItemCount: $("groupItemCount"),
    groupAddSponsor: $("groupAddSponsor"),
    sponsorList: $("sponsorList"),
    sponsorSearch: $("sponsorSearch"),
    tierFilter: $("tierFilter"),
    sponsorFiles: $("sponsorFiles"),
    uploadZone: $("uploadZone"),
    uploadGroup: $("uploadGroup"),
    uploadPlaylist: $("uploadPlaylist"),
    importProjectInput: $("importProjectInput"),
    outputMode: $("outputMode"),
    outputGroup: $("outputGroup"),
    modeLibrary: $("modeLibrary"),
    modeCategoryFilter: $("modeCategoryFilter"),
    modeStudioTitle: $("modeStudioTitle"),
    modeStudioDescription: $("modeStudioDescription"),
    modeControls: $("modeControls"),
    currentModeUrl: $("currentModeUrl"),
    openModeUrlBtn: $("openModeUrlBtn"),
    modeSourceFeedback: $("modeSourceFeedback"),
    modeGroupMap: $("modeGroupMap"),
    urlList: $("urlList"),
    previewFrame: $("previewFrame"),
    previewModeLabel: $("previewModeLabel"),
    previewStatus: $("previewStatus"),
    openPreviewDisplay: $("openPreviewDisplay"),
    cmdVisibility: $("cmdVisibility"),
    visibilityHint: $("visibilityHint"),
    visibilityLabel: $("visibilityLabel"),
    cmdPause: $("cmdPause"),
    pauseIcon: $("pauseIcon"),
    pauseLabel: $("pauseLabel"),
    nowSponsorThumb: $("nowSponsorThumb"),
    nowFallback: $("nowFallback"),
    nowSponsorName: $("nowSponsorName"),
    nowSponsorMeta: $("nowSponsorMeta"),
    nowProgress: $("nowProgress"),
    effectBanner: $("effectBanner"),
    effectLabel: $("effectLabel"),
    effectCountdown: $("effectCountdown"),
    migrationNotice: $("migrationNotice"),
    mergeRedesignBtn: $("mergeRedesignBtn"),
    confirmDialog: $("confirmDialog"),
    confirmTitle: $("confirmTitle"),
    confirmMessage: $("confirmMessage"),
    confirmAcceptBtn: $("confirmAcceptBtn"),
    toastRegion: $("toastRegion"),
    migrationTitle: $("migrationTitle"),
    migrationText: $("migrationText")
  };

  function setSaveStatus(label, status = "") {
    els.saveStatus.className = `status-chip ${status === "error" ? "error" : status ? "connected" : ""}`.trim();
    els.saveStatus.replaceChildren();
    const dot = document.createElement("span");
    dot.className = "status-dot";
    els.saveStatus.append(dot, document.createTextNode(label));
  }

  function showToast(title, detail = "", status = "success") {
    const toast = document.createElement("article");
    toast.className = `toast ${status}`;
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = title;
    copy.appendChild(strong);
    if (detail) {
      const small = document.createElement("small");
      small.textContent = detail;
      copy.appendChild(small);
    }
    toast.appendChild(copy);
    els.toastRegion.appendChild(toast);
    setTimeout(() => toast.remove(), 3800);
  }

  function confirmAction({ title, message, acceptLabel = "ยืนยัน" }) {
    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    els.confirmAcceptBtn.textContent = acceptLabel;
    els.confirmDialog.returnValue = "";
    els.confirmDialog.showModal();
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function stateContent(value) {
    const normalized = P.clone(P.mergeState(value));
    normalized.revision = 0;
    normalized.updatedAt = "";
    return JSON.stringify(normalized);
  }

  function persist(label = "บันทึกแล้ว", options = {}) {
    clearTimeout(saveTimer);
    saveTimer = null;
    const base = P.clone(persistenceBase);
    const desired = P.clone(state);
    persistenceBase = P.clone(desired);
    const requestId = ++persistenceRequestId;
    persistencePending++;

    const write = persistenceQueue.then(() => P.saveStateLocked(desired, {
      base,
      replace: options.replace === true,
      silent: options.silent === true,
      returnPrevious: options.returnPrevious === true
    }));
    persistenceQueue = write.catch(() => {});

    return write.then(async (result) => {
      const saved = result?.state || result;
      if (result?.previous && typeof options.onPrevious === "function") {
        options.onPrevious(P.clone(result.previous));
      }
      persistencePending = Math.max(0, persistencePending - 1);
      const rebased = stateContent(saved) !== stateContent(desired);
      if (requestId === persistenceRequestId && !saveTimer) {
        state = saved;
        persistenceBase = P.clone(saved);
        refreshStatus();
        if (rebased && options.renderOnRebase !== false) await renderAll();
      }
      setSaveStatus(label, "success");
      if (options.toast) showToast(label, options.detail || "");
      return saved;
    }).catch(async (error) => {
      persistencePending = Math.max(0, persistencePending - 1);
      const replacedElsewhere = error?.code === "STATE_EPOCH_CONFLICT";
      if (!persistencePending && !saveTimer) {
        try {
          const latest = await P.loadStateAuthoritative();
          persistenceBase = P.clone(latest);
          if (replacedElsewhere) {
            state = latest;
            bindSettingsFromState();
            void renderAll();
          }
        } catch {
          // Keep the last known base when storage itself is unavailable.
        }
      }
      console.error(error);
      setSaveStatus("บันทึกไม่สำเร็จ", "error");
      if (!options.quietError) {
        showToast(
          replacedElsewhere ? "Project ถูกแทนที่จากอีกแท็บ" : "บันทึกไม่สำเร็จ",
          replacedElsewhere
            ? "โหลดข้อมูลล่าสุดแล้ว กรุณาทำรายการนี้ใหม่"
            : error.message || String(error),
          "error"
        );
      }
      if (options.throwOnError) throw error;
      return null;
    });
  }

  function schedulePersist(options = {}) {
    clearTimeout(saveTimer);
    setSaveStatus("กำลังบันทึก…");
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persist("บันทึกแล้ว", { silent: options.silent === true });
    }, options.delay ?? 220);
  }

  function fillSelect(select, items, selected, emptyLabel = "ไม่มีข้อมูล") {
    if (!select) return;
    select.replaceChildren();
    if (!items.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = emptyLabel;
      select.appendChild(option);
      return;
    }
    for (const item of items) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    }
    if (items.some((item) => item.value === selected)) select.value = selected;
  }

  function groupOptions() {
    return state.groups.map((group) => ({ value: group.id, label: group.name }));
  }

  function playlistOptions() {
    return state.playlists.map((playlist) => ({ value: playlist.id, label: playlist.name }));
  }

  function sponsorOptions(excluded = new Set()) {
    return state.images
      .filter((sponsor) => !excluded.has(sponsor.id))
      .map((sponsor) => ({ value: sponsor.id, label: sponsor.name }));
  }

  function modeOptions() {
    return Modes.definitions.map((mode) => ({ value: mode.id, label: mode.label }));
  }

  function activeGroup() {
    return P.getGroup(state);
  }

  function activePlaylist() {
    return P.getActivePlaylist(state);
  }

  function refreshStatus() {
    const playlist = activePlaylist();
    els.projectStatus.textContent = state.projectName;
    els.sponsorCount.textContent = String(state.images.length);
    els.navSponsorCount.textContent = String(state.images.length);
    els.libraryCount.textContent = String(state.images.length);
    els.playlistStatus.textContent = playlist?.name || "-";
    const alternateData = state.migration.alternateRedesignDetected === true;
    const missingImages = Math.max(0, Number(state.migration.missingImages) || 0);
    els.migrationNotice.hidden = !alternateData && !missingImages;
    els.mergeRedesignBtn.hidden = !alternateData;
    if (missingImages) {
      els.migrationTitle.textContent = `ย้ายข้อมูลแล้ว แต่ไม่พบไฟล์รูป ${missingImages} รายการ`;
      els.migrationText.textContent = alternateData
        ? "ข้อมูล GitHub v3 ถูกใช้เป็นหลักและยังพบ redesign อีกชุด กรุณา Export สำรองก่อนแก้ไขต่อ"
        : "ข้อมูล Sponsor ถูกเก็บไว้ แต่รายการที่ไม่มีไฟล์รูปจะไม่แสดงบน Output กรุณาอัปโหลดรูปใหม่";
    } else {
      els.migrationTitle.textContent = "พบข้อมูลจากระบบ redesign เดิมอีกชุด";
      els.migrationText.textContent = "ระบบใช้ข้อมูล GitHub v3 เป็นหลักและไม่ได้ merge อัตโนมัติเพื่อป้องกันข้อมูลชนกัน";
    }
    updateLiveControls();
  }

  function updateLiveControls() {
    const visible = state.isVisible !== false;
    const paused = state.isPaused === true;
    els.cmdVisibility.classList.toggle("is-on", visible);
    els.cmdVisibility.setAttribute("aria-pressed", String(visible));
    els.visibilityLabel.textContent = visible ? "กำลังแสดง" : "ซ่อนอยู่";
    els.visibilityHint.textContent = visible ? "แสดงอยู่บนหน้าจอ" : "ซ่อนจากหน้าจอ";
    els.displayStatus.textContent = visible ? (paused ? "พักอยู่" : "กำลังแสดง") : "ซ่อนอยู่";
    els.displayStatus.style.color = visible ? "var(--success)" : "var(--danger)";
    els.cmdPause.setAttribute("aria-pressed", String(paused));
    els.pauseIcon.textContent = paused ? "▶" : "Ⅱ";
    els.pauseLabel.textContent = paused ? "เล่นต่อ" : "พัก";
  }

  function activateLibrarySection(section = "logos", options = {}) {
    const validSections = ["logos", "playlists", "groups"];
    if (!validSections.includes(section)) section = "logos";
    document.body.dataset.librarySection = section;
    const sponsorPanel = $("view-sponsors");
    const collectionPanel = $("view-collections");
    sponsorPanel.hidden = section !== "logos";
    collectionPanel.hidden = section === "logos";
    sponsorPanel.classList.toggle("is-active", section === "logos");
    collectionPanel.classList.toggle("is-active", section !== "logos");
    for (const panel of document.querySelectorAll("[data-library-panel]")) {
      panel.hidden = panel.dataset.libraryPanel !== section;
    }
    for (const button of document.querySelectorAll("[data-library-section]")) {
      const active = button.dataset.librarySection === section;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      if (active && options.focus) button.focus();
    }
  }

  function activateView(view, options = {}) {
    if (["sponsors", "collections"].includes(view)) view = "library";
    if (!VALID_VIEWS.includes(view)) view = "live";
    document.body.dataset.activeView = view;
    for (const button of document.querySelectorAll("[data-view]")) {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      if (active) button.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    for (const panel of document.querySelectorAll("[data-view-panel]")) {
      const active = view === "library"
        ? ["sponsors", "collections"].includes(panel.dataset.viewPanel)
        : panel.dataset.viewPanel === view;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    }
    $("librarySwitcher").hidden = view !== "library";
    if (view === "library") activateLibrarySection(document.body.dataset.librarySection || "logos");
    if (options.writeHash !== false) history.replaceState(null, "", `#${view}`);
    if (options.focus) document.querySelector(`[data-view="${view}"]`)?.focus();
    updatePreviewContext(true);
  }

  function previewUrl() {
    const view = document.body.dataset.activeView;
    const url = new URL("./sponsor-display.html", location.href);
    url.searchParams.set("preview", "1");
    if (view === "modes") {
      url.searchParams.set("mode", state.mode);
      const groupId = state.modeGroups[state.mode] || state.activeGroupId;
      if (groupId) url.searchParams.set("group", groupId);
    } else {
      url.searchParams.set("mode", "live");
    }
    return url;
  }

  function updatePreviewContext(force = false) {
    const url = previewUrl();
    const key = `${url.searchParams.get("mode")}|${url.searchParams.get("group") || ""}`;
    const mode = url.searchParams.get("mode");
    els.previewModeLabel.textContent = mode === "live" || mode === "playlist"
      ? `${activePlaylist()?.name || "Live Output"} · ${Modes.labels[activePlaylist()?.mode] || ""}`
      : `${Modes.labels[mode] || mode} · ${P.getGroup(state, url.searchParams.get("group"))?.name || ""}`;
    const displayUrl = new URL(url);
    displayUrl.searchParams.delete("preview");
    els.openPreviewDisplay.href = displayUrl.href;
    if (!force && previewContextKey === key) return;
    previewContextKey = key;
    els.previewStatus.textContent = "กำลังโหลด";
    els.previewFrame.src = url.href;
  }

  function updatePreviewScale() {
    const frame = els.previewFrame.parentElement;
    if (!frame) return;
    els.previewFrame.style.zoom = String(frame.clientWidth / 1920);
  }

  function reloadPreview() {
    previewContextKey = "";
    const url = previewUrl();
    url.searchParams.set("_", String(Date.now()));
    els.previewFrame.src = url.href;
    els.previewStatus.textContent = "กำลัง reload";
  }

  function collectSettings() {
    state.projectName = els.projectName.value.trim() || "PepsLive Sponsor Dock";
    state.settings.opacity = Number(els.opacity.value);
    state.settings.autoPlay = els.autoPlay.checked;
    state.settings.safeArea = els.safeArea.checked;
    state.settings.showNames = els.showNames.checked;
    state.settings.showTier = els.showTier.checked;
    state.obs.host = els.obsHost.value.trim() || "127.0.0.1";
    state.obs.port = Number(els.obsPort.value || 4455);
    state.obs.sourceName = els.obsSourceName.value.trim() || "PEPS_SPONSOR_DISPLAY";
    state.obs.width = Number(els.obsWidth.value || 1920);
    state.obs.height = Number(els.obsHeight.value || 1080);
    els.opacityValue.textContent = `${state.settings.opacity}%`;
  }

  function bindSettingsFromState() {
    els.projectName.value = state.projectName;
    els.opacity.value = String(state.settings.opacity);
    els.opacityValue.textContent = `${state.settings.opacity}%`;
    els.autoPlay.checked = state.settings.autoPlay;
    els.safeArea.checked = state.settings.safeArea;
    els.showNames.checked = state.settings.showNames;
    els.showTier.checked = state.settings.showTier;
    els.obsHost.value = state.obs.host;
    els.obsPort.value = String(state.obs.port);
    els.obsSourceName.value = state.obs.sourceName;
    els.obsWidth.value = String(state.obs.width);
    els.obsHeight.value = String(state.obs.height);
  }

  async function addSponsorsFromFiles(files) {
    const validFiles = files.filter((file) => P.imageTypes.includes(file.type) && file.size <= P.MAX_IMAGE_BYTES);
    const rejected = files.length - validFiles.length;
    if (!validFiles.length) {
      showToast("ไม่มีไฟล์ที่รองรับ", "ใช้ PNG, JPG, WebP หรือ SVG ขนาดไม่เกิน 12 MB", "error");
      return;
    }

    const staged = [];
    const groupId = els.uploadGroup.value;
    const playlistId = els.uploadPlaylist.value;
    try {
      for (const file of validFiles) {
        const id = P.uid("img");
        await P.dbPutImage(id, file, { name: file.name, type: file.type });
        staged.push(id);
        state.images.push({
          id,
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Sponsor",
          tier: "partner",
          duration: 6,
          enabled: true,
          createdAt: P.nowIso()
        });
        const group = P.getGroup(state, groupId);
        if (group && !group.imageIds.includes(id)) group.imageIds.push(id);
        const playlist = state.playlists.find((item) => item.id === playlistId);
        if (playlist && !playlist.sponsorIds.includes(id)) playlist.sponsorIds.push(id);
      }
      const saved = await persist(`เพิ่ม Sponsor ${validFiles.length} รายแล้ว`, {
        toast: true,
        detail: rejected ? `ข้าม ${rejected} ไฟล์ที่ไม่รองรับ` : "",
        throwOnError: true
      });
      if (!saved) throw new Error("บันทึกข้อมูล Sponsor ลง browser ไม่สำเร็จ");
      await renderAll();
    } catch (error) {
      state = await P.loadStateAuthoritative();
      persistenceBase = P.clone(state);
      await Promise.allSettled(staged.map((id) => P.dbDeleteImage(id)));
      await renderAll();
      showToast("เพิ่ม Sponsor ไม่สำเร็จ", error.message || String(error), "error");
    }
  }

  async function replaceSponsorImage(sponsor, file) {
    if (!sponsor || !file || !P.imageTypes.includes(file.type) || file.size > P.MAX_IMAGE_BYTES) {
      showToast("ไฟล์ไม่รองรับ", "ใช้ PNG, JPG, WebP หรือ SVG ขนาดไม่เกิน 12 MB", "error");
      return;
    }
    try {
      await P.dbPutImage(sponsor.id, file, { name: file.name, type: file.type });
      state.migration.missingImages = Math.max(
        0,
        Number(state.migration.missingImages || 0) - 1
      );
      const saved = await persist("แทนที่ไฟล์รูปแล้ว");
      if (!saved) throw new Error("บันทึกสถานะรูปที่แทนที่ไม่สำเร็จ");
      await renderSponsorList();
      renderGroupMembers();
      renderPlaylistItems();
      updatePreviewContext(true);
      showToast("แทนที่ไฟล์รูปแล้ว", sponsor.name);
    } catch (error) {
      state = await P.loadStateAuthoritative();
      persistenceBase = P.clone(state);
      await renderAll();
      showToast("แทนที่ไฟล์รูปไม่สำเร็จ", error.message || String(error), "error");
    }
  }

  async function renderSponsorList() {
    const token = ++sponsorRenderToken;
    const search = els.sponsorSearch.value.trim().toLowerCase();
    const tier = els.tierFilter.value;
    const items = state.images.filter((sponsor) => {
      const matchesSearch = !search || sponsor.name.toLowerCase().includes(search);
      const matchesTier = tier === "all" || sponsor.tier === tier;
      return matchesSearch && matchesTier;
    });

    els.sponsorList.replaceChildren();
    if (!items.length) {
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = state.images.length ? "ไม่พบ Sponsor ตามเงื่อนไขนี้" : "ยังไม่มี Sponsor — อัปโหลดโลโก้ด้านบนเพื่อเริ่มต้น";
      els.sponsorList.appendChild(note);
      return;
    }

    for (const sponsor of items) {
      const fragment = $("sponsorCardTemplate").content.cloneNode(true);
      const card = fragment.querySelector(".sponsor-card");
      const image = fragment.querySelector(".sponsor-logo");
      const imageWrap = fragment.querySelector(".sponsor-logo-wrap");
      const name = fragment.querySelector(".sponsor-name");
      const tierSelect = fragment.querySelector(".sponsor-tier");
      const duration = fragment.querySelector(".sponsor-duration");
      const enabled = fragment.querySelector(".sponsor-enabled");
      const memberships = fragment.querySelector(".sponsor-memberships");
      const sponsorActions = fragment.querySelector(".sponsor-actions");
      card.dataset.id = sponsor.id;
      image.alt = sponsor.name;
      const src = await P.dbGetImageUrl(sponsor.id);
      if (token !== sponsorRenderToken) return;
      if (src) {
        image.src = src;
      } else {
        image.removeAttribute("src");
        image.alt = `ไม่พบไฟล์รูปของ ${sponsor.name}`;
        imageWrap.classList.add("is-missing");
        const badge = document.createElement("span");
        badge.className = "missing-image-badge";
        badge.textContent = "ไฟล์รูปหาย";
        imageWrap.appendChild(badge);

        const replaceButton = document.createElement("button");
        replaceButton.type = "button";
        replaceButton.className = "btn tiny secondary replace-image";
        replaceButton.textContent = "แทนที่รูป";
        const replaceInput = document.createElement("input");
        replaceInput.type = "file";
        replaceInput.accept = "image/png,image/jpeg,image/webp,image/svg+xml";
        replaceInput.hidden = true;
        replaceButton.addEventListener("click", () => replaceInput.click());
        replaceInput.addEventListener("change", async () => {
          const [file] = replaceInput.files;
          if (file) await replaceSponsorImage(sponsor, file);
        });
        sponsorActions.insertBefore(
          replaceButton,
          sponsorActions.querySelector(".remove-sponsor")
        );
        sponsorActions.appendChild(replaceInput);
      }
      name.value = sponsor.name;
      tierSelect.value = sponsor.tier;
      duration.value = String(sponsor.duration);
      enabled.checked = sponsor.enabled !== false;
      card.classList.toggle("is-disabled", !enabled.checked);

      const groupNames = state.groups.filter((group) => group.imageIds.includes(sponsor.id)).map((group) => group.name);
      const playlistNames = state.playlists.filter((playlist) => playlist.sponsorIds.includes(sponsor.id)).map((playlist) => playlist.name);
      for (const label of [...groupNames.map((value) => `G · ${value}`), ...playlistNames.map((value) => `P · ${value}`)]) {
        const chip = document.createElement("span");
        chip.textContent = label;
        memberships.appendChild(chip);
      }

      const update = (patch) => {
        Object.assign(sponsor, patch);
        persist("อัปเดต Sponsor แล้ว");
        card.classList.toggle("is-disabled", sponsor.enabled === false);
        renderGroupMembers();
        renderPlaylistItems();
      };
      name.addEventListener("change", () => update({ name: name.value.trim() || "Sponsor" }));
      tierSelect.addEventListener("change", () => update({ tier: tierSelect.value }));
      duration.addEventListener("change", () => update({ duration: Math.max(2, Math.min(60, Number(duration.value) || 6)) }));
      enabled.addEventListener("change", () => update({ enabled: enabled.checked }));
      fragment.querySelector(".add-to-group").addEventListener("click", () => addSponsorToGroup(sponsor.id, state.activeGroupId));
      fragment.querySelector(".add-to-playlist").addEventListener("click", () => addSponsorToPlaylist(sponsor.id, state.activePlaylist));
      fragment.querySelector(".remove-sponsor").addEventListener("click", () => deleteSponsor(sponsor.id));
      els.sponsorList.appendChild(fragment);
    }
  }

  async function deleteSponsor(id) {
    const sponsor = state.images.find((item) => item.id === id);
    if (!sponsor) return;
    const confirmed = await confirmAction({
      title: "ลบ Sponsor ถาวร?",
      message: `“${sponsor.name}” จะถูกนำออกจากทุก Group, Playlist และลบไฟล์รูปจาก browser นี้`,
      acceptLabel: "ลบถาวร"
    });
    if (!confirmed) return;
    let missingImage = false;
    try {
      missingImage = !(await P.dbGetImageRecord(id))?.blob;
    } catch {
      // Keep deletion available even if the image database cannot be inspected.
    }
    state.images = state.images.filter((item) => item.id !== id);
    state.groups.forEach((group) => group.imageIds = group.imageIds.filter((imageId) => imageId !== id));
    state.playlists.forEach((playlist) => playlist.sponsorIds = playlist.sponsorIds.filter((imageId) => imageId !== id));
    if (missingImage) {
      state.migration.missingImages = Math.max(
        0,
        Number(state.migration.missingImages || 0) - 1
      );
    }
    try {
      await persist("ลบ Sponsor แล้ว", { throwOnError: true });
    } catch (error) {
      state = await P.loadStateAuthoritative();
      persistenceBase = P.clone(state);
      await renderAll();
      return;
    }
    try {
      await P.dbDeleteImage(id);
      showToast("ลบ Sponsor แล้ว");
    } catch (error) {
      showToast(
        "นำ Sponsor ออกจากโปรเจกต์แล้ว",
        `ล้างไฟล์ค้างไม่สำเร็จ: ${error.message || error}`,
        "warning"
      );
    }
    await renderAll();
  }

  function ensureGroup(id, name) {
    let group = state.groups.find((item) => item.id === id);
    if (!group) {
      group = { id, name, imageIds: [] };
      state.groups.push(group);
    }
    return group;
  }

  function createFootballPreset() {
    const main = ensureGroup("main", "Main Sponsor");
    const partner = ensureGroup("partner", "Partner Sponsor");
    const goal = ensureGroup("goal", "Goal Sponsor");
    const halftime = ensureGroup("halftime", "Half-time Sponsor");
    Object.assign(state.modeGroups, {
      cover3d: main.id,
      spotlight: goal.id,
      goal_popup: goal.id,
      ticker: partner.id,
      broadcast_ticker: partner.id,
      float: partner.id,
      wave: partner.id,
      orbit: halftime.id,
      grid: halftime.id,
      grid_board: halftime.id,
      sponsor_break: halftime.id
    });
    state.activeGroupId = main.id;
    persist("สร้าง Groups มาตรฐานงานกีฬาแล้ว", { toast: true });
    renderAll();
  }

  function addGroup() {
    const id = P.uid("group");
    state.groups.push({ id, name: `Group ${state.groups.length + 1}`, imageIds: [] });
    state.activeGroupId = id;
    persist("เพิ่ม Group แล้ว");
    renderAll();
    els.groupName.focus();
    els.groupName.select();
  }

  async function deleteGroup() {
    if (state.groups.length <= 1) {
      showToast("ลบไม่ได้", "ระบบต้องมี Group อย่างน้อย 1 รายการ", "error");
      return;
    }
    const group = activeGroup();
    const confirmed = await confirmAction({
      title: "ลบ Group นี้?",
      message: `“${group.name}” จะถูกลบ แต่ Sponsor และไฟล์รูปจริงจะยังอยู่ใน Library`,
      acceptLabel: "ลบ Group"
    });
    if (!confirmed) return;
    state.groups = state.groups.filter((item) => item.id !== group.id);
    state.activeGroupId = state.groups[0].id;
    for (const mode of Modes.ids) {
      if (state.modeGroups[mode] === group.id) state.modeGroups[mode] = state.activeGroupId;
    }
    state.playlists.forEach((playlist) => {
      if (playlist.groupId === group.id) playlist.groupId = state.activeGroupId;
    });
    persist("ลบ Group แล้ว", { toast: true });
    renderAll();
  }

  function saveGroup() {
    const group = activeGroup();
    if (!group) return;
    group.name = els.groupName.value.trim() || "Group";
    persist("บันทึก Group แล้ว", { toast: true });
    renderGroupSelectors();
    renderModeGroupMap();
    renderUrlList();
  }

  function addSponsorToGroup(sponsorId, groupId) {
    const group = P.getGroup(state, groupId);
    const sponsor = state.images.find((item) => item.id === sponsorId);
    if (!group || !sponsor) return;
    if (group.imageIds.includes(sponsorId)) {
      showToast("มีอยู่แล้ว", `${sponsor.name} อยู่ใน ${group.name} แล้ว`, "warning");
      return;
    }
    group.imageIds.push(sponsorId);
    persist("เพิ่มเข้า Group แล้ว", { toast: true, detail: group.name });
    renderGroupMembers();
    renderSponsorList();
  }

  function removeSponsorFromGroup(sponsorId) {
    const group = activeGroup();
    if (!group) return;
    group.imageIds = group.imageIds.filter((id) => id !== sponsorId);
    persist("นำออกจาก Group แล้ว");
    renderGroupMembers();
    renderSponsorList();
  }

  function moveInArray(array, index, delta) {
    const next = index + delta;
    if (next < 0 || next >= array.length) return false;
    [array[index], array[next]] = [array[next], array[index]];
    return true;
  }

  async function renderCollectionRows(container, ids, type) {
    const isGroup = type === "group";
    const token = isGroup ? ++groupRenderToken : ++playlistRenderToken;
    const isCurrent = () => token === (isGroup ? groupRenderToken : playlistRenderToken);
    container.replaceChildren();
    const byId = new Map(state.images.map((sponsor) => [sponsor.id, sponsor]));
    if (!ids.length) {
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = type === "group"
        ? "Group นี้ยังว่าง — เพิ่ม Sponsor จากช่องด้านบนหรือ Library"
        : `Playlist นี้ยังไม่มีลำดับเฉพาะ และจะใช้ Sponsor จาก Group “${P.getGroup(state, activePlaylist()?.groupId)?.name || "-"}”`;
      container.appendChild(note);
      return;
    }

    for (let index = 0; index < ids.length; index++) {
      const sponsor = byId.get(ids[index]);
      if (!sponsor) continue;
      const row = document.createElement("article");
      row.className = "playlist-row";
      row.dataset.id = sponsor.id;
      const number = document.createElement("span");
      number.className = "playlist-index";
      number.textContent = String(index + 1).padStart(2, "0");
      const image = document.createElement("img");
      image.className = "playlist-thumb";
      image.alt = "";
      const src = await P.dbGetImageUrl(sponsor.id);
      if (!isCurrent()) return;
      image.src = src;
      const copy = document.createElement("div");
      copy.className = "playlist-copy";
      const strong = document.createElement("strong");
      strong.textContent = sponsor.name;
      const small = document.createElement("small");
      small.textContent = `${P.tierLabels[sponsor.tier]} · ${sponsor.duration} วิ`;
      copy.append(strong, small);
      const actions = document.createElement("div");
      actions.className = "row-actions";
      const up = document.createElement("button");
      up.type = "button";
      up.textContent = "↑";
      up.disabled = index === 0;
      up.setAttribute("aria-label", `เลื่อน ${sponsor.name} ขึ้น`);
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "↓";
      down.disabled = index === ids.length - 1;
      down.setAttribute("aria-label", `เลื่อน ${sponsor.name} ลง`);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-from-playlist";
      remove.textContent = "เอาออก";
      remove.setAttribute("aria-label", `นำ ${sponsor.name} ออก`);
      up.addEventListener("click", () => moveCollectionItem(type, index, -1, sponsor.id, "up"));
      down.addEventListener("click", () => moveCollectionItem(type, index, 1, sponsor.id, "down"));
      remove.addEventListener("click", () => type === "group"
        ? removeSponsorFromGroup(sponsor.id)
        : removeSponsorFromPlaylist(sponsor.id));
      actions.append(up, down, remove);
      row.append(number, image, copy, actions);
      container.appendChild(row);
    }
  }

  async function moveCollectionItem(type, index, delta, sponsorId, action) {
    const list = type === "group" ? activeGroup()?.imageIds : activePlaylist()?.sponsorIds;
    if (!list || !moveInArray(list, index, delta)) return;
    persist("อัปเดตลำดับแล้ว");
    if (type === "group") await renderGroupMembers();
    else await renderPlaylistItems();
    const container = type === "group" ? els.groupMembers : els.playlistItems;
    const row = [...container.querySelectorAll(".playlist-row")]
      .find((item) => item.dataset.id === sponsorId);
    const target = action === "up"
      ? row?.querySelector(".row-actions button:first-child")
      : row?.querySelector(".row-actions button:nth-child(2)");
    target?.focus();
  }

  function renderGroupSelectors() {
    const options = groupOptions();
    fillSelect(els.groupSelect, options, state.activeGroupId);
    fillSelect(els.uploadGroup, options, els.uploadGroup.value || state.activeGroupId);
    fillSelect(els.playlistGroup, options, activePlaylist()?.groupId || state.activeGroupId);
    fillSelect(els.outputGroup, options, state.modeGroups[state.mode] || state.activeGroupId);
  }

  function renderGroupEditor() {
    const group = activeGroup();
    renderGroupSelectors();
    els.groupName.value = group?.name || "";
    renderGroupMembers();
  }

  function renderGroupMembers() {
    const group = activeGroup();
    const ids = group?.imageIds || [];
    els.groupItemCount.textContent = String(ids.length);
    fillSelect(els.groupAddSponsor, sponsorOptions(new Set(ids)), "", "ไม่มี Sponsor ให้เพิ่ม");
    return renderCollectionRows(els.groupMembers, ids, "group");
  }

  function renderPlaylistSelectors() {
    const options = playlistOptions();
    fillSelect(els.livePlaylist, options, state.activePlaylist);
    fillSelect(els.activePlaylist, options, state.activePlaylist);
    fillSelect(els.uploadPlaylist, options, els.uploadPlaylist.value || state.activePlaylist);
  }

  function renderPlaylistEditor() {
    renderPlaylistSelectors();
    const playlist = activePlaylist();
    if (!playlist) return;
    els.playlistName.value = playlist.name;
    fillSelect(els.playlistMode, modeOptions(), playlist.mode);
    fillSelect(els.playlistGroup, groupOptions(), playlist.groupId);
    els.playlistDuration.value = String(playlist.defaultDuration);
    updatePlaylistModeHelp(playlist.mode);
    renderPlaylistItems();
  }

  function updatePlaylistModeHelp(mode) {
    const definition = Modes.get(mode);
    els.playlistModeHelp.textContent = definition?.description || "โหมดแสดงผล Sponsor";
    els.playlistCapacity.textContent = definition?.category === "broadcast"
      ? "ออกแบบสำหรับงาน Broadcast และ Live Control"
      : "คงรูปแบบและ URL compatibility จาก GitHub v3";
  }

  function renderPlaylistItems() {
    const playlist = activePlaylist();
    const ids = playlist?.sponsorIds || [];
    els.playlistItemCount.textContent = String(ids.length || P.getPlaylistSponsors(state, playlist).length);
    fillSelect(els.playlistAddSponsor, sponsorOptions(new Set(ids)), "", "ไม่มี Sponsor ให้เพิ่ม");
    return renderCollectionRows(els.playlistItems, ids, "playlist");
  }

  function selectPlaylist(id) {
    if (!state.playlists.some((playlist) => playlist.id === id)) return;
    state.activePlaylist = id;
    state.currentIndex = 0;
    playback = null;
    persist("เปลี่ยน Playlist แล้ว", { silent: true });
    renderPlaylistEditor();
    refreshStatus();
    command("playlist", { playlistId: id });
    refreshFallbackNowPlaying();
    updatePreviewContext(true);
  }

  function addPlaylist() {
    const group = activeGroup();
    const id = P.uid("pl");
    state.playlists.push({
      id,
      name: `Playlist ${state.playlists.length + 1}`,
      mode: state.mode,
      groupId: group?.id || state.activeGroupId,
      defaultDuration: 6,
      sponsorIds: []
    });
    state.activePlaylist = id;
    state.currentIndex = 0;
    playback = null;
    persist("เพิ่ม Playlist แล้ว");
    renderPlaylistEditor();
    els.playlistName.focus();
    els.playlistName.select();
  }

  function savePlaylist() {
    const playlist = activePlaylist();
    if (!playlist) return;
    playlist.name = els.playlistName.value.trim() || "Playlist";
    playlist.mode = Modes.has(els.playlistMode.value) ? els.playlistMode.value : "lower_third";
    playlist.groupId = state.groups.some((group) => group.id === els.playlistGroup.value)
      ? els.playlistGroup.value
      : state.activeGroupId;
    playlist.defaultDuration = Math.max(2, Math.min(60, Number(els.playlistDuration.value) || 6));
    persist("บันทึก Playlist แล้ว", { toast: true });
    renderPlaylistEditor();
    renderModes();
    refreshStatus();
    updatePreviewContext(true);
  }

  async function deletePlaylist() {
    if (state.playlists.length <= 1) {
      showToast("ลบไม่ได้", "ระบบต้องมี Playlist อย่างน้อย 1 รายการ", "error");
      return;
    }
    const playlist = activePlaylist();
    const confirmed = await confirmAction({
      title: "ลบ Playlist นี้?",
      message: `“${playlist.name}” จะถูกลบ แต่ Sponsor และ Groups จะยังอยู่`,
      acceptLabel: "ลบ Playlist"
    });
    if (!confirmed) return;
    state.playlists = state.playlists.filter((item) => item.id !== playlist.id);
    state.activePlaylist = state.playlists[0].id;
    state.currentIndex = 0;
    persist("ลบ Playlist แล้ว", { toast: true });
    renderPlaylistEditor();
    command("playlist", { playlistId: state.activePlaylist });
  }

  function addSponsorToPlaylist(sponsorId, playlistId) {
    const playlist = state.playlists.find((item) => item.id === playlistId);
    const sponsor = state.images.find((item) => item.id === sponsorId);
    if (!playlist || !sponsor) return;
    if (playlist.sponsorIds.includes(sponsorId)) {
      showToast("มีอยู่แล้ว", `${sponsor.name} อยู่ใน ${playlist.name} แล้ว`, "warning");
      return;
    }
    playlist.sponsorIds.push(sponsorId);
    persist("เพิ่มเข้า Playlist แล้ว", { toast: true, detail: playlist.name });
    renderPlaylistItems();
    renderSponsorList();
  }

  function removeSponsorFromPlaylist(sponsorId) {
    const playlist = activePlaylist();
    if (!playlist) return;
    playlist.sponsorIds = playlist.sponsorIds.filter((id) => id !== sponsorId);
    persist("นำออกจาก Playlist แล้ว");
    renderPlaylistItems();
    renderSponsorList();
  }

  function shufflePlaylist() {
    const playlist = activePlaylist();
    if (!playlist || playlist.sponsorIds.length < 2) {
      showToast("ยังสุ่มไม่ได้", "Playlist ต้องมี Sponsor อย่างน้อย 2 ราย", "warning");
      return;
    }
    for (let index = playlist.sponsorIds.length - 1; index > 0; index--) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [playlist.sponsorIds[index], playlist.sponsorIds[randomIndex]] = [
        playlist.sponsorIds[randomIndex],
        playlist.sponsorIds[index]
      ];
    }
    state.currentIndex = 0;
    persist("สุ่มลำดับแล้ว", { toast: true });
    renderPlaylistItems();
    command("playlist", { playlistId: playlist.id, reason: "shuffle" });
  }

  function controlShape(control) {
    if (!Array.isArray(control)) return control;
    const [key, label, type, a, b, step, suffix] = control;
    return {
      key,
      label,
      type,
      min: type === "range" ? a : undefined,
      max: type === "range" ? b : undefined,
      step: type === "range" ? step : undefined,
      suffix,
      options: type === "select" ? a : undefined
    };
  }

  function renderModeLibrary() {
    const category = els.modeCategoryFilter.value;
    els.modeLibrary.replaceChildren();
    const visibleModes = Modes.definitions.filter((mode) => {
      if (category === "recommended") return RECOMMENDED_MODE_IDS.has(mode.id);
      if (category === "additional") return ADDITIONAL_MODE_IDS.has(mode.id);
      if (category === "legacy") return !RECOMMENDED_MODE_IDS.has(mode.id) && !ADDITIONAL_MODE_IDS.has(mode.id);
      return category === "all" || mode.category === category;
    });
    for (const definition of visibleModes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mode-card";
      button.classList.toggle("is-active", definition.id === state.mode);
      button.dataset.mode = definition.id;
      const top = document.createElement("span");
      top.className = "mode-card-top";
      const categoryLabel = document.createElement("small");
      categoryLabel.textContent = definition.category.toUpperCase();
      const id = document.createElement("code");
      id.textContent = definition.id;
      top.append(categoryLabel, id);
      const strong = document.createElement("strong");
      strong.textContent = definition.label;
      const description = document.createElement("span");
      description.textContent = definition.description;
      button.append(top, strong, description);
      button.addEventListener("click", () => selectMode(definition.id));
      els.modeLibrary.appendChild(button);
    }
  }

  function renderModeStudio() {
    const definition = Modes.get(state.mode);
    if (!definition) return;
    fillSelect(els.outputMode, modeOptions(), state.mode);
    fillSelect(els.outputGroup, groupOptions(), state.modeGroups[state.mode] || state.activeGroupId);
    els.modeStudioTitle.textContent = definition.label;
    els.modeStudioDescription.textContent = definition.description;
    const url = pageUrl(state.mode, state.modeGroups[state.mode] || state.activeGroupId);
    els.currentModeUrl.value = url;
    els.openModeUrlBtn.href = url;
    els.modeControls.replaceChildren();

    const values = state.modeSettings[state.mode] || Modes.defaultsFor(state.mode);
    for (const rawControl of Modes.controlsFor(state.mode)) {
      const control = controlShape(rawControl);
      const label = document.createElement("label");
      label.className = "mode-control";
      const title = document.createElement("span");
      title.textContent = control.label;
      let readout = null;

      if (control.type === "range") {
        readout = document.createElement("b");
        readout.textContent = formatControlValue(control, values[control.key]);
        title.appendChild(readout);
      }
      label.appendChild(title);

      let input;
      if (control.type === "select") {
        input = document.createElement("select");
        for (const optionValue of control.options || []) {
          const option = document.createElement("option");
          option.value = Array.isArray(optionValue) ? optionValue[0] : optionValue.value;
          option.textContent = Array.isArray(optionValue) ? optionValue[1] : optionValue.label;
          input.appendChild(option);
        }
      } else if (control.type === "toggle") {
        input = document.createElement("input");
        input.type = "checkbox";
      } else if (control.type === "text") {
        input = document.createElement("input");
        input.type = "text";
        input.maxLength = 120;
      } else {
        input = document.createElement("input");
        input.type = "range";
        input.min = String(control.min);
        input.max = String(control.max);
        input.step = String(control.step);
      }
      input.id = `modeControl_${control.key}`;
      if (input.type === "checkbox") input.checked = values[control.key] !== false;
      else input.value = String(values[control.key]);
      const apply = () => {
        const value = input.type === "range"
          ? Number(input.value)
          : input.type === "checkbox"
            ? input.checked
            : input.value;
        state.modeSettings[state.mode][control.key] = value;
        if (readout) readout.textContent = formatControlValue(control, value);
        schedulePersist();
      };
      input.addEventListener("input", apply);
      input.addEventListener("change", apply);
      label.appendChild(input);
      els.modeControls.appendChild(label);
    }
  }

  function formatControlValue(control, value) {
    if (control.key === "coverOpacity" || control.key === "spotlightDim" || control.key === "shadow") {
      return `${Math.round(Number(value) * 100)}%`;
    }
    return `${value}${control.unit || control.suffix || ""}`;
  }

  function renderModeGroupMap() {
    els.modeGroupMap.replaceChildren();
    for (const definition of Modes.definitions) {
      const row = document.createElement("div");
      row.className = "map-row";
      const copy = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = definition.label;
      const code = document.createElement("code");
      code.textContent = definition.id;
      copy.append(strong, code);
      const select = document.createElement("select");
      fillSelect(select, groupOptions(), state.modeGroups[definition.id] || state.activeGroupId);
      select.addEventListener("change", () => {
        state.modeGroups[definition.id] = select.value;
        if (definition.id === state.mode) state.activeGroupId = select.value;
        persist("บันทึก Group ของโหมดแล้ว");
        renderUrlList();
        updatePreviewContext(true);
      });
      row.append(copy, select);
      els.modeGroupMap.appendChild(row);
    }
  }

  function pageUrl(mode, groupId = "") {
    const url = new URL("./sponsor.html", location.href);
    url.searchParams.set("mode", mode);
    if (groupId) url.searchParams.set("group", groupId);
    return url.href;
  }

  function renderUrlList() {
    els.urlList.replaceChildren();
    const rows = [
      { id: "live", label: "Live Playlist — ตามหน้า Live", groupId: "" },
      { id: "display", label: "Classic Display — URL เดิม", groupId: "" },
      { id: "auto", label: "Classic Auto — URL เดิม", groupId: state.activeGroupId },
      ...Modes.definitions.map((mode) => ({
      id: mode.id,
      label: mode.label,
      groupId: state.modeGroups[mode.id] || state.activeGroupId
      }))
    ];
    for (const rowData of rows) {
      const row = document.createElement("article");
      row.className = "url-item";
      const copy = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = rowData.label;
      const small = document.createElement("small");
      small.textContent = rowData.id === "live"
        ? "ใช้กับ Live Control และ Playlist ที่เลือก"
        : rowData.id === "auto"
          ? `คง URL เดิมและล็อก Group: ${P.getGroup(state, rowData.groupId)?.name || "-"}`
          : rowData.id === "display"
            ? "คงพฤติกรรม GitHub เดิม: ตามโหมดและ Group ที่เลือกใน Mode Studio"
          : `Group: ${P.getGroup(state, rowData.groupId)?.name || "-"}`;
      copy.append(strong, small);
      const input = document.createElement("input");
      input.type = "text";
      input.readOnly = true;
      input.value = pageUrl(rowData.id, rowData.groupId);
      const actions = document.createElement("div");
      actions.className = "url-actions";
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "btn tiny secondary";
      copyButton.textContent = "คัดลอก";
      copyButton.addEventListener("click", () => copyText(input.value, "คัดลอก URL แล้ว"));
      const openButton = document.createElement("a");
      openButton.className = "btn tiny secondary";
      openButton.href = input.value;
      openButton.target = "_blank";
      openButton.rel = "noopener";
      openButton.textContent = "เปิด";
      const obsButton = document.createElement("button");
      obsButton.type = "button";
      obsButton.className = "btn tiny primary";
      obsButton.textContent = "เพิ่ม OBS";
      obsButton.addEventListener("click", () => createFixedSource(rowData.id, rowData.groupId, input.value));
      actions.append(copyButton, openButton, obsButton);
      row.append(copy, input, actions);
      els.urlList.appendChild(row);
    }
  }

  function selectMode(mode) {
    if (!Modes.has(mode)) return;
    state.mode = mode;
    state.activeGroupId = state.modeGroups[mode] || state.activeGroupId;
    persist("เปลี่ยนโหมดแล้ว");
    renderModes();
    updatePreviewContext(true);
  }

  function renderModes() {
    renderModeLibrary();
    renderModeStudio();
    renderModeGroupMap();
    renderUrlList();
  }

  async function command(type, payload = {}) {
    const playlist = activePlaylist();
    const sponsors = P.getPlaylistSponsors(state, playlist);
    const count = sponsors.length;
    const playbackMatches = playback?.playlistId === state.activePlaylist;
    const pendingMatches = pendingManualIndex
      && pendingManualIndex.playlistId === state.activePlaylist
      && Date.now() - pendingManualIndex.sentAt < 5000;
    const baseIndex = pendingMatches
      ? pendingManualIndex.index
      : playbackMatches
        ? Number(playback.currentIndex)
        : Number(state.currentIndex || 0);
    let manualTarget = null;

    if (type === "show") state.isVisible = true;
    if (type === "hide") state.isVisible = false;
    if (type === "pause") state.isPaused = !state.isPaused;
    if (type === "next") manualTarget = count ? (baseIndex + 1) % count : 0;
    if (type === "prev") manualTarget = count ? (baseIndex - 1 + count) % count : 0;
    if (manualTarget !== null) state.currentIndex = manualTarget;
    if (type === "playlist" || type === "reset" || type === "import") {
      state.currentIndex = 0;
      pendingManualIndex = null;
    }

    state.command = {
      id: P.uid("cmd"),
      type,
      payload,
      ts: Date.now()
    };

    try {
      const saved = await persist("ส่งคำสั่งแล้ว", {
        silent: true,
        renderOnRebase: false,
        quietError: true
      });
      if (!saved) throw new Error("บันทึกคำสั่งลง state ไม่สำเร็จ");
      P.broadcast({ type: "command", command: saved.command, state: saved });
      if (manualTarget !== null) {
        pendingManualIndex = {
          playlistId: state.activePlaylist,
          index: manualTarget,
          sentAt: Date.now()
        };
        if (playbackMatches) {
          const sponsor = sponsors[manualTarget];
          playback = {
            ...playback,
            currentIndex: manualTarget,
            sponsorId: sponsor?.id || "",
            sponsorName: sponsor?.name || "",
            startedAt: Date.now()
          };
          updatePlaybackUi();
        }
      }
      setSaveStatus("ส่งคำสั่งแล้ว", "success");
      refreshStatus();
    } catch (error) {
      showToast("ส่งคำสั่งไม่สำเร็จ", error.message || String(error), "error");
    }
  }

  function handlePlayback(message) {
    if (!message || message.playlistId !== state.activePlaylist) return;
    const now = Date.now();
    if (message.source === "display") lastDisplayPlaybackAt = now;
    if (message.source === "preview" && now - lastDisplayPlaybackAt < 15000) return;
    if (pendingManualIndex?.playlistId === state.activePlaylist) {
      const received = Number(message.currentIndex) || 0;
      if (received === pendingManualIndex.index) pendingManualIndex = null;
      else if (now - pendingManualIndex.sentAt < 5000) return;
      else pendingManualIndex = null;
    }
    playback = message;
    state.currentIndex = Number(message.currentIndex) || 0;
    els.previewStatus.textContent = message.source === "display" ? "รับสถานะจาก Display" : "รับสถานะจาก Preview";
    updatePlaybackUi();
  }

  async function updatePlaybackUi() {
    if (!playback) {
      refreshFallbackNowPlaying();
      return;
    }
    const token = ++playbackImageToken;
    const sponsor = state.images.find((item) => item.id === playback.sponsorId);
    els.nowSponsorName.textContent = sponsor?.name || playback.sponsorName || "ไม่มี Sponsor ที่กำลังแสดง";
    els.nowSponsorMeta.textContent = playback.count
      ? `ลำดับ ${Number(playback.currentIndex) + 1}/${playback.count} • ${Modes.labels[playback.mode] || playback.mode}`
      : "Output นี้ยังไม่มี Sponsor";
    els.nowFallback.hidden = !!sponsor;
    els.nowSponsorThumb.hidden = !sponsor;
    if (sponsor) {
      const src = await P.dbGetImageUrl(sponsor.id);
      if (token !== playbackImageToken) return;
      els.nowSponsorThumb.src = src;
      els.nowSponsorThumb.alt = sponsor.name;
    }
    state.isVisible = playback.visible !== false;
    state.isPaused = playback.paused === true;
    updateLiveControls();
    updateEffectUi();
    updateProgress();
  }

  function refreshFallbackNowPlaying() {
    const playlist = activePlaylist();
    const sponsors = P.getPlaylistSponsors(state, playlist);
    const index = sponsors.length ? Number(state.currentIndex || 0) % sponsors.length : 0;
    const sponsor = sponsors[index];
    els.nowSponsorName.textContent = sponsor?.name || "รอข้อมูลจาก Display";
    els.nowSponsorMeta.textContent = sponsor
      ? `พร้อมแสดง • ${index + 1}/${sponsors.length} • ${Modes.labels[playlist?.mode] || playlist?.mode}`
      : "เพิ่ม Sponsor เข้า Playlist หรือ Group สำรอง";
    els.nowFallback.hidden = !!sponsor;
    els.nowSponsorThumb.hidden = !sponsor;
    if (sponsor) {
      const token = ++playbackImageToken;
      P.dbGetImageUrl(sponsor.id).then((src) => {
        if (token !== playbackImageToken) return;
        els.nowSponsorThumb.src = src;
        els.nowSponsorThumb.alt = sponsor.name;
      });
    }
  }

  function updateProgress() {
    clearInterval(progressTimer);
    if (!playback?.durationMs || playback.paused || playback.effectMode) {
      els.nowProgress.style.width = "0%";
      return;
    }
    const update = () => {
      const elapsed = Date.now() - Number(playback.startedAt || Date.now());
      els.nowProgress.style.width = `${Math.max(0, Math.min(100, elapsed / playback.durationMs * 100))}%`;
    };
    update();
    progressTimer = setInterval(update, 250);
  }

  function updateEffectUi() {
    clearInterval(effectUiTimer);
    const active = !!playback?.effectMode && Number(playback.effectExpiresAt) > Date.now();
    els.effectBanner.hidden = !active;
    if (!active) return;
    els.effectLabel.textContent = playback.effectMode === "goal_popup"
      ? "Goal Popup กำลังแสดง"
      : "Sponsor Break กำลังแสดง";
    const update = () => {
      const seconds = Math.max(0, Math.ceil((Number(playback.effectExpiresAt) - Date.now()) / 1000));
      els.effectCountdown.textContent = String(seconds);
      if (!seconds) {
        clearInterval(effectUiTimer);
        els.effectBanner.hidden = true;
      }
    };
    update();
    effectUiTimer = setInterval(update, 250);
  }

  async function copyText(text, title = "คัดลอกแล้ว") {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast(title, text);
  }

  function loadObsLibrary() {
    return new Promise((resolve, reject) => {
      if (window.OBSWebSocket) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = OBS_LIBRARY_URL;
      script.onload = resolve;
      script.onerror = () => reject(new Error("โหลด OBS WebSocket library ไม่สำเร็จ"));
      document.head.appendChild(script);
    });
  }

  function setObsUi(status, message) {
    const connected = status === "connected";
    const loading = status === "loading";
    obsConnected = connected;
    els.obsStatus.className = `status-chip ${connected ? "connected" : status === "error" ? "error" : ""}`.trim();
    els.obsStatus.replaceChildren();
    const headerDot = document.createElement("span");
    headerDot.className = "status-dot";
    els.obsStatus.append(headerDot, document.createTextNode(connected ? "OBS เชื่อมต่อแล้ว" : loading ? "กำลังเชื่อมต่อ OBS" : "OBS ออฟไลน์"));
    els.obsConnectionBadge.className = `status-chip ${connected ? "connected" : status === "error" ? "error" : ""}`.trim();
    els.obsConnectionBadge.replaceChildren();
    const dot = document.createElement("span");
    dot.className = "status-dot";
    els.obsConnectionBadge.append(dot, document.createTextNode(connected ? "เชื่อมต่อแล้ว" : loading ? "กำลังเชื่อมต่อ" : "ออฟไลน์"));
    els.obsFeedback.textContent = message;
    els.obsConnectLabel.textContent = connected ? "เชื่อมต่อ OBS ใหม่" : loading ? "กำลังเชื่อมต่อ…" : "เชื่อมต่อ OBS";
  }

  async function connectObs() {
    collectSettings();
    setObsUi("loading", "กำลังเชื่อมต่อ OBS…");
    try {
      await loadObsLibrary();
      const ObsClass = window.OBSWebSocket?.default || window.OBSWebSocket;
      if (typeof ObsClass !== "function") throw new Error("ไม่พบ OBS WebSocket client");
      try {
        await obs?.disconnect?.();
      } catch {
        // Ignore stale connection cleanup.
      }
      obs = new ObsClass();
      obs.on?.("ConnectionClosed", () => setObsUi("offline", "การเชื่อมต่อ OBS ถูกปิด"));
      obs.on?.("ConnectionError", (error) => setObsUi("error", error?.message || "OBS WebSocket เกิดข้อผิดพลาด"));
      await obs.connect(`ws://${state.obs.host}:${state.obs.port}`, els.obsPassword.value || undefined);
      setObsUi("connected", `เชื่อมต่อ ${state.obs.host}:${state.obs.port} แล้ว`);
      persist("บันทึกค่า OBS แล้ว", { silent: true });
      showToast("เชื่อม OBS สำเร็จ", `${state.obs.host}:${state.obs.port}`);
    } catch (error) {
      console.error(error);
      obs = null;
      setObsUi("error", `เชื่อมต่อไม่สำเร็จ: ${error.message || error}`);
      showToast("เชื่อม OBS ไม่สำเร็จ", error.message || String(error), "error");
    }
  }

  function requireObs() {
    if (obsConnected && obs) return true;
    setObsUi("error", "กรุณา Connect OBS ก่อนใช้คำสั่งนี้");
    return false;
  }

  async function ensureObsSource({ url, sourceName, legacySourceNames = [] }) {
    if (!requireObs()) return false;
    try {
      const sceneResponse = await obs.call("GetCurrentProgramScene");
      const sceneName = sceneResponse.currentProgramSceneName;
      const inputSettings = {
        is_local_file: false,
        local_file: "",
        url,
        width: state.obs.width,
        height: state.obs.height,
        css: "body { background-color: rgba(0, 0, 0, 0); margin: 0; overflow: hidden; }",
        shutdown: false,
        restart_when_active: false
      };

      let input = null;
      try {
        input = await obs.call("GetInputSettings", { inputName: sourceName });
      } catch {
        // The canonical source does not exist yet. Check known pre-v4 names before creating it.
      }
      if (!input) {
        for (const legacyName of legacySourceNames.filter(Boolean)) {
          try {
            const legacyInput = await obs.call("GetInputSettings", { inputName: legacyName });
            if (legacyInput.inputKind && legacyInput.inputKind !== "browser_source") {
              throw new Error(`Source “${legacyName}” มีอยู่แล้วแต่ไม่ใช่ Browser Source`);
            }
            await obs.call("SetInputName", { inputName: legacyName, newInputName: sourceName });
            input = legacyInput;
            break;
          } catch (error) {
            if (error.message?.includes("ไม่ใช่ Browser Source")) throw error;
          }
        }
      }
      if (!input && legacySourceNames.length) {
        try {
          const requestedUrl = new URL(url, location.href);
          const requestedTarget = `${requestedUrl.searchParams.get("mode") || ""}|${requestedUrl.searchParams.get("group") || ""}`;
          const list = await obs.call("GetInputList", { inputKind: "browser_source" });
          for (const candidate of list.inputs || []) {
            if (!candidate.inputName?.startsWith("PepsLive Sponsor Dock -")) continue;
            const candidateInput = await obs.call("GetInputSettings", { inputName: candidate.inputName });
            const candidateUrl = new URL(candidateInput.inputSettings?.url || "", location.href);
            const candidateTarget = `${candidateUrl.searchParams.get("mode") || ""}|${candidateUrl.searchParams.get("group") || ""}`;
            if (candidateTarget !== requestedTarget) continue;
            await obs.call("SetInputName", { inputName: candidate.inputName, newInputName: sourceName });
            input = candidateInput;
            break;
          }
        } catch {
          // Older OBS versions may not expose GetInputList. Exact legacy-name migration above still applies.
        }
      }

      if (input) {
        if (input.inputKind && input.inputKind !== "browser_source") {
          throw new Error(`Source “${sourceName}” มีอยู่แล้วแต่ไม่ใช่ Browser Source`);
        }
        await obs.call("SetInputSettings", {
          inputName: sourceName,
          inputSettings,
          overlay: true
        });
      } else {
        await obs.call("CreateInput", {
          sceneName,
          inputName: sourceName,
          inputKind: "browser_source",
          inputSettings,
          sceneItemEnabled: true
        });
      }

      try {
        await obs.call("GetSceneItemId", { sceneName, sourceName });
      } catch {
        await obs.call("CreateSceneItem", { sceneName, sourceName, sceneItemEnabled: true });
      }
      setObsUi("connected", `Source “${sourceName}” พร้อมใน Scene “${sceneName}”`);
      showToast("Browser Source พร้อมแล้ว", sourceName);
      return true;
    } catch (error) {
      console.error(error);
      setObsUi("error", `สร้าง Source ไม่สำเร็จ: ${error.message || error}`);
      showToast("สร้าง Browser Source ไม่สำเร็จ", error.message || String(error), "error");
      return false;
    }
  }

  function dynamicDisplayUrl() {
    return pageUrl("live");
  }

  function createDynamicSource() {
    collectSettings();
    return ensureObsSource({ url: dynamicDisplayUrl(), sourceName: state.obs.sourceName });
  }

  function fixedSourceName(mode, groupId) {
    const isClassicAlias = mode === "auto" || mode === "display";
    const resolvedGroupId = mode === "auto"
      ? groupId || state.activeGroupId
      : isClassicAlias
      ? state.modeGroups[state.mode] || state.activeGroupId
      : groupId;
    const sourceToken = (value, fallback) => String(value || fallback)
      .normalize("NFKD")
      .replace(/^group[_-]?/i, "")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase()
      .slice(0, 64) || fallback;
    const resolvedMode = mode === "display" ? `DISPLAY_${state.mode}` : mode;
    return `PEPS_SPONSOR_${sourceToken(resolvedMode, "MODE")}_${sourceToken(resolvedGroupId, "GROUP")}`.slice(0, 160);
  }

  function legacyFixedSourceName(mode, groupId) {
    const isClassicAlias = mode === "auto" || mode === "display";
    const resolvedGroupId = mode === "auto"
      ? groupId || state.activeGroupId
      : isClassicAlias
        ? state.modeGroups[state.mode] || state.activeGroupId
        : groupId;
    const group = P.getGroup(state, resolvedGroupId);
    const modeLabel = mode === "auto"
      ? "อัตโนมัติ ตามค่าหน้า Control"
      : mode === "display"
        ? `Classic Display (${Modes.labels[state.mode] || state.mode})`
        : Modes.labels[mode] || mode;
    return `PepsLive Sponsor Dock - ${modeLabel} - ${group?.name || "Group"}`.slice(0, 160);
  }

  function createFixedSource(mode, groupId, url) {
    collectSettings();
    const sourceName = mode === "live" ? state.obs.sourceName : fixedSourceName(mode, groupId);
    return ensureObsSource({
      url,
      sourceName,
      legacySourceNames: mode === "live" ? [] : [legacyFixedSourceName(mode, groupId)]
    });
  }

  async function refreshBrowserSource(sourceName = state.obs.sourceName, reloadLiveDisplay = false) {
    if (!requireObs()) return;
    try {
      await obs.call("PressInputPropertiesButton", {
        inputName: sourceName,
        propertyName: "refreshnocache"
      });
      if (reloadLiveDisplay) command("reload");
      setObsUi("connected", `โหลด Source “${sourceName}” ใหม่แล้ว`);
    } catch (error) {
      setObsUi("error", `Refresh ไม่สำเร็จ: ${error.message || error}`);
    }
  }

  async function setSourceVisibility(visible, sourceName = state.obs.sourceName) {
    if (!requireObs()) return;
    try {
      const scene = await obs.call("GetCurrentProgramScene");
      const item = await obs.call("GetSceneItemId", {
        sceneName: scene.currentProgramSceneName,
        sourceName
      });
      await obs.call("SetSceneItemEnabled", {
        sceneName: scene.currentProgramSceneName,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: visible
      });
      setObsUi("connected", `${visible ? "แสดง" : "ซ่อน"} Scene Item แล้ว`);
    } catch (error) {
      setObsUi("error", `สั่ง Scene Item ไม่สำเร็จ: ${error.message || error}`);
    }
  }

  function safeFileName(value) {
    return String(value || "pepslive-sponsor")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 100);
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportProject() {
    const button = $("exportProjectBtn");
    button.disabled = true;
    collectSettings();
    try {
      const projectState = P.clone(P.mergeState(state));
      const imageData = {};
      for (const sponsor of projectState.images) {
        const record = await P.dbGetImageRecord(sponsor.id);
        if (!record?.blob) throw new Error(`ไม่พบไฟล์รูปของ ${sponsor.name}`);
        imageData[sponsor.id] = {
          name: record.name,
          type: record.type,
          dataUrl: await P.blobToDataUrl(record.blob)
        };
      }
      const output = {
        format: "pepslive-sponsor-dock-v4",
        exportedAt: P.nowIso(),
        state: projectState,
        imageData
      };
      const projectBlob = new Blob(
        [JSON.stringify(output, null, 2)],
        { type: "application/json" }
      );
      if (projectBlob.size > MAX_IMPORT_BYTES) {
        throw new RangeError(
          "Project เกิน 100 MB และจะ Import กลับไม่ได้ กรุณาลดจำนวนหรือขนาดไฟล์รูปก่อน Export"
        );
      }
      downloadBlob(
        projectBlob,
        `${safeFileName(state.projectName)}-sponsor-project.json`
      );
      showToast("Export Project แล้ว", `${projectState.images.length} Sponsor`);
    } catch (error) {
      showToast("Export ไม่สำเร็จ", error.message || String(error), "error");
    } finally {
      button.disabled = false;
    }
  }

  function importImageLookup(payload, sourceState) {
    if (isObject(payload.imageData)) {
      return (id) => payload.imageData[id];
    }
    if (isObject(payload.images) && Array.isArray(sourceState.sponsors)) {
      const keyBySponsor = new Map(sourceState.sponsors.map((sponsor) => [String(sponsor.id), sponsor.imageKey || sponsor.id]));
      return (id) => payload.images[keyBySponsor.get(String(id))] || payload.images[id];
    }
    return () => null;
  }

  async function importProject(file) {
    if (file.size > MAX_IMPORT_BYTES) {
      showToast("ไฟล์ใหญ่เกินไป", "Project JSON ต้องไม่เกิน 100 MB", "error");
      return;
    }
    const confirmed = await confirmAction({
      title: "แทนที่โปรเจกต์ปัจจุบัน?",
      message: "Import จะเปลี่ยน Groups, Playlists, Mode settings และรูปทั้งหมด หลังตรวจและเขียนรูปครบแล้วเท่านั้น",
      acceptLabel: "Import Project"
    });
    if (!confirmed) return;

    const staged = [];
    let replacedPrevious = null;
    let committed = false;
    try {
      const payload = JSON.parse(await file.text());
      const rawState = isObject(payload.state) ? payload.state : payload;
      const imported = P.mergeState(rawState);
      const lookup = importImageLookup(payload, rawState);
      const idMap = new Map(imported.images.map((image) => [image.id, P.uid("img")]));

      for (const image of imported.images) {
        const data = lookup(image.id);
        if (!data?.dataUrl) throw new Error(`ไม่พบข้อมูลรูปของ ${image.name}`);
        const blob = P.dataUrlToBlob(data.dataUrl);
        const targetId = idMap.get(image.id);
        await P.dbPutImage(targetId, blob, {
          name: data.name || image.name,
          type: data.type || blob.type
        });
        staged.push(targetId);
      }

      imported.images = imported.images.map((image) => ({ ...image, id: idMap.get(image.id) }));
      imported.groups = imported.groups.map((group) => ({
        ...group,
        imageIds: group.imageIds.map((id) => idMap.get(id)).filter(Boolean)
      }));
      imported.playlists = imported.playlists.map((playlist) => ({
        ...playlist,
        sponsorIds: playlist.sponsorIds.map((id) => idMap.get(id)).filter(Boolean)
      }));
      imported.command = { id: P.uid("cmd"), type: "import", ts: Date.now(), payload: {} };
      state = imported;
      const saved = await persist("Import Project", {
        replace: true,
        silent: true,
        renderOnRebase: false,
        quietError: true,
        throwOnError: true,
        returnPrevious: true,
        onPrevious: (previous) => {
          replacedPrevious = previous;
        }
      });
      state = saved;
      persistenceBase = P.clone(saved);
      committed = true;
      P.broadcast({ type: "command", command: state.command, state });
      const previousIds = (replacedPrevious?.images || []).map((image) => image.id);
      await Promise.allSettled(
        previousIds
          .filter((id) => !staged.includes(id))
          .map((id) => P.dbDeleteImage(id))
      );
      bindSettingsFromState();
      await renderAll();
      showToast("Import Project สำเร็จ", `${state.images.length} Sponsor`);
    } catch (error) {
      if (!committed) {
        state = await P.loadStateAuthoritative();
        persistenceBase = P.clone(state);
        await Promise.allSettled(staged.map((id) => P.dbDeleteImage(id)));
      }
      showToast("Import ไม่สำเร็จ", error.message || String(error), "error");
    }
  }

  async function loadSample() {
    const confirmed = await confirmAction({
      title: "โหลดข้อมูลตัวอย่าง?",
      message: "ข้อมูลและรูปปัจจุบันจะถูกแทนที่ด้วย Sponsor ตัวอย่างสำหรับทดสอบทุกโหมด",
      acceptLabel: "โหลดตัวอย่าง"
    });
    if (!confirmed) return;
    try {
      state = await P.seedSamples({ force: true });
      persistenceBase = P.clone(state);
      P.broadcast({ type: "command", command: state.command, state });
      bindSettingsFromState();
      await renderAll();
      showToast("โหลดข้อมูลตัวอย่างแล้ว");
      activateView("live");
    } catch (error) {
      showToast("โหลดตัวอย่างไม่สำเร็จ", error.message || String(error), "error");
    }
  }

  async function mergeRedesignData() {
    const confirmed = await confirmAction({
      title: "รวมข้อมูล redesign เดิมเข้ามา?",
      message: "ระบบจะคงข้อมูล GitHub v3 ปัจจุบันไว้ แล้วเพิ่ม Sponsors, Groups และ Playlists จาก redesign เป็นชุดใหม่ แนะนำให้ Export Project ปัจจุบันก่อนดำเนินการ",
      acceptLabel: "รวมข้อมูล"
    });
    if (!confirmed) return;
    els.mergeRedesignBtn.disabled = true;
    try {
      state = await P.mergeRedesignProject();
      persistenceBase = P.clone(state);
      bindSettingsFromState();
      await renderAll();
      showToast("รวมข้อมูล redesign แล้ว", "ข้อมูลเดิมทั้งสองชุดอยู่ในโปรเจกต์เดียวกัน");
    } catch (error) {
      showToast("รวมข้อมูล redesign ไม่สำเร็จ", error.message || String(error), "error");
    } finally {
      els.mergeRedesignBtn.disabled = false;
    }
  }

  async function resetProject() {
    const confirmed = await confirmAction({
      title: "Reset โปรเจกต์ทั้งหมด?",
      message: "Groups, Playlists, Mode settings และไฟล์รูปทั้งหมดใน browser profile นี้จะถูกลบ",
      acceptLabel: "Reset ทั้งหมด"
    });
    if (!confirmed) return;
    try {
      let replacedPrevious = null;
      state = P.defaultState();
      state.command = { id: P.uid("cmd"), type: "reset", ts: Date.now(), payload: {} };
      persistenceBase = P.clone(state);
      const saved = await persist("Reset Project", {
        replace: true,
        silent: true,
        renderOnRebase: false,
        quietError: true,
        throwOnError: true,
        returnPrevious: true,
        onPrevious: (previous) => {
          replacedPrevious = previous;
        }
      });
      state = saved;
      P.broadcast({ type: "command", command: state.command, state });
      const cleanup = await Promise.allSettled(
        (replacedPrevious?.images || []).map((image) => P.dbDeleteImage(image.id))
      );
      const cleanupFailures = cleanup.filter((result) => result.status === "rejected").length;
      playback = null;
      bindSettingsFromState();
      await renderAll();
      showToast(
        "Reset โปรเจกต์แล้ว",
        cleanupFailures ? `มีไฟล์รูปเก่าล้างไม่สำเร็จ ${cleanupFailures} รายการ` : ""
      );
      activateView("library");
    } catch (error) {
      state = await P.loadStateAuthoritative();
      persistenceBase = P.clone(state);
      bindSettingsFromState();
      await renderAll();
      showToast("Reset ไม่สำเร็จ", error.message || String(error), "error");
    }
  }

  async function renderAll() {
    refreshStatus();
    renderGroupEditor();
    renderPlaylistEditor();
    renderModes();
    await renderSponsorList();
    refreshFallbackNowPlaying();
    updatePreviewContext();
  }

  function bindEvents() {
    for (const button of document.querySelectorAll("[data-view]")) {
      button.addEventListener("click", () => activateView(button.dataset.view));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const index = VALID_VIEWS.indexOf(button.dataset.view);
        const delta = event.key === "ArrowRight" ? 1 : -1;
        activateView(VALID_VIEWS[(index + delta + VALID_VIEWS.length) % VALID_VIEWS.length], { focus: true });
      });
    }
    $("brandHome").addEventListener("click", () => activateView("live"));
    for (const button of document.querySelectorAll("[data-library-section]")) {
      button.addEventListener("click", () => activateLibrarySection(button.dataset.librarySection));
    }

    for (const id of ["projectName", "opacity", "autoPlay", "safeArea", "showNames", "showTier"]) {
      $(id).addEventListener("input", () => {
        collectSettings();
        schedulePersist();
      });
      $(id).addEventListener("change", () => {
        collectSettings();
        schedulePersist({ delay: 80 });
      });
    }
    for (const id of ["obsHost", "obsPort", "obsSourceName", "obsWidth", "obsHeight"]) {
      $(id).addEventListener("change", () => {
        collectSettings();
        schedulePersist({ silent: true, delay: 80 });
      });
    }

    els.sponsorFiles.addEventListener("change", async (event) => {
      await addSponsorsFromFiles([...event.target.files]);
      event.target.value = "";
    });
    for (const eventName of ["dragenter", "dragover"]) {
      els.uploadZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.uploadZone.classList.add("is-dragging");
      });
    }
    for (const eventName of ["dragleave", "drop"]) {
      els.uploadZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.uploadZone.classList.remove("is-dragging");
      });
    }
    els.uploadZone.addEventListener("drop", (event) => addSponsorsFromFiles([...event.dataTransfer.files]));
    els.sponsorSearch.addEventListener("input", renderSponsorList);
    els.tierFilter.addEventListener("change", renderSponsorList);

    els.groupSelect.addEventListener("change", () => {
      state.activeGroupId = els.groupSelect.value;
      persist("เปลี่ยน Group แล้ว");
      renderGroupEditor();
      renderSponsorList();
      renderUrlList();
    });
    $("addGroupBtn").addEventListener("click", addGroup);
    $("saveGroupBtn").addEventListener("click", saveGroup);
    $("deleteGroupBtn").addEventListener("click", deleteGroup);
    $("footballPresetBtn").addEventListener("click", createFootballPreset);
    $("groupAddSponsorBtn").addEventListener("click", () => addSponsorToGroup(els.groupAddSponsor.value, state.activeGroupId));

    els.livePlaylist.addEventListener("change", () => selectPlaylist(els.livePlaylist.value));
    els.activePlaylist.addEventListener("change", () => selectPlaylist(els.activePlaylist.value));
    els.playlistMode.addEventListener("change", () => updatePlaylistModeHelp(els.playlistMode.value));
    $("addPlaylistBtn").addEventListener("click", addPlaylist);
    $("savePlaylistBtn").addEventListener("click", savePlaylist);
    $("deletePlaylistBtn").addEventListener("click", deletePlaylist);
    $("shufflePlaylistBtn").addEventListener("click", shufflePlaylist);
    $("playlistAddSponsorBtn").addEventListener("click", () => addSponsorToPlaylist(els.playlistAddSponsor.value, state.activePlaylist));

    els.modeCategoryFilter.addEventListener("change", renderModeLibrary);
    els.outputMode.addEventListener("change", () => selectMode(els.outputMode.value));
    els.outputGroup.addEventListener("change", () => {
      state.modeGroups[state.mode] = els.outputGroup.value;
      state.activeGroupId = els.outputGroup.value;
      persist("เปลี่ยน Group ของโหมดแล้ว");
      renderGroupEditor();
      renderModeGroupMap();
      renderUrlList();
      updatePreviewContext(true);
    });
    $("syncModeBtn").addEventListener("click", () => command("sync", { mode: state.mode }));
    $("copyModeUrlBtn").addEventListener("click", () => copyText(els.currentModeUrl.value, "คัดลอก URL ของรูปแบบแล้ว"));
    $("createModeSourceBtn").addEventListener("click", async () => {
      const groupId = state.modeGroups[state.mode] || state.activeGroupId;
      const created = await createFixedSource(state.mode, groupId, els.currentModeUrl.value);
      if (created) els.modeSourceFeedback.textContent = "Source พร้อมใช้งานแล้ว: สร้างใหม่หรืออัปเดตรายการเดิมโดยไม่ซ้ำ";
      else if (!obsConnected) els.modeSourceFeedback.textContent = "ยังไม่ได้เชื่อมต่อ OBS — ไปที่เมนู ระบบ OBS เพื่อต่อก่อน";
    });
    $("refreshModeSourceBtn").addEventListener("click", () => refreshBrowserSource(fixedSourceName(state.mode, state.modeGroups[state.mode] || state.activeGroupId)));
    $("showModeSourceBtn").addEventListener("click", () => setSourceVisibility(true, fixedSourceName(state.mode, state.modeGroups[state.mode] || state.activeGroupId)));
    $("hideModeSourceBtn").addEventListener("click", () => setSourceVisibility(false, fixedSourceName(state.mode, state.modeGroups[state.mode] || state.activeGroupId)));

    els.cmdVisibility.addEventListener("click", () => command(state.isVisible === false ? "show" : "hide"));
    $("cmdPrev").addEventListener("click", () => command("prev"));
    els.cmdPause.addEventListener("click", () => command("pause"));
    $("cmdNext").addEventListener("click", () => command("next"));
    $("cmdBreak").addEventListener("click", () => command("break", {
      duration: 10,
      groupId: state.modeGroups.sponsor_break
    }));
    $("cmdGoal").addEventListener("click", () => command("goal", {
      duration: 5,
      groupId: state.modeGroups.goal_popup
    }));
    $("cmdCancelEffect").addEventListener("click", () => command("cancel_effect"));
    $("cmdReload").addEventListener("click", () => command("reload"));
    $("reloadPreviewBtn").addEventListener("click", reloadPreview);
    els.previewFrame.addEventListener("load", () => els.previewStatus.textContent = "พร้อมแสดง");
    $("copyAutoUrlBtn").addEventListener("click", () => copyText(dynamicDisplayUrl(), "คัดลอก Live Display URL แล้ว"));

    $("obsConnectForm").addEventListener("submit", (event) => {
      event.preventDefault();
      connectObs();
    });
    $("createSourceBtn").addEventListener("click", createDynamicSource);
    $("refreshSourceBtn").addEventListener("click", () => refreshBrowserSource(state.obs.sourceName, true));
    $("showSourceBtn").addEventListener("click", () => setSourceVisibility(true));
    $("hideSourceBtn").addEventListener("click", () => setSourceVisibility(false));

    $("exportProjectBtn").addEventListener("click", exportProject);
    els.importProjectInput.addEventListener("change", async (event) => {
      const [file] = event.target.files;
      if (file) await importProject(file);
      event.target.value = "";
    });
    $("loadSampleBtn").addEventListener("click", loadSample);
    els.mergeRedesignBtn.addEventListener("click", mergeRedesignData);
    $("resetProjectBtn").addEventListener("click", resetProject);

    els.confirmDialog.addEventListener("close", () => {
      if (!confirmResolver) return;
      const resolve = confirmResolver;
      confirmResolver = null;
      resolve(els.confirmDialog.returnValue === "confirm");
    });

    unsubscribe = P.subscribe(async (message) => {
      if (!message) return;
      if (message.sourceId === P.INSTANCE_ID) return;
      if (message.type === "playback") {
        handlePlayback(message);
        return;
      }
      if (message.state) {
        if (persistencePending || saveTimer) return;
        const incoming = P.mergeState(message.state);
        const incomingRevision = Number(incoming.revision);
        const currentRevision = Number(state.revision);
        if (incomingRevision < currentRevision) return;
        if (
          incomingRevision === currentRevision
          && stateContent(incoming) === stateContent(state)
        ) return;
        state = incomingRevision === currentRevision
          ? await P.loadStateAuthoritative()
          : incoming;
        persistenceBase = P.clone(state);
        bindSettingsFromState();
        renderAll();
      }
    });

    window.addEventListener("hashchange", () => activateView(location.hash.slice(1) || "live", { writeHash: false }));
    previewResizeObserver = new ResizeObserver(updatePreviewScale);
    previewResizeObserver.observe(els.previewFrame.parentElement);
    window.addEventListener("pagehide", (event) => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      clearInterval(progressTimer);
      clearInterval(effectUiTimer);
      progressTimer = null;
      effectUiTimer = null;
      previewResizeObserver?.disconnect();
      previewResizeObserver = null;
      try {
        Promise.resolve(obs?.disconnect?.()).catch(() => {});
      } catch {
        // Ignore connection cleanup during navigation.
      }
      obs = null;
      obsConnected = false;
      if (!event.persisted) {
        unsubscribe?.();
        unsubscribe = null;
      }
    });
    window.addEventListener("pageshow", async (event) => {
      if (!event.persisted) return;
      await persistenceQueue;
      state = await P.loadStateAuthoritative();
      persistenceBase = P.clone(state);
      bindSettingsFromState();
      await renderAll();
      previewResizeObserver = new ResizeObserver(updatePreviewScale);
      previewResizeObserver.observe(els.previewFrame.parentElement);
      updatePreviewScale();
      setObsUi("offline", "กลับจากหน้าก่อนหน้าแล้ว กรุณา Connect OBS ใหม่หากต้องการควบคุม Source");
    });
  }

  (async () => {
    try {
      state = await P.initialize();
      persistenceBase = P.clone(state);
      bindSettingsFromState();
      bindEvents();
      await renderAll();
      activateView(location.hash.slice(1) || "live", { writeHash: false });
      updatePreviewScale();
      setSaveStatus("พร้อมใช้งาน", "success");
    } catch (error) {
      console.error(error);
      setSaveStatus("เปิดระบบไม่สำเร็จ", "error");
      showToast("เปิด Sponsor Dock ไม่สำเร็จ", error.message || String(error), "error");
    }
  })();
})();
