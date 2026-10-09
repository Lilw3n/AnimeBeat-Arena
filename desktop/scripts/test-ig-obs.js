/**
 * Test rapide: OBS WebSocket + Instagram Live Producer.
 * Usage: npx electron scripts/test-ig-obs.js
 */
const { app } = require("electron");
const path = require("path");

async function main() {
  // Même userData que l'app installée
  app.setPath("userData", require("path").join(require("os").homedir(), "AppData/Roaming/animebeat-live-hub"));
  await app.whenReady();
  const obsBridge = require("../stream/obs-bridge");
  const instagram = require("../stream/platforms/instagram");
  const { loadConfig, saveConfig } = require("../stream/config");

  const config = loadConfig();
  console.log("userData:", app.getPath("userData"));
  console.log("OBS text sources:", config.obs?.textSources);
  const title =
    process.argv[2] ||
    `Test IG AnimeBeat ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;

  console.log("=== 1) OBS ===");
  const obsStatus = await obsBridge.connect(config.obs);
  console.log(JSON.stringify(obsStatus, null, 2));
  if (!obsStatus.connected) {
    console.error("OBS injoignable — vérifie WebSocket 4456 + mdp");
    app.exit(1);
    return;
  }

  const text = await obsBridge.applyTitleAndGame(config.obs, {
    title,
    game: "Just Chatting",
  });
  console.log("OBS titres:", JSON.stringify(text));

  console.log("\n=== 2) Instagram Live Producer ===");
  console.log("Titre:", title);
  console.log("Une fenêtre Instagram va s'ouvrir — connecte-toi si besoin.");

  // Active IG pour le test
  config.platforms.instagram = {
    ...(config.platforms.instagram || {}),
    enabled: true,
    autoPrepare: true,
  };
  saveConfig(config);

  const ig = await instagram.prepareAndGetCredentials(title);
  console.log("IG result:", JSON.stringify(ig, null, 2));

  if (ig.ok) {
    const next = loadConfig();
    next.platforms.instagram = {
      ...(next.platforms.instagram || {}),
      enabled: true,
      rtmpUrl: ig.rtmpUrl,
      streamKey: ig.streamKey,
      lastPreparedAt: ig.at,
      lastTitle: ig.title,
    };
    saveConfig(next);
    console.log("\nClé enregistrée dans stream-command.json");
    console.log("→ Colle aussi dans Aitum Vertical (engrenage jaune) si tu stream en vertical direct.");
    console.log("→ Ou démarre Multistream dans Stream Command pour fan-out RTMP.");
  }

  console.log("\nFenêtre IG gardée ouverte. Ctrl+C / ferme pour quitter ce script.");
  // Keep electron alive so IG window stays
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});
