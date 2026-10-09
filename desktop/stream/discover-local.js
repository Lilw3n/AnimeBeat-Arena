const fs = require("fs");
const path = require("path");
const os = require("os");

const HOME = os.homedir();

const DEFAULT_PATHS = {
  socialstreamExe: path.join(
    HOME,
    "AppData/Local/Programs/socialstream/socialstream.exe",
  ),
  socialstreamConfig: path.join(HOME, "AppData/Roaming/socialstream/config.json"),
  socialstreamSync: path.join(HOME, "AppData/Roaming/socialstream/savedSync.json"),
  streamerBotExe: path.join(
    HOME,
    "Downloads/Streamer.bot-x64-0.2.8/Streamer.bot.exe",
  ),
  streamerBotSettings: path.join(
    HOME,
    "Downloads/Streamer.bot-x64-0.2.8/data/settings.json",
  ),
  streamerBotActions: path.join(
    HOME,
    "Downloads/Streamer.bot-x64-0.2.8/data/actions.json",
  ),
  streamerBotObs: path.join(
    HOME,
    "Downloads/Streamer.bot-x64-0.2.8/data/obs.json",
  ),
  obsExe: "C:/Program Files/obs-studio/bin/64bit/obs64.exe",
  obsWebsocket: path.join(
    HOME,
    "AppData/Roaming/obs-studio/plugin_config/obs-websocket/config.json",
  ),
};

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    let text = fs.readFileSync(file, "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function discoverSsn() {
  const sync = readJson(DEFAULT_PATHS.socialstreamSync);
  const cfg = readJson(DEFAULT_PATHS.socialstreamConfig);
  const streamID =
    sync?.streamID ||
    cfg?.cachedStateBackup?.streamID ||
    cfg?.localStorageBackup?.streamID ||
    "";
  return {
    exe: fs.existsSync(DEFAULT_PATHS.socialstreamExe)
      ? DEFAULT_PATHS.socialstreamExe
      : "",
    sessionId: streamID || "",
    runningHint: Boolean(streamID),
  };
}

function discoverStreamerBot() {
  const settings = readJson(DEFAULT_PATHS.streamerBotSettings);
  const actionsFile = readJson(DEFAULT_PATHS.streamerBotActions);
  const actionNames = [];
  function walk(o) {
    if (!o || typeof o !== "object") return;
    if (
      typeof o.name === "string" &&
      o.name &&
      o.id &&
      Array.isArray(o.subActions)
    ) {
      actionNames.push({
        name: o.name,
        id: o.id,
        subCount: o.subActions.length,
      });
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  }
  walk(actionsFile);
  const uniqNames = [...new Set(actionNames.map((a) => a.name))];
  const setTitleAndGame =
    uniqNames.find((n) => n === "AnimeBeat Set Title Game") || "";
  const setGame =
    uniqNames.find((n) => n === "AnimeBeat Set Game") ||
    uniqNames.find((n) => /^ChangeGameName$/i.test(n)) ||
    "";
  const setTitle =
    uniqNames.find((n) => n === "AnimeBeat Set Title") ||
    uniqNames.find((n) => /title|titre/i.test(n) && /set|change|maj|animebeat/i.test(n)) ||
    "";

  // Port principal = websockets.port (Hello/API). 8080 = serveur SNS, souvent muet pour GetActions.
  return {
    exe: fs.existsSync(DEFAULT_PATHS.streamerBotExe)
      ? DEFAULT_PATHS.streamerBotExe
      : "",
    host: settings?.websockets?.address || "127.0.0.1",
    port: Number(settings?.websockets?.port || 4457),
    actions: uniqNames,
    actionDetails: actionNames,
    setGame,
    setTitle,
    setTitleAndGame,
  };
}

function discoverObs() {
  const ws = readJson(DEFAULT_PATHS.obsWebsocket);
  const sbObs = readJson(DEFAULT_PATHS.streamerBotObs);
  const sbConn = sbObs?.connections?.find((c) => c.default) || sbObs?.connections?.[0];
  return {
    exe: fs.existsSync(DEFAULT_PATHS.obsExe) ? DEFAULT_PATHS.obsExe : "",
    host: "127.0.0.1",
    port: Number(ws?.server_port || sbConn?.port || 4455),
    password: ws?.server_password || sbConn?.password || "",
    serverEnabled: ws?.server_enabled !== false,
  };
}

function discoverAll() {
  return {
    socialStreamNinja: discoverSsn(),
    streamerBot: discoverStreamerBot(),
    obs: discoverObs(),
    paths: DEFAULT_PATHS,
  };
}

/** Merge discovered values into hub config (only fill empty / default gaps). */
function applyDiscovery(config, discovered = discoverAll()) {
  const next = structuredClone(config);

  next.appPaths = {
    ...(next.appPaths || {}),
    socialstream: discovered.socialStreamNinja.exe || next.appPaths?.socialstream || "",
    streamerBot: discovered.streamerBot.exe || next.appPaths?.streamerBot || "",
    obs: discovered.obs.exe || next.appPaths?.obs || "",
  };

  next.socialStreamNinja = {
    ...(next.socialStreamNinja || {}),
    enabled: true,
    useAsHubChat: true,
    chatChannel: 4,
    sessionId:
      next.socialStreamNinja?.sessionId ||
      discovered.socialStreamNinja.sessionId ||
      "",
  };

  next.streamerBot = {
    ...(next.streamerBot || {}),
    enabled: true,
    host: discovered.streamerBot.host || next.streamerBot?.host || "127.0.0.1",
    // Always prefer the live main WS port from settings (4457 chez toi)
    port: discovered.streamerBot.port || next.streamerBot?.port || 4457,
    actions: {
      setTitle:
        discovered.streamerBot.setTitle ||
        next.streamerBot?.actions?.setTitle ||
        "AnimeBeat Set Title",
      setGame:
        discovered.streamerBot.setGame ||
        next.streamerBot?.actions?.setGame ||
        "AnimeBeat Set Game",
      setTitleAndGame:
        discovered.streamerBot.setTitleAndGame ||
        next.streamerBot?.actions?.setTitleAndGame ||
        "AnimeBeat Set Title Game",
    },
  };

  // Always prefer live OBS websocket plugin values when present
  if (discovered.obs.port) next.obs.port = discovered.obs.port;
  if (discovered.obs.password) next.obs.password = discovered.obs.password;
  if (discovered.obs.host) next.obs.host = discovered.obs.host;
  next.obs.enabled = true;

  return { config: next, discovered };
}

module.exports = {
  DEFAULT_PATHS,
  discoverAll,
  applyDiscovery,
};
