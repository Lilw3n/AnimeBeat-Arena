/**
 * Pousse le flux OBS et fait Go Live IG + FB dès que le preview active le bouton.
 * Usage: npx electron scripts/go-live-ig-fb.js
 */
const { app } = require("electron");
const { claimHubUserData } = require("./_claim-hub-userdata");

async function main() {
  if (!claimHubUserData()) return;
  app.on("window-all-closed", (e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
  });
  await app.whenReady();

  const { loadConfig, saveConfig } = require("../stream/config");
  const companions = require("../stream/companions");
  const goLivePipeline = require("../stream/go-live-pipeline");

  let config = loadConfig();
  // Active le garde-fou pour cette session de test
  config.streamGuard = { ...(config.streamGuard || {}), autoGoLive: true };
  config.platforms = config.platforms || {};
  if (config.platforms.instagram) {
    config.platforms.instagram = { ...config.platforms.instagram, enabled: true, autoGoLive: true };
  }
  if (config.platforms.facebook) {
    config.platforms.facebook = { ...config.platforms.facebook, enabled: true, autoGoLive: true };
  }
  saveConfig(config);

  try {
    companions.ensureAll(config);
  } catch {
    /* optional */
  }

  console.log("=== ARM + GO LIVE IG/FB ===");
  console.log("IG key?", Boolean(config.platforms?.instagram?.streamKey));
  console.log("FB key?", Boolean(config.platforms?.facebook?.streamKey));

  const res = await goLivePipeline.armPushAndGoLive({
    force: true,
    startObsStream: true,
    platforms: ["instagram", "facebook"],
    timeoutMs: 300000,
    title: process.argv[2] || "Live AnimeBeat",
    game: process.argv[3] || "Just Chatting",
  });

  console.log(JSON.stringify(res, null, 2));
  console.log("DONE — fenêtres gardées ouvertes pour vérif.");
}

main().catch((e) => {
  console.error("FATAL", e);
  app.exit(1);
});
