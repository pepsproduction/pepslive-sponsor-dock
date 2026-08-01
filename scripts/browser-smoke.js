const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES
      && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA
      && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"]
      && path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.PROGRAMFILES
      && path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function startStaticServer() {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };

  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = path.resolve(root, relativePath);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      response.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message || "CDP request failed"));
        else resolve(message);
      } else {
        this.events.push(message);
      }
    };
    socket.onclose = () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error("Chrome DevTools connection closed"));
      }
      this.pending.clear();
    };
  }

  send(method, params = {}, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools command timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (response.result.exceptionDetails) {
      const exception = response.result.exceptionDetails.exception;
      throw new Error(
        exception?.description
        || response.result.exceptionDetails.text
        || "Browser evaluation failed"
      );
    }
    return response.result.result.value;
  }
}

async function openDebugPage(debugPort, url = "about:blank") {
  const response = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" }
  );
  const target = await response.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const cdp = new CdpClient(socket);
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  return { cdp, socket, targetId: target.id };
}

async function waitFor(test, description, timeout = 10000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeout) {
    try {
      if (await test()) return;
    } catch (error) {
      lastError = error;
    }
    await wait(80);
  }
  const suffix = lastError ? ` Last browser error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

function remoteValue(value) {
  if (Object.hasOwn(value || {}, "value")) return value.value;
  return value?.description || value?.unserializableValue || value?.type || "";
}

function browserErrorsSince(cdp, marker) {
  const errors = [];
  for (const event of cdp.events.slice(marker)) {
    if (event.method === "Runtime.exceptionThrown") {
      const details = event.params?.exceptionDetails || {};
      errors.push(
        details.exception?.description
        || details.text
        || "Uncaught browser exception"
      );
    }
    if (event.method === "Runtime.consoleAPICalled" && event.params?.type === "error") {
      errors.push(
        (event.params.args || []).map(remoteValue).join(" ")
        || "console.error called"
      );
    }
    if (
      event.method === "Log.entryAdded"
      && event.params?.entry?.level === "error"
      && event.params.entry.source !== "network"
    ) {
      errors.push(event.params.entry.text || "Browser log error");
    }
  }
  return errors;
}

function fakeObsPreloadSource() {
  return `(() => {
    const clone = (value) => value === undefined
      ? {}
      : JSON.parse(JSON.stringify(value));
    const mock = {
      calls: [],
      connections: [],
      disconnects: 0,
      sceneName: "QA Program Scene",
      nextSceneItemId: 700,
      inputs: {
        PEPS_SPONSOR_DISPLAY: {
          inputKind: "browser_source",
          inputSettings: {
            is_local_file: true,
            local_file: "C:/stale/sponsor.html",
            url: ""
          }
        }
      },
      sceneItems: {},
      handlers: {},
      resetCalls() {
        this.calls.length = 0;
      }
    };

    class FakeOBSWebSocket {
      on(eventName, handler) {
        mock.handlers[eventName] = handler;
        return this;
      }

      async connect(address, password) {
        mock.connections.push({ address, password: password || "" });
        return { obsWebSocketVersion: "5.fake", negotiatedRpcVersion: 1 };
      }

      async disconnect() {
        mock.disconnects += 1;
      }

      async call(requestType, requestData = {}) {
        const data = clone(requestData);
        mock.calls.push({ requestType, requestData: data });
        if (requestType === "GetCurrentProgramScene") {
          return { currentProgramSceneName: mock.sceneName };
        }
        if (requestType === "GetInputSettings") {
          const input = mock.inputs[data.inputName];
          if (!input) throw new Error("Input not found");
          return clone(input);
        }
        if (requestType === "GetInputList") {
          return {
            inputs: Object.entries(mock.inputs)
              .filter(([, input]) => !data.inputKind || input.inputKind === data.inputKind)
              .map(([inputName, input]) => ({ inputName, inputKind: input.inputKind }))
          };
        }
        if (requestType === "SetInputSettings") {
          const input = mock.inputs[data.inputName];
          if (!input) throw new Error("Input not found");
          input.inputSettings = {
            ...(input.inputSettings || {}),
            ...(data.inputSettings || {})
          };
          return {};
        }
        if (requestType === "SetInputName") {
          const input = mock.inputs[data.inputName];
          if (!input) throw new Error("Input not found");
          if (mock.inputs[data.newInputName]) throw new Error("Input already exists");
          mock.inputs[data.newInputName] = input;
          delete mock.inputs[data.inputName];
          if (mock.sceneItems[data.inputName]) {
            mock.sceneItems[data.newInputName] = mock.sceneItems[data.inputName];
            delete mock.sceneItems[data.inputName];
          }
          return {};
        }
        if (requestType === "CreateInput") {
          if (mock.inputs[data.inputName]) throw new Error("Input already exists");
          mock.inputs[data.inputName] = {
            inputKind: data.inputKind,
            inputSettings: clone(data.inputSettings)
          };
          mock.sceneItems[data.inputName] = ++mock.nextSceneItemId;
          return { sceneItemId: mock.sceneItems[data.inputName] };
        }
        if (requestType === "GetSceneItemId") {
          const sceneItemId = mock.sceneItems[data.sourceName];
          if (!sceneItemId) throw new Error("Scene item not found");
          return { sceneItemId };
        }
        if (requestType === "CreateSceneItem") {
          mock.sceneItems[data.sourceName] = ++mock.nextSceneItemId;
          return { sceneItemId: mock.sceneItems[data.sourceName] };
        }
        if (requestType === "SetSceneItemEnabled") {
          return {};
        }
        if (requestType === "PressInputPropertiesButton") {
          if (!mock.inputs[data.inputName]) throw new Error("Input not found");
          return {};
        }
        throw new Error("Unhandled fake OBS request: " + requestType);
      }
    }

    Object.defineProperty(window, "__obsMock", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: mock
    });
    Object.defineProperty(window, "OBSWebSocket", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: FakeOBSWebSocket
    });
  })();`;
}

function playbackCapturePreloadSource() {
  return `(() => {
    const messages = [];
    Object.defineProperty(window, "__qaPlaybackMessages", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: messages
    });
    try {
      const channel = new BroadcastChannel("peps_sponsor_dock_channel_v2");
      channel.onmessage = (event) => {
        if (event.data?.type === "playback") {
          messages.push(JSON.parse(JSON.stringify(event.data)));
        }
      };
      window.addEventListener("pagehide", () => channel.close(), { once: true });
    } catch {
      // BroadcastChannel support is already covered by the application fallback.
    }
  })();`;
}

function assertNoBrowserErrors(cdp, marker, label) {
  const errors = browserErrorsSince(cdp, marker);
  assert(errors.length === 0, `${label} emitted browser errors:\n${errors.join("\n")}`);
}

async function navigate(cdp, origin, route, predicate, description) {
  const response = await cdp.send("Page.navigate", { url: `${origin}${route}` });
  assert(!response.result.errorText, `Navigation failed for ${route}: ${response.result.errorText}`);
  await waitFor(async () => {
    const location = await cdp.evaluate(`({
      ready: document.readyState,
      href: location.href,
      pathname: location.pathname,
      search: location.search,
      hash: location.hash
    })`);
    return location.ready === "complete" && predicate(location);
  }, description);
}

async function enableDownloads(cdp, downloadPath) {
  fs.mkdirSync(downloadPath, { recursive: true });
  try {
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath,
      eventsEnabled: true
    });
  } catch {
    await cdp.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath
    });
  }
}

async function setFileInputFiles(cdp, selector, files) {
  const documentResponse = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const queryResponse = await cdp.send("DOM.querySelector", {
    nodeId: documentResponse.result.root.nodeId,
    selector
  });
  assert(queryResponse.result.nodeId, `File input not found: ${selector}`);
  await cdp.send("DOM.setFileInputFiles", {
    nodeId: queryResponse.result.nodeId,
    files: files.map((file) => path.resolve(file))
  });
}

async function chooseImportFixture(cdp, fixturePath, description) {
  await setFileInputFiles(cdp, "#importProjectInput", [fixturePath]);
  await waitFor(
    () => cdp.evaluate(`document.getElementById("confirmDialog")?.open === true`),
    `${description} confirmation dialog`
  );
  await cdp.evaluate(`document.getElementById("confirmAcceptBtn").click()`);
}

async function waitForDownloadedJson(downloadPath) {
  let result = null;
  await waitFor(async () => {
    const names = fs.readdirSync(downloadPath);
    if (names.some((name) => name.endsWith(".crdownload"))) return false;
    const jsonName = names.find((name) => name.endsWith(".json"));
    if (!jsonName) return false;
    const candidate = path.join(downloadPath, jsonName);
    try {
      const payload = JSON.parse(fs.readFileSync(candidate, "utf8"));
      result = { path: candidate, payload };
      return true;
    } catch {
      return false;
    }
  }, "exported project JSON download");
  return result;
}

async function waitForDisplay(cdp, mode, groupId = "", sponsorName = "") {
  await waitFor(async () => cdp.evaluate(`(() => {
    const layer = document.getElementById("sponsorLayer");
    const stage = document.getElementById("displayStage");
    if (!layer || !stage || layer.dataset.renderer !== ${JSON.stringify(mode)}) return false;
    if (${JSON.stringify(groupId)} && stage.dataset.group !== ${JSON.stringify(groupId)}) return false;
    const expectedName = ${JSON.stringify(sponsorName)};
    return !expectedName || [...layer.querySelectorAll("img.psm-logo")].some((image) => image.alt === expectedName);
  })()`), `${mode} display renderer`);
}

const MODE_SIGNATURE_SELECTORS = Object.freeze({
  grid: ".psm-grid-motion",
  rotator: ".psm-rotator",
  ticker: ".psm-ticker",
  bounce: ".psm-bounce",
  rain: ".psm-rain",
  cover3d: ".psm-cover",
  pulse: ".psm-anim-pulse",
  spin: ".psm-anim-spin",
  wiggle: ".psm-anim-wiggle",
  float: ".psm-anim-float",
  swing: ".psm-anim-swing",
  wave: ".psm-wave",
  orbit: ".psm-orbit",
  spotlight: ".psm-spotlight",
  lower_third: ".psm-lower-third",
  corner_badge: ".psm-corner",
  side_tower: ".psm-side-tower",
  broadcast_ticker: ".psm-broadcast-ticker",
  grid_board: ".psm-grid-board",
  sponsor_break: ".psm-sponsor-break",
  goal_popup: ".psm-goal"
});

const MODE_MINIMUM_VISIBLE = Object.freeze({
  grid: 2,
  ticker: 2,
  bounce: 2,
  rain: 2,
  cover3d: 2,
  pulse: 2,
  spin: 2,
  wiggle: 2,
  float: 2,
  swing: 2,
  wave: 2,
  orbit: 3,
  lower_third: 2,
  side_tower: 2,
  broadcast_ticker: 2,
  grid_board: 2,
  sponsor_break: 2
});

const MODE_MOTION_SELECTORS = Object.freeze({
  ticker: ".psm-ticker-track",
  bounce: ".psm-bounce .psm-logo",
  rain: ".psm-rain-drop",
  pulse: ".psm-anim-pulse .psm-logo",
  spin: ".psm-anim-spin .psm-logo",
  wiggle: ".psm-anim-wiggle .psm-logo",
  float: ".psm-anim-float .psm-logo",
  swing: ".psm-anim-swing .psm-logo",
  wave: ".psm-wave .psm-logo",
  orbit: ".psm-orbit-ring",
  broadcast_ticker: ".psm-ticker-track"
});

const MODE_CYCLE_MODES = new Set(["rotator", "cover3d", "spotlight"]);

async function readModeVisibility(cdp, mode, options = {}) {
  const frameSelector = options.frameSelector || "";
  const expectedGroup = options.groupId || "";
  const signatureSelector = MODE_SIGNATURE_SELECTORS[mode];
  assert(signatureSelector, `Missing visibility signature for ${mode}`);
  return cdp.evaluate(`(() => {
    const frameSelector = ${JSON.stringify(frameSelector)};
    const frame = frameSelector ? document.querySelector(frameSelector) : null;
    const doc = frameSelector ? frame?.contentDocument : document;
    const view = doc?.defaultView;
    const layer = doc?.getElementById("sponsorLayer");
    const stage = doc?.getElementById("displayStage");
    const signature = layer?.querySelector(${JSON.stringify(signatureSelector)}) || null;
    const viewport = {
      left: 0,
      top: 0,
      right: view?.innerWidth || doc?.documentElement?.clientWidth || 0,
      bottom: view?.innerHeight || doc?.documentElement?.clientHeight || 0
    };

    const inspect = (image) => {
      const original = image.getBoundingClientRect();
      let clipped = {
        left: Math.max(viewport.left, original.left),
        top: Math.max(viewport.top, original.top),
        right: Math.min(viewport.right, original.right),
        bottom: Math.min(viewport.bottom, original.bottom)
      };
      let effectiveOpacity = 1;
      let cssVisible = true;
      let node = image;
      while (node && node.nodeType === Node.ELEMENT_NODE) {
        const style = view.getComputedStyle(node);
        const opacity = Number.parseFloat(style.opacity);
        effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
        if (
          style.display === "none"
          || style.visibility === "hidden"
          || style.visibility === "collapse"
          || style.contentVisibility === "hidden"
        ) {
          cssVisible = false;
        }
        if (node !== image) {
          const bounds = node.getBoundingClientRect();
          if (["hidden", "clip", "scroll", "auto"].includes(style.overflowX)) {
            clipped.left = Math.max(clipped.left, bounds.left);
            clipped.right = Math.min(clipped.right, bounds.right);
          }
          if (["hidden", "clip", "scroll", "auto"].includes(style.overflowY)) {
            clipped.top = Math.max(clipped.top, bounds.top);
            clipped.bottom = Math.min(clipped.bottom, bounds.bottom);
          }
        }
        node = node.parentElement;
      }
      const visibleWidth = Math.max(0, clipped.right - clipped.left);
      const visibleHeight = Math.max(0, clipped.bottom - clipped.top);
      const visibleArea = visibleWidth * visibleHeight;
      const originalArea = Math.max(0, original.width * original.height);
      const visibleFraction = originalArea > 0 ? visibleArea / originalArea : 0;
      return {
        name: image.alt,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        rect: {
          left: Math.round(original.left),
          top: Math.round(original.top),
          width: Math.round(original.width),
          height: Math.round(original.height)
        },
        effectiveOpacity,
        cssVisible,
        visibleArea,
        visibleFraction,
        visible: image.complete
          && image.naturalWidth > 0
          && image.naturalHeight > 0
          && original.width > 0
          && original.height > 0
          && effectiveOpacity >= 0.05
          && cssVisible
          && visibleArea >= 256
          && visibleFraction >= 0.05
      };
    };

    const inspectFrame = () => {
      if (!frameSelector) return { required: false, visible: true };
      if (!frame) return { required: true, visible: false, reason: "missing" };
      const outerView = document.defaultView;
      const original = frame.getBoundingClientRect();
      let clipped = {
        left: Math.max(0, original.left),
        top: Math.max(0, original.top),
        right: Math.min(outerView.innerWidth, original.right),
        bottom: Math.min(outerView.innerHeight, original.bottom)
      };
      let effectiveOpacity = 1;
      let cssVisible = true;
      let node = frame;
      while (node && node.nodeType === Node.ELEMENT_NODE) {
        const style = outerView.getComputedStyle(node);
        const opacity = Number.parseFloat(style.opacity);
        effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
        if (
          style.display === "none"
          || style.visibility === "hidden"
          || style.visibility === "collapse"
          || style.contentVisibility === "hidden"
        ) {
          cssVisible = false;
        }
        if (node !== frame) {
          const bounds = node.getBoundingClientRect();
          if (["hidden", "clip", "scroll", "auto"].includes(style.overflowX)) {
            clipped.left = Math.max(clipped.left, bounds.left);
            clipped.right = Math.min(clipped.right, bounds.right);
          }
          if (["hidden", "clip", "scroll", "auto"].includes(style.overflowY)) {
            clipped.top = Math.max(clipped.top, bounds.top);
            clipped.bottom = Math.min(clipped.bottom, bounds.bottom);
          }
        }
        node = node.parentElement;
      }
      const visibleWidth = Math.max(0, clipped.right - clipped.left);
      const visibleHeight = Math.max(0, clipped.bottom - clipped.top);
      const visibleArea = visibleWidth * visibleHeight;
      const originalArea = Math.max(0, original.width * original.height);
      const visibleFraction = originalArea > 0 ? visibleArea / originalArea : 0;
      const container = frame.parentElement;
      const fillsContainer = !!container
        && Math.abs(original.width - container.clientWidth) <= 3
        && Math.abs(original.height - container.clientHeight) <= 3;
      return {
        required: true,
        rect: {
          left: Math.round(original.left),
          top: Math.round(original.top),
          width: Math.round(original.width),
          height: Math.round(original.height)
        },
        effectiveOpacity,
        cssVisible,
        visibleArea,
        visibleFraction,
        fillsContainer,
        visible: original.width > 0
          && original.height > 0
          && effectiveOpacity >= 0.05
          && cssVisible
          && visibleArea >= 1024
          && visibleFraction >= 0.1
          && fillsContainer
      };
    };

    const images = layer ? [...layer.querySelectorAll("img.psm-logo")].map(inspect) : [];
    return {
      documentReady: doc?.readyState || "missing",
      viewport: { width: viewport.right, height: viewport.bottom },
      renderer: layer?.dataset.renderer || "",
      renderedGroup: stage?.dataset.group || "",
      expectedGroup: ${JSON.stringify(expectedGroup)},
      signaturePresent: !!signature,
      signatureClass: signature?.className || "",
      frameVisibility: inspectFrame(),
      imageCount: images.length,
      allImagesLoaded: images.length > 0 && images.every((image) =>
        image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
      ),
      visibleCount: images.filter((image) => image.visible).length,
      images
    };
  })()`);
}

async function waitForModeVisible(cdp, mode, options = {}) {
  const minimumVisible = Math.max(
    MODE_MINIMUM_VISIBLE[mode] || 1,
    Number(options.minimumVisible) || 0
  );
  let lastReport = null;
  try {
    await waitFor(async () => {
      lastReport = await readModeVisibility(cdp, mode, options);
      return lastReport.documentReady === "complete"
        && lastReport.renderer === mode
        && (!options.groupId || lastReport.renderedGroup === options.groupId)
        && lastReport.signaturePresent
        && (!options.frameSelector || lastReport.frameVisibility?.visible)
        && lastReport.allImagesLoaded
        && lastReport.visibleCount >= minimumVisible;
    }, `${mode} visibly rendered output`, options.timeout || 10000);
  } catch (error) {
    throw new Error(`${error.message} Last visibility report: ${JSON.stringify(lastReport)}`);
  }
  return lastReport;
}

async function readModeMotion(cdp, mode) {
  const selector = MODE_MOTION_SELECTORS[mode];
  assert(selector, `Missing motion selector for ${mode}`);
  return cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return { present: false };
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const animation = element.getAnimations()[0] || null;
    return {
      present: true,
      transform: style.transform,
      left: Number(rect.left.toFixed(3)),
      top: Number(rect.top.toFixed(3)),
      animationTime: Number.isFinite(animation?.currentTime) ? animation.currentTime : null,
      playState: animation?.playState || ""
    };
  })()`);
}

