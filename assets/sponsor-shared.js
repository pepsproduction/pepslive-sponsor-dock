(() => {
  "use strict";

  const Modes = window.PepsSponsorModes;
  if (!Modes) throw new Error("sponsor-mode-registry.js must load before sponsor-shared.js");

  const STORAGE_KEY = "peps_sponsor_dock_state_v2";
  const REDESIGN_STORAGE_KEY = "pepslive_sponsor_dock_state_v1";
  const DB_NAME = "PepsSponsorDockDB_v2";
  const LEGACY_DB_NAME = "PepsLiveSponsorDockDB";
  const DB_VERSION = 2;
  const LEGACY_DB_VERSION = 1;
  const IMAGE_STORE = "images";
  const STATE_STORE = "state";
  const STATE_RECORD_ID = "current";
  const CHANNEL_NAME = "peps_sponsor_dock_channel_v2";
  const STATE_LOCK_NAME = "peps_sponsor_dock_state_lock_v2";
  const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
  const MAX_PROJECT_BYTES = 100 * 1024 * 1024;
  const MAX_SPONSORS = 5000;
  const MAX_GROUPS = 500;
  const MAX_PLAYLISTS = 500;

  const tierLabels = {
    main: "Main Sponsor",
    gold: "Gold Sponsor",
    silver: "Silver Sponsor",
    partner: "Partner"
  };

  const tiers = Object.keys(tierLabels);
  const imageTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
  const shadowValues = ["none", "soft", "strong", "neon"];
  const commandTypes = [
    "init", "sync", "show", "hide", "pause", "next", "prev",
    "playlist", "mode", "group", "break", "goal", "cancel_effect",
    "reload", "import", "reset"
  ];

  let dbPromise = null;
  let legacyDbPromise = null;
  let currentDb = null;
  let legacyDb = null;
  let initializePromise = null;
  let outboundChannel = null;
  const imageUrlCache = new Map();

  function uid(prefix = "id") {
    if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  const INSTANCE_ID = uid("page");

  function nowIso() {
    return new Date().toISOString();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function cleanText(value, fallback, maxLength = 160) {
    const text = typeof value === "string" ? value.trim() : "";
    return (text || fallback).slice(0, maxLength);
  }

  function numberInRange(value, min, max, fallback, integer = false) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    const bounded = Math.min(max, Math.max(min, number));
    return integer ? Math.round(bounded) : bounded;
  }

  function enumValue(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function uniqueId(value, fallback, used, prefix) {
    let id = cleanText(value, fallback, 120);
    while (used.has(id)) id = uid(prefix);
    used.add(id);
    return id;
  }

  function defaultModeGroups(groupId = "all") {
    return Object.fromEntries(Modes.ids.map((mode) => [mode, groupId]));
  }

  function defaultModeSettings() {
    return Object.fromEntries(Modes.ids.map((mode) => [mode, Modes.defaultsFor(mode)]));
  }

  function defaultPlaylists(groupId = "all") {
    return [
      {
        id: "pl_live",
        name: "ระหว่างแข่งขัน",
        mode: "lower_third",
        groupId,
        defaultDuration: 6,
        sponsorIds: []
      },
      {
        id: "pl_halftime",
        name: "พักครึ่ง / Sponsor Break",
        mode: "sponsor_break",
        groupId,
        defaultDuration: 10,
        sponsorIds: []
      },
      {
        id: "pl_goal",
        name: "Goal Sponsor Popup",
        mode: "goal_popup",
        groupId,
        defaultDuration: 5,
        sponsorIds: []
      }
    ];
  }

  function defaultState() {
    return {
      version: 4,
      stateEpoch: 0,
      revision: 0,
      updatedAt: nowIso(),
      projectName: "PepsLive Sponsor Dock",
      mode: "grid",
      activeGroupId: "all",
      activePlaylist: "pl_live",
      images: [],
      groups: [{ id: "all", name: "รวมทั้งหมด", imageIds: [] }],
      playlists: defaultPlaylists(),
      modeGroups: defaultModeGroups(),
      modeSettings: defaultModeSettings(),
      isVisible: true,
      isPaused: false,
      currentIndex: 0,
      settings: {
        autoPlay: true,
        safeArea: false,
        showNames: true,
        showTier: true,
        opacity: 100
      },
      obs: {
        host: "127.0.0.1",
        port: 4455,
        sourceName: "PEPS_SPONSOR_DISPLAY",
        width: 1920,
        height: 1080
      },
      command: {
        id: uid("cmd"),
        type: "init",
        ts: Date.now(),
        payload: {}
      },
      migration: {
        source: "new",
        completedAt: "",
        alternateRedesignDetected: false,
        redesignMerged: false,
        missingImages: 0
      }
    };
  }

  function controlShape(control) {
    if (Array.isArray(control)) {
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
    return control || {};
  }

  function normalizeModeSettings(input, flatSource = {}) {
    const source = isObject(input) ? input : {};
    const output = {};

    for (const mode of Modes.ids) {
      const defaults = Modes.defaultsFor(mode);
      const supplied = isObject(source[mode]) ? source[mode] : {};
      const controls = Modes.controlsFor(mode).map(controlShape);
      const next = { ...defaults };

      for (const control of controls) {
        const key = control.key;
        if (!key || !Object.hasOwn(defaults, key)) continue;
        const raw = supplied[key] !== undefined
          ? supplied[key]
          : flatSource[key] !== undefined
            ? flatSource[key]
            : defaults[key];

        if (control.type === "select") {
          const allowed = (control.options || []).map((option) => (
            Array.isArray(option) ? option[0] : option.value
          ));
          next[key] = enumValue(raw, allowed, defaults[key]);
        } else if (control.type === "toggle") {
          next[key] = raw !== false;
        } else if (typeof defaults[key] === "number") {
          next[key] = numberInRange(
            raw,
            Number.isFinite(Number(control.min)) ? Number(control.min) : -100000,
            Number.isFinite(Number(control.max)) ? Number(control.max) : 100000,
            defaults[key],
            Number(control.step) >= 1
          );
        } else {
          next[key] = cleanText(raw, defaults[key], 120);
        }
      }
      output[mode] = next;
    }

    return output;
  }

  function redesignRawToUnified(raw, idMap = null) {
    const source = isObject(raw) ? raw : {};
    const sponsors = Array.isArray(source.sponsors) ? source.sponsors : [];
    const mappedId = (id) => idMap?.get(String(id)) || String(id);
    const images = sponsors.map((sponsor, index) => ({
      id: mappedId(sponsor.id || `legacy_${index + 1}`),
      name: cleanText(sponsor.name, `Sponsor ${index + 1}`, 120),
      tier: enumValue(sponsor.tier, tiers, "partner"),
      duration: numberInRange(sponsor.duration, 2, 60, 6, true),
      enabled: sponsor.enabled !== false,
      createdAt: cleanText(sponsor.createdAt, nowIso(), 48)
    }));

    const sourcePlaylists = Array.isArray(source.playlists) && source.playlists.length
      ? source.playlists
      : [];
    const groups = [{ id: "all", name: "รวมทั้งหมด", imageIds: images.map((image) => image.id) }];
    const playlists = sourcePlaylists.map((playlist, index) => {
      const playlistId = cleanText(playlist.id, `pl_legacy_${index + 1}`, 120);
      const groupId = `group_${playlistId}`.slice(0, 120);
      const ids = Array.isArray(playlist.sponsorIds)
        ? playlist.sponsorIds.map((id) => mappedId(id)).filter(Boolean)
        : [];
      groups.push({
        id: groupId,
        name: cleanText(playlist.name, `Playlist ${index + 1}`, 120),
        imageIds: Array.from(new Set(ids))
      });
      return {
        id: playlistId,
        name: cleanText(playlist.name, `Playlist ${index + 1}`, 120),
        mode: Modes.mapRedesignMode(playlist.mode),
        groupId,
        defaultDuration: numberInRange(playlist.defaultDuration, 2, 60, 6, true),
        sponsorIds: Array.from(new Set(ids))
      };
    });

    const fallbackPlaylists = playlists.length ? playlists : defaultPlaylists("all");
    const activePlaylist = fallbackPlaylists.some((playlist) => playlist.id === source.activePlaylist)
      ? source.activePlaylist
      : fallbackPlaylists[0].id;
    const active = fallbackPlaylists.find((playlist) => playlist.id === activePlaylist);
    const modeGroups = defaultModeGroups("all");
    for (const playlist of fallbackPlaylists) modeGroups[playlist.mode] = playlist.groupId;

    const oldSettings = isObject(source.settings) ? source.settings : {};
    const modeSettings = defaultModeSettings();
    const shadowMap = { none: 0, soft: 0.45, strong: 0.72, neon: 0.9 };
    for (const mode of Modes.ids) {
      const values = modeSettings[mode];
      if (values.size !== undefined) values.size = numberInRange(oldSettings.logoSize, 40, 800, values.size, true);
      if (values.logoSize !== undefined) {
        values.logoSize = numberInRange(oldSettings.logoSize, 40, 220, values.logoSize, true);
      }
      if (values.gap !== undefined) values.gap = numberInRange(oldSettings.gap, 0, 240, values.gap, true);
      if (values.radius !== undefined) values.radius = numberInRange(oldSettings.radius, 0, 80, values.radius, true);
      if (values.shadow !== undefined) {
        values.shadow = typeof values.shadow === "number"
          ? shadowMap[oldSettings.shadow] ?? values.shadow
          : enumValue(oldSettings.shadow, shadowValues, values.shadow);
      }
      if (values.opacity !== undefined) {
        values.opacity = numberInRange(oldSettings.opacity, 0, 100, values.opacity, true);
      }
      if (values.showNames !== undefined) values.showNames = oldSettings.showNames !== false;
      if (values.showTier !== undefined) values.showTier = oldSettings.showTier !== false;
      if (values.tickerSpeed !== undefined && oldSettings.speed !== undefined) {
        values.tickerSpeed = numberInRange(oldSettings.speed, 4, 200, values.tickerSpeed);
      }
      if (values.speed !== undefined && oldSettings.speed !== undefined) {
        values.speed = numberInRange(oldSettings.speed, 4, 60, values.speed);
      }
      if (values.position !== undefined && typeof oldSettings.position === "string") {
        values.position = oldSettings.position;
      }
      if (values.posX !== undefined && ["left", "right", "center"].includes(oldSettings.position)) {
        values.posX = oldSettings.position;
      }
      if (values.posY !== undefined && ["top", "bottom", "center"].includes(oldSettings.position)) {
        values.posY = oldSettings.position;
      }
    }

    return {
      version: 4,
      projectName: source.projectName,
      mode: active?.mode || "lower_third",
      activeGroupId: active?.groupId || "all",
      activePlaylist,
      images,
      groups,
      playlists: fallbackPlaylists,
      modeGroups,
      modeSettings,
      isVisible: source.isVisible !== false,
      isPaused: source.isPaused === true,
      currentIndex: source.currentIndex || 0,
      settings: {
        autoPlay: oldSettings.autoPlay !== false,
        safeArea: oldSettings.safeArea === true,
        showNames: oldSettings.showNames !== false,
        showTier: oldSettings.showTier !== false,
        opacity: 100
      },
      obs: source.obs,
      command: source.command,
      migration: {
        source: "redesign-v1",
        completedAt: nowIso(),
        alternateRedesignDetected: false,
        redesignMerged: false,
        missingImages: 0
      }
    };
  }

  function normalizeImages(input) {
    const used = new Set();
    const source = Array.isArray(input) ? input : [];
    if (source.length > MAX_SPONSORS) {
      throw new RangeError(`Project has more than ${MAX_SPONSORS} sponsors`);
    }
    return source.map((item, index) => {
      const source = isObject(item) ? item : {};
      const id = uniqueId(source.id, `img_${index + 1}`, used, "img");
      return {
        id,
        name: cleanText(source.name, `Sponsor ${index + 1}`, 120),
        tier: enumValue(source.tier, tiers, "partner"),
        duration: numberInRange(source.duration, 2, 60, 6, true),
        enabled: source.enabled !== false,
        createdAt: cleanText(source.createdAt, nowIso(), 48)
      };
    });
  }

  function normalizeGroups(input, imageIds) {
    const used = new Set();
    const source = Array.isArray(input) && input.length
      ? input
      : [{ id: "all", name: "รวมทั้งหมด", imageIds: [...imageIds] }];
    if (source.length > MAX_GROUPS) {
      throw new RangeError(`Project has more than ${MAX_GROUPS} groups`);
    }
    return source.map((item, index) => {
      const value = isObject(item) ? item : {};
      const id = uniqueId(value.id, `group_${index + 1}`, used, "group");
      const ids = Array.isArray(value.imageIds)
        ? value.imageIds
        : Array.isArray(value.sponsorIds)
          ? value.sponsorIds
          : [];
      return {
        id,
        name: cleanText(value.name, `กลุ่ม ${index + 1}`, 120),
        imageIds: Array.from(new Set(ids.map(String).filter((imageId) => imageIds.has(imageId))))
      };
    });
  }

  function normalizePlaylists(input, groups, imageIds, fallbackGroupId) {
    const used = new Set();
    const groupIds = new Set(groups.map((group) => group.id));
    const source = Array.isArray(input) && input.length ? input : defaultPlaylists(fallbackGroupId);
    if (source.length > MAX_PLAYLISTS) {
      throw new RangeError(`Project has more than ${MAX_PLAYLISTS} playlists`);
    }
    return source.map((item, index) => {
      const value = isObject(item) ? item : {};
      const id = uniqueId(value.id, `pl_${index + 1}`, used, "pl");
      const mode = Modes.has(value.mode) ? value.mode : Modes.mapRedesignMode(value.mode);
      const groupId = groupIds.has(value.groupId) ? value.groupId : fallbackGroupId;
      const ids = Array.isArray(value.sponsorIds)
        ? value.sponsorIds.map(String).filter((imageId) => imageIds.has(imageId))
        : [];
      return {
        id,
        name: cleanText(value.name, `Playlist ${index + 1}`, 120),
        mode: Modes.has(mode) ? mode : "lower_third",
        groupId,
        defaultDuration: numberInRange(value.defaultDuration, 2, 60, 6, true),
        sponsorIds: Array.from(new Set(ids))
      };
    });
  }

  function mergeState(input) {
    let source = isObject(input) ? input : {};
    if ((!Array.isArray(source.images) || !source.groups) && Array.isArray(source.sponsors)) {
      source = redesignRawToUnified(source);
    }

    const base = defaultState();
    const images = normalizeImages(source.images);
    const imageIds = new Set(images.map((image) => image.id));
    const groups = normalizeGroups(source.groups, imageIds);
    const groupIds = new Set(groups.map((group) => group.id));
    const activeGroupId = groupIds.has(source.activeGroupId) ? source.activeGroupId : groups[0].id;
    const playlists = normalizePlaylists(source.playlists, groups, imageIds, activeGroupId);
    const playlistIds = new Set(playlists.map((playlist) => playlist.id));
    const activePlaylist = playlistIds.has(source.activePlaylist) ? source.activePlaylist : playlists[0].id;
    const sourceSettings = isObject(source.settings) ? source.settings : {};
    const sourceObs = isObject(source.obs) ? source.obs : {};
    const sourceCommand = isObject(source.command) ? source.command : {};
    const sourceMigration = isObject(source.migration) ? source.migration : {};

    const mode = Modes.has(source.mode)
      ? source.mode
      : Modes.has(source.settings?.skin)
        ? source.settings.skin
        : playlists.find((playlist) => playlist.id === activePlaylist)?.mode || "grid";
    const modeGroups = {};
    const suppliedModeGroups = isObject(source.modeGroups) ? source.modeGroups : {};
    for (const modeId of Modes.ids) {
      modeGroups[modeId] = groupIds.has(suppliedModeGroups[modeId])
        ? suppliedModeGroups[modeId]
        : activeGroupId;
    }

    return {
      version: 4,
      stateEpoch: numberInRange(source.stateEpoch, 0, Number.MAX_SAFE_INTEGER, 0, true),
      revision: numberInRange(source.revision, 0, Number.MAX_SAFE_INTEGER, 0, true),
      updatedAt: cleanText(source.updatedAt, nowIso(), 48),
      projectName: cleanText(source.projectName, base.projectName, 120),
      mode,
      activeGroupId,
      activePlaylist,
      images,
      groups,
      playlists,
      modeGroups,
      modeSettings: normalizeModeSettings(source.modeSettings, source),
      isVisible: source.isVisible !== false,
      isPaused: source.isPaused === true,
      currentIndex: numberInRange(source.currentIndex, 0, Number.MAX_SAFE_INTEGER, 0, true),
      settings: {
        autoPlay: sourceSettings.autoPlay !== false,
        safeArea: sourceSettings.safeArea === true,
        showNames: sourceSettings.showNames !== false,
        showTier: sourceSettings.showTier !== false,
        opacity: numberInRange(sourceSettings.opacity, 0, 100, base.settings.opacity, true)
      },
      obs: {
        host: cleanText(sourceObs.host, base.obs.host, 255),
        port: numberInRange(sourceObs.port, 1, 65535, base.obs.port, true),
        sourceName: cleanText(sourceObs.sourceName, base.obs.sourceName, 160),
        width: numberInRange(sourceObs.width, 320, 7680, base.obs.width, true),
        height: numberInRange(sourceObs.height, 180, 4320, base.obs.height, true)
      },
      command: {
        id: cleanText(sourceCommand.id, uid("cmd"), 120),
        type: enumValue(sourceCommand.type, commandTypes, "init"),
        ts: numberInRange(sourceCommand.ts, 0, Number.MAX_SAFE_INTEGER, Date.now(), true),
        payload: isObject(sourceCommand.payload) ? clone(sourceCommand.payload) : {}
      },
      migration: {
        source: cleanText(sourceMigration.source, source.version ? `v${source.version}` : "upstream-v2", 80),
        completedAt: cleanText(sourceMigration.completedAt, "", 48),
        alternateRedesignDetected: sourceMigration.alternateRedesignDetected === true,
        redesignMerged: sourceMigration.redesignMerged === true,
        missingImages: numberInRange(sourceMigration.missingImages, 0, MAX_SPONSORS, 0, true)
      }
    };
  }

  function readJson(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.warn(`Failed to read ${key}`, error);
      return null;
    }
  }

  function hasStoredState() {
    return localStorage.getItem(STORAGE_KEY) !== null;
  }

  function loadState() {
    const raw = readJson(STORAGE_KEY);
    return raw ? mergeState(raw) : defaultState();
  }

  async function loadStateAuthoritative() {
    try {
      const record = await dbGetStateRecord();
      if (!record?.state) return loadState();
      const state = mergeState(record.state);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (error) {
        console.warn("Could not refresh the localStorage state mirror", error);
      }
      return state;
    } catch (error) {
      console.warn("Could not read the authoritative IndexedDB state", error);
      return loadState();
    }
  }

  function broadcast(message) {
    const payload = isObject(message)
      ? { ...message, sourceId: message.sourceId || INSTANCE_ID }
      : { type: "state", state: loadState(), sourceId: INSTANCE_ID };
    if (payload.state && !payload.type) payload.type = "state";
    try {
      if (!outboundChannel) outboundChannel = new BroadcastChannel(CHANNEL_NAME);
      outboundChannel.postMessage(payload);
    } catch (error) {
      window.dispatchEvent(new CustomEvent(CHANNEL_NAME, { detail: payload }));
    }
  }

  function valuesEqual(left, right) {
    if (left === right) return true;
    if (left === undefined || right === undefined) return false;
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function mergeIdList(base, desired, latest) {
    if (valuesEqual(desired, base)) return clone(latest);
    if (valuesEqual(latest, base)) return clone(desired);

    const baseSet = new Set(base.map(String));
    const desiredSet = new Set(desired.map(String));
    const latestSet = new Set(latest.map(String));
    const keep = new Set();

    for (const id of baseSet) {
      if (desiredSet.has(id) && latestSet.has(id)) keep.add(id);
    }
    for (const id of desiredSet) {
      if (!baseSet.has(id)) keep.add(id);
    }
    for (const id of latestSet) {
      if (!baseSet.has(id)) keep.add(id);
    }

    const output = [];
    for (const rawId of [...desired, ...latest]) {
      const id = String(rawId);
      if (!keep.has(id) || output.includes(id)) continue;
      output.push(id);
    }
    return output;
  }

  function mergeEntityList(base, desired, latest, path) {
    const mapById = (items) => new Map(
      items
        .filter((item) => isObject(item) && item.id !== undefined)
        .map((item) => [String(item.id), item])
    );
    const baseMap = mapById(base);
    const desiredMap = mapById(desired);
    const latestMap = mapById(latest);
    const order = Array.from(new Set([
      ...desired.map((item) => String(item?.id ?? "")),
      ...latest.map((item) => String(item?.id ?? ""))
    ].filter(Boolean)));
    const output = [];

    for (const id of order) {
      const baseItem = baseMap.get(id);
      const desiredItem = desiredMap.get(id);
      const latestItem = latestMap.get(id);

      if (baseItem) {
        if (!desiredItem || !latestItem) continue;
        output.push(mergeConcurrentValue(baseItem, desiredItem, latestItem, `${path}.${id}`));
        continue;
      }
      if (desiredItem && latestItem) {
        output.push(mergeConcurrentValue({}, desiredItem, latestItem, `${path}.${id}`));
      } else if (desiredItem) {
        output.push(clone(desiredItem));
      } else if (latestItem) {
        output.push(clone(latestItem));
      }
    }

    return output;
  }

  function mergeConcurrentValue(base, desired, latest, path = "") {
    if (valuesEqual(desired, base)) return clone(latest);
    if (valuesEqual(latest, base)) return clone(desired);

    if (Array.isArray(base) && Array.isArray(desired) && Array.isArray(latest)) {
      const key = path.split(".").pop();
      if (["images", "groups", "playlists"].includes(key)) {
        return mergeEntityList(base, desired, latest, path);
      }
      if (["imageIds", "sponsorIds"].includes(key)) {
        return mergeIdList(base, desired, latest);
      }
      return clone(desired);
    }

    if (isObject(base) && isObject(desired) && isObject(latest)) {
      const output = {};
      const keys = new Set([
        ...Object.keys(base),
        ...Object.keys(desired),
        ...Object.keys(latest)
      ]);
      for (const key of keys) {
        if (key === "stateEpoch" || key === "revision" || key === "updatedAt") continue;
        const baseHas = Object.hasOwn(base, key);
        const desiredHas = Object.hasOwn(desired, key);
        const latestHas = Object.hasOwn(latest, key);
        if (baseHas && (!desiredHas || !latestHas)) continue;
        if (!baseHas) {
          if (desiredHas && latestHas) {
            output[key] = mergeConcurrentValue({}, desired[key], latest[key], path ? `${path}.${key}` : key);
          } else if (desiredHas) {
            output[key] = clone(desired[key]);
          } else if (latestHas) {
            output[key] = clone(latest[key]);
          }
          continue;
        }
        output[key] = mergeConcurrentValue(
          base[key],
          desired[key],
          latest[key],
          path ? `${path}.${key}` : key
        );
      }
      return output;
    }

    return clone(desired);
  }

  function mergeConcurrentState(baseInput, desiredInput, latestInput) {
    const base = mergeState(baseInput);
    const desired = mergeState(desiredInput);
    const latest = mergeState(latestInput);
    const merged = mergeConcurrentValue(base, desired, latest);
    merged.stateEpoch = latest.stateEpoch;
    merged.revision = latest.revision;
    merged.updatedAt = latest.updatedAt;
    return mergeState(merged);
  }

  function withStateLock(callback) {
    if (navigator.locks?.request) {
      return navigator.locks.request(STATE_LOCK_NAME, { mode: "exclusive" }, callback);
    }
    return Promise.resolve().then(callback);
  }

  function saveStateLocked(input, options = {}) {
    const desired = mergeState(input);
    const base = options.base ? mergeState(options.base) : null;
    return withStateLock(async () => {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STATE_STORE, "readwrite");
        const store = tx.objectStore(STATE_STORE);
        const request = store.get(STATE_RECORD_ID);
        let failure = null;
        let latest = null;
        let saved = null;

        request.onsuccess = () => {
          try {
            latest = request.result?.state
              ? mergeState(request.result.state)
              : loadState();
            if (
              options.replace !== true
              && base
              && Number(base.stateEpoch) !== Number(latest.stateEpoch)
            ) {
              const error = new Error("Project was replaced in another tab; reload before saving this change");
              error.code = "STATE_EPOCH_CONFLICT";
              throw error;
            }
            const next = options.replace === true
              ? desired
              : base
                ? mergeConcurrentState(base, desired, latest)
                : desired;
            next.stateEpoch = options.replace === true
              ? Math.min(Number.MAX_SAFE_INTEGER, Number(latest.stateEpoch) + 1)
              : latest.stateEpoch;
            next.revision = Number(latest.revision) + 1;
            next.updatedAt = nowIso();
            saved = mergeState(next);
            store.put({
              id: STATE_RECORD_ID,
              state: saved,
              updatedAt: saved.updatedAt
            });
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
        request.onerror = () => {
          failure = request.error;
        };
        tx.oncomplete = () => {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
          } catch (error) {
            console.warn("State was committed to IndexedDB but could not be mirrored to localStorage", error);
          }
          if (!options.silent) broadcast({ type: "state", state: saved });
          resolve(options.returnPrevious === true
            ? { state: saved, previous: latest }
            : saved);
        };
        tx.onerror = () => reject(failure || tx.error || new Error("State save failed"));
        tx.onabort = () => reject(failure || tx.error || new Error("State save was aborted"));
      });
    });
  }

  async function resetState() {
    localStorage.removeItem(STORAGE_KEY);
    await dbDeleteStateRecord();
  }

  function subscribe(callback) {
    let channel = null;
    let disposed = false;
    const customHandler = (event) => callback(event.detail);
    const storageHandler = (event) => {
      if (event.key !== STORAGE_KEY) return;
      try {
        callback({
          type: "state",
          state: event.newValue ? mergeState(JSON.parse(event.newValue)) : defaultState()
        });
      } catch (error) {
        console.warn("Ignored invalid Sponsor Dock storage update", error);
      }
    };

    const openChannel = () => {
      if (disposed || channel) return;
      try {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = (event) => callback(event.data);
      } catch (error) {
        window.addEventListener(CHANNEL_NAME, customHandler);
      }
    };
    const closeChannel = () => {
      channel?.close();
      channel = null;
      window.removeEventListener(CHANNEL_NAME, customHandler);
    };
    const pageHideHandler = () => closeChannel();
    const pageShowHandler = (event) => {
      if (event.persisted) openChannel();
    };

    openChannel();
    window.addEventListener("storage", storageHandler);
    window.addEventListener("pagehide", pageHideHandler);
    window.addEventListener("pageshow", pageShowHandler);

    return () => {
      disposed = true;
      closeChannel();
      window.removeEventListener("storage", storageHandler);
      window.removeEventListener("pagehide", pageHideHandler);
      window.removeEventListener("pageshow", pageShowHandler);
    };
  }

  function openDatabase(name, legacy = false) {
    const promiseName = legacy ? "legacy" : "current";
    if (legacy ? legacyDbPromise : dbPromise) return legacy ? legacyDbPromise : dbPromise;
    const promise = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, legacy ? LEGACY_DB_VERSION : DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(IMAGE_STORE)) {
          request.result.createObjectStore(IMAGE_STORE, { keyPath: "id" });
        }
        if (!legacy && !request.result.objectStoreNames.contains(STATE_STORE)) {
          request.result.createObjectStore(STATE_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        if (legacy) legacyDb = request.result;
        else currentDb = request.result;
        request.result.onversionchange = () => {
          request.result.close();
          if (legacy) {
            legacyDb = null;
            legacyDbPromise = null;
          } else {
            currentDb = null;
            dbPromise = null;
          }
        };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error || new Error(`Cannot open ${promiseName} image database`));
      request.onblocked = () => reject(new Error(`${promiseName} image database is blocked`));
    }).catch((error) => {
      if (legacy) legacyDbPromise = null;
      else dbPromise = null;
      throw error;
    });
    if (legacy) legacyDbPromise = promise;
    else dbPromise = promise;
    return promise;
  }

  function openDb() {
    return openDatabase(DB_NAME, false);
  }

  function openLegacyDb() {
    return openDatabase(LEGACY_DB_NAME, true);
  }

  async function dbGetStateRecord() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STATE_STORE, "readonly");
      const request = tx.objectStore(STATE_STORE).get(STATE_RECORD_ID);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbDeleteStateRecord() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STATE_STORE, "readwrite");
      tx.objectStore(STATE_STORE).delete(STATE_RECORD_ID);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("State reset was aborted"));
    });
  }

  function revokeImageUrl(id) {
    const url = imageUrlCache.get(id);
    if (!url) return;
    URL.revokeObjectURL(url);
    imageUrlCache.delete(id);
  }

  function revokeAllImageUrls() {
    for (const url of imageUrlCache.values()) URL.revokeObjectURL(url);
    imageUrlCache.clear();
  }

  async function dbPutImage(id, fileOrBlob, meta = {}) {
    if (!(fileOrBlob instanceof Blob)) throw new TypeError("Image must be a Blob or File");
    if (fileOrBlob.size > MAX_IMAGE_BYTES) throw new RangeError("Image exceeds the 12 MB limit");
    const type = meta.type || fileOrBlob.type || "image/png";
    if (!imageTypes.includes(type)) throw new TypeError("Unsupported image type");
    const db = await openDb();
    revokeImageUrl(id);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, "readwrite");
      tx.objectStore(IMAGE_STORE).put({
        id,
        blob: fileOrBlob,
        name: meta.name || fileOrBlob.name || `${id}.png`,
        type,
        updatedAt: nowIso()
      });
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Image save was aborted"));
    });
  }

  async function getRecordFromDb(db, id) {
    if (!id) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, "readonly");
      const request = tx.objectStore(IMAGE_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbGetImageRecord(id) {
    return getRecordFromDb(await openDb(), id);
  }

  async function dbGetImageUrl(id) {
    if (!id) return "";
    if (imageUrlCache.has(id)) return imageUrlCache.get(id);
    const record = await dbGetImageRecord(id);
    if (!record?.blob) return "";
    const url = URL.createObjectURL(record.blob);
    imageUrlCache.set(id, url);
    return url;
  }

  async function dbDeleteImage(id) {
    const db = await openDb();
    revokeImageUrl(id);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, "readwrite");
      tx.objectStore(IMAGE_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Image delete was aborted"));
    });
  }

  async function dbClearImages() {
    const db = await openDb();
    revokeAllImageUrls();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, "readwrite");
      tx.objectStore(IMAGE_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Image clear was aborted"));
    });
  }

  async function copyRedesignImages(raw, convertedRaw) {
    const sponsors = Array.isArray(raw.sponsors) ? raw.sponsors : [];
    if (!sponsors.length) return { state: mergeState(convertedRaw), missing: 0 };

    const legacyDb = await openLegacyDb();
    const staged = [];
    let missing = 0;
    try {
      for (const sponsor of sponsors) {
        const target = convertedRaw.images.find((image) => image.id === sponsor.__targetId);
        if (!target) continue;
        const record = await getRecordFromDb(legacyDb, sponsor.imageKey || sponsor.id);
        if (!record?.blob) {
          missing++;
          continue;
        }
        await dbPutImage(target.id, record.blob, {
          name: record.name || target.name,
          type: record.type || record.blob.type
        });
        staged.push(target.id);
      }
      convertedRaw.migration.missingImages = missing;
      return { state: mergeState(convertedRaw), missing };
    } catch (error) {
      await Promise.allSettled(staged.map((id) => dbDeleteImage(id)));
      throw error;
    }
  }

  function prepareRedesignMigration(redesignRaw) {
    const idMap = new Map();
    const decorated = clone(redesignRaw);
    decorated.sponsors = (Array.isArray(decorated.sponsors) ? decorated.sponsors : [])
      .map((sponsor, index) => {
        const sourceId = String(sponsor.id || `legacy_${index + 1}`);
        const targetId = uid("img");
        idMap.set(sourceId, targetId);
        return { ...sponsor, __targetId: targetId };
      });
    return {
      decorated,
      convertedRaw: redesignRawToUnified(decorated, idMap)
    };
  }

  async function mergeRedesignProject() {
    const redesignRaw = readJson(REDESIGN_STORAGE_KEY);
    if (!redesignRaw || !Array.isArray(redesignRaw.sponsors)) {
      throw new Error("ไม่พบข้อมูล redesign เดิมใน browser profile นี้");
    }

    const { decorated, convertedRaw } = prepareRedesignMigration(redesignRaw);
    const { state: redesignState, missing } = await copyRedesignImages(decorated, convertedRaw);
    const copiedImageIds = redesignState.images.map((image) => image.id);

    try {
      const current = await loadStateAuthoritative();
      const groupIdMap = new Map();
      const importedGroups = redesignState.groups.map((group) => {
        const id = uid("group");
        groupIdMap.set(group.id, id);
        return {
          ...group,
          id,
          name: `Redesign · ${group.name}`.slice(0, 120)
        };
      });
      const importedPlaylists = redesignState.playlists.map((playlist) => ({
        ...playlist,
        id: uid("pl"),
        name: `Redesign · ${playlist.name}`.slice(0, 120),
        groupId: groupIdMap.get(playlist.groupId) || importedGroups[0]?.id || current.activeGroupId
      }));
      const merged = mergeState({
        ...current,
        images: [...current.images, ...redesignState.images],
        groups: [...current.groups, ...importedGroups],
        playlists: [...current.playlists, ...importedPlaylists],
        migration: {
          ...current.migration,
          source: "upstream-v2+redesign-v1",
          completedAt: nowIso(),
          alternateRedesignDetected: false,
          redesignMerged: true,
          missingImages: Number(current.migration.missingImages || 0) + missing
        }
      });
      const saved = await saveStateLocked(merged, { base: current });
      initializePromise = Promise.resolve(saved);
      return saved;
    } catch (error) {
      await Promise.allSettled(copiedImageIds.map((id) => dbDeleteImage(id)));
      throw error;
    }
  }

  async function initialize() {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      const authoritativeRecord = await dbGetStateRecord();
      const upstreamRaw = authoritativeRecord?.state || readJson(STORAGE_KEY);
      const redesignRaw = readJson(REDESIGN_STORAGE_KEY);

      if (upstreamRaw) {
        const baseState = mergeState(upstreamRaw);
        if (authoritativeRecord?.state) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(baseState));
          } catch (error) {
            console.warn("Could not refresh the localStorage state mirror", error);
          }
        }
        const state = clone(baseState);
        const alternateRedesignDetected = !!redesignRaw && state.migration.redesignMerged !== true;
        const needsSave = state.version !== upstreamRaw.version
          || state.migration.alternateRedesignDetected !== alternateRedesignDetected;
        state.migration.alternateRedesignDetected = alternateRedesignDetected;
        if (needsSave) {
          return saveStateLocked(state, { base: baseState, silent: true });
        }
        return baseState;
      }

      if (redesignRaw && Array.isArray(redesignRaw.sponsors)) {
        const { decorated, convertedRaw } = prepareRedesignMigration(redesignRaw);
        const { state } = await copyRedesignImages(decorated, convertedRaw);
        try {
          return await saveStateLocked(state, { replace: true, silent: true });
        } catch (error) {
          await Promise.allSettled(state.images.map((image) => dbDeleteImage(image.id)));
          throw error;
        }
      }

      return defaultState();
    })().catch((error) => {
      initializePromise = null;
      throw error;
    });
    return initializePromise;
  }

  function getGroup(state, id = state.activeGroupId) {
    return state.groups.find((group) => group.id === id) || state.groups[0] || null;
  }

  function getGroupSponsors(state, groupOrId = state.activeGroupId) {
    const group = typeof groupOrId === "string" ? getGroup(state, groupOrId) : groupOrId;
    if (!group) return [];
    const byId = new Map(state.images.map((image) => [image.id, image]));
    return (group.imageIds || [])
      .map((id) => byId.get(id))
      .filter((image) => image && image.enabled !== false);
  }

  function getActivePlaylist(state) {
    return state.playlists.find((playlist) => playlist.id === state.activePlaylist)
      || state.playlists[0]
      || null;
  }

  function getPlaylistSponsors(state, playlistOrId = state.activePlaylist) {
    const playlist = typeof playlistOrId === "string"
      ? state.playlists.find((item) => item.id === playlistOrId)
      : playlistOrId;
    if (!playlist) return [];
    const ids = playlist.sponsorIds?.length
      ? playlist.sponsorIds
      : getGroup(state, playlist.groupId)?.imageIds || [];
    const byId = new Map(state.images.map((image) => [image.id, image]));
    return ids
      .map((id) => byId.get(id))
      .filter((image) => image && image.enabled !== false);
  }

  function getModeSetting(state, mode, key) {
    return state.modeSettings?.[mode]?.[key] ?? Modes.defaultsFor(mode)[key];
  }

  function setModeSetting(state, mode, key, value) {
    state.modeSettings = state.modeSettings || {};
    state.modeSettings[mode] = state.modeSettings[mode] || Modes.defaultsFor(mode);
    state.modeSettings[mode][key] = value;
    return mergeState(state);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      throw new TypeError("Invalid image data");
    }
    const [header, base64] = dataUrl.split(",");
    const match = header.match(/^data:(image\/(?:png|jpeg|webp|svg\+xml));base64$/);
    if (!match || !base64) throw new TypeError("Unsupported image data");
    const binary = atob(base64);
    if (binary.length > MAX_IMAGE_BYTES) throw new RangeError("Image exceeds the 12 MB limit");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: match[1] });
  }

  function svgDataUrl(svg) {
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  }

  async function seedSamples(options = {}) {
    if (!options.force) {
      const existing = await dbGetStateRecord();
      if (existing?.state) return mergeState(existing.state);
      if (hasStoredState()) return loadState();
    }
    const state = defaultState();
    const staged = [];
    const samples = [
      { name: "PEPS MAIN", tier: "main", colors: ["#ff7a18", "#ffb347"] },
      { name: "LIVE PARTNER", tier: "gold", colors: ["#36e0ff", "#76f7ff"] },
      { name: "SPORT MEDIA", tier: "silver", colors: ["#f8fafc", "#cbd5e1"] },
      { name: "LOCAL SUPPORT", tier: "partner", colors: ["#39e58c", "#b6ffcf"] }
    ];

    try {
      for (const item of samples) {
        const id = uid("img");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="260" viewBox="0 0 640 260">
          <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${item.colors[0]}"/><stop offset="1" stop-color="${item.colors[1]}"/>
          </linearGradient></defs>
          <rect width="640" height="260" rx="54" fill="#10131c"/>
          <rect x="18" y="18" width="604" height="224" rx="42" fill="url(#g)" opacity=".94"/>
          <circle cx="104" cy="130" r="56" fill="#10131c" opacity=".9"/>
          <path d="M78 134h52l-21 44 75-66h-54l22-42z" fill="${item.colors[1]}"/>
          <text x="200" y="120" font-family="Arial, sans-serif" font-size="44" font-weight="900" fill="#11131c">${item.name}</text>
          <text x="202" y="166" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#11131c" opacity=".7">SPONSOR LOGO SAMPLE</text>
        </svg>`;
        const blob = dataUrlToBlob(svgDataUrl(svg));
        await dbPutImage(id, blob, { name: `${item.name}.svg`, type: "image/svg+xml" });
        staged.push(id);
        state.images.push({
          id,
          name: item.name,
          tier: item.tier,
          duration: item.tier === "main" ? 8 : 6,
          enabled: true,
          createdAt: nowIso()
        });
      }

      const ids = state.images.map((image) => image.id);
      state.groups[0].imageIds = [...ids];
      state.playlists = state.playlists.map((playlist) => ({ ...playlist, sponsorIds: [...ids] }));
      const result = await saveStateLocked(state, {
        replace: options.force === true,
        silent: false,
        returnPrevious: true
      });
      const saved = result.state;
      const previousIds = result.previous.images.map((image) => image.id);
      await Promise.allSettled(
        previousIds.filter((id) => !staged.includes(id)).map((id) => dbDeleteImage(id))
      );
      return saved;
    } catch (error) {
      await Promise.allSettled(staged.map((id) => dbDeleteImage(id)));
      throw error;
    }
  }

  window.addEventListener("pagehide", () => {
    revokeAllImageUrls();
    outboundChannel?.close();
    outboundChannel = null;
    currentDb?.close();
    legacyDb?.close();
    currentDb = null;
    legacyDb = null;
    dbPromise = null;
    legacyDbPromise = null;
  });

  window.PepsSponsor = {
    STORAGE_KEY,
    REDESIGN_STORAGE_KEY,
    CHANNEL_NAME,
    STATE_LOCK_NAME,
    INSTANCE_ID,
    DB_NAME,
    MAX_IMAGE_BYTES,
    MAX_PROJECT_BYTES,
    tierLabels,
    imageTypes,
    shadowValues,
    uid,
    nowIso,
    clone,
    defaultState,
    mergeState,
    redesignRawToUnified,
    mergeRedesignProject,
    initialize,
    hasStoredState,
    loadState,
    loadStateAuthoritative,
    saveState: saveStateLocked,
    saveStateLocked,
    mergeConcurrentState,
    withStateLock,
    resetState,
    broadcast,
    subscribe,
    getGroup,
    getGroupSponsors,
    getActivePlaylist,
    getPlaylistSponsors,
    getModeSetting,
    setModeSetting,
    dbPutImage,
    dbGetImageRecord,
    dbGetImageUrl,
    dbDeleteImage,
    dbClearImages,
    blobToDataUrl,
    dataUrlToBlob,
    seedSamples
  };
})();
