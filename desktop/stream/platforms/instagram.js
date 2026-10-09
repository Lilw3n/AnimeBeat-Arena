const producer = require("./instagram-live-producer");
const obsBridge = require("../obs-bridge");
const { listMediaDevices, pickPreferredVideo } = require("../media-devices");
const { notify } = require("../notify");

function getRtmpDestination(instagramConfig) {
  if (!instagramConfig.enabled || !instagramConfig.streamKey) return null;
  const server = (instagramConfig.rtmpUrl || "rtmps://live-upload.instagram.com:443/rtmp").replace(
    /\/$/,
    "",
  );
  return {
    platform: "instagram",
    server,
    key: instagramConfig.streamKey,
    url: `${server}/${instagramConfig.streamKey}`,
    note: "Clé Live Producer (régénérée à chaque live)",
  };
}

/**
 * Démarre la VirtualCam OBS si demandé, choisit la caméra, puis Live Producer.
 */
async function prepareAndGetCredentials(title, options = {}) {
  const igCfg = options.instagramConfig || {};
  const obsCfg = options.obsConfig || {};

  if (igCfg.startObsVirtualCam !== false && obsCfg.enabled !== false) {
    try {
      await obsBridge.connect(obsCfg);
      // Aitum Vertical Canvas = caméra pour IG/TikTok (vendor start_virtual_camera)
      const vc = await obsBridge.startVirtualCam(obsCfg, { preferAitum: true });
      if (!vc.ok) {
        notify("OBS", vc.reason || "VirtualCam Aitum/OBS non démarrée", "warn");
      } else {
        notify(
          "OBS",
          vc.via === "aitum-vertical-canvas"
            ? "Aitum Vertical VCam ON — rafraîchis la liste caméras"
            : "VirtualCam OBS ON",
          "info",
        );
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (err) {
      notify("OBS", err.message || "VirtualCam indisponible", "warn");
    }
  }

  const devices = await listMediaDevices({
    force: true,
    partition: "persist:instagram-live",
  });
  const wantId = igCfg.videoDeviceId || options.cameraDeviceId || "";
  const wantLabel =
    igCfg.videoDeviceLabel || options.cameraDeviceLabel || "OBS Virtual Camera";
  const userChose = Boolean(wantId || (wantLabel && wantLabel !== "OBS Virtual Camera"));

  const pick = pickPreferredVideo(devices.video || [], {
    deviceId: wantId,
    deviceLabel: wantLabel,
    // Si l’utilisateur a choisi une caméra précise, ne pas écraser par « premier device »
    preferObsVirtualCamera: userChose ? false : igCfg.preferObsVirtualCamera !== false,
    preferAitumVertical: userChose ? false : true,
    allowDefaultFallback: false,
  });

  if (pick) {
    producer.setCameraPreference({
      deviceId: String(pick.deviceId || "").startsWith("dshow:") ? "" : pick.deviceId,
      deviceLabel: pick.label || wantLabel,
    });
    notify("Instagram", `Caméra sélectionnée: ${pick.label}`, "info");
  } else {
    producer.setCameraPreference({
      deviceId: String(wantId).startsWith("dshow:") ? "" : wantId,
      deviceLabel: wantLabel,
    });
    notify(
      "Instagram",
      `Caméra « ${wantLabel} » non listée — forçage par nom (démarre Aitum/OBS VCam si besoin)`,
      "warn",
    );
  }

  return producer.prepareLive(title, {
    ...options,
    cameraDeviceId: pick && !String(pick.deviceId).startsWith("dshow:") ? pick.deviceId : "",
    cameraDeviceLabel: pick?.label || wantLabel,
    linkUrl: igCfg.linkUrl || options.linkUrl || "",
    linkTitle: igCfg.linkTitle || options.linkTitle || "",
    autoGoLive: options.autoGoLive !== false && igCfg.autoGoLive !== false,
    obsConfig: options.obsConfig || obsCfg,
    aitumVertical: options.aitumVertical || options.aitumCfg || {},
    instagramConfig: igCfg,
  });
}

async function goLive(opts) {
  return producer.goLive(opts);
}

module.exports = {
  getRtmpDestination,
  prepareAndGetCredentials,
  goLive,
  watchAndGoLive: (ms) => producer.watchAndGoLive(ms),
  openProducer: () => producer.openProducer(),
  getProducerStatus: () => producer.getStatus(),
  updateTitle: (opts) =>
    producer.updateTitle({ ...opts, autoOpen: opts?.autoOpen !== false }),
  updateStickyLink: (opts) =>
    producer.updateStickyLink({ ...opts, autoOpen: opts?.autoOpen !== false }),
  capturePublicLiveUrl: (cfg) => producer.capturePublicLiveUrl(cfg),
  setCameraPreference: (p) => producer.setCameraPreference(p),
  applyCameraPreferenceNow: (p) => producer.applyCameraPreferenceNow(p),
  endBroadcast: () => producer.endBroadcast(),
  listCameras: () =>
    listMediaDevices({ force: true, partition: "persist:instagram-live" }),
};
