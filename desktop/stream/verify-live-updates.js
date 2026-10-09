/**
 * Diagnostic des mises à jour titre/jeu/infos (OBS, SB, FB, IG…).
 */
const { loadConfig } = require("./config");
const obsBridge = require("./obs-bridge");
const streamerbot = require("./streamerbot-bridge");
const facebook = require("./platforms/facebook");
const instagram = require("./platforms/instagram");
const titles = require("./titles");
const { notify } = require("./notify");

function statusLine(ok, detail) {
  return { ok: Boolean(ok), detail: String(detail || "") };
}

async function verifyLiveUpdates(options = {}) {
  const config = loadConfig();
  const probe = options.probe === true;
  const platforms = options.platforms;

  const fbProd = facebook.getProducerStatus?.() || { open: false };
  const igProd = instagram.getProducerStatus?.() || { open: false };
  const obs = obsBridge.getStatus();
  const sb = streamerbot.getStatus();
  const fbCfg = config.platforms?.facebook || {};
  const hasFbGraph = Boolean(fbCfg.accessToken);
  const hasFbLiveId = Boolean(fbCfg.liveVideoId || fbCfg.liveId);

  const channels = {
    obs: statusLine(
      obs.connected,
      obs.connected
        ? `connecté — sources ${config.obs?.textSources?.title || "?"} / ${config.obs?.textSources?.game || "?"}`
        : obs.message || "OBS déconnecté",
    ),
    streamerbot: statusLine(
      sb.connected,
      sb.connected
        ? `WS OK${sb.platforms?.length ? ` · ${sb.platforms.join(", ")}` : " · aucun compte plateforme"}`
        : sb.message || "Streamer.bot déconnecté",
    ),
    twitch: statusLine(
      Boolean(config.platforms?.twitch?.enabled && config.platforms?.twitch?.accessToken) ||
        sb.connected,
      config.platforms?.twitch?.enabled
        ? config.platforms.twitch.accessToken
          ? "token présent"
          : sb.connected
            ? "via Streamer.bot"
            : "activé mais token manquant"
        : sb.connected
          ? "via Streamer.bot"
          : "désactivé (souvent via Streamer.bot)",
    ),
    kick: statusLine(
      sb.connected || Boolean(config.platforms?.kick?.enabled),
      sb.connected
        ? "via Streamer.bot"
        : config.platforms?.kick?.enabled
          ? "activé (API limitée — SB recommandé)"
          : "désactivé (souvent via Streamer.bot)",
    ),
    facebook: statusLine(
      fbProd.open || hasFbGraph,
      fbProd.open
        ? `Producer ouvert — maj live OK${fbProd.url ? ` · ${fbProd.url.slice(0, 60)}` : ""}`
        : hasFbGraph
          ? hasFbLiveId
            ? "Graph OK — maj titre live possible sans Producer ; sinon auto-ouverture"
            : "Graph token OK — maj via Producer (auto-ouverture) ou live LIVE détecté"
          : "Pas de token Graph — maj via Producer (auto-ouverture à l’Appliquer)",
    ),
    instagram: statusLine(
      true,
      igProd.open
        ? "Producer ouvert — maj live possible"
        : "Producer fermé — sera ouvert auto à Appliquer / Pousser titre",
    ),
  };

  const summary = {
    canLiveObs: channels.obs.ok,
    canLiveSb: channels.streamerbot.ok,
    canLiveFacebook: channels.facebook.ok,
    canLiveInstagram: channels.instagram.ok,
  };

  let probeResult = null;
  if (probe) {
    const title =
      String(options.title || "").trim() ||
      config.platforms?.facebook?.lastTitle ||
      config.platforms?.instagram?.lastTitle ||
      config.presets?.[0]?.title ||
      "Live AnimeBeat";
    const gameQuery =
      String(options.gameQuery || "").trim() ||
      config.platforms?.facebook?.lastGame ||
      "";

    probeResult = await titles.applyEverywhere(config, {
      title,
      gameQuery,
      platforms: platforms || ["obs", "streamerbot", "facebook", "instagram"],
    });

    const linkResults = {};
    if (config.platforms?.facebook?.linkUrl) {
      linkResults.facebook = await facebook.updateStickyLink({
        linkUrl: config.platforms.facebook.linkUrl,
        linkTitle: config.platforms.facebook.linkTitle || "",
        facebookConfig: config.platforms.facebook,
        autoOpen: true,
      });
    }
    if (config.platforms?.instagram?.linkUrl) {
      linkResults.instagram = await instagram.updateStickyLink({
        linkUrl: config.platforms.instagram.linkUrl,
        linkTitle: config.platforms.instagram.linkTitle || "",
        autoOpen: true,
      });
    }
    probeResult.linkResults = linkResults;
  }

  const readyCount = Object.values(channels).filter((c) => c.ok).length;
  notify(
    "Vérif live",
    probe
      ? `Probe terminé · canaux prêts ${readyCount}/${Object.keys(channels).length}`
      : `État: OBS=${summary.canLiveObs ? "OK" : "—"} · SB=${summary.canLiveSb ? "OK" : "—"} · FB=${summary.canLiveFacebook ? "OK" : "—"} · IG=${summary.canLiveInstagram ? "OK" : "—"}`,
    readyCount >= 2 ? "info" : "warn",
  );

  return {
    ok: true,
    channels,
    summary,
    probe: probeResult,
    tips: [
      !summary.canLiveObs ? "Connecte OBS (WebSocket 4455) pour titres OBS." : null,
      !summary.canLiveSb
        ? "Connecte Streamer.bot (:4457) pour Twitch/Kick via actions."
        : null,
      !fbProd.open && !hasFbGraph
        ? "FB: sans token Graph, « Appliquer » ouvrira le Live Producer automatiquement."
        : null,
      !igProd.open
        ? "IG: « Appliquer » / Pousser titre ouvrira le Live Producer automatiquement."
        : null,
    ].filter(Boolean),
  };
}

module.exports = { verifyLiveUpdates };
