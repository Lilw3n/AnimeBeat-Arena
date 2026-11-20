/**
 * Éditeur de la config Aitum Stream Suite (aitum.json du profil OBS actif).
 * - Canvas : nom, résolution (largeur × hauteur)
 * - Sorties stream : canvas, encodeur (main / défaut du canvas / NVENC perso)
 * Les clés de stream ne quittent jamais ce module (jamais renvoyées à l'UI).
 * OBS réécrit aitum.json en quittant → on n'écrit QUE quand OBS est fermé ;
 * sinon la modif est mise en attente et appliquée dès que OBS se ferme.
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { notify, pushToWindows } = require("./notify");

const OBS_DIR = path.join(process.env.APPDATA || "", "obs-studio");

const ENCODERS = [
  { id: "obs_nvenc_h264_tex", label: "NVIDIA NVENC H.264" },
  { id: "obs_nvenc_hevc_tex", label: "NVIDIA NVENC HEVC" },
  { id: "obs_nvenc_av1_tex", label: "NVIDIA NVENC AV1" },
  { id: "obs_x264", label: "x264 (CPU)" },
];

let pending = null;
let pendingTimer = null;

function readIni(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  let section = "";
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const s = line.match(/^\[(.+)\]$/);
    if (s) {
      section = s[1];
      continue;
    }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (kv) out[`${section}.${kv[1].trim()}`] = kv[2].trim();
  }
  return out;
}

function getProfileDir() {
  const ini = { ...readIni(path.join(OBS_DIR, "global.ini")), ...readIni(path.join(OBS_DIR, "user.ini")) };
  const dir = ini["Basic.ProfileDir"] || "Sans_nom";
  return path.join(OBS_DIR, "basic", "profiles", dir);
}

function getAitumPath() {
  return path.join(getProfileDir(), "aitum.json");
}

function isObsRunning() {
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", "IMAGENAME eq obs64.exe", "/NH"], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(/obs64\.exe/i.test(String(stdout)));
    });
  });
}

function loadRaw() {
  const file = getAitumPath();
  if (!fs.existsSync(file)) throw new Error(`aitum.json introuvable (${file}) — Aitum Stream Suite installé ?`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function encoderModeOf(output) {
  const v = (output.video_encoders || [])[0] || {};
  if (output.advanced && v.output_video_encoder) return "reuse";
  if (output.advanced && v.video_encoder) return "custom";
  return "default";
}

/** Vue sans secrets pour l'UI. */
function summarize(d) {
  const canvases = [
    { name: "Main", main: true, width: null, height: null, note: "Résolution dans Paramètres OBS → Vidéo" },
    ...(d.canvas || []).map((c) => ({
      name: c.name,
      main: false,
      type: c.type || "",
      width: c.width ?? null,
      height: c.height ?? null,
      managed: c.width != null && c.height != null,
    })),
  ];
  const outputs = (d.outputs || []).map((o, index) => {
    const v = (o.video_encoders || [])[0] || {};
    const s = v.video_encoder_settings || {};
    return {
      index,
      name: o.name,
      type: o.type,
      enabled: o.enabled !== false,
      canvas: v.canvas || o.canvas || "Main",
      server: o.stream_server || "",
      hasKey: Boolean(String(o.stream_key || v.stream_key || "").trim()),
      encoderMode: encoderModeOf(o),
      encoder: v.video_encoder || "",
      bitrate: s.bitrate ?? null,
      preset: s.preset || "",
      keyint: s.keyint_sec ?? null,
      audioBitrate: o.audio_encoder_settings?.bitrate ?? null,
    };
  });
  return { canvases, outputs };
}

async function getState() {
  try {
    const d = loadRaw();
    return {
      ok: true,
      file: getAitumPath(),
      obsRunning: await isObsRunning(),
      pending: Boolean(pending),
      encoders: ENCODERS,
      ...summarize(d),
    };
  } catch (err) {
    return { ok: false, reason: err.message, encoders: ENCODERS, canvases: [], outputs: [] };
  }
}

