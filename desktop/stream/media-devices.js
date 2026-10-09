/**
 * Liste les caméras : sonde Electron (contexte fichier sécurisé) + fallback DirectShow via ffmpeg.
 * Sur Windows, OBS / Aitum Vertical VCam = "OBS Virtual Camera" (déjà sur le PC — pas de nouveau flux).
 */
const { BrowserWindow, systemPreferences, app, session } = require("electron");
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

let cached = { at: 0, video: [], audio: [], note: "", partition: "", source: "" };
let keepAliveRegistered = false;
let permissionHooked = false;

const OBS_CAM_RE =
  /obs\s*virtual|obs[\s_-]*camera|virtual\s*cam|aitum|vertical\s*cam|caméra\s*virtuelle|camera\s*vertical/i;

function preventQuitOnEmptyWindows() {
  if (keepAliveRegistered) return;
  keepAliveRegistered = true;
  app.on("window-all-closed", () => {
    /* no app.quit() */
  });
}

function hookMediaPermissions(ses) {
  try {
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      if (
        permission === "media" ||
        permission === "camera" ||
        permission === "microphone" ||
        permission === "display-capture"
      ) {
        callback(true);
        return;
      }
      callback(false);
    });
    ses.setPermissionCheckHandler((_wc, permission) => {
      return (
        permission === "media" ||
        permission === "camera" ||
        permission === "microphone" ||
        permission === "display-capture"
      );
    });
  } catch {
    /* optional */
  }
  if (!permissionHooked) {
    permissionHooked = true;
    try {
      hookMediaPermissions(session.defaultSession);
    } catch {
      /* optional */
    }
  }
}

async function ensureMediaAccess() {
  try {
    if (process.platform === "win32") return true;
    if (systemPreferences?.askForMediaAccess) {
      const cam = await systemPreferences.askForMediaAccess("camera");
      const mic = await systemPreferences.askForMediaAccess("microphone");
      return cam || mic;
    }
  } catch {
    /* ignore */
  }
  return true;
}

