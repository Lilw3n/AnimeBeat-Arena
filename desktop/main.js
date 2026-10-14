const { app, BrowserWindow, BrowserView, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");

// Une seule instance : plusieurs Electron = cookies IG/FB corrompus → déconnexion permanente
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

const { registerStreamIpc } = require("./stream/service");
const obsBridge = require("./stream/obs-bridge");
const { loadConfig } = require("./stream/config");
const multistream = require("./stream/multistream");
const ssnBridge = require("./stream/ssn-bridge");
const streamerbotBridge = require("./stream/streamerbot-bridge");
const companions = require("./stream/companions");
const autoUpdate = require("./stream/auto-update");
const { buildLiveLinks } = require("./stream/live-links");
const { applyChromeUaFallback, flushSession, getHardenedSession } = require("./stream/persist-session");
const browserNav = require("./browser-nav");
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
/** Dernier slot focusé pour ← → ↻ de la toolbar */
let focusedSlotIndex = 0;

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

const CHAT_DIRECT_URLS = {
  twitch: "https://www.twitch.tv/popout/lilwen54/chat",
  kick: "https://kick.com/popout/lilwen54/chat",
  youtube: "https://www.youtube.com/live_chat?is_popout=1",
  telegram: "https://web.telegram.org/k/",
};

function getChatPanelHtml(mode) {
  const twitch = CHAT_DIRECT_URLS.twitch;
  const kick = CHAT_DIRECT_URLS.kick;
  const tiktokMain = "https://www.tiktok.com/@lilwen54";
  const tiktok1 = "https://www.tiktok.com/@idontlikeuspam/live";
  const tiktok2 = "https://www.tiktok.com/@kanekiakadiddy/live";
  // Twitch/Kick refusent les iframes (ERR_BLOCKED_BY_RESPONSE) → liens seulement en mode Mix
  return `<!doctype html><html><body style="margin:0;background:#080f21;color:#e7edff;font-family:Segoe UI,sans-serif;">
  <div style="padding:10px;border-bottom:1px solid rgba(130,154,255,.3);font-size:12px;font-weight:600;">Chat ${getChatModeLabel(mode)}</div>
  <div style="padding:12px;display:flex;flex-direction:column;gap:10px;font-size:12px;line-height:1.45;">
    <div style="border:1px solid rgba(130,154,255,.3);border-radius:8px;padding:10px;">
      Twitch / Kick <b>bloquent les iframes</b> dans Electron.<br/>
      Utilise le mode <b>SSN</b>, ou choisis <b>Twitch</b> / <b>Kick</b> seuls (chargement plein panneau).<br/>
      <a href="${twitch}" style="color:#9fb6ff;">Ouvrir chat Twitch</a> ·
      <a href="${kick}" style="color:#9fb6ff;">Ouvrir chat Kick</a>
    </div>
    ${
      mode === "mix" || mode === "tiktok"
        ? `<div style="border:1px solid rgba(130,154,255,.3);border-radius:8px;padding:10px;">
      TikTok : <a href="${tiktokMain}" style="color:#9fb6ff;">@lilwen54</a> ·
      <a href="${tiktok1}" style="color:#9fb6ff;">Live 1</a> ·
      <a href="${tiktok2}" style="color:#9fb6ff;">Live 2</a>
    </div>`
        : ""
    }
    <div style="font-size:11px;opacity:.8;">Astuce : mode <b>Chat SSN</b> = tous les chats unifiés (recommandé).</div>
  </div></body></html>`;
}

function ensureChatLoaded() {
  if (!chatView) return;
  // Modes plateforme : navigation top-level (pas d'iframe → plus d'ERR_BLOCKED_BY_RESPONSE)
  if (CHAT_DIRECT_URLS[chatMode]) {
    chatView.webContents.loadURL(CHAT_DIRECT_URLS[chatMode]).catch(() => {});
    return;
  }
  if (chatMode === "ssn") {
    try {
      const config = loadConfig();
      let url = ssnBridge.dockUrl(config);
      // Réduit les essais TURN VDO.Ninja inutiles pour le dock chat (DNS -105 si réseau/VPN)
      if (url && !/[?&](noturn|novideo)=/i.test(url)) {
        url += (url.includes("?") ? "&" : "?") + "noturn&novideo";
      }
      if (url) {
        chatView.webContents.loadURL(url).catch(() => {});
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

/** Choisit cols/rows pour coller au ratio dispo (cible ~16:9 par cellule). */
function bestGrid(n, areaW, areaH) {
  let best = { cols: 1, rows: n, score: Number.POSITIVE_INFINITY };
  const target = 16 / 9;
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const cellW = areaW / cols;
    const cellH = areaH / rows;
    if (cellW < 80 || cellH < 60) continue;
    const ratio = cellW / Math.max(1, cellH);
    const ratioScore = Math.abs(Math.log(ratio / target));
    const unused = cols * rows - n;
    // Pénalise les grilles trop « plates » ou trop « hautes » vs la fenêtre
    const packScore = unused * 0.18;
    const score = ratioScore + packScore;
    if (score < best.score) best = { cols, rows, score };
  }
  return best;
}

function uniformGridBounds(activeCount, streamWidth, topBar, availableHeight, cols, rows) {
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

function layoutBoundsForCount(activeCount, streamWidth, topBar, availableHeight) {
  if (activeCount <= 0) return [];
  const aspect = streamWidth / Math.max(1, availableHeight);

  if (activeCount === 1) {
    return [{ x: 0, y: topBar, width: streamWidth, height: availableHeight }];
  }

  // 2 écrans : côte à côte si large, empilés si fenêtre haute/étroite
  if (activeCount === 2) {
    if (aspect < 1.15) {
      const topH = Math.floor(availableHeight / 2);
      return [
        { x: 0, y: topBar, width: streamWidth, height: topH },
        {
          x: 0,
          y: topBar + topH,
          width: streamWidth,
          height: availableHeight - topH,
        },
      ];
    }
    const leftWidth = Math.floor(streamWidth / 2);
    return [
      { x: 0, y: topBar, width: leftWidth, height: availableHeight },
      { x: leftWidth, y: topBar, width: streamWidth - leftWidth, height: availableHeight },
    ];
  }

  // 3 écrans : hero gauche si assez large, sinon grille 2+1 / pile
  if (activeCount === 3 && aspect >= 1.35) {
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

  const { cols, rows } = bestGrid(activeCount, streamWidth, availableHeight);
  return uniformGridBounds(activeCount, streamWidth, topBar, availableHeight, cols, rows);
}

/** Zoom contenu selon la taille de la tuile (réf. 1280×720). */
function zoomForBounds(bounds, mode) {
  if (!bounds) return 1;
  // Mode FS : laisse la page gérer le plein écran interne
  if (mode === "live-fs") return 1;
  const z = Math.min(bounds.width / 1280, bounds.height / 720);
  // Petite tuile → dézoom pour voir plus ; grande → zoom léger max 1.1
  return Math.max(0.4, Math.min(1.1, Number(z.toFixed(3))));
}

function applyViewZoom(view, zoom) {
  if (!view || view.webContents.isDestroyed()) return;
  try {
    view.webContents.setZoomFactor(zoom);
  } catch {
    /* ignore */
  }
}

function chatWidthForWindow(totalWidth) {
  if (!chatVisible) return 0;
  // Chat proportionnel, borné, pour laisser de la place aux lives
  const ideal = Math.round(totalWidth * 0.22);
  return Math.max(260, Math.min(CHAT_PANEL_WIDTH, ideal));
}

function applyLayout() {
  if (!mainWindow) return;
  const [width, height] = mainWindow.getContentSize();
  detachAllViews();

  const activeCount = Math.max(1, Math.min(MAX_SCREENS, screenCount));
  const topBar = Math.max(96, Math.min(420, toolbarHeight));
  const availableHeight = Math.max(120, height - topBar);
  const chatW = chatWidthForWindow(width);
  // Sur fenêtre étroite : réduit le chat pour garder les pages utilisables
  const minStream = width < 1100 ? Math.floor(width * 0.55) : 640;
  const streamWidth = chatVisible
    ? Math.max(minStream, width - chatW)
    : width;
  const actualChatW = chatVisible ? Math.max(200, width - streamWidth) : 0;

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
    // Pas d'autoResize : applyLayout gère resize + count
    view.setAutoResize({ width: false, height: false });
    applyViewZoom(view, zoomForBounds(bounds[i], slotDisplayMode[i]));
  }

  const labels = slotSourceIds
    .slice(0, activeCount)
    .map((id, idx) => {
      const m = slotDisplayMode[idx];
      const suffix = m === "site" ? " [Site]" : m === "live-fs" ? " [FS]" : "";
      return `E${idx + 1}:${getSourceById(id).title}${suffix}`;
    })
    .join(" ");
  const info = getAppInfo();
  mainWindow.setTitle(
    `AnimeBeat Live Hub ${info.titleStamp} - ${activeCount} ecran(s) - ${labels}`,
  );

  if (chatVisible && chatView && actualChatW > 0) {
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
      width: actualChatW,
      height: availableHeight,
    });
    chatView.setAutoResize({ width: false, height: false });
    applyViewZoom(chatView, zoomForBounds({ width: actualChatW, height: availableHeight }, "live"));
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

  const info = getAppInfo();
  commandWindow = new BrowserWindow({
    width: 1180,
    height: 900,
    autoHideMenuBar: true,
    backgroundColor: "#070b19",
    title: `AnimeBeat Stream Command ${info.titleStamp}`,
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

function createSlotView(slotIndex = 0) {
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
  browserNav.attachNavigation(view.webContents);
  view.webContents.on("focus", () => {
    focusedSlotIndex = slotIndex;
  });
  // Certains focus passent par dom-ready / click
  view.webContents.on("dom-ready", () => {
    focusedSlotIndex = slotIndex;
  });
  return view;
}

function getFocusedSlotWebContents() {
  const idx = Math.max(0, Math.min(SLOT_COUNT - 1, focusedSlotIndex));
  const view = slotViews[idx];
  if (view && !view.webContents.isDestroyed()) return { idx, wc: view.webContents };
  // fallback: premier slot visible
  for (let i = 0; i < screenCount; i += 1) {
    const v = slotViews[i];
    if (v && !v.webContents.isDestroyed()) return { idx: i, wc: v.webContents };
  }
  return null;
}

function createMainWindow() {
  const info = getAppInfo();
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    autoHideMenuBar: true,
    backgroundColor: "#070b19",
    title: `AnimeBeat Live Hub ${info.titleStamp}`,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "toolbar.html"));

  slotViews = Array.from({ length: SLOT_COUNT }, (_, i) => createSlotView(i));
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
  browserNav.attachNavigation(chatView.webContents);
  ensureChatLoaded();

  applyLayout();

  let resizeTimer = null;
  const scheduleLayout = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      applyLayout();
    }, 40);
  };
  mainWindow.on("resize", scheduleLayout);
  mainWindow.on("maximize", applyLayout);
  mainWindow.on("unmaximize", applyLayout);
  mainWindow.on("enter-full-screen", applyLayout);
  mainWindow.on("leave-full-screen", applyLayout);
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

function formatAppDateTime(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

/** Date/heure du code chargé (mtime) — prouve qu’une mise à jour est bien prise. */
function getCodeStampMs() {
  const candidates = [
    path.join(__dirname, "main.js"),
    path.join(__dirname, "package.json"),
    path.join(__dirname, "stream", "platforms", "instagram-live-producer.js"),
  ];
  let latest = 0;
  for (const file of candidates) {
    try {
      const st = fs.statSync(file);
      if (st.mtimeMs > latest) latest = st.mtimeMs;
    } catch {
      /* ignore */
    }
  }
  return latest || Date.now();
}

const APP_STARTED_AT = new Date();
let cachedAppInfo = null;

function getAppInfo() {
  if (cachedAppInfo) return cachedAppInfo;
  const pkg = (() => {
    try {
      return require(path.join(__dirname, "package.json"));
    } catch {
      return { version: app.getVersion() };
    }
  })();
  const version = String(pkg.version || app.getVersion() || "?");
  const channel = app.isPackaged ? "installé" : "dev";
  const codeAt = new Date(getCodeStampMs());
  const codeStamp = formatAppDateTime(codeAt);
  const startedStamp = formatAppDateTime(APP_STARTED_AT);
  // Titre: version + date/heure du code (mise à jour) + canal
  const titleStamp = `v${version} · ${codeStamp} · ${channel}`;
  cachedAppInfo = {
    name: pkg.productName || pkg.name || "AnimeBeat Live Hub",
    version,
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    execPath: process.execPath,
    channel,
    codeStamp,
    codeAt: codeAt.toISOString(),
    startedStamp,
    startedAt: APP_STARTED_AT.toISOString(),
    titleStamp,
  };
  return cachedAppInfo;
}

ipcMain.handle("hub:get-app-info", () => getAppInfo());

ipcMain.handle("hub:get-catalog", () => ({
  sources: LIVE_SOURCES,
  powerSources: POWER_SOURCES,
  slotCount: SLOT_COUNT,
  maxScreens: MAX_SCREENS,
  liveLinks: buildLiveLinks(loadConfig()),
}));

ipcMain.handle("hub:get-live-links", () => buildLiveLinks(loadConfig()));

ipcMain.handle("hub:copy-text", async (_e, text) => {
  const { clipboard } = require("electron");
  clipboard.writeText(String(text || ""));
  return { ok: true };
});

ipcMain.handle("hub:nav", (_e, payload = {}) => {
  const action = String(payload.action || "");
  const slotIndex =
    payload.slotIndex == null ? null : Number(payload.slotIndex);
  let wc = null;
  let idx = focusedSlotIndex;
  if (Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < SLOT_COUNT) {
    const view = slotViews[slotIndex];
    if (view && !view.webContents.isDestroyed()) {
      wc = view.webContents;
      idx = slotIndex;
      focusedSlotIndex = slotIndex;
    }
  }
  if (!wc) {
    const focused = getFocusedSlotWebContents();
    if (!focused) return { ok: false, reason: "aucun slot" };
    wc = focused.wc;
    idx = focused.idx;
  }
  if (action === "back") return { ok: browserNav.goBack(wc), slotIndex: idx };
  if (action === "forward") return { ok: browserNav.goForward(wc), slotIndex: idx };
  if (action === "reload") return { ok: browserNav.reload(wc, false), slotIndex: idx };
  if (action === "hard-reload") return { ok: browserNav.reload(wc, true), slotIndex: idx };
  return { ok: false, reason: `action inconnue: ${action}` };
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function openSourceUrl(sourceId) {
  const source = getSourceById(String(sourceId));
  const url = source?.url;
  if (!url || url === "about:blank") {
    return { ok: false, reason: "URL introuvable", sourceId };
  }
  await shell.openExternal(url);
  return { ok: true, sourceId, title: source.title, url };
}

ipcMain.handle("hub:open-source-link", async (_e, sourceId) => openSourceUrl(sourceId));

ipcMain.handle("hub:open-url", async (_e, rawUrl) => {
  let url = String(rawUrl || "").trim();
  if (!url) return { ok: false, reason: "URL vide" };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  await shell.openExternal(url);
  return { ok: true, url };
});

ipcMain.handle("hub:open-source-links", async (_e, payload = {}) => {
  const sequential = payload?.sequential !== false;
  const delayMs = Math.max(200, Number(payload?.delayMs) || 700);
  const onlyPowered = payload?.onlyPowered !== false;
  const includeSite = Boolean(payload?.includeSite);

  const list = [];
  for (const src of POWER_SOURCES) {
    if (onlyPowered && !sourcePower[src.id]) continue;
    list.push(src);
  }
  if (includeSite) {
    const site = LIVE_SOURCES.find((s) => s.isSite);
    if (site) list.push(site);
  }

  const opened = [];
  for (let i = 0; i < list.length; i += 1) {
    const res = await openSourceUrl(list[i].id);
    opened.push(res);
    if (sequential && i < list.length - 1) await sleep(delayMs);
  }
  return {
    ok: true,
    sequential,
    count: opened.filter((o) => o.ok).length,
    opened,
  };
});

app.on("second-instance", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  if (commandWindow && !commandWindow.isDestroyed()) {
    commandWindow.show();
    commandWindow.focus();
  }
});

app.whenReady().then(async () => {
  applyChromeUaFallback();

  registerStreamIpc({
    getScreenCount: () => screenCount,
    getCommandWindow: () => commandWindow,
  });

  createMainWindow();

  let config = loadConfig();
  // stunnel + OBS + SB + SSN avant les connexions WS
  try {
    companions.ensureAll(config);
  } catch {
    /* optional */
  }

  // Laisse le temps aux apps de booter (WS OBS/SB)
  await new Promise((r) => setTimeout(r, 2500));
  config = loadConfig();

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
    streamerbotBridge.connect(config, { retries: 12, delayMs: 2000 }).catch(() => {});
  }

  // Mises à jour auto (installé = NSIS ; DEV = signale release/ plus récente)
  try {
    autoUpdate.startBackgroundChecks();
  } catch {
    /* optional */
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  companions.stopWatch();
  // Sauve les cookies IG/FB avant sortie (évite reconnect obligatoire)
  Promise.all([
    flushSession(getHardenedSession("persist:instagram-live")),
    flushSession(getHardenedSession("persist:facebook-live")),
  ]).catch(() => {});
  multistream.stop(loadConfig()).catch(() => {});
  obsBridge.disconnect().catch(() => {});
});
