/**
 * Retest Instagram puis Facebook (1 fenêtre chacune, session persist).
 * Usage: npx electron scripts/retest-ig-fb.js "Titre" "Just Chatting"
 */
const { app } = require("electron");
const { claimHubUserData } = require("./_claim-hub-userdata");

async function main() {
  if (!claimHubUserData()) return;
  // Empêche la sortie quand listMediaDevices détruit sa fenêtre cachée
  app.on("window-all-closed", (e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
  });
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
    try {
      const vc = await obsBridge.startVirtualCam(config.obs);
      console.log("VirtualCam", vc);
    } catch (e) {
      console.log("VirtualCam skip", e.message);
    }
  }

  console.log("\n=== INSTAGRAM ===");
  const igCfg = {
    ...(config.platforms.instagram || {}),
    enabled: true,
    autoGoLive: true,
    startObsVirtualCam: true,
    preferObsVirtualCamera: true,
    videoDeviceLabel: config.platforms.instagram?.videoDeviceLabel || "OBS Virtual Camera",
    linkUrl: config.platforms.instagram?.linkUrl || "https://leonida-vice.com",
    linkTitle: config.platforms.instagram?.linkTitle || "Site GTA VI",
  };
  const ig = await instagram.prepareAndGetCredentials(title, {
    instagramConfig: igCfg,
    obsConfig: config.obs,
    linkUrl: igCfg.linkUrl,
    linkTitle: igCfg.linkTitle,
    autoGoLive: true,
  });
  console.log("IG", JSON.stringify(ig, null, 2));
  if (ig.ok) {
    const c = loadConfig();
    c.platforms.instagram = {
      ...igCfg,
      rtmpUrl: ig.rtmpUrl,
      streamKey: ig.streamKey,
      lastPreparedAt: ig.at,
      lastTitle: ig.title,
      linkUrl: ig.linkUrl || igCfg.linkUrl,
      linkTitle: ig.linkTitle || igCfg.linkTitle,
    };
    saveConfig(c);
    console.log("IG SAVED");
  }

  console.log("\n=== FACEBOOK PAGE ===");
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
      ...fbCfg,
      rtmpUrl: fb.rtmpUrl,
      streamKey: fb.streamKey,
      lastPreparedAt: fb.at,
      lastTitle: fb.title,
      autoCreateLive: false,
    };
    saveConfig(c);
    console.log("FB SAVED");
    facebook.watchAndGoLive(120000);
  }

  console.log("\nDONE — fenêtres gardées ouvertes.");
}

process.on("uncaughtException", (e) => {
  console.error("uncaughtException", e);
});
process.on("unhandledRejection", (e) => {
  console.error("unhandledRejection", e);
});

main().catch((e) => {
  console.error("FATAL", e);
  app.exit(1);
});
