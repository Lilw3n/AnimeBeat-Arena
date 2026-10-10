const OBSWebSocket = require("obs-websocket-js").default;
const { notify, pushToWindows } = require("./notify");

/** @type {import('obs-websocket-js').default | null} */
let client = null;
let connecting = false;
let lastStatus = { connected: false, message: "OBS déconnecté" };

function getStatus() {
  return { ...lastStatus };
}

function setStatus(connected, message) {
  lastStatus = { connected, message };
  pushToWindows({ type: "obs-status", ...lastStatus });
}

async function connect(obsConfig) {
  if (!obsConfig?.enabled) {
    setStatus(false, "OBS désactivé dans la config");
    return getStatus();
  }
  if (client && lastStatus.connected) return getStatus();
  if (connecting) return getStatus();
  connecting = true;

  try {
    if (!client) {
      client = new OBSWebSocket();
      client.on("ConnectionClosed", () => setStatus(false, "OBS déconnecté"));
      client.on("ConnectionError", () => setStatus(false, "Erreur connexion OBS"));
    }

    const url = `ws://${obsConfig.host || "127.0.0.1"}:${obsConfig.port || 4455}`;
    await client.connect(url, obsConfig.password || undefined);
    setStatus(true, "OBS connecté");
    notify("OBS", "Connecté via WebSocket", "info");
  } catch (err) {
    setStatus(false, err?.message || "Impossible de joindre OBS");
  } finally {
    connecting = false;
  }
  return getStatus();
}

async function disconnect() {
  if (!client) return;
  try {
    await client.disconnect();
  } catch {
    /* ignore */
  }
  setStatus(false, "OBS déconnecté");
}

async function ensureConnected(obsConfig) {
  if (!lastStatus.connected) await connect(obsConfig);
  if (!lastStatus.connected) throw new Error(lastStatus.message || "OBS non connecté");
  return client;
}

async function setTextSource(obsConfig, sourceName, text) {
  if (!sourceName) return { ok: false, reason: "source vide" };
  const obs = await ensureConnected(obsConfig);
  try {
    await obs.call("SetInputSettings", {
      inputName: sourceName,
      inputSettings: { text: String(text ?? "") },
      overlay: true,
    });
    return { ok: true, sourceName };
  } catch (err) {
    return { ok: false, sourceName, reason: err?.message || "SetInputSettings failed" };
  }
}

async function applyTitleAndGame(obsConfig, { title, game }) {
  const results = [];
  const titleSource = obsConfig.textSources?.title;
  const gameSource = obsConfig.textSources?.game;
  if (titleSource) results.push(await setTextSource(obsConfig, titleSource, title));
  if (gameSource) results.push(await setTextSource(obsConfig, gameSource, game));
  return results;
}

async function setCurrentScene(obsConfig, sceneName) {
  if (!sceneName) return { ok: false, reason: "scène vide" };
  const obs = await ensureConnected(obsConfig);
  await obs.call("SetCurrentProgramScene", { sceneName: String(sceneName) });
  return { ok: true, sceneName };
}

async function switchSceneForScreenCount(obsConfig, screenCount) {
  if (!obsConfig.autoSwitchSceneOnScreenCount) return { ok: true, skipped: true };
  const sceneName = obsConfig.screenScenes?.[String(screenCount)];
  if (!sceneName) return { ok: true, skipped: true, reason: "pas de scène mappée" };
  return setCurrentScene(obsConfig, sceneName);
}

/** true = ne jamais écraser Restream / destination OBS actuelle */
function shouldPreserveObsDestination(obsConfig = {}) {
  const mode = String(obsConfig.streamDestinationMode || "leave").toLowerCase();
  if (mode === "nginx" || mode === "force-nginx" || mode === "custom") return false;
  // défaut: leave / restream / preserve
  return true;
}

function looksLikeRestream(settings) {
  const type = String(settings?.streamServiceType || "").toLowerCase();
  const server = String(settings?.streamServiceSettings?.server || settings?.server || "").toLowerCase();
  const key = String(settings?.streamServiceSettings?.key || "").toLowerCase();
  if (/restream/.test(type)) return true;
  if (/restream\.io|restream\.live/.test(server)) return true;
  if (server && !/127\.0\.0\.1|localhost/.test(server) && !/nginx/.test(server)) {
    // destination externe (Restream, Twitch direct, etc.)
    return true;
  }
  void key;
  return false;
}

