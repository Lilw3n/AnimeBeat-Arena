const { app, BrowserWindow, BrowserView, ipcMain, shell } = require("electron");
const path = require("path");
const { registerStreamIpc } = require("./stream/service");
const obsBridge = require("./stream/obs-bridge");
const { loadConfig } = require("./stream/config");
const multistream = require("./stream/multistream");
const ssnBridge = require("./stream/ssn-bridge");
const streamerbotBridge = require("./stream/streamerbot-bridge");
const {
  LIVE_SOURCES,
  POWER_SOURCES,
  SLOT_COUNT,
  MAX_SCREENS,
  defaultSlotSourceIds,
  defaultSourcePower,
} = require("./sources");

const APP_SITE_URL = LIVE_SOURCES.find((s) => s.id === "site")?.url || "https://animebeat-arena.vercel.app";
const BLANK_URL = "about:blank";

let mainWindow = null;
let commandWindow = null;
let slotViews = [];
let chatView = null;
let slotLoadedUrls = Array.from({ length: SLOT_COUNT }, () => "");
let slotSourceIds = defaultSlotSourceIds();
let slotLastLiveIds = defaultSlotSourceIds();
/** @type {("live" | "live-fs" | "site")[]} */
let slotDisplayMode = Array.from({ length: SLOT_COUNT }, () => "live");
let sourcePower = defaultSourcePower();
let screenCount = 1;
let toolbarHeight = 140;
const CHAT_PANEL_WIDTH = 380;
let chatVisible = true;
let chatMode = "mix";

function ensureAttached(view) {
  if (!mainWindow.getBrowserViews().includes(view)) {
    mainWindow.addBrowserView(view);
  }
}

function detachAllViews() {
  for (const view of mainWindow.getBrowserViews()) {
    mainWindow.removeBrowserView(view);
  }
}

function suspendSlot(slotIndex) {
  const view = slotViews[slotIndex];
  if (!view || view.webContents.isDestroyed()) return;
  try {
    view.webContents.setAudioMuted(true);
  } catch {
    /* ignore */
  }
  if (slotLoadedUrls[slotIndex] !== BLANK_URL) {
    view.webContents.loadURL(BLANK_URL);
    slotLoadedUrls[slotIndex] = BLANK_URL;
  }
}

function activateSlot(slotIndex) {
  const view = slotViews[slotIndex];
  if (!view || view.webContents.isDestroyed()) return;
  try {
    view.webContents.setAudioMuted(false);
  } catch {
    /* ignore */
  }
  ensureSlotLoaded(slotIndex);
}

function getSourceById(id) {
  if (id === "site") {
    return { id: "site", title: "Site", url: APP_SITE_URL };
  }
  return LIVE_SOURCES.find((source) => source.id === id) ?? POWER_SOURCES[0];
}

function getFirstPoweredLiveId() {
  return POWER_SOURCES.find((source) => sourcePower[source.id])?.id ?? POWER_SOURCES[0].id;
}

