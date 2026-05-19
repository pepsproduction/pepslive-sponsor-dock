(() => {
  const STORAGE_KEY = "pepslive_sponsor_dock_state_v1";
  const DB_NAME = "PepsLiveSponsorDockDB";
  const DB_VERSION = 1;
  const IMAGE_STORE = "images";
  const CHANNEL_NAME = "pepslive_sponsor_channel_v1";

  const tierLabels = {
    main: "Main Sponsor",
    gold: "Gold Sponsor",
    silver: "Silver Sponsor",
    partner: "Partner"
  };

  const skinLabels = {
    bottom_bar: "Bottom Sponsor Bar",
    corner_badge: "Corner Badge",
    side_tower: "Side Tower",
    ticker: "Ticker Run",
    grid: "Grid Board",
    fullscreen_break: "Fullscreen Break",
    goal_popup: "Goal Popup"
  };

  function uid(prefix = "id") {
    if (crypto && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultState() {
    return {
      version: 1,
      updatedAt: nowIso(),
      projectName: "PepsLive Match Sponsor",
      activePlaylist: "pl_live",
      isVisible: true,
      isPaused: false,
      currentIndex: 0,
      obs: {
        host: "127.0.0.1",
        port: 4455,
        password: "",
        sourceName: "PEPS_SPONSOR_DISPLAY",
        width: 1920,
        height: 1080
      },
      settings: {
        skin: "bottom_bar",
        position: "bottom",
        logoSize: 112,
        gap: 22,
        speed: 18,
        radius: 22,
        opacity: 72,
        shadow: "soft",
        autoPlay: true,
        safeArea: false,
        showNames: true,
        showTier: true
      },
      sponsors: [],
      playlists: [
        {
          id: "pl_live",
          name: "ระหว่างแข่งขัน",
          mode: "bottom_bar",
          defaultDuration: 6,
          sponsorIds: []
        },
        {
          id: "pl_halftime",
          name: "พักครึ่ง / Sponsor Break",
          mode: "fullscreen_break",
          defaultDuration: 10,
          sponsorIds: []
        },
        {
          id: "pl_goal",
          name: "Goal Sponsor Popup",
          mode: "goal_popup",
          defaultDuration: 5,
          sponsorIds: []
        }
      ],
      command: {
        type: "init",
        ts: Date.now(),
        payload: {}
      }
    };
  }

  function mergeState(input) {
    const base = defaultState();
    const state = Object.assign(base, input || {});
    state.obs = Object.assign(base.obs, input?.obs || {});
    state.settings = Object.assign(base.settings, input?.settings || {});
    state.sponsors = Array.isArray(input?.sponsors) ? input.sponsors : [];
    state.playlists = Array.isArray(input?.playlists) && input.playlists.length ? input.playlists : base.playlists;
    if (!state.activePlaylist || !state.playlists.some((p) => p.id === state.activePlaylist)) {
      state.activePlaylist = state.playlists[0]?.id || "pl_live";
    }
    state.updatedAt = state.updatedAt || nowIso();
    return state;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? mergeState(JSON.parse(raw)) : defaultState();
    } catch (error) {
      console.warn("Failed to load sponsor state", error);
      return defaultState();
    }
  }

  function saveState(state, options = {}) {
    const next = mergeState(state);
    next.updatedAt = nowIso();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (!options.silent) broadcast({ type: "state", state: next });
    return next;
  }

  function resetState() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function getActivePlaylist(state) {
    return state.playlists.find((p) => p.id === state.activePlaylist) || state.playlists[0] || null;
  }

  function getPlaylistSponsors(state, playlist = null) {
    const pl = playlist || getActivePlaylist(state);
    if (!pl) return [];
    const byId = new Map(state.sponsors.map((s) => [s.id, s]));
    return (pl.sponsorIds || [])
      .map((id) => byId.get(id))
      .filter((s) => s && s.enabled !== false);
  }

  function applyCssVars(state, target = document.documentElement) {
    const s = state.settings || {};
    target.style.setProperty("--logo-size", `${s.logoSize || 112}px`);
    target.style.setProperty("--sponsor-gap", `${s.gap || 22}px`);
    target.style.setProperty("--panel-opacity", `${Math.max(0, Math.min(1, (s.opacity ?? 72) / 100))}`);
    target.style.setProperty("--sponsor-radius", `${s.radius || 22}px`);
    target.style.setProperty("--ticker-speed", `${s.speed || 18}s`);
  }

  function broadcast(message) {
    try {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(message);
      channel.close();
    } catch (error) {
      window.dispatchEvent(new CustomEvent(CHANNEL_NAME, { detail: message }));
    }
  }

  function subscribe(callback) {
    let channel = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => callback(event.data);
    } catch (error) {
      window.addEventListener(CHANNEL_NAME, (event) => callback(event.detail));
    }
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          callback({ type: "state", state: mergeState(JSON.parse(event.newValue)) });
        } catch (err) {
          console.warn(err);
        }
      }
    });
    return () => {
      if (channel) channel.close();
    };
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IMAGE_STORE)) {
          db.createObjectStore(IMAGE_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbPutImage(id, fileOrBlob, meta = {}) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, "readwrite");
      tx.objectStore(IMAGE_STORE).put({
        id,
        blob: fileOrBlob,
        name: meta.name || fileOrBlob.name || `${id}.png`,
        type: meta.type || fileOrBlob.type || "image/png",
        updatedAt: nowIso()
      });
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbGetImageRecord(id) {
    if (!id) return null;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, "readonly");
      const request = tx.objectStore(IMAGE_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbGetImageUrl(id) {
    const rec = await dbGetImageRecord(id);
    if (!rec || !rec.blob) return "";
    return URL.createObjectURL(rec.blob);
  }

  async function dbDeleteImage(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, "readwrite");
      tx.objectStore(IMAGE_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbClearImages() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, "readwrite");
      tx.objectStore(IMAGE_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
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
    const [header, base64] = dataUrl.split(",");
    const match = header.match(/data:(.*?);base64/);
    const type = match ? match[1] : "image/png";
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  function svgDataUrl(svg) {
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  }

  async function seedSamplesIfEmpty() {
    const state = loadState();
    if (state.sponsors.length) return state;

    const samples = [
      { name: "PEPS MAIN", tier: "main", colors: ["#ff7a18", "#ffb347"] },
      { name: "LIVE PARTNER", tier: "gold", colors: ["#36e0ff", "#76f7ff"] },
      { name: "SPORT MEDIA", tier: "silver", colors: ["#f8fafc", "#cbd5e1"] },
      { name: "LOCAL SUPPORT", tier: "partner", colors: ["#39e58c", "#b6ffcf"] }
    ];

    const sponsors = [];
    for (const item of samples) {
      const id = uid("sp");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="260" viewBox="0 0 640 260">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${item.colors[0]}"/>
            <stop offset="1" stop-color="${item.colors[1]}"/>
          </linearGradient>
        </defs>
        <rect width="640" height="260" rx="54" fill="#10131c"/>
        <rect x="18" y="18" width="604" height="224" rx="42" fill="url(#g)" opacity=".94"/>
        <circle cx="104" cy="130" r="56" fill="#10131c" opacity=".9"/>
        <path d="M78 134h52l-21 44 75-66h-54l22-42z" fill="${item.colors[1]}"/>
        <text x="200" y="120" font-family="Arial, sans-serif" font-size="44" font-weight="900" fill="#11131c">${item.name}</text>
        <text x="202" y="166" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#11131c" opacity=".7">SPONSOR LOGO SAMPLE</text>
      </svg>`;
      const blob = dataUrlToBlob(svgDataUrl(svg));
      await dbPutImage(id, blob, { name: `${item.name}.svg`, type: "image/svg+xml" });
      sponsors.push({
        id,
        imageKey: id,
        name: item.name,
        tier: item.tier,
        duration: item.tier === "main" ? 8 : 6,
        enabled: true,
        createdAt: nowIso()
      });
    }

    state.sponsors = sponsors;
    state.playlists = state.playlists.map((p) => ({
      ...p,
      sponsorIds: sponsors.map((s) => s.id)
    }));
    return saveState(state);
  }

  window.PepsSponsor = {
    STORAGE_KEY,
    CHANNEL_NAME,
    tierLabels,
    skinLabels,
    uid,
    nowIso,
    clone,
    defaultState,
    loadState,
    saveState,
    resetState,
    getActivePlaylist,
    getPlaylistSponsors,
    applyCssVars,
    broadcast,
    subscribe,
    dbPutImage,
    dbGetImageRecord,
    dbGetImageUrl,
    dbDeleteImage,
    dbClearImages,
    blobToDataUrl,
    dataUrlToBlob,
    seedSamplesIfEmpty
  };
})();
