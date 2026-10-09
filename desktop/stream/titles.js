const twitch = require("./platforms/twitch");
const kick = require("./platforms/kick");
const facebook = require("./platforms/facebook");
const instagram = require("./platforms/instagram");
const obsBridge = require("./obs-bridge");
const streamerbot = require("./streamerbot-bridge");
const { resolveGame } = require("./game-search");
const { notify } = require("./notify");
const { loadConfig, saveConfig } = require("./config");

const ALL_TARGETS = ["twitch", "kick", "obs", "streamerbot", "facebook", "instagram"];

function applyTemplate(template, { title, game }) {
  return String(template || "{title}")
    .replaceAll("{title}", title || "")
    .replaceAll("{game}", game || "")
    .trim();
}

function normalizeTargets(platforms) {
  if (!platforms || platforms === "all" || platforms === "*") return [...ALL_TARGETS];
  const list = Array.isArray(platforms) ? platforms : [platforms];
  const out = [];
  for (const raw of list) {
    const p = String(raw || "")
      .toLowerCase()
      .trim();
    if (!p || p === "all") {
      return [...ALL_TARGETS];
    }
    if (ALL_TARGETS.includes(p) && !out.includes(p)) out.push(p);
  }
  return out.length ? out : [...ALL_TARGETS];
}

function wants(targets, name) {
  return targets.includes(name);
}

