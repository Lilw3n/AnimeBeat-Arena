const { spawn } = require("child_process");
const path = require("path");
const NodeMediaServer = require("node-media-server");
const twitch = require("./platforms/twitch");
const kick = require("./platforms/kick");
const facebook = require("./platforms/facebook");
const instagram = require("./platforms/instagram");
const { notify, pushToWindows } = require("./notify");

let nms = null;
/** @type {Map<string, import('child_process').ChildProcess>} */
const relays = new Map();
let facebookSession = null;
/** Config live mutée (postPublish + applyInstagramDestination partagent la même ref) */
let activeConfig = null;
/** Dernière URL d'entrée OBS→relais (pour brancher IG à chaud avec une clé fraîche) */
let lastInputUrl = null;
let lastStatus = {
  running: false,
  ingestUrl: "",
  destinations: [],
  activeRelays: [],
  tiktokMode: "external_studio",
  message: "Multistream arrêté",
};

function resolveFfmpeg(config) {
  if (config.multistream?.ffmpegPath) return config.multistream.ffmpegPath;
  try {
    return require("@ffmpeg-installer/ffmpeg").path;
  } catch {
    return "ffmpeg";
  }
}

function getStatus() {
  return {
    ...lastStatus,
    activeRelays: [...relays.keys()],
    facebookSession,
  };
}

function publishStatus(extra = {}) {
  lastStatus = { ...lastStatus, ...extra };
  pushToWindows({ type: "multistream-status", ...getStatus() });
}

function collectDestinations(config, fbLive) {
  const list = [];
  const t = twitch.getRtmpDestination(config.platforms.twitch || {});
  if (t) list.push(t);
  const k = kick.getRtmpDestination(config.platforms.kick || {});
  if (k) list.push(k);
  const f = facebook.getRtmpDestination(config.platforms.facebook || {}, fbLive);
  if (f) list.push(f);
  const ig = instagram.getRtmpDestination(config.platforms.instagram || {});
  if (ig) list.push(ig);

  const yt = config.platforms.youtube;
  if (yt?.enabled && yt.streamKey) {
    const server = (yt.rtmpUrl || "rtmp://a.rtmp.youtube.com/live2").replace(/\/$/, "");
    list.push({ platform: "youtube", server, key: yt.streamKey, url: `${server}/${yt.streamKey}` });
  }

  const custom = config.platforms.custom;
  if (custom?.enabled && custom.streamKey && custom.rtmpUrl) {
    const server = custom.rtmpUrl.replace(/\/$/, "");
    list.push({
      platform: custom.label || "custom",
      server,
      key: custom.streamKey,
      url: `${server}/${custom.streamKey}`,
    });
  }

  return list;
}

function stopAllRelays() {
  for (const [name, proc] of relays.entries()) {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    relays.delete(name);
  }
}

function stopRelay(platform) {
  const proc = relays.get(platform);
  if (!proc) return false;
  try {
    proc.kill("SIGKILL");
  } catch {
    /* ignore */
  }
  relays.delete(platform);
  return true;
}

function startRelay(ffmpegPath, inputUrl, dest) {
  if (relays.has(dest.platform)) stopRelay(dest.platform);

  // Instagram = RTMPS : ffmpeg gère mieux avec flv + URL complète
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-re",
    "-i",
    inputUrl,
    "-c",
    "copy",
    "-f",
    "flv",
    dest.url,
  ];

  const proc = spawn(ffmpegPath, args, { windowsHide: true });
  relays.set(dest.platform, proc);

  proc.on("exit", (code) => {
    relays.delete(dest.platform);
    publishStatus({
      message: `Relay ${dest.platform} arrêté (code ${code})`,
    });
  });

  proc.stderr?.on("data", () => {
    /* keep process alive; errors surface on exit */
  });

  publishStatus({
    message: `Relay ${dest.platform} démarré`,
    activeRelays: [...relays.keys()],
  });
}

/**
 * Branche / rebranche Instagram avec la clé fraîche (après Live Producer).
 * Si OBS publie déjà vers le relais local → démarre le fan-out IG tout de suite.
 */
function applyInstagramDestination(config) {
  const ig = config.platforms?.instagram || {};
  // Garde activeConfig à jour pour le prochain postPublish OBS
  if (activeConfig?.platforms && ig.streamKey) {
    activeConfig.platforms.instagram = { ...ig };
  }
  const dest = instagram.getRtmpDestination(ig);
  if (!dest) {
    return { ok: false, reason: "Instagram OFF ou clé manquante" };
  }
  if (!nms) {
    return {
      ok: false,
      reason: "Multistream arrêté — démarre-le pour pousser vers Instagram",
      destination: dest,
      needsMultistream: true,
    };
  }
  if (!lastInputUrl) {
    return {
      ok: true,
      pending: true,
      destination: dest,
      message: "Clé IG enregistrée — le relais démarrera dès qu'OBS publie",
    };
  }
  const ffmpegPath = resolveFfmpeg(config);
  startRelay(ffmpegPath, lastInputUrl, dest);
  notify("Instagram", "Relais RTMP actif vers Instagram (clé fraîche)", "info");
  return { ok: true, active: true, destination: dest };
}

