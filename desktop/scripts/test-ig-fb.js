/**
 * Test Instagram + Facebook Live Producer (PAGE).
 * Usage: npx electron scripts/test-ig-fb.js "Mon titre" "Just Chatting"
 */
const { app } = require("electron");
const path = require("path");
const os = require("os");

async function main() {
  app.setPath(
    "userData",
    path.join(os.homedir(), "AppData/Roaming/animebeat-live-hub"),
  );
  await app.whenReady();

  const { loadConfig, saveConfig } = require("../stream/config");
  const obsBridge = require("../stream/obs-bridge");
  const instagram = require("../stream/platforms/instagram");
  const facebook = require("../stream/platforms/facebook");

  const title = process.argv[2] || "Test Live AnimeBeat";
  const game = process.argv[3] || "Just Chatting";
  const config = loadConfig();

  console.log("=== OBS ===");
  const obs = await obsBridge.connect(config.obs);
  console.log(obs);
  if (obs.connected) {
    const t = await obsBridge.applyTitleAndGame(config.obs, { title, game });
    console.log("OBS titres", t);
  }

  console.log("\n=== Instagram ===");
  config.platforms.instagram = {
    ...(config.platforms.instagram || {}),
    enabled: true,
    autoPrepare: true,
  };
  saveConfig(config);
  const ig = await instagram.prepareAndGetCredentials(title);
  console.log("IG", JSON.stringify(ig, null, 2));
  if (ig.ok) {
    const c = loadConfig();
    c.platforms.instagram = {
      ...c.platforms.instagram,
      enabled: true,
      rtmpUrl: ig.rtmpUrl,
      streamKey: ig.streamKey,
      lastPreparedAt: ig.at,
      lastTitle: ig.title,
    };
    saveConfig(c);
  }

  console.log("\n=== Facebook PAGE ===");
  const fbCfg = {
    ...(loadConfig().platforms.facebook || {}),
    enabled: true,
    useLiveProducer: true,
    pageId: "100036165385264",
    pageUrl: "https://www.facebook.com/profile.php?id=100036165385264",
  };
  const fb = await facebook.prepareViaProducer(fbCfg, {
    title,
    game,
    description: `${title} — ${game}`,
  });
  console.log("FB", JSON.stringify(fb, null, 2));
  if (fb.ok) {
    const c = loadConfig();
    c.platforms.facebook = {
      ...c.platforms.facebook,
      ...fbCfg,
      rtmpUrl: fb.rtmpUrl,
      streamKey: fb.streamKey,
      lastPreparedAt: fb.at,
      lastTitle: fb.title,
      autoCreateLive: false,
    };
    saveConfig(c);
    console.log("FB watch Go Live…");
    facebook.watchAndGoLive(180000);
  }

  console.log("\nTerminé — fenêtres gardées ouvertes.");
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
