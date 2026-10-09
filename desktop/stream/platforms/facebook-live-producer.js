/**
 * Automatise Facebook Live Producer pour une PAGE (pas le profil perso).
 * Ordre : ouvrir la page → Live → clé persistante → titre/jeu → Go Live quand prêt.
 */
const { BrowserWindow, session } = require("electron");
const { notify, pushToWindows } = require("../notify");

const PARTITION = "persist:facebook-live";
const DEFAULT_PAGE_URL = "https://www.facebook.com/profile.php?id=100036165385264";

let win = null;
let lastCredentials = null;
let goLiveWatcher = null;

function getStatus() {
  return {
    open: Boolean(win && !win.isDestroyed()),
    credentials: lastCredentials,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolvePageUrl(facebookConfig = {}) {
  if (facebookConfig.pageUrl) return facebookConfig.pageUrl;
  if (facebookConfig.pageId && String(facebookConfig.pageId).startsWith("http")) {
    return facebookConfig.pageId;
  }
  if (facebookConfig.pageId) {
    return `https://www.facebook.com/profile.php?id=${facebookConfig.pageId}`;
  }
  return DEFAULT_PAGE_URL;
}

function ensureWindow() {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return win;
  }

  const ses = session.fromPartition(PARTITION);
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: "Facebook Live Producer (Page) — AnimeBeat",
    autoHideMenuBar: true,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on("closed", () => {
    win = null;
    if (goLiveWatcher) {
      clearInterval(goLiveWatcher);
      goLiveWatcher = null;
    }
    pushToWindows({ type: "facebook-producer-status", open: false });
  });

  return win;
}

async function waitForLoad(target, timeoutMs = 60000) {
  if (target.webContents.isLoading()) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timeout chargement Facebook")), timeoutMs);
      target.webContents.once("did-finish-load", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  await sleep(1000);
}

async function evalInPage(fnSource, ...args) {
  if (!win || win.isDestroyed()) throw new Error("Fenêtre Facebook fermée");
  const argJson = JSON.stringify(args);
  return win.webContents.executeJavaScript(
    `(async () => {
      const __args = ${argJson};
      const __fn = ${fnSource};
      return await __fn(...__args);
    })()`,
    true,
  );
}

const CLICK_BY_TEXT_HELPER = `
function clickByText(patterns, { exact = false, roleButtonsOnly = false } = {}) {
  const sel = roleButtonsOnly
    ? "button, div[role='button'], a[role='button'], span[role='button']"
    : "button, div[role='button'], a[role='button'], span[role='button'], a, span, div";
  const nodes = [...document.querySelectorAll(sel)];
  for (const el of nodes) {
    const t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();
    if (!t || t.length > 80) continue;
    const hit = patterns.some((p) => (exact ? t === p : t.includes(p)));
    if (!hit) continue;
    el.click();
    return t;
  }
  return null;
}

function setReactInput(el, value) {
  if (!el) return false;
  el.focus();
  const proto = el.tagName === "TEXTAREA"
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}
`;

const OPEN_LIVE_FN = `async function openLiveFromPage() {
  ${CLICK_BY_TEXT_HELPER}
  const body = (document.body?.innerText || "").toLowerCase();
  const url = location.href;

  if (/login|connexion|identifiez/.test(url) || /se connecter|log in/.test(body)) {
    return { ok: false, needLogin: true, url };
  }

  // Déjà sur Live Producer ?
  if (/live\\/producer|live_composer|live_producer|livestream/.test(url)
    || /clé de stream|stream key|configuration du logiciel|lancer un direct|configurer la vidéo/.test(body)) {
    // Passer l'écran d'intro si présent
    clickByText(["configurer la vidéo en direct", "set up live video", "go live"]);
    await new Promise((r) => setTimeout(r, 800));
    return { ok: true, already: true, url: location.href };
  }

  // Depuis la PAGE : Vidéo en direct
  let clicked = clickByText(["vidéo en direct", "live video", "go live", "en direct"]);
  if (!clicked) {
    // menu Créer / Live
    clickByText(["créer", "create"]);
    await new Promise((r) => setTimeout(r, 600));
    clicked = clickByText(["vidéo en direct", "live video", "live"]);
  }
  await new Promise((r) => setTimeout(r, 1200));

  clickByText(["configurer la vidéo en direct", "set up live video"]);
  await new Promise((r) => setTimeout(r, 1000));

  const body2 = (document.body?.innerText || "").toLowerCase();
  if (/clé de stream|stream key|configuration du logiciel|modifier les détails/.test(body2)
    || /live\\/producer|live_composer/.test(location.href)) {
    return { ok: true, clicked, url: location.href };
  }
  return { ok: false, reason: "Live Producer non atteint — clique Vidéo en direct sur la PAGE", url: location.href };
}`;

const ENSURE_PERSISTENT_AND_SCRAPE_FN = `async function ensurePersistentAndScrape() {
  ${CLICK_BY_TEXT_HELPER}
  const body = document.body?.innerText || "";
  const lower = body.toLowerCase();

  // Activer clé persistante si toggle visible et off
  const toggles = [...document.querySelectorAll("[role='switch'], input[type='checkbox']")];
  for (const el of toggles) {
    const label = (el.getAttribute("aria-label") || el.closest("label")?.innerText || el.parentElement?.innerText || "").toLowerCase();
    if (!/persistante|persistent/.test(label)) continue;
    const checked = el.getAttribute("aria-checked") === "true" || el.checked === true;
    if (!checked) {
      el.click();
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  // Parfois la section est repliée
  clickByText(["paramètres avancés", "advanced settings", "clé de stream", "stream key"]);

  let rtmpUrl = "";
  let streamKey = "";
  const inputs = [...document.querySelectorAll("input, textarea")];
  for (const el of inputs) {
    const v = (el.value || "").trim();
    if (!v) continue;
    if (/^rtmps?:\\/\\//i.test(v)) rtmpUrl = v.replace(/\\/$/, "");
    else if (/^FB-/i.test(v) || (/^[A-Za-z0-9_-]{16,}$/.test(v) && !/^https?:/i.test(v))) {
      if (!streamKey || v.length > streamKey.length) streamKey = v;
    }
  }

  if (!rtmpUrl) {
    const m = body.match(/rtmps?:\\/\\/[^\\s]+/i);
    if (m) rtmpUrl = m[0].replace(/\\/$/, "");
  }
  if (!streamKey) {
    const m = body.match(/FB-[A-Za-z0-9_-]+/);
    if (m) streamKey = m[0];
  }

  // Normaliser serveur FB
  if (rtmpUrl && !/rtmp/i.test(rtmpUrl.split("/").pop() || "")) {
    // ok
  }
  if (!rtmpUrl) rtmpUrl = "rtmps://live-api-s.facebook.com:443/rtmp";
  else if (!rtmpUrl.includes("/rtmp") && /live-api-s\\.facebook\\.com/i.test(rtmpUrl)) {
    rtmpUrl = rtmpUrl.replace(/\\/$/, "") + "/rtmp";
  }

  const persistentOn = /clé de stream persistante[\\s\\S]{0,80}(activ|on|oui)/i.test(lower)
    || [...document.querySelectorAll("[role='switch']")].some((el) => {
      const label = (el.getAttribute("aria-label") || el.parentElement?.innerText || "").toLowerCase();
      return /persist/.test(label) && el.getAttribute("aria-checked") === "true";
    });

  if (streamKey) {
    return { ok: true, rtmpUrl, streamKey, persistentOn };
  }
  return { ok: false, reason: "Clé de stream introuvable", rtmpUrl, persistentOn };
}`;

const FILL_TITLE_GAME_FN = `async function fillTitleAndGame(title, game, description) {
  ${CLICK_BY_TEXT_HELPER}
  const wantTitle = String(title || "").trim();
  const wantGame = String(game || "").trim();
  const wantDesc = String(description || "").trim();

  // Ouvrir modal détails
  clickByText(["modifier les détails de la publication", "edit post details", "créer une publication"]);
  await new Promise((r) => setTimeout(r, 900));

  const inputs = [...document.querySelectorAll("input, textarea")];
  let titleEl = inputs.find((el) => {
    const lab = ((el.getAttribute("aria-label") || "") + " " + (el.placeholder || "") + " " + (el.previousElementSibling?.innerText || "")).toLowerCase();
    return /titre|title/.test(lab);
  });
  // Fallback : premier input text visible dans un dialog
  if (!titleEl) {
    const dialog = document.querySelector("[role='dialog']") || document.body;
    titleEl = [...dialog.querySelectorAll("input[type='text'], input:not([type]), textarea")].find((el) => el.offsetParent !== null);
  }

  let descEl = inputs.find((el) => {
    const lab = ((el.getAttribute("aria-label") || "") + " " + (el.placeholder || "")).toLowerCase();
    return /description|quoi de neuf|what's on your mind/.test(lab);
  });
  if (!descEl && titleEl) {
    const dialog = titleEl.closest("[role='dialog']") || document.body;
    descEl = [...dialog.querySelectorAll("textarea")].find((el) => el !== titleEl);
  }

  if (wantTitle && titleEl) setReactInput(titleEl, wantTitle);
  if (wantDesc && descEl) setReactInput(descEl, wantDesc);
  else if (wantTitle && descEl && !(descEl.value || "").trim()) setReactInput(descEl, wantTitle);

  clickByText(["enregistrer", "save"], { exact: false });
  await new Promise((r) => setTimeout(r, 800));

  // Jeu (gaming tag)
  let gameFilled = false;
  if (wantGame) {
    let gameInput = [...document.querySelectorAll("input")].find((el) => {
      const ph = ((el.placeholder || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
      return /identifiez un jeu|identify a game|jeu|game|fortnite/.test(ph);
    });
    if (!gameInput) {
      clickByText(["gaming", "jeu"]);
      await new Promise((r) => setTimeout(r, 400));
      gameInput = [...document.querySelectorAll("input")].find((el) => {
        const ph = ((el.placeholder || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
        return /jeu|game|fortnite|identifiez/.test(ph);
      });
    }
    if (gameInput) {
      setReactInput(gameInput, wantGame);
      await new Promise((r) => setTimeout(r, 900));
      // Choisir première suggestion
      const opt = [...document.querySelectorAll("[role='option'], li, div[role='button']")].find((el) => {
        const t = (el.innerText || "").trim().toLowerCase();
        return t && t.includes(wantGame.toLowerCase().slice(0, 12));
      });
      if (opt) opt.click();
      else {
        gameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
      gameFilled = true;
    }
  }

  return {
    ok: Boolean(wantTitle ? titleEl : true),
    titleFilled: Boolean(titleEl && wantTitle),
    gameFilled,
    reason: titleEl ? null : "champ titre introuvable (ouvre Modifier les détails)",
  };
}`;

const GO_LIVE_FN = `async function tryGoLive() {
  ${CLICK_BY_TEXT_HELPER}
  const nodes = [...document.querySelectorAll("button, div[role='button']")];
  for (const el of nodes) {
    const t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();
    if (!(t === "lancer un direct" || t === "go live" || t.includes("lancer le direct") || t.includes("lancer un direct"))) {
      continue;
    }
    const disabled =
      el.getAttribute("aria-disabled") === "true" ||
      el.disabled === true ||
      el.className?.toString?.().includes("disabled") ||
      getComputedStyle(el).opacity < 0.5;
    if (disabled) return { ok: false, ready: false, reason: "bouton pas encore actif (attends le flux OBS)" };
    el.click();
    return { ok: true, ready: true, clicked: t };
  }
  return { ok: false, ready: false, reason: "bouton Lancer un direct introuvable" };
}`;

async function openProducer(facebookConfig = {}) {
  const pageUrl = resolvePageUrl(facebookConfig);
  const target = ensureWindow();
  await target.loadURL(pageUrl);
  await waitForLoad(target);
  pushToWindows({ type: "facebook-producer-status", open: true, pageUrl });
  return { ok: true, pageUrl, url: target.webContents.getURL() };
}

/**
 * Prépare le live page : Live Producer + clé persistante + titre/jeu.
 */
async function prepareLive(facebookConfig = {}, { title, game, description } = {}) {
  const pageUrl = resolvePageUrl(facebookConfig);
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return { ok: false, reason: "Titre vide pour Facebook" };

  notify("Facebook", `Ouverture PAGE Live…`, "info");
  await openProducer(facebookConfig);
  await sleep(1500);

  // Login wait
  let open = await evalInPage(OPEN_LIVE_FN);
  if (open.needLogin) {
    notify("Facebook", "Connecte-toi (compte qui gère la PAGE), puis on continue…", "warn");
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await sleep(2500);
      // Recharger la page si on est encore sur login
      const url = win.webContents.getURL();
      if (!/login|checkpoint/i.test(url)) {
        if (!url.includes("profile.php") && !/live/i.test(url)) {
          await win.loadURL(pageUrl);
          await waitForLoad(win);
        }
        open = await evalInPage(OPEN_LIVE_FN);
        if (open.ok || !open.needLogin) break;
      }
    }
    if (open.needLogin) {
      return { ok: false, reason: "Login Facebook requis", needLogin: true };
    }
  }

  if (!open.ok) {
    // retry once after reload page
    await win.loadURL(pageUrl);
    await waitForLoad(win);
    await sleep(1000);
    open = await evalInPage(OPEN_LIVE_FN);
  }
  if (!open.ok) {
    notify("Facebook", open.reason || "Impossible d'ouvrir Live Producer", "warn");
    return { ok: false, reason: open.reason || "Live Producer non ouvert", step: "open" };
  }

  // Clé persistante (réutiliser si déjà en config ET scrape échoue partiellement)
  let creds = null;
  for (let i = 0; i < 20; i += 1) {
    await sleep(500);
    creds = await evalInPage(ENSURE_PERSISTENT_AND_SCRAPE_FN);
    if (creds.ok && creds.streamKey) break;
  }

  // Si clé déjà connue en config et scrape rate, on la garde
  if ((!creds?.ok || !creds.streamKey) && facebookConfig.streamKey) {
    creds = {
      ok: true,
      rtmpUrl: facebookConfig.rtmpUrl || "rtmps://live-api-s.facebook.com:443/rtmp",
      streamKey: facebookConfig.streamKey,
      persistentOn: true,
      reusedFromConfig: true,
    };
  }

  if (!creds?.ok || !creds.streamKey) {
    notify("Facebook", "Clé de stream introuvable — ouvre Configuration du logiciel", "warn");
    return { ok: false, reason: "Clé stream introuvable", step: "key" };
  }

  const meta = await evalInPage(
    FILL_TITLE_GAME_FN,
    cleanTitle,
    String(game || "").trim(),
    String(description || cleanTitle).trim(),
  );

  lastCredentials = {
    rtmpUrl: (creds.rtmpUrl || "rtmps://live-api-s.facebook.com:443/rtmp").replace(/\/$/, ""),
    streamKey: creds.streamKey,
    title: cleanTitle,
    game: game || "",
    pageUrl,
    persistentOn: creds.persistentOn,
    at: Date.now(),
  };

  notify(
    "Facebook",
    `Page OK · clé ${creds.reusedFromConfig ? "réutilisée" : "récupérée"}${meta.gameFilled ? " · jeu" : ""}`,
    "info",
  );
  pushToWindows({ type: "facebook-credentials", ...lastCredentials });

  return {
    ok: true,
    platform: "facebook",
    ...lastCredentials,
    titleFilled: meta.titleFilled,
    gameFilled: meta.gameFilled,
    metaReason: meta.reason,
    windowKeptOpen: true,
    note: "Garde la fenêtre ouverte — « Lancer un direct » quand le flux arrive",
  };
}

async function goLive({ waitForReady = false, timeoutMs = 180000 } = {}) {
  if (!win || win.isDestroyed()) {
    return { ok: false, reason: "Fenêtre Facebook Live Producer fermée" };
  }

  if (!waitForReady) {
    const res = await evalInPage(GO_LIVE_FN);
    if (res.ok) notify("Facebook", "Lancer un direct cliqué", "info");
    else notify("Facebook", res.reason || "Go Live pas prêt", "warn");
    return res;
  }

  notify("Facebook", "Attente bouton Lancer un direct actif…", "info");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!win || win.isDestroyed()) return { ok: false, reason: "fenêtre fermée" };
    const res = await evalInPage(GO_LIVE_FN);
    if (res.ok) {
      notify("Facebook", "Direct lancé", "info");
      return res;
    }
    await sleep(2500);
  }
  return { ok: false, reason: "Timeout : bouton Lancer un direct toujours inactif" };
}

