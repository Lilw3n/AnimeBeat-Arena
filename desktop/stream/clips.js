const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { dialog } = require("electron");
const obsBridge = require("./obs-bridge");
const { getClipsDir } = require("./config");
const { notify } = require("./notify");

function resolveFfmpeg(config) {
  if (config.multistream?.ffmpegPath) return config.multistream.ffmpegPath;
  try {
    return require("@ffmpeg-installer/ffmpeg").path;
  } catch {
    return "ffmpeg";
  }
}

function runFfmpeg(ffmpegPath, args) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let err = "";
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("exit", (code) => resolve({ ok: code === 0, code, err }));
  });
}

async function createVariants(config, sourceFile) {
  const outDir = getClipsDir(config);
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.basename(sourceFile, path.extname(sourceFile));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ffmpegPath = resolveFfmpeg(config);
  const outputs = [];

  if (config.clips?.makeHorizontal !== false) {
    const dest = path.join(outDir, `${base}_${stamp}_16x9.mp4`);
    const r = await runFfmpeg(ffmpegPath, [
      "-y",
      "-i",
      sourceFile,
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      dest,
    ]);
    if (r.ok) outputs.push({ platform: "facebook/youtube", path: dest, ratio: "16:9" });
  }

  if (config.clips?.makeVertical !== false) {
    const dest = path.join(outDir, `${base}_${stamp}_9x16.mp4`);
    const r = await runFfmpeg(ffmpegPath, [
      "-y",
      "-i",
      sourceFile,
      "-vf",
      "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      dest,
    ]);
    if (r.ok) outputs.push({ platform: "instagram/tiktok", path: dest, ratio: "9:16" });
  }

  return outputs;
}

async function saveClipFromObs(config, parentWindow) {
  const replay = await obsBridge.saveReplayBuffer(config.obs);
  if (!replay.ok) {
    notify("Clip", replay.reason || "Active le Replay Buffer dans OBS", "warn");
    return { ok: false, reason: replay.reason };
  }

  notify("Clip", "Replay Buffer sauvé — sélectionne le fichier pour générer les variants", "info");

  const picked = await dialog.showOpenDialog(parentWindow || undefined, {
    title: "Choisir le replay OBS à convertir",
    properties: ["openFile"],
    filters: [{ name: "Vidéo", extensions: ["mp4", "mkv", "mov", "flv"] }],
  });

  if (picked.canceled || !picked.filePaths?.[0]) {
    return { ok: true, replaySaved: true, cancelledPick: true };
  }

  const outputs = await createVariants(config, picked.filePaths[0]);
  notify("Clips prêts", `${outputs.length} fichier(s) générés`, "info");
  return { ok: true, source: picked.filePaths[0], outputs };
}

module.exports = { saveClipFromObs, createVariants };