async function setCustomRtmp(obsConfig, server, key, { force = false } = {}) {
  if (!force && shouldPreserveObsDestination(obsConfig)) {
    const current = await getStreamServiceSettings(obsConfig).catch(() => null);
    notify(
      "OBS",
      "Destination OBS préservée (Restream) — pas de bascule vers nginx local",
      "info",
    );
    return {
      ok: true,
      skipped: true,
      preserved: true,
      reason: "streamDestinationMode=leave (Restream)",
      current,
    };
  }
  const obs = await ensureConnected(obsConfig);
  // Sauvegarde pour restauration éventuelle
  let previous = null;
  try {
    previous = await obs.call("GetStreamServiceSettings");
  } catch {
    /* optional */
  }
  await obs.call("SetStreamServiceSettings", {
    streamServiceType: "rtmp_custom",
    streamServiceSettings: {
      server: String(server),
      key: String(key),
      use_auth: false,
    },
  });
  return { ok: true, previous };
}

async function getStreamServiceSettings(obsConfig) {
  const obs = await ensureConnected(obsConfig);
  try {
    const res = await obs.call("GetStreamServiceSettings");
    return { ok: true, ...res, isRestreamLike: looksLikeRestream(res) };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}

async function restoreStreamService(obsConfig, previous) {
  if (!previous?.streamServiceType) {
    return { ok: false, reason: "pas de settings OBS à restaurer" };
  }
  const obs = await ensureConnected(obsConfig);
  await obs.call("SetStreamServiceSettings", {
    streamServiceType: previous.streamServiceType,
    streamServiceSettings: previous.streamServiceSettings || {},
  });
  notify("OBS", "Destination stream restaurée", "info");
  return { ok: true };
}

async function startStream(obsConfig) {
  const obs = await ensureConnected(obsConfig);
  await obs.call("StartStream");
  return { ok: true };
}

async function stopStream(obsConfig) {
  const obs = await ensureConnected(obsConfig);
  await obs.call("StopStream");
  return { ok: true };
}

async function getStreamStatus(obsConfig) {
  try {
    const obs = await ensureConnected(obsConfig);
    const status = await obs.call("GetStreamStatus");
    return { ok: true, ...status };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}

async function saveReplayBuffer(obsConfig) {
  const obs = await ensureConnected(obsConfig);
  try {
    await obs.call("SaveReplayBuffer");
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || "Replay Buffer indisponible" };
  }
}

async function listInputs(obsConfig) {
  const obs = await ensureConnected(obsConfig);
  const { inputs } = await obs.call("GetInputList");
  return inputs || [];
}

async function listScenes(obsConfig) {
  const obs = await ensureConnected(obsConfig);
  const { scenes } = await obs.call("GetSceneList");
  return scenes || [];
}

const AITUM_VENDOR = "aitum-vertical-canvas";

async function callAitumVendor(obsConfig, requestType, requestData = {}) {
  const obs = await ensureConnected(obsConfig);
  const res = await obs.call("CallVendorRequest", {
    vendorName: AITUM_VENDOR,
    requestType,
    requestData: requestData || {},
  });
  return res?.responseData || res || {};
}

/** Statut Aitum Vertical (plugin Vertical Canvas) via WebSocket vendor. */
async function getAitumVerticalStatus(obsConfig) {
  try {
    const data = await callAitumVendor(obsConfig, "status");
    return {
      ok: true,
      plugin: "aitum-vertical-canvas",
      virtualCamera: Boolean(data.virtual_camera ?? data.virtualCamera),
      streaming: Boolean(data.streaming),
      recording: Boolean(data.recording),
      raw: data,
    };
  } catch (err) {
    return {
      ok: false,
      plugin: "aitum-vertical-canvas",
      virtualCamera: false,
      reason: err?.message || "Aitum Vertical non joignable (plugin actif + OBS WS ?)",
    };
  }
}

/** Démarre la VirtualCam du canvas VERTICAL Aitum (icône caméra or dans OBS). */
async function startAitumVerticalVirtualCam(obsConfig) {
  try {
    const before = await getAitumVerticalStatus(obsConfig);
    if (before.ok && before.virtualCamera) {
      notify("Aitum Vertical", "Caméra verticale déjà ON", "info");
      return { ok: true, already: true, active: true, via: "aitum-vertical-canvas" };
    }
    await callAitumVendor(obsConfig, "start_virtual_camera");
    await new Promise((r) => setTimeout(r, 1500));
    const after = await getAitumVerticalStatus(obsConfig);
    const active = Boolean(after.virtualCamera || after.ok);
    notify(
      "Aitum Vertical",
      active
        ? "Caméra virtuelle verticale démarrée (pour Instagram / TikTok)"
        : "start_virtual_camera envoyé — clique Rafraîchir caméras",
      active ? "info" : "warn",
    );
    return {
      ok: true,
      active,
      via: "aitum-vertical-canvas",
      status: after,
    };
  } catch (err) {
    return {
      ok: false,
      active: false,
      via: "aitum-vertical-canvas",
      reason: err?.message || "Échec start_virtual_camera Aitum",
    };
  }
}

async function stopAitumVerticalVirtualCam(obsConfig) {
  try {
    await callAitumVendor(obsConfig, "stop_virtual_camera");
    return { ok: true, active: false, via: "aitum-vertical-canvas" };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}

/**
 * Met à jour une destination RTMP dans Aitum Vertical Settings → Streaming.
 * index = rang de la ligne (0 = première). Crée d’abord une ligne vide « Instagram » dans Aitum.
 *
 * Vendor: update_stream_server + update_stream_key
 * @see https://github.com/Aitum/obs-vertical-canvas (aitum-vertical-canvas)
 */
async function updateAitumStreamDestination(
  obsConfig,
  {
    streamServer,
    streamKey,
    index = 0,
    width = 1080,
    height = 1920,
  } = {},
) {
  const server = String(streamServer || "").trim().replace(/\/$/, "");
  const key = String(streamKey || "").trim();
  const idx = Number(index);
  if (!server) return { ok: false, reason: "streamServer Aitum vide" };
  if (!key) return { ok: false, reason: "streamKey Aitum vide" };
  if (!Number.isFinite(idx) || idx < 0) {
    return { ok: false, reason: "index Aitum invalide (0, 1, 2…)" };
  }

  try {
    const base = { index: idx, width: Number(width) || 1080, height: Number(height) || 1920 };
    const serverRes = await callAitumVendor(obsConfig, "update_stream_server", {
      ...base,
      stream_server: server,
    });
    const keyRes = await callAitumVendor(obsConfig, "update_stream_key", {
      ...base,
      stream_key: key,
    });
    const ok =
      serverRes?.success !== false &&
      keyRes?.success !== false &&
      !serverRes?.error &&
      !keyRes?.error;
    if (ok) {
      notify(
        "Aitum Vertical",
        `IG → slot #${idx}: ${server} · clé …${key.slice(-6)}`,
        "info",
      );
    } else {
      notify(
        "Aitum Vertical",
        serverRes?.error ||
          keyRes?.error ||
          `Échec maj slot #${idx} — crée une ligne Streaming vide dans Vertical Settings`,
        "warn",
      );
    }
    return {
      ok,
      index: idx,
      streamServer: server,
      streamKeyTail: key.slice(-8),
      serverRes,
      keyRes,
      via: "aitum-vertical-canvas",
    };
  } catch (err) {
    return {
      ok: false,
      reason: err?.message || "Échec update_stream_* Aitum (OBS WS + plugin Vertical ?)",
      via: "aitum-vertical-canvas",
    };
  }
}

/** Démarre le stream du canvas Vertical (toutes destinations enabled). */
async function startAitumStreaming(obsConfig) {
  try {
    await callAitumVendor(obsConfig, "start_streaming");
    notify("Aitum Vertical", "Start Streaming Vertical envoyé", "info");
    return { ok: true, via: "aitum-vertical-canvas" };
  } catch (err) {
    return { ok: false, reason: err?.message || "échec start_streaming Aitum" };
  }
}

async function stopAitumStreaming(obsConfig) {
  try {
    await callAitumVendor(obsConfig, "stop_streaming");
    return { ok: true, via: "aitum-vertical-canvas" };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}

/**
 * Pousse la clé Instagram fraîche (Live Producer) dans le slot Aitum Vertical.
 * mode server: "producer" = URL RTMP IG ; "stunnel" = rtmp://127.0.0.1:19351/rtmp
 */
async function pushInstagramKeyToAitum(obsConfig, igCreds = {}, aitumCfg = {}) {
  if (aitumCfg.enabled === false || aitumCfg.pushIgCredentials === false) {
    return { ok: true, skipped: true, reason: "push Aitum IG désactivé" };
  }
  const key = String(igCreds.streamKey || "").trim();
  if (!key) return { ok: false, reason: "pas de clé IG à pousser vers Aitum" };

  const mode = String(aitumCfg.serverMode || "producer").toLowerCase();
  let server =
    mode === "stunnel"
      ? String(aitumCfg.stunnelUrl || "rtmp://127.0.0.1:19351/rtmp").replace(/\/$/, "")
      : String(igCreds.rtmpUrl || aitumCfg.instagramRtmpUrl || "rtmps://live-upload.instagram.com:443/rtmp")
          .trim()
          .replace(/\/$/, "");

  return updateAitumStreamDestination(obsConfig, {
    streamServer: server,
    streamKey: key,
    index: aitumCfg.instagramOutputIndex ?? aitumCfg.outputIndex ?? 0,
    width: aitumCfg.width ?? 1080,
    height: aitumCfg.height ?? 1920,
  });
}

async function getVirtualCamStatus(obsConfig) {
  try {
    const obs = await ensureConnected(obsConfig);
    const status = await obs.call("GetVirtualCamStatus").catch(() => ({ outputActive: false }));
    const aitum = await getAitumVerticalStatus(obsConfig);
    const mainActive = Boolean(status?.outputActive);
    const aitumActive = Boolean(aitum.virtualCamera);
    return {
      ok: true,
      active: mainActive || aitumActive,
      mainVirtualCam: mainActive,
      aitumVertical: aitumActive,
      aitumOk: aitum.ok,
      aitumReason: aitum.reason,
      ...status,
    };
  } catch (err) {
    return { ok: false, active: false, reason: err?.message };
  }
}

/**
 * Pour Instagram: démarre d'abord Aitum Vertical VCam, puis VirtualCam OBS classique en secours.
 */
async function startVirtualCam(obsConfig, options = {}) {
  const preferAitum = options.preferAitum !== false;
  const results = { ok: false, aitum: null, main: null };

  if (preferAitum) {
    results.aitum = await startAitumVerticalVirtualCam(obsConfig);
    if (results.aitum.ok && results.aitum.active) {
      results.ok = true;
      results.active = true;
      results.via = "aitum-vertical-canvas";
      return results;
    }
  }

  try {
    const obs = await ensureConnected(obsConfig);
    const status = await obs.call("GetVirtualCamStatus").catch(() => ({ outputActive: false }));
    if (status?.outputActive) {
      results.main = { ok: true, already: true, active: true };
      results.ok = true;
      results.active = true;
      results.via = "obs-virtual-cam";
      notify("OBS", "VirtualCam OBS déjà ON", "info");
      return results;
    }
    await obs.call("StartVirtualCam");
    notify("OBS", "Caméra virtuelle OBS démarrée", "info");
    results.main = { ok: true, active: true };
    results.ok = true;
    results.active = true;
    results.via = "obs-virtual-cam";
    if (results.aitum && !results.aitum.ok) {
      results.note =
        "Aitum Vertical KO — VirtualCam OBS classique démarrée. Active le plugin Vertical Canvas.";
    }
    return results;
  } catch (err) {
    results.main = { ok: false, reason: err?.message };
    results.reason =
      results.aitum?.reason ||
      err?.message ||
      "Ni Aitum Vertical ni VirtualCam OBS n’ont démarré";
    notify("OBS", results.reason, "warn");
    return results;
  }
}

async function stopVirtualCam(obsConfig) {
  const obs = await ensureConnected(obsConfig);
  await stopAitumVerticalVirtualCam(obsConfig).catch(() => {});
  try {
    await obs.call("StopVirtualCam");
  } catch {
    /* optional */
  }
  return { ok: true, active: false };
}

module.exports = {
  connect,
  disconnect,
  getStatus,
  applyTitleAndGame,
  setCurrentScene,
  switchSceneForScreenCount,
  setCustomRtmp,
  getStreamServiceSettings,
  restoreStreamService,
  shouldPreserveObsDestination,
  looksLikeRestream,
  startStream,
  stopStream,
  getStreamStatus,
  saveReplayBuffer,
  listInputs,
  listScenes,
  getVirtualCamStatus,
  startVirtualCam,
  stopVirtualCam,
  getAitumVerticalStatus,
  startAitumVerticalVirtualCam,
  stopAitumVerticalVirtualCam,
  updateAitumStreamDestination,
  pushInstagramKeyToAitum,
  startAitumStreaming,
  stopAitumStreaming,
  callAitumVendor,
  AITUM_VENDOR,
};