function getOffPlaceholderUrl(sourceTitle) {
  const html = `<!doctype html><html><body style="margin:0;background:#0a1022;color:#d5dcff;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;"><div style="text-align:center;opacity:.92"><div style="font-size:14px;font-weight:600;">${sourceTitle}</div><div style="margin-top:8px;font-size:12px;opacity:.82;">Chaîne éteinte</div></div></body></html>`;
  return `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
}

function getChatModeLabel(mode) {
  const labels = {
    mix: "Mix",
    ssn: "Social Stream Ninja",
    kick: "Kick",
    twitch: "Twitch",
    tiktok: "TikTok",
    youtube: "YouTube",
    telegram: "Telegram",
  };
  return labels[mode] || mode;
}

function getChatPanelHtml(mode) {
  const twitch = "https://www.twitch.tv/popout/lilwen54/chat";
  const kick = "https://kick.com/lilwen54";
  const tiktok1 = "https://www.tiktok.com/@idontlikeuspam/live";
  const tiktok2 = "https://www.tiktok.com/@kanekiakadiddy/live";
  const showTwitch = mode === "mix" || mode === "twitch";
  const showKick = mode === "mix" || mode === "kick";
  const showTikTok = mode === "mix" || mode === "tiktok";
  return `<!doctype html><html><body style="margin:0;background:#080f21;color:#e7edff;font-family:Segoe UI,sans-serif;">
  <div style="padding:10px;border-bottom:1px solid rgba(130,154,255,.3);font-size:12px;font-weight:600;">Chat ${getChatModeLabel(mode)}</div>
  <div style="padding:8px;display:flex;flex-direction:column;gap:8px;">
    ${showTwitch ? `<iframe title="Twitch chat" src="${twitch}" style="height:220px;border:1px solid rgba(130,154,255,.3);border-radius:8px;width:100%;"></iframe>` : ""}
    ${showKick ? `<iframe title="Kick chat" src="${kick}" style="height:220px;border:1px solid rgba(130,154,255,.3);border-radius:8px;width:100%;"></iframe>` : ""}
    ${
      showTikTok
        ? `<div style="border:1px solid rgba(130,154,255,.3);border-radius:8px;padding:10px;font-size:12px;line-height:1.4;">
      TikTok chat souvent bloqué en iframe.<br/><a href="${tiktok1}" style="color:#9fb6ff;">TikTok 1</a> · <a href="${tiktok2}" style="color:#9fb6ff;">TikTok 2</a>
    </div>`
        : ""
    }
    <div style="font-size:11px;opacity:.75;line-height:1.4;">Préfère le mode <b>SSN</b> (Social Stream Ninja) pour le chat multi-plateformes unifié.</div>
  </div></body></html>`;
}

function ensureChatLoaded() {
  if (!chatView) return;
  if (chatMode === "ssn") {
    try {
      const config = loadConfig();
      const url = ssnBridge.dockUrl(config);
      if (url) {
        chatView.webContents.loadURL(url);
        return;
      }
      const html = `<!doctype html><html><body style="margin:0;background:#080f21;color:#e7edff;font-family:Segoe UI,sans-serif;padding:14px;font-size:12px;line-height:1.5;">
        <b>Social Stream Ninja</b><br/>Configure le Session ID dans Stream Command → section SSN.<br/>
        Active dans l'extension : Remote API + Send chat to API server.
      </body></html>`;
      chatView.webContents.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
      return;
    } catch {
      /* fall through */
    }
  }
  const html = getChatPanelHtml(chatMode);
  chatView.webContents.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
}

function tryExitContentFullscreen(view) {
  if (!view) return;
  view.webContents
    .executeJavaScript(
      `(function(){try{if(document.fullscreenElement)document.exitFullscreen();}catch(e){}})();`,
      true,
    )
    .catch(() => {});
}

function tryEnterLiveFullscreen(view) {
  if (!view) return;
  const script = `(function(){
    function tryOne(el){try{if(el&&el.requestFullscreen)return el.requestFullscreen();}catch(e){}}
    var v=document.querySelector('video');
    if(v)return tryOne(v);
    var ifr=document.querySelector('iframe');
    if(ifr)return tryOne(ifr);
    return tryOne(document.documentElement);
  })();`;
  const run = () => view.webContents.executeJavaScript(script, true).catch(() => {});
  setTimeout(run, 400);
  setTimeout(run, 1500);
  setTimeout(run, 3200);
}

function ensureSlotLoaded(slotIndex) {
  let sourceId = slotSourceIds[slotIndex];
  if (slotDisplayMode[slotIndex] === "site") {
    sourceId = "site";
    slotSourceIds[slotIndex] = "site";
  } else if (sourceId === "site") {
    sourceId = slotLastLiveIds[slotIndex] || getFirstPoweredLiveId();
    slotSourceIds[slotIndex] = sourceId;
  }
  if (sourceId !== "site" && !sourcePower[sourceId]) {
    sourceId = getFirstPoweredLiveId();
    slotSourceIds[slotIndex] = sourceId;
  }
  const source = getSourceById(sourceId);
  const view = slotViews[slotIndex];
  if (!view) return;
  const targetUrl =
    source.id !== "site" && !sourcePower[source.id] ? getOffPlaceholderUrl(source.title) : source.url;
  const mode = slotDisplayMode[slotIndex];
  const urlChanged = slotLoadedUrls[slotIndex] !== targetUrl;

  const afterLoad = () => {
    if (mode === "live-fs" && source.id !== "site" && sourcePower[source.id]) {
      tryEnterLiveFullscreen(view);
    }
  };

  if (urlChanged) {
    if (mode === "live") tryExitContentFullscreen(view);
    view.webContents.once("did-finish-load", afterLoad);
    view.webContents.loadURL(targetUrl);
    slotLoadedUrls[slotIndex] = targetUrl;
  } else if (mode === "live-fs" && source.id !== "site" && sourcePower[source.id]) {
    afterLoad();
  } else if (mode === "live") {
    tryExitContentFullscreen(view);
  }
}

function gridColsForCount(n) {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 2;
  if (n === 4) return 2;
  if (n <= 6) return 3;
  if (n <= 9) return 3;
  return 5; // 10 → 5x2
}

function layoutBoundsForCount(activeCount, streamWidth, topBar, availableHeight) {
  if (activeCount <= 0) return [];
  if (activeCount === 1) {
    return [{ x: 0, y: topBar, width: streamWidth, height: availableHeight }];
  }
  if (activeCount === 2) {
    const leftWidth = Math.floor(streamWidth / 2);
    return [
      { x: 0, y: topBar, width: leftWidth, height: availableHeight },
      { x: leftWidth, y: topBar, width: streamWidth - leftWidth, height: availableHeight },
    ];
  }
  if (activeCount === 3) {
    const leftWidth = Math.floor(streamWidth * 0.62);
    const rightWidth = streamWidth - leftWidth;
    const topRightHeight = Math.floor(availableHeight / 2);
    return [
      { x: 0, y: topBar, width: leftWidth, height: availableHeight },
      { x: leftWidth, y: topBar, width: rightWidth, height: topRightHeight },
      {
        x: leftWidth,
        y: topBar + topRightHeight,
        width: rightWidth,
        height: availableHeight - topRightHeight,
      },
    ];
  }

  const cols = gridColsForCount(activeCount);
  const rows = Math.ceil(activeCount / cols);
  const cellW = Math.floor(streamWidth / cols);
  const cellH = Math.floor(availableHeight / rows);
  const bounds = [];
  for (let i = 0; i < activeCount; i += 1) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const isLastCol = c === cols - 1;
    const isLastRow = r === rows - 1;
    bounds.push({
      x: c * cellW,
      y: topBar + r * cellH,
      width: isLastCol ? streamWidth - c * cellW : cellW,
      height: isLastRow ? availableHeight - r * cellH : cellH,
    });
  }
  return bounds;
}

function applyLayout() {
  if (!mainWindow) return;
  const [width, height] = mainWindow.getContentSize();
  detachAllViews();

  const activeCount = Math.max(1, Math.min(MAX_SCREENS, screenCount));
  const topBar = Math.max(96, Math.min(420, toolbarHeight));
  const availableHeight = Math.max(160, height - topBar);
  const streamWidth = chatVisible ? Math.max(680, width - CHAT_PANEL_WIDTH) : width;

  for (let i = 0; i < SLOT_COUNT; i += 1) {
    if (i < activeCount) activateSlot(i);
    else suspendSlot(i);
  }

  const bounds = layoutBoundsForCount(activeCount, streamWidth, topBar, availableHeight);
  for (let i = 0; i < activeCount; i += 1) {
    const view = slotViews[i];
    if (!view) continue;
    ensureAttached(view);
    view.setBounds(bounds[i]);
    view.setAutoResize({ width: true, height: true });
  }

  const labels = slotSourceIds
    .slice(0, activeCount)
    .map((id, idx) => {
      const m = slotDisplayMode[idx];
      const suffix = m === "site" ? " [Site]" : m === "live-fs" ? " [FS]" : "";
      return `E${idx + 1}:${getSourceById(id).title}${suffix}`;
    })
    .join(" ");
  mainWindow.setTitle(`AnimeBeat Live Hub - ${activeCount} ecran(s) - ${labels}`);

  if (chatVisible && chatView) {
    try {
      chatView.webContents.setAudioMuted(false);
    } catch {
      /* ignore */
    }
    ensureChatLoaded();
    ensureAttached(chatView);
    chatView.setBounds({
      x: streamWidth,
      y: topBar,
      width: width - streamWidth,
      height: availableHeight,
    });
    chatView.setAutoResize({ width: true, height: true });
  } else if (chatView && !chatView.webContents.isDestroyed()) {
    try {
      chatView.webContents.setAudioMuted(true);
    } catch {
      /* ignore */
    }
  }
}

function createCommandWindow() {
  if (commandWindow && !commandWindow.isDestroyed()) {
    commandWindow.focus();
    return commandWindow;
  }

  commandWindow = new BrowserWindow({
    width: 1180,
    height: 900,
    autoHideMenuBar: true,
    backgroundColor: "#070b19",
    webPreferences: {
      preload: path.join(__dirname, "preload-command.js"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  commandWindow.loadFile(path.join(__dirname, "command.html"));
  commandWindow.on("closed", () => {
    commandWindow = null;
  });
  return commandWindow;
}

async function syncObsForScreenCount(count) {
  try {
    const config = loadConfig();
    await obsBridge.switchSceneForScreenCount(config.obs, count);
  } catch {
    /* optional */
  }
}

function createSlotView() {
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });
  view.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    shell.openExternal(nextUrl);
    return { action: "deny" };
  });
  return view;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    autoHideMenuBar: true,
    backgroundColor: "#070b19",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "toolbar.html"));

  slotViews = Array.from({ length: SLOT_COUNT }, () => createSlotView());
  slotLoadedUrls = Array.from({ length: SLOT_COUNT }, () => "");
  chatView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });
  chatView.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    shell.openExternal(nextUrl);
    return { action: "deny" };
  });
  ensureChatLoaded();

  applyLayout();

  mainWindow.on("resize", applyLayout);
  mainWindow.on("closed", () => {
    mainWindow = null;
    slotViews = [];
    chatView = null;
    slotLoadedUrls = [];
  });

  mainWindow.webContents.on("before-input-event", (_, input) => {
    if (!input.control || input.type !== "keyDown") return;
    if (input.key >= "1" && input.key <= "9") {
      screenCount = Number(input.key);
      applyLayout();
      syncObsForScreenCount(screenCount);
    } else if (input.key === "0") {
      screenCount = 10;
      applyLayout();
      syncObsForScreenCount(screenCount);
    } else if (input.key.toLowerCase() === "f") {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    } else if (input.key.toLowerCase() === "c") {
      chatVisible = !chatVisible;
      applyLayout();
    } else if (input.key.toLowerCase() === "s") {
      createCommandWindow();
    }
  });
}

ipcMain.on("set-screen-count", (_, count) => {
  const nextCount = Number(count);
  if (!Number.isInteger(nextCount) || nextCount < 1 || nextCount > MAX_SCREENS) return;
  screenCount = nextCount;
  applyLayout();
  syncObsForScreenCount(screenCount);
});

ipcMain.on("open-command-center", () => {
  createCommandWindow();
});

ipcMain.on("set-toolbar-height", (_, height) => {
  const next = Number(height);
  if (!Number.isFinite(next) || next < 80 || next > 480) return;
  if (Math.abs(next - toolbarHeight) < 1) return;
  toolbarHeight = next;
  applyLayout();
});

ipcMain.on("set-slot-source", (_, payload) => {
  if (!payload || typeof payload !== "object") return;
  const slotIndex = Number(payload.slotIndex);
  const sourceId = String(payload.sourceId);
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SLOT_COUNT) return;

  if (sourceId === "site") {
    slotSourceIds[slotIndex] = "site";
    slotDisplayMode[slotIndex] = "site";
  } else {
    const validLive = POWER_SOURCES.some((source) => source.id === sourceId);
    if (!validLive) return;
    slotSourceIds[slotIndex] = sourceId;
    slotLastLiveIds[slotIndex] = sourceId;
    if (slotDisplayMode[slotIndex] === "site") {
      slotDisplayMode[slotIndex] = "live";
    }
  }
  slotLoadedUrls[slotIndex] = "";
  applyLayout();
});

ipcMain.on("toggle-source-power", (_, payload) => {
  if (!payload || typeof payload !== "object") return;
  const sourceId = String(payload.sourceId);
  const powered = Boolean(payload.powered);
  if (!POWER_SOURCES.some((source) => source.id === sourceId)) return;

  sourcePower[sourceId] = powered;

  for (let i = 0; i < SLOT_COUNT; i += 1) {
    if (slotSourceIds[i] === sourceId || slotLastLiveIds[i] === sourceId) {
      slotLoadedUrls[i] = "";
      if (!powered) {
        suspendSlot(i);
        const fallbackId = getFirstPoweredLiveId();
        if (fallbackId && fallbackId !== sourceId) {
          slotSourceIds[i] = fallbackId;
          slotLastLiveIds[i] = fallbackId;
        }
      }
    }
  }

  const source = getSourceById(sourceId);
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const view = slotViews[i];
    if (!view || view.webContents.isDestroyed()) continue;
    const current = view.webContents.getURL();
    if (!powered && source?.url && current.startsWith(source.url.split("?")[0])) {
      suspendSlot(i);
    }
  }

  applyLayout();
});

ipcMain.on("set-chat-visible", (_, visible) => {
  chatVisible = Boolean(visible);
  applyLayout();
});

ipcMain.on("set-chat-mode", (_, mode) => {
  const nextMode = String(mode);
  if (!["mix", "ssn", "kick", "twitch", "tiktok", "youtube", "telegram"].includes(nextMode)) return;
  chatMode = nextMode;
  applyLayout();
});

ipcMain.on("set-slot-mode", (_, payload) => {
  if (!payload || typeof payload !== "object") return;
  const slotIndex = Number(payload.slotIndex);
  const mode = String(payload.mode);
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SLOT_COUNT) return;

  if (mode === "site") {
    slotSourceIds[slotIndex] = "site";
    slotDisplayMode[slotIndex] = "site";
  } else if (mode === "live" || mode === "live-fs") {
    const liveId = slotLastLiveIds[slotIndex] || getFirstPoweredLiveId();
    slotSourceIds[slotIndex] = liveId;
    slotDisplayMode[slotIndex] = mode;
  } else {
    return;
  }
  slotLoadedUrls[slotIndex] = "";
  applyLayout();
});

ipcMain.on("toggle-fullscreen", () => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

ipcMain.handle("hub:get-catalog", () => ({
  sources: LIVE_SOURCES,
  powerSources: POWER_SOURCES,
  slotCount: SLOT_COUNT,
  maxScreens: MAX_SCREENS,
}));

app.whenReady().then(() => {
  registerStreamIpc({
    getScreenCount: () => screenCount,
    getCommandWindow: () => commandWindow,
  });

  createMainWindow();

  const config = loadConfig();
  if (config.obs?.enabled) {
    obsBridge.connect(config.obs).catch(() => {});
  }
  if (config.socialStreamNinja?.enabled && config.socialStreamNinja?.sessionId) {
    ssnBridge.connect(config);
    chatMode = "ssn";
    ensureChatLoaded();
    applyLayout();
  }
  if (config.streamerBot?.enabled) {
    streamerbotBridge.connect(config).catch(() => {});
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  multistream.stop(loadConfig()).catch(() => {});
  obsBridge.disconnect().catch(() => {});
});
