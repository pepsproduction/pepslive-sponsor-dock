(() => {
  "use strict";

  const P = window.PepsSponsor;
  const Modes = window.PepsSponsorModes;
  const Renderers = window.PepsSponsorRenderers;
  if (!P || !Modes || !Renderers) throw new Error("Sponsor display dependencies are missing");

  const query = new URLSearchParams(location.search);
  const requestedMode = query.get("mode") || "display";
  const requestedGroup = query.get("group") || "";
  const isPreview = query.get("preview") === "1";
  const isManagedOutput = requestedMode === "live" || requestedMode === "playlist";
  const orchestratedModes = new Set([
    "lower_third", "corner_badge", "side_tower",
    "grid_board", "sponsor_break", "goal_popup"
  ]);

  const root = document.getElementById("displayRoot");
  const stage = document.getElementById("displayStage");
  const layer = document.getElementById("sponsorLayer");
  const emptyState = document.getElementById("emptyState");
  const emptyStateTitle = document.getElementById("emptyStateTitle");
  const emptyStateText = document.getElementById("emptyStateText");
  const safeAreaGuide = document.getElementById("safeAreaGuide");

  let state = P.defaultState();
  let currentIndex = 0;
  let renderGeneration = 0;
  let rendererCleanup = null;
  let autoTimer = null;
  let effectTimer = null;
  let effectMode = "";
  let effectGroupId = "";
  let effectExpiresAt = 0;
  let lastCommandId = "";
  let lastCommandTs = 0;
  let lastContext = null;

  function normalizeIndex(index, length) {
    if (!length) return 0;
    return ((Number(index) % length) + length) % length;
  }

  function clearRuntime() {
    clearTimeout(autoTimer);
    clearTimeout(effectTimer);
    autoTimer = null;
    effectTimer = null;
    if (typeof rendererCleanup === "function") {
      try {
        rendererCleanup();
      } catch (error) {
        console.warn("Renderer cleanup failed", error);
      }
    }
    rendererCleanup = null;
  }

  function setDiagnostic(title, text, show) {
    emptyStateTitle.textContent = title;
    emptyStateText.textContent = text;
    emptyState.classList.toggle("show", isPreview && show);
  }

  function resolveContext() {
    if (!isManagedOutput) {
      const mode = Modes.has(requestedMode) ? requestedMode : state.mode;
      const group = state.groups.find((item) => item.id === requestedGroup)
        || P.getGroup(state, state.modeGroups[mode])
        || P.getGroup(state);
      return {
        mode,
        groupId: group?.id || "",
        playlistId: "",
        sponsors: P.getGroupSponsors(state, group),
        visible: true,
        paused: false,
        effect: false
      };
    }

    if (effectMode) {
      const group = P.getGroup(state, effectGroupId)
        || P.getGroup(state, state.modeGroups[effectMode])
        || P.getGroup(state);
      return {
        mode: effectMode,
        groupId: group?.id || "",
        playlistId: state.activePlaylist,
        sponsors: P.getGroupSponsors(state, group),
        visible: state.isVisible !== false,
        paused: false,
        effect: true
      };
    }

    const playlist = P.getActivePlaylist(state);
    const mode = Modes.has(playlist?.mode) ? playlist.mode : state.mode;
    return {
      mode,
      groupId: playlist?.groupId || state.activeGroupId,
      playlistId: playlist?.id || "",
      sponsors: P.getPlaylistSponsors(state, playlist),
      visible: state.isVisible !== false,
      paused: state.isPaused === true,
      effect: false
    };
  }

  function durationFor(context, sponsor) {
    const playlist = state.playlists.find((item) => item.id === context.playlistId);
    return Math.max(
      2000,
      Number(sponsor?.duration || playlist?.defaultDuration || 6) * 1000
    );
  }

  function broadcastPlayback(context, index, options = {}) {
    if (!isManagedOutput) return;
    const safeIndex = normalizeIndex(index, context.sponsors.length);
    const sponsor = context.sponsors[safeIndex] || null;
    const durationMs = durationFor(context, sponsor);
    P.broadcast({
      type: "playback",
      source: isPreview ? "preview" : "display",
      requestedMode,
      mode: context.mode,
      groupId: context.groupId,
      playlistId: context.playlistId,
      sponsorId: sponsor?.id || "",
      sponsorName: sponsor?.name || "",
      currentIndex: safeIndex,
      count: context.sponsors.length,
      visible: context.visible,
      paused: context.paused,
      startedAt: options.startedAt || Date.now(),
      durationMs,
      effectMode,
      effectExpiresAt
    });
  }

  function scheduleAuto(context, safeIndex) {
    clearTimeout(autoTimer);
    autoTimer = null;
    if (
      !state.settings.autoPlay
      || context.paused
      || context.effect
      || context.sponsors.length < 2
      || !orchestratedModes.has(context.mode)
    ) return;

    const sponsor = context.sponsors[safeIndex];
    autoTimer = setTimeout(() => {
      currentIndex = normalizeIndex(currentIndex + 1, context.sponsors.length);
      render();
    }, durationFor(context, sponsor));
  }

  async function render() {
    const generation = ++renderGeneration;
    clearTimeout(autoTimer);
    autoTimer = null;
    if (typeof rendererCleanup === "function") {
      rendererCleanup();
      rendererCleanup = null;
    }

    const context = resolveContext();
    lastContext = context;
    const safeIndex = normalizeIndex(currentIndex, context.sponsors.length);
    const settings = state.modeSettings[context.mode] || Modes.defaultsFor(context.mode);
    const opacity = Math.max(0, Math.min(1, Number(state.settings.opacity ?? 100) / 100));

    root.classList.toggle("is-output-hidden", !context.visible);
    stage.className = "display-stage";
    stage.dataset.mode = context.mode;
    stage.dataset.group = context.groupId;
    stage.style.setProperty("--output-opacity", String(opacity));
    stage.classList.toggle("is-hidden", !context.visible);
    safeAreaGuide.classList.toggle("show", isPreview && state.settings.safeArea === true);

    if (!context.visible) {
      setDiagnostic("Display ถูกซ่อนอยู่", "กด ON AIR ที่หน้า Live เพื่อแสดง Sponsor", true);
    } else if (!context.sponsors.length) {
      setDiagnostic(
        "Output นี้ยังไม่มี Sponsor",
        context.playlistId
          ? "เพิ่ม Sponsor เข้า Playlist หรือ Group สำรอง"
          : "เพิ่ม Sponsor เข้า Group ที่ URL นี้กำลังใช้",
        true
      );
    } else {
      setDiagnostic("", "", false);
    }

    if (!context.visible || !context.sponsors.length) {
      layer.replaceChildren();
      broadcastPlayback(context, safeIndex);
      return;
    }

    const cleanup = await Renderers.render(layer, {
      mode: context.mode,
      sponsors: context.sponsors,
      state,
      settings,
      index: safeIndex,
      paused: context.paused,
      getImageUrl: P.dbGetImageUrl,
      isCurrent: () => generation === renderGeneration,
      onIndexChange: (nextIndex) => {
        if (generation !== renderGeneration) return;
        currentIndex = normalizeIndex(nextIndex, context.sponsors.length);
        broadcastPlayback(context, currentIndex);
      }
    });
    if (generation !== renderGeneration) {
      if (typeof cleanup === "function") cleanup();
      return;
    }

    rendererCleanup = typeof cleanup === "function" ? cleanup : null;
    broadcastPlayback(context, safeIndex);
    scheduleAuto(context, safeIndex);
  }

  function armEffectTimer() {
    clearTimeout(effectTimer);
    effectTimer = null;
    if (!effectMode) return;
    const remaining = effectExpiresAt - Date.now();
    if (remaining <= 0) {
      cancelEffect();
      return;
    }
    effectTimer = setTimeout(() => {
      effectMode = "";
      effectGroupId = "";
      effectExpiresAt = 0;
      render();
    }, Math.max(1, remaining));
  }

  function startEffect(mode, duration, groupId = "") {
    effectMode = mode;
    effectGroupId = groupId;
    effectExpiresAt = Date.now() + Math.max(1, Number(duration) || 5) * 1000;
    armEffectTimer();
  }

  function cancelEffect() {
    clearTimeout(effectTimer);
    effectTimer = null;
    effectMode = "";
    effectGroupId = "";
    effectExpiresAt = 0;
  }

  async function handleCommand(command, incomingState = null) {
    if (!command) return;
    if (command.id && command.id === lastCommandId) return;
    if (!command.id && Number(command.ts) <= lastCommandTs) return;

    lastCommandId = command.id || "";
    lastCommandTs = Number(command.ts) || Date.now();
    if (incomingState) state = P.mergeState(incomingState);

    if (command.type === "reload") {
      location.reload();
      return;
    }

    if (isManagedOutput) {
      if (["show", "hide", "next", "prev", "pause", "playlist", "import", "init", "reset"].includes(command.type)) {
        currentIndex = Number(state.currentIndex) || 0;
      }
      if (command.type === "break") {
        startEffect(
          "sponsor_break",
          command.payload?.duration || 10,
          command.payload?.groupId || state.modeGroups.sponsor_break
        );
      } else if (command.type === "goal") {
        startEffect(
          "goal_popup",
          command.payload?.duration || 5,
          command.payload?.groupId || state.modeGroups.goal_popup
        );
      } else if (command.type === "cancel_effect") {
        cancelEffect();
      }
    }

    await render();
  }

  let unsubscribe = P.subscribe(async (message) => {
    if (!message) return;
    if (message.type === "command") {
      await handleCommand(
        message.command,
        message.state || await P.loadStateAuthoritative()
      );
      return;
    }
    if (message.state) {
      const incoming = P.mergeState(message.state);
      state = incoming;
      if (incoming.command?.id && incoming.command.id !== lastCommandId) {
        handleCommand(incoming.command, incoming);
      } else {
        render();
      }
    }
  });

  window.addEventListener("focus", async () => {
    const incoming = await P.loadStateAuthoritative();
    state = incoming;
    if (incoming.command?.id && incoming.command.id !== lastCommandId) {
      handleCommand(incoming.command, incoming);
    } else {
      render();
    }
  });

  window.addEventListener("pagehide", (event) => {
    clearRuntime();
    if (!event.persisted) {
      unsubscribe?.();
      unsubscribe = null;
    }
  });

  window.addEventListener("pageshow", async (event) => {
    if (!event.persisted) return;
    if (effectMode) armEffectTimer();
    const incoming = await P.loadStateAuthoritative();
    state = incoming;
    currentIndex = Number(incoming.currentIndex) || 0;
    if (incoming.command?.id && incoming.command.id !== lastCommandId) {
      await handleCommand(incoming.command, incoming);
    } else {
      await render();
    }
  });

  (async () => {
    try {
      state = await P.initialize();
      currentIndex = Number(state.currentIndex) || 0;
      lastCommandId = state.command?.id || "";
      lastCommandTs = Number(state.command?.ts) || 0;
      await render();
    } catch (error) {
      console.error(error);
      setDiagnostic("เปิด Sponsor Display ไม่สำเร็จ", error.message || String(error), true);
    }
  })();
})();