async function prepareFacebook(config, { title, game }) {
  const fb = config.platforms.facebook || {};
  if (!fb.enabled) return null;

  const fbTitle = (fb.titleTemplate || "{title} | {game}")
    .replaceAll("{title}", title || "Live")
    .replaceAll("{game}", game || "");
  const description = `${title || "Live"}${game ? ` — ${game}` : ""}`;

  // Priorité : Live Producer sur la PAGE (clé persistante + titre/jeu UI)
  if (fb.useLiveProducer !== false) {
    const prepared = await facebook.prepareViaProducer(fb, {
      title: fbTitle,
      game: game || "",
      description,
    });
    if (prepared?.ok) {
      config.platforms.facebook = {
        ...fb,
        enabled: true,
        pageId: fb.pageId || "100036165385264",
        pageUrl:
          fb.pageUrl ||
          "https://www.facebook.com/profile.php?id=100036165385264",
        destination: fb.destination || "page",
        rtmpUrl: prepared.rtmpUrl,
        streamKey: prepared.streamKey,
        lastPreparedAt: prepared.at,
        lastTitle: prepared.title,
        useLiveProducer: true,
        autoCreateLive: false,
      };
      facebookSession = {
        ok: true,
        platform: "facebook",
        rtmpUrl: prepared.rtmpUrl,
        streamKey: prepared.streamKey,
        viaProducer: true,
      };
      // Go Live dès que le flux OBS arrive
      if (fb.autoGoLive !== false) {
        facebook.watchAndGoLive(300000);
      }
      return facebookSession;
    }
    notify("Facebook", prepared?.reason || "Live Producer échoué — fallback API si token", "warn");
  }

  // Fallback Graph API (si token)
  if (!fb.autoCreateLive || !fb.accessToken) {
    if (fb.streamKey) {
      facebookSession = {
        ok: true,
        rtmpUrl: fb.rtmpUrl,
        streamKey: fb.streamKey,
        reused: true,
      };
      return facebookSession;
    }
    return null;
  }

  const created = await facebook.createLive(fb, {
    title: fbTitle,
    description,
  });
  if (!created.ok) {
    notify("Facebook Live", created.reason || "Échec création live", "warn");
    return null;
  }
  facebookSession = created;
  notify("Facebook Live", "Broadcast API créé — clé RTMPS prête", "info");
  return created;
}

/**
 * Instagram : ouvre Live Producer, titre auto, récupère URL+clé (nouvelle à chaque live).
 * Mutates config.platforms.instagram when successful.
 */
async function prepareInstagram(config, { title } = {}) {
  const ig = config.platforms.instagram || {};
  if (!ig.enabled) return null;
  // Toujours une clé neuve : Instagram invalide l'ancienne à chaque session

  const igTitle = String(title || "Live").trim();
  const prepared = await instagram.prepareAndGetCredentials(igTitle, {
    instagramConfig: ig,
    obsConfig: config.obs,
    linkUrl: ig.linkUrl,
    linkTitle: ig.linkTitle,
    autoGoLive: ig.autoGoLive !== false,
  });
  if (!prepared.ok) {
    notify("Instagram", prepared.reason || "Échec Live Producer", "warn");
    return prepared;
  }

  config.platforms.instagram = {
    ...ig,
    enabled: true,
    rtmpUrl: prepared.rtmpUrl,
    streamKey: prepared.streamKey,
    lastPreparedAt: prepared.at,
    lastTitle: prepared.title,
    linkUrl: prepared.linkUrl || ig.linkUrl || "",
    linkTitle: prepared.linkTitle || ig.linkTitle || "",
  };
  return prepared;
}

