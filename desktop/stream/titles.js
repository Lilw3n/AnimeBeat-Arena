const twitch = require("./platforms/twitch");
const kick = require("./platforms/kick");
const obsBridge = require("./obs-bridge");
const streamerbot = require("./streamerbot-bridge");
const { resolveGame } = require("./game-search");
const { notify } = require("./notify");

function applyTemplate(template, { title, game }) {
  return String(template || "{title}")
    .replaceAll("{title}", title || "")
    .replaceAll("{game}", game || "")
    .trim();
}

async function applyEverywhere(config, { title, gameQuery, gameOverride, screenCount }) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) {
    return { ok: false, reason: "Titre vide" };
  }

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
    platforms: [],
    obs: null,
    scene: null,
  };

  results.platforms.push(
    await twitch.updateChannel(config.platforms.twitch || {}, {
      title: platformTitles.twitch,
      gameId: twitchGameId,
    }),
  );

  results.platforms.push(
    await kick.updateChannelMeta(config.platforms.kick || {}, {
      title: platformTitles.kick,
      gameName,
    }),
  );

  results.platforms.push(
    await streamerbot.applyTitleAndGame(config, {
      title: platformTitles.twitch,
      game: gameName,
    }),
  );

  try {
    results.obs = await obsBridge.applyTitleAndGame(config.obs, {
      title: platformTitles.obs,
      game: gameName,
    });
  } catch (err) {
    results.obs = { ok: false, reason: err.message };
  }

  if (typeof screenCount === "number") {
    try {
      results.scene = await obsBridge.switchSceneForScreenCount(config.obs, screenCount);
    } catch (err) {
      results.scene = { ok: false, reason: err.message };
    }
  }

  const failed = results.platforms.filter((p) => p && p.ok === false && !p.skipped);
  if (!results.gameFound && gameQuery) {
    notify("Titres appliqués (jeu manquant)", `Titre OK — jeu « ${gameQuery} » non trouvé`, "warn");
  } else if (failed.length) {
    notify(
      "Titres partiels",
      failed.map((f) => `${f.platform}: ${f.reason || "erreur"}`).join(" · "),
      "warn",
    );
  } else {
    notify("Titres & jeu", `Appliqué : ${cleanTitle}${gameName ? ` / ${gameName}` : ""}`, "info");
  }

  return { ok: true, ...results };
}

module.exports = { applyEverywhere, applyTemplate };
