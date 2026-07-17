(() => {
  "use strict";

  const registry = window.PepsSponsorModes;
  const activeRenderers = new WeakMap();
  const STYLE_ID = "peps-sponsor-mode-renderers-css";
  const TIER_LABELS = Object.freeze({
    main: "Main Sponsor",
    gold: "Gold Sponsor",
    silver: "Silver Sponsor",
    partner: "Partner"
  });

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes psmTicker { to { transform: translate3d(-50%, 0, 0); } }
      @keyframes psmRain {
        0% { transform: translate3d(0, -260px, 0) rotate(-5deg); opacity: 0; }
        8% { opacity: 1; }
        100% { transform: translate3d(var(--psm-drift, 0), calc(100vh + 330px), 0) rotate(12deg); opacity: .9; }
      }
      @keyframes psmPulse { 50% { transform: scale(1.12); } }
      @keyframes psmSpin { to { transform: rotate(360deg); } }
      @keyframes psmWiggle { 25% { transform: rotate(-4deg); } 75% { transform: rotate(4deg); } }
      @keyframes psmFloat { 50% { transform: translateY(-22px); } }
      @keyframes psmSwing { 25% { transform: rotate(5deg); } 75% { transform: rotate(-5deg); } }
      @keyframes psmWave { 50% { transform: translateY(calc(var(--psm-wave-height) * -1)); } }
      @keyframes psmOrbit { to { transform: rotate(360deg); } }
      @keyframes psmGridIn {
        from { opacity: 0; transform: translateY(16px) scale(.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes psmModeIn {
        from { opacity: 0; transform: translateY(18px) scale(.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes psmGoalIn {
        0% { opacity: 0; transform: scale(.62) translateY(36px); filter: blur(14px); }
        65% { opacity: 1; transform: scale(1.06) translateY(-4px); filter: blur(0); }
        100% { transform: scale(1) translateY(0); }
      }
      @keyframes psmGoalFlare {
        0% { transform: translateX(-130%) skewX(-22deg); opacity: 0; }
        25% { opacity: .85; }
        70%, 100% { transform: translateX(180%) skewX(-22deg); opacity: 0; }
      }
      .psm-host {
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
        color: #fff;
        font-family: "IBM Plex Sans Thai", "Prompt", system-ui, sans-serif;
        isolation: isolate;
      }
      .psm-host, .psm-host * { box-sizing: border-box; }
      .psm-paused *, .psm-paused::before, .psm-paused::after {
        animation-play-state: paused !important;
      }
      .psm-logo {
        display: block;
        flex: 0 0 auto;
        object-fit: contain;
        user-select: none;
      }
      .psm-classic-row {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: center;
        padding: 20px;
      }
      .psm-grid-motion .psm-logo {
        animation: psmGridIn var(--psm-grid-speed, 1000ms) cubic-bezier(.2, .8, .2, 1) both;
      }
      .psm-rotator {
        position: absolute;
        inset: 0;
        display: flex;
        overflow: hidden;
      }
      .psm-rotator-inner {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .psm-rotator .psm-logo {
        position: absolute;
        max-width: 100%;
        max-height: 100%;
        opacity: 0;
        transition: opacity .5s ease, transform .5s ease, filter .5s ease;
      }
      .psm-rotator .psm-logo.psm-active { position: relative; opacity: 1; }
      .psm-effect-zoom .psm-logo { transform: scale(.5); }
      .psm-effect-zoom .psm-logo.psm-active { transform: scale(1); }
      .psm-effect-slide .psm-logo { transform: translateY(28px); }
      .psm-effect-slide .psm-logo.psm-active { transform: translateY(0); }
      .psm-effect-flip .psm-logo { transform: rotateY(90deg); }
      .psm-effect-flip .psm-logo.psm-active { transform: rotateY(0); }
      .psm-effect-drop .psm-logo { transform: translateY(-110px) scale(1.35); }
      .psm-effect-drop .psm-logo.psm-active { transform: translateY(0) scale(1); }
      .psm-effect-spin-in .psm-logo { transform: rotate(-180deg) scale(.2); }
      .psm-effect-spin-in .psm-logo.psm-active { transform: rotate(0) scale(1); }
      .psm-effect-blur .psm-logo { filter: blur(20px); }
      .psm-effect-blur .psm-logo.psm-active { filter: blur(0) var(--psm-logo-shadow); }
      .psm-ticker {
        position: absolute;
        left: 0;
        width: 100%;
        overflow: hidden;
        white-space: nowrap;
      }
      .psm-ticker-track {
        display: flex;
        align-items: center;
        width: max-content;
        will-change: transform;
        animation: psmTicker var(--psm-ticker-duration, 42s) linear infinite;
      }
      .psm-ticker-group {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: var(--psm-gap, 24px);
        padding-right: var(--psm-gap, 24px);
      }
      .psm-bounce, .psm-rain { position: absolute; inset: 0; overflow: hidden; }
      .psm-bounce .psm-logo { position: absolute; left: 0; top: 0; will-change: transform; }
      .psm-rain-drop {
        position: absolute;
        top: 0;
        will-change: transform, opacity;
        animation: psmRain var(--psm-rain-duration, 4s) linear forwards;
      }
      .psm-cover {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 50px;
        height: 330px;
        display: flex;
        align-items: center;
        justify-content: center;
        perspective: 1000px;
      }
      .psm-cover-card {
        position: absolute;
        transition: transform .58s ease-out, opacity .58s ease-out;
      }
      .psm-anim-pulse .psm-logo { animation: psmPulse var(--psm-anim-speed) ease-in-out infinite; }
      .psm-anim-spin .psm-logo { animation: psmSpin var(--psm-anim-speed) linear infinite; }
      .psm-anim-wiggle .psm-logo { animation: psmWiggle var(--psm-anim-speed) ease-in-out infinite; }
      .psm-anim-float .psm-logo { animation: psmFloat var(--psm-anim-speed) ease-in-out infinite; }
      .psm-anim-swing .psm-logo {
        transform-origin: top center;
        animation: psmSwing var(--psm-anim-speed) ease-in-out infinite;
      }
      .psm-wave .psm-logo {
        animation: psmWave var(--psm-wave-speed) ease-in-out infinite;
        animation-delay: var(--psm-delay, 0ms);
      }
      .psm-orbit {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
      }
      .psm-orbit-ring {
        position: relative;
        width: 1px;
        height: 1px;
        animation: psmOrbit var(--psm-orbit-speed) linear infinite;
      }
      .psm-orbit-ring.psm-left { animation-direction: reverse; }
      .psm-orbit-item {
        position: absolute;
        left: 0;
        top: 0;
        transform-origin: 0 0;
      }
      .psm-orbit-item .psm-logo { transform: translate(-50%, -50%); }
      .psm-spotlight {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
      }
      .psm-spotlight-main .psm-logo {
        width: calc(var(--psm-size) * 1.45) !important;
        max-height: calc(var(--psm-size) * 1.45) !important;
        animation: psmModeIn .38s ease both;
      }
      .psm-spotlight-strip {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 14px;
      }
      .psm-spotlight-strip .psm-logo {
        width: 72px !important;
        height: 46px !important;
        opacity: var(--psm-spot-dim, .25);
        transition: opacity .25s ease, transform .25s ease;
      }
      .psm-spotlight-strip .psm-logo.psm-active { opacity: 1; transform: scale(1.18); }
      .psm-tile {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 12px;
        min-width: 0;
        padding: 10px 14px;
        border: 1px solid rgba(255, 255, 255, .14);
        border-radius: max(12px, var(--psm-radius));
        background:
          linear-gradient(135deg, rgba(255, 93, 0, .13), rgba(0, 198, 255, .06)),
          rgba(7, 11, 17, var(--psm-panel-alpha));
        box-shadow: var(--psm-panel-shadow);
        backdrop-filter: blur(18px);
      }
      .psm-tile.psm-only-logo { justify-content: center; padding: 10px; }
      .psm-tile-copy { min-width: 0; line-height: 1.15; }
      .psm-tile-copy strong {
        display: block;
        max-width: 210px;
        overflow: hidden;
        color: #fff;
        font: 800 16px/1.15 "Prompt", system-ui, sans-serif;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .psm-tile-copy span {
        display: block;
        margin-top: 4px;
        color: #ff9a60;
        font: 700 11px/1 "Chakra Petch", system-ui, sans-serif;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      .psm-lower-third {
        position: absolute;
        left: 50%;
        bottom: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--psm-gap);
        width: min(1840px, calc(100% - 68px));
        transform: translateX(-50%);
        animation: psmModeIn .38s ease both;
      }
      .psm-lower-third.psm-top { top: 34px; bottom: auto; }
      .psm-lower-third.psm-center {
        top: 50%;
        bottom: auto;
        transform: translate(-50%, -50%);
      }
      .psm-corner {
        position: absolute;
        right: 42px;
        bottom: 42px;
        animation: psmModeIn .38s ease both;
      }
      .psm-corner.psm-left { left: 42px; right: auto; }
      .psm-corner.psm-top-left { top: 42px; right: auto; bottom: auto; left: 42px; }
      .psm-corner.psm-top-right { top: 42px; right: 42px; bottom: auto; }
      .psm-corner.psm-top { top: 42px; bottom: auto; }
      .psm-corner.psm-center {
        top: 50%;
        right: auto;
        bottom: auto;
        left: 50%;
        transform: translate(-50%, -50%);
      }
      .psm-side-tower {
        position: absolute;
        top: 50%;
        right: 34px;
        display: flex;
        flex-direction: column;
        gap: var(--psm-gap);
        width: min(340px, calc(100% - 68px));
        transform: translateY(-50%);
        animation: psmModeIn .38s ease both;
      }
      .psm-side-tower.psm-left { left: 34px; right: auto; }
      .psm-side-tower .psm-tile { width: 100%; }
      .psm-side-tower.psm-top, .psm-side-tower.psm-bottom {
        left: 50%;
        right: auto;
        width: min(1840px, calc(100% - 68px));
        flex-direction: row;
        justify-content: center;
        transform: translateX(-50%);
      }
      .psm-side-tower.psm-top { top: 34px; }
      .psm-side-tower.psm-bottom { top: auto; bottom: 34px; }
      .psm-side-tower.psm-top .psm-tile,
      .psm-side-tower.psm-bottom .psm-tile { width: auto; }
      .psm-broadcast-ticker {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 28px;
        overflow: hidden;
        padding: 8px 0;
        border-top: 1px solid rgba(255, 117, 46, .24);
        border-bottom: 1px solid rgba(0, 198, 255, .16);
        background: rgba(5, 8, 13, var(--psm-panel-alpha-soft));
        box-shadow: 0 18px 60px rgba(0, 0, 0, .42);
        backdrop-filter: blur(18px);
      }
      .psm-broadcast-ticker.psm-top { top: 28px; bottom: auto; }
      .psm-broadcast-ticker .psm-tile {
        padding-top: 7px;
        padding-bottom: 7px;
        background: rgba(255, 255, 255, .045);
        box-shadow: none;
        backdrop-filter: none;
      }
      .psm-grid-board, .psm-sponsor-break {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 48px;
        background:
          radial-gradient(circle at 18% 18%, rgba(255, 91, 0, .20), transparent 34%),
          radial-gradient(circle at 82% 76%, rgba(0, 198, 255, .13), transparent 32%);
      }
      .psm-board-card, .psm-break-card {
        width: min(1540px, 92vw);
        max-height: 92vh;
        padding: 42px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, .15);
        border-radius: max(24px, calc(var(--psm-radius) + 10px));
        background:
          linear-gradient(145deg, rgba(255, 255, 255, .09), rgba(255, 255, 255, .025)),
          rgba(5, 9, 15, var(--psm-panel-alpha));
        box-shadow: 0 40px 110px rgba(0, 0, 0, .58), var(--psm-panel-shadow);
        animation: psmModeIn .46s cubic-bezier(.2, .8, .2, 1) both;
        backdrop-filter: blur(26px);
      }
      .psm-board-title, .psm-break-kicker {
        margin: 0 0 22px;
        color: #ff985e;
        font: 800 14px/1 "Chakra Petch", system-ui, sans-serif;
        letter-spacing: .22em;
        text-align: center;
        text-transform: uppercase;
      }
      .psm-board-logos, .psm-break-logos {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: var(--psm-gap);
      }
      .psm-board-logos .psm-tile, .psm-break-logos .psm-tile {
        min-height: 142px;
        justify-content: center;
      }
      .psm-break-card { text-align: center; }
      .psm-break-title {
        margin: 0 0 34px;
        color: #fff;
        font: 900 clamp(40px, 5vw, 76px)/1 "Prompt", system-ui, sans-serif;
        letter-spacing: -.04em;
      }
      .psm-goal {
        position: absolute;
        inset: 0;
        display: grid;
        align-items: center;
        justify-items: center;
        padding: 42px;
      }
      .psm-goal.psm-top { align-items: start; }
      .psm-goal.psm-bottom { align-items: end; }
      .psm-goal.psm-left { justify-items: start; }
      .psm-goal.psm-right { justify-items: end; }
      .psm-goal-card {
        position: relative;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        gap: 28px;
        width: min(820px, 92vw);
        min-height: 230px;
        padding: 30px 42px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, .22);
        border-radius: max(26px, calc(var(--psm-radius) + 12px));
        background:
          linear-gradient(115deg, rgba(255, 89, 0, .28), transparent 45%),
          linear-gradient(145deg, rgba(255, 255, 255, .10), rgba(255, 255, 255, .025)),
          rgba(6, 10, 17, var(--psm-panel-alpha));
        box-shadow: 0 42px 120px rgba(0, 0, 0, .62), 0 0 54px rgba(255, 89, 0, .20);
        animation: psmGoalIn .64s cubic-bezier(.16, 1, .3, 1) both;
        backdrop-filter: blur(24px);
      }
      .psm-goal-flare {
        position: absolute;
        inset: -30% auto -30% -20%;
        width: 34%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .72), transparent);
        animation: psmGoalFlare 1.35s .18s ease-out both;
      }
      .psm-goal-copy { min-width: 0; position: relative; z-index: 1; }
      .psm-goal-copy b {
        display: block;
        color: #fff;
        font: 950 clamp(52px, 7vw, 92px)/.88 "Prompt", system-ui, sans-serif;
        letter-spacing: -.06em;
        text-shadow: 0 8px 30px rgba(255, 75, 0, .35);
      }
      .psm-goal-copy span {
        display: block;
        margin-top: 14px;
        overflow: hidden;
        color: #ffbd97;
        font: 700 clamp(17px, 2vw, 25px)/1.2 "Chakra Petch", system-ui, sans-serif;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (max-width: 900px) {
        .psm-board-logos, .psm-break-logos { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .psm-lower-third { justify-content: flex-start; overflow: hidden; }
      }
    `;
    document.head.appendChild(style);
  }

  function number(value, fallback, min = -Infinity, max = Infinity) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function cleanText(value, fallback = "") {
    const output = typeof value === "string" ? value.trim() : "";
    return (output || fallback).slice(0, 180);
  }

  function cleanUrl(value) {
    const output = typeof value === "string" ? value.trim() : "";
    return output.slice(0, 2 * 1024 * 1024);
  }

  function normalizeIndex(index, length) {
    if (!length) return 0;
    return ((Math.trunc(Number(index) || 0) % length) + length) % length;
  }

  function rotateWindow(items, start, count) {
    if (!items.length || count <= 0) return [];
    const output = [];
    const limit = Math.min(items.length, Math.max(1, Math.trunc(count)));
    for (let offset = 0; offset < limit; offset += 1) {
      output.push(items[normalizeIndex(start + offset, items.length)]);
    }
    return output;
  }

  function createElement(tagName, className = "") {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    return element;
  }

  function resolveMode(rawMode) {
    const requested = String(rawMode || "");
    if (registry?.has(requested)) return requested;
    const mapped = registry?.mapRedesignMode(requested);
    if (registry?.has(mapped)) return mapped;
    return "lower_third";
  }

  function resolveSettings(context, mode) {
    const state = context.state && typeof context.state === "object" ? context.state : {};
    const nested = state.settings && typeof state.settings === "object" ? state.settings : {};
    const supplied = context.settings && typeof context.settings === "object" ? context.settings : {};
    const resolved = {
      ...(registry?.defaultsFor(mode) || {}),
      ...state,
      ...nested,
      ...supplied
    };
    if (Object.hasOwn(resolved, "showNames")) {
      resolved.showNames = nested.showNames !== false && supplied.showNames !== false;
    }
    if (Object.hasOwn(resolved, "showTier")) {
      resolved.showTier = nested.showTier !== false && supplied.showTier !== false;
    }
    return resolved;
  }

  function imageSize(settings) {
    return number(settings.logoSize ?? settings.size, 112, 24, 900);
  }

  function shadowFilter(settings) {
    const value = settings.shadow;
    if (typeof value === "number") {
      return `drop-shadow(0 0 ${Math.round(value * 18)}px rgba(0,0,0,.85))`;
    }
    if (value === "none") return "none";
    if (value === "strong") return "drop-shadow(0 14px 22px rgba(0,0,0,.86))";
    if (value === "neon") {
      return "drop-shadow(0 0 14px rgba(255,88,0,.68)) drop-shadow(0 0 22px rgba(0,198,255,.26))";
    }
    return "drop-shadow(0 10px 15px rgba(0,0,0,.62))";
  }

  function panelShadow(settings) {
    if (settings.shadow === "none" || settings.shadow === 0) return "none";
    if (settings.shadow === "strong") return "0 26px 70px rgba(0,0,0,.66)";
    if (settings.shadow === "neon") {
      return "0 0 28px rgba(255,88,0,.26), 0 18px 56px rgba(0,0,0,.50)";
    }
    return "0 18px 44px rgba(0,0,0,.44)";
  }

  async function resolveEntries(sponsors, context, isValid) {
    const getImageUrl = typeof context.getImageUrl === "function" ? context.getImageUrl : null;
    const entries = await Promise.all(
      sponsors.map(async (sponsor, sponsorIndex) => {
        let url = cleanUrl(sponsor?.url || sponsor?.src || sponsor?.imageUrl || "");
        if (!url && getImageUrl) {
          const key = sponsor?.imageKey || sponsor?.imageId || sponsor?.id || sponsorIndex;
          try {
            url = cleanUrl(await getImageUrl(key, sponsor));
          } catch (error) {
            console.warn("Sponsor image could not be loaded", error);
            url = "";
          }
          if (!isValid()) return null;
        }
        return {
          sponsor: sponsor || {},
          url,
          name: cleanText(sponsor?.name, `Sponsor ${sponsorIndex + 1}`),
          tier: cleanText(sponsor?.tierLabel || TIER_LABELS[sponsor?.tier] || sponsor?.tier || "")
        };
      })
    );
    if (!isValid()) return [];
    return entries.filter((entry) => entry?.url);
  }

  function createLogo(entry, settings, className = "") {
    const logo = createElement("img", `psm-logo${className ? ` ${className}` : ""}`);
    logo.alt = entry.name;
    logo.draggable = false;
    if (entry.url) logo.src = entry.url;
    const size = imageSize(settings);
    logo.style.width = `${size}px`;
    logo.style.maxHeight = `${size}px`;
    logo.style.borderRadius = `${number(settings.radius, 0, 0, 100)}px`;
    logo.style.filter = shadowFilter(settings);
    return logo;
  }

  function createTile(entry, settings, options = {}) {
    const showNames = settings.showNames !== false && options.onlyLogo !== true;
    const tile = createElement("article", `psm-tile${showNames ? "" : " psm-only-logo"}`);
    tile.appendChild(createLogo(entry, settings));
    if (showNames) {
      const copy = createElement("span", "psm-tile-copy");
      const name = createElement("strong");
      name.textContent = entry.name;
      copy.appendChild(name);
      if (settings.showTier !== false && entry.tier) {
        const tier = createElement("span");
        tier.textContent = entry.tier;
        copy.appendChild(tier);
      }
      tile.appendChild(copy);
    }
    return tile;
  }

  function appendLogoGroup(parent, entries, settings, tileMode = false) {
    entries.forEach((entry) => {
      parent.appendChild(tileMode ? createTile(entry, settings) : createLogo(entry, settings));
    });
  }

  function setHostVariables(host, settings) {
    const size = imageSize(settings);
    host.style.setProperty("--psm-size", `${size}px`);
    host.style.setProperty("--psm-gap", `${number(settings.gap, 24, 0, 240)}px`);
    host.style.setProperty("--psm-radius", `${number(settings.radius, 0, 0, 100)}px`);
    const panelAlpha = number(settings.opacity, 72, 0, 100) / 100;
    host.style.setProperty("--psm-panel-alpha", String(panelAlpha));
    host.style.setProperty("--psm-panel-alpha-soft", String(panelAlpha * 0.92));
    host.style.setProperty("--psm-logo-shadow", shadowFilter(settings));
    host.style.setProperty("--psm-panel-shadow", panelShadow(settings));
  }

  async function render(root, context = {}) {
    if (!(root instanceof Element)) throw new TypeError("PepsSponsorRenderers.render requires a DOM element");
    if (typeof activeRenderers.get(root) === "function") activeRenderers.get(root)();
    injectStyles();

    const mode = resolveMode(context.mode || context.state?.mode || context.state?.settings?.skin);
    const settings = resolveSettings(context, mode);
    const sponsors = Array.isArray(context.sponsors) ? context.sponsors.filter(Boolean) : [];
    const paused = context.paused === true || context.state?.isPaused === true;
    const generation = context.generation;
    const timers = new Set();
    const intervals = new Set();
    let frame = 0;
    let alive = true;
    let disposer = null;

    const isValid = () => {
      if (!alive || activeRenderers.get(root) !== disposer) return false;
      if (typeof context.isCurrent !== "function") return true;
      try {
        return context.isCurrent(generation) !== false;
      } catch {
        return false;
      }
    };

    const later = (callback, delay) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (isValid()) callback();
      }, Math.max(0, Number(delay) || 0));
      timers.add(timer);
      return timer;
    };

    const repeat = (callback, delay) => {
      const interval = setInterval(() => {
        if (isValid()) callback();
      }, Math.max(16, Number(delay) || 16));
      intervals.add(interval);
      return interval;
    };

    const notifyIndexChange = (nextIndex) => {
      if (typeof context.onIndexChange !== "function" || !isValid()) return;
      try {
        context.onIndexChange(normalizeIndex(nextIndex, sponsors.length));
      } catch (error) {
        console.warn("Sponsor mode onIndexChange callback failed", error);
      }
    };

    disposer = () => {
      if (!alive) return;
      alive = false;
      timers.forEach(clearTimeout);
      intervals.forEach(clearInterval);
      timers.clear();
      intervals.clear();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (activeRenderers.get(root) === disposer) activeRenderers.delete(root);
    };
    activeRenderers.set(root, disposer);

    root.dataset.renderer = mode;
    root.replaceChildren();
    const host = createElement("div", `psm-host${paused ? " psm-paused" : ""}`);
    host.dataset.mode = mode;
    setHostVariables(host, settings);
    root.appendChild(host);

    if (!sponsors.length) return disposer;
    const entries = await resolveEntries(sponsors, context, isValid);
    if (!isValid()) {
      disposer();
      return disposer;
    }
    if (!entries.length) return disposer;

    const index = normalizeIndex(context.index ?? context.state?.currentIndex, entries.length);
    const classicRow = (extraClass = "") => {
      const row = createElement("div", `psm-classic-row${extraClass ? ` ${extraClass}` : ""}`);
      row.style.gap = `${number(settings.gap, 24, 0, 240)}px`;
      host.appendChild(row);
      return row;
    };

    const positionFlex = (element, defaultY = "bottom") => {
      const posX = ["left", "center", "right"].includes(settings.posX) ? settings.posX : "center";
      const posY = ["top", "center", "bottom"].includes(settings.posY) ? settings.posY : defaultY;
      element.style.justifyContent =
        posX === "left" ? "flex-start" : posX === "right" ? "flex-end" : "center";
      element.style.alignItems =
        posY === "top" ? "flex-start" : posY === "bottom" ? "flex-end" : "center";
      element.style.top = posY === "bottom" ? "auto" : "0";
      element.style.bottom = posY === "top" ? "auto" : "0";
      element.style.height = posY === "center" ? "100%" : "auto";
      return { posX, posY };
    };

    if (mode === "grid") {
      const row = classicRow("psm-grid-motion");
      positionFlex(row, "bottom");
      row.style.setProperty(
        "--psm-grid-speed",
        `${number(settings.gridSpeed, 1000, 100, 5000)}ms`
      );
      entries.forEach((entry, entryIndex) => {
        const logo = createLogo(entry, settings);
        logo.style.animationDelay = `${entryIndex * 55}ms`;
        row.appendChild(logo);
      });
      return disposer;
    }

    if (mode === "rotator") {
      const allowedEffects = ["fade", "slide", "zoom", "flip", "drop", "spin-in", "blur"];
      const effect = allowedEffects.includes(settings.effect) ? settings.effect : "fade";
      const container = createElement("div", `psm-rotator psm-effect-${effect}`);
      const inner = createElement("div", "psm-rotator-inner");
      container.style.justifyContent =
        settings.rotatorX === "left" ? "flex-start" : settings.rotatorX === "right" ? "flex-end" : "center";
      container.style.alignItems =
        settings.rotatorY === "top" ? "flex-start" : settings.rotatorY === "bottom" ? "flex-end" : "center";
      container.style.padding = `${number(settings.margin, 34, 0, 500)}px`;
      entries.forEach((entry) => inner.appendChild(createLogo(entry, settings)));
      container.appendChild(inner);
      host.appendChild(container);
      const logos = Array.from(inner.children);
      let activeIndex = index;
      const show = () => {
        logos.forEach((logo, logoIndex) => logo.classList.toggle("psm-active", logoIndex === activeIndex));
        notifyIndexChange(activeIndex);
        activeIndex = normalizeIndex(activeIndex + 1, logos.length);
        if (!paused && logos.length > 1) later(show, number(settings.stayTime, 2.5, 0.5, 60) * 1000);
      };
      show();
      return disposer;
    }

    if (mode === "ticker" || mode === "broadcast_ticker") {
      const ticker = createElement(
        "div",
        mode === "ticker"
          ? "psm-ticker"
          : `psm-broadcast-ticker${settings.position === "top" ? " psm-top" : ""}`
      );
      const track = createElement("div", "psm-ticker-track");
      const duration =
        mode === "ticker"
          ? number(settings.tickerSpeed, 42, 1, 600)
          : number(settings.speed, 18, 1, 600);
      track.style.setProperty("--psm-ticker-duration", `${duration}s`);
      if (mode === "ticker") {
        ticker.style.top = `${number(settings.tickerY, 900, 0, 4000)}px`;
        if (settings.tickerX === "left") {
          ticker.style.left = "0";
          ticker.style.right = "auto";
          ticker.style.width = "55%";
        } else if (settings.tickerX === "right") {
          ticker.style.left = "auto";
          ticker.style.right = "0";
          ticker.style.width = "55%";
        }
      }
      for (let copy = 0; copy < 2; copy += 1) {
        const group = createElement("div", "psm-ticker-group");
        appendLogoGroup(group, entries, settings, mode === "broadcast_ticker");
        group.setAttribute("aria-hidden", copy === 1 ? "true" : "false");
        track.appendChild(group);
      }
      ticker.appendChild(track);
      host.appendChild(ticker);
      return disposer;
    }

    if (mode === "bounce") {
      const container = createElement("div", "psm-bounce");
      const posX = ["left", "center", "right"].includes(settings.posX) ? settings.posX : "center";
      const posY = ["top", "center", "bottom"].includes(settings.posY) ? settings.posY : "center";
      const items = entries.map((entry, itemIndex) => {
        const element = createLogo(entry, settings);
        container.appendChild(element);
        return {
          element,
          x: 30 + itemIndex * 95,
          y: 30 + itemIndex * 60,
          dx: number(settings.bounceSpeed, 5, 1, 20) + (itemIndex % 3),
          dy: number(settings.bounceSpeed, 5, 1, 20) + (itemIndex % 2)
        };
      });
      host.appendChild(container);
      if (!paused) {
        let previousTime = performance.now();
        const step = (time) => {
          if (!isValid()) return;
          const factor = Math.min(3, Math.max(0.25, (time - previousTime) / (1000 / 60)));
          previousTime = time;
          const width = container.clientWidth || root.clientWidth || 1920;
          const height = container.clientHeight || root.clientHeight || 1080;
          const minX = posX === "right" ? width * 0.5 : 0;
          const maxX = posX === "left" ? width * 0.5 : width;
          const minY = posY === "bottom" ? height * 0.5 : 0;
          const maxY = posY === "top" ? height * 0.5 : height;
          items.forEach((item) => {
            const itemWidth = item.element.offsetWidth || imageSize(settings);
            const itemHeight = item.element.offsetHeight || imageSize(settings);
            item.x += item.dx * factor;
            item.y += item.dy * factor;
            if (item.x < minX) {
              item.x = minX;
              item.dx = Math.abs(item.dx);
            } else if (item.x + itemWidth > maxX) {
              item.x = Math.max(minX, maxX - itemWidth);
              item.dx = -Math.abs(item.dx);
            }
            if (item.y < minY) {
              item.y = minY;
              item.dy = Math.abs(item.dy);
            } else if (item.y + itemHeight > maxY) {
              item.y = Math.max(minY, maxY - itemHeight);
              item.dy = -Math.abs(item.dy);
            }
            item.element.style.transform = `translate3d(${item.x}px, ${item.y}px, 0)`;
          });
          frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      }
      return disposer;
    }

    if (mode === "rain") {
      const container = createElement("div", "psm-rain");
      const posX = ["left", "center", "right"].includes(settings.posX) ? settings.posX : "center";
      const posY = ["top", "center", "bottom"].includes(settings.posY) ? settings.posY : "top";
      if (posY === "top") {
        container.style.bottom = "50%";
      } else if (posY === "bottom") {
        container.style.top = "50%";
      }
      host.appendChild(container);
      const duration = Math.max(1.8, 18 / number(settings.rainSpeed, 5, 1, 20));
      const density = Math.round(number(settings.rainDensity, 5, 1, 12));
      const spawn = () => {
        for (let count = 0; count < density; count += 1) {
          if (!isValid()) return;
          const entry = entries[Math.floor(Math.random() * entries.length)];
          const drop = createElement("div", "psm-rain-drop");
          const leftStart = posX === "left" ? 0 : posX === "right" ? 54 : 27;
          const leftRange = posX === "center" ? 40 : 40;
          drop.style.left = `${leftStart + Math.random() * leftRange}vw`;
          drop.style.setProperty("--psm-rain-duration", `${duration}s`);
          drop.style.setProperty("--psm-drift", `${Math.random() * 160 - 80}px`);
          drop.appendChild(createLogo(entry, settings));
          container.appendChild(drop);
          later(() => drop.remove(), duration * 1000 + 900);
        }
      };
      spawn();
      if (!paused) repeat(spawn, 700);
      return disposer;
    }

    if (mode === "cover3d") {
      const container = createElement("div", "psm-cover");
      const coverX = ["left", "center", "right"].includes(settings.posX) ? settings.posX : "center";
      const coverY = ["top", "center", "bottom"].includes(settings.posY) ? settings.posY : "bottom";
      container.style.justifyContent =
        coverX === "left" ? "flex-start" : coverX === "right" ? "flex-end" : "center";
      container.style.top =
        coverY === "top" ? "50px" : coverY === "center" ? "calc(50% - 165px)" : "auto";
      container.style.bottom = coverY === "bottom" ? "50px" : "auto";
      const cards = entries.map((entry) => {
        const card = createElement("div", "psm-cover-card");
        card.appendChild(createLogo(entry, settings));
        container.appendChild(card);
        return card;
      });
      host.appendChild(container);
      let activeIndex = index;
      const step = () => {
        notifyIndexChange(activeIndex);
        cards.forEach((card, cardIndex) => {
          let offset = (cardIndex - activeIndex + cards.length) % cards.length;
          if (offset > cards.length / 2) offset -= cards.length;
          const distance = Math.abs(offset);
          card.style.transform = `translateX(${offset * 160}px) translateZ(${-distance * 110}px) rotateY(${
            offset * -35
          }deg)`;
          card.style.opacity = String(distance === 0 ? 1 : number(settings.coverOpacity, 0.35, 0.05, 1));
          card.style.zIndex = String(100 - distance);
        });
        activeIndex =
          settings.coverDir === "left"
            ? normalizeIndex(activeIndex - 1, cards.length)
            : normalizeIndex(activeIndex + 1, cards.length);
      };
      step();
      if (!paused && cards.length > 1) repeat(step, number(settings.coverSpeed, 1600, 100, 60000));
      return disposer;
    }

    if (["pulse", "spin", "wiggle", "float", "swing"].includes(mode)) {
      const speedKeys = {
        pulse: "pulseSpeed",
        spin: "spinSpeed",
        wiggle: "wiggleSpeed",
        float: "floatSpeed",
        swing: "swingSpeed"
      };
      const defaults = { pulse: 900, spin: 2200, wiggle: 700, float: 2000, swing: 1800 };
      const row = classicRow(`psm-anim-${mode}`);
      positionFlex(row, "bottom");
      row.style.setProperty(
        "--psm-anim-speed",
        `${number(settings[speedKeys[mode]], defaults[mode], 100, 60000)}ms`
      );
      appendLogoGroup(row, entries, settings);
      return disposer;
    }

    if (mode === "wave") {
      const row = classicRow("psm-wave");
      positionFlex(row, "bottom");
      row.style.setProperty("--psm-wave-speed", `${number(settings.waveSpeed, 1800, 100, 60000)}ms`);
      row.style.setProperty("--psm-wave-height", `${number(settings.waveHeight, 28, 0, 300)}px`);
      entries.forEach((entry, entryIndex) => {
        const logo = createLogo(entry, settings);
        logo.style.setProperty("--psm-delay", `${entryIndex * 120}ms`);
        row.appendChild(logo);
      });
      return disposer;
    }

    if (mode === "orbit") {
      const container = createElement("div", "psm-orbit");
      const orbitX = ["left", "center", "right"].includes(settings.posX) ? settings.posX : "center";
      const orbitY = ["top", "center", "bottom"].includes(settings.posY) ? settings.posY : "center";
      container.style.placeContent = `${
        orbitY === "top" ? "start" : orbitY === "bottom" ? "end" : "center"
      } ${
        orbitX === "left" ? "start" : orbitX === "right" ? "end" : "center"
      }`;
      container.style.padding = "50px";
      const ring = createElement(
        "div",
        `psm-orbit-ring${settings.orbitDir === "left" ? " psm-left" : ""}`
      );
      ring.style.setProperty("--psm-orbit-speed", `${number(settings.orbitSpeed, 7000, 100, 60000)}ms`);
      const radius = number(settings.orbitRadius, 220, 20, 1000);
      entries.forEach((entry, entryIndex) => {
        const angle = (360 / entries.length) * entryIndex;
        const item = createElement("div", "psm-orbit-item");
        item.style.transform = `rotate(${angle}deg) translateX(${radius}px) rotate(${-angle}deg)`;
        item.appendChild(createLogo(entry, settings));
        ring.appendChild(item);
      });
      container.appendChild(ring);
      host.appendChild(container);
      return disposer;
    }

    if (mode === "spotlight") {
      const container = createElement("div", "psm-spotlight");
      const spotX = ["left", "center", "right"].includes(settings.posX) ? settings.posX : "center";
      const spotY = ["top", "center", "bottom"].includes(settings.posY) ? settings.posY : "center";
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.justifyContent =
        spotY === "top" ? "flex-start" : spotY === "bottom" ? "flex-end" : "center";
      container.style.alignItems =
        spotX === "left" ? "flex-start" : spotX === "right" ? "flex-end" : "center";
      container.style.padding = "50px";
      const main = createElement("div", "psm-spotlight-main");
      const strip = createElement("div", "psm-spotlight-strip");
      strip.style.setProperty("--psm-spot-dim", String(number(settings.spotlightDim, 0.25, 0.05, 1)));
      const stripLogos = entries.map((entry) => {
        const logo = createLogo(entry, settings);
        strip.appendChild(logo);
        return logo;
      });
      let activeIndex = index;
      const show = () => {
        main.replaceChildren(createLogo(entries[activeIndex], settings));
        stripLogos.forEach((logo, logoIndex) => logo.classList.toggle("psm-active", logoIndex === activeIndex));
        notifyIndexChange(activeIndex);
        activeIndex = normalizeIndex(activeIndex + 1, entries.length);
        if (!paused && entries.length > 1) {
          later(show, number(settings.spotlightSpeed, 2500, 100, 60000));
        }
      };
      container.append(main, strip);
      host.appendChild(container);
      show();
      return disposer;
    }

    if (mode === "lower_third") {
      const visibleEntries = rotateWindow(entries, index, number(settings.maxVisible, 6, 1, 12));
      const position = ["top", "center", "bottom"].includes(settings.position)
        ? settings.position
        : "bottom";
      const container = createElement(
        "div",
        `psm-lower-third${position === "bottom" ? "" : ` psm-${position}`}`
      );
      appendLogoGroup(container, visibleEntries, settings, true);
      host.appendChild(container);
      return disposer;
    }

    if (mode === "corner_badge") {
      const allowed = ["left", "right", "bottom", "top", "center", "top-left", "top-right"];
      const position = allowed.includes(settings.position) ? settings.position : "right";
      const container = createElement(
        "div",
        `psm-corner${position === "right" || position === "bottom" ? "" : ` psm-${position}`}`
      );
      container.appendChild(createTile(entries[index], settings));
      host.appendChild(container);
      return disposer;
    }

    if (mode === "side_tower") {
      const visibleEntries = rotateWindow(entries, index, number(settings.maxVisible, 5, 1, 10));
      const position = ["left", "right", "top", "bottom"].includes(settings.position)
        ? settings.position
        : "right";
      const container = createElement(
        "div",
        `psm-side-tower${position === "right" ? "" : ` psm-${position}`}`
      );
      appendLogoGroup(container, visibleEntries, settings, true);
      host.appendChild(container);
      return disposer;
    }

    if (mode === "grid_board" || mode === "sponsor_break") {
      const isBreak = mode === "sponsor_break";
      const visibleEntries = rotateWindow(
        entries,
        index,
        number(settings.maxVisible, isBreak ? 8 : 8, 1, 16)
      );
      const scene = createElement("div", isBreak ? "psm-sponsor-break" : "psm-grid-board");
      const card = createElement("section", isBreak ? "psm-break-card" : "psm-board-card");
      if (isBreak) {
        const kicker = createElement("p", "psm-break-kicker");
        kicker.textContent = cleanText(settings.breakKicker, "PEPSLIVE PARTNERS");
        const title = createElement("h1", "psm-break-title");
        title.textContent = cleanText(settings.breakTitle, "Presented By");
        const logos = createElement("div", "psm-break-logos");
        appendLogoGroup(logos, visibleEntries, settings, true);
        card.append(kicker, title, logos);
      } else {
        const title = createElement("h1", "psm-board-title");
        title.textContent = cleanText(settings.boardTitle, "OUR PARTNERS");
        const logos = createElement("div", "psm-board-logos");
        appendLogoGroup(logos, visibleEntries, settings, true);
        card.append(title, logos);
      }
      scene.appendChild(card);
      host.appendChild(scene);
      return disposer;
    }

    if (mode === "goal_popup") {
      const entry = entries[index];
      const allowed = ["top", "center", "bottom", "left", "right"];
      const position = allowed.includes(settings.position) ? settings.position : "center";
      const scene = createElement("div", `psm-goal psm-${position}`);
      const card = createElement("article", "psm-goal-card");
      const flare = createElement("div", "psm-goal-flare");
      flare.setAttribute("aria-hidden", "true");
      const logo = createLogo(entry, settings);
      logo.style.position = "relative";
      logo.style.zIndex = "1";
      const copy = createElement("div", "psm-goal-copy");
      const label = createElement("b");
      label.textContent = cleanText(settings.goalLabel, "GOAL");
      const sponsorLine = createElement("span");
      sponsorLine.textContent = `${cleanText(settings.goalPrefix, "Presented by")} ${entry.name}`.trim();
      copy.append(label, sponsorLine);
      card.append(flare, logo, copy);
      scene.appendChild(card);
      host.appendChild(scene);
      return disposer;
    }

    appendLogoGroup(classicRow(), entries, settings);
    return disposer;
  }

  window.PepsSponsorRenderers = Object.freeze({ render });
})();
