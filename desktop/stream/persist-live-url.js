const { loadConfig, saveConfig } = require("./config");
const { buildLiveLinks } = require("./live-links");
const { notify, pushToWindows } = require("./notify");

/**
 * Enregistre l’URL publique du direct et notifie l’UI (hub + Stream Command).
 */
function persistPlatformLiveUrl(platform, payload = {}) {
  const key = String(platform || "").toLowerCase();
  if (key !== "facebook" && key !== "instagram") {
    return { ok: false, reason: "platform invalide" };
  }
  let liveUrl = String(payload.liveUrl || "").trim();
  if (liveUrl && !/^https?:\/\//i.test(liveUrl)) liveUrl = `https://${liveUrl}`;
  if (!liveUrl) return { ok: false, reason: "liveUrl vide" };

  const config = loadConfig();
  const prev = config.platforms?.[key] || {};
  config.platforms = config.platforms || {};
  config.platforms[key] = {
    ...prev,
    liveUrl,
    liveId: payload.liveId || prev.liveId || "",
    liveAt: payload.liveAt || new Date().toISOString(),
    liveStatus: "LIVE",
  };
  saveConfig(config);
  const links = buildLiveLinks(config);
  pushToWindows({
    type: "live-links-updated",
    platform: key,
    liveUrl,
    liveId: config.platforms[key].liveId,
    links,
  });
  notify(
    key === "facebook" ? "Facebook" : "Instagram",
    `Lien live mis à jour: ${liveUrl.replace(/^https?:\/\//i, "").slice(0, 64)}`,
    "info",
  );
  return { ok: true, platform: key, liveUrl, links, config };
}

function clearPlatformLiveUrl(platform) {
  const key = String(platform || "").toLowerCase();
  const config = loadConfig();
  if (!config.platforms?.[key]) return { ok: false };
  config.platforms[key] = {
    ...config.platforms[key],
    liveUrl: "",
    liveId: "",
    liveStatus: "",
  };
  saveConfig(config);
  pushToWindows({ type: "live-links-updated", platform: key, liveUrl: "", links: buildLiveLinks(config) });
  return { ok: true };
}

module.exports = { persistPlatformLiveUrl, clearPlatformLiveUrl };