function applyChanges(d, changes = {}) {
  const log = [];
  for (const c of changes.canvases || []) {
    const cv = (d.canvas || []).find((x) => x.name === c.name);
    if (!cv) continue;
    const w = Number(c.width);
    const h = Number(c.height);
    if (Number.isFinite(w) && Number.isFinite(h) && w >= 128 && h >= 128 && w <= 7680 && h <= 7680) {
      if (cv.width !== w || cv.height !== h) {
        cv.width = Math.round(w);
        cv.height = Math.round(h);
        log.push(`canvas ${cv.name} → ${cv.width}x${cv.height}`);
      }
    }
  }
  for (const o of changes.outputs || []) {
    const out = (d.outputs || [])[o.index];
    if (!out || out.name !== o.name || out.type !== "stream") continue;
    const canvas = String(o.canvas || "Main");
    out.canvas = canvas;
    if (!Array.isArray(out.video_encoders) || !out.video_encoders.length) {
      out.video_encoders = [{ enabled: true, type: "stream", name: out.name, scale_type: 3 }];
    }
    for (const v of out.video_encoders) {
      v.canvas = canvas;
      v.output_video_encoder = "";
      if (o.encoderMode === "custom") {
        v.video_encoder = o.encoder || "obs_nvenc_h264_tex";
        v.video_encoder_settings = {
          rate_control: "CBR",
          bitrate: Number(o.bitrate) || 6500,
          preset: o.preset || "p5",
          keyint_sec: Number(o.keyint) || 2,
          profile: "high",
        };
      } else {
        delete v.video_encoder;
        delete v.video_encoder_settings;
      }
    }
    out.advanced = o.encoderMode === "custom";
    out.audio_encoder = out.audio_encoder || "ffmpeg_aac";
    out.audio_encoder_settings = { ...(out.audio_encoder_settings || {}), bitrate: Number(o.audioBitrate) || 160 };
    log.push(
      `sortie ${out.name}: canvas ${canvas}, ${
        o.encoderMode === "custom" ? `${v0(out).video_encoder} ${o.bitrate || 6500} kbps` : "encodeur par défaut"
      }`,
    );
  }
  return log;
}

function v0(out) {
  return (out.video_encoders || [])[0] || {};
}

function writeWithBackup(changes) {
  const file = getAitumPath();
  const d = loadRaw();
  const log = applyChanges(d, changes);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  fs.copyFileSync(file, `${file}.avant-hub-${stamp}`);
  fs.writeFileSync(file, JSON.stringify(d, null, 4), "utf8");
  return { log, backup: `${file}.avant-hub-${stamp}` };
}

function warnMainDefault(changes) {
  return (changes.outputs || [])
    .filter((o) => o.encoderMode !== "custom" && String(o.canvas || "Main") === "Main")
    .map((o) => o.name);
}

async function save(changes = {}) {
  const mainWarn = warnMainDefault(changes);
  if (await isObsRunning()) {
    pending = changes;
    startPendingWatcher();
    notify("Canvas Aitum", "OBS ouvert — modif en attente, appliquée dès que tu fermes OBS", "info");
    return { ok: true, pending: true, mainWarn, reason: "OBS est ouvert : ferme OBS (Fichier → Quitter), la modif s'appliquera toute seule." };
  }
  try {
    const res = writeWithBackup(changes);
    notify("Canvas Aitum", res.log.join(" · ") || "Rien à changer", "info");
    return { ok: true, applied: true, mainWarn, ...res };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function cancelPending() {
  pending = null;
  if (pendingTimer) clearInterval(pendingTimer);
  pendingTimer = null;
  return { ok: true };
}

function startPendingWatcher() {
  if (pendingTimer) return;
  pendingTimer = setInterval(async () => {
    if (!pending) return cancelPending();
    if (await isObsRunning()) return;
    // laisser OBS finir d'écrire aitum.json
    await new Promise((r) => setTimeout(r, 3000));
    if (await isObsRunning()) return;
    const changes = pending;
    cancelPending();
    try {
      const res = writeWithBackup(changes);
      notify("Canvas Aitum", `Appliqué: ${res.log.join(" · ") || "rien"} — tu peux relancer OBS`, "info");
      pushToWindows({ type: "aitum-config-applied", ...res });
    } catch (err) {
      notify("Canvas Aitum", `Échec: ${err.message}`, "warn");
    }
  }, 2000);
}

module.exports = { getState, save, cancelPending, getAitumPath, ENCODERS };
