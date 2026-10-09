/**
 * Facebook Live Producer — destination: page | group | profile.
 * PAGE Lilwen54 = profile.php?id=100036165385264 (pas le profil perso).
 * Profil perso = https://www.facebook.com/DiddySong/
 */
const { BrowserWindow } = require("electron");
const { notify, pushToWindows } = require("../notify");
const {
  getHardenedSession,
  flushSession,
  scheduleFlushSession,
  hasFacebookCookies,
  patchPageAutomationFlags,
} = require("../persist-session");
const { installWindowNavMenu } = require("../../browser-nav");

const PARTITION = "persist:facebook-live";
/** PAGE Lilwen54 (nouveau format /people/… = toujours une PAGE Meta) */
const DEFAULT_PAGE_ID = "100036165385264";
const DEFAULT_PAGE_URL = `https://www.facebook.com/profile.php?id=${DEFAULT_PAGE_ID}`;
const DEFAULT_PAGE_NAME = "Lilwen54";
/** Asset Business Suite (fallback si page_id classique échoue) */
const DEFAULT_BUSINESS_ASSET_ID = "921728321365740";
/** Profil perso — attention avant Go Live */
const DEFAULT_PERSONAL_PROFILE_URL = "https://www.facebook.com/DiddySong/";
const DEFAULT_PERSONAL_USERNAME = "DiddySong";

const DESTINATIONS = ["page", "group", "profile"];

let win = null;
let fbSession = null;
let lastCredentials = null;
let goLiveWatcher = null;

function getFbSession() {
  if (!fbSession) fbSession = getHardenedSession(PARTITION);
  return fbSession;
}