function watchAndGoLive(timeoutMs = 300000) {
  if (goLiveWatcher) clearInterval(goLiveWatcher);
  const started = Date.now();
  goLiveWatcher = setInterval(async () => {
    try {
      if (!win || win.isDestroyed()) {
        clearInterval(goLiveWatcher);
        goLiveWatcher = null;
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(goLiveWatcher);
        goLiveWatcher = null;
        notify("Facebook", "Timeout attente Go Live", "warn");
        return;
      }
      const res = await evalInPage(GO_LIVE_FN);
      if (res.ok) {
        clearInterval(goLiveWatcher);
        goLiveWatcher = null;
        notify("Facebook", "Direct lancé (auto)", "info");
        pushToWindows({ type: "facebook-go-live", ok: true });
      }
    } catch {
      /* ignore */
    }
  }, 3000);
  return { ok: true, watching: true };
}

function closeProducer() {
  if (goLiveWatcher) {
    clearInterval(goLiveWatcher);
    goLiveWatcher = null;
  }
  if (win && !win.isDestroyed()) win.close();
  win = null;
}

module.exports = {
  openProducer,
  prepareLive,
  goLive,
  watchAndGoLive,
  closeProducer,
  getStatus,
  resolvePageUrl,
  DEFAULT_PAGE_URL,
  PARTITION,
};