async function applyEverywhere(config, { title, gameQuery, gameOverride, screenCount, platforms }) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) {
    return { ok: false, reason: "Titre vide" };
  }

  const targets = normalizeTargets(platforms);
  // Twitch/Kick en live = surtout Streamer.bot (API Kick absente, Twitch Helix souvent sans token)
  const wantsTwitchKick = wants(targets, "twitch") || wants(targets, "kick");
  const runStreamerBot = wants(targets, "streamerbot") || wantsTwitchKick;

  let gameName = gameOverride?.name || "";
  let twitchGameId = gameOverride?.twitchId || null;
  let gameResolution = null;

  if (!gameOverride && gameQuery) {
    gameResolution = await resolveGame(config, gameQuery, { notifyIfMissing: true });
    if (gameResolution.found) {
      gameName = gameResolution.game.name;
      twitchGameId = gameResolution.game.twitchId;
    }
  } else if (gameOverride) {
    gameResolution = { found: true, game: gameOverride };
  }

  const templates = config.titleTemplates || {};
  const platformTitles = {
    twitch: applyTemplate(templates.twitch, { title: cleanTitle, game: gameName }),
    kick: applyTemplate(templates.kick, { title: cleanTitle, game: gameName }),
    facebook: applyTemplate(templates.facebook, { title: cleanTitle, game: gameName }),
    instagram: applyTemplate(templates.instagram, { title: cleanTitle, game: gameName }),
    youtube: applyTemplate(templates.youtube, { title: cleanTitle, game: gameName }),
    obs: applyTemplate(templates.obs, { title: cleanTitle, game: gameName }),
  };

  const results = {
    title: cleanTitle,
    gameName,
    twitchGameId,
    gameFound: Boolean(gameName),
    gameResolution,
    platformTitles,
    targets,
    platforms: [],
    obs: null,
    scene: null,
    facebook: null,
    instagram: null,
    streamerbot: null,
  };

  try {
    const live = loadConfig();
    if (wants(targets, "facebook") || wants(targets, "instagram")) {
      live.platforms = live.platforms || {};
      if (wants(targets, "facebook")) {
        const fbDesc =
          String(live.platforms?.facebook?.lastDescription || "").trim() ||
          `${cleanTitle}${gameName ? ` — ${gameName}` : ""}`;
        live.platforms.facebook = {
          ...(live.platforms.facebook || {}),
          lastTitle: platformTitles.facebook,
          lastDescription: fbDesc,
          lastGame: gameName || "",
        };
      }
      if (wants(targets, "instagram")) {
        live.platforms.instagram = {
          ...(live.platforms.instagram || {}),
          lastTitle: platformTitles.instagram,
        };
      }
      saveConfig(live);
      config = live;
    }
  } catch {
    /* optional */
  }

  // 1) Streamer.bot en premier pour Twitch + Kick (lives en cours)
  if (runStreamerBot) {
    const sb = await streamerbot.applyTitleAndGame(config, {
      title: platformTitles.twitch || cleanTitle,
      game: gameName,
    });
    if (sb?.ok) sb.live = true;
    results.streamerbot = sb;
    results.platforms.push({
      ...sb,
      platform: "streamerbot",
      covers: wantsTwitchKick ? ["twitch", "kick"] : [],
    });
  }

  if (wants(targets, "twitch")) {
    const tw = await twitch.updateChannel(config.platforms.twitch || {}, {
      title: platformTitles.twitch,
      gameId: twitchGameId,
    });
    if (tw?.ok) tw.live = true;
    if (tw?.skipped && results.streamerbot?.ok) {
      results.platforms.push({
        ok: true,
        live: true,
        platform: "twitch",
        via: "streamerbot",
        note: "Twitch API off — appliqué via Streamer.bot",
      });
    } else if (tw?.skipped && !results.streamerbot?.ok) {
      results.platforms.push({
        ok: false,
        platform: "twitch",
        reason:
          tw.reason ||
          "Twitch: active Streamer.bot (comptes liés) ou renseigne token Helix dans la config",
      });
    } else {
      results.platforms.push(tw);
    }
  }

  if (wants(targets, "kick")) {
    if (results.streamerbot?.ok) {
      results.platforms.push({
        ok: true,
        live: true,
        platform: "kick",
        via: "streamerbot",
        note: "Kick appliqué via Streamer.bot (pas d’API write hub)",
      });
    } else {
      const ki = await kick.updateChannelMeta(config.platforms.kick || {}, {
        title: platformTitles.kick,
        gameName,
      });
      results.platforms.push({
        ok: false,
        platform: "kick",
        localOnly: Boolean(ki?.localOnly),
        reason:
          results.streamerbot?.reason ||
          "Kick: connecte Streamer.bot avec compte Kick + action AnimeBeat Set Title Game",
      });
    }
  }

  if (wants(targets, "obs")) {
    try {
      results.obs = await obsBridge.applyTitleAndGame(config.obs, {
        title: platformTitles.obs,
        game: gameName,
      });
      const obsOk = Array.isArray(results.obs)
        ? results.obs.every((r) => r?.ok !== false)
        : Boolean(results.obs?.ok !== false);
      results.platforms.push({
        ok: obsOk,
        live: obsOk,
        platform: "obs",
        detail: results.obs,
      });
    } catch (err) {
      results.obs = { ok: false, reason: err.message };
      results.platforms.push({ ok: false, platform: "obs", reason: err.message });
    }
  }

  if (wants(targets, "facebook")) {
    const fbCfg = config.platforms?.facebook || {};
    const fbDesc =
      String(fbCfg.lastDescription || "").trim() ||
      `${cleanTitle}${gameName ? ` — ${gameName}` : ""}`;
    results.facebook = await facebook.updateTitleGame({
      title: platformTitles.facebook,
      game: gameName,
      description: fbDesc,
      facebookConfig: fbCfg,
      autoOpen: true,
    });
    results.platforms.push(results.facebook);
    // Lien sticky aussi (live ou pré-live)
    if (fbCfg.linkUrl) {
      results.facebookLink = await facebook.updateStickyLink({
        linkUrl: fbCfg.linkUrl,
        linkTitle: fbCfg.linkTitle || "",
        facebookConfig: fbCfg,
        autoOpen: true,
      });
      results.platforms.push({
        ...results.facebookLink,
        platform: "facebook-link",
      });
    }
  }

  if (wants(targets, "instagram")) {
    const igCfg = config.platforms?.instagram || {};
    results.instagram = await instagram.updateTitle({
      title: platformTitles.instagram,
      autoOpen: true,
    });
    results.platforms.push(results.instagram);
    if (igCfg.linkUrl) {
      results.instagramLink = await instagram.updateStickyLink({
        linkUrl: igCfg.linkUrl,
        linkTitle: igCfg.linkTitle || "",
        autoOpen: true,
      });
      results.platforms.push({
        ...results.instagramLink,
        platform: "instagram-link",
      });
    }
  }

  if (typeof screenCount === "number" && wants(targets, "obs")) {
    try {
      results.scene = await obsBridge.switchSceneForScreenCount(config.obs, screenCount);
    } catch (err) {
      results.scene = { ok: false, reason: err.message };
    }
  }

  const failed = results.platforms.filter((p) => p && p.ok === false && !p.skipped);
  const skipped = results.platforms.filter((p) => p && p.skipped);
  const liveOk = results.platforms.filter((p) => p && p.ok && p.live);
  const label = targets.length === ALL_TARGETS.length ? "partout" : targets.join(", ");

  results.liveApplied = liveOk.map((p) => p.platform);
  results.savedOnly = skipped.map((p) => p.platform);
  results.failedPlatforms = failed.map((p) => p.platform);

  if (!results.gameFound && gameQuery) {
    notify("Titres appliqués (jeu manquant)", `Titre OK (${label}) — jeu « ${gameQuery} » non trouvé`, "warn");
  } else if (failed.length) {
    notify(
      "Titres partiels",
      failed.map((f) => `${f.platform}: ${f.reason || "erreur"}`).join(" · "),
      "warn",
    );
  } else {
    const liveBit = liveOk.length ? ` · live: ${results.liveApplied.join(",")}` : "";
    notify(
      "Titres & jeu",
      `Appliqué (${label}) : ${cleanTitle}${gameName ? ` / ${gameName}` : ""}${liveBit}`,
      "info",
    );
  }

  return { ok: failed.length === 0 || liveOk.length > 0, ...results };
}

module.exports = { applyEverywhere, applyTemplate, ALL_TARGETS, normalizeTargets };