function getStatus() {
  return {
    open: Boolean(win && !win.isDestroyed()),
    credentials: lastCredentials,
    url: win && !win.isDestroyed() ? win.webContents.getURL() : "",
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveDestination(facebookConfig = {}) {
  const d = String(facebookConfig.destination || "page").toLowerCase().trim();
  return DESTINATIONS.includes(d) ? d : "page";
}

function resolvePageId(facebookConfig = {}) {
  const raw = facebookConfig.pageId;
  if (raw && !String(raw).startsWith("http") && /^\d{6,}$/.test(String(raw).trim())) {
    return String(raw).trim();
  }
  const url = String(facebookConfig.pageUrl || raw || "");
  const m =
    url.match(/[?&](?:page_id|asset_id)=(\d{6,})/) ||
    url.match(/[?&]id=(\d{6,})/) ||
    url.match(/facebook\.com\/(?:pages\/[^/]+\/)?(\d{6,})/) ||
    url.match(/people\/[^/]+\/(\d{6,})/);
  return m ? m[1] : DEFAULT_PAGE_ID;
}

function resolveGroupId(facebookConfig = {}) {
  const raw = facebookConfig.groupId;
  if (raw && /^\d{6,}$/.test(String(raw).trim())) return String(raw).trim();
  const url = String(facebookConfig.groupUrl || "");
  const m = url.match(/groups\/(?:[^/?#]+\/)?(\d{6,})/) || url.match(/[?&]group_id=(\d{6,})/);
  return m ? m[1] : "";
}

function resolvePageUrl(facebookConfig = {}) {
  if (facebookConfig.pageUrl && /facebook\.com/i.test(facebookConfig.pageUrl)) {
    return facebookConfig.pageUrl;
  }
  return `https://www.facebook.com/profile.php?id=${resolvePageId(facebookConfig)}`;
}

function resolvePersonalProfileUrl(facebookConfig = {}) {
  return (
    facebookConfig.personalProfileUrl ||
    (facebookConfig.personalUsername
      ? `https://www.facebook.com/${facebookConfig.personalUsername}/`
      : DEFAULT_PERSONAL_PROFILE_URL)
  );
}

function resolveDestinationHomeUrl(facebookConfig = {}) {
  const dest = resolveDestination(facebookConfig);
  if (dest === "group") {
    const gid = resolveGroupId(facebookConfig);
    if (facebookConfig.groupUrl) return facebookConfig.groupUrl;
    if (gid) return `https://www.facebook.com/groups/${gid}/`;
    return resolvePageUrl(facebookConfig);
  }
  if (dest === "profile") return resolvePersonalProfileUrl(facebookConfig);
  return resolvePageUrl(facebookConfig);
}

/** URL Live Producer selon destination */
function resolveLiveProducerUrl(facebookConfig = {}) {
  const dest = resolveDestination(facebookConfig);
  if (dest === "group") {
    const gid = resolveGroupId(facebookConfig);
    if (gid) {
      return `https://www.facebook.com/live/producer/?ref=group_composer&group_id=${gid}`;
    }
    return "https://www.facebook.com/live/producer";
  }
  if (dest === "profile") {
    // Profil perso DiddySong — pas de page_id
    return "https://www.facebook.com/live/producer";
  }
  const pageId = resolvePageId(facebookConfig);
  return `https://www.facebook.com/live/producer/?ref=page_composer&page_id=${pageId}`;
}

function resolveBusinessLiveProducerUrl(facebookConfig = {}) {
  const dest = resolveDestination(facebookConfig);
  if (dest !== "page") return "";
  const assetId = facebookConfig.businessAssetId || DEFAULT_BUSINESS_ASSET_ID;
  return `https://business.facebook.com/latest/live_producer?asset_id=${assetId}`;
}

function isProducerUrl(url) {
  return /live\/producer|live_producer/i.test(String(url || ""));
}

function isDestinationScopedUrl(url, facebookConfig = {}) {
  const u = String(url || "");
  if (!isProducerUrl(u)) return false;
  const dest = resolveDestination(facebookConfig);
  if (dest === "page") {
    const pageId = resolvePageId(facebookConfig);
    const asset = facebookConfig.businessAssetId || DEFAULT_BUSINESS_ASSET_ID;
    if (u.includes(`page_id=${pageId}`) || u.includes(`asset_id=${pageId}`) || u.includes(`asset_id=${asset}`)) {
      return true;
    }
    return /live\/producer\/v2/i.test(u) && /target_id=\d+/i.test(u);
  }
  if (dest === "group") {
    const gid = resolveGroupId(facebookConfig);
    return (gid && u.includes(`group_id=${gid}`)) || /live\/producer/i.test(u);
  }
  // profile: producer sans page_id/group_id
  return /live\/producer/i.test(u) && !/page_id=|group_id=/.test(u);
}

/** @deprecated alias — /people/Name/ID = format PAGE Meta, pas profil perso */
function isPersonalProfileUrl(url) {
  return /facebook\.com\/DiddySong/i.test(String(url || ""));
}

function isPageScopedProducerUrl(url, pageId) {
  return isDestinationScopedUrl(url, { destination: "page", pageId });
}

function ensureWindow() {
  if (!win || win.isDestroyed()) {
    const existing = BrowserWindow.getAllWindows().find((w) => {
      if (w.isDestroyed()) return false;
      const url = w.webContents?.getURL?.() || "";
      // Même partition persist:facebook-live uniquement (évite mélange → déco)
      const part = w.webContents?.session?.getStoragePath?.() || "";
      const samePartition =
        !part ||
        /facebook-live/i.test(part) ||
        w.webContents?.session === getFbSession();
      return samePartition && /facebook\.com|business\.facebook\.com/i.test(url);
    });
    if (existing) win = existing;
  }

  if (win && !win.isDestroyed()) {
    // Ne PAS détruire d'autres fenêtres FB (provoquait déconnexions / perte de contexte)
    installWindowNavMenu(win, { homeUrl: DEFAULT_PAGE_URL });
    win.show();
    win.focus();
    return win;
  }

  const ses = getFbSession();
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: "Facebook Live (PAGE) — AnimeBeat",
    autoHideMenuBar: false,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  installWindowNavMenu(win, {
    homeUrl: DEFAULT_PAGE_URL,
  });

  win.webContents.on("did-finish-load", () => {
    patchPageAutomationFlags(win.webContents).catch(() => {});
    scheduleFlushSession(ses, 2000);
  });
  win.webContents.on("did-navigate", () => {
    patchPageAutomationFlags(win.webContents).catch(() => {});
    scheduleFlushSession(ses, 2500);
  });
  win.on("close", (e) => {
    // Flush sync-ish avant fermeture — ne pas clearStorage
    flushSession(ses).catch(() => {});
  });
  win.on("closed", () => {
    win = null;
    if (goLiveWatcher) {
      clearInterval(goLiveWatcher);
      goLiveWatcher = null;
    }
    flushSession(ses).catch(() => {});
    pushToWindows({ type: "facebook-producer-status", open: false });
  });

  return win;
}

async function ensureLoggedIn() {
  const ses = getFbSession();
  if (await hasFacebookCookies(ses)) {
    scheduleFlushSession(ses, 500);
    return { ok: true };
  }
  const target = ensureWindow();
  notify(
    "Facebook",
    "Session absente — connecte-toi dans la fenêtre (1 seul hub). Ne lance pas d’autre Electron.",
    "warn",
  );
  // Ne PAS forcer /login (peut invalider une session partielle) → home
  await loadUrlSafe(target, "https://www.facebook.com/");
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await sleep(2500);
    if (await hasFacebookCookies(ses)) {
      await flushSession(ses);
      notify("Facebook", "Session Facebook OK", "info");
      return { ok: true, relogged: true };
    }
    const url = target.webContents.getURL() || "";
    const bodyHint = await evalInPage(`async () => {
      const t = ((document.body && document.body.innerText) || "").toLowerCase();
      return { login: /se connecter|log in|identifiez|connexion/.test(t) && t.length < 4000 };
    }`).catch(() => ({ login: /login|checkpoint/i.test(url) }));
    if (!bodyHint.login && /facebook\.com/i.test(url) && !/login|checkpoint/i.test(url)) {
      // Peut être loggé sans cookie encore flusé
      await flushSession(ses);
      if (await hasFacebookCookies(ses)) return { ok: true, relogged: true };
    }
  }
  return {
    ok: false,
    needLogin: true,
    reason: "Login Facebook requis — reste sur CETTE fenêtre, puis reclique Préparer",
  };
}

async function waitForLoad(target, timeoutMs = 45000) {
  try {
    if (target.webContents.isLoading()) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Timeout chargement Facebook")), timeoutMs);
        target.webContents.once("did-finish-load", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  } catch {
    /* timeout: on continue quand même */
  }
  await sleep(800);
}

async function loadUrlSafe(target, url, timeoutMs = 50000) {
  try {
    await Promise.race([
      target.loadURL(url),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout loadURL ${url}`)), timeoutMs),
      ),
    ]);
  } catch (err) {
    console.warn("[facebook-live]", err.message || err);
  }
  await waitForLoad(target, Math.min(20000, timeoutMs));
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

const SWITCH_TO_PAGE_FN = `async function switchToPage(pageId) {
  ${CLICK_BY_TEXT_HELPER}
  const id = String(pageId || "").trim();
  const body = ((document.body && document.body.innerText) || "");
  const lower = body.toLowerCase();
  const url = location.href;

  // Déjà en contexte PAGE (URL page_id / asset_id, ou bannière absente)
  const urlHasPage =
    (id && (url.includes("page_id=" + id) || url.includes("asset_id=" + id) || url.includes("id=" + id)))
    || /page_id=\\d+|asset_id=\\d+/.test(url);

  // Bannière / CTA « Passer à [Page] » quand on regarde la PAGE en tant que perso
  const switchPatterns = [
    "passer à",
    "switch now",
    "switch to",
    "utiliser facebook en tant que",
    "use facebook as",
    "basculer vers",
  ];
  let switched = clickByText(switchPatterns);
  if (!switched) {
    const el = [...document.querySelectorAll("button, div[role='button'], a[role='button'], span")].find((node) => {
      const t = (node.innerText || node.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().toLowerCase();
      if (!t || t.length > 80) return false;
      return /passer à|switch now|switch to|utiliser facebook en tant que|use facebook as/.test(t);
    });
    if (el) { el.click(); switched = (el.innerText || "switch").slice(0, 40); }
  }
  if (switched) {
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Sélecteur de comptes (profil → choisir la PAGE)
  if (!switched && /profil|profile|compte|account/.test(lower)) {
    const accountBtn = [...document.querySelectorAll("[aria-label]")].find((el) => {
      const a = (el.getAttribute("aria-label") || "").toLowerCase();
      return /ton profil|your profile|compte|account|voir plus|see more|menu/.test(a);
    });
    if (accountBtn) {
      accountBtn.click();
      await new Promise((r) => setTimeout(r, 800));
      // Dans la liste, préférer une entrée qui n'est pas « Profil »
      const pageEntry = [...document.querySelectorAll("[role='menuitem'], [role='option'], div[role='button'], span")].find((el) => {
        const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
        if (!t || t.length > 60) return false;
        if (/^profil$|^profile$|voir le profil|see your profile/.test(t)) return false;
        return /page|passer à|switch/.test(t) || (id && t.includes(id.slice(-4)));
      });
      if (pageEntry) {
        pageEntry.click();
        switched = "account-switcher";
        await new Promise((r) => setTimeout(r, 1800));
      }
    }
  }

  return {
    ok: true,
    switched: Boolean(switched),
    via: switched || null,
    urlHasPage,
    url: location.href,
  };
}`;

const OPEN_LIVE_FN = `async function openLiveFromPage(pageId, producerUrl, destination, pageName) {
  ${CLICK_BY_TEXT_HELPER}
  const id = String(pageId || "").trim();
  const dest = String(destination || "page").toLowerCase();
  const pageLabel = String(pageName || "Lilwen54").trim();
  const wantUrl = String(producerUrl || "").trim()
    || (dest === "page" && id
      ? ("https://www.facebook.com/live/producer/?ref=page_composer&page_id=" + id)
      : "https://www.facebook.com/live/producer");

  const pageText = () => ((document.body && document.body.innerText) || "").toLowerCase();
  const urlNow = () => location.href;

  if (/login|connexion|identifiez/.test(urlNow()) || /se connecter|log in/.test(pageText())) {
    return { ok: false, needLogin: true, url: urlNow() };
  }

  const isPageScoped = () => {
    const u = urlNow();
    const b = pageText();
    if (dest === "profile") return /publier sur le profil|publish to (your )?profile/.test(b) || (!/page_id=|group_id=/.test(u) && /live\\/producer/i.test(u));
    if (dest === "group") return /group_id=/.test(u) || /publier dans un groupe|publish to group|groupe/.test(b);
    if (id && (u.includes("page_id=" + id) || u.includes("asset_id=" + id))) return true;
    if (/page_id=\\d+|asset_id=\\d+/.test(u)) return true;
    if (/live\\/producer\\/v2/i.test(u) && /target_id=\\d+/i.test(u)) return true;
    // Dropdown déjà sur la PAGE
    if (pageLabel && b.includes(pageLabel.toLowerCase()) && /choisissez où publier|where to post|publier/.test(b)) {
      return !/publier sur le profil/.test(b) || b.includes(pageLabel.toLowerCase());
    }
    return false;
  };

  const isLandingCard = () => {
    const b = pageText();
    return /configurer la vidéo en direct|set up live video/.test(b)
      && (/créez un évènement|create a live video event|interagissez avec les spectateur|c'est bon de vous revoir|good to see you/.test(b)
        || (!/clé de stream|stream key|ajouter des informations|add details about/.test(b)
            && !/configuration du logiciel|streaming software setup|rtmps?:\\/\\//.test(b)));
  };

  const isSetupOpen = () => {
    const b = pageText();
    const u = urlNow();
    if (/live_composer|livestreaming\\/composer/i.test(u)) return true;
    return /clé de stream|stream key|ajouter des informations sur la vidéo|add details about|configuration du logiciel|connecter au logiciel|connect to streaming|modifier les détails de la publication|audience|titre \\(obligatoire\\)/.test(b)
      || /rtmps?:\\/\\/live-api/i.test(b)
      || /FB-[A-Za-z0-9_-]{8,}/.test((document.body && document.body.innerText) || "");
  };

  // Dropdown « Choisissez où publier » → PAGE / groupe / profil
  const selectPublishDestination = async () => {
    const b = pageText();
    const wantProfile = dest === "profile";
    const wantGroup = dest === "group";
    const alreadyOk = wantProfile
      ? /publier sur le profil/.test(b)
      : wantGroup
        ? /groupe|group/.test(b) && !/publier sur le profil/.test(b)
        : (pageLabel && b.includes(pageLabel.toLowerCase()) && !/publier sur le profil/.test(b))
          || /publier sur (une )?page|publish to (a )?page/.test(b);

    if (alreadyOk && !wantProfile && /publier sur le profil/.test(b) && !b.includes(pageLabel.toLowerCase())) {
      // dropdown affiche encore profil → forcer ouverture
    } else if (alreadyOk) {
      return { ok: true, already: true };
    }

    // Ouvrir le sélecteur
    let opener = [...document.querySelectorAll("button, div[role='button'], [role='combobox'], span")].find((el) => {
      const t = (el.innerText || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().toLowerCase();
      if (!t || t.length > 80) return false;
      return /choisissez où publier|where to post|publier sur le profil|publier sur une page|publish to/.test(t);
    });
    if (!opener) opener = clickByText(["choisissez où publier", "where to post", "publier sur le profil", "publier sur"]);
    else opener.click();
    await new Promise((r) => setTimeout(r, 700));

    const options = [...document.querySelectorAll("[role='option'], [role='menuitem'], [role='menuitemradio'], div[role='button'], label, span, div")];
    let chosen = null;
    if (wantProfile) {
      chosen = options.find((el) => {
        const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
        return t === "publier sur le profil" || t.includes("publier sur le profil") || t === "profile";
      });
    } else if (wantGroup) {
      chosen = options.find((el) => {
        const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
        return /groupe|group/.test(t) && !/profil|profile/.test(t) && t.length < 80;
      });
    } else {
      // PAGE Lilwen54 — jamais le profil
      chosen = options.find((el) => {
        const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
        if (!t || t.length > 80) return false;
        if (/publier sur le profil|your profile|profil personnel/.test(t)) return false;
        return (pageLabel && t.includes(pageLabel.toLowerCase()))
          || /publier sur (une )?page|publish as|page\\b/.test(t);
      });
      if (!chosen && pageLabel) {
        chosen = options.find((el) => {
          const t = (el.innerText || "").replace(/\\s+/g, " ").trim();
          return t.toLowerCase().includes(pageLabel.toLowerCase());
        });
      }
    }
    if (chosen) {
      chosen.click();
      await new Promise((r) => setTimeout(r, 1200));
      return { ok: true, chosen: (chosen.innerText || "").slice(0, 60) };
    }
    return { ok: false, reason: "option destination introuvable dans « Choisissez où publier »" };
  };

  const clickSetupLiveVideo = () => {
    const exacts = ["configurer la vidéo en direct", "set up live video"];
    const nodes = [...document.querySelectorAll("button, div[role='button'], a[role='button'], span[role='button']")];
    for (const el of nodes) {
      const t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();
      if (!t || t.length > 48) continue;
      if (!exacts.some((p) => t === p || t.includes(p))) continue;
      if (t.includes("évènement") || t.includes("event") || t.includes("interagissez") || t.includes("publicité")) continue;
      el.click();
      return t;
    }
    const byAria = [...document.querySelectorAll("[aria-label]")].find((el) => {
      const a = (el.getAttribute("aria-label") || "").toLowerCase();
      return /configurer la vidéo en direct|set up live video/.test(a);
    });
    if (byAria) { byAria.click(); return "aria-setup"; }
    return null;
  };

  // 1) Destination (PAGE vs profil vs groupe) AVANT Configurer
  let destPick = { ok: true };
  if (/choisissez où publier|where to post|publier sur le profil|publier sur/.test(pageText()) || isLandingCard()) {
    destPick = await selectPublishDestination();
  }

  if (isSetupOpen()) {
    return { ok: true, already: true, pageScoped: isPageScoped(), destPick, url: urlNow() };
  }

  // 2) Carte « Configurer la vidéo en direct »
  if (/live\\/producer|live_producer/i.test(urlNow()) || isLandingCard()) {
    const clicked = clickSetupLiveVideo();
    await new Promise((r) => setTimeout(r, 2200));
    if (isSetupOpen()) {
      return { ok: true, via: "setup-card", clicked, pageScoped: isPageScoped(), destPick, url: urlNow() };
    }
    // Re-sélection destination si encore sur profil
    if (dest === "page" && /publier sur le profil/.test(pageText())) {
      await selectPublishDestination();
    }
    const clicked2 = clickSetupLiveVideo();
    await new Promise((r) => setTimeout(r, 2500));
    if (isSetupOpen()) {
      return { ok: true, via: "setup-card-retry", clicked: clicked2 || clicked, pageScoped: isPageScoped(), destPick, url: urlNow() };
    }
  }

  if (wantUrl && dest === "page" && !isPageScoped()) {
    location.href = wantUrl;
    await new Promise((r) => setTimeout(r, 4500));
    await selectPublishDestination();
  }

  let clicked = clickSetupLiveVideo();
  await new Promise((r) => setTimeout(r, 2200));
  if (isSetupOpen()) {
    return { ok: true, via: "direct-url-setup", clicked, pageScoped: isPageScoped(), destPick, url: urlNow() };
  }

  return {
    ok: false,
    reason: dest === "page"
      ? "Bloqué sur l'accueil: choisis la PAGE (pas « Publier sur le profil ») puis Configurer la vidéo en direct"
      : "Configurer la vidéo en direct non ouvert",
    pageScoped: isPageScoped(),
    destPick,
    url: urlNow(),
    bodyHint: ((document.body && document.body.innerText) || "").slice(0, 220),
  };
}`;

const ADD_LINK_FN = `async function addLiveLink(linkUrl, linkTitle) {
  ${CLICK_BY_TEXT_HELPER}
  const url = String(linkUrl || "").trim();
  const title = String(linkTitle || "").trim().slice(0, 30);
  if (!url) return { ok: false, reason: "url vide" };

  let opened = clickByText([
    "ajouter un lien", "add a link", "ajouter un site web", "add a website",
    "appel à l'action", "call to action", "cta",
  ]);
  if (!opened) {
    const el = [...document.querySelectorAll("button, div[role='button'], a")].find((node) => {
      const t = ((node.innerText || "") + " " + (node.getAttribute("aria-label") || "")).toLowerCase();
      return /ajouter un lien|add a link|site web|website|appel à l'action|call to action/.test(t) && t.length < 70;
    });
    if (el) { el.click(); opened = "aria-link"; }
  }
  await new Promise((r) => setTimeout(r, 900));

  const scope = document.querySelector("[role='dialog']") || document.body;
  const inputs = [...scope.querySelectorAll("input, textarea")];
  let urlEl = inputs.find((el) => {
    const lab = ((el.getAttribute("aria-label") || "") + " " + (el.placeholder || "")).toLowerCase();
    return /url|lien|link|http|site/.test(lab);
  });
  if (!urlEl) {
    urlEl = inputs.find((el) => el.offsetParent !== null && (el.type === "url" || el.type === "text" || !el.type || el.tagName === "TEXTAREA"));
  }
  let titleEl = inputs.find((el) => {
    const lab = ((el.getAttribute("aria-label") || "") + " " + (el.placeholder || "")).toLowerCase();
    return /titre|title|texte du bouton|button text/.test(lab) && el !== urlEl;
  });

  const setVal = (el, value) => {
    if (!el) return false;
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };

  const full = url.startsWith("http") ? url : ("https://" + url);
  if (!urlEl) {
    const desc = inputs.find((el) => /description|quoi de neuf|what's on your mind/.test(((el.getAttribute("aria-label")||"")+" "+(el.placeholder||"")).toLowerCase()));
    if (desc) {
      setVal(desc, ((desc.value || "").trim() + "\\n" + full + (title ? (" — " + title) : "")).trim());
      return { ok: true, via: "description", url: full, title };
    }
    return { ok: false, reason: "champ lien introuvable", opened };
  }
  setVal(urlEl, full);
  if (title && titleEl) setVal(titleEl, title);
  clickByText(["terminé", "done", "enregistrer", "save", "ajouter", "add"], { exact: false });
  await new Promise((r) => setTimeout(r, 600));
  return { ok: true, url: full, title, opened: opened || true };
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
  const candidates = [];
  for (const el of inputs) {
    const v = (el.value || "").trim();
    if (!v) continue;
    if (/^rtmps?:\\/\\//i.test(v)) rtmpUrl = v.replace(/\\/$/, "");
    else if (!/^https?:/i.test(v) && !/\\s/.test(v) && v.length >= 12) {
      candidates.push(v);
    }
  }
  // Préférer les clés FB-… (persistantes)
  streamKey =
    candidates.find((v) => /^FB-/i.test(v)) ||
    candidates.sort((a, b) => b.length - a.length)[0] ||
    "";

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
  let audienceSet = false;

  const setAny = (el, value) => {
    if (!el) return false;
    el.focus();
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return setReactInput(el, value);
  };

  const fieldNearLabel = (root, labelRe) => {
    const nodes = [...root.querySelectorAll("label, span, div, p")];
    for (const lab of nodes) {
      const t = (lab.innerText || "").replace(/\\s+/g, " ").trim();
      if (!labelRe.test(t) || t.length > 48) continue;
      const forId = lab.getAttribute("for");
      if (forId) {
        const byId = document.getElementById(forId);
        if (byId) return byId;
      }
      const box = lab.closest("div") || lab.parentElement;
      const field =
        box?.querySelector("input, textarea, [contenteditable='true'], [role='textbox']") ||
        lab.parentElement?.querySelector("input, textarea, [contenteditable='true'], [role='textbox']") ||
        lab.nextElementSibling;
      if (field && (field.matches("input, textarea, [contenteditable='true'], [role='textbox']")
        || field.querySelector?.("input, textarea, [contenteditable='true']"))) {
        return field.matches("input, textarea, [contenteditable='true'], [role='textbox']")
          ? field
          : field.querySelector("input, textarea, [contenteditable='true'], [role='textbox']");
      }
    }
    return null;
  };

  const findTitleInput = (scope) => {
    const root = scope || document.body;
    let titleEl = fieldNearLabel(root, /^titre(\\s*\\(obligatoire\\))?$/i)
      || fieldNearLabel(root, /^title(\\s*\\(required\\))?$/i);
    if (titleEl) return titleEl;
    const inputs = [...root.querySelectorAll("input, textarea, [contenteditable='true'], [role='textbox']")];
    titleEl = inputs.find((el) => {
      const lab = ((el.getAttribute("aria-label") || "") + " " + (el.placeholder || "") + " " + (el.getAttribute("aria-labelledby") || "")).toLowerCase();
      return /titre|title|obligatoire|ajoutez un titre|add a title/.test(lab);
    });
    return titleEl || null;
  };

  const findDescInput = (scope, titleEl) => {
    const root = scope || document.body;
    let descEl = fieldNearLabel(root, /^description(\\s*\\(obligatoire\\))?$/i);
    if (descEl) return descEl;
    const inputs = [...root.querySelectorAll("input, textarea, [contenteditable='true'], [role='textbox']")];
    descEl = inputs.find((el) => {
      if (el === titleEl) return false;
      const lab = ((el.getAttribute("aria-label") || "") + " " + (el.placeholder || "")).toLowerCase();
      return /description|quoi de neuf|what's on your mind|tell people/.test(lab);
    });
    if (!descEl && titleEl) {
      descEl = inputs.find((el) => el !== titleEl && (el.tagName === "TEXTAREA" || el.isContentEditable));
    }
    return descEl || null;
  };

  const setAudiencePublic = async () => {
    const visiblePublic = [...document.querySelectorAll("button, div[role='button'], [role='combobox'], span")].some((el) => {
      const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
      if (t.length > 24) return false;
      return t === "public" || t.startsWith("public ");
    });
    if (visiblePublic) {
      audienceSet = true;
      return true;
    }
    const audienceBtn = [...document.querySelectorAll("button, div[role='button'], [role='combobox']")].find((el) => {
      const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      return (t === "amis" || t === "friends" || t === "only me" || t === "moi uniquement"
        || /audience|qui peut voir|who can see|confidentialité|privacy/.test(aria + " " + t))
        && t.length < 40;
    });
    if (audienceBtn) {
      audienceBtn.click();
      await new Promise((r) => setTimeout(r, 700));
    } else {
      clickByText(["public", "audience", "qui peut voir"]);
      await new Promise((r) => setTimeout(r, 500));
    }
    const opt = [...document.querySelectorAll("[role='option'], [role='menuitem'], [role='menuitemradio'], div[role='button'], span, label")].find((el) => {
      const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
      return t === "public" || t.startsWith("public");
    });
    if (opt) {
      opt.click();
      audienceSet = true;
      await new Promise((r) => setTimeout(r, 400));
      return true;
    }
    return audienceSet;
  };

  // Ouvre modal « Créer une publication » / Modifier les détails
  let openedPanel = clickByText([
    "modifier les détails de la publication",
    "modifier les détails",
    "edit post details",
    "edit details",
    "créer une publication",
    "create post",
    "ajouter des informations",
    "add details",
  ]);
  if (!openedPanel) {
    // Clic sur le bloc titre/description déjà affiché à droite
    const preview = [...document.querySelectorAll("div, span")].find((el) => {
      const t = (el.innerText || "").replace(/\\s+/g, " ").trim();
      if (!t || t.length < 8 || t.length > 120) return false;
      return /tiktoklive|twitch|kick|lilwen/i.test(t) && el.closest("button, [role='button'], a");
    });
    if (preview) {
      (preview.closest("button, [role='button'], a") || preview).click();
      openedPanel = "preview-title";
    }
  }
  if (!openedPanel) {
    const btn = [...document.querySelectorAll("button, div[role='button'], a, span")].find((el) => {
      const t = (el.innerText || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().toLowerCase();
      if (!t || t.length > 72) return false;
      return /modifier les détails|edit post details|créer une publication|create post|ajouter des informations/.test(t);
    });
    if (btn) { btn.click(); openedPanel = "edit-details"; }
  }
  if (openedPanel) await new Promise((r) => setTimeout(r, 1400));

  const dialog =
    [...document.querySelectorAll("[role='dialog']")].find((d) =>
      /créer une publication|create (a )?post|titre \\(obligatoire\\)|title \\(required\\)|description/i.test(d.innerText || ""),
    ) || document.querySelector("[role='dialog']");

  let scope = dialog || document.body;
  let titleEl = findTitleInput(scope);
  if (!titleEl) {
    await new Promise((r) => setTimeout(r, 800));
    scope = [...document.querySelectorAll("[role='dialog']")].find((d) =>
      /titre|title|description/i.test(d.innerText || ""),
    ) || document.body;
    titleEl = findTitleInput(scope);
  }
  let descEl = findDescInput(scope, titleEl);

  const titleFilled = wantTitle ? setAny(titleEl, wantTitle) : false;
  let descFilled = false;
  if (wantDesc && descEl) descFilled = setAny(descEl, wantDesc);
  else if (wantTitle && descEl && !(descEl.value || descEl.textContent || "").trim()) {
    descFilled = setAny(descEl, wantTitle);
  }

  // Fermer / valider la modal titre-desc
  clickByText(["enregistrer", "save", "terminé", "done"], { exact: false });
  await new Promise((r) => setTimeout(r, 500));
  // Si modal encore ouverte: Escape
  if (document.querySelector("[role='dialog']") && /créer une publication|titre \\(obligatoire\\)/i.test(document.body.innerText || "")) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
  }

  await setAudiencePublic();

  // Jeu (Identifiez un jeu)
  let gameFilled = false;
  if (wantGame) {
    let gameInput = [...document.querySelectorAll("input")].find((el) => {
      const ph = ((el.placeholder || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
      return /identifiez un jeu|identify a game|fortnite/.test(ph);
    });
    if (!gameInput) {
      clickByText(["gaming", "jeu"]);
      await new Promise((r) => setTimeout(r, 400));
      gameInput = [...document.querySelectorAll("input")].find((el) => {
        const ph = ((el.placeholder || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
        return /identifiez un jeu|identify a game|jeu|game|fortnite/.test(ph);
      });
    }
    if (gameInput) {
      setAny(gameInput, wantGame);
      await new Promise((r) => setTimeout(r, 1000));
      const needle = wantGame.toLowerCase().slice(0, 16);
      const opt = [...document.querySelectorAll("[role='option'], li, div[role='button'], span")].find((el) => {
        const t = (el.innerText || "").trim().toLowerCase();
        return t && t.length < 80 && t.includes(needle);
      });
      if (opt) opt.click();
      else gameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      gameFilled = true;
    }
  }

  const ok = Boolean((!wantTitle || titleFilled) && (!wantDesc || descFilled || !descEl || titleFilled));
  return {
    ok: Boolean(titleFilled || (!wantTitle && descFilled)),
    titleFilled,
    descFilled,
    audienceSet,
    gameFilled,
    openedPanel: openedPanel || null,
    reason: titleFilled
      ? null
      : "champ Titre (obligatoire) introuvable — ouvre « Modifier les détails » / Créer une publication",
  };
}`;

const GO_LIVE_FN = `async function tryGoLive(probeOnly) {
  ${CLICK_BY_TEXT_HELPER}
  const body = ((document.body && document.body.innerText) || "").toLowerCase();

  // Encore sur la carte d'accueil → pas un Go Live
  if (/configurer la vidéo en direct|set up live video/.test(body)
      && /créez un évènement|create a live video event|interagissez avec les spectateur/.test(body)
      && !/ajouter des informations|clé de stream|stream key/.test(body)) {
    return { ok: false, ready: false, reason: "encore sur la carte — ouvre « Configurer la vidéo en direct » d'abord" };
  }

  const previewHint = /aperçu|preview|en direct|connecté|receiving|flux|vidéo reçue|stream received|logiciel de streaming/i.test(body);
  const waitingSpinner = [...document.querySelectorAll("button, div[role='button']")].some((el) => {
    const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const busy = el.getAttribute("aria-busy") === "true"
      || !!el.querySelector("[role='progressbar'], [aria-busy='true'], circle");
    // Spinner seul (bouton bleu sans texte) pendant attente flux
    if (busy && (t === "" || t.length < 3) && el.offsetWidth > 100) return true;
    return busy && /lancer|direct|go live|suivant/i.test(t);
  });
  if (waitingSpinner && /connectez|logiciel|streaming|ajouter des informations/i.test(body)) {
    return { ok: false, ready: false, previewHint, waitingSpinner: true, reason: "FB attend encore le flux (spinner)" };
  }
  const nodes = [...document.querySelectorAll("button, div[role='button']")];
  const labelsExact = ["lancer un direct", "go live", "lancer le direct", "démarrer le direct", "commencer le direct", "start live", "go live now"];
  for (const el of nodes) {
    const t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();
    if (!t || t.length > 40) continue;
    // Ne pas confondre avec le titre de carte / configurer
    if (/configurer|set up|évènement|event|interagissez/.test(t)) continue;
    if (!labelsExact.some((l) => t === l || t.startsWith(l))) continue;
    const disabled =
      el.getAttribute("aria-disabled") === "true" ||
      el.disabled === true ||
      el.className?.toString?.().includes("disabled") ||
      getComputedStyle(el).pointerEvents === "none" ||
      getComputedStyle(el).opacity < 0.45;
    if (disabled) return { ok: false, ready: false, previewHint, reason: "bouton pas encore actif (attends le flux OBS)" };
    if (probeOnly) return { ok: true, ready: true, previewHint, probed: true };
    el.click();
    return { ok: true, ready: true, previewHint, clicked: t };
  }
  // Parfois le CTA bleu n'a que "Suivant" après connexion logiciel
  for (const el of nodes) {
    const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
    if (t !== "suivant" && t !== "next") continue;
    const disabled = el.getAttribute("aria-disabled") === "true" || el.disabled === true;
    if (disabled) continue;
    if (probeOnly) return { ok: true, ready: true, previewHint, probed: true, via: "suivant" };
    el.click();
    return { ok: true, ready: true, previewHint, clicked: t };
  }
  return { ok: false, ready: false, previewHint, waitingSpinner, reason: "bouton Lancer un direct introuvable" };
}`;

const END_LIVE_FN = `async function tryEndLive(probeOnly) {
  ${CLICK_BY_TEXT_HELPER}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const labels = [
    "terminer le direct",
    "end live video",
    "end live",
    "arrêter le direct",
    "finir le direct",
    "end broadcast",
    "stop live",
  ];
  const confirmLabels = [
    "terminer le direct",
    "end live",
    "terminer",
    "end now",
    "oui",
    "yes",
    "confirm",
    "confirmer",
  ];
  const nodes = [...document.querySelectorAll("button, div[role='button'], a[role='button']")];
  let hit = null;
  for (const el of nodes) {
    const t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();
    if (!t || t.length > 48) continue;
    if (!labels.some((l) => t === l || t.startsWith(l))) continue;
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    if (/fermer|close|dismiss|annuler|cancel/.test(t) && !/direct|live/.test(t + " " + aria)) continue;
    hit = { el, t };
    break;
  }
  if (!hit) {
    const byAria = nodes.find((el) => {
      const a = (el.getAttribute("aria-label") || "").toLowerCase();
      return labels.some((l) => a.includes(l));
    });
    if (byAria) hit = { el: byAria, t: (byAria.getAttribute("aria-label") || "").toLowerCase() };
  }
  if (!hit) return { ok: false, reason: "bouton Terminer le direct introuvable — ouvre Live Producer pendant le live" };
  if (probeOnly) return { ok: true, ready: true, probed: true, label: hit.t };
  hit.el.click();
  await sleep(900);
  const dialog =
    [...document.querySelectorAll("[role='dialog'], [role='alertdialog']")].find((d) =>
      /terminer|end live|arrêter|direct|live/i.test(d.innerText || ""),
    ) || null;
  const scope = dialog || document;
  const confirmNodes = [...scope.querySelectorAll("button, div[role='button']")];
  for (const el of confirmNodes) {
    const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
    if (!t || t.length > 40) continue;
    if (/annuler|cancel|fermer|close|pas maintenant|not now/.test(t)) continue;
    if (!confirmLabels.some((l) => t === l || t.startsWith(l))) continue;
    const disabled = el.getAttribute("aria-disabled") === "true" || el.disabled === true;
    if (disabled) continue;
    el.click();
    return { ok: true, clicked: hit.t, confirmed: t };
  }
  // Parfois un seul clic suffit
  return { ok: true, clicked: hit.t, confirmed: null };
}`;

async function openProducer(facebookConfig = {}) {
  const destination = resolveDestination(facebookConfig);
  const pageId = resolvePageId(facebookConfig);
  const homeUrl = resolveDestinationHomeUrl(facebookConfig);
  const producerUrl = resolveLiveProducerUrl(facebookConfig);
  const businessUrl = resolveBusinessLiveProducerUrl(facebookConfig);
  const target = ensureWindow();
  let url = target.webContents.getURL() || "";

  if (destination === "profile") {
    notify(
      "Facebook",
      "⚠ PROFIL PERSO (DiddySong) — le live partira sur ton profil, pas la PAGE Lilwen54",
      "warn",
    );
  }
  if (destination === "group" && !resolveGroupId(facebookConfig) && !facebookConfig.groupUrl) {
    return {
      ok: false,
      reason: "Groupe: renseigne l’URL ou l’ID du groupe dans Stream Command",
      destination,
    };
  }

  if (isDestinationScopedUrl(url, facebookConfig)) {
    target.show();
    target.focus();
    pushToWindows({
      type: "facebook-producer-status",
      open: true,
      pageUrl: homeUrl,
      pageId,
      destination,
    });
    return { ok: true, pageUrl: homeUrl, pageId, destination, url, producerUrl, reused: true };
  }

  if (destination === "group" || destination === "profile") {
    console.log("[facebook-live] load home", destination, homeUrl);
    await loadUrlSafe(target, homeUrl);
    await sleep(800);
  }

  console.log("[facebook-live] load producer", destination, producerUrl);
  await loadUrlSafe(target, producerUrl);
  url = target.webContents.getURL() || "";

  if (destination === "page" && businessUrl && (!isProducerUrl(url) || /typo_redirect/i.test(url))) {
    console.log("[facebook-live] fallback Business Suite", businessUrl);
    await loadUrlSafe(target, businessUrl);
    url = target.webContents.getURL() || "";
  }

  if (!isProducerUrl(url) && destination === "page") {
    await loadUrlSafe(target, homeUrl);
    try {
      await evalInPage(SWITCH_TO_PAGE_FN, pageId);
    } catch {
      /* ignore */
    }
    await loadUrlSafe(target, producerUrl);
    url = target.webContents.getURL() || "";
  }

  const scoped = isDestinationScopedUrl(url, facebookConfig) || isProducerUrl(url);
  console.log("[facebook-live] openProducer", { destination, url, scoped });
  pushToWindows({
    type: "facebook-producer-status",
    open: true,
    pageUrl: homeUrl,
    pageId,
    destination,
  });
  return {
    ok: true,
    pageUrl: homeUrl,
    pageId,
    destination,
    url,
    producerUrl,
    reused: false,
    pageScoped: scoped,
  };
}

/**
 * Prépare Facebook Live selon destination (page | group | profile) + titre + lien.
 */
async function prepareLive(
  facebookConfig = {},
  { title, game, description, linkUrl, linkTitle } = {},
) {
  const destination = resolveDestination(facebookConfig);
  const pageId = resolvePageId(facebookConfig);
  const homeUrl = resolveDestinationHomeUrl(facebookConfig);
  const producerUrl = resolveLiveProducerUrl(facebookConfig);
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return { ok: false, reason: "Titre vide pour Facebook" };

  if (destination === "profile") {
    notify(
      "Facebook",
      "⚠ ATTENTION: destination = PROFIL PERSO (DiddySong). Vérifie avant Go Live.",
      "warn",
    );
  } else if (destination === "group") {
    notify("Facebook", "Ouverture Facebook Live GROUPE…", "info");
  } else {
    notify("Facebook", `Ouverture Facebook Live PAGE ${DEFAULT_PAGE_NAME} (${pageId})…`, "info");
  }

  const login = await ensureLoggedIn();
  if (!login.ok) {
    return { ok: false, needLogin: true, reason: login.reason || "Login Facebook requis", step: "login" };
  }
  const opened = await openProducer(facebookConfig);
  if (!opened.ok) return opened;
  await sleep(1200);

  const producerTargetId =
    destination === "group" ? resolveGroupId(facebookConfig) : pageId;
  const pageName = facebookConfig.pageName || DEFAULT_PAGE_NAME;

  const runOpenLive = (urlOverride) =>
    evalInPage(
      OPEN_LIVE_FN,
      producerTargetId,
      urlOverride || producerUrl,
      destination,
      pageName,
    );

  let open = await runOpenLive();
  console.log("[facebook-live] OPEN_LIVE", open);

  if (open.needLogin) {
    notify("Facebook", "Connecte-toi, puis on continue…", "warn");
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await sleep(3000);
      const url = win.webContents.getURL();
      if (!/login|checkpoint/i.test(url)) {
        if (!isProducerUrl(url)) {
          await loadUrlSafe(win, homeUrl);
          if (destination === "page") await evalInPage(SWITCH_TO_PAGE_FN, pageId);
          await loadUrlSafe(win, producerUrl);
        }
        open = await runOpenLive();
        if (open.ok || !open.needLogin) break;
      }
    }
    if (open.needLogin) {
      return { ok: false, reason: "Login Facebook requis", needLogin: true };
    }
  }

  if (!open.ok) {
    await loadUrlSafe(win, homeUrl);
    if (destination === "page") await evalInPage(SWITCH_TO_PAGE_FN, pageId);
    await loadUrlSafe(win, producerUrl);
    open = await runOpenLive();
  }
  if (!open.ok) {
    notify("Facebook", open.reason || "Impossible d'ouvrir Live Producer", "warn");
    return {
      ok: false,
      reason: open.reason || "Live Producer non ouvert",
      step: "open",
      pageId,
      destination,
      destPick: open.destPick,
    };
  }

  if (!isProducerUrl(win.webContents.getURL() || "") && destination === "page") {
    const businessUrl = resolveBusinessLiveProducerUrl(facebookConfig);
    if (businessUrl) {
      await loadUrlSafe(win, businessUrl);
      open = await runOpenLive(businessUrl);
    }
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

  const wantLink = String(linkUrl || facebookConfig.linkUrl || "").trim();
  const wantLinkTitle = String(linkTitle || facebookConfig.linkTitle || "").trim();
  let linkResult = null;
  if (wantLink) {
    linkResult = await evalInPage(ADD_LINK_FN, wantLink, wantLinkTitle);
    if (linkResult?.ok) notify("Facebook", `Lien: ${wantLinkTitle || wantLink}`, "info");
    else {
      notify(
        "Facebook",
        `Lien non auto (${linkResult?.reason || "—"}) — ajoute-le à la main si besoin`,
        "warn",
      );
    }
  }

  lastCredentials = {
    rtmpUrl: (creds.rtmpUrl || "rtmps://live-api-s.facebook.com:443/rtmp").replace(/\/$/, ""),
    streamKey: creds.streamKey,
    title: cleanTitle,
    game: game || "",
    audience: meta.audienceSet ? "Public" : "",
    destination,
    pageId,
    pageUrl: homeUrl,
    pageScoped: open.pageScoped !== false,
    producerUrl: win?.webContents?.getURL?.() || producerUrl,
    linkUrl: wantLink,
    linkTitle: wantLinkTitle,
    link: linkResult,
    persistentOn: creds.persistentOn,
    at: Date.now(),
  };

  const destLabel =
    destination === "profile"
      ? "PROFIL ⚠"
      : destination === "group"
        ? "GROUPE"
        : `PAGE ${DEFAULT_PAGE_NAME}`;
  notify(
    "Facebook",
    `${destLabel} · clé ${creds.reusedFromConfig ? "réutilisée" : "récupérée"}${meta.titleFilled ? " · titre" : ""}${wantLink ? " · lien" : ""}`,
    destination === "profile" ? "warn" : "info",
  );
  pushToWindows({ type: "facebook-credentials", ...lastCredentials });

  return {
    ok: true,
    platform: "facebook",
    ...lastCredentials,
    titleFilled: meta.titleFilled,
    audienceSet: meta.audienceSet,
    gameFilled: meta.gameFilled,
    metaReason: meta.reason,
    windowKeptOpen: true,
    note: "Garde la fenêtre ouverte — « Lancer un direct » quand le flux arrive",
  };
}

async function openPageToVerifyLive(pageUrl) {
  const url =
    pageUrl ||
    lastCredentials?.pageUrl ||
    DEFAULT_PAGE_URL;
  try {
    // Nouvelle fenêtre légère pour voir le live sur la PAGE (ne touche pas au producer)
    const ses = getFbSession();
    const viewer = new BrowserWindow({
      width: 1100,
      height: 800,
      title: "Facebook PAGE — vérif live AnimeBeat",
      autoHideMenuBar: false,
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await viewer.loadURL(url);
    notify(
      "Facebook",
      "Vérifie le live sur la PAGE (pas le profil). Si rien : Relancer Facebook Live.",
      "info",
    );
    return { ok: true, url };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

const SCRAPE_FB_LIVE_URL_FN = `async function scrapeFbLiveUrl(pageId) {
  const out = { ok: false, liveUrl: "", liveId: "", via: "" };
  const add = (href, via) => {
    if (!href || typeof href !== "string") return;
    let u = href.split("#")[0];
    if (!/^https?:\\/\\//i.test(u)) return;
    if (!/facebook\\.com|fb\\.watch/i.test(u)) return;
    const idMatch = u.match(/\\/videos\\/(?:[^/]+\\/)?(\\d{6,})/i)
      || u.match(/[?&]v=(\\d{6,})/i)
      || u.match(/fb\\.watch\\/([^/?#]+)/i)
      || u.match(/\\/reel\\/(\\d{6,})/i);
    if (/\\/videos\\/|\\/watch|fb\\.watch|\\/live\\b|story_fbid|\\/posts\\//i.test(u) || idMatch) {
      if (!out.liveUrl || idMatch) {
        out.liveUrl = u;
        out.liveId = (idMatch && (idMatch[1] || "")) || out.liveId;
        out.via = via;
        out.ok = true;
      }
    }
  };
  add(location.href, "location");
  const og = document.querySelector('meta[property="og:url"]')?.content;
  add(og, "og:url");
  for (const a of document.querySelectorAll("a[href]")) {
    add(a.href, "anchor");
  }
  // Champs / boutons « Copier le lien », inputs readonly
  for (const el of document.querySelectorAll("input, textarea")) {
    const v = (el.value || "").trim();
    if (/facebook\\.com|fb\\.watch/i.test(v)) add(v, "input");
  }
  // IDs dans l’URL producer
  const loc = String(location.href || "");
  const fromQuery = loc.match(/video_id=(\\d{6,})/i)
    || loc.match(/broadcast_id=(\\d{6,})/i)
    || loc.match(/target_id=(\\d{6,})/i)
    || loc.match(/post_id=(\\d{6,})/i);
  if (fromQuery && pageId) {
    const vid = fromQuery[1];
    out.liveId = out.liveId || vid;
    if (!out.liveUrl) {
      out.liveUrl = "https://www.facebook.com/" + pageId + "/videos/" + vid + "/";
      out.via = out.via || "query+pageId";
      out.ok = true;
    }
  }
  // Texte visible contenant une URL
  const body = (document.body && document.body.innerText) || "";
  const m = body.match(/https?:\\/\\/(?:www\\.)?(?:facebook\\.com\\/[^\\s]+|fb\\.watch\\/[^\\s]+)/i);
  if (m) add(m[0], "body");
  return out;
}`;

async function fetchLiveUrlFromGraph(facebookConfig = {}) {
  const token = String(facebookConfig.accessToken || "").trim();
  const pageId = resolvePageId(facebookConfig) || lastCredentials?.pageId || DEFAULT_PAGE_ID;
  if (!token || !pageId) return { ok: false, reason: "token ou pageId manquant" };
  try {
    const url =
      `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/live_videos` +
      `?broadcast_status=["LIVE"]&fields=id,permalink_url,status,title&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, reason: json?.error?.message || res.statusText };
    }
    const row = Array.isArray(json.data) ? json.data[0] : null;
    if (!row?.id) return { ok: false, reason: "aucun live LIVE via Graph" };
    let liveUrl = row.permalink_url || "";
    if (liveUrl && liveUrl.startsWith("/")) {
      liveUrl = `https://www.facebook.com${liveUrl}`;
    }
    if (!liveUrl) {
      liveUrl = `https://www.facebook.com/${pageId}/videos/${row.id}/`;
    }
    return { ok: true, liveUrl, liveId: String(row.id), via: "graph" };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function capturePublicLiveUrl(facebookConfig = {}) {
  const cfg = { ...(lastCredentials || {}), ...facebookConfig };
  const pageId = resolvePageId(cfg) || DEFAULT_PAGE_ID;
  let scraped = { ok: false };
  try {
    if (win && !win.isDestroyed()) {
      scraped = await evalInPage(SCRAPE_FB_LIVE_URL_FN, pageId);
    }
  } catch {
    scraped = { ok: false };
  }
  if (!scraped?.ok || !scraped.liveUrl) {
    const graph = await fetchLiveUrlFromGraph(cfg);
    if (graph.ok) scraped = graph;
  }
  if (scraped?.ok && scraped.liveUrl) {
    try {
      const { persistPlatformLiveUrl } = require("../persist-live-url");
      persistPlatformLiveUrl("facebook", {
        liveUrl: scraped.liveUrl,
        liveId: scraped.liveId || "",
      });
    } catch {
      /* optional */
    }
    if (lastCredentials) {
      lastCredentials.liveUrl = scraped.liveUrl;
      lastCredentials.liveId = scraped.liveId || "";
    }
  }
  return scraped;
}

async function goLive({
  waitForReady = false,
  timeoutMs = 180000,
  probePreview = false,
  openPageAfter = true,
  facebookConfig = null,
} = {}) {
  if (!win || win.isDestroyed()) {
    notify("Facebook", "Fenêtre fermée — réouverture Live Producer…", "info");
    const cfg = facebookConfig || lastCredentials || {};
    const opened = await openProducer({
      destination: cfg.destination || "page",
      pageId: cfg.pageId || DEFAULT_PAGE_ID,
      pageUrl: cfg.pageUrl || DEFAULT_PAGE_URL,
      groupId: cfg.groupId,
      groupUrl: cfg.groupUrl,
      personalProfileUrl: cfg.personalProfileUrl,
    });
    if (!opened.ok || !win || win.isDestroyed()) {
      return {
        ok: false,
        reason: "Fenêtre Facebook fermée — clique « Préparer Facebook Live » d’abord",
      };
    }
    await sleep(1500);
  }

  const finishOk = async (res) => {
    const dest = lastCredentials?.destination || "page";
    const label =
      dest === "profile" ? "PROFIL PERSO ⚠" : dest === "group" ? "GROUPE" : "PAGE";
    notify("Facebook", `Direct lancé (${label})`, dest === "profile" ? "warn" : "info");
    // Laisse Meta publier le permalink puis scrape
    await sleep(4000);
    let liveMeta = await capturePublicLiveUrl(facebookConfig || lastCredentials || {});
    if (!liveMeta?.ok) {
      await sleep(5000);
      liveMeta = await capturePublicLiveUrl(facebookConfig || lastCredentials || {});
    }
    pushToWindows({
      type: "facebook-go-live",
      ok: true,
      pageId: lastCredentials?.pageId,
      destination: dest,
      liveUrl: liveMeta?.liveUrl || "",
      liveId: liveMeta?.liveId || "",
    });
    if (openPageAfter) {
      await sleep(1500);
      await openPageToVerifyLive(liveMeta?.liveUrl || lastCredentials?.pageUrl);
    }
    return {
      ...res,
      pageId: lastCredentials?.pageId,
      destination: dest,
      liveUrl: liveMeta?.liveUrl || "",
      liveId: liveMeta?.liveId || "",
      verifiedPageOpened: Boolean(openPageAfter),
    };
  };

  if (!waitForReady) {
    const res = await evalInPage(GO_LIVE_FN, false);
    if (res.ok) return finishOk(res);
    notify("Facebook", res.reason || "Go Live pas prêt", "warn");
    return res;
  }

  notify("Facebook", "Attente flux / bouton Lancer un direct…", "info");
  const deadline = Date.now() + timeoutMs;
  let lastReason = "";
  while (Date.now() < deadline) {
    if (!win || win.isDestroyed()) return { ok: false, reason: "fenêtre fermée" };
    const probe = await evalInPage(GO_LIVE_FN, true);
    lastReason = probe.reason || lastReason;
    if (probe.ready) {
      if (probePreview) notify("Facebook", "Preview OK — lancement du direct…", "info");
      const res = await evalInPage(GO_LIVE_FN, false);
      if (res.ok) return finishOk(res);
      lastReason = res.reason || lastReason;
    }
    await sleep(2500);
  }
  return { ok: false, reason: lastReason || "Timeout : bouton Lancer un direct toujours inactif" };
}

function watchAndGoLive(timeoutMs = 300000) {
  try {
    const { isAutoGoLiveEnabled } = require("../go-live-pipeline");
    if (!isAutoGoLiveEnabled()) {
      notify("Facebook", "Auto Go Live OFF (garde-fou) — bouton manuel requis", "info");
      return { ok: true, watching: false, blocked: true };
    }
  } catch {
    /* optional */
  }
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
      const probe = await evalInPage(GO_LIVE_FN, true);
      if (!probe.ready) return;
      const res = await evalInPage(GO_LIVE_FN, false);
      if (res.ok) {
        clearInterval(goLiveWatcher);
        goLiveWatcher = null;
        notify("Facebook", "Direct lancé (auto, flux détecté)", "info");
        await sleep(4000);
        const liveMeta = await capturePublicLiveUrl(lastCredentials || {});
        pushToWindows({
          type: "facebook-go-live",
          ok: true,
          liveUrl: liveMeta?.liveUrl || "",
          liveId: liveMeta?.liveId || "",
        });
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

/**
 * Termine le direct Meta via Live Producer (clic UI).
 * Ne touche PAS à OBS / Start Stream.
 */
async function endBroadcast() {
  if (goLiveWatcher) {
    clearInterval(goLiveWatcher);
    goLiveWatcher = null;
  }
  if (!win || win.isDestroyed()) {
    return {
      ok: false,
      reason: "Live Producer FB fermé — ouvre-le pendant le live puis réessaie",
    };
  }
  try {
    const res = await evalInPage(END_LIVE_FN, false);
    if (res?.ok) {
      notify("Facebook", "Direct terminé (OBS non coupé)", "info");
      if (lastCredentials) {
        lastCredentials.liveUrl = "";
        lastCredentials.liveId = "";
      }
      pushToWindows({ type: "facebook-end-live", ok: true });
    } else {
      notify("Facebook", res?.reason || "Impossible de terminer le direct", "warn");
    }
    return res || { ok: false, reason: "échec end live FB" };
  } catch (err) {
    return { ok: false, reason: err.message || "échec end live FB" };
  }
}

async function ensureProducerReady(facebookConfig = {}, { autoOpen = true } = {}) {
  if (win && !win.isDestroyed()) {
    win.show();
    return { ok: true, reused: true };
  }
  if (!autoOpen) {
    return {
      ok: false,
      skipped: true,
      reason: "Live Producer FB fermé — ouvre/prépare d’abord",
    };
  }
  notify("Facebook", "Ouverture Live Producer pour maj titre/infos…", "info");
  const opened = await openProducer(facebookConfig || lastCredentials || {});
  if (!opened?.ok || !win || win.isDestroyed()) {
    return {
      ok: false,
      reason: opened?.reason || "Impossible d’ouvrir Live Producer FB",
    };
  }
  await sleep(1800);
  return { ok: true, opened: true };
}

/** Met à jour titre/jeu (ouvre le Producer si besoin, sans re-créer la clé). */
async function updateTitleGame({
  title,
  game,
  description,
  facebookConfig = null,
  autoOpen = true,
} = {}) {
  const ready = await ensureProducerReady(facebookConfig || lastCredentials || {}, {
    autoOpen,
  });
  if (!ready.ok) {
    return { ok: false, skipped: Boolean(ready.skipped), platform: "facebook", reason: ready.reason };
  }
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return { ok: false, platform: "facebook", reason: "Titre vide" };
  try {
    const meta = await evalInPage(
      FILL_TITLE_GAME_FN,
      cleanTitle,
      String(game || "").trim(),
      String(description || cleanTitle).trim(),
    );
    const ok = Boolean(meta?.ok);
    if (ok) notify("Facebook", `Titre live mis à jour: ${cleanTitle}`, "info");
    else {
      notify(
        "Facebook",
        meta?.reason || "Titre non trouvé — ouvre « Modifier les détails » dans Live Producer",
        "warn",
      );
    }
    return {
      ok,
      platform: "facebook",
      live: ok,
      via: "producer",
      opened: Boolean(ready.opened),
      meta,
      reason: meta?.reason || (ok ? null : "échec titre FB"),
    };
  } catch (err) {
    return { ok: false, platform: "facebook", reason: err.message || "échec titre FB" };
  }
}

/** Pousse le lien sticky (ouvre le Producer si besoin). */
async function updateStickyLink({
  linkUrl,
  linkTitle,
  facebookConfig = null,
  autoOpen = true,
} = {}) {
  const ready = await ensureProducerReady(facebookConfig || lastCredentials || {}, {
    autoOpen,
  });
  if (!ready.ok) {
    return { ok: false, skipped: Boolean(ready.skipped), platform: "facebook", reason: ready.reason };
  }
  const url = String(linkUrl || "").trim();
  if (!url) return { ok: false, platform: "facebook", reason: "URL lien vide" };
  try {
    const linkResult = await evalInPage(ADD_LINK_FN, url, String(linkTitle || "").trim());
    if (linkResult?.ok) {
      notify("Facebook", `Lien live: ${linkTitle || url}`, "info");
      return {
        ok: true,
        platform: "facebook",
        live: true,
        via: "producer",
        opened: Boolean(ready.opened),
        linkResult,
      };
    }
    return {
      ok: false,
      platform: "facebook",
      reason: linkResult?.reason || "Lien non appliqué (modal FB ?)",
      linkResult,
    };
  } catch (err) {
    return { ok: false, platform: "facebook", reason: err.message || "échec lien FB" };
  }
}

module.exports = {
  openProducer,
  prepareLive,
  goLive,
  watchAndGoLive,
  endBroadcast,
  closeProducer,
  getStatus,
  updateTitleGame,
  updateStickyLink,
  capturePublicLiveUrl,
  fetchLiveUrlFromGraph,
  ensureLoggedIn,
  openPageToVerifyLive,
  resolvePageUrl,
  resolvePageId,
  resolveDestination,
  resolveGroupId,
  resolveLiveProducerUrl,
  resolveBusinessLiveProducerUrl,
  resolveDestinationHomeUrl,
  DEFAULT_PAGE_URL,
  DEFAULT_PAGE_ID,
  DEFAULT_PERSONAL_PROFILE_URL,
  DESTINATIONS,
  PARTITION,
};
