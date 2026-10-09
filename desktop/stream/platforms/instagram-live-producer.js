/**
 * Automatise Instagram Live Producer (web) :
 * titre → Suivant → récupère URL RTMPS + clé (change à chaque live).
 * Session persistante : partition Electron `persist:instagram-live`.
 */
const { BrowserWindow, session } = require("electron");
const { notify, pushToWindows } = require("../notify");

const PARTITION = "persist:instagram-live";
const HOME_URL = "https://www.instagram.com/";
const LIVE_HINTS = [
  "https://www.instagram.com/",
  "https://www.instagram.com/live/create/",
];

let win = null;
let lastCredentials = null;

function getStatus() {
  return {
    open: Boolean(win && !win.isDestroyed()),
    credentials: lastCredentials,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureWindow() {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return win;
  }

  const ses = session.fromPartition(PARTITION);
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    title: "Instagram Live Producer — AnimeBeat",
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
    pushToWindows({ type: "instagram-producer-status", open: false });
  });

  return win;
}

async function waitForLoad(target, timeoutMs = 45000) {
  if (target.webContents.isLoading()) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timeout chargement Instagram")), timeoutMs);
      target.webContents.once("did-finish-load", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  await sleep(800);
}

async function evalInPage(fnSource, ...args) {
  if (!win || win.isDestroyed()) throw new Error("Fenêtre Instagram fermée");
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

/** Script injecté : état de la page Live Producer */
const DETECT_PAGE_FN = `async function detectPage() {
  const body = (document.body && document.body.innerText) || "";
  const lower = body.toLowerCase();
  const url = location.href;

  if (/accounts\\/login|login/.test(url) || /se connecter|log in/.test(lower)) {
    return { state: "login", url };
  }

  const inputs = [...document.querySelectorAll("input, textarea")];
  let rtmpUrl = "";
  let streamKey = "";
  for (const el of inputs) {
    const v = (el.value || "").trim();
    if (/^rtmps?:\\/\\//i.test(v)) rtmpUrl = v;
    else if (v.length > 40 && /[?&]s_|rtmp|live/i.test(v) && !/^https?:/i.test(v)) streamKey = v;
    else if (v.length > 60 && !/^https?:/i.test(v) && !/\\s/.test(v) && streamKey.length < v.length) streamKey = v;
  }
  // parfois dans des spans/divs sélectionnables
  if (!rtmpUrl) {
    const m = body.match(/rtmps?:\\/\\/[^\\s]+/i);
    if (m) rtmpUrl = m[0];
  }

  if (rtmpUrl && streamKey) {
    return { state: "credentials", url, rtmpUrl, streamKey };
  }
  if (rtmpUrl) {
    return { state: "credentials_partial", url, rtmpUrl, streamKey: streamKey || "" };
  }

  const titleInput = inputs.find((el) => {
    const ph = (el.getAttribute("placeholder") || "").toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    const name = (el.getAttribute("name") || "").toLowerCase();
    return /titre|title|ajoutez un titre|add a title/.test(ph + " " + aria + " " + name);
  });
  if (titleInput || /ajouter des informations|add details|vidéo en direct|live video|audience|public/.test(lower)) {
    return { state: "title", url, hasTitleInput: Boolean(titleInput) };
  }

  return { state: "home", url, lowerSnippet: lower.slice(0, 200) };
}`;

const FILL_TITLE_FN = `async function fillTitleAndNext(title) {
  const want = String(title || "").trim();
  if (!want) return { ok: false, reason: "titre vide" };

  const clickByText = (patterns) => {
    const nodes = [...document.querySelectorAll("button, div[role='button'], a[role='button'], span")];
    for (const el of nodes) {
      const t = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (!t || t.length > 48) continue;
      if (patterns.some((p) => t === p || t.includes(p))) {
        el.click();
        return t;
      }
    }
    return null;
  };

  // Ouvrir Create → Live si on n'est pas déjà sur le formulaire
  let detect = await (${DETECT_PAGE_FN})();
  if (detect.state === "home" || detect.state === "login") {
    clickByText(["créer", "create", "nouveau"]);
    await new Promise((r) => setTimeout(r, 700));
    clickByText(["vidéo en direct", "live video", "live", "en direct"]);
    await new Promise((r) => setTimeout(r, 1200));
    detect = await (${DETECT_PAGE_FN})();
  }

  if (detect.state === "login") {
    return { ok: false, reason: "login", needLogin: true };
  }

  if (detect.state === "credentials" || detect.state === "credentials_partial") {
    return { ok: true, alreadyCredentials: true, ...detect };
  }

  const inputs = [...document.querySelectorAll("input, textarea")];
  let titleEl =
    inputs.find((el) => {
      const ph = (el.getAttribute("placeholder") || "").toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      return /titre|title|ajoutez un titre|add a title/.test(ph + " " + aria);
    }) || inputs.find((el) => el.offsetParent !== null && (el.type === "text" || el.tagName === "TEXTAREA"));

  if (!titleEl) {
    return { ok: false, reason: "champ titre introuvable — ouvre Create → Vidéo en direct" };
  }

  titleEl.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  if (setter) setter.call(titleEl, want);
  else titleEl.value = want;
  titleEl.dispatchEvent(new Event("input", { bubbles: true }));
  titleEl.dispatchEvent(new Event("change", { bubbles: true }));

  // Audience Public si visible
  clickByText(["public"]);

  await new Promise((r) => setTimeout(r, 400));
  const clicked = clickByText(["suivant", "next", "continuer", "continue"]);
  if (!clicked) {
    return { ok: false, reason: "bouton Suivant introuvable" };
  }

  return { ok: true, filled: want, clicked };
}`;

const SCRAPE_CREDS_FN = `async function scrapeCreds() {
  const detect = await (${DETECT_PAGE_FN})();
  if (detect.state === "credentials" || (detect.rtmpUrl && detect.streamKey)) {
    return { ok: true, rtmpUrl: detect.rtmpUrl, streamKey: detect.streamKey };
  }
  // fallback: tous les inputs
  const inputs = [...document.querySelectorAll("input, textarea")];
  let rtmpUrl = "";
  let streamKey = "";
  const values = inputs.map((el) => (el.value || "").trim()).filter(Boolean);
  for (const v of values) {
    if (/^rtmps?:\\/\\//i.test(v)) rtmpUrl = v;
  }
  for (const v of values) {
    if (v === rtmpUrl) continue;
    if (v.length >= 32 && !/^https?:/i.test(v) && !/\\s/.test(v)) {
      streamKey = v;
      break;
    }
  }
  if (rtmpUrl && streamKey) return { ok: true, rtmpUrl, streamKey };
  return { ok: false, reason: "credentials pas encore visibles", detect };
}`;

const CLICK_GO_LIVE_FN = `async function clickGoLive() {
  const nodes = [...document.querySelectorAll("button, div[role='button']")];
  for (const el of nodes) {
    const t = (el.innerText || el.textContent || "").trim().toLowerCase();
    if (t === "lancer un direct" || t === "go live" || t.includes("lancer un direct") || t === "start live video") {
      el.click();
      return { ok: true, clicked: t };
    }
  }
  return { ok: false, reason: "bouton Lancer un direct introuvable" };
}`;

async function openProducer() {
  const target = ensureWindow();
  const url = target.webContents.getURL();
  if (!url || url === "about:blank" || !url.includes("instagram.com")) {
    await target.loadURL(HOME_URL);
  }
  await waitForLoad(target);
  pushToWindows({ type: "instagram-producer-status", open: true });
  return { ok: true, url: target.webContents.getURL() };
}

/**
 * Parcours complet : login si besoin, titre, Suivant, scrape URL+clé.
 */
async function prepareLive(title, options = {}) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) {
    return { ok: false, reason: "Titre vide pour Instagram" };
  }

  notify("Instagram", "Ouverture Live Producer…", "info");
  await openProducer();

  // Laisser le temps à React
  await sleep(1200);

  let detect = await evalInPage(DETECT_PAGE_FN);
  if (detect.state === "login") {
    notify(
      "Instagram",
      "Connecte-toi dans la fenêtre Instagram, puis relance « Préparer Instagram »",
      "warn",
    );
    // Attendre login jusqu'à ~3 min
    const deadline = Date.now() + (options.loginTimeoutMs || 180000);
    while (Date.now() < deadline) {
      await sleep(2000);
      detect = await evalInPage(DETECT_PAGE_FN);
      if (detect.state !== "login") break;
    }
    if (detect.state === "login") {
      return { ok: false, reason: "Toujours sur la page login Instagram", needLogin: true };
    }
  }

  // Remplir titre + Suivant
  let fill = await evalInPage(FILL_TITLE_FN, cleanTitle);
  if (!fill.ok && fill.needLogin) {
    return { ok: false, reason: "Login Instagram requis", needLogin: true };
  }
  if (!fill.ok && !fill.alreadyCredentials) {
    // Second essai après navigation manuelle possible
    await sleep(1500);
    fill = await evalInPage(FILL_TITLE_FN, cleanTitle);
  }
  if (!fill.ok && !fill.alreadyCredentials) {
    notify("Instagram", fill.reason || "Échec formulaire titre", "warn");
    return { ok: false, reason: fill.reason || "Échec titre", step: "title" };
  }

  // Attendre l'écran URL + clé
  let creds = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    creds = await evalInPage(SCRAPE_CREDS_FN);
    if (creds.ok && creds.rtmpUrl && creds.streamKey) break;
  }

  if (!creds?.ok || !creds.rtmpUrl || !creds.streamKey) {
    notify(
      "Instagram",
      "Titre OK mais clé non trouvée — vérifie l'écran Live Producer",
      "warn",
    );
    return {
      ok: false,
      reason: "URL/clé introuvables (garde la fenêtre Live Producer ouverte)",
      step: "credentials",
      title: cleanTitle,
    };
  }

  lastCredentials = {
    rtmpUrl: creds.rtmpUrl.replace(/\/$/, ""),
    streamKey: creds.streamKey,
    title: cleanTitle,
    at: Date.now(),
  };

  notify("Instagram", "URL + clé Live Producer récupérées", "info");
  pushToWindows({
    type: "instagram-credentials",
    ...lastCredentials,
  });

  return {
    ok: true,
    platform: "instagram",
    ...lastCredentials,
    windowKeptOpen: true,
    note: "Ne ferme pas la fenêtre Instagram — clique « Lancer un direct » après le push RTMP",
  };
}

async function goLive() {
  if (!win || win.isDestroyed()) {
    return { ok: false, reason: "Fenêtre Live Producer fermée" };
  }
  const res = await evalInPage(CLICK_GO_LIVE_FN);
  if (res.ok) notify("Instagram", "Lancer un direct cliqué", "info");
  else notify("Instagram", res.reason || "Go Live échoué", "warn");
  return res;
}

function closeProducer() {
  if (win && !win.isDestroyed()) win.close();
  win = null;
}

module.exports = {
  openProducer,
  prepareLive,
  goLive,
  closeProducer,
  getStatus,
  PARTITION,
};