function resolveFfmpegPath() {
  try {
    return require("@ffmpeg-installer/ffmpeg").path;
  } catch {
    /* ignore */
  }
  const candidates = [
    path.join(
      __dirname,
      "..",
      "node_modules",
      "@ffmpeg-installer",
      "win32-x64",
      "ffmpeg.exe",
    ),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "";
}

/** Liste DirectShow (Windows) — voit OBS Virtual Camera même si Electron rate. */
function listDshowVideoDevices() {
  if (process.platform !== "win32") return [];
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return [];
  try {
    const r = spawnSync(ffmpeg, ["-list_devices", "true", "-f", "dshow", "-i", "dummy"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 12000,
    });
    const text = `${r.stderr || ""}\n${r.stdout || ""}`;
    const lines = text.split(/\r?\n/);
    const out = [];
    let inVideo = false;
    for (const line of lines) {
      if (/DirectShow video devices/i.test(line)) {
        inVideo = true;
        continue;
      }
      if (/DirectShow audio devices/i.test(line)) {
        inVideo = false;
        continue;
      }
      if (!inVideo) continue;
      const m = line.match(/"([^"]+)"/);
      if (m?.[1]) {
        out.push({
          deviceId: `dshow:${m[1]}`,
          kind: "videoinput",
          label: m[1],
          groupId: "dshow",
          via: "ffmpeg-dshow",
          // ★ seulement OBS / Aitum (pas ByteCast « VirtualCamera »)
          isObsLike: /obs\s*virtual|aitum|vertical\s*cam/i.test(m[1]),
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function probeEnumerate(win) {
  await win.webContents.executeJavaScript(
    `navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then(s => { s.getTracks().forEach(t => t.stop()); return true; })
      .catch(() => false)`,
    true,
  );
  await new Promise((r) => setTimeout(r, 600));
  return win.webContents.executeJavaScript(
    `navigator.mediaDevices.enumerateDevices().then(list => list.map(d => ({
      deviceId: d.deviceId,
      kind: d.kind,
      label: d.label || "",
      groupId: d.groupId || "",
      via: "electron"
    })))`,
    true,
  );
}

function mergeVideoLists(electronVideo, dshowVideo) {
  const byLabel = new Map();
  for (const d of electronVideo || []) {
    const key = (d.label || d.deviceId || "").toLowerCase();
    if (key) byLabel.set(key, { ...d, via: d.via || "electron" });
  }
  for (const d of dshowVideo || []) {
    const key = (d.label || "").toLowerCase();
    if (!key) continue;
    if (!byLabel.has(key)) {
      byLabel.set(key, d);
    } else {
      // Garde deviceId Electron si présent (utilisable par getUserMedia)
      const prev = byLabel.get(key);
      byLabel.set(key, {
        ...prev,
        isObsLike: prev.isObsLike || d.isObsLike,
        dshowLabel: d.label,
        via: prev.deviceId && !String(prev.deviceId).startsWith("dshow:")
          ? prev.via
          : `${prev.via}+dshow`,
      });
    }
  }
  return [...byLabel.values()];
}

/**
 * @param {{ force?: boolean, partition?: string }} options
 */
async function listMediaDevices(options = {}) {
  const force = Boolean(options.force);
  const partition = String(options.partition || "").trim();
  const cacheKey = partition || "default";

  if (
    !force &&
    Date.now() - cached.at < 8000 &&
    cached.video.length &&
    cached.partition === cacheKey
  ) {
    return { ok: true, ...cached };
  }

  await ensureMediaAccess();
  preventQuitOnEmptyWindows();

  const ses = partition
    ? session.fromPartition(partition, { cache: true })
    : session.defaultSession;
  hookMediaPermissions(ses);

  const dshowVideo = listDshowVideoDevices();

  const win = new BrowserWindow({
    show: false,
    width: 160,
    height: 160,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  });

  let electronVideo = [];
  let electronAudio = [];
  try {
    // IMPORTANT: pas about:blank — Chromium n’énumère souvent aucune caméra hors contexte « sûr »
    const probeHtml = path.join(__dirname, "cam-probe.html");
    if (fs.existsSync(probeHtml)) {
      await win.loadFile(probeHtml);
    } else {
      await win.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent("<!doctype html><title>cam</title><body>ok</body>"),
      );
    }
    let devices = (await probeEnumerate(win)) || [];
    electronVideo = devices.filter((d) => d.kind === "videoinput");
    if (!electronVideo.length) {
      await new Promise((r) => setTimeout(r, 1200));
      devices = (await probeEnumerate(win)) || [];
      electronVideo = devices.filter((d) => d.kind === "videoinput");
    }
    electronAudio = devices
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({
        ...d,
        label: d.label?.trim() || `Micro ${i + 1}`,
      }));
  } catch {
    /* fallback dshow only */
  } finally {
    try {
      win.destroy();
    } catch {
      /* ignore */
    }
  }

  let video = mergeVideoLists(
    electronVideo.map((d, i) => ({
      ...d,
      label: d.label?.trim() || `Caméra ${i + 1}`,
      isObsLike: /obs\s*virtual|aitum|vertical\s*cam/i.test(d.label || ""),
    })),
    dshowVideo,
  );

  // Trie: OBS / Aitum en premier
  video.sort((a, b) => Number(Boolean(b.isObsLike)) - Number(Boolean(a.isObsLike)));

  const hasObs = video.some((d) => d.isObsLike);
  const note = !video.length
    ? "Aucune caméra (ni Electron ni DirectShow)"
    : hasObs
      ? electronVideo.length
        ? "OBS Virtual Camera détectée (PC) — réutilise ce périphérique, pas de nouveau flux"
        : "OBS Virtual Camera vue via DirectShow — sera choisie par nom dans Instagram"
      : "Caméras listées (pas d’OBS Virtual Camera — démarre Aitum Vertical VCam)";

  cached = {
    at: Date.now(),
    video,
    audio: electronAudio,
    note,
    partition: cacheKey,
    source: electronVideo.length ? "electron+dshow" : dshowVideo.length ? "dshow" : "none",
  };
  return { ok: true, ...cached };
}

function pickPreferredVideo(
  devices,
  {
    deviceId,
    deviceLabel,
    preferObsVirtualCamera = true,
    preferAitumVertical = false,
    allowDefaultFallback = false,
  } = {},
) {
  const list = devices || [];
  const needle = String(deviceLabel || "")
    .toLowerCase()
    .replace(/\s*★\s*$/g, "")
    .trim();

  // 1) ID Electron réel (pas dshow: — inutilisable par getUserMedia)
  if (deviceId && !String(deviceId).startsWith("dshow:")) {
    const hit = list.find((d) => d.deviceId === deviceId);
    if (hit) return hit;
  }
  // 2) Label exact puis partiel (choix utilisateur dans le hub)
  if (needle) {
    const exact = list.find((d) => (d.label || "").toLowerCase() === needle);
    if (exact) return exact;
    const partial = list.find((d) => (d.label || "").toLowerCase().includes(needle));
    if (partial) return partial;
  }
  // 3) OBS / Aitum si demandé (défaut hub)
  if (preferObsVirtualCamera || preferAitumVertical) {
    const ranked = [
      /obs\s*virtual\s*camera/i,
      /aitum|vertical/i,
      /obs\s*virtual/i,
      /virtual\s*cam/i,
    ];
    for (const re of ranked) {
      const hit = list.find((d) => re.test(d.label || ""));
      if (hit) return hit;
    }
  }
  // 4) Ne PAS prendre la webcam « par défaut » silencieusement
  if (allowDefaultFallback) return list[0] || null;
  return null;
}

module.exports = {
  listMediaDevices,
  pickPreferredVideo,
  listDshowVideoDevices,
  OBS_CAM_RE,
};