async function assertModeMotion(cdp, mode) {
  const before = await readModeMotion(cdp, mode);
  await wait(320);
  const after = await readModeMotion(cdp, mode);
  const visuallyChanged = before.transform !== after.transform
    || before.left !== after.left
    || before.top !== after.top;
  const timelineAdvanced = before.animationTime === null
    || (after.animationTime !== null && after.animationTime > before.animationTime);
  assert(
    before.present && after.present && visuallyChanged && timelineAdvanced,
    `${mode} animation must visibly progress while running: ${JSON.stringify({ before, after })}`
  );
}

async function readModeCycleIdentity(cdp, mode) {
  return cdp.evaluate(`(() => {
    const mode = ${JSON.stringify(mode)};
    if (mode === "rotator") {
      return document.querySelector(".psm-rotator .psm-logo.psm-active")?.alt || "";
    }
    if (mode === "cover3d") {
      const active = [...document.querySelectorAll(".psm-cover-card")]
        .find((card) => Number.parseFloat(card.style.opacity) >= 0.99);
      return active?.querySelector("img.psm-logo")?.alt || "";
    }
    if (mode === "spotlight") {
      return document.querySelector(".psm-spotlight-main img.psm-logo")?.alt || "";
    }
    return "";
  })()`);
}

async function assertModeCycle(cdp, mode) {
  const before = await readModeCycleIdentity(cdp, mode);
  assert(before, `${mode} timed cycle must expose an active Sponsor`);
  let after = before;
  await waitFor(async () => {
    after = await readModeCycleIdentity(cdp, mode);
    return !!after && after !== before;
  }, `${mode} timed Sponsor cycle`, 2500);
}

async function seedCanonicalProject(cdp) {
  return cdp.evaluate(`(async () => {
    const svg = (label, color) => \`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160">
      <rect width="320" height="160" rx="28" fill="#10141d"/>
      <rect x="10" y="10" width="300" height="140" rx="22" fill="\${color}"/>
      <text x="160" y="94" text-anchor="middle" font-family="Arial" font-size="32" font-weight="800" fill="#fff">\${label}</text>
    </svg>\`;

    await PepsSponsor.dbClearImages();
    await PepsSponsor.dbPutImage(
      "img_alpha",
      new Blob([svg("ALPHA", "#ff620f")], { type: "image/svg+xml" }),
      { name: "alpha.svg", type: "image/svg+xml" }
    );
    await PepsSponsor.dbPutImage(
      "img_beta",
      new Blob([svg("BETA", "#00a9d6")], { type: "image/svg+xml" }),
      { name: "beta.svg", type: "image/svg+xml" }
    );

    const state = PepsSponsor.defaultState();
    const createdAt = "2026-07-17T00:00:00.000Z";
    state.projectName = "Unified 21 Mode Regression";
    state.mode = "grid";
    state.activeGroupId = "group_alpha";
    state.activePlaylist = "pl_live";
    state.images = [
      {
        id: "img_alpha",
        name: "Alpha Sponsor",
        tier: "main",
        duration: 6,
        enabled: true,
        createdAt
      },
      {
        id: "img_beta",
        name: "Beta Sponsor",
        tier: "gold",
        duration: 6,
        enabled: true,
        createdAt
      }
    ];
    state.groups = [
      { id: "all", name: "All Sponsors", imageIds: ["img_alpha", "img_beta"] },
      { id: "group_alpha", name: "Alpha Group", imageIds: ["img_alpha"] },
      { id: "group_beta", name: "Beta Group", imageIds: ["img_beta"] },
      { id: "group_empty", name: "Empty Group", imageIds: [] }
    ];
    state.playlists = [
      {
        id: "pl_live",
        name: "Live Regression",
        mode: "lower_third",
        groupId: "group_alpha",
        defaultDuration: 6,
        sponsorIds: ["img_beta"]
      },
      {
        id: "pl_alt",
        name: "Alternate Regression",
        mode: "spotlight",
        groupId: "group_beta",
        defaultDuration: 6,
        sponsorIds: ["img_alpha"]
      }
    ];
    state.modeGroups = Object.fromEntries(
      PepsSponsorModes.ids.map((mode) => [mode, "group_beta"])
    );
    state.modeSettings = Object.fromEntries(
      PepsSponsorModes.ids.map((mode) => [mode, PepsSponsorModes.defaultsFor(mode)])
    );
    state.settings = {
      autoPlay: false,
      safeArea: false,
      showNames: true,
      showTier: true,
      opacity: 100
    };
    state.isVisible = true;
    state.isPaused = false;
    state.currentIndex = 0;
    state.command = {
      id: "cmd_regression_seed",
      type: "init",
      ts: 1,
      payload: {}
    };
    const saved = await PepsSponsor.saveStateLocked(state, {
      replace: true,
      silent: true
    });
    return {
      images: saved.images.length,
      groups: saved.groups.length,
      playlists: saved.playlists.length,
      modes: PepsSponsorModes.ids.length
    };
  })()`);
}

