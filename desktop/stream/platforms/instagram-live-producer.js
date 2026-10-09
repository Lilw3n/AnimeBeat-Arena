/**
 * Automatise Instagram Live Producer (web) :
 * titre → Suivant → récupère URL RTMPS + clé (change à chaque live).
 * Session persistante : partition Electron `persist:instagram-live`.
 * Une seule fenêtre réutilisée (pas de piles d'onglets/fenêtres).
 */
const { BrowserWindow } = require("electron");
const { notify, pushToWindows } = require("../notify");
const igCam = require("../ig-cam-preload");
const {
  getHardenedSession,
  flushSession,
  hasInstagramCookies,
  patchPageAutomationFlags,
} = require("../persist-session");
const { installWindowNavMenu } = require("../../browser-nav");

const PARTITION = "persist:instagram-live";
const HOME_URL = "https://www.instagram.com/";
const WINDOW_TITLE = "Instagram Live Producer — AnimeBeat";

let win = null;
let igSession = null;
let lastCredentials = null;
/** Empêche plusieurs prepareLive en parallèle (sinon plusieurs fenêtres). */
let prepareLock = null;
let camScriptId = null;
/** @type {{ deviceId?: string, deviceLabel?: string }} */
let cameraPreference = {
  deviceLabel: "OBS Virtual Camera",
};

function getIgSession() {
  if (!igSession) igSession = getHardenedSession(PARTITION);
  return igSession;
}

