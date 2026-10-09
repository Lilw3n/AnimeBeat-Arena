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

async function setCustomRtmp(obsConfig, server, key) {
  const obs = await ensureConnected(obsConfig);
  await obs.call("SetStreamServiceSettings", {
    streamServiceType: "rtmp_custom",
    streamServiceSettings: {
      server: String(server),
      key: String(key),
      use_auth: false,
    },
  });
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

module.exports = {
  connect,
  disconnect,
  getStatus,
  applyTitleAndGame,
  setCurrentScene,
  switchSceneForScreenCount,
  setCustomRtmp,
  startStream,
  stopStream,
  getStreamStatus,
  saveReplayBuffer,
  listInputs,
  listScenes,
};