async function seedCapacityProject(cdp) {
  return cdp.evaluate(`(async () => {
    const sponsors = [
      ["cap_a", "Capacity A", "#ff620f"],
      ["cap_b", "Capacity B", "#00a9d6"],
      ["cap_c", "Capacity C", "#7c3aed"],
      ["cap_d", "Capacity D", "#16a34a"],
      ["cap_e", "Capacity E", "#e11d48"]
    ];
    const svg = (label, color) => \`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160">
      <rect width="320" height="160" rx="28" fill="#10141d"/>
      <rect x="10" y="10" width="300" height="140" rx="22" fill="\${color}"/>
      <text x="160" y="94" text-anchor="middle" font-family="Arial" font-size="28" font-weight="800" fill="#fff">\${label}</text>
    </svg>\`;

    await PepsSponsor.dbClearImages();
    for (const [id, name, color] of sponsors) {
      await PepsSponsor.dbPutImage(
        id,
        new Blob([svg(name, color)], { type: "image/svg+xml" }),
        { name: \`\${id}.svg\`, type: "image/svg+xml" }
      );
    }

    const state = PepsSponsor.defaultState();
    const ids = sponsors.map(([id]) => id);
    const createdAt = "2026-07-17T00:00:00.000Z";
    state.projectName = "Capacity Playback Regression";
    state.mode = "lower_third";
    state.activeGroupId = "group_capacity";
    state.activePlaylist = "pl_capacity_live";
    state.images = sponsors.map(([id, name]) => ({
      id,
      name,
      tier: "partner",
      duration: 2,
      enabled: true,
      createdAt
    }));
    state.groups = [
      { id: "all", name: "All Capacity Sponsors", imageIds: [...ids] },
      { id: "group_capacity", name: "Capacity Group", imageIds: [...ids] }
    ];
    state.playlists = [{
      id: "pl_capacity_live",
      name: "Capacity Live Order",
      mode: "lower_third",
      groupId: "group_capacity",
      defaultDuration: 2,
      sponsorIds: ["cap_e", "cap_c", "cap_a"]
    }];
    state.modeGroups = Object.fromEntries(
      PepsSponsorModes.ids.map((mode) => [mode, "group_capacity"])
    );
    state.modeSettings = Object.fromEntries(
      PepsSponsorModes.ids.map((mode) => [mode, PepsSponsorModes.defaultsFor(mode)])
    );
    state.modeSettings.lower_third.maxVisible = 4;
    state.modeSettings.rotator.stayTime = 0.5;
    state.modeSettings.cover3d.coverSpeed = 200;
    state.modeSettings.spotlight.spotlightSpeed = 200;
    state.settings = {
      autoPlay: true,
      safeArea: false,
      showNames: true,
      showTier: true,
      opacity: 100
    };
    state.isVisible = true;
    state.isPaused = false;
    state.currentIndex = 0;
    state.command = {
      id: "cmd_capacity_seed",
      type: "init",
      ts: 2,
      payload: {}
    };
    const saved = await PepsSponsor.saveStateLocked(state, {
      replace: true,
      silent: true
    });
    return {
      sponsorIds: ids,
      sponsorNames: saved.images.map((image) => image.name),
      playlistIds: saved.playlists[0].sponsorIds,
      playlistId: saved.activePlaylist,
      groupId: saved.activeGroupId,
      capacity: saved.modeSettings.lower_third.maxVisible
    };
  })()`);
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error("Unified browser regression requires Chrome or Edge, but neither executable was found.");
  }

  let profile = "";
  let server = null;
  let child = null;
  let chromeStderr = "";
  let socket = null;
  const extraPages = [];
  try {
    const profileRoot = process.env.PEPSLIVE_BROWSER_TMP || os.tmpdir();
    fs.mkdirSync(profileRoot, { recursive: true });
    profile = fs.mkdtempSync(path.join(profileRoot, "pepslive-unified-modes-"));
    server = await startStaticServer();
    const appPort = server.address().port;
    const origin = `http://127.0.0.1:${appPort}`;
    const debugPort = await freePort();
    const downloadPath = path.join(profile, "downloads");
    const fixturePath = path.join(profile, "fixtures");
    fs.mkdirSync(fixturePath, { recursive: true });
    let chromeLaunchError = null;
    child = spawn(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--no-first-run",
      "--disable-background-networking",
      "--disable-component-update",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      "--window-size=1440,1000",
      "about:blank"
    ], { stdio: ["ignore", "ignore", "pipe"] });
    child.on("error", (error) => {
      chromeLaunchError = error;
    });
    child.stderr.on("data", (chunk) => {
      chromeStderr = `${chromeStderr}${chunk}`.slice(-12000);
    });

    let page;
    await waitFor(async () => {
      if (chromeLaunchError) throw chromeLaunchError;
      try {
        const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        page = targets.find((target) => target.type === "page");
        return !!page;
      } catch {
        return false;
      }
    }, "Chrome debugging target");

    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    const cdp = new CdpClient(socket);
    await cdp.send("Page.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await enableDownloads(cdp, downloadPath);
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: fakeObsPreloadSource()
    });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: playbackCapturePreloadSource()
    });

    const controlMarker = cdp.events.length;
    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=control&qa=route#collections",
      (location) => location.pathname.endsWith("/sponsor-control.html"),
      "sponsor.html control compatibility route"
    );
    await waitFor(
      () => cdp.evaluate(`typeof PepsSponsor === "object"
        && typeof PepsSponsorModes === "object"
        && document.querySelectorAll("#modeLibrary .mode-card").length === 7`),
      "control application initialization"
    );
    const controlRoute = await cdp.evaluate(`({
      pathname: location.pathname,
      mode: new URL(location.href).searchParams.get("mode"),
      qa: new URL(location.href).searchParams.get("qa"),
      hash: location.hash
    })`);
    assert(controlRoute.pathname.endsWith("/sponsor-control.html"), "Control compatibility route is incorrect");
    assert(controlRoute.mode === null, "Control compatibility route must remove mode=control");
    assert(controlRoute.qa === "route", "Control compatibility route must preserve extra query parameters");
    assert(controlRoute.hash === "#collections", "Control compatibility route must preserve the hash");
    await wait(250);
    assertNoBrowserErrors(cdp, controlMarker, "Control page load");

    const registry = await cdp.evaluate(`(() => {
      const ids = PepsSponsorModes.ids;
      const textControls = PepsSponsorModes.definitions.flatMap((definition) =>
        PepsSponsorModes.controlsFor(definition.id)
          .filter((control) => control.type === "text")
          .map((control) => ({ mode: definition.id, key: control.key, fallback: control.default }))
      );
      return {
        count: ids.length,
        unique: new Set(ids).size,
        definitions: PepsSponsorModes.definitions.length,
        textControls
      };
    })()`);
    assert(registry.count === 21, `Registry must expose 21 modes, found ${registry.count}`);
    assert(registry.unique === 21, "Registry mode IDs must be unique");
    assert(registry.definitions === 21, "Registry definitions and IDs must have equal length");
    assert(registry.textControls.length > 0, "Registry must expose text control schemas");

    const seeded = await seedCanonicalProject(cdp);
    assert(
      seeded.images === 2 && seeded.groups === 4 && seeded.playlists === 2 && seeded.modes === 21,
      `Canonical seed failed: ${JSON.stringify(seeded)}`
    );

    const seededControlMarker = cdp.events.length;
    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=control#collections",
      (location) => location.pathname.endsWith("/sponsor-control.html"),
      "seeded control route"
    );
    await waitFor(
      () => cdp.evaluate(`PepsSponsor.loadState().images.length === 2
        && document.querySelectorAll("#groupMembers .playlist-row").length === 1
        && document.querySelectorAll("#playlistItems .playlist-row").length === 1`),
      "group and playlist panels to render independently"
    );
    const collections = await cdp.evaluate(`({
      groupRows: [...document.querySelectorAll("#groupMembers .playlist-row .playlist-copy strong")]
        .map((element) => element.textContent),
      playlistRows: [...document.querySelectorAll("#playlistItems .playlist-row .playlist-copy strong")]
        .map((element) => element.textContent),
      groupCount: document.getElementById("groupItemCount")?.textContent,
      playlistCount: document.getElementById("playlistItemCount")?.textContent
    })`);
    assert(
      collections.groupRows.join("|") === "Alpha Sponsor",
      `Group panel rendered the wrong rows: ${JSON.stringify(collections.groupRows)}`
    );
    assert(
      collections.playlistRows.join("|") === "Beta Sponsor",
      `Playlist panel rendered the wrong rows: ${JSON.stringify(collections.playlistRows)}`
    );
    assert(
      collections.groupCount === "1" && collections.playlistCount === "1",
      "Group and playlist counters must render independently"
    );

    const recoveryMarker = cdp.events.length;
    const mergeBefore = await cdp.evaluate(`(async () => {
      const before = PepsSponsor.loadState();
      const legacyDb = await new Promise((resolve, reject) => {
        const request = indexedDB.open("PepsLiveSponsorDockDB", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("images")) {
            request.result.createObjectStore("images", { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const mergeOne = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><text x="20" y="90">MERGE_ONE</text></svg>';
      const mergeTwo = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><text x="20" y="90">MERGE_TWO</text></svg>';
      await new Promise((resolve, reject) => {
        const tx = legacyDb.transaction("images", "readwrite");
        const store = tx.objectStore("images");
        store.clear();
        store.put({
          id: "legacy_merge_blob_one",
          blob: new Blob([mergeOne], { type: "image/svg+xml" }),
          name: "merge-one.svg",
          type: "image/svg+xml"
        });
        store.put({
          id: "legacy_merge_blob_two",
          blob: new Blob([mergeTwo], { type: "image/svg+xml" }),
          name: "merge-two.svg",
          type: "image/svg+xml"
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Legacy merge fixture transaction aborted"));
      });
      legacyDb.close();

      localStorage.setItem(PepsSponsor.REDESIGN_STORAGE_KEY, JSON.stringify({
        projectName: "Legacy Merge Fixture",
        activePlaylist: "legacy_merge_playlist",
        isVisible: true,
        isPaused: false,
        currentIndex: 0,
        settings: {
          logoSize: 98,
          gap: 20,
          speed: 12,
          radius: 12,
          opacity: 92,
          shadow: "soft",
          autoPlay: true,
          safeArea: false,
          showNames: true,
          showTier: true
        },
        sponsors: [
          {
            id: "legacy_merge_one",
            imageKey: "legacy_merge_blob_one",
            name: "Merge Legacy One",
            tier: "gold",
            duration: 7,
            enabled: true
          },
          {
            id: "img_alpha",
            imageKey: "legacy_merge_blob_two",
            name: "Merge Legacy Collision",
            tier: "partner",
            duration: 5,
            enabled: true
          }
        ],
        playlists: [{
          id: "legacy_merge_playlist",
          name: "Merge Legacy Playlist",
          mode: "bottom_bar",
          defaultDuration: 6,
          sponsorIds: ["legacy_merge_one", "img_alpha"]
        }]
      }));

      return {
        images: JSON.stringify(before.images),
        groups: JSON.stringify(before.groups),
        playlists: JSON.stringify(before.playlists),
        modeGroups: JSON.stringify(before.modeGroups),
        mode: before.mode,
        imageCount: before.images.length,
        groupCount: before.groups.length,
        playlistCount: before.playlists.length
      };
    })()`);

    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=control&qa=merge-detect#settings",
      (location) => location.pathname.endsWith("/sponsor-control.html")
        && new URL(location.href).searchParams.get("qa") === "merge-detect",
      "canonical plus redesign recovery detection"
    );
    await waitFor(
      () => cdp.evaluate(`PepsSponsor.loadState().migration.alternateRedesignDetected === true
        && document.getElementById("mergeRedesignBtn")?.hidden === false`),
      "alternate redesign recovery prompt"
    );
    const detectedCanonical = await cdp.evaluate(`(() => {
      const state = PepsSponsor.loadState();
      return {
        images: JSON.stringify(state.images),
        groups: JSON.stringify(state.groups),
        playlists: JSON.stringify(state.playlists),
        modeGroups: JSON.stringify(state.modeGroups),
        mode: state.mode,
        alternate: state.migration.alternateRedesignDetected,
        merged: state.migration.redesignMerged
      };
    })()`);
    assert(detectedCanonical.images === mergeBefore.images, "Recovery detection changed current sponsors");
    assert(detectedCanonical.groups === mergeBefore.groups, "Recovery detection changed current groups");
    assert(detectedCanonical.playlists === mergeBefore.playlists, "Recovery detection changed current playlists");
    assert(detectedCanonical.modeGroups === mergeBefore.modeGroups, "Recovery detection changed modeGroups");
    assert(detectedCanonical.mode === mergeBefore.mode, "Recovery detection changed the active mode");
    assert(detectedCanonical.alternate === true && detectedCanonical.merged === false, "Recovery flags are incorrect before merge");

    const mergeResult = await cdp.evaluate(`(async () => {
      const before = PepsSponsor.loadState();
      const currentImageIds = new Set(before.images.map((image) => image.id));
      const currentGroupIds = new Set(before.groups.map((group) => group.id));
      const currentPlaylistIds = new Set(before.playlists.map((playlist) => playlist.id));
      const merged = await PepsSponsor.mergeRedesignProject();
      const importedImages = merged.images.slice(before.images.length);
      const importedGroups = merged.groups.slice(before.groups.length);
      const importedPlaylists = merged.playlists.slice(before.playlists.length);
      const importedImageIds = new Set(importedImages.map((image) => image.id));
      const blobs = {};
      for (const image of importedImages) {
        const record = await PepsSponsor.dbGetImageRecord(image.id);
        blobs[image.name] = record?.blob ? await record.blob.text() : "";
      }
      const importedPlaylist = importedPlaylists[0];
      const importedPlaylistGroup = importedGroups.find((group) => group.id === importedPlaylist?.groupId);
      return {
        sameImages: JSON.stringify(merged.images.slice(0, before.images.length)) === JSON.stringify(before.images),
        sameGroups: JSON.stringify(merged.groups.slice(0, before.groups.length)) === JSON.stringify(before.groups),
        samePlaylists: JSON.stringify(merged.playlists.slice(0, before.playlists.length)) === JSON.stringify(before.playlists),
        sameModeGroups: JSON.stringify(merged.modeGroups) === JSON.stringify(before.modeGroups),
        sameMode: merged.mode === before.mode,
        counts: {
          images: merged.images.length,
          groups: merged.groups.length,
          playlists: merged.playlists.length
        },
        importedImageIds: importedImages.map((image) => image.id),
        freshImages: importedImages.every((image) =>
          !currentImageIds.has(image.id)
          && !["legacy_merge_one", "img_alpha"].includes(image.id)
        ),
        freshGroups: importedGroups.every((group) =>
          !currentGroupIds.has(group.id)
          && !["all", "group_legacy_merge_playlist"].includes(group.id)
        ),
        freshPlaylists: importedPlaylists.every((playlist) =>
          !currentPlaylistIds.has(playlist.id)
          && playlist.id !== "legacy_merge_playlist"
        ),
        prefixedGroups: importedGroups.every((group) => group.name.startsWith("Redesign")),
        prefixedPlaylists: importedPlaylists.every((playlist) => playlist.name.startsWith("Redesign")),
        playlistReferences: importedPlaylist?.sponsorIds.every((id) => importedImageIds.has(id)) === true,
        groupReferences: importedPlaylistGroup?.imageIds.every((id) => importedImageIds.has(id)) === true,
        blobs,
        migration: merged.migration
      };
    })()`);
    assert(
      mergeResult.sameImages
        && mergeResult.sameGroups
        && mergeResult.samePlaylists
        && mergeResult.sameModeGroups
        && mergeResult.sameMode,
      `Merge mutated canonical state: ${JSON.stringify(mergeResult)}`
    );
    assert(
      mergeResult.counts.images === mergeBefore.imageCount + 2
        && mergeResult.counts.groups === mergeBefore.groupCount + 2
        && mergeResult.counts.playlists === mergeBefore.playlistCount + 1,
      `Merge appended the wrong collection counts: ${JSON.stringify(mergeResult.counts)}`
    );
    assert(mergeResult.importedImageIds.length === 2 && mergeResult.freshImages, "Merged sponsors must receive fresh IDs");
    assert(mergeResult.freshGroups && mergeResult.freshPlaylists, "Merged collections must receive fresh IDs");
    assert(mergeResult.prefixedGroups && mergeResult.prefixedPlaylists, "Merged collection names must be visibly prefixed");
    assert(mergeResult.playlistReferences && mergeResult.groupReferences, "Merged collections lost remapped sponsor references");
    assert(
      Object.values(mergeResult.blobs).some((text) => text.includes("MERGE_ONE"))
        && Object.values(mergeResult.blobs).some((text) => text.includes("MERGE_TWO")),
      `Merged sponsor blobs were not copied: ${JSON.stringify(mergeResult.blobs)}`
    );
    assert(
      mergeResult.migration.redesignMerged === true
        && mergeResult.migration.alternateRedesignDetected === false
        && mergeResult.migration.missingImages === 0,
      `Merge completion flags are incorrect: ${JSON.stringify(mergeResult.migration)}`
    );

    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=control&qa=merge-reload#settings",
      (location) => location.pathname.endsWith("/sponsor-control.html")
        && new URL(location.href).searchParams.get("qa") === "merge-reload",
      "post-merge recovery reload"
    );
    await waitFor(
      () => cdp.evaluate(`(() => {
        const state = PepsSponsor.loadState();
        return state.migration.redesignMerged === true
          && state.migration.alternateRedesignDetected === false
          && document.getElementById("mergeRedesignBtn")?.hidden === true;
      })()`),
      "merged redesign state to remain acknowledged after reload"
    );
    assertNoBrowserErrors(cdp, recoveryMarker, "Explicit redesign recovery workflow");

    await cdp.evaluate(`localStorage.removeItem(PepsSponsor.REDESIGN_STORAGE_KEY)`);
    await seedCanonicalProject(cdp);
    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=control&qa=playlist-audit#collections",
      (location) => location.pathname.endsWith("/sponsor-control.html")
        && new URL(location.href).searchParams.get("qa") === "playlist-audit",
      "playlist save audit route"
    );
    await waitFor(
      () => cdp.evaluate(`PepsSponsor.loadState().images.length === 2
        && document.getElementById("playlistMode")?.value === "lower_third"`),
      "canonical state restoration before playlist audit"
    );
    const playlistBefore = await cdp.evaluate(`(() => {
      const before = PepsSponsor.loadState();
      document.getElementById("playlistName").value = "Playlist Audit Edit";
      document.getElementById("playlistMode").value = "corner_badge";
      document.getElementById("playlistMode").dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("playlistGroup").value = "group_beta";
      document.getElementById("playlistDuration").value = "9";
      document.getElementById("savePlaylistBtn").click();
      return {
        mode: before.mode,
        modeGroups: JSON.stringify(before.modeGroups)
      };
    })()`);
    await waitFor(
      () => cdp.evaluate(`(() => {
        const after = PepsSponsor.loadState();
        const playlist = after.playlists.find((item) => item.id === after.activePlaylist);
        return playlist?.name === "Playlist Audit Edit"
          && playlist?.mode === "corner_badge"
          && playlist?.groupId === "group_beta"
          && playlist?.defaultDuration === 9;
      })()`),
      "asynchronous playlist save"
    );
    const playlistAudit = await cdp.evaluate(`(() => {
      const after = PepsSponsor.loadState();
      const playlist = after.playlists.find((item) => item.id === after.activePlaylist);
      return {
        afterMode: after.mode,
        afterModeGroups: JSON.stringify(after.modeGroups),
        playlist: {
          name: playlist?.name,
          mode: playlist?.mode,
          groupId: playlist?.groupId,
          defaultDuration: playlist?.defaultDuration
        }
      };
    })()`);
    playlistAudit.beforeMode = playlistBefore.mode;
    playlistAudit.beforeModeGroups = playlistBefore.modeGroups;
    assert(
      playlistAudit.playlist.name === "Playlist Audit Edit"
        && playlistAudit.playlist.mode === "corner_badge"
        && playlistAudit.playlist.groupId === "group_beta"
        && playlistAudit.playlist.defaultDuration === 9,
      `Playlist save did not persist its own fields: ${JSON.stringify(playlistAudit.playlist)}`
    );
    assert(
      playlistAudit.afterMode === playlistAudit.beforeMode,
      `savePlaylist changed state.mode from ${playlistAudit.beforeMode} to ${playlistAudit.afterMode}`
    );
    assert(
      playlistAudit.afterModeGroups === playlistAudit.beforeModeGroups,
      "savePlaylist mutated modeGroups"
    );

    await seedCanonicalProject(cdp);
    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=control#collections",
      (location) => location.pathname.endsWith("/sponsor-control.html"),
      "canonical control restoration after playlist audit"
    );
    await waitFor(
      () => cdp.evaluate(`PepsSponsor.loadState().playlists.find((item) => item.id === "pl_live")?.mode
        === "lower_third"`),
      "canonical playlist restoration"
    );

    await cdp.evaluate(`document.getElementById("tab-modes").click()`);
    await waitFor(
      () => cdp.evaluate(`document.getElementById("view-modes").classList.contains("is-active")`),
      "Modes workspace activation"
    );
    const recommendedModes = await cdp.evaluate(`(() => ({
      filter: document.getElementById("modeCategoryFilter").value,
      ids: [...document.querySelectorAll("#modeLibrary .mode-card")].map((card) => card.dataset.mode)
    }))()`);
    assert(recommendedModes.filter === "recommended", "Mode Library must open with recommended modes");
    assert(recommendedModes.ids.length === 7, "Mode Library must show 7 recommended modes first");
    for (const id of ["lower_third", "rotator", "broadcast_ticker", "corner_badge", "side_tower", "sponsor_break", "goal_popup"]) {
      assert(recommendedModes.ids.includes(id), `Recommended Mode Library is missing ${id}`);
    }
    await cdp.evaluate(`(() => {
      const filter = document.getElementById("modeCategoryFilter");
      filter.value = "all";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    const textControlResults = await cdp.evaluate(`(() => {
      const results = [];
      for (const definition of PepsSponsorModes.definitions) {
        const textControls = PepsSponsorModes.controlsFor(definition.id)
          .filter((control) => control.type === "text");
        if (!textControls.length) continue;
        document.querySelector(\`#modeLibrary [data-mode="\${definition.id}"]\`)?.click();
        for (const control of textControls) {
          const input = document.getElementById(\`modeControl_\${control.key}\`);
          results.push({
            mode: definition.id,
            key: control.key,
            exists: !!input,
            type: input?.type || "",
            value: input?.value || ""
          });
        }
      }
      return results;
    })()`);
    assert(
      textControlResults.length === registry.textControls.length,
      "Not every text schema was exercised in Mode Studio"
    );
    for (const result of textControlResults) {
      assert(result.exists, `Missing text control ${result.mode}.${result.key}`);
      assert(result.type === "text", `${result.mode}.${result.key} must render as input[type=text]`);
      assert(result.value.length > 0, `${result.mode}.${result.key} must receive its default value`);
    }

    const urlCenter = await cdp.evaluate(`(() => {
      const values = [...document.querySelectorAll("#urlList .url-item input")]
        .map((input) => input.value);
      return {
        values,
        modeCards: document.querySelectorAll("#modeLibrary .mode-card").length,
        modeGroupRows: document.querySelectorAll("#modeGroupMap .map-row").length
      };
    })()`);
    assert(urlCenter.modeCards === 21, "Mode Library must render 21 cards");
    assert(urlCenter.modeGroupRows === 21, "Mode/group mapping panel must render 21 rows");
    assert(
      urlCenter.values.length === 24,
      `URL Center must render Live, Classic Display, Classic Auto, and 21 explicit mode URLs, found ${urlCenter.values.length}: `
        + JSON.stringify(urlCenter.values)
    );
    const generatedUrls = urlCenter.values.map((value) => new URL(value));
    const liveUrl = generatedUrls.find((url) => url.searchParams.get("mode") === "live");
    const liveDisplayUrl = generatedUrls.find((url) => url.searchParams.get("mode") === "display");
    const autoUrl = generatedUrls.find((url) => url.searchParams.get("mode") === "auto");
    assert(liveUrl, "URL Center must include mode=live");
    assert(!liveUrl.searchParams.has("group"), "Live Playlist URL must not bind a fixed group");
    assert(liveDisplayUrl, "URL Center must include mode=display");
    assert(!liveDisplayUrl.searchParams.has("group"), "Classic Display URL must use Mode Studio mapping");
    assert(autoUrl, "URL Center must include mode=auto");
    assert(
      autoUrl.searchParams.get("group") === "group_beta",
      "Classic Auto URL must lock the active Mode Studio group"
    );
    for (const id of await cdp.evaluate(`PepsSponsorModes.ids`)) {
      const url = generatedUrls.find((candidate) => candidate.searchParams.get("mode") === id);
      assert(url, `URL Center is missing explicit ${id} URL`);
      assert(url.pathname.endsWith("/sponsor.html"), `${id} URL must use sponsor.html compatibility entry`);
      assert(url.searchParams.get("group") === "group_beta", `${id} URL must include its mapped group`);
    }

    const transferMarker = cdp.events.length;
    await cdp.evaluate(`(() => {
      document.querySelector('#modeLibrary [data-mode="sponsor_break"]')?.click();
      const input = document.getElementById("modeControl_breakTitle");
      input.value = "ROUND TRIP BREAK";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await waitFor(
      () => cdp.evaluate(`PepsSponsor.loadState().modeSettings.sponsor_break.breakTitle
        === "ROUND TRIP BREAK"`),
      "custom mode setting persistence before export"
    );

    await cdp.evaluate(`document.getElementById("exportProjectBtn").click()`);
    const exported = await waitForDownloadedJson(downloadPath);
    assert(exported.payload.format === "pepslive-sponsor-dock-v4", "Export format must be v4");
    assert(exported.payload.state.projectName === "Unified 21 Mode Regression", "Export lost project state");
    assert(exported.payload.state.images.length === 2, "Export must include both image records");
    assert(
      exported.payload.state.modeSettings.sponsor_break.breakTitle === "ROUND TRIP BREAK",
      "Export lost per-mode text settings"
    );
    const exportedIds = exported.payload.state.images.map((image) => image.id);
    assert(exportedIds.includes("img_alpha") && exportedIds.includes("img_beta"), "Export changed source IDs");
    for (const id of exportedIds) {
      assert(exported.payload.imageData[id], `Export is missing imageData for ${id}`);
      assert(
        exported.payload.imageData[id].dataUrl.startsWith("data:image/svg+xml;base64,"),
        `Export imageData for ${id} is not a base64 SVG`
      );
    }

    await chooseImportFixture(cdp, exported.path, "v4 round-trip import");
    await waitFor(
      () => cdp.evaluate(`(() => {
        const state = PepsSponsor.loadState();
        const ids = state.images.map((image) => image.id);
        return state.command.type === "import"
          && state.projectName === "Unified 21 Mode Regression"
          && ids.length === 2
          && !ids.includes("img_alpha")
          && !ids.includes("img_beta");
      })()`),
      "successful v4 import with remapped IDs"
    );
    const importedV4 = await cdp.evaluate(`(async () => {
      const state = PepsSponsor.loadState();
      const alpha = state.images.find((image) => image.name === "Alpha Sponsor");
      const beta = state.images.find((image) => image.name === "Beta Sponsor");
      const alphaRecord = await PepsSponsor.dbGetImageRecord(alpha.id);
      const betaRecord = await PepsSponsor.dbGetImageRecord(beta.id);
      const keys = await new Promise((resolve, reject) => {
        const request = indexedDB.open(PepsSponsor.DB_NAME);
        request.onsuccess = () => {
          const tx = request.result.transaction("images", "readonly");
          const getKeys = tx.objectStore("images").getAllKeys();
          getKeys.onsuccess = () => resolve(getKeys.result.map(String).sort());
          getKeys.onerror = () => reject(getKeys.error);
        };
        request.onerror = () => reject(request.error);
      });
      return {
        ids: state.images.map((image) => image.id),
        alphaId: alpha.id,
        betaId: beta.id,
        alphaGroupIds: state.groups.find((group) => group.id === "group_alpha")?.imageIds || [],
        livePlaylistIds: state.playlists.find((playlist) => playlist.id === "pl_live")?.sponsorIds || [],
        breakTitle: state.modeSettings.sponsor_break.breakTitle,
        alphaBlob: await alphaRecord.blob.text(),
        betaBlob: await betaRecord.blob.text(),
        keys
      };
    })()`);
    assert(
      importedV4.ids.every((id) => id !== "img_alpha" && id !== "img_beta"),
      "V4 import must remap every image ID"
    );
    assert(
      importedV4.alphaGroupIds.length === 1 && importedV4.alphaGroupIds[0] === importedV4.alphaId,
      "V4 import did not remap Group image IDs"
    );
    assert(
      importedV4.livePlaylistIds.length === 1 && importedV4.livePlaylistIds[0] === importedV4.betaId,
      "V4 import did not remap Playlist sponsor IDs"
    );
    assert(importedV4.breakTitle === "ROUND TRIP BREAK", "V4 import lost modeSettings");
    assert(importedV4.alphaBlob.includes("ALPHA"), "V4 import wrote the wrong Alpha image blob");
    assert(importedV4.betaBlob.includes("BETA"), "V4 import wrote the wrong Beta image blob");
    assert(
      JSON.stringify(importedV4.keys) === JSON.stringify([...importedV4.ids].sort()),
      `V4 import left unexpected image records: ${JSON.stringify(importedV4.keys)}`
    );

    const brokenPayload = JSON.parse(JSON.stringify(exported.payload));
    delete brokenPayload.imageData.img_beta;
    const brokenFixture = path.join(fixturePath, "broken-v4-project.json");
    fs.writeFileSync(brokenFixture, JSON.stringify(brokenPayload, null, 2));
    const beforeFailedImport = await cdp.evaluate(`(async () => {
      const keys = await new Promise((resolve, reject) => {
        const request = indexedDB.open(PepsSponsor.DB_NAME);
        request.onsuccess = () => {
          const tx = request.result.transaction("images", "readonly");
          const getKeys = tx.objectStore("images").getAllKeys();
          getKeys.onsuccess = () => resolve(getKeys.result.map(String).sort());
          getKeys.onerror = () => reject(getKeys.error);
        };
        request.onerror = () => reject(request.error);
      });
      return {
        rawState: localStorage.getItem(PepsSponsor.STORAGE_KEY),
        keys,
        errorToasts: document.querySelectorAll("#toastRegion .toast.error").length
      };
    })()`);
    await chooseImportFixture(cdp, brokenFixture, "missing-image rollback import");
    await waitFor(
      () => cdp.evaluate(
        `document.querySelectorAll("#toastRegion .toast.error").length
          > ${beforeFailedImport.errorToasts}`
      ),
      "failed import error feedback"
    );
    const afterFailedImport = await cdp.evaluate(`(async () => {
      const state = PepsSponsor.loadState();
      const keys = await new Promise((resolve, reject) => {
        const request = indexedDB.open(PepsSponsor.DB_NAME);
        request.onsuccess = () => {
          const tx = request.result.transaction("images", "readonly");
          const getKeys = tx.objectStore("images").getAllKeys();
          getKeys.onsuccess = () => resolve(getKeys.result.map(String).sort());
          getKeys.onerror = () => reject(getKeys.error);
        };
        request.onerror = () => reject(request.error);
      });
      const blobs = {};
      for (const image of state.images) {
        const record = await PepsSponsor.dbGetImageRecord(image.id);
        blobs[image.name] = await record.blob.text();
      }
      return {
        rawState: localStorage.getItem(PepsSponsor.STORAGE_KEY),
        keys,
        blobs
      };
    })()`);
    assert(
      afterFailedImport.rawState === beforeFailedImport.rawState,
      "Failed import must leave persisted state byte-for-byte unchanged"
    );
    assert(
      JSON.stringify(afterFailedImport.keys) === JSON.stringify(beforeFailedImport.keys),
      "Failed import must remove staged images and preserve prior DB keys"
    );
    assert(
      afterFailedImport.blobs["Alpha Sponsor"].includes("ALPHA")
        && afterFailedImport.blobs["Beta Sponsor"].includes("BETA"),
      "Failed import damaged prior image blobs"
    );

    const legacySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160">
      <rect width="320" height="160" fill="#6d28d9"/>
      <text x="160" y="92" text-anchor="middle" fill="#fff" font-size="32">LEGACY</text>
    </svg>`;
    const legacyFixture = path.join(fixturePath, "legacy-redesign-project.json");
    fs.writeFileSync(legacyFixture, JSON.stringify({
      projectName: "Legacy Redesign Import",
      activePlaylist: "legacy_playlist",
      isVisible: true,
      isPaused: false,
      currentIndex: 0,
      settings: {
        skin: "ticker",
        logoSize: 96,
        gap: 18,
        speed: 14,
        radius: 8,
        opacity: 88,
        shadow: "soft",
        autoPlay: true,
        safeArea: false,
        showNames: true,
        showTier: true
      },
      sponsors: [{
        id: "legacy_sponsor",
        imageKey: "legacy_blob",
        name: "Legacy Sponsor",
        tier: "gold",
        duration: 7,
        enabled: true
      }],
      playlists: [{
        id: "legacy_playlist",
        name: "Legacy Ticker",
        mode: "ticker",
        defaultDuration: 7,
        sponsorIds: ["legacy_sponsor"]
      }],
      images: {
        legacy_blob: {
          name: "legacy.svg",
          type: "image/svg+xml",
          dataUrl: `data:image/svg+xml;base64,${Buffer.from(legacySvg).toString("base64")}`
        }
      }
    }, null, 2));
    await chooseImportFixture(cdp, legacyFixture, "legacy redesign import");
    await waitFor(
      () => cdp.evaluate(`(() => {
        const state = PepsSponsor.loadState();
        return state.projectName === "Legacy Redesign Import"
          && state.command.type === "import"
          && state.playlists[0]?.mode === "broadcast_ticker";
      })()`),
      "legacy ticker migration"
    );
    const legacyImport = await cdp.evaluate(`(async () => {
      const state = PepsSponsor.loadState();
      const image = state.images[0];
      const playlist = state.playlists.find((item) => item.id === "legacy_playlist");
      const group = state.groups.find((item) => item.id === "group_legacy_playlist");
      const record = await PepsSponsor.dbGetImageRecord(image.id);
      return {
        imageId: image.id,
        playlistMode: playlist?.mode,
        playlistIds: playlist?.sponsorIds || [],
        groupIds: group?.imageIds || [],
        mappedGroup: state.modeGroups.broadcast_ticker,
        blob: await record.blob.text()
      };
    })()`);
    assert(legacyImport.imageId !== "legacy_sponsor", "Legacy import must remap its sponsor ID");
    assert(legacyImport.playlistMode === "broadcast_ticker", "Legacy ticker must map to broadcast_ticker");
    assert(
      legacyImport.playlistIds.length === 1 && legacyImport.playlistIds[0] === legacyImport.imageId,
      "Legacy import did not remap Playlist IDs"
    );
    assert(
      legacyImport.groupIds.length === 1 && legacyImport.groupIds[0] === legacyImport.imageId,
      "Legacy import did not remap Group IDs"
    );
    assert(
      legacyImport.mappedGroup === "group_legacy_playlist",
      "Legacy import did not map broadcast_ticker to its migrated Group"
    );
    assert(legacyImport.blob.includes("LEGACY"), "Legacy import wrote the wrong image blob");

    await chooseImportFixture(cdp, exported.path, "canonical project restore");
    await waitFor(
      () => cdp.evaluate(`(() => {
        const state = PepsSponsor.loadState();
        return state.projectName === "Unified 21 Mode Regression"
          && state.command.type === "import"
          && state.images.length === 2
          && state.groups.some((group) => group.id === "group_beta");
      })()`),
      "canonical project restore after legacy import"
    );
    assertNoBrowserErrors(cdp, transferMarker, "Export/import transaction workflow");

    const librarySections = await cdp.evaluate(`(() => {
      document.getElementById("tab-library").click();
      const read = () => ({
        logosHidden: document.getElementById("view-sponsors").hidden,
        collectionsHidden: document.getElementById("view-collections").hidden,
        groupsHidden: document.querySelector('[data-library-panel="groups"]').hidden,
        playlistsHidden: document.querySelector('[data-library-panel="playlists"]').hidden
      });
      const logos = read();
      document.querySelector('[data-library-section="playlists"]').click();
      const playlists = read();
      document.querySelector('[data-library-section="groups"]').click();
      const groups = read();
      return { logos, playlists, groups };
    })()`);
    assert(!librarySections.logos.logosHidden && librarySections.logos.collectionsHidden, "Logo Library must open as one focused section");
    assert(!librarySections.playlists.playlistsHidden && librarySections.playlists.groupsHidden, "Sponsor sets must hide fixed groups");
    assert(!librarySections.groups.groupsHidden && librarySections.groups.playlistsHidden, "Fixed groups must hide Sponsor sets");

    await cdp.evaluate(`document.getElementById("tab-live").click()`);
    const responsiveResults = [];
    for (const viewport of [
      { width: 340, height: 900 },
      { width: 400, height: 720 },
      { width: 500, height: 900 },
      { width: 720, height: 900 },
      { width: 980, height: 900 },
      { width: 1440, height: 1000 }
    ]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        ...viewport,
        deviceScaleFactor: 1,
        mobile: false
      });
      const result = await cdp.evaluate(`(() => {
        const nav = document.querySelector(".workspace-nav");
        const controls = ["cmdVisibility", "cmdPrev", "cmdPause", "cmdNext", "cmdBreak", "cmdGoal"]
          .map((id) => document.getElementById(id).getBoundingClientRect());
        return {
          width: innerWidth,
          pageFits: document.documentElement.scrollWidth <= innerWidth + 1,
          navFits: nav.scrollWidth <= nav.clientWidth + 1,
          controlsFit: controls.every((rect) => rect.left >= -1 && rect.right <= innerWidth + 1 && rect.width > 0),
          goalTop: document.getElementById("cmdGoal").getBoundingClientRect().top,
          previewVisible: getComputedStyle(document.querySelector(".preview-rail")).display !== "none"
        };
      })()`);
      responsiveResults.push(result);
    }
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    for (const result of responsiveResults) {
      assert(result.pageFits, `Control page overflows horizontally at ${result.width}px`);
      assert(result.navFits, `Primary navigation requires horizontal scrolling at ${result.width}px`);
      assert(result.controlsFit, `Live controls are clipped at ${result.width}px`);
    }
    const dock400 = responsiveResults.find((result) => result.width === 400);
    assert(dock400.goalTop < 720, "Primary Live controls must remain in the first 400x720 Dock viewport");
    assert(!dock400.previewVisible, "Live Preview must collapse in a narrow Dock");

    await cdp.evaluate(`(async () => {
      const base = await PepsSponsor.loadStateAuthoritative();
      const next = PepsSponsor.clone(base);
      const imageIds = next.images.map((image) => image.id);
      next.groups = next.groups.filter((group) => ![
        "group_collision",
        "group__collision",
        "group_collision_h09a9k0f",
        "collision",
        "group_550e8400-e29b-41d4-a716-446655440000",
        "group_550e8400_e29b_41d4_a716_446655440000",
        "กลุ่มพิเศษ"
      ].includes(group.id));
      next.groups.push(
        { id: "group_collision", name: "Generated Collision", imageIds: [...imageIds] },
        { id: "group__collision", name: "Imported Double Separator", imageIds: [...imageIds] },
        { id: "group_collision_h09a9k0f", name: "Hash-lookalike Safe Group", imageIds: [...imageIds] },
        { id: "collision", name: "Imported Collision", imageIds: [...imageIds] },
        {
          id: "group_550e8400-e29b-41d4-a716-446655440000",
          name: "Generated UUID Group",
          imageIds: [...imageIds]
        },
        {
          id: "group_550e8400_e29b_41d4_a716_446655440000",
          name: "Imported UUID Lookalike",
          imageIds: [...imageIds]
        },
        { id: "กลุ่มพิเศษ", name: "Unicode Group", imageIds: [...imageIds] }
      );
      next.modeGroups.bounce = "group_collision";
      next.modeGroups.pulse = "กลุ่มพิเศษ";
      next.modeGroups.wiggle = "group_550e8400-e29b-41d4-a716-446655440000";
      await PepsSponsor.saveStateLocked(next, { base, silent: true });
    })()`);
    await navigate(
      cdp,
      origin,
      "/sponsor-control.html?qa=obs-source-identities#modes",
      (location) => location.pathname.endsWith("/sponsor-control.html")
        && location.hash === "#modes",
      "OBS source identity regression setup"
    );
    await waitFor(
      () => cdp.evaluate(`PepsSponsor.loadState().groups.some((group) => group.id === "กลุ่มพิเศษ")
        && document.querySelector('#outputGroup option[value="collision"]') !== null`),
      "OBS collision groups after reload"
    );

    const obsMarker = cdp.events.length;
    await cdp.evaluate(`(() => {
      document.getElementById("obsPassword").value = "qa-session-only";
      document.getElementById("obsConnectBtn").click();
    })()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.connections.length === 1
        && document.getElementById("obsConnectionBadge").textContent.includes("เชื่อมต่อแล้ว")`),
      "fake OBS connection"
    );
    const connection = await cdp.evaluate(`window.__obsMock.connections[0]`);
    assert(connection.address === "ws://127.0.0.1:4455", `Unexpected OBS address: ${connection.address}`);
    assert(connection.password === "qa-session-only", "OBS session password was not passed to connect");

    await cdp.evaluate(`(() => {
      window.__obsMock.resetCalls();
      document.getElementById("createSourceBtn").click();
    })()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "CreateSceneItem"
        && call.requestData.sourceName === "PEPS_SPONSOR_DISPLAY"
      )`),
      "dynamic OBS source update and missing scene-item recovery"
    );
    const dynamicObs = await cdp.evaluate(`(() => {
      const calls = window.__obsMock.calls;
      return {
        requestTypes: calls.map((call) => call.requestType),
        getInput: calls.find((call) => call.requestType === "GetInputSettings"),
        setInput: calls.find((call) => call.requestType === "SetInputSettings"),
        createInput: calls.find((call) => call.requestType === "CreateInput"),
        createSceneItem: calls.find((call) => call.requestType === "CreateSceneItem")
      };
    })()`);
    assert(dynamicObs.getInput?.requestData.inputName === "PEPS_SPONSOR_DISPLAY", "Dynamic source must inspect the configured input");
    assert(!dynamicObs.createInput, "Existing dynamic input must not be recreated");
    assert(
      dynamicObs.createSceneItem?.requestData.sourceName === "PEPS_SPONSOR_DISPLAY",
      "Existing input missing from the scene must receive CreateSceneItem"
    );
    const dynamicSettings = dynamicObs.setInput?.requestData.inputSettings;
    assert(dynamicObs.setInput?.requestData.inputName === "PEPS_SPONSOR_DISPLAY", "Dynamic source must call SetInputSettings");
    assert(dynamicSettings?.is_local_file === false, "Dynamic Browser Source must disable local-file mode");
    assert(dynamicSettings?.local_file === "", "Dynamic Browser Source must clear stale local_file");
    const dynamicUrl = new URL(dynamicSettings?.url);
    assert(dynamicUrl.pathname.endsWith("/sponsor.html"), "Dynamic source must use the compatibility entry URL");
    assert(dynamicUrl.searchParams.get("mode") === "live", "Dynamic source URL must use mode=live");
    assert(!dynamicUrl.searchParams.has("group"), "Dynamic source URL must not bind a fixed group");

    await cdp.evaluate(`(() => {
      window.__obsMock.resetCalls();
      window.__obsMock.inputs.PEPS_SPONSOR_ORBIT_BETA = {
        inputKind: "browser_source",
        inputSettings: {
          is_local_file: true,
          local_file: "C:/stale/orbit.html",
          url: ""
        }
      };
      delete window.__obsMock.sceneItems.PEPS_SPONSOR_ORBIT_BETA;
      const row = [...document.querySelectorAll("#urlList .url-item")].find((item) => {
        const input = item.querySelector("input");
        if (!input) return false;
        const url = new URL(input.value);
        return url.searchParams.get("mode") === "orbit"
          && url.searchParams.get("group") === "group_beta";
      });
      row?.querySelector(".url-actions button:last-child")?.click();
    })()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "SetInputSettings"
        && call.requestData.inputName === "PEPS_SPONSOR_ORBIT_BETA"
        && new URL(call.requestData.inputSettings.url).searchParams.get("mode") === "orbit"
      ) && window.__obsMock.calls.some((call) =>
        call.requestType === "CreateSceneItem"
        && call.requestData.sourceName === "PEPS_SPONSOR_ORBIT_BETA"
      )`),
      "stale fixed OBS source repair"
    );
    const fixedObs = await cdp.evaluate(`(() => {
      const update = window.__obsMock.calls.find((call) =>
        call.requestType === "SetInputSettings"
        && call.requestData.inputName === "PEPS_SPONSOR_ORBIT_BETA"
      );
      return {
        update,
        create: window.__obsMock.calls.find((call) => call.requestType === "CreateInput"),
        createSceneItem: window.__obsMock.calls.find((call) => call.requestType === "CreateSceneItem"),
        requestTypes: window.__obsMock.calls.map((call) => call.requestType)
      };
    })()`);
    assert(!fixedObs.create, "Repairing a stale fixed source must not create a duplicate OBS input");
    assert(
      fixedObs.update?.requestData.inputName === "PEPS_SPONSOR_ORBIT_BETA",
      `Fixed source name must use stable mode/group IDs: ${fixedObs.update?.requestData.inputName}`
    );
    assert(
      fixedObs.createSceneItem?.requestData.sourceName === "PEPS_SPONSOR_ORBIT_BETA",
      "A repaired fixed source missing from the current scene must receive CreateSceneItem"
    );
    const fixedSettings = fixedObs.update.requestData.inputSettings;
    const fixedUrl = new URL(fixedSettings.url);
    assert(fixedUrl.searchParams.get("mode") === "orbit", "Fixed source URL must retain its explicit mode");
    assert(fixedUrl.searchParams.get("group") === "group_beta", "Fixed source URL must retain its explicit group");
    assert(fixedSettings.is_local_file === false, "Fixed Browser Source must disable local-file mode");
    assert(fixedSettings.local_file === "", "Fixed Browser Source must clear local_file");

    await cdp.evaluate(`(() => {
      window.__obsMock.resetCalls();
      const row = [...document.querySelectorAll("#urlList .url-item")].find((item) => {
        const input = item.querySelector("input");
        if (!input) return false;
        const url = new URL(input.value);
        return url.searchParams.get("mode") === "orbit"
          && url.searchParams.get("group") === "group_beta";
      });
      row?.querySelector(".url-actions button:last-child")?.click();
    })()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "SetInputSettings"
        && call.requestData.inputName === "PEPS_SPONSOR_ORBIT_BETA"
      )`),
      "existing fixed OBS source update"
    );
    const repeatedFixedSource = await cdp.evaluate(`({
      creates: window.__obsMock.calls.filter((call) => call.requestType === "CreateInput").length,
      updates: window.__obsMock.calls.filter((call) => call.requestType === "SetInputSettings").length
    })`);
    assert(repeatedFixedSource.creates === 0, "Updating a fixed source must not create a duplicate OBS input");
    assert(repeatedFixedSource.updates === 1, "Updating a fixed source must call SetInputSettings once");

    await cdp.evaluate(`(() => {
      window.__obsMock.resetCalls();
      const mode = document.getElementById("outputMode");
      mode.value = "bounce";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await waitFor(
      () => cdp.evaluate(`new URL(document.getElementById("currentModeUrl").value).searchParams.get("group") === "group_collision"
        && PepsSponsor.loadState().mode === "bounce"
        && PepsSponsor.loadState().modeGroups.bounce === "group_collision"`),
      "generated collision-group Mode URL"
    );
    await cdp.evaluate(`(() => {
      const legacyUrl = new URL(document.getElementById("currentModeUrl").value);
      legacyUrl.searchParams.set("group", "collision");
      window.__obsMock.inputs.PEPS_SPONSOR_BOUNCE_COLLISION = {
        inputKind: "browser_source",
        inputSettings: { is_local_file: false, url: legacyUrl.href }
      };
      window.__obsMock.sceneItems.PEPS_SPONSOR_BOUNCE_COLLISION = ++window.__obsMock.nextSceneItemId;
      document.getElementById("createModeSourceBtn").click();
    })()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "CreateInput"
        && new URL(call.requestData.inputSettings.url).searchParams.get("group") === "group_collision"
      )`),
      "first collision-safe OBS source"
    );
    const collisionGroupChange = await cdp.evaluate(`(() => {
      const group = document.getElementById("outputGroup");
      group.value = "collision";
      group.dispatchEvent(new Event("change", { bubbles: true }));
      return {
        value: group.value,
        mode: document.getElementById("outputMode").value,
        currentUrlGroup: new URL(document.getElementById("currentModeUrl").value).searchParams.get("group"),
        persistedGroup: PepsSponsor.loadState().modeGroups.bounce,
        optionValues: [...group.options].map((option) => option.value)
      };
    })()`);
    assert(
      collisionGroupChange.value === "collision"
        && collisionGroupChange.mode === "bounce"
        && collisionGroupChange.currentUrlGroup === "collision",
      `Imported collision Group selection did not update Mode Studio: ${JSON.stringify(collisionGroupChange)}`
    );
    await waitFor(
      () => cdp.evaluate(`new URL(document.getElementById("currentModeUrl").value).searchParams.get("group") === "collision"
        && PepsSponsor.loadState().modeGroups.bounce === "collision"`),
      "imported collision-group Mode URL"
    );
    await cdp.evaluate(`document.getElementById("createModeSourceBtn").click()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "SetInputSettings"
        && new URL(call.requestData.inputSettings.url).searchParams.get("mode") === "bounce"
        && new URL(call.requestData.inputSettings.url).searchParams.get("group") === "collision"
      )`),
      "relocated collision-safe OBS source update"
    );
    await cdp.evaluate(`(() => {
      const group = document.getElementById("outputGroup");
      group.value = "group__collision";
      group.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await waitFor(
      () => cdp.evaluate(`new URL(document.getElementById("currentModeUrl").value).searchParams.get("group") === "group__collision"
        && PepsSponsor.loadState().modeGroups.bounce === "group__collision"`),
      "double-separator collision-group Mode URL"
    );
    await cdp.evaluate(`document.getElementById("createModeSourceBtn").click()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.filter((call) =>
        call.requestType === "CreateInput"
        && new URL(call.requestData.inputSettings.url).searchParams.get("mode") === "bounce"
      ).length === 2`),
      "third collision-safe OBS source"
    );
    await cdp.evaluate(`(() => {
      const group = document.getElementById("outputGroup");
      group.value = "group_collision_h09a9k0f";
      group.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await waitFor(
      () => cdp.evaluate(`new URL(document.getElementById("currentModeUrl").value).searchParams.get("group")
        === "group_collision_h09a9k0f"
        && PepsSponsor.loadState().modeGroups.bounce === "group_collision_h09a9k0f"`),
      "hash-lookalike safe Group Mode URL"
    );
    await cdp.evaluate(`document.getElementById("createModeSourceBtn").click()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.filter((call) =>
        call.requestType === "CreateInput"
        && new URL(call.requestData.inputSettings.url).searchParams.get("mode") === "bounce"
      ).length === 3`),
      "hash-lookalike safe OBS source"
    );
    const collisionSources = await cdp.evaluate(`(() => {
      return Object.entries(window.__obsMock.inputs)
        .filter(([name, input]) => name.startsWith("PEPS_SPONSOR_BOUNCE_")
          && new URL(input.inputSettings.url).searchParams.get("mode") === "bounce")
        .map(([name, input]) => ({
          name,
          group: new URL(input.inputSettings.url).searchParams.get("group")
        }));
    })()`);
    const generatedCollision = collisionSources.find((source) => source.group === "group_collision");
    const importedCollision = collisionSources.find((source) => source.group === "collision");
    const doubleSeparatorCollision = collisionSources.find((source) => source.group === "group__collision");
    const hashLookalikeCollision = collisionSources.find((source) => source.group === "group_collision_h09a9k0f");
    assert(
      generatedCollision?.name === "PEPS_SPONSOR_BOUNCE_COLLISION",
      `Generated Group IDs must retain their existing stable source name: ${JSON.stringify(collisionSources)}`
    );
    assert(
      importedCollision?.name === "PEPS_SPONSOR_BOUNCE_COLLISION__H09A9K0F"
        && importedCollision.name !== generatedCollision.name,
      `Lossy imported Group IDs must receive a distinct stable hash: ${JSON.stringify(collisionSources)}`
    );
    assert(
      doubleSeparatorCollision?.name.startsWith("PEPS_SPONSOR_BOUNCE_COLLISION_")
        && doubleSeparatorCollision.name !== generatedCollision.name
        && doubleSeparatorCollision.name !== importedCollision.name,
      `Non-canonical separators must not collide after sanitization: ${JSON.stringify(collisionSources)}`
    );
    assert(
      hashLookalikeCollision?.name === "PEPS_SPONSOR_BOUNCE_COLLISION_H09A9K0F"
        && hashLookalikeCollision.name !== importedCollision.name,
      `A safe Group must not impersonate the imported hash namespace: ${JSON.stringify(collisionSources)}`
    );
    assert(
      collisionSources.length === 4,
      `Each distinct colliding Group must retain exactly one OBS source: ${JSON.stringify(collisionSources)}`
    );

    await cdp.evaluate(`(() => {
      window.__obsMock.resetCalls();
      const mode = document.getElementById("outputMode");
      mode.value = "wiggle";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await waitFor(
      () => cdp.evaluate(`new URL(document.getElementById("currentModeUrl").value).searchParams.get("group")
        === "group_550e8400-e29b-41d4-a716-446655440000"`),
      "generated UUID Group Mode URL"
    );
    await cdp.evaluate(`document.getElementById("createModeSourceBtn").click()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "CreateInput"
        && new URL(call.requestData.inputSettings.url).searchParams.get("mode") === "wiggle"
        && new URL(call.requestData.inputSettings.url).searchParams.get("group")
          === "group_550e8400-e29b-41d4-a716-446655440000"
      )`),
      "generated UUID OBS source"
    );
    await cdp.evaluate(`(() => {
      const group = document.getElementById("outputGroup");
      group.value = "group_550e8400_e29b_41d4_a716_446655440000";
      group.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await waitFor(
      () => cdp.evaluate(`new URL(document.getElementById("currentModeUrl").value).searchParams.get("group")
        === "group_550e8400_e29b_41d4_a716_446655440000"`),
      "imported UUID-lookalike Group Mode URL"
    );
    await cdp.evaluate(`document.getElementById("createModeSourceBtn").click()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.filter((call) =>
        call.requestType === "CreateInput"
        && new URL(call.requestData.inputSettings.url).searchParams.get("mode") === "wiggle"
      ).length === 2`),
      "collision-safe UUID-lookalike OBS source"
    );
    const uuidSources = await cdp.evaluate(`Object.entries(window.__obsMock.inputs)
      .filter(([name, input]) => name.startsWith("PEPS_SPONSOR_WIGGLE_")
        && new URL(input.inputSettings.url).searchParams.get("mode") === "wiggle")
      .map(([name, input]) => ({
        name,
        group: new URL(input.inputSettings.url).searchParams.get("group")
      }))`);
    const generatedUuidSource = uuidSources.find((source) =>
      source.group === "group_550e8400-e29b-41d4-a716-446655440000"
    );
    const importedUuidLookalikeSource = uuidSources.find((source) =>
      source.group === "group_550e8400_e29b_41d4_a716_446655440000"
    );
    assert(
      generatedUuidSource?.name === "PEPS_SPONSOR_WIGGLE_550E8400_E29B_41D4_A716_446655440000",
      `Generated UUID Group must retain its established OBS source name: ${JSON.stringify(uuidSources)}`
    );
    assert(
      importedUuidLookalikeSource?.name.startsWith(
        "PEPS_SPONSOR_WIGGLE_550E8400_E29B_41D4_A716_446655440000_"
      ) && importedUuidLookalikeSource.name !== generatedUuidSource.name,
      `Imported underscore UUID must receive a distinct hash: ${JSON.stringify(uuidSources)}`
    );
    assert(uuidSources.length === 2, `UUID-lookalike Groups must retain two distinct OBS sources: ${JSON.stringify(uuidSources)}`);

    await cdp.evaluate(`(() => {
      window.__obsMock.resetCalls();
      const mode = document.getElementById("outputMode");
      mode.value = "pulse";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await waitFor(
      () => cdp.evaluate(`new URL(document.getElementById("currentModeUrl").value).searchParams.get("group") === "กลุ่มพิเศษ"`),
      "Unicode Group Mode URL"
    );
    await cdp.evaluate(`(() => {
      const legacyName = "PEPS_SPONSOR_PULSE_GROUP";
      const url = document.getElementById("currentModeUrl").value;
      window.__obsMock.inputs[legacyName] = {
        inputKind: "browser_source",
        inputSettings: { is_local_file: false, url }
      };
      window.__obsMock.sceneItems[legacyName] = 993;
      document.getElementById("refreshModeSourceBtn").click();
    })()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "SetInputName"
        && call.requestData.inputName === "PEPS_SPONSOR_PULSE_GROUP"
      ) && window.__obsMock.calls.some((call) => call.requestType === "PressInputPropertiesButton")`),
      "Unicode legacy source migration during Refresh"
    );
    const refreshedUnicodeSource = await cdp.evaluate(`(() => {
      const rename = window.__obsMock.calls.find((call) =>
        call.requestType === "SetInputName"
        && call.requestData.inputName === "PEPS_SPONSOR_PULSE_GROUP"
      );
      const refresh = window.__obsMock.calls.find((call) => call.requestType === "PressInputPropertiesButton");
      return {
        oldExists: !!window.__obsMock.inputs.PEPS_SPONSOR_PULSE_GROUP,
        renamedTo: rename?.requestData.newInputName || "",
        refreshed: refresh?.requestData.inputName || "",
        creates: window.__obsMock.calls.filter((call) => call.requestType === "CreateInput").length
      };
    })()`);
    assert(!refreshedUnicodeSource.oldExists, "Refresh must migrate the matching pre-hash source");
    assert(
      refreshedUnicodeSource.renamedTo.startsWith("PEPS_SPONSOR_PULSE_GROUP_")
        && refreshedUnicodeSource.refreshed === refreshedUnicodeSource.renamedTo,
      `Refresh must target the migrated Unicode source: ${JSON.stringify(refreshedUnicodeSource)}`
    );
    assert(refreshedUnicodeSource.creates === 0, "Refresh migration must not create a duplicate OBS input");

    for (const aliasMigration of [
      {
        canonicalMode: "lower_third",
        legacyMode: "bottom_bar",
        legacyName: "PEPS_SPONSOR_BOTTOM_BAR_BETA",
        canonicalName: "PEPS_SPONSOR_LOWER_THIRD_BETA"
      },
      {
        canonicalMode: "sponsor_break",
        legacyMode: "fullscreen_break",
        legacyName: "PEPS_SPONSOR_FULLSCREEN_BREAK_BETA",
        canonicalName: "PEPS_SPONSOR_SPONSOR_BREAK_BETA"
      }
    ]) {
      await cdp.evaluate(`(() => {
        const mode = document.getElementById("outputMode");
        mode.value = ${JSON.stringify(aliasMigration.canonicalMode)};
        mode.dispatchEvent(new Event("change", { bubbles: true }));
      })()`);
      await waitFor(
        () => cdp.evaluate(`PepsSponsor.loadState().mode === ${JSON.stringify(aliasMigration.canonicalMode)}
          && new URL(document.getElementById("currentModeUrl").value).searchParams.get("group") === "group_beta"`),
        `${aliasMigration.canonicalMode} selection before legacy alias migration`
      );
      await cdp.evaluate(`(() => {
        window.__obsMock.resetCalls();
        const canonicalUrl = new URL(document.getElementById("currentModeUrl").value);
        canonicalUrl.searchParams.set("mode", ${JSON.stringify(aliasMigration.legacyMode)});
        window.__obsMock.inputs[${JSON.stringify(aliasMigration.legacyName)}] = {
          inputKind: "browser_source",
          inputSettings: { is_local_file: false, url: canonicalUrl.href }
        };
        window.__obsMock.sceneItems[${JSON.stringify(aliasMigration.legacyName)}] = ++window.__obsMock.nextSceneItemId;
        document.getElementById("createModeSourceBtn").click();
      })()`);
      await waitFor(
        () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
          call.requestType === "SetInputName"
          && call.requestData.inputName === ${JSON.stringify(aliasMigration.legacyName)}
          && call.requestData.newInputName === ${JSON.stringify(aliasMigration.canonicalName)}
        )`),
        `${aliasMigration.legacyMode} OBS alias migration`
      );
      const aliasMigrationResult = await cdp.evaluate(`({
        creates: window.__obsMock.calls.filter((call) => call.requestType === "CreateInput").length,
        legacyExists: !!window.__obsMock.inputs[${JSON.stringify(aliasMigration.legacyName)}],
        canonicalExists: !!window.__obsMock.inputs[${JSON.stringify(aliasMigration.canonicalName)}]
      })`);
      assert(
        aliasMigrationResult.creates === 0
          && !aliasMigrationResult.legacyExists
          && aliasMigrationResult.canonicalExists,
        `${aliasMigration.legacyMode} must migrate without duplicating its canonical OBS source: ${JSON.stringify(aliasMigrationResult)}`
      );
    }

    await cdp.evaluate(`(() => {
      window.__obsMock.resetCalls();
      const row = [...document.querySelectorAll("#urlList .url-item")].find((item) => {
        const input = item.querySelector("input");
        return input && new URL(input.value).searchParams.get("mode") === "spotlight";
      });
      const legacyName = "PepsLive Sponsor Dock - " + PepsSponsorModes.labels.spotlight + " - Beta Group";
      window.__obsMock.inputs[legacyName] = {
        inputKind: "browser_source",
        inputSettings: { is_local_file: false, url: row.querySelector("input").value }
      };
      window.__obsMock.sceneItems[legacyName] = 991;
      row?.querySelector(".url-actions button:last-child")?.click();
    })()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "SetInputName"
        && call.requestData.newInputName === "PEPS_SPONSOR_SPOTLIGHT_BETA"
      )`),
      "legacy fixed OBS source migration"
    );
    const migratedFixedSource = await cdp.evaluate(`({
      creates: window.__obsMock.calls.filter((call) => call.requestType === "CreateInput").length,
      canonicalExists: !!window.__obsMock.inputs.PEPS_SPONSOR_SPOTLIGHT_BETA,
      legacyExists: Object.keys(window.__obsMock.inputs).some((name) => name.startsWith("PepsLive Sponsor Dock -") && name.includes("Beta Group"))
    })`);
    assert(migratedFixedSource.creates === 0, "Migrating a legacy fixed source must not create a duplicate input");
    assert(migratedFixedSource.canonicalExists, "Legacy fixed source must be renamed to the canonical ID-based name");

    await cdp.evaluate(`(() => {
      window.__obsMock.resetCalls();
      const row = [...document.querySelectorAll("#urlList .url-item")].find((item) => {
        const input = item.querySelector("input");
        return input && new URL(input.value).searchParams.get("mode") === "side_tower";
      });
      const legacyName = "PepsLive Sponsor Dock - ชื่อโหมดเดิม - ชื่อกลุ่มก่อนแก้";
      window.__obsMock.inputs[legacyName] = {
        inputKind: "browser_source",
        inputSettings: { is_local_file: false, url: row.querySelector("input").value }
      };
      window.__obsMock.sceneItems[legacyName] = 992;
      row?.querySelector(".url-actions button:last-child")?.click();
    })()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "SetInputName"
        && call.requestData.newInputName === "PEPS_SPONSOR_SIDE_TOWER_BETA"
      )`),
      "renamed legacy fixed OBS source discovery"
    );
    const discoveredLegacySource = await cdp.evaluate(`({
      creates: window.__obsMock.calls.filter((call) => call.requestType === "CreateInput").length,
      canonicalExists: !!window.__obsMock.inputs.PEPS_SPONSOR_SIDE_TOWER_BETA
    })`);
    assert(discoveredLegacySource.creates === 0, "A legacy source with the same display URL must not be duplicated");
    assert(discoveredLegacySource.canonicalExists, "A renamed legacy source must migrate by matching its display URL");

    await cdp.evaluate(`(() => {
      const mode = document.getElementById("outputMode");
      mode.value = "spotlight";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await waitFor(
      () => cdp.evaluate(`PepsSponsor.loadState().mode === "spotlight"
        && new URL(document.getElementById("currentModeUrl").value).searchParams.get("group") === "group_beta"`),
      "Spotlight Mode selection before fixed-source Refresh"
    );
    const fixedRefreshCommandId = await cdp.evaluate(`(() => {
      window.__obsMock.resetCalls();
      const commandId = PepsSponsor.loadState().command.id;
      document.getElementById("refreshModeSourceBtn").click();
      return commandId;
    })()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "PressInputPropertiesButton"
        && call.requestData.inputName === "PEPS_SPONSOR_SPOTLIGHT_BETA"
      )`),
      "fixed Mode Studio source refresh"
    );
    const fixedRefreshAfter = await cdp.evaluate(`PepsSponsor.loadState().command.id`);
    assert(
      fixedRefreshAfter === fixedRefreshCommandId,
      "Refreshing a fixed source must not broadcast a reload command to the Live Display"
    );

    await cdp.evaluate(`(() => {
      window.__obsMock.resetCalls();
      const row = [...document.querySelectorAll("#urlList .url-item")].find((item) => {
        const input = item.querySelector("input");
        return input && new URL(input.value).searchParams.get("mode") === "display";
      });
      const legacyName = "PEPS_SPONSOR_DISPLAY_SPOTLIGHT_BETA";
      window.__obsMock.inputs[legacyName] = {
        inputKind: "browser_source",
        inputSettings: { is_local_file: false, url: row.querySelector("input").value }
      };
      window.__obsMock.sceneItems[legacyName] = ++window.__obsMock.nextSceneItemId;
      row?.querySelector(".url-actions button:last-child")?.click();
    })()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "SetInputName"
        && call.requestData.inputName === "PEPS_SPONSOR_DISPLAY_SPOTLIGHT_BETA"
        && call.requestData.newInputName === "PEPS_SPONSOR_CLASSIC_DISPLAY"
      )`),
      "Classic Display legacy source migration"
    );
    const classicDisplayMigration = await cdp.evaluate(`({
      creates: window.__obsMock.calls.filter((call) => call.requestType === "CreateInput").length,
      canonicalExists: !!window.__obsMock.inputs.PEPS_SPONSOR_CLASSIC_DISPLAY,
      legacyExists: !!window.__obsMock.inputs.PEPS_SPONSOR_DISPLAY_SPOTLIGHT_BETA
    })`);
    assert(
      classicDisplayMigration.creates === 0
        && classicDisplayMigration.canonicalExists
        && !classicDisplayMigration.legacyExists,
      `Classic Display must migrate its mode-dependent legacy source without duplication: ${JSON.stringify(classicDisplayMigration)}`
    );
    await cdp.evaluate(`(() => {
      const mode = document.getElementById("outputMode");
      mode.value = "lower_third";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await waitFor(
      () => cdp.evaluate(`PepsSponsor.loadState().mode === "lower_third"
        && new URL(document.getElementById("currentModeUrl").value).searchParams.get("group") === "group_beta"`),
      "Mode change before Classic Display source reuse"
    );
    await cdp.evaluate(`(() => {
      window.__obsMock.resetCalls();
      const row = [...document.querySelectorAll("#urlList .url-item")].find((item) => {
        const input = item.querySelector("input");
        return input && new URL(input.value).searchParams.get("mode") === "display";
      });
      row?.querySelector(".url-actions button:last-child")?.click();
    })()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "SetInputSettings"
        && call.requestData.inputName === "PEPS_SPONSOR_CLASSIC_DISPLAY"
      )`),
      "Classic Display source reuse after Mode change"
    );
    const classicDisplayReuse = await cdp.evaluate(`(() => {
      const displayInputs = Object.entries(window.__obsMock.inputs).filter(([, input]) =>
        new URL(input.inputSettings?.url || "", location.href).searchParams.get("mode") === "display"
      );
      return {
        creates: window.__obsMock.calls.filter((call) => call.requestType === "CreateInput").length,
        displayInputNames: displayInputs.map(([name]) => name)
      };
    })()`);
    assert(
      classicDisplayReuse.creates === 0
        && classicDisplayReuse.displayInputNames.length === 1
        && classicDisplayReuse.displayInputNames[0] === "PEPS_SPONSOR_CLASSIC_DISPLAY",
      `Classic Display must reuse one stable OBS source across Mode changes: ${JSON.stringify(classicDisplayReuse)}`
    );

    await cdp.evaluate(`(() => {
      window.__obsMock.resetCalls();
      const row = [...document.querySelectorAll("#urlList .url-item")].find((item) => {
        const input = item.querySelector("input");
        return input && new URL(input.value).searchParams.get("mode") === "auto";
      });
      row?.querySelector(".url-actions button:last-child")?.click();
    })()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "CreateInput"
        && new URL(call.requestData.inputSettings.url).searchParams.get("mode") === "auto"
      )`),
      "Classic Auto OBS source creation"
    );
    const classicAutoObs = await cdp.evaluate(`window.__obsMock.calls.find((call) =>
      call.requestType === "CreateInput"
      && new URL(call.requestData.inputSettings.url).searchParams.get("mode") === "auto"
    )`);
    assert(
      classicAutoObs.requestData.inputName === "PEPS_SPONSOR_AUTO_BETA",
      `Classic Auto source name changed: ${classicAutoObs.requestData.inputName}`
    );
    const classicAutoUrl = new URL(classicAutoObs.requestData.inputSettings.url);
    assert(classicAutoUrl.searchParams.get("mode") === "auto", "Classic Auto source must retain mode=auto");
    assert(
      classicAutoUrl.searchParams.get("group") === "group_beta",
      "Classic Auto source must lock its active group"
    );

    await cdp.evaluate(`(() => {
      window.__obsMock.resetCalls();
      document.getElementById("showSourceBtn").click();
    })()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "SetSceneItemEnabled"
        && call.requestData.sceneItemEnabled === true
      )`),
      "show dynamic OBS scene item"
    );
    await cdp.evaluate(`document.getElementById("hideSourceBtn").click()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "SetSceneItemEnabled"
        && call.requestData.sceneItemEnabled === false
      )`),
      "hide dynamic OBS scene item"
    );
    await cdp.evaluate(`document.getElementById("refreshSourceBtn").click()`);
    await waitFor(
      () => cdp.evaluate(`window.__obsMock.calls.some((call) =>
        call.requestType === "PressInputPropertiesButton"
      )`),
      "refresh dynamic OBS source"
    );
    const dynamicActions = await cdp.evaluate(`(() => ({
      visibility: window.__obsMock.calls
        .filter((call) => call.requestType === "SetSceneItemEnabled")
        .map((call) => call.requestData),
      refresh: window.__obsMock.calls.find((call) =>
        call.requestType === "PressInputPropertiesButton"
      )
    }))()`);
    assert(dynamicActions.visibility.length === 2, "Show and hide must each issue SetSceneItemEnabled");
    assert(
      dynamicActions.visibility.every((call) => call.sceneName === "QA Program Scene"),
      "Show/hide must target the current program scene"
    );
    assert(
      dynamicActions.refresh?.requestData.inputName === "PEPS_SPONSOR_DISPLAY",
      "Refresh must target the dynamic source"
    );
    assert(
      dynamicActions.refresh?.requestData.propertyName === "refreshnocache",
      "Refresh must press the browser-source refreshnocache property"
    );
    assertNoBrowserErrors(cdp, obsMarker, "Fake OBS WebSocket workflow");

    await wait(200);
    assertNoBrowserErrors(cdp, seededControlMarker, "Seeded Control UI");

    await cdp.evaluate(`(async () => {
      const base = await PepsSponsor.loadStateAuthoritative();
      const next = PepsSponsor.clone(base);
      next.mode = "grid";
      next.activeGroupId = "group_beta";
      await PepsSponsor.saveStateLocked(next, { base, silent: true });
    })()`);

    const routeMarker = cdp.events.length;
    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=live&qa=live-route",
      (location) => location.pathname.endsWith("/sponsor-display.html")
        && new URL(location.href).searchParams.get("mode") === "live",
      "mode=live playlist route"
    );
    await waitForDisplay(cdp, "lower_third", "group_alpha", "Beta Sponsor");
    const liveRoute = await cdp.evaluate(`({
      mode: new URL(location.href).searchParams.get("mode"),
      qa: new URL(location.href).searchParams.get("qa")
    })`);
    assert(liveRoute.mode === "live", "mode=live must remain the playlist-managed route");
    assert(liveRoute.qa === "live-route", "mode=live must preserve extra query parameters");

    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=display&qa=display-route",
      (location) => location.pathname.endsWith("/sponsor-display.html")
        && new URL(location.href).searchParams.get("mode") === "display",
      "mode=display compatibility route"
    );
    await waitForDisplay(cdp, "grid", "group_beta", "Beta Sponsor");
    const displayRoute = await cdp.evaluate(`({
      mode: new URL(location.href).searchParams.get("mode"),
      qa: new URL(location.href).searchParams.get("qa")
    })`);
    assert(displayRoute.mode === "display", "mode=display must remain a Classic Mode Studio alias");
    assert(displayRoute.qa === "display-route", "mode=display must preserve extra query parameters");

    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=auto&group=group_beta&qa=auto-route",
      (location) => location.pathname.endsWith("/sponsor-display.html")
        && new URL(location.href).searchParams.get("mode") === "auto",
      "mode=auto compatibility route"
    );
    await waitForDisplay(cdp, "grid", "group_beta", "Beta Sponsor");
    const autoSemantics = await cdp.evaluate(`({
      requestedGroup: new URL(location.href).searchParams.get("group"),
      renderedGroup: document.getElementById("displayStage").dataset.group,
      renderer: document.getElementById("sponsorLayer").dataset.renderer
    })`);
    assert(autoSemantics.requestedGroup === "group_beta", "Classic Auto must retain its locked group");
    assert(
      autoSemantics.renderedGroup === "group_beta",
      "Classic Auto must follow the Mode Studio group instead of a fixed URL group"
    );
    assert(autoSemantics.renderer === "grid", "Classic Auto must follow the Mode Studio mode");

    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=orbit&qa=mapped-group",
      (location) => location.pathname.endsWith("/sponsor-display.html")
        && new URL(location.href).searchParams.get("mode") === "orbit",
      "explicit mode mapped-group route"
    );
    await waitForDisplay(cdp, "orbit", "group_beta", "Beta Sponsor");
    assert(
      await cdp.evaluate(`!new URL(location.href).searchParams.has("group")`),
      "Explicit route without group must not invent a query parameter"
    );

    const modeIds = await cdp.evaluate(`PepsSponsorModes.ids`);
    const visibilityProject = await seedCapacityProject(cdp);
    assert(
      visibilityProject.sponsorIds.length === 5,
      `Mode visibility fixture must contain multiple sponsors: ${JSON.stringify(visibilityProject)}`
    );

    await navigate(
      cdp,
      origin,
      "/sponsor-control.html?qa=mode-studio-visibility#modes",
      (location) => location.pathname.endsWith("/sponsor-control.html")
        && location.hash === "#modes",
      "Mode Studio visibility control route"
    );
    await waitFor(
      () => cdp.evaluate(`document.readyState === "complete"
        && PepsSponsor.loadState().projectName === "Capacity Playback Regression"
        && document.getElementById("outputMode") !== null
        && document.getElementById("previewFrame")?.contentDocument?.readyState === "complete"`),
      "Mode Studio visibility initialization"
    );

    for (const mode of modeIds) {
      await cdp.evaluate(`(() => {
        const select = document.getElementById("outputMode");
        select.value = ${JSON.stringify(mode)};
        select.dispatchEvent(new Event("change", { bubbles: true }));
      })()`);
      await waitFor(
        () => cdp.evaluate(`(async () => {
          const saved = await PepsSponsor.loadStateAuthoritative();
          const currentUrl = new URL(document.getElementById("currentModeUrl").value);
          const preview = document.getElementById("previewFrame")?.contentWindow;
          return saved.mode === ${JSON.stringify(mode)}
            && saved.modeGroups[${JSON.stringify(mode)}] === "group_capacity"
            && document.getElementById("outputMode").value === ${JSON.stringify(mode)}
            && currentUrl.searchParams.get("mode") === ${JSON.stringify(mode)}
            && currentUrl.searchParams.get("group") === "group_capacity"
            && preview?.location?.pathname.endsWith("/sponsor-display.html")
            && new URL(preview.location.href).searchParams.get("mode") === ${JSON.stringify(mode)}
            && new URL(preview.location.href).searchParams.get("group") === "group_capacity";
        })()`),
        `${mode} Mode Studio selection, persistence, URL, and preview route`
      );
      const previewVisibility = await waitForModeVisible(cdp, mode, {
        frameSelector: "#previewFrame",
        groupId: "group_capacity"
      });
      assert(
        previewVisibility.viewport.width === 1920 && previewVisibility.viewport.height === 1080,
        `${mode} Mode Studio preview must render at 1920x1080: ${JSON.stringify(previewVisibility.viewport)}`
      );
    }
    assertNoBrowserErrors(cdp, routeMarker, "Mode Studio selection and preview visibility");

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false
    });
    try {
      for (const mode of modeIds) {
        await navigate(
          cdp,
          origin,
          `/sponsor.html?mode=${encodeURIComponent(mode)}&group=group_capacity&qa=explicit-visible`,
          (location) => location.pathname.endsWith("/sponsor-display.html")
            && new URL(location.href).searchParams.get("mode") === mode,
          `${mode} explicit compatibility route`
        );
        const visibility = await waitForModeVisible(cdp, mode, { groupId: "group_capacity" });
        assert(
          visibility.viewport.width === 1280 && visibility.viewport.height === 720,
          `${mode} explicit output must use the 1280x720 OBS fixture`
        );
        const explicit = await cdp.evaluate(`({
          mode: new URL(location.href).searchParams.get("mode"),
          group: new URL(location.href).searchParams.get("group"),
          qa: new URL(location.href).searchParams.get("qa"),
          renderer: document.getElementById("sponsorLayer").dataset.renderer,
          renderedGroup: document.getElementById("displayStage").dataset.group
        })`);
        assert(explicit.mode === mode, `${mode} route changed the explicit mode`);
        assert(explicit.group === "group_capacity", `${mode} route changed the explicit group`);
        assert(explicit.qa === "explicit-visible", `${mode} route lost an unrelated query parameter`);
        assert(explicit.renderer === mode, `${mode} rendered as ${explicit.renderer}`);
        assert(explicit.renderedGroup === "group_capacity", `${mode} used the wrong group`);
        if (MODE_MOTION_SELECTORS[mode]) await assertModeMotion(cdp, mode);
        if (MODE_CYCLE_MODES.has(mode)) await assertModeCycle(cdp, mode);
      }

      for (const resizedMode of ["ticker", "orbit", "cover3d"]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: 1920,
          height: 1080,
          deviceScaleFactor: 1,
          mobile: false
        });
        await navigate(
          cdp,
          origin,
          `/sponsor.html?mode=${encodeURIComponent(resizedMode)}&group=group_capacity&qa=resize-reflow`,
          (location) => location.pathname.endsWith("/sponsor-display.html")
            && new URL(location.href).searchParams.get("mode") === resizedMode,
          `${resizedMode} pre-resize output`
        );
        await waitForModeVisible(cdp, resizedMode, { groupId: "group_capacity" });
        await cdp.evaluate(`document.querySelector("#sponsorLayer > .psm-host").dataset.qaBeforeResize = "1"`);
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: 640,
          height: 360,
          deviceScaleFactor: 1,
          mobile: false
        });
        await waitFor(
          () => cdp.evaluate(`innerWidth === 640
            && innerHeight === 360
            && document.querySelector("#sponsorLayer > .psm-host")?.dataset.qaBeforeResize !== "1"`),
          `${resizedMode} renderer refresh after in-place resize`
        );
        const resizedVisibility = await waitForModeVisible(cdp, resizedMode, {
          groupId: "group_capacity"
        });
        assert(
          resizedVisibility.viewport.width === 640
            && resizedVisibility.viewport.height === 360
            && resizedVisibility.visibleCount > 0,
          `${resizedMode} must reflow after an in-place OBS viewport resize: ${JSON.stringify(resizedVisibility)}`
        );
      }
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false
      });

      for (const [legacyMode, canonicalMode] of [
        ["bottom_bar", "lower_third"],
        ["fullscreen_break", "sponsor_break"]
      ]) {
        await navigate(
          cdp,
          origin,
          `/sponsor.html?mode=${legacyMode}&group=group_capacity&qa=legacy-alias`,
          (location) => location.pathname.endsWith("/sponsor-display.html")
            && new URL(location.href).searchParams.get("mode") === legacyMode,
          `${legacyMode} legacy display alias`
        );
        await waitForModeVisible(cdp, canonicalMode, { groupId: "group_capacity" });
        assert(
          await cdp.evaluate(
            `document.getElementById("sponsorLayer").dataset.renderer === ${JSON.stringify(canonicalMode)}`
          ),
          `${legacyMode} must render through ${canonicalMode}`
        );
      }

      await cdp.evaluate(`(async () => {
        const base = await PepsSponsor.loadStateAuthoritative();
        const next = PepsSponsor.clone(base);
        next.activePlaylist = "pl_capacity_live";
        next.isVisible = true;
        next.isPaused = true;
        next.settings.autoPlay = false;
        next.playlists = next.playlists.map((playlist) => playlist.id === "pl_capacity_live"
          ? {
              ...playlist,
              mode: "rain",
              groupId: "group_capacity",
              sponsorIds: ["cap_a", "cap_b", "cap_c", "cap_d", "cap_e"]
            }
          : playlist);
        await PepsSponsor.saveStateLocked(next, { base, silent: true });
      })()`);
      await navigate(
        cdp,
        origin,
        "/sponsor.html?mode=live&qa=paused-rain-visible",
        (location) => location.pathname.endsWith("/sponsor-display.html")
          && new URL(location.href).searchParams.get("mode") === "live",
        "paused Logo Rain output"
      );
      await waitForModeVisible(cdp, "rain", { groupId: "group_capacity" });
      assert(
        await cdp.evaluate(`document.querySelector("#sponsorLayer > .psm-host")?.classList.contains("psm-paused") === true`),
        "Paused Logo Rain regression must exercise the paused renderer"
      );

      for (const pausedMode of ["grid", "bounce", "lower_third", "goal_popup"]) {
        await cdp.evaluate(`(async () => {
          const base = await PepsSponsor.loadStateAuthoritative();
          const next = PepsSponsor.clone(base);
          next.isPaused = true;
          next.settings.autoPlay = false;
          next.playlists = next.playlists.map((playlist) => playlist.id === "pl_capacity_live"
            ? { ...playlist, mode: ${JSON.stringify(pausedMode)} }
            : playlist);
          await PepsSponsor.saveStateLocked(next, { base, silent: true });
        })()`);
        await navigate(
          cdp,
          origin,
          `/sponsor.html?mode=live&qa=paused-${encodeURIComponent(pausedMode)}-visible`,
          (location) => location.pathname.endsWith("/sponsor-display.html")
            && new URL(location.href).searchParams.get("mode") === "live",
          `paused ${pausedMode} output`
        );
        await waitForModeVisible(cdp, pausedMode, { groupId: "group_capacity" });
        assert(
          await cdp.evaluate(`document.querySelector("#sponsorLayer > .psm-host")?.classList.contains("psm-paused") === true`),
          `Paused ${pausedMode} regression must exercise the paused renderer`
        );
        if (pausedMode === "bounce") {
          const pausedBounceTransforms = await cdp.evaluate(`[
            ...document.querySelectorAll("#sponsorLayer .psm-bounce img.psm-logo")
          ].map((image) => image.style.transform)`);
          assert(
            pausedBounceTransforms.length >= 3
              && pausedBounceTransforms.every(Boolean)
              && new Set(pausedBounceTransforms).size >= 3,
            `Paused Bounce logos must retain distinct initialized positions: ${JSON.stringify(pausedBounceTransforms)}`
          );
        }
      }

      await seedCapacityProject(cdp);
      await cdp.evaluate(`(async () => {
        const base = await PepsSponsor.loadStateAuthoritative();
        const next = PepsSponsor.clone(base);
        next.modeSettings.orbit = {
          ...next.modeSettings.orbit,
          size: 800,
          orbitRadius: 520,
          posX: "right",
          posY: "bottom"
        };
        await PepsSponsor.saveStateLocked(next, { base, silent: true });
      })()`);
      await navigate(
        cdp,
        origin,
        "/sponsor.html?mode=orbit&group=group_capacity&qa=extreme-orbit-visible",
        (location) => location.pathname.endsWith("/sponsor-display.html")
          && new URL(location.href).searchParams.get("mode") === "orbit",
        "extreme Orbit radius and logo-size output"
      );
      const extremeOrbit = await waitForModeVisible(cdp, "orbit", { groupId: "group_capacity" });
      const extremeOrbitLayout = await cdp.evaluate(`(() => {
        const items = [...document.querySelectorAll("#sponsorLayer .psm-orbit-item")];
        const centers = items.map((item) => {
          const rect = item.querySelector("img").getBoundingClientRect();
          return (Math.round((rect.left + rect.right) / 10) * 5)
            + ","
            + (Math.round((rect.top + rect.bottom) / 10) * 5);
        });
        return {
          transforms: items.map((item) => item.style.transform),
          uniqueCenters: new Set(centers).size,
          widths: items.map((item) => Math.round(item.querySelector("img").getBoundingClientRect().width))
        };
      })()`);
      assert(
        extremeOrbit.visibleCount > 0
          && new Set(extremeOrbitLayout.transforms).size === 5
          && extremeOrbitLayout.transforms.every((transform) => !transform.includes("translateX(0px)"))
          && extremeOrbitLayout.uniqueCenters >= 3
          && extremeOrbitLayout.widths.every((width) => width > 0 && width < 800),
        `Extreme Orbit settings must retain a visible non-collapsed orbit: ${JSON.stringify({
          visibility: extremeOrbit,
          layout: extremeOrbitLayout
        })}`
      );

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 320,
        height: 180,
        deviceScaleFactor: 1,
        mobile: false
      });
      await navigate(
        cdp,
        origin,
        "/sponsor.html?mode=cover3d&group=group_capacity&qa=compact-cover-visible",
        (location) => location.pathname.endsWith("/sponsor-display.html")
          && new URL(location.href).searchParams.get("mode") === "cover3d",
        "compact Cover3D output"
      );
      const compactCover = await waitForModeVisible(cdp, "cover3d", {
        groupId: "group_capacity"
      });
      assert(
        compactCover.viewport.width === 320
          && compactCover.viewport.height === 180
          && compactCover.visibleCount > 0,
        `Cover3D must retain a genuinely visible loaded logo at 320x180: ${JSON.stringify(compactCover)}`
      );

      await seedCapacityProject(cdp);
      await cdp.evaluate(`(async () => {
        const bytes = new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
        ]);
        await PepsSponsor.dbPutImage(
          "cap_e",
          new Blob([bytes], { type: "image/png" }),
          { name: "cap_e-corrupt.png", type: "image/png" }
        );
        const base = await PepsSponsor.loadStateAuthoritative();
        const next = PepsSponsor.clone(base);
        next.currentIndex = 0;
        next.settings.autoPlay = false;
        await PepsSponsor.saveStateLocked(next, { base, silent: true });
        window.__qaPlaybackMessages.length = 0;
      })()`);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false
      });
      await navigate(
        cdp,
        origin,
        "/sponsor.html?mode=live&qa=partial-corrupt-index",
        (location) => location.pathname.endsWith("/sponsor-display.html")
          && new URL(location.href).searchParams.get("mode") === "live",
        "partially corrupt managed output"
      );
      const partialCorruptVisibility = await waitForModeVisible(cdp, "lower_third", {
        groupId: "group_capacity"
      });
      await waitFor(
        () => cdp.evaluate(`window.__qaPlaybackMessages.some((message) =>
          message.sponsorId === "cap_c" && message.currentIndex === 1
        )`),
        "playback identity after skipping a corrupt Sponsor"
      );
      const partialCorruptPlayback = await cdp.evaluate(`(() => {
        const messages = window.__qaPlaybackMessages;
        const latest = [...messages].reverse().find((message) => message.mode === "lower_third");
        return { latest };
      })()`);
      const visibleCapacityC = partialCorruptVisibility.images.find((image) => image.name === "Capacity C");
      const corruptCapacityE = partialCorruptVisibility.images.find((image) => image.name === "Capacity E");
      assert(
        partialCorruptVisibility.visibleCount > 0
          && visibleCapacityC?.visible === true
          && (!corruptCapacityE || corruptCapacityE.visible === false),
        `A corrupt Sponsor must be skipped without hiding valid Sponsors: ${JSON.stringify(partialCorruptVisibility)}`
      );
      assert(
        partialCorruptPlayback.latest?.sponsorId === "cap_c"
          && partialCorruptPlayback.latest?.sponsorName === "Capacity C"
          && partialCorruptPlayback.latest?.currentIndex === 1,
        `Playback identity must match the first rendered valid Sponsor: ${JSON.stringify(partialCorruptPlayback)}`
      );

      const corruptFixture = await cdp.evaluate(`(async () => {
        await PepsSponsor.dbClearImages();
        const bytes = new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
        ]);
        await PepsSponsor.dbPutImage(
          "img_corrupt",
          new Blob([bytes], { type: "image/png" }),
          { name: "corrupt.png", type: "image/png" }
        );
        const state = PepsSponsor.defaultState();
        const createdAt = "2026-08-01T00:00:00.000Z";
        state.projectName = "Corrupt Preview Image Regression";
        state.mode = "grid";
        state.activeGroupId = "group_corrupt";
        state.images = [{
          id: "img_corrupt",
          name: "Corrupt Sponsor",
          tier: "partner",
          duration: 6,
          enabled: true,
          createdAt
        }];
        state.groups = [
          { id: "all", name: "All Corrupt Sponsors", imageIds: ["img_corrupt"] },
          { id: "group_corrupt", name: "Corrupt Group", imageIds: ["img_corrupt"] }
        ];
        state.modeGroups = Object.fromEntries(
          PepsSponsorModes.ids.map((mode) => [mode, "group_corrupt"])
        );
        state.modeSettings = Object.fromEntries(
          PepsSponsorModes.ids.map((mode) => [mode, PepsSponsorModes.defaultsFor(mode)])
        );
        state.settings = {
          autoPlay: false,
          safeArea: false,
          showNames: true,
          showTier: true,
          opacity: 100
        };
        state.isVisible = true;
        state.isPaused = false;
        const saved = await PepsSponsor.saveStateLocked(state, {
          replace: true,
          silent: true
        });
        const record = await PepsSponsor.dbGetImageRecord("img_corrupt");
        return {
          images: saved.images.length,
          groupSponsors: PepsSponsor.getGroupSponsors(saved, saved.groups[1]).length,
          blobBytes: record?.blob?.size || 0,
          truthyUrl: await PepsSponsor.dbGetImageUrl("img_corrupt")
        };
      })()`);
      assert(
        corruptFixture.images === 1
          && corruptFixture.groupSponsors === 1
          && corruptFixture.blobBytes > 0
          && corruptFixture.truthyUrl.startsWith("blob:"),
        `Corrupt-image regression must start with one Sponsor and a truthy image URL: ${JSON.stringify(corruptFixture)}`
      );

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false
      });
      await navigate(
        cdp,
        origin,
        "/sponsor-display.html?mode=grid&group=group_corrupt&preview=1&qa=corrupt-image-preview",
        (location) => location.pathname.endsWith("/sponsor-display.html")
          && new URL(location.href).searchParams.get("preview") === "1",
        "corrupt image Preview diagnostic"
      );
      let missingImageDiagnostic = null;
      await waitFor(async () => {
        missingImageDiagnostic = await cdp.evaluate(`(() => {
          const diagnostic = document.getElementById("emptyState");
          const rect = diagnostic.getBoundingClientRect();
          let clipped = {
            left: Math.max(0, rect.left),
            top: Math.max(0, rect.top),
            right: Math.min(innerWidth, rect.right),
            bottom: Math.min(innerHeight, rect.bottom)
          };
          let effectiveOpacity = 1;
          let cssVisible = true;
          let node = diagnostic;
          while (node && node.nodeType === Node.ELEMENT_NODE) {
            const style = getComputedStyle(node);
            const opacity = Number.parseFloat(style.opacity);
            effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
            if (
              style.display === "none"
              || style.visibility === "hidden"
              || style.visibility === "collapse"
              || style.contentVisibility === "hidden"
            ) {
              cssVisible = false;
            }
            if (node !== diagnostic) {
              const bounds = node.getBoundingClientRect();
              if (["hidden", "clip", "scroll", "auto"].includes(style.overflowX)) {
                clipped.left = Math.max(clipped.left, bounds.left);
                clipped.right = Math.min(clipped.right, bounds.right);
              }
              if (["hidden", "clip", "scroll", "auto"].includes(style.overflowY)) {
                clipped.top = Math.max(clipped.top, bounds.top);
                clipped.bottom = Math.min(clipped.bottom, bounds.bottom);
              }
            }
            node = node.parentElement;
          }
          const visibleArea = Math.max(0, clipped.right - clipped.left)
            * Math.max(0, clipped.bottom - clipped.top);
          const originalArea = Math.max(0, rect.width * rect.height);
          const state = PepsSponsor.loadState();
          return {
            preview: new URL(location.href).searchParams.get("preview"),
            shown: diagnostic.classList.contains("show"),
            cssVisible,
            effectiveOpacity,
            visibleArea,
            visibleFraction: originalArea > 0 ? visibleArea / originalArea : 0,
            title: document.getElementById("emptyStateTitle").textContent.trim(),
            text: document.getElementById("emptyStateText").textContent.trim(),
            sponsorCount: PepsSponsor.getGroupSponsors(
              state,
              state.groups.find((group) => group.id === "group_corrupt")
            ).length
          };
        })()`);
        return missingImageDiagnostic.preview === "1"
          && missingImageDiagnostic.sponsorCount === 1
          && missingImageDiagnostic.shown
          && missingImageDiagnostic.cssVisible
          && missingImageDiagnostic.effectiveOpacity >= 0.1
          && missingImageDiagnostic.visibleArea >= 1024
          && missingImageDiagnostic.visibleFraction >= 0.25
          && missingImageDiagnostic.title.includes("Sponsor")
          && missingImageDiagnostic.text.length > 0;
      }, "visible missing-image Preview diagnostic", 5000);
      const corruptVisibility = await readModeVisibility(cdp, "grid", {
        groupId: "group_corrupt"
      });
      assert(
        corruptVisibility.visibleCount === 0
          && corruptVisibility.images.every((image) => !image.visible),
        `A broken logo must never count as visible: ${JSON.stringify({
          diagnostic: missingImageDiagnostic,
          visibility: corruptVisibility
        })}`
      );
    } finally {
      await cdp.send("Emulation.clearDeviceMetricsOverride");
    }
    assertNoBrowserErrors(cdp, routeMarker, "Compatibility and visible explicit-mode routes");

    const capacityMarker = cdp.events.length;
    const capacityProject = await seedCapacityProject(cdp);
    assert(
      capacityProject.sponsorIds.length === 5 && capacityProject.capacity === 4,
      `Capacity fixture must exceed the lower-third limit: ${JSON.stringify(capacityProject)}`
    );
    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=lower_third&group=group_capacity&qa=fixed-capacity",
      (location) => location.pathname.endsWith("/sponsor-display.html")
        && new URL(location.href).searchParams.get("mode") === "lower_third"
        && new URL(location.href).searchParams.get("group") === "group_capacity",
      "capacity-limited explicit output"
    );
    await waitForDisplay(cdp, "lower_third", "group_capacity", "Capacity A");
    await waitFor(
      () => cdp.evaluate(`document.querySelectorAll("#sponsorLayer img.psm-logo").length === 4`),
      "initial fixed-capacity sponsor window"
    );
    const fixedInitial = await cdp.evaluate(`({
      names: [...document.querySelectorAll("#sponsorLayer img.psm-logo")].map((image) => image.alt),
      playback: (window.__qaPlaybackMessages || []).filter((message) => message.type === "playback")
    })`);
    assert(
      fixedInitial.names.length === 4
        && fixedInitial.names.includes("Capacity A")
        && !fixedInitial.names.includes("Capacity E"),
      `Fixed output did not start with a limited four-sponsor window: ${JSON.stringify(fixedInitial.names)}`
    );
    const fixedSeen = new Set(fixedInitial.names);
    await waitFor(async () => {
      const names = await cdp.evaluate(
        `[...document.querySelectorAll("#sponsorLayer img.psm-logo")].map((image) => image.alt)`
      );
      names.forEach((name) => fixedSeen.add(name));
      return capacityProject.sponsorNames.every((name) => fixedSeen.has(name));
    }, "fixed-capacity output to advance through every sponsor", 7500);
    const fixedPlayback = await cdp.evaluate(`(() => {
      const messages = (window.__qaPlaybackMessages || [])
        .filter((message) => message.type === "playback");
      return {
        total: messages.length,
        acceptedByLive: messages.filter((message) =>
          message.playlistId === "pl_capacity_live"
        ).length,
        messages
      };
    })()`);
    assert(
      capacityProject.sponsorNames.every((name) => fixedSeen.has(name)),
      `Fixed-capacity output skipped sponsors: ${JSON.stringify([...fixedSeen])}`
    );
    assert(
      fixedPlayback.total === 0 && fixedPlayback.acceptedByLive === 0,
      `Explicit fixed output emitted playback that Live could accept: ${JSON.stringify(fixedPlayback.messages)}`
    );

    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=live&qa=capacity-live",
      (location) => location.pathname.endsWith("/sponsor-display.html")
        && new URL(location.href).searchParams.get("mode") === "live",
      "capacity fixture managed live output"
    );
    await waitForDisplay(cdp, "lower_third", "group_capacity", "Capacity E");
    await waitFor(
      () => cdp.evaluate(`(window.__qaPlaybackMessages || []).some((message) =>
        message.type === "playback"
        && message.requestedMode === "live"
        && message.playlistId === "pl_capacity_live"
      )`),
      "managed live playback emission"
    );
    const livePlayback = await cdp.evaluate(`(window.__qaPlaybackMessages || []).find((message) =>
      message.type === "playback"
      && message.requestedMode === "live"
      && message.playlistId === "pl_capacity_live"
    )`);
    assert(livePlayback.mode === "lower_third", `Live playback reported ${livePlayback.mode}`);
    assert(livePlayback.groupId === capacityProject.groupId, "Live playback reported the wrong playlist group");
    assert(livePlayback.playlistId === capacityProject.playlistId, "Live playback reported the wrong active playlist");
    assert(
      livePlayback.sponsorId === capacityProject.playlistIds[0]
        && livePlayback.sponsorName === "Capacity E"
        && livePlayback.currentIndex === 0
        && livePlayback.count === capacityProject.playlistIds.length,
      `Live playback did not match the exact active playlist order: ${JSON.stringify(livePlayback)}`
    );
    assertNoBrowserErrors(cdp, capacityMarker, "Capacity-limited explicit and managed playback workflow");

    await seedCanonicalProject(cdp);

    const transparentMarker = cdp.events.length;
    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=grid&group=group_empty",
      (location) => location.pathname.endsWith("/sponsor-display.html")
        && new URL(location.href).searchParams.get("mode") === "grid",
      "empty fixed output"
    );
    await waitFor(
      () => cdp.evaluate(`typeof PepsSponsor === "object"
        && document.getElementById("displayStage")?.dataset.group === "group_empty"`),
      "empty group display initialization"
    );
    const transparent = await cdp.evaluate(`(() => {
      const empty = document.getElementById("emptyState");
      const root = document.getElementById("displayRoot");
      const stage = document.getElementById("displayStage");
      return {
        preview: new URL(location.href).searchParams.get("preview"),
        diagnosticShown: empty.classList.contains("show"),
        diagnosticDisplay: getComputedStyle(empty).display,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        rootBackground: getComputedStyle(root).backgroundColor,
        stageBackground: getComputedStyle(stage).backgroundColor,
        renderedChildren: document.getElementById("sponsorLayer").childElementCount
      };
    })()`);
    assert(transparent.preview === null, "Transparent output regression must run without preview=1");
    assert(transparent.diagnosticShown === false, "Actual output must not show diagnostic UI");
    assert(
      transparent.diagnosticDisplay === "none" || transparent.diagnosticDisplay === "contents",
      `Actual diagnostic must be visually absent, got display=${transparent.diagnosticDisplay}`
    );
    assert(
      [transparent.bodyBackground, transparent.rootBackground, transparent.stageBackground]
        .every((color) => color === "rgba(0, 0, 0, 0)"),
      `Empty output backgrounds must remain transparent: ${JSON.stringify(transparent)}`
    );
    assert(transparent.renderedChildren === 0, "Empty output must not render sponsor content");
    assertNoBrowserErrors(cdp, transparentMarker, "Transparent output");

    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=live&qa=rapid",
      (location) => location.pathname.endsWith("/sponsor-display.html")
        && new URL(location.href).searchParams.get("mode") === "live",
      "rapid mode-switch display"
    );
    await waitForDisplay(cdp, "lower_third", "group_alpha", "Beta Sponsor");
    const rapidMarker = cdp.events.length;
    const finalMode = await cdp.evaluate(`(() => {
      const ids = PepsSponsorModes.ids;
      const base = PepsSponsor.loadState();
      const channel = new BroadcastChannel(PepsSponsor.CHANNEL_NAME);
      ids.forEach((mode, index) => {
        const next = PepsSponsor.clone(base);
        next.revision = base.revision + index + 1;
        next.activePlaylist = "pl_live";
        next.playlists = next.playlists.map((playlist) => playlist.id === "pl_live"
          ? {
              ...playlist,
              mode,
              groupId: "group_alpha",
              sponsorIds: ["img_alpha", "img_beta"]
            }
          : playlist);
        channel.postMessage({ type: "state", state: next });
      });
      setTimeout(() => channel.close(), 250);
      return ids.at(-1);
    })()`);
    await waitForDisplay(cdp, finalMode, "group_alpha");
    await wait(650);
    const rapid = await cdp.evaluate(`({
      renderer: document.getElementById("sponsorLayer").dataset.renderer,
      hosts: document.querySelectorAll("#sponsorLayer > .psm-host").length,
      styles: document.querySelectorAll("#peps-sponsor-mode-renderers-css").length,
      group: document.getElementById("displayStage").dataset.group
    })`);
    assert(rapid.renderer === finalMode, `Rapid switching ended on ${rapid.renderer}, expected ${finalMode}`);
    assert(rapid.hosts === 1, `Rapid switching left ${rapid.hosts} renderer hosts`);
    assert(rapid.styles === 1, `Rapid switching injected ${rapid.styles} renderer stylesheets`);
    assert(rapid.group === "group_alpha", "Rapid switching lost its playlist group");
    assertNoBrowserErrors(cdp, rapidMarker, "Rapid mode switching");

    const sampleMarker = cdp.events.length;
    await navigate(
      cdp,
      origin,
      "/sponsor.html?mode=control#settings",
      (location) => location.pathname.endsWith("/sponsor-control.html"),
      "sample transaction control route"
    );
    await waitFor(
      () => cdp.evaluate(`PepsSponsor.loadState().images.length === 2
        && document.getElementById("loadSampleBtn") !== null`),
      "control initialization before sample load"
    );
    const beforeSample = await cdp.evaluate(`(async () => {
      const state = PepsSponsor.loadState();
      const keys = await new Promise((resolve, reject) => {
        const request = indexedDB.open(PepsSponsor.DB_NAME);
        request.onsuccess = () => {
          const tx = request.result.transaction("images", "readonly");
          const getKeys = tx.objectStore("images").getAllKeys();
          getKeys.onsuccess = () => resolve(getKeys.result.map(String).sort());
          getKeys.onerror = () => reject(getKeys.error);
        };
        request.onerror = () => reject(request.error);
      });
      return { ids: state.images.map((image) => image.id), keys };
    })()`);
    await cdp.evaluate(`document.getElementById("loadSampleBtn").click()`);
    await waitFor(
      () => cdp.evaluate(`document.getElementById("confirmDialog")?.open === true`),
      "sample-load confirmation dialog"
    );
    await cdp.evaluate(`document.getElementById("confirmAcceptBtn").click()`);
    await waitFor(
      () => cdp.evaluate(`(() => {
        const state = PepsSponsor.loadState();
        return state.images.length === 4
          && state.images.some((image) => image.name === "PEPS MAIN")
          && state.command.type === "init";
      })()`),
      "transactional sample load success"
    );
    const sampleSuccess = await cdp.evaluate(`(async () => {
      const state = PepsSponsor.loadState();
      const keys = await new Promise((resolve, reject) => {
        const request = indexedDB.open(PepsSponsor.DB_NAME);
        request.onsuccess = () => {
          const tx = request.result.transaction("images", "readonly");
          const getKeys = tx.objectStore("images").getAllKeys();
          getKeys.onsuccess = () => resolve(getKeys.result.map(String).sort());
          getKeys.onerror = () => reject(getKeys.error);
        };
        request.onerror = () => reject(request.error);
      });
      const blobs = [];
      for (const image of state.images) {
        const record = await PepsSponsor.dbGetImageRecord(image.id);
        blobs.push({ id: image.id, size: record?.blob?.size || 0 });
      }
      return {
        ids: state.images.map((image) => image.id),
        names: state.images.map((image) => image.name),
        keys,
        blobs
      };
    })()`);
    assert(sampleSuccess.ids.length === 4, "Sample load must create four sponsors");
    assert(
      sampleSuccess.ids.every((id) => !beforeSample.ids.includes(id)),
      "Sample load must stage fresh image IDs"
    );
    assert(
      JSON.stringify(sampleSuccess.keys) === JSON.stringify([...sampleSuccess.ids].sort()),
      "Sample load must delete obsolete image records after commit"
    );
    assert(sampleSuccess.blobs.every((record) => record.size > 0), "Sample load must write every image blob");

    const beforeFailedSample = await cdp.evaluate(`(async () => {
      const keys = await new Promise((resolve, reject) => {
        const request = indexedDB.open(PepsSponsor.DB_NAME);
        request.onsuccess = () => {
          const tx = request.result.transaction("images", "readonly");
          const getKeys = tx.objectStore("images").getAllKeys();
          getKeys.onsuccess = () => resolve(getKeys.result.map(String).sort());
          getKeys.onerror = () => reject(getKeys.error);
        };
        request.onerror = () => reject(request.error);
      });
      return {
        rawState: localStorage.getItem(PepsSponsor.STORAGE_KEY),
        keys,
        errorToasts: document.querySelectorAll("#toastRegion .toast.error").length
      };
    })()`);
    await cdp.evaluate(`(() => {
      window.__qaOriginalIdbPut = IDBObjectStore.prototype.put;
      window.__qaIdbPutCount = 0;
      IDBObjectStore.prototype.put = function (...args) {
        window.__qaIdbPutCount += 1;
        if (window.__qaIdbPutCount === 2) {
          throw new DOMException("Injected sample image write failure", "QuotaExceededError");
        }
        return window.__qaOriginalIdbPut.apply(this, args);
      };
      document.getElementById("loadSampleBtn").click();
    })()`);
    await waitFor(
      () => cdp.evaluate(`document.getElementById("confirmDialog")?.open === true`),
      "failed sample-load confirmation dialog"
    );
    await cdp.evaluate(`document.getElementById("confirmAcceptBtn").click()`);
    await waitFor(
      () => cdp.evaluate(
        `document.querySelectorAll("#toastRegion .toast.error").length
          > ${beforeFailedSample.errorToasts}`
      ),
      "sample-load rollback error feedback"
    );
    await cdp.evaluate(`(() => {
      if (window.__qaOriginalIdbPut) {
        IDBObjectStore.prototype.put = window.__qaOriginalIdbPut;
        delete window.__qaOriginalIdbPut;
      }
    })()`);
    const afterFailedSample = await cdp.evaluate(`(async () => {
      const state = PepsSponsor.loadState();
      const keys = await new Promise((resolve, reject) => {
        const request = indexedDB.open(PepsSponsor.DB_NAME);
        request.onsuccess = () => {
          const tx = request.result.transaction("images", "readonly");
          const getKeys = tx.objectStore("images").getAllKeys();
          getKeys.onsuccess = () => resolve(getKeys.result.map(String).sort());
          getKeys.onerror = () => reject(getKeys.error);
        };
        request.onerror = () => reject(request.error);
      });
      const intact = [];
      for (const image of state.images) {
        const record = await PepsSponsor.dbGetImageRecord(image.id);
        intact.push(!!record?.blob?.size);
      }
      return {
        rawState: localStorage.getItem(PepsSponsor.STORAGE_KEY),
        keys,
        intact
      };
    })()`);
    assert(
      afterFailedSample.rawState === beforeFailedSample.rawState,
      "Failed sample load must preserve prior state byte-for-byte"
    );
    assert(
      JSON.stringify(afterFailedSample.keys) === JSON.stringify(beforeFailedSample.keys),
      "Failed sample load must remove staged images and retain prior DB keys"
    );
    assert(afterFailedSample.intact.every(Boolean), "Failed sample load damaged prior image blobs");
    assertNoBrowserErrors(cdp, sampleMarker, "Transactional sample load workflow");

    const resetFailureBefore = await cdp.evaluate(`(async () => {
      const keys = await new Promise((resolve, reject) => {
        const request = indexedDB.open(PepsSponsor.DB_NAME);
        request.onsuccess = () => {
          const tx = request.result.transaction("images", "readonly");
          const getKeys = tx.objectStore("images").getAllKeys();
          getKeys.onsuccess = () => resolve(getKeys.result.map(String).sort());
          getKeys.onerror = () => reject(getKeys.error);
        };
        request.onerror = () => reject(request.error);
      });
      window.__qaOriginalSaveStateLocked = PepsSponsor.saveStateLocked;
      PepsSponsor.saveStateLocked = async () => {
        throw new Error("Injected reset state failure");
      };
      return {
        rawState: localStorage.getItem(PepsSponsor.STORAGE_KEY),
        keys,
        errorToasts: document.querySelectorAll("#toastRegion .toast.error").length
      };
    })()`);
    await cdp.evaluate(`document.getElementById("resetProjectBtn").click()`);
    await waitFor(
      () => cdp.evaluate(`document.getElementById("confirmDialog")?.open === true`),
      "reset failure confirmation dialog"
    );
    await cdp.evaluate(`document.getElementById("confirmAcceptBtn").click()`);
    await waitFor(
      () => cdp.evaluate(
        `document.querySelectorAll("#toastRegion .toast.error").length
          > ${resetFailureBefore.errorToasts}`
      ),
      "reset state failure feedback"
    );
    const resetFailureAfter = await cdp.evaluate(`(async () => {
      PepsSponsor.saveStateLocked = window.__qaOriginalSaveStateLocked;
      delete window.__qaOriginalSaveStateLocked;
      const keys = await new Promise((resolve, reject) => {
        const request = indexedDB.open(PepsSponsor.DB_NAME);
        request.onsuccess = () => {
          const tx = request.result.transaction("images", "readonly");
          const getKeys = tx.objectStore("images").getAllKeys();
          getKeys.onsuccess = () => resolve(getKeys.result.map(String).sort());
          getKeys.onerror = () => reject(getKeys.error);
        };
        request.onerror = () => reject(request.error);
      });
      return {
        rawState: localStorage.getItem(PepsSponsor.STORAGE_KEY),
        keys,
        uiProject: document.getElementById("projectStatus")?.textContent
      };
    })()`);
    assert(
      resetFailureAfter.rawState === resetFailureBefore.rawState,
      "Failed reset changed the stored project"
    );
    assert(
      JSON.stringify(resetFailureAfter.keys) === JSON.stringify(resetFailureBefore.keys),
      "Failed reset deleted image blobs before the state commit"
    );
    assert(
      resetFailureAfter.uiProject === JSON.parse(resetFailureBefore.rawState).projectName,
      "Failed reset left the control UI on an unsaved default project"
    );

    const concurrencyMarker = cdp.events.length;
    await navigate(
      cdp,
      origin,
      "/sponsor-control.html?qa=concurrency#collections",
      (location) => location.pathname.endsWith("/sponsor-control.html"),
      "multi-tab concurrency control route"
    );
    await waitFor(
      () => cdp.evaluate(`document.getElementById("addGroupBtn") !== null
        && typeof PepsSponsor.saveStateLocked === "function"`),
      "primary concurrency control initialization"
    );
    const peerPage = await openDebugPage(
      debugPort,
      `${origin}/sponsor-control.html?qa=concurrency-peer#collections`
    );
    extraPages.push(peerPage);
    await waitFor(
      () => peerPage.cdp.evaluate(`document.readyState === "complete"
        && document.getElementById("addGroupBtn") !== null
        && typeof PepsSponsor.saveStateLocked === "function"`),
      "peer concurrency control initialization"
    );
    const concurrencyBefore = await cdp.evaluate(`(() => {
      const state = PepsSponsor.loadState();
      return {
        groups: state.groups.length,
        revision: state.revision,
        epoch: state.stateEpoch
      };
    })()`);
    await Promise.all([
      cdp.evaluate(`document.getElementById("addGroupBtn").click()`),
      peerPage.cdp.evaluate(`document.getElementById("addGroupBtn").click()`)
    ]);
    await waitFor(
      () => cdp.evaluate(`(() => {
        const state = PepsSponsor.loadState();
        return state.groups.length === ${concurrencyBefore.groups + 2}
          && state.revision >= ${concurrencyBefore.revision + 2};
      })()`),
      "serialized multi-tab group additions"
    );
    await waitFor(async () => {
      const storedIds = await cdp.evaluate(
        `PepsSponsor.loadState().groups.map((group) => group.id).sort()`
      );
      const primaryIds = await cdp.evaluate(
        `[...document.getElementById("groupSelect").options].map((option) => option.value).sort()`
      );
      const peerIds = await peerPage.cdp.evaluate(
        `[...document.getElementById("groupSelect").options].map((option) => option.value).sort()`
      );
      return JSON.stringify(storedIds) === JSON.stringify(primaryIds)
        && JSON.stringify(storedIds) === JSON.stringify(peerIds);
    }, "equal-revision-free multi-tab convergence");
    const concurrencyAfter = await cdp.evaluate(`PepsSponsor.loadState()`);
    assert(
      concurrencyAfter.groups.length === concurrencyBefore.groups + 2,
      "Concurrent Add Group lost one tab's metadata"
    );
    assert(
      concurrencyAfter.stateEpoch === concurrencyBefore.epoch,
      "Normal concurrent edits must not advance the project epoch"
    );
    await cdp.evaluate(`(async () => {
      const base = await PepsSponsor.loadStateAuthoritative();
      const desired = PepsSponsor.clone(base);
      for (let index = 0; index < 50; index++) {
        desired.groups.push({
          id: \`group_stress_victim_\${index}\`,
          name: \`Stress Victim \${index}\`,
          imageIds: []
        });
      }
      await PepsSponsor.saveStateLocked(desired, { base });
    })()`);
    for (let iteration = 0; iteration < 50; iteration++) {
      const stressBefore = await cdp.evaluate(`PepsSponsor.loadStateAuthoritative()`);
      const victimId = `group_stress_victim_${iteration}`;
      const addedId = `group_stress_added_${iteration}`;
      await Promise.all([
        cdp.evaluate(`(async () => {
          window.__qaStressBase = await PepsSponsor.loadStateAuthoritative();
          window.__qaStressDesired = PepsSponsor.clone(window.__qaStressBase);
          window.__qaStressDesired.groups = window.__qaStressDesired.groups.filter(
            (group) => group.id !== ${JSON.stringify(victimId)}
          );
        })()`),
        peerPage.cdp.evaluate(`(async () => {
          window.__qaStressBase = await PepsSponsor.loadStateAuthoritative();
          window.__qaStressDesired = PepsSponsor.clone(window.__qaStressBase);
          window.__qaStressDesired.groups.push({
            id: ${JSON.stringify(addedId)},
            name: "Stress Added ${iteration}",
            imageIds: []
          });
        })()`)
      ]);
      const stressResults = await Promise.all([
        cdp.evaluate(`(async () => {
          const saved = await PepsSponsor.saveStateLocked(window.__qaStressDesired, {
            base: window.__qaStressBase
          });
          return { revision: saved.revision, groups: saved.groups.map((group) => group.id) };
        })()`),
        peerPage.cdp.evaluate(`(async () => {
          const saved = await PepsSponsor.saveStateLocked(window.__qaStressDesired, {
            base: window.__qaStressBase
          });
          return { revision: saved.revision, groups: saved.groups.map((group) => group.id) };
        })()`)
      ]);
      await waitFor(
        () => cdp.evaluate(`(async () => {
          const state = await PepsSponsor.loadStateAuthoritative();
          return !state.groups.some((group) => group.id === ${JSON.stringify(victimId)})
            && state.groups.some((group) => group.id === ${JSON.stringify(addedId)});
        })()`),
        `two-target delete/add transaction stress iteration ${iteration + 1}`
      );
      const revisions = stressResults.map((result) => result.revision).sort((a, b) => a - b);
      assert(
        revisions[0] === stressBefore.revision + 1
          && revisions[1] === stressBefore.revision + 2,
        `IndexedDB state transaction returned duplicate or skipped revisions on iteration ${
          iteration + 1
        }: ${JSON.stringify(revisions)} after ${stressBefore.revision}`
      );
    }
    const rebaseSemantics = await cdp.evaluate(`(() => {
      const base = PepsSponsor.clone(PepsSponsor.loadState());
      const ids = base.images.slice(0, 4).map((image) => image.id);
      const remoteId = "img_remote_rebase";
      base.groups.push(
        { id: "group_delete_rebase", name: "Delete Base", imageIds: [] },
        { id: "group_update_rebase", name: "Update Base", imageIds: [] },
        { id: "group_remote_delete", name: "Remote Delete Base", imageIds: [] }
      );
      base.groups[0].imageIds = ids;
      const desired = PepsSponsor.clone(base);
      const latest = PepsSponsor.clone(base);
      desired.groups = desired.groups.filter((group) => group.id !== "group_delete_rebase");
      desired.groups.find((group) => group.id === "group_update_rebase").name = "Desired Update";
      desired.groups.find((group) => group.id === "group_remote_delete").name = "Desired But Deleted";
      desired.groups[0].imageIds = [ids[2], ids[0], ids[1]];
      latest.images.push({
        id: remoteId,
        name: "Remote Sponsor",
        tier: "partner",
        duration: 6,
        enabled: true,
        createdAt: new Date().toISOString()
      });
      latest.groups.find((group) => group.id === "group_delete_rebase").name = "Remote Rename";
      latest.groups.find((group) => group.id === "group_update_rebase").name = "Latest Update";
      latest.groups = latest.groups.filter((group) => group.id !== "group_remote_delete");
      latest.groups[0].imageIds = [ids[1], ids[0], ids[2], remoteId];
      const merged = PepsSponsor.mergeConcurrentState(base, desired, latest);
      return {
        orderedIds: merged.groups[0].imageIds,
        deletedPresent: merged.groups.some((group) => group.id === "group_delete_rebase"),
        remoteDeletedPresent: merged.groups.some((group) => group.id === "group_remote_delete"),
        updatedName: merged.groups.find((group) => group.id === "group_update_rebase")?.name
      };
    })()`);
    assert(
      JSON.stringify(rebaseSemantics.orderedIds.slice(0, 4))
        === JSON.stringify([
          concurrencyAfter.images[2]?.id,
          concurrencyAfter.images[0]?.id,
          concurrencyAfter.images[1]?.id,
          "img_remote_rebase"
        ]),
      `Concurrent ID-list rebase order is incorrect: ${JSON.stringify(rebaseSemantics.orderedIds)}`
    );
    assert(
      rebaseSemantics.deletedPresent === false
        && rebaseSemantics.remoteDeletedPresent === false,
      "Entity deletion did not win over a concurrent update"
    );
    assert(
      rebaseSemantics.updatedName === "Desired Update",
      `Concurrent field update did not use the later desired value: ${rebaseSemantics.updatedName}`
    );

    await peerPage.cdp.evaluate(`(async () => {
      window.__qaStaleBase = await PepsSponsor.loadStateAuthoritative();
      window.__qaStaleDesired = PepsSponsor.clone(window.__qaStaleBase);
      window.__qaStaleDesired.groups.push({
        id: "group_stale_epoch",
        name: "Stale Epoch Group",
        imageIds: []
      });
    })()`);
    const replacement = await cdp.evaluate(`(async () => {
      const current = await PepsSponsor.loadStateAuthoritative();
      const desired = PepsSponsor.clone(current);
      desired.projectName = "Epoch Replacement";
      return PepsSponsor.saveStateLocked(desired, { replace: true });
    })()`);
    const staleEpochResult = await peerPage.cdp.evaluate(`(async () => {
      try {
        await PepsSponsor.saveStateLocked(window.__qaStaleDesired, {
          base: window.__qaStaleBase
        });
        return { accepted: true, code: "" };
      } catch (error) {
        return { accepted: false, code: error?.code || "" };
      }
    })()`);
    assert(
      staleEpochResult.accepted === false && staleEpochResult.code === "STATE_EPOCH_CONFLICT",
      `Stale mutation crossed a replacement epoch: ${JSON.stringify(staleEpochResult)}`
    );
    assert(
      !replacement.groups.some((group) => group.id === "group_stale_epoch"),
      "Replacement state unexpectedly included a stale group"
    );
    assertNoBrowserErrors(cdp, concurrencyMarker, "Multi-tab state locking workflow");

    const cacheControl = await openDebugPage(debugPort);
    extraPages.push(cacheControl);
    await cacheControl.cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__qaPageShows = [];
        addEventListener("pageshow", (event) => {
          window.__qaPageShows.push({ persisted: event.persisted, href: location.href });
        });`
    });
    await navigate(
      cacheControl.cdp,
      origin,
      "/sponsor-control.html?qa=bfcache-control#settings",
      (location) => location.pathname.endsWith("/sponsor-control.html"),
      "BFCache control route"
    );
    let stablePreviewHref = "";
    let stablePreviewPolls = 0;
    await waitFor(
      async () => {
        const snapshot = await cacheControl.cdp.evaluate(`(() => {
          const frame = document.getElementById("previewFrame");
          return {
            controlReady: document.readyState === "complete"
              && document.getElementById("projectName") !== null,
            frameReady: frame?.contentDocument?.readyState === "complete",
            href: frame?.contentWindow?.location?.href || "",
            pathname: frame?.contentWindow?.location?.pathname || ""
          };
        })()`);
        if (!snapshot.controlReady || !snapshot.frameReady
          || !snapshot.pathname.endsWith("/sponsor-display.html")) {
          stablePreviewHref = "";
          stablePreviewPolls = 0;
          return false;
        }
        if (snapshot.href === stablePreviewHref) stablePreviewPolls += 1;
        else {
          stablePreviewHref = snapshot.href;
          stablePreviewPolls = 1;
        }
        return stablePreviewPolls >= 3;
      },
      "BFCache control initialization"
    );
    await cacheControl.cdp.evaluate(`(() => {
      const input = document.getElementById("projectName");
      input.value = "Discarded BFCache Timer";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    const controlCacheEventMarker = cacheControl.cdp.events.length;
    await cacheControl.cdp.send("Page.navigate", {
      url: `${origin}/sponsor-display.html?mode=grid&qa=bfcache-control-away`
    });
    await waitFor(
      () => cacheControl.cdp.evaluate(
        `location.search.includes("bfcache-control-away") && document.readyState === "complete"`
      ),
      "control page navigation into BFCache"
    );
    await peerPage.cdp.evaluate(`(() => {
      const input = document.getElementById("projectName");
      input.value = "BFCache Latest State";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await waitFor(
      () => peerPage.cdp.evaluate(
        `PepsSponsor.loadState().projectName === "BFCache Latest State"`
      ),
      "newer peer state while control is cached"
    );
    await cacheControl.cdp.evaluate(`history.back()`);
    try {
      await waitFor(
        () => cacheControl.cdp.evaluate(`location.pathname.endsWith("/sponsor-control.html")
          && document.readyState === "complete"
          && window.__qaPageShows?.some((entry) => entry.persisted === true)`),
        "persisted control restoration"
      );
    } catch (error) {
      const cacheEvents = cacheControl.cdp.events
        .slice(controlCacheEventMarker)
        .filter((event) => event.method === "Page.backForwardCacheNotUsed")
        .map((event) => event.params);
      const cacheRuntime = await cacheControl.cdp.evaluate(`(() => {
        const navigation = performance.getEntriesByType("navigation").at(-1);
        return {
          href: location.href,
          readyState: document.readyState,
          pageShows: window.__qaPageShows || [],
          notRestoredReasons: navigation?.notRestoredReasons || null
        };
      })()`).catch((runtimeError) => ({ error: runtimeError.message }));
      throw new Error(
        `${error.message} BFCache diagnostics: ${JSON.stringify({
          events: cacheEvents,
          runtime: cacheRuntime
        })}`
      );
    }
    await waitFor(
      () => cacheControl.cdp.evaluate(
        `document.getElementById("projectStatus")?.textContent === "BFCache Latest State"`
      ),
      "control state reload after BFCache"
    );
    await wait(600);
    assert(
      await cacheControl.cdp.evaluate(
        `PepsSponsor.loadState().projectName === "BFCache Latest State"`
      ),
      "A stale pre-BFCache save timer overwrote newer state"
    );

    await peerPage.cdp.evaluate(`(() => {
      window.__qaCacheMessages = [];
      window.__qaCacheChannel?.close?.();
      window.__qaCacheChannel = new BroadcastChannel(PepsSponsor.CHANNEL_NAME);
      window.__qaCacheChannel.onmessage = (event) => window.__qaCacheMessages.push(event.data);
    })()`);
    const cacheMarker = `cache-outbound-${Date.now()}`;
    await cacheControl.cdp.evaluate(
      `PepsSponsor.broadcast({ type: "qa-cache-marker", marker: ${JSON.stringify(cacheMarker)} })`
    );
    await waitFor(
      () => peerPage.cdp.evaluate(
        `window.__qaCacheMessages.some((message) => message?.marker === ${JSON.stringify(cacheMarker)})`
      ),
      "outbound BroadcastChannel after BFCache"
    );
    await peerPage.cdp.evaluate(`(() => {
      const input = document.getElementById("projectName");
      input.value = "BFCache Inbound State";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await waitFor(
      () => cacheControl.cdp.evaluate(
        `document.getElementById("projectStatus")?.textContent === "BFCache Inbound State"`
      ),
      "inbound BroadcastChannel after BFCache"
    );

    const cacheDisplay = await openDebugPage(debugPort);
    extraPages.push(cacheDisplay);
    await cacheDisplay.cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__qaPageShows = [];
        addEventListener("pageshow", (event) => {
          window.__qaPageShows.push({ persisted: event.persisted, href: location.href });
        });`
    });
    await navigate(
      cacheDisplay.cdp,
      origin,
      "/sponsor-display.html?mode=live&qa=bfcache-display",
      (location) => location.pathname.endsWith("/sponsor-display.html"),
      "BFCache display route"
    );
    await waitFor(
      () => cacheDisplay.cdp.evaluate(
        `document.querySelector("#sponsorLayer img")?.src.startsWith("blob:") === true`
      ),
      "display image before BFCache"
    );
    await peerPage.cdp.evaluate(`(async () => {
      const base = PepsSponsor.loadState();
      const desired = PepsSponsor.clone(base);
      desired.command = {
        id: PepsSponsor.uid("cmd"),
        type: "break",
        ts: Date.now(),
        payload: { duration: 3, groupId: desired.modeGroups.sponsor_break }
      };
      const saved = await PepsSponsor.saveStateLocked(desired, { base, silent: true });
      PepsSponsor.broadcast({ type: "command", command: saved.command, state: saved });
    })()`);
    await waitFor(
      () => cacheDisplay.cdp.evaluate(
        `document.getElementById("sponsorLayer")?.dataset.renderer === "sponsor_break"`
      ),
      "break effect before display BFCache"
    );
    await cacheDisplay.cdp.send("Page.navigate", {
      url: `${origin}/sponsor-control.html?qa=bfcache-display-away`
    });
    await waitFor(
      () => cacheDisplay.cdp.evaluate(
        `location.search.includes("bfcache-display-away") && document.readyState === "complete"`
      ),
      "display navigation into BFCache"
    );
    await cacheDisplay.cdp.evaluate(`history.back()`);
    await waitFor(
      () => cacheDisplay.cdp.evaluate(`location.pathname.endsWith("/sponsor-display.html")
        && window.__qaPageShows?.some((entry) => entry.persisted === true)`),
      "persisted display restoration"
    );
    await waitFor(
      () => cacheDisplay.cdp.evaluate(`document.getElementById("sponsorLayer")?.dataset.renderer === "sponsor_break"
        && document.querySelector("#sponsorLayer img")?.src.startsWith("blob:") === true
        && document.querySelector("#sponsorLayer img")?.naturalWidth > 0`),
      "display renderer and Blob URLs after BFCache"
    );
    await waitFor(
      () => cacheDisplay.cdp.evaluate(
        `document.getElementById("sponsorLayer")?.dataset.renderer !== "sponsor_break"`
      ),
      "re-armed effect timer after BFCache",
      5000
    );
    assertNoBrowserErrors(cacheControl.cdp, 0, "BFCache control lifecycle");
    assertNoBrowserErrors(cacheDisplay.cdp, 0, "BFCache display lifecycle");

    socket.close();
    socket = null;
    console.log(
      `Unified browser regression passed `
      + `(21 modes, routes, groups/playlists, redesign recovery, playlist audit, `
      + `capacity playback, import/export, sample rollback, multi-tab locking, BFCache lifecycle, `
      + `fake OBS, transparency, rapid switching).`
    );
  } catch (error) {
    const diagnostic = chromeStderr.trim();
    if (diagnostic) {
      error.message = `${error.message}\nChrome stderr:\n${diagnostic}`;
    }
    throw error;
  } finally {
    for (const page of extraPages) {
      try {
        page.socket.close();
      } catch {
        // Ignore cleanup errors from already-closed audit pages.
      }
    }
    if (socket) socket.close();
    if (child) {
      const childIsRunning = () => child.exitCode === null && child.signalCode === null;
      if (childIsRunning() && process.platform === "win32") {
        spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      } else if (childIsRunning()) {
        child.kill("SIGTERM");
      }
      if (childIsRunning()) {
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          wait(3000)
        ]);
      }
      if (childIsRunning()) {
        child.kill("SIGKILL");
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          wait(2000)
        ]);
      }
      child.stderr?.destroy();
      child.unref();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    if (profile) {
      try {
        fs.rmSync(profile, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 250
        });
      } catch (cleanupError) {
        console.warn(`Warning: unable to remove temporary Chrome profile ${profile}: ${cleanupError.message}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
