/**
 * Préférence caméra partagée (main ↔ injecté dans Instagram).
 * Le patch réel est injecté via CDP Page.addScriptToEvaluateOnNewDocument
 * (avant tout script de la page).
 */
let currentPref = {
  deviceId: "",
  deviceLabel: "OBS Virtual Camera",
};

function setPref(pref = {}) {
  currentPref = {
    deviceId: String(pref.deviceId || ""),
    deviceLabel: String(pref.deviceLabel || pref.label || "OBS Virtual Camera"),
  };
  return currentPref;
}

function getPref() {
  return { ...currentPref };
}

/** Source JS injectée dans le monde principal de la page Instagram. */
function buildPatchSource(pref = currentPref) {
  const preferId = String(pref.deviceId || "");
  const preferLabel = String(pref.deviceLabel || "OBS Virtual Camera");
  return `(() => {
  const preferId = ${JSON.stringify(preferId)};
  const preferLabel = ${JSON.stringify(preferLabel)};
  const key = preferId + "|" + preferLabel;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  if (window.__abCamBootKey === key && window.__abCamPatch) return;

  window.__abCamPreferId = preferId;
  window.__abCamPreferLabel = preferLabel;
  if (!window.__abCamOrigGUM) {
    window.__abCamOrigGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  }
  if (!window.__abCamOrigEnum) {
    window.__abCamOrigEnum = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
  }

  const resolvePick = async () => {
    let devices = [];
    try { devices = await window.__abCamOrigEnum(); } catch (_) { return { pick: null, videos: [] }; }
    const videos = devices.filter((d) => d.kind === "videoinput");
    const needle = (preferLabel || "OBS Virtual Camera").toLowerCase().replace(/\\s*★\\s*$/g, "").trim();
    let pick = null;
    if (preferId && !String(preferId).startsWith("dshow:")) {
      pick = videos.find((d) => d.deviceId === preferId) || null;
    }
    if (!pick && needle) {
      pick = videos.find((d) => (d.label || "").toLowerCase() === needle)
        || videos.find((d) => (d.label || "").toLowerCase().includes(needle));
    }
    if (!pick) {
      pick = videos.find((d) => /obs\\s*virtual\\s*camera/i.test(d.label || ""))
        || videos.find((d) => /obs\\s*virtual|aitum|vertical/i.test(d.label || ""));
    }
    return { pick, videos, devices };
  };

  navigator.mediaDevices.enumerateDevices = async function () {
    const { pick, devices } = await resolvePick();
    if (!pick) return devices;
    const preferred = devices.find((d) => d.kind === "videoinput" && d.deviceId === pick.deviceId);
    const rest = devices.filter((d) => !(d.kind === "videoinput" && d.deviceId === pick.deviceId));
    return preferred ? [preferred, ...rest] : devices;
  };

  navigator.mediaDevices.getUserMedia = async function (constraints) {
    const c = constraints ? { ...constraints } : { video: true, audio: true };
    const { pick } = await resolvePick();
    if (pick) {
      window.__abCamLastPick = pick.label || pick.deviceId;
      if (c.video === true || c.video == null) c.video = {};
      if (typeof c.video === "object" && !Array.isArray(c.video)) {
        const video = { ...c.video };
        delete video.facingMode;
        try {
          return await window.__abCamOrigGUM({
            ...c,
            video: { ...video, deviceId: { exact: pick.deviceId } },
          });
        } catch (_) {
          try {
            return await window.__abCamOrigGUM({
              ...c,
              video: { ...video, deviceId: { ideal: pick.deviceId } },
            });
          } catch (_) { /* fall through */ }
        }
      }
    }
    // Ne pas silencieux basculer sur la webcam par défaut si une préférence existe
    if (preferId || preferLabel) {
      console.warn("[AnimeBeat] Caméra préférée introuvable:", preferLabel, preferId);
    }
    return window.__abCamOrigGUM(c);
  };

  window.__abCamBootKey = key;
  window.__abCamPatch = true;
})();`;
}

module.exports = {
  setPref,
  getPref,
  buildPatchSource,
};