function getStatus() {
  return {
    open: Boolean(win && !win.isDestroyed()),
    credentials: lastCredentials,
    busy: Boolean(prepareLock),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Réutilise la fenêtre existante ; ferme les doublons éventuels. */
function ensureWindow() {
  // Récupère une fenêtre déjà ouverte (même process)
  if (!win || win.isDestroyed()) {
    const existing = BrowserWindow.getAllWindows().find(
      (w) =>
        !w.isDestroyed() &&
        (w.getTitle().includes("Instagram Live Producer") ||
          w.getTitle() === "Instagram" ||
          (w.webContents?.getURL?.() || "").includes("instagram.com")),
    );
    if (existing) win = existing;
  }

  if (win && !win.isDestroyed()) {
    // Ne PAS détruire d'autres fenêtres IG (provoque déco cookies Meta)
    win.setTitle(WINDOW_TITLE);
    installWindowNavMenu(win, { homeUrl: HOME_URL });
    win.show();
    win.focus();
    return win;
  }

  const ses = getIgSession();
  igCam.setPref(cameraPreference);

  win = new BrowserWindow({
    width: 1180,
    height: 820,
    title: WINDOW_TITLE,
    autoHideMenuBar: false,
    show: true,
    webPreferences: {
      // sandbox:false = même accès DirectShow / OBS Virtual Camera que la sonde hub
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  installWindowNavMenu(win, { homeUrl: HOME_URL });
  registerCamScriptOnNewDocument(win).catch(() => {});

  const onLoaded = () => {
    patchPageAutomationFlags(win.webContents).catch(() => {});
    installCameraPreference(win).catch(() => {});
    flushSession(ses).catch(() => {});
  };
  win.webContents.on("did-finish-load", onLoaded);
  win.webContents.on("dom-ready", () => {
    installCameraPreference(win).catch(() => {});
  });
  win.webContents.on("did-navigate", () => {
    patchPageAutomationFlags(win.webContents).catch(() => {});
    installCameraPreference(win).catch(() => {});
  });
  win.webContents.on("did-navigate-in-page", () => {
    installCameraPreference(win).catch(() => {});
  });
  win.webContents.on("did-frame-finish-load", (_e, isMainFrame) => {
    if (!isMainFrame) installCameraPreference(win).catch(() => {});
  });

  win.on("close", () => {
    // Flush cookies AVANT destruction (sinon logout au prochain lancement)
    flushSession(ses).catch(() => {});
  });
  win.on("closed", () => {
    win = null;
    camScriptId = null;
    pushToWindows({ type: "instagram-producer-status", open: false });
  });

  return win;
}

/**
 * Injecte le patch caméra AVANT les scripts Instagram (CDP).
 * C’est ce qui empêche IG de prendre la webcam par défaut.
 */
async function registerCamScriptOnNewDocument(target) {
  if (!target || target.isDestroyed()) return { ok: false };
  const wc = target.webContents;
  igCam.setPref(cameraPreference);
  const source = igCam.buildPatchSource(cameraPreference);
  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach("1.3");
    }
    await wc.debugger.sendCommand("Page.enable");
    if (camScriptId) {
      try {
        await wc.debugger.sendCommand("Page.removeScriptToEvaluateOnNewDocument", {
          identifier: camScriptId,
        });
      } catch {
        /* ignore */
      }
      camScriptId = null;
    }
    const added = await wc.debugger.sendCommand(
      "Page.addScriptToEvaluateOnNewDocument",
      { source },
    );
    camScriptId = added?.identifier || null;
    return { ok: true, via: "cdp", identifier: camScriptId };
  } catch (err) {
    camScriptId = null;
    return { ok: false, reason: err.message };
  }
}

async function installCameraPreference(target) {
  if (!target || target.isDestroyed()) return { ok: false };
  const pref = cameraPreference || {};
  igCam.setPref(pref);

  // Toujours synchroniser le script CDP (préférence à jour pour les prochains loads)
  await registerCamScriptOnNewDocument(target);

  // Patch immédiat sur la page / frames déjà chargées
  const source = igCam.buildPatchSource(pref);
  try {
    await target.webContents.executeJavaScript(source, true);
  } catch {
    /* ignore */
  }
  try {
    const frames = target.webContents.mainFrame?.framesInSubtree || [];
    for (const frame of frames) {
      try {
        await frame.executeJavaScript(source);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  // Warm-up APRÈS le patch, avec la caméra préférée uniquement (pas la défaut)
  const warm = await target.webContents.executeJavaScript(
    `(async function () {
      const preferId = ${JSON.stringify(pref.deviceId || "")};
      const preferLabel = ${JSON.stringify(pref.deviceLabel || "OBS Virtual Camera")};
      const media = navigator.mediaDevices;
      if (!media) return { ok: false };
      try {
        const devices = await media.enumerateDevices();
        const videos = devices.filter((d) => d.kind === "videoinput");
        const needle = (preferLabel || "").toLowerCase().replace(/\\s*★\\s*$/g, "").trim();
        let pick = preferId && !String(preferId).startsWith("dshow:")
          ? videos.find((d) => d.deviceId === preferId)
          : null;
        if (!pick && needle) {
          pick = videos.find((d) => (d.label || "").toLowerCase().includes(needle));
        }
        if (!pick) {
          pick = videos.find((d) => /obs\\s*virtual\\s*camera/i.test(d.label || ""));
        }
        const constraints = pick
          ? { video: { deviceId: { exact: pick.deviceId } }, audio: false }
          : { video: true, audio: false };
        const s = await media.getUserMedia(constraints);
        const trackLabel = s.getVideoTracks()[0]?.label || "";
        s.getTracks().forEach((t) => t.stop());
        return {
          ok: true,
          patched: Boolean(window.__abCamPatch),
          preferLabel,
          preferId,
          picked: pick?.label || null,
          trackLabel,
          videoLabels: videos.map((d) => d.label),
          match: pick
            ? (trackLabel || "").toLowerCase().includes((pick.label || "").toLowerCase().slice(0, 12))
            : false,
        };
      } catch (e) {
        return { ok: false, reason: e.message, patched: Boolean(window.__abCamPatch) };
      }
    })()`,
    true,
  );

  if (warm?.picked || warm?.trackLabel) {
    notify(
      "Instagram",
      `Caméra forcée: ${warm.trackLabel || warm.picked || pref.deviceLabel}`,
      warm.match === false ? "warn" : "info",
    );
  }
  return warm || { ok: true };
}

function setCameraPreference(pref = {}) {
  cameraPreference = {
    deviceId: pref.deviceId || "",
    deviceLabel: pref.deviceLabel || pref.label || "OBS Virtual Camera",
  };
  igCam.setPref(cameraPreference);
  if (win && !win.isDestroyed()) {
    installCameraPreference(win).catch(() => {});
  }
  return cameraPreference;
}

async function waitForLoad(target, timeoutMs = 90000) {
  const wc = target.webContents;
  if (!wc.isLoading()) {
    await sleep(1200);
    return;
  }
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      clearInterval(poll);
      resolve();
    };
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      clearInterval(poll);
      // Ne pas planter : Instagram peut rester en soft-nav / SPA
      resolve();
    }, timeoutMs);
    const poll = setInterval(() => {
      if (!wc.isLoading()) finish();
    }, 400);
    wc.once("did-finish-load", finish);
    wc.once("did-navigate", () => {
      /* continue waiting */
    });
  });
  await sleep(1500);
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
    const lab = ((el.getAttribute("aria-label") || "") + " " + (el.placeholder || "") + " " + (el.previousElementSibling?.innerText || "")).toLowerCase();
    if (/^rtmps?:\\/\\//i.test(v)) rtmpUrl = v;
    else if (/url.*(stream|rtmp)|stream url|server/i.test(lab) && /^rtmps?:\\/\\//i.test(v)) rtmpUrl = v;
    else if (/clé|stream key|streamkey|key/i.test(lab) && v.length >= 16 && !/^https?:/i.test(v)) streamKey = v;
    else if (v.length > 40 && /[?&]s_|rtmp|live/i.test(v) && !/^https?:/i.test(v)) streamKey = v;
    else if (v.length > 48 && !/^https?:/i.test(v) && !/\\s/.test(v) && streamKey.length < v.length) streamKey = v;
  }
  // parfois dans des spans/divs sélectionnables
  if (!rtmpUrl) {
    const m = body.match(/rtmps?:\\/\\/[^\\s]+/i);
    if (m) rtmpUrl = m[0];
  }
  if (!streamKey) {
    const km = body.match(
      /(?:clé de stream|stream key)[^\\n]{0,60}\\n?\\s*([A-Za-z0-9_\\-?&=.]{16,})/i,
    );
    if (km) streamKey = km[1];
  }

  // Page exacte: « URL du stream » + « Clé de stream » (+ souvent « Connectez le logiciel… »)
  const onStreamCredsUi =
    /url du stream|stream url/i.test(lower) && /clé de stream|stream key/i.test(lower);

  // Relabel inputs proches des libellés FR/EN
  if (!rtmpUrl || !streamKey) {
    for (const el of inputs) {
      const v = (el.value || "").trim();
      if (!v) continue;
      const near = (
        (el.getAttribute("aria-label") || "") +
        " " +
        (el.placeholder || "") +
        " " +
        (el.closest("label")?.innerText || "") +
        " " +
        (el.parentElement?.innerText || "")
      )
        .toLowerCase()
        .slice(0, 120);
      if (!rtmpUrl && (/url du stream|stream url|rtmp/i.test(near) || /^rtmps?:\\/\\//i.test(v))) {
        if (/^rtmps?:\\/\\//i.test(v)) rtmpUrl = v;
      }
      if (
        !streamKey &&
        /clé de stream|stream key/i.test(near) &&
        v.length >= 16 &&
        !/^https?:/i.test(v) &&
        !/^rtmps?:/i.test(v)
      ) {
        streamKey = v;
      }
    }
  }

  if (onStreamCredsUi && rtmpUrl && streamKey) {
    return { state: "credentials", url, rtmpUrl, streamKey, page: "stream-creds" };
  }
  if (rtmpUrl && streamKey) {
    return { state: "credentials", url, rtmpUrl, streamKey };
  }
  if (onStreamCredsUi || rtmpUrl) {
    return {
      state: "credentials_partial",
      url,
      rtmpUrl: rtmpUrl || "",
      streamKey: streamKey || "",
      page: onStreamCredsUi ? "stream-creds" : "",
    };
  }

  const titleInput = inputs.find((el) => {
    const ph = (el.getAttribute("placeholder") || "").toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    const name = (el.getAttribute("name") || "").toLowerCase();
    return /titre|title|ajoutez un titre|add a title/.test(ph + " " + aria + " " + name);
  });
  // Écran Go Live sans clés encore visibles
  if (
    /connectez le logiciel de streaming|streaming software|lancer un direct|go live/i.test(lower) &&
    !/accounts\\/login/i.test(url)
  ) {
    return {
      state: "awaiting_stream",
      url,
      rtmpUrl: rtmpUrl || "",
      streamKey: streamKey || "",
      hasGoLive: /lancer un direct|go live/i.test(lower),
    };
  }

  if (titleInput || /ajouter des informations|add details|vidéo en direct|live video|audience|public/.test(lower)) {
    return { state: "title", url, hasTitleInput: Boolean(titleInput) };
  }

  return { state: "home", url, lowerSnippet: lower.slice(0, 200) };
}`;

const FILL_TITLE_FN = `async function fillTitleAndNext(title) {
  const want = String(title || "").trim();
  if (!want) return { ok: false, reason: "titre vide" };

  const clickByText = (patterns) => {
    const nodes = [...document.querySelectorAll("button, div[role='button'], a[role='button'], span, a")];
    for (const el of nodes) {
      const t = (el.innerText || el.textContent || "").trim().toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const href = (el.getAttribute("href") || "").toLowerCase();
      const blob = t + " " + aria + " " + href;
      if (!blob.trim() || t.length > 64) continue;
      if (patterns.some((p) => blob.includes(p))) {
        el.click();
        return blob.trim().slice(0, 40);
      }
    }
    return null;
  };

  const clickCreate = () => {
    const nodes = [...document.querySelectorAll("a, button, div[role='button'], span")];
    // Nav IG FR: parfois "Nouvelle publicationCréer", parfois juste "Créer"
    for (const el of nodes) {
      const compact = (el.innerText || el.textContent || "").replace(/\\s+/g, "").toLowerCase();
      if (compact.includes("nouvellepublication") || compact.includes("newpost")) {
        el.click();
        return "nouvelle-publication";
      }
    }
    for (const el of nodes) {
      const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
      if (t === "créer" || t === "create") {
        el.click();
        return t;
      }
    }
    return clickByText(["nouvelle publication", "new post", "créer", "create"]);
  };

  // Si le champ titre est déjà là, ne pas recliquer Créer (évite piles de menus)
  let detect = await (${DETECT_PAGE_FN})();
  const hasTitleAlready = [...document.querySelectorAll("input, textarea")].some((el) =>
    /titre|title|ajoutez un titre/i.test((el.placeholder || "") + " " + (el.getAttribute("aria-label") || "")),
  );
  if (
    !hasTitleAlready &&
    detect.state !== "credentials" &&
    detect.state !== "credentials_partial" &&
    (detect.state === "home" || detect.state === "login" || detect.state === "title" || !detect.hasTitleInput)
  ) {
    const created = clickCreate();
    await new Promise((r) => setTimeout(r, 1400));
    let live = null;
    const liveExact = [...document.querySelectorAll("button, div[role='button'], span, div")].find((el) => {
      const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
      return t === "vidéo en direct" || t === "live video";
    });
    if (liveExact) {
      liveExact.click();
      live = "vidéo en direct";
    } else {
      live = clickByText(["vidéo en direct", "live video", "diffusion en direct"]);
    }
    await new Promise((r) => setTimeout(r, 1800));
    detect = await (${DETECT_PAGE_FN})();
    detect._nav = { created, live };
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
    }) || inputs.find((el) => el.offsetParent !== null && (el.type === "text" || !el.type || el.tagName === "TEXTAREA") && (el.placeholder || "").length > 0);

  if (!titleEl) {
    return { ok: false, reason: "champ titre introuvable — ouvre Create → Vidéo en direct", url: location.href, bodyHint: (document.body?.innerText || "").slice(0, 180) };
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
  await new Promise((r) => setTimeout(r, 500));

  let clicked = clickByText(["suivant", "next", "continuer", "continue"]);
  if (!clicked) {
    const dialog = document.querySelector("[role='dialog']") || document.body;
    const buttons = [...dialog.querySelectorAll("button, div[role='button']")].filter((el) => {
      const dis = el.getAttribute("aria-disabled") === "true" || el.disabled;
      return !dis && el.offsetParent !== null;
    });
    const primary = [...buttons].reverse().find((el) => {
      const t = (el.innerText || "").trim().toLowerCase();
      return /suivant|next|continuer|continue/.test(t);
    }) || buttons[buttons.length - 1];
    if (primary) {
      primary.click();
      clicked = (primary.innerText || "primary").slice(0, 30);
    }
  }
  if (!clicked) {
    return { ok: false, reason: "bouton Suivant introuvable" };
  }

  return { ok: true, filled: want, clicked };
}`;

const SCRAPE_CREDS_FN = `async function scrapeCreds() {
  const bodyText = (document.body && document.body.innerText) || "";
  const body = bodyText.toLowerCase();
  const onStreamCredsUi =
    /url du stream|stream url/i.test(body) && /clé de stream|stream key/i.test(body);
  // Ne jamais valider avant la page « URL du stream / Clé de stream »
  if (!onStreamCredsUi) {
    const detect = await (${DETECT_PAGE_FN})();
    return {
      ok: false,
      reason: "pas encore sur la page URL/clé de stream",
      detect,
      waitingFor: "stream-creds",
    };
  }

  let rtmpUrl = "";
  let streamKey = "";

  // 1) Inputs / textareas (valeur complète, même si UI tronque + COPIER)
  const fields = [...document.querySelectorAll("input, textarea, [contenteditable='true']")];
  for (const el of fields) {
    const v = String(el.value != null ? el.value : el.textContent || "").trim();
    if (!v) continue;
    if (/^rtmps?:\\/\\//i.test(v)) rtmpUrl = v;
    else if (
      !/^https?:/i.test(v) &&
      !/^rtmps?:/i.test(v) &&
      !/\\s/.test(v) &&
      v.length >= 16 &&
      (/[?&]s_/.test(v) || /^\\d{10,}/.test(v) || v.length >= 32)
    ) {
      if (!streamKey || v.length > streamKey.length) streamKey = v;
    }
  }

  // 2) Libellés FR « URL du stream » / « Clé de stream » → champ voisin
  const walkLabels = (wantRe, pick) => {
    const nodes = [...document.querySelectorAll("span, div, label, p, h1, h2, h3, strong")];
    for (const lab of nodes) {
      const t = (lab.innerText || "").replace(/\\s+/g, " ").trim();
      if (!wantRe.test(t) || t.length > 40) continue;
      let root = lab.parentElement;
      for (let d = 0; d < 5 && root; d += 1) {
        const inp = root.querySelector("input, textarea, [contenteditable='true']");
        if (inp) {
          const v = String(inp.value != null ? inp.value : inp.textContent || "").trim();
          if (v) pick(v);
        }
        // texte à côté du libellé (souvent dans le même bloc)
        const blob = (root.innerText || "").replace(/\\s+/g, " ").trim();
        const m = blob.match(wantRe);
        if (m) {
          const after = blob.slice(blob.toLowerCase().indexOf(m[0].toLowerCase()) + m[0].length).trim();
          const token = after.split(/\\s+|COPIER|Copy/i)[0] || "";
          if (token.length >= 12) pick(token);
        }
        root = root.parentElement;
      }
    }
  };
  walkLabels(/url du stream|stream url/i, (v) => {
    if (/^rtmps?:\\/\\//i.test(v)) rtmpUrl = v;
  });
  walkLabels(/clé de stream|stream key/i, (v) => {
    if (!/^https?:/i.test(v) && !/^rtmps?:/i.test(v) && v.length >= 16) streamKey = v;
  });

  // 3) Regex corps de page (clé IG = id?s_bl=…&s_fbp=…)
  if (!rtmpUrl) {
    const m = bodyText.match(/rtmps?:\\/\\/[^\\s]+/i);
    if (m) rtmpUrl = m[0];
  }
  if (!streamKey) {
    const km =
      bodyText.match(/\\b(\\d{10,}\\?[A-Za-z0-9_=&%.\\-]{8,})/) ||
      bodyText.match(/(?:Clé de stream|Stream key)\\s*\\n?\\s*([A-Za-z0-9_\\-?&=%.]{16,})/i);
    if (km) streamKey = km[1];
  }

  // Normalise URL (IG affiche souvent avec slash final)
  if (rtmpUrl) rtmpUrl = rtmpUrl.replace(/\\/+$/, "") || rtmpUrl;

  if (rtmpUrl && streamKey) {
    return { ok: true, rtmpUrl, streamKey, page: "stream-creds", via: "stream-creds-page" };
  }
  return {
    ok: false,
    reason: "page clés visible mais champs incomplets",
    rtmpUrl: rtmpUrl || "",
    streamKey: streamKey || "",
    page: "stream-creds",
  };
}`;

/** Quitte l’écran clés / live draft pour forcer un NOUVEAU live (nouvelle clé). */
const LEAVE_LIVE_SESSION_FN = `async function leaveLiveSession() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clickText = (re) => {
    const nodes = [...document.querySelectorAll("button, div[role='button'], a, [aria-label], span")];
    for (const el of nodes) {
      const t = ((el.innerText || "") + " " + (el.getAttribute("aria-label") || ""))
        .replace(/\\s+/g, " ")
        .trim()
        .toLowerCase();
      if (!t || t.length > 48) continue;
      if (re.test(t)) {
        el.click();
        return t.slice(0, 40);
      }
    }
    return null;
  };
  // Fermer dialog / retour (pas Terminer un vrai live en cours)
  let clicked =
    clickText(/^(fermer|close|annuler|cancel|retour|back|discard)$/) ||
    clickText(/fermer|close|annuler|cancel|retour|back|discard|supprimer le direct|delete/);
  await sleep(900);
  // Croix sur dialog
  if (!clicked) {
    const dialog = document.querySelector("[role='dialog']");
    const x = dialog && [...dialog.querySelectorAll("button, div[role='button'], [aria-label]")].find((el) => {
      const a = (el.getAttribute("aria-label") || "").toLowerCase();
      return /fermer|close|dismiss/.test(a);
    });
    if (x) {
      x.click();
      clicked = "dialog-x";
      await sleep(900);
    }
  }
  const stillCreds = /url du stream|stream url/i.test(document.body?.innerText || "") &&
    /clé de stream|stream key/i.test(document.body?.innerText || "");
  if (stillCreds || location.href.includes("live")) {
    location.href = "https://www.instagram.com/";
    await sleep(2200);
    return { ok: true, via: "navigate-home", clicked };
  }
  return { ok: true, via: "dismiss", clicked };
}`;

/** Force une NOUVELLE clé via le bouton Réinitialiser (ne pas réutiliser l’ancienne). */
const RESET_STREAM_KEY_FN = `async function resetStreamKey(oldKey) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const before = String(oldKey || "").trim();
  const readKey = async () => {
    const detect = await (${DETECT_PAGE_FN})();
    if (detect.streamKey) {
      return { rtmpUrl: detect.rtmpUrl || "", streamKey: detect.streamKey };
    }
    const inputs = [...document.querySelectorAll("input, textarea")];
    let rtmpUrl = "";
    let streamKey = "";
    for (const el of inputs) {
      const v = (el.value || "").trim();
      if (!v) continue;
      if (/^rtmps?:\\/\\//i.test(v)) rtmpUrl = v;
      else if (v.length >= 16 && !/^https?:/i.test(v) && !/\\s/.test(v)) streamKey = v;
    }
    return { rtmpUrl, streamKey };
  };

  const labels = [
    "réinitialiser",
    "reinitialiser",
    "reset",
    "reset key",
    "reset stream key",
    "générer",
    "generate",
    "new key",
    "nouvelle clé",
  ];
  const nodes = [...document.querySelectorAll("button, div[role='button'], a, span")];
  let hit = null;
  for (const el of nodes) {
    const t = (el.innerText || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().toLowerCase();
    if (!t || t.length > 48) continue;
    if (labels.some((l) => t === l || t.includes(l))) {
      hit = { el, t };
      break;
    }
  }
  if (!hit) {
    return { ok: false, reason: "bouton Réinitialiser introuvable", before };
  }
  hit.el.click();
  await sleep(900);
  for (const el of [...document.querySelectorAll("button, div[role='button']")]) {
    const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
    if (!t || t.length > 32) continue;
    if (/annuler|cancel|fermer|close/.test(t)) continue;
    if (/réinitialiser|reset|confirmer|confirm|oui|yes|ok|continuer/.test(t)) {
      el.click();
      await sleep(1200);
      break;
    }
  }
  let after = await readKey();
  for (let i = 0; i < 16 && (!after.streamKey || (before && after.streamKey === before)); i++) {
    await sleep(700);
    after = await readKey();
  }
  const changed = Boolean(after.streamKey) && after.streamKey !== before;
  return {
    ok: Boolean(after.streamKey),
    clicked: hit.t,
    changed,
    before,
    rtmpUrl: after.rtmpUrl || "",
    streamKey: after.streamKey || "",
    reason: changed
      ? null
      : after.streamKey
        ? "clé identique après reset"
        : "pas de clé après reset",
  };
}`;

const CLICK_GO_LIVE_FN = `async function clickGoLive(probeOnly) {
  const body = ((document.body && document.body.innerText) || "").toLowerCase();
  const previewHint = /aperçu|preview|reçoit|receiving|connecté|connexion réussie|flux|stream connected|looking good/i.test(body);
  const nodes = [...document.querySelectorAll("button, div[role='button']")];
  for (const el of nodes) {
    const t = (el.innerText || el.textContent || "").trim().toLowerCase();
    if (t === "lancer un direct" || t === "go live" || t.includes("lancer un direct") || t === "start live video") {
      const disabled =
        el.getAttribute("aria-disabled") === "true" ||
        el.disabled === true ||
        el.getAttribute("tabindex") === "-1" && el.getAttribute("aria-disabled") === "true" ||
        getComputedStyle(el).pointerEvents === "none" ||
        getComputedStyle(el).opacity < 0.45;
      if (disabled) {
        return { ok: false, ready: false, previewHint, reason: "Lancer un direct pas encore actif (attends le flux)" };
      }
      if (probeOnly) return { ok: true, ready: true, previewHint, probed: true };
      el.click();
      return { ok: true, ready: true, previewHint, clicked: t };
    }
  }
  return { ok: false, ready: false, previewHint, reason: "bouton Lancer un direct introuvable" };
}`;

const END_LIVE_FN = `async function tryEndLive(probeOnly) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const labels = [
    "terminer le direct",
    "end live video",
    "end live video now",
    "end live",
    "arrêter le direct",
    "finir le direct",
    "end broadcast",
    "stop live",
    "end",
    "terminer",
  ];
  const confirmLabels = [
    "terminer le direct",
    "end live video",
    "end live",
    "end now",
    "terminer maintenant",
    "terminer",
    "end",
    "oui",
    "yes",
    "confirm",
    "confirmer",
    "ok",
  ];
  const allClickable = () =>
    [...document.querySelectorAll(
      "button, div[role='button'], a[role='button'], span[role='button'], [aria-label], svg",
    )];

  const scoreLabel = (t, a) => {
    const s = (t + " " + a).toLowerCase().replace(/\\s+/g, " ").trim();
    if (!s) return 0;
    if (/annuler|cancel|fermer|close|pas maintenant|not now|dismiss|retour|back/.test(s)) return 0;
    if (/terminer le direct|end live video|end live now/.test(s)) return 100;
    if (/arrêter le direct|finir le direct|end broadcast|stop live/.test(s)) return 90;
    if ((t === "end" || t === "terminer") && t.length <= 12) return 80;
    if (/end live|terminer/.test(s) && s.length < 40) return 70;
    if (/\\bend\\b/.test(a) && /live|direct|broadcast|video/.test(a)) return 85;
    return 0;
  };

  // 1) Ouvre menu ⋯ / Plus si besoin
  const openMenus = () => {
    const menuBtns = allClickable().filter((el) => {
      const a = (el.getAttribute("aria-label") || "").toLowerCase();
      const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
      return /more|plus d.options|options|menu|paramètres|settings/.test(a + " " + t)
        || t === "⋯" || t === "..." || t === "•••";
    });
    for (const el of menuBtns.slice(0, 3)) {
      try { el.click(); } catch (_) {}
    }
  };

  let best = null;
  let bestScore = 0;
  for (const el of allClickable()) {
    const t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const a = (el.getAttribute("aria-label") || "").toLowerCase();
    // Remonter au bouton parent si SVG
    const target = el.closest("button, div[role='button'], a[role='button']") || el;
    const score = scoreLabel(t, a);
    if (score > bestScore) {
      bestScore = score;
      best = { el: target, t: t || a, score };
    }
  }

  if (!best || bestScore < 70) {
    openMenus();
    await sleep(700);
    best = null;
    bestScore = 0;
    for (const el of allClickable()) {
      const t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();
      const a = (el.getAttribute("aria-label") || "").toLowerCase();
      const target = el.closest("button, div[role='button'], a[role='button']") || el;
      const score = scoreLabel(t, a);
      if (score > bestScore) {
        bestScore = score;
        best = { el: target, t: t || a, score };
      }
    }
  }

  if (!best || bestScore < 70) {
    const body = ((document.body && document.body.innerText) || "").toLowerCase();
    if (!/en direct|live now|spectateur|viewer|terminer|end live/.test(body)) {
      return {
        ok: false,
        reason: "Écran live IG introuvable — ouvre Live Producer pendant le direct (pas la home)",
      };
    }
    return {
      ok: false,
      reason: "Bouton Terminer/End introuvable — clique « Terminer le direct » dans la fenêtre IG puis réessaie",
    };
  }
  if (probeOnly) return { ok: true, ready: true, probed: true, label: best.t, score: bestScore };

  best.el.click();
  await sleep(1000);

  // Confirmations (parfois 2 étapes)
  for (let round = 0; round < 3; round++) {
    const dialog =
      [...document.querySelectorAll("[role='dialog'], [role='alertdialog']")].find((d) =>
        /terminer|end live|arrêter|direct|live|end now/i.test(d.innerText || ""),
      ) || null;
    const scope = dialog || document;
    let confirmed = null;
    let confScore = 0;
    for (const el of [...scope.querySelectorAll("button, div[role='button'], a[role='button']")]) {
      const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
      const a = (el.getAttribute("aria-label") || "").toLowerCase();
      if (!t && !a) continue;
      if (/annuler|cancel|fermer|close|pas maintenant|not now|keep|continuer/.test(t + " " + a)) continue;
      if (el.getAttribute("aria-disabled") === "true" || el.disabled === true) continue;
      let sc = 0;
      if (confirmLabels.some((l) => t === l)) sc = 100;
      else if (confirmLabels.some((l) => t.startsWith(l) || a.includes(l))) sc = 80;
      if (sc > confScore) {
        confScore = sc;
        confirmed = { el, t: t || a };
      }
    }
    if (confirmed && confScore >= 80) {
      confirmed.el.click();
      await sleep(900);
      return { ok: true, clicked: best.t, confirmed: confirmed.t, rounds: round + 1 };
    }
    await sleep(500);
  }
  return { ok: true, clicked: best.t, confirmed: null, note: "clic End sans dialog — vérifie sur IG" };
}`;

const ADD_LINK_FN = `async function addLiveLink(linkUrl, linkTitle) {
  let url = String(linkUrl || "").trim();
  const title = String(linkTitle || "").trim().slice(0, 30);
  if (!url) return { ok: true, skipped: true };
  if (!/^https?:\\/\\//i.test(url)) url = "https://" + url;

  const clickByText = (patterns, { scope = document, maxLen = 60 } = {}) => {
    const root = scope || document;
    const nodes = [...root.querySelectorAll("button, div[role='button'], a, span, label, [role='radio']")];
    for (const el of nodes) {
      const t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();
      if (!t || t.length > maxLen) continue;
      if (patterns.some((p) => t === p || t.includes(p))) {
        el.click();
        return t;
      }
    }
    return null;
  };

  const setVal = (el, value) => {
    if (!el) return false;
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };

  const dialog = () =>
    [...document.querySelectorAll("[role='dialog']")].find((d) =>
      /ajouter un lien|add a link|whatsapp/i.test(d.innerText || ""),
    ) || document.querySelector("[role='dialog']");

  // Ouvre "Ajouter un lien" si pas déjà ouvert
  let scope = dialog();
  if (!scope || !/ajouter un lien|add a link|whatsapp/i.test(scope.innerText || "")) {
    let opened = clickByText(["ajouter un lien", "add a link", "add link"]);
    if (!opened) {
      const byAria = [...document.querySelectorAll("[aria-label]")].find((el) =>
        /ajouter un lien|add a link/i.test(el.getAttribute("aria-label") || ""),
      );
      if (byAria) { byAria.click(); opened = "aria"; }
    }
    if (!opened) return { ok: false, reason: "bouton Ajouter un lien introuvable" };
    await new Promise((r) => setTimeout(r, 1000));
    scope = dialog() || document.body;
  }

  // Étape 1 (nouveau IG): choisir « Lien » (pas WhatsApp) puis « Confirmer »
  const step1Text = (scope.innerText || "").toLowerCase();
  if (/lien whatsapp|whatsapp|confirmer/.test(step1Text) && !/url|http|titre/.test(step1Text)) {
    // Radio « Lien » (pas WhatsApp)
    let picked = null;
    const radios = [...scope.querySelectorAll("[role='radio'], label, div[role='button'], span")];
    for (const el of radios) {
      const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
      if (!t || t.length > 40) continue;
      if (t.includes("whatsapp")) continue;
      if (t === "lien" || t === "link" || /^lien\\b/.test(t)) {
        el.click();
        picked = t;
        break;
      }
    }
    if (!picked) clickByText(["lien", "link", "add a url"], { scope, maxLen: 40 });
    await new Promise((r) => setTimeout(r, 400));
    let confirmed = clickByText(["confirmer", "confirm", "suivant", "next"], { scope });
    if (!confirmed) {
      const btn = [...scope.querySelectorAll("button, div[role='button']")].find((el) => {
        const t = (el.innerText || "").trim().toLowerCase();
        return t === "confirmer" || t === "confirm";
      });
      if (btn && btn.getAttribute("aria-disabled") !== "true" && !btn.disabled) {
        btn.click();
        confirmed = "confirmer";
      }
    }
    await new Promise((r) => setTimeout(r, 1100));
    scope = dialog() || document.body;
  }

  // Étape 2: URL + titre
  const inputs = [...(scope || document).querySelectorAll("input, textarea")].filter(
    (el) => el.offsetParent !== null || el.getClientRects().length,
  );
  let urlEl = inputs.find((el) => {
    const lab = ((el.getAttribute("aria-label") || "") + " " + (el.placeholder || "") + " " + (el.previousElementSibling?.innerText || "")).toLowerCase();
    return /url|lien|link|http|website|site/.test(lab) || el.type === "url";
  });
  let titleEl = inputs.find((el) => {
    const lab = ((el.getAttribute("aria-label") || "") + " " + (el.placeholder || "") + " " + (el.previousElementSibling?.innerText || "")).toLowerCase();
    return /titre|title/.test(lab);
  });
  if (!urlEl && inputs[0]) urlEl = inputs[0];
  if (!titleEl && inputs[1]) titleEl = inputs[1];

  if (!urlEl) {
    return {
      ok: false,
      reason: "champ URL introuvable — sélectionne Lien (pas WhatsApp) puis Confirmer",
      step1: true,
    };
  }

  setVal(urlEl, url);
  if (title) setVal(titleEl, title);
  await new Promise((r) => setTimeout(r, 500));

  // Valider: Terminé / Confirmer / Done
  let done = clickByText(["terminé", "done", "confirmer", "confirm", "enregistrer", "save"], { scope });
  if (!done) {
    const primary = [...scope.querySelectorAll("button, div[role='button']")].reverse().find((el) => {
      const t = (el.innerText || "").trim().toLowerCase();
      const disabled = el.getAttribute("aria-disabled") === "true" || el.disabled;
      return !disabled && (t === "terminé" || t === "done" || t === "confirmer" || t === "confirm");
    });
    if (primary) {
      primary.click();
      done = (primary.innerText || "ok").trim().toLowerCase();
    }
  }
  await new Promise((r) => setTimeout(r, 900));

  const still = [...document.querySelectorAll("[role='dialog']")].some((d) =>
    /ajouter un lien|add a link/i.test(d.innerText || ""),
  );
  if (still) {
    const again = [...document.querySelectorAll("button, div[role='button']")].find((el) => {
      const t = (el.innerText || "").trim().toLowerCase();
      return t === "terminé" || t === "done" || t === "confirmer";
    });
    if (again) again.click();
    await new Promise((r) => setTimeout(r, 700));
  }
  return { ok: true, url, title, done: done || "confirmer" };
}`;

async function openProducer() {
  const target = ensureWindow();
  const ses = getIgSession();
  const url = target.webContents.getURL() || "";

  // Déjà sur Instagram : ne pas recharger (garde la session + évite pages en cascade)
  if (url.includes("instagram.com") && url !== "about:blank") {
    target.show();
    target.focus();
    await flushSession(ses);
    pushToWindows({ type: "instagram-producer-status", open: true });
    return { ok: true, url, reused: true };
  }

  // Cookies déjà là : ouvrir home une fois suffit, pas de reload agressif ensuite
  const loggedIn = await hasInstagramCookies(ses);

  const loadPromise = waitForLoad(target, 90000);
  try {
    await target.loadURL(HOME_URL);
  } catch {
    /* navigation abort */
  }
  await loadPromise;
  await patchPageAutomationFlags(target.webContents);
  await flushSession(ses);
  pushToWindows({
    type: "instagram-producer-status",
    open: true,
    loggedIn,
  });
  return { ok: true, url: target.webContents.getURL(), reused: false, loggedIn };
}

async function pushCredsToAitum(creds, options = {}) {
  try {
    const obsBridge = require("../obs-bridge");
    const aitumCfg = options.aitumVertical || options.aitumCfg || {};
    const obsCfg = options.obsConfig || options.obs || {};
    const server = String(creds.rtmpUrl || "")
      .trim()
      .replace(/\/$/, "");
    const key = String(creds.streamKey || "").trim();

    let pushed = await obsBridge.pushInstagramKeyToAitum(
      obsCfg,
      { rtmpUrl: server, streamKey: key },
      aitumCfg,
    );

    // IG = Aitum Vertical Streaming uniquement — JAMAIS OBS → Paramètres → Stream (paysage)
    if (!pushed?.ok || pushed?.skipped) {
      notify(
        "Aitum",
        pushed?.reason ||
          "Clé IG non mise dans Aitum — crée une ligne Streaming « Instagram » (enabled) dans Vertical Settings",
        "warn",
      );
      return pushed || { ok: false, reason: "push Aitum IG échoué" };
    }

    notify(
      "Aitum",
      `Clé IG → Aitum slot #${aitumCfg.instagramOutputIndex ?? aitumCfg.outputIndex ?? 0} (…${key.slice(-6)})`,
      "info",
    );
    const shouldStart =
      options.startAitumStreaming !== false &&
      aitumCfg.autoStartStreaming !== false;
    if (shouldStart) {
      const started = await obsBridge.startAitumStreaming(obsCfg).catch((err) => ({
        ok: false,
        reason: err.message,
      }));
      pushed.streamingStarted = Boolean(started?.ok);
      if (!started?.ok) {
        notify("Aitum", started?.reason || "Start Streaming Vertical échoué", "warn");
      } else {
        notify("Aitum", "Streaming Vertical démarré (pas le bouton Stream OBS classique)", "info");
      }
    }
    return pushed;
  } catch (err) {
    notify("Aitum", err.message || "Push Aitum impossible", "warn");
    return { ok: false, reason: err.message };
  }
}

async function finalizeStreamCreds(creds, cleanTitle, options, meta = {}) {
  const rtmpUrl = String(creds.rtmpUrl || "")
    .replace(/\/$/, "")
    .trim();
  const streamKey = String(creds.streamKey || "").trim();
  if (!rtmpUrl || !streamKey) {
    return { ok: false, reason: "URL/clé incompletes sur la page stream" };
  }

  let linkResult = { ok: true, skipped: true };
  const linkUrl = options.linkUrl || options.liveLinkUrl || "";
  const linkTitle = options.linkTitle || options.liveLinkTitle || "";
  if (linkUrl) {
    linkResult = await evalInPage(ADD_LINK_FN, linkUrl, linkTitle);
    if (!linkResult.ok) {
      notify("Instagram", linkResult.reason || "Lien non ajouté", "warn");
    } else if (!linkResult.skipped) {
      notify("Instagram", `Lien ajouté: ${linkTitle || linkUrl}`, "info");
    }
  }

  lastCredentials = {
    rtmpUrl,
    streamKey,
    title: cleanTitle,
    linkUrl: linkUrl || "",
    linkTitle: linkTitle || "",
    link: linkResult,
    at: Date.now(),
    page: "stream-creds",
    ...meta,
  };

  notify(
    "Instagram",
    `Page URL/clé OK — nouvelle clé …${streamKey.slice(-6)}`,
    "info",
  );
  pushToWindows({ type: "instagram-credentials", ...lastCredentials });

  // Push Aitum dès l’arrivée sur cette page (pas avant)
  const aitumPush = await pushCredsToAitum(lastCredentials, options);
  lastCredentials.aitumPush = aitumPush;

  if (options.autoGoLive !== false) {
    watchAndGoLive(options.goLiveTimeoutMs || 300000);
  }

  return {
    ok: true,
    platform: "instagram",
    ...lastCredentials,
    aitumPush,
    windowKeptOpen: true,
    note: "Page URL du stream — clé poussée vers Aitum",
  };
}

async function prepareLiveOnce(title, options = {}) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) {
    return { ok: false, reason: "Titre vide pour Instagram" };
  }

  if (options.cameraDeviceId || options.cameraDeviceLabel || options.videoDeviceId) {
    setCameraPreference({
      deviceId: options.cameraDeviceId || options.videoDeviceId,
      deviceLabel: options.cameraDeviceLabel || options.videoDeviceLabel || "OBS Virtual Camera",
    });
  }

  // Ne jamais repartir d’une ancienne clé en mémoire / config
  let previousKey = String(
    lastCredentials?.streamKey || options.instagramConfig?.streamKey || "",
  ).trim();
  lastCredentials = null;
  notify(
    "Instagram",
    "Préparation — attente page « URL du stream / Clé de stream »…",
    "info",
  );
  await openProducer();
  // Patch CDP + forçage caméra AVANT que IG ouvre le preview
  await registerCamScriptOnNewDocument(win);
  await installCameraPreference(win);
  await sleep(500);

  // Ferme le modal « Ajouter un lien » s'il traîne (bloque le scrape / Go Live)
  await evalInPage(`async function dismissLinkModal() {
    const dialog = [...document.querySelectorAll("[role='dialog']")].find((d) =>
      /ajouter un lien|add a link/i.test(d.innerText || ""),
    );
    if (!dialog) return { ok: true, skipped: true };
    const btn = [...dialog.querySelectorAll("button, div[role='button']")].find((el) => {
      const t = (el.innerText || "").trim().toLowerCase();
      return t === "terminé" || t === "done";
    });
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 800));
    return { ok: true, dismissed: true };
  }`);

  let detect = await evalInPage(DETECT_PAGE_FN);

  // DÉJÀ sur « URL du stream / Clé de stream » → scrap immédiat + push OBS (ne pas quitter la page)
  {
    let now = await evalInPage(SCRAPE_CREDS_FN);
    if (!now?.ok) {
      // retry court: IG remplit parfois les inputs après le paint
      for (let i = 0; i < 8 && !now?.ok; i += 1) {
        await sleep(400);
        now = await evalInPage(SCRAPE_CREDS_FN);
      }
    }
    if (now?.ok && now.rtmpUrl && now.streamKey) {
      // Optionnel: Réinitialiser seulement si demandé et bouton présent
      if (options.forceNewKey) {
        const reset = await evalInPage(RESET_STREAM_KEY_FN, now.streamKey);
        if (reset?.ok && reset.changed && reset.streamKey) {
          now = {
            ok: true,
            rtmpUrl: reset.rtmpUrl || now.rtmpUrl,
            streamKey: reset.streamKey,
            page: "stream-creds",
          };
        }
      }
      notify(
        "Instagram",
        `Clé récupérée sur la page (…${now.streamKey.slice(-6)}) → OBS`,
        "info",
      );
      return finalizeStreamCreds(now, cleanTitle, options, {
        via: "stream-creds-now",
        refreshedKey: Boolean(options.forceNewKey),
      });
    }
  }

  if (detect.state === "login") {
    notify(
      "Instagram",
      "Connecte-toi dans CETTE fenêtre uniquement (pas Chrome à côté), puis attends… La session sera mémorisée.",
      "warn",
    );
    const deadline = Date.now() + (options.loginTimeoutMs || 300000);
    while (Date.now() < deadline) {
      await sleep(2000);
      detect = await evalInPage(DETECT_PAGE_FN);
      if (detect.state !== "login") break;
    }
    if (detect.state === "login") {
      return { ok: false, reason: "Toujours sur la page login Instagram", needLogin: true };
    }
    // Login OK → écrire les cookies sur disque tout de suite
    await flushSession(getIgSession());
    notify("Instagram", "Session enregistrée — plus besoin de te reconnecter si le hub reste seul", "info");
  }

  // Nav fiable: Créer → Vidéo en direct (retries + aria)
  const OPEN_LIVE_MENU_FN = `async function openLiveMenu() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const hasTitle = () => [...document.querySelectorAll("input,textarea")].some((el) =>
      /ajoutez un titre|add a title|titre|title/i.test((el.placeholder || "") + " " + (el.getAttribute("aria-label") || "")),
    );
    if (hasTitle()) return { ok: true, already: true };

    const clickExact = (label) => {
      const want = String(label).toLowerCase();
      const el = [...document.querySelectorAll("a,button,div[role='button'],span,div")].find((n) => {
        const t = (n.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
        return t === want;
      });
      if (el) { el.click(); return true; }
      return false;
    };
    const clickAria = (re) => {
      const el = [...document.querySelectorAll("[aria-label]")].find((n) =>
        re.test(n.getAttribute("aria-label") || ""),
      );
      if (el) { el.click(); return (el.getAttribute("aria-label") || "").slice(0, 40); }
      return null;
    };

    let created =
      clickExact("créer") ||
      clickExact("create") ||
      clickAria(/nouvelle publication|new post|créer|create/i);
    if (!created) {
      const nodes = [...document.querySelectorAll("a,button,div[role='button'],span")];
      for (const el of nodes) {
        const c = (el.innerText || "").replace(/\\s+/g, "").toLowerCase();
        if (c.includes("nouvellepublication") || c.includes("newpost")) {
          el.click();
          created = "nouvellepublication";
          break;
        }
      }
    }
    await sleep(1600);

    let live =
      clickExact("vidéo en direct") ||
      clickExact("live video") ||
      clickAria(/vidéo en direct|live video|diffusion en direct/i);
    if (!live) {
      const nodes = [...document.querySelectorAll("button,div[role='button'],span,div,a")];
      for (const want of ["vidéo en direct", "live video", "diffusion en direct", "en direct"]) {
        const el = nodes.find((n) => {
          const t = (n.innerText || n.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().toLowerCase();
          return t === want || t.includes(want);
        });
        if (el) { el.click(); live = want; break; }
      }
    }
    await sleep(2800);
    return { ok: true, created: Boolean(created), live: Boolean(live), hasTitle: hasTitle() };
  }`;

  let menu = await evalInPage(OPEN_LIVE_MENU_FN);
  // IG ouvre souvent la webcam ici → re-force la caméra choisie
  await installCameraPreference(win);
  await sleep(400);
  // Remplir titre + Suivant
  let fill = await evalInPage(FILL_TITLE_FN, cleanTitle);
  if (!fill.ok && fill.needLogin) {
    return { ok: false, reason: "Login Instagram requis", needLogin: true };
  }
  if (!fill.ok && !fill.alreadyCredentials) {
    await sleep(1500);
    menu = await evalInPage(OPEN_LIVE_MENU_FN);
    await sleep(800);
    fill = await evalInPage(FILL_TITLE_FN, cleanTitle);
  }
  if (!fill.ok && !fill.alreadyCredentials) {
    await sleep(2000);
    menu = await evalInPage(OPEN_LIVE_MENU_FN);
    await sleep(1200);
    fill = await evalInPage(FILL_TITLE_FN, cleanTitle);
  }
  if (!fill.ok && !fill.alreadyCredentials) {
    notify("Instagram", fill.reason || "Échec formulaire titre", "warn");
    return { ok: false, reason: fill.reason || "Échec titre", step: "title" };
  }

  // Après Suivant : souvent un choix "Logiciel de streaming" / RTMP avant la clé
  await evalInPage(`async function openStreamingSoftware() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const patterns = [
      /logiciel de streaming/i,
      /streaming software/i,
      /utiliser un logiciel/i,
      /use streaming software/i,
      /broadcasting software/i,
      /obs/i,
      /rtmp/i,
    ];
    const nodes = [...document.querySelectorAll("button, div[role='button'], a, span, div, label")];
    for (const el of nodes) {
      const t = ((el.innerText || "") + " " + (el.getAttribute("aria-label") || "")).replace(/\\s+/g, " ").trim();
      if (!t || t.length > 80) continue;
      if (patterns.some((p) => p.test(t))) {
        el.click();
        await sleep(1200);
        return { ok: true, clicked: t.slice(0, 50) };
      }
    }
    // Parfois un onglet "Plus d'options" / Advanced
    for (const el of nodes) {
      const t = (el.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
      if (t === "plus d'options" || t === "more options" || t.includes("advanced")) {
        el.click();
        await sleep(900);
        break;
      }
    }
    for (const el of [...document.querySelectorAll("button, div[role='button'], a, span, div")]) {
      const t = ((el.innerText || "") + " " + (el.getAttribute("aria-label") || "")).replace(/\\s+/g, " ").trim();
      if (/logiciel de streaming|streaming software|rtmp/i.test(t) && t.length < 80) {
        el.click();
        await sleep(1200);
        return { ok: true, clicked: t.slice(0, 50) };
      }
    }
    return { ok: false, reason: "option logiciel introuvable" };
  }`);

  // Attendre UNIQUEMENT la page « URL du stream » + « Clé de stream » (pas avant)
  notify("Instagram", "Attente page URL du stream / Clé de stream…", "info");
  let creds = null;
  for (let i = 0; i < 60; i += 1) {
    await sleep(700);
    if (i === 2 || i === 8 || i === 16 || i === 28) {
      await evalInPage(`async function openStreamingSoftware() {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const nodes = [...document.querySelectorAll("button, div[role='button'], a, span, div, label")];
        for (const el of nodes) {
          const t = ((el.innerText || "") + " " + (el.getAttribute("aria-label") || "")).replace(/\\s+/g, " ").trim();
          if (/logiciel de streaming|streaming software|utiliser un logiciel|rtmp|obs/i.test(t) && t.length < 80) {
            el.click();
            await sleep(1000);
            return { ok: true, clicked: t.slice(0, 50) };
          }
        }
        return { ok: false };
      }`);
    }
    creds = await evalInPage(SCRAPE_CREDS_FN);
    if (creds.ok && creds.rtmpUrl && creds.streamKey && creds.page === "stream-creds") break;
  }

  if (!creds?.ok || !creds.rtmpUrl || !creds.streamKey) {
    notify(
      "Instagram",
      "Pas encore sur « URL du stream / Clé de stream » — garde Live Producer ouvert",
      "warn",
    );
    return {
      ok: false,
      reason:
        "Arrive d’abord sur la page URL du stream + Clé de stream (Connectez le logiciel…)",
      step: "credentials",
      title: cleanTitle,
      waitingFor: "stream-creds",
    };
  }

  // Sécurité: si la clé scrapée = ancienne, forcer Réinitialiser ou échec
  if (previousKey && creds.streamKey === previousKey) {
    notify("Instagram", "Clé identique à l’ancienne — reset forcé…", "warn");
    const reset = await evalInPage(RESET_STREAM_KEY_FN, previousKey);
    if (reset?.ok && reset.changed && reset.streamKey && reset.streamKey !== previousKey) {
      // Re-scrape uniquement sur la page clés
      for (let i = 0; i < 15; i += 1) {
        await sleep(500);
        const again = await evalInPage(SCRAPE_CREDS_FN);
        if (again?.ok && again.streamKey && again.streamKey !== previousKey) {
          creds = again;
          break;
        }
      }
    }
    if (previousKey && creds.streamKey === previousKey) {
      return {
        ok: false,
        reason:
          "Toujours l’ancienne clé — ferme ce live IG puis relance Préparer (nouveau direct)",
        step: "credentials",
        oldKeyTail: previousKey.slice(-6),
      };
    }
  }

  return finalizeStreamCreds(creds, cleanTitle, options, { via: "create-live" });
}

/**
 * Parcours complet : login si besoin, titre, Suivant, scrape URL+clé.
 * Sérialisé : un seul prepare à la fois, une seule fenêtre.
 */
async function prepareLive(title, options = {}) {
  if (prepareLock) {
    notify("Instagram", "Préparation déjà en cours — réutilise la même fenêtre", "info");
    return prepareLock;
  }
  prepareLock = prepareLiveOnce(title, options).finally(() => {
    prepareLock = null;
  });
  return prepareLock;
}

const SCRAPE_IG_LIVE_URL_FN = `async function scrapeIgLiveUrl(preferredUser) {
  const out = { ok: false, liveUrl: "", liveId: "", username: "", via: "" };
  const prefer = String(preferredUser || "").replace(/^@/, "").trim().toLowerCase();
  const add = (href, via) => {
    if (!href || typeof href !== "string") return;
    let u = href.split("#")[0];
    if (!/instagram\\.com/i.test(u)) return;
    // https://www.instagram.com/username/live/  or /live/123
    const liveUser = u.match(/instagram\\.com\\/([A-Za-z0-9._]+)\\/live\\/?/i);
    const liveId = u.match(/\\/live\\/(\\d{5,})/i) || u.match(/[?&](?:media_id|broadcast_id)=(\\d+)/i);
    if (liveUser || /\\/live\\b/i.test(u)) {
      out.liveUrl = u.endsWith("/") ? u : (u.includes("?") ? u : u + "/");
      if (liveUser) out.username = liveUser[1];
      if (liveId) out.liveId = liveId[1];
      out.via = via;
      out.ok = true;
    }
  };
  add(location.href, "location");
  for (const a of document.querySelectorAll("a[href]")) add(a.href, "anchor");
  for (const el of document.querySelectorAll("input, textarea")) {
    const v = (el.value || "").trim();
    if (/instagram\\.com/i.test(v)) add(v, "input");
  }
  // Profil dans la barre / avatar
  if (!out.ok) {
    const prof = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "")
      .find((h) => /^\\/[A-Za-z0-9._]+\\/?$/.test(h) && !/\\/(explore|reels|direct|accounts)\\b/i.test(h));
    const user = prefer || (prof ? prof.replace(/\\//g, "") : "");
    if (user) {
      out.username = user;
      out.liveUrl = "https://www.instagram.com/" + user + "/live/";
      out.via = prefer ? "preferredUser" : "profileHref";
      out.ok = true;
    }
  }
  return out;
}`;

async function capturePublicLiveUrl(instagramConfig = {}) {
  const prefer =
    instagramConfig.username ||
    lastCredentials?.username ||
    "";
  let scraped = { ok: false };
  try {
    if (win && !win.isDestroyed()) {
      scraped = await evalInPage(SCRAPE_IG_LIVE_URL_FN, prefer);
    }
  } catch {
    scraped = { ok: false };
  }
  // Fallback username config → /live/
  if ((!scraped?.ok || !scraped.liveUrl) && prefer) {
    const user = String(prefer).replace(/^@/, "");
    scraped = {
      ok: true,
      liveUrl: `https://www.instagram.com/${user}/live/`,
      username: user,
      via: "config-username",
    };
  }
  if (scraped?.ok && scraped.liveUrl) {
    try {
      const { persistPlatformLiveUrl } = require("../persist-live-url");
      persistPlatformLiveUrl("instagram", {
        liveUrl: scraped.liveUrl,
        liveId: scraped.liveId || "",
      });
    } catch {
      /* optional */
    }
    if (lastCredentials) {
      lastCredentials.liveUrl = scraped.liveUrl;
      lastCredentials.liveId = scraped.liveId || "";
      if (scraped.username) lastCredentials.username = scraped.username;
    }
  }
  return scraped;
}

async function finishGoLiveOk(res) {
  notify("Instagram", "Direct Instagram lancé", "info");
  let igCfg = {};
  try {
    igCfg = require("../config").loadConfig().platforms?.instagram || {};
  } catch {
    /* optional */
  }
  await sleep(3500);
  let liveMeta = await capturePublicLiveUrl(igCfg);
  if (!liveMeta?.ok) {
    await sleep(4000);
    liveMeta = await capturePublicLiveUrl(igCfg);
  }
  if (liveMeta?.username && igCfg && !igCfg.username) {
    try {
      const { loadConfig, saveConfig } = require("../config");
      const cfg = loadConfig();
      cfg.platforms.instagram = {
        ...(cfg.platforms.instagram || {}),
        username: liveMeta.username,
        profileUrl: `https://www.instagram.com/${liveMeta.username}/`,
      };
      saveConfig(cfg);
    } catch {
      /* optional */
    }
  }
  pushToWindows({
    type: "instagram-go-live",
    ok: true,
    liveUrl: liveMeta?.liveUrl || "",
    liveId: liveMeta?.liveId || "",
  });
  return { ...res, liveUrl: liveMeta?.liveUrl || "", liveId: liveMeta?.liveId || "" };
}

async function goLive({ waitForReady = false, timeoutMs = 180000, probePreview = false } = {}) {
  if (!win || win.isDestroyed()) {
    return { ok: false, reason: "Fenêtre Live Producer fermée" };
  }
  if (!waitForReady) {
    const res = await evalInPage(CLICK_GO_LIVE_FN, false);
    if (res.ok) return finishGoLiveOk(res);
    notify("Instagram", res.reason || "Go Live échoué", "warn");
    return res;
  }
  notify("Instagram", "Attente flux / bouton Lancer un direct…", "info");
  const deadline = Date.now() + timeoutMs;
  let lastReason = "";
  while (Date.now() < deadline) {
    if (!win || win.isDestroyed()) return { ok: false, reason: "fenêtre fermée" };
    const probe = await evalInPage(CLICK_GO_LIVE_FN, true);
    lastReason = probe.reason || lastReason;
    if (probe.ready) {
      if (probePreview) {
        notify("Instagram", "Preview OK — lancement du direct…", "info");
      }
      const res = await evalInPage(CLICK_GO_LIVE_FN, false);
      if (res.ok) return finishGoLiveOk(res);
      lastReason = res.reason || lastReason;
    }
    await sleep(2500);
  }
  return { ok: false, reason: lastReason || "Timeout: Lancer un direct toujours inactif (flux RTMP ?)" };
}

let goLiveWatcher = null;
function watchAndGoLive(timeoutMs = 300000) {
  // Respecte le garde-fou global
  try {
    const { isAutoGoLiveEnabled } = require("../go-live-pipeline");
    if (!isAutoGoLiveEnabled()) {
      notify("Instagram", "Auto Go Live OFF (garde-fou) — bouton manuel requis", "info");
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
        notify("Instagram", "Timeout attente Go Live", "warn");
        return;
      }
      const probe = await evalInPage(CLICK_GO_LIVE_FN, true);
      if (!probe.ready) return;
      const res = await evalInPage(CLICK_GO_LIVE_FN, false);
      if (res.ok) {
        clearInterval(goLiveWatcher);
        goLiveWatcher = null;
        await finishGoLiveOk(res);
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
 * Termine le direct IG via Live Producer. Ne coupe PAS OBS.
 */
async function endBroadcast() {
  if (goLiveWatcher) {
    clearInterval(goLiveWatcher);
    goLiveWatcher = null;
  }
  // Rouvre le Producer si fermé — sinon on ne peut pas cliquer Terminer
  if (!win || win.isDestroyed()) {
    notify("Instagram", "Réouverture Live Producer pour terminer le direct…", "info");
    const opened = await openProducer();
    if (!opened?.ok || !win || win.isDestroyed()) {
      return {
        ok: false,
        reason: "Impossible d’ouvrir Live Producer IG — ouvre-le manuellement pendant le live",
      };
    }
    await sleep(2000);
  } else {
    win.show();
    win.focus();
  }

  try {
    let res = await evalInPage(END_LIVE_FN, false);
    if (!res?.ok) {
      await sleep(1200);
      res = await evalInPage(END_LIVE_FN, false);
    }
    if (res?.ok) {
      notify("Instagram", "Direct terminé (OBS non coupé)", "info");
      pushToWindows({ type: "instagram-end-live", ok: true });
    } else {
      notify(
        "Instagram",
        res?.reason || "Impossible de terminer — clique Terminer dans la fenêtre IG",
        "warn",
      );
    }
    return res || { ok: false, reason: "échec end live IG" };
  } catch (err) {
    return { ok: false, reason: err.message || "échec end live IG" };
  }
}

/**
 * Réapplique la préférence caméra sur le Producer ouvert.
 * Mid-live: Meta verrouille souvent le device — changer la source dans OBS/Aitum
 * (toujours « OBS Virtual Camera ») met à jour l’image sans changer de device IG.
 */
async function applyCameraPreferenceNow(pref = {}) {
  setCameraPreference(pref);
  if (!win || win.isDestroyed()) {
    return {
      ok: true,
      saved: true,
      applied: false,
      reason: "Préférence sauvée — sera utilisée au prochain Préparer IG",
      tip: "Pendant un live: change la source dans OBS/Aitum Vertical — IG garde OBS Virtual Camera",
    };
  }
  try {
    const patch = await installCameraPreference(win);
    // Force un nouvel enum + hint UI (Meta n’appelle pas toujours getUserMedia à nouveau)
    const force = await win.webContents.executeJavaScript(
      `(async function () {
        try {
          const media = navigator.mediaDevices;
          if (!media) return { ok: false };
          const list = await media.enumerateDevices();
          const vids = list.filter((d) => d.kind === "videoinput").map((d) => d.label);
          return {
            ok: true,
            videoLabels: vids,
            tip: "Si le live est déjà lancé, change la scène/source OBS — VirtualCam suit",
          };
        } catch (e) {
          return { ok: false, reason: e.message };
        }
      })()`,
      true,
    );
    notify(
      "Instagram",
      "Caméra préférée mise à jour. Mid-live: bascule la source dans OBS/Aitum (VirtualCam).",
      "info",
    );
    return {
      ok: true,
      saved: true,
      applied: true,
      patch,
      force,
      tip: "Mid-live: change la source dans OBS/Aitum — pas besoin de changer le device IG",
    };
  } catch (err) {
    return { ok: false, reason: err.message || "échec apply caméra" };
  }
}

const UPDATE_TITLE_ONLY_FN = `async function updateTitleOnly(title) {
  const want = String(title || "").trim();
  if (!want) return { ok: false, reason: "titre vide" };
  const setReact = (el, value) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    el.focus();
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const clickOpen = () => {
    const nodes = [...document.querySelectorAll("button, div[role='button'], a, span")];
    for (const el of nodes) {
      const t = ((el.innerText || "") + " " + (el.getAttribute("aria-label") || "")).replace(/\\s+/g, " ").trim().toLowerCase();
      if (!t || t.length > 60) continue;
      if (/modifier|edit|détails|details|titre|title|ajouter des informations|add details|info/.test(t)
          && !/lancer un direct|go live|suivant|next|partager|share/.test(t)) {
        el.click();
        return t.slice(0, 40);
      }
    }
    return null;
  };
  let inputs = [...document.querySelectorAll("input, textarea")];
  let titleEl = inputs.find((el) => {
    const ph = (el.placeholder || "").toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    return /titre|title|ajoutez un titre|add a title/.test(ph + " " + aria);
  });
  if (!titleEl) {
    clickOpen();
    await new Promise((r) => setTimeout(r, 1000));
    inputs = [...document.querySelectorAll("input, textarea")];
    titleEl = inputs.find((el) => {
      const ph = (el.placeholder || "").toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      return /titre|title|ajoutez un titre|add a title/.test(ph + " " + aria);
    });
  }
  if (!titleEl) {
    titleEl = inputs.find((el) => {
      if (el.offsetParent === null) return false;
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return (el.tagName === "TEXTAREA" || type === "text") && !/^rtmps?:/i.test(el.value || "");
    });
  }
  if (!titleEl) return { ok: false, reason: "champ titre IG introuvable — reviens à l’écran infos / Modifier" };
  setReact(titleEl, want);
  return { ok: true, title: want };
}`;

const ENSURE_LIVE_UI_FN = `async function ensureLiveUi() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hasTitle = () => [...document.querySelectorAll("input,textarea")].some((el) =>
    /ajoutez un titre|add a title|titre|title/i.test((el.placeholder || "") + " " + (el.getAttribute("aria-label") || "")),
  );
  const body = ((document.body && document.body.innerText) || "").toLowerCase();
  // Déjà en direct / écran infos → champs souvent déjà là
  if (hasTitle()) return { ok: true, already: true };
  if (/en direct|live now|terminer le direct|end live/.test(body) && hasTitle()) {
    return { ok: true, alreadyLive: true };
  }

  const clickExact = (label) => {
    const want = String(label).toLowerCase();
    const el = [...document.querySelectorAll("a,button,div[role='button'],span,div")].find((n) => {
      const t = (n.innerText || "").replace(/\\s+/g, " ").trim().toLowerCase();
      return t === want;
    });
    if (el) { el.click(); return true; }
    return false;
  };
  const clickAria = (re) => {
    const el = [...document.querySelectorAll("[aria-label]")].find((n) =>
      re.test(n.getAttribute("aria-label") || ""),
    );
    if (el) { el.click(); return true; }
    return false;
  };

  // Si un live tourne: ouvrir détails / modifier plutôt que Créer un nouveau
  let edited =
    clickExact("modifier les détails") ||
    clickExact("edit details") ||
    clickExact("détails") ||
    clickAria(/modifier|edit details|détails/i);
  if (edited) {
    await sleep(1200);
    if (hasTitle()) return { ok: true, via: "edit-details" };
  }

  let created =
    clickExact("créer") ||
    clickExact("create") ||
    clickAria(/nouvelle publication|new post|créer|create/i);
  await sleep(1400);
  let live =
    clickExact("vidéo en direct") ||
    clickExact("live video") ||
    clickAria(/vidéo en direct|live video|diffusion en direct/i);
  if (!live) {
    const nodes = [...document.querySelectorAll("button,div[role='button'],span,div,a")];
    for (const want of ["vidéo en direct", "live video", "diffusion en direct", "en direct"]) {
      const el = nodes.find((n) => {
        const t = (n.innerText || n.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().toLowerCase();
        return t === want || t.includes(want);
      });
      if (el) { el.click(); live = want; break; }
    }
  }
  await sleep(2400);
  return { ok: true, created: Boolean(created), live: Boolean(live), hasTitle: hasTitle() };
}`;

async function ensureProducerReady({ autoOpen = true } = {}) {
  if (win && !win.isDestroyed()) {
    win.show();
    return { ok: true, reused: true };
  }
  if (!autoOpen) {
    return {
      ok: false,
      skipped: true,
      reason: "Live Producer IG fermé — ouvre/prépare d’abord",
    };
  }
  notify("Instagram", "Ouverture Live Producer pour maj titre/infos…", "info");
  const opened = await openProducer();
  if (!opened?.ok || !win || win.isDestroyed()) {
    return {
      ok: false,
      reason: opened?.reason || "Impossible d’ouvrir Live Producer IG",
    };
  }
  await sleep(1500);
  try {
    await evalInPage(ENSURE_LIVE_UI_FN);
    await sleep(800);
  } catch {
    /* optional */
  }
  return { ok: true, opened: true };
}

/** Met à jour le titre (ouvre le Producer si besoin, sans re-créer la clé). */
async function updateTitle({ title, autoOpen = true } = {}) {
  const ready = await ensureProducerReady({ autoOpen });
  if (!ready.ok) {
    return { ok: false, skipped: Boolean(ready.skipped), platform: "instagram", reason: ready.reason };
  }
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return { ok: false, platform: "instagram", reason: "Titre vide" };
  try {
    let meta = await evalInPage(UPDATE_TITLE_ONLY_FN, cleanTitle);
    if (!meta?.ok) {
      await evalInPage(ENSURE_LIVE_UI_FN);
      await sleep(900);
      meta = await evalInPage(UPDATE_TITLE_ONLY_FN, cleanTitle);
    }
    if (meta?.ok) notify("Instagram", `Titre live mis à jour: ${cleanTitle}`, "info");
    else {
      notify(
        "Instagram",
        meta?.reason || "Champ titre introuvable — reste sur l’écran Live Producer",
        "warn",
      );
    }
    return {
      ok: Boolean(meta?.ok),
      platform: "instagram",
      live: Boolean(meta?.ok),
      via: "producer",
      opened: Boolean(ready.opened),
      ...meta,
    };
  } catch (err) {
    return { ok: false, platform: "instagram", reason: err.message || "échec titre IG" };
  }
}

/** Pousse le lien sticky (ouvre le Producer si besoin). */
async function updateStickyLink({ linkUrl, linkTitle, autoOpen = true } = {}) {
  const ready = await ensureProducerReady({ autoOpen });
  if (!ready.ok) {
    return { ok: false, skipped: Boolean(ready.skipped), platform: "instagram", reason: ready.reason };
  }
  const url = String(linkUrl || "").trim();
  if (!url) return { ok: false, platform: "instagram", reason: "URL lien vide" };
  try {
    const linkResult = await evalInPage(ADD_LINK_FN, url, String(linkTitle || "").trim().slice(0, 30));
    if (linkResult?.ok) {
      notify("Instagram", `Lien live: ${linkTitle || url}`, "info");
      return {
        ok: true,
        platform: "instagram",
        live: true,
        via: "producer",
        opened: Boolean(ready.opened),
        linkResult,
      };
    }
    return {
      ok: false,
      platform: "instagram",
      reason: linkResult?.reason || "Lien non appliqué (modal Lien → Confirmer ?)",
      linkResult,
    };
  } catch (err) {
    return { ok: false, platform: "instagram", reason: err.message || "échec lien IG" };
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
  updateTitle,
  updateStickyLink,
  capturePublicLiveUrl,
  setCameraPreference,
  applyCameraPreferenceNow,
  installCameraPreference,
  PARTITION,
};