async function start(
  config,
  { title, game, skipInstagramPrepare = false, skipFacebookPrepare = false } = {},
) {
  if (nms) {
    return { ok: true, ...getStatus(), alreadyRunning: true };
  }

  const ms = config.multistream || {};
  const rtmpPort = ms.rtmpPort || 1935;
  const httpPort = ms.httpPort || 8000;
  const appName = ms.appName || "live";
  const streamKey = ms.streamKey || "obs";
  const ffmpegPath = resolveFfmpeg(config);

  activeConfig = config;
  if (skipFacebookPrepare && config.platforms?.facebook?.streamKey) {
    facebookSession = {
      ok: true,
      platform: "facebook",
      rtmpUrl: config.platforms.facebook.rtmpUrl,
      streamKey: config.platforms.facebook.streamKey,
      reused: true,
    };
  } else {
    facebookSession = await prepareFacebook(config, { title, game });
  }
  let igPrepared = null;
  if (skipInstagramPrepare && config.platforms?.instagram?.streamKey) {
    igPrepared = {
      ok: true,
      reused: true,
      rtmpUrl: config.platforms.instagram.rtmpUrl,
      streamKey: config.platforms.instagram.streamKey,
    };
  } else {
    igPrepared = await prepareInstagram(config, { title });
  }
  const destinations = collectDestinations(config, facebookSession);

  const ingestUrl = `rtmp://127.0.0.1:${rtmpPort}/${appName}/${streamKey}`;
  const { app: electronApp } = require("electron");
  const mediaRoot = path.join(electronApp.getPath("userData"), "nms-media");

  nms = new NodeMediaServer({
    rtmp: {
      port: rtmpPort,
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60,
    },
    http: {
      port: httpPort,
      allow_origin: "*",
      mediaroot: mediaRoot,
    },
  });

  nms.on("prePublish", (_id, streamPath) => {
    publishStatus({ message: `OBS publie: ${streamPath}` });
  });

  nms.on("postPublish", (_id, streamPath) => {
    const expected = `/${appName}/${streamKey}`;
    if (streamPath !== expected && !String(streamPath).endsWith(`/${streamKey}`)) {
      return;
    }
    const inputUrl = `rtmp://127.0.0.1:${rtmpPort}${streamPath}`;
    lastInputUrl = inputUrl;
    // Destinations à jour (clé IG peut avoir changé via applyInstagramDestination)
    const cfg = activeConfig || config;
    const liveDests = collectDestinations(cfg, facebookSession);
    for (const dest of liveDests) {
      startRelay(ffmpegPath, inputUrl, dest);
    }
    notify(
      "Multistream",
      `Fan-out actif: ${liveDests.map((d) => d.platform).join(", ") || "aucune destination"}`,
      "info",
    );
    publishStatus({
      running: true,
      message: "Relais actifs",
      activeRelays: [...relays.keys()],
    });
  });

  nms.on("donePublish", () => {
    stopAllRelays();
    lastInputUrl = null;
    publishStatus({ message: "Publication OBS terminée — relais coupés" });
  });

  nms.run();

  publishStatus({
    running: true,
    ingestUrl,
    destinations: destinations.map((d) => ({
      platform: d.platform,
      server: d.server,
    })),
    tiktokMode: config.platforms.tiktok?.mode || "external_studio",
    message: "Serveur RTMP local prêt — pointe OBS vers l'ingest",
  });

  notify(
    "Multistream prêt",
    `OBS → ${ingestUrl} | TikTok = LIVE Studio (externe)`,
    "info",
  );

  const configPatch = { platforms: {} };
  if (igPrepared?.ok) configPatch.platforms.instagram = config.platforms.instagram;
  if (facebookSession?.viaProducer || facebookSession?.ok) {
    configPatch.platforms.facebook = config.platforms.facebook;
  }

  return {
    ok: true,
    ...getStatus(),
    instagram: igPrepared,
    facebook: facebookSession,
    configPatch: Object.keys(configPatch.platforms).length ? configPatch : null,
  };
}

async function stop(config) {
  stopAllRelays();
  lastInputUrl = null;
  activeConfig = null;
  if (nms) {
    try {
      nms.stop();
    } catch {
      /* ignore */
    }
    nms = null;
  }

  if (facebookSession?.liveVideoId && config?.platforms?.facebook) {
    await facebook.endLive(config.platforms.facebook, facebookSession.liveVideoId);
  }
  facebookSession = null;

  publishStatus({
    running: false,
    ingestUrl: "",
    destinations: [],
    activeRelays: [],
    message: "Multistream arrêté",
  });

  return { ok: true, ...getStatus() };
}

function pointObsToIngest(config) {
  const ms = config.multistream || {};
  const rtmpPort = ms.rtmpPort || 1935;
  const appName = ms.appName || "live";
  const streamKey = ms.streamKey || "obs";
  return {
    server: `rtmp://127.0.0.1:${rtmpPort}/${appName}`,
    key: streamKey,
    full: `rtmp://127.0.0.1:${rtmpPort}/${appName}/${streamKey}`,
  };
}

module.exports = {
  start,
  stop,
  getStatus,
  collectDestinations,
  pointObsToIngest,
  prepareFacebook,
  prepareInstagram,
  applyInstagramDestination,
  stopRelay,
};
