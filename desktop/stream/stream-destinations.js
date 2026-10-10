/**
 * Activer / désactiver les destinations qui ont une clé dans le hub.
 * Sans clé → verrouillé (ex. Twitch/Kick via Restream OBS seulement).
 * À chaud: coupe/relance relais multistream + push nginx Meta (FB/IG stunnel).
 */
const { loadConfig, saveConfig } = require("./config");
const multistream = require("./multistream");
const nginxRtmp = require("./nginx-rtmp");
const { notify, pushToWindows } = require("./notify");

const PLATFORM_META = [
  { id: "twitch", label: "Twitch" },
  { id: "kick", label: "Kick" },
  { id: "facebook", label: "Facebook (Meta / stunnel)" },
  { id: "instagram", label: "Instagram (Meta)" },
  { id: "youtube", label: "YouTube" },
  { id: "custom", label: "Custom RTMP" },
];

function hasStreamKey(p = {}) {
  return Boolean(String(p.streamKey || "").trim());
}

function listDestinations(config = {}) {
  const ms = multistream.getStatus();
  const active = new Set(ms.activeRelays || []);
  const out = [];

  for (const meta of PLATFORM_META) {
    const p = config.platforms?.[meta.id] || {};
    const key = hasStreamKey(p);
    out.push({
      id: meta.id,
      label: meta.label,
      hasKey: key,
      // avec clé: ON sauf enabled===false ; sans clé: non activable
      enabled: key ? p.enabled !== false : false,
      canToggle: key,
      locked: !key,
      lockReason: key
        ? ""
        : meta.id === "twitch" || meta.id === "kick"
          ? "Pas de clé hub — géré via Restream OBS"
          : "Pas de clé RTMP dans le hub",
      activeRelay: active.has(meta.id),
      keyHint: key ? `${String(p.streamKey).slice(0, 8)}…` : "",
    });
  }

  // TikTok toujours externe
  out.push({
    id: "tiktok",
    label: "TikTok LIVE Studio",
    hasKey: false,
    enabled: true,
    canToggle: false,
    locked: true,
    lockReason: "Studio externe (pas de clé hub)",
    activeRelay: false,
    keyHint: "",
  });

  return out;
}

function nginxKeysFromConfig(config) {
  const fb = config.platforms?.facebook || {};
  const ig = config.platforms?.instagram || {};
  return {
    facebookKey: fb.enabled !== false && hasStreamKey(fb) ? fb.streamKey : "",
    instagramKey: ig.enabled !== false && hasStreamKey(ig) ? ig.streamKey : "",
  };
}

function applyHotRouting(config, platformId) {
  const results = { nginx: null, relay: null };
  const id = String(platformId || "").toLowerCase();

  // Meta via nginx/stunnel
  if (id === "facebook" || id === "instagram" || id === "*") {
    try {
      results.nginx = nginxRtmp.applyLiveKeys(config, nginxKeysFromConfig(config));
    } catch (err) {
      results.nginx = { ok: false, reason: err.message };
    }
  }

  // Relais ffmpeg du multistream hub (si serveur local tourne)
  const ms = multistream.getStatus();
  if (ms.running && typeof multistream.setRelayEnabled === "function") {
    if (id === "*") {
      results.relay = multistream.syncRelaysFromConfig(config);
    } else if (id && id !== "tiktok") {
      results.relay = multistream.setRelayEnabled(config, id);
    }
  }

  return results;
}

function setEnabled(platformId, enabled, { persist = true } = {}) {
  const id = String(platformId || "").toLowerCase();
  const config = loadConfig();
  const p = config.platforms?.[id];
  if (!p) {
    return { ok: false, reason: `Plateforme inconnue: ${id}` };
  }
  if (!hasStreamKey(p)) {
    return {
      ok: false,
      reason: "Pas de clé — impossible d’activer/désactiver depuis le hub",
      destinations: listDestinations(config),
    };
  }

  config.platforms[id] = { ...p, enabled: Boolean(enabled) };
  if (persist) saveConfig(config);

  const hot = applyHotRouting(config, id);
  const destinations = listDestinations(config);
  pushToWindows({ type: "stream-destinations", destinations });
  notify(
    "Flux",
    `${id}: ${enabled ? "activé" : "désactivé"}${hasStreamKey(p) ? "" : " (sans clé)"}`,
    "info",
  );
  return { ok: true, platform: id, enabled: Boolean(enabled), destinations, hot, config };
}

function setAllWithKeys(enabled, { persist = true } = {}) {
  const config = loadConfig();
  const changed = [];
  for (const meta of PLATFORM_META) {
    const p = config.platforms?.[meta.id];
    if (!p || !hasStreamKey(p)) continue;
    const next = Boolean(enabled);
    if (Boolean(p.enabled) === next) continue;
    config.platforms[meta.id] = { ...p, enabled: next };
    changed.push(meta.id);
  }
  if (persist) saveConfig(config);
  const hot = applyHotRouting(config, "*");
  const destinations = listDestinations(config);
  pushToWindows({ type: "stream-destinations", destinations });
  notify(
    "Flux",
    changed.length
      ? `${enabled ? "Activé" : "Coupé"}: ${changed.join(", ")}`
      : "Aucune destination avec clé à modifier",
    "info",
  );
  return { ok: true, changed, destinations, hot, config };
}

function getStatus(config) {
  const cfg = config || loadConfig();
  return {
    destinations: listDestinations(cfg),
    multistream: multistream.getStatus(),
    nginx: nginxRtmp.isNginxListening1935(),
  };
}

module.exports = {
  listDestinations,
  setEnabled,
  setAllWithKeys,
  getStatus,
  hasStreamKey,
  PLATFORM_META,
};
