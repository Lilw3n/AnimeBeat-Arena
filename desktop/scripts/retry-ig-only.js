const { app } = require("electron");
const { claimHubUserData } = require("./_claim-hub-userdata");

async function main() {
  if (!claimHubUserData()) return;
  await app.whenReady();

  const instagram = require("../stream/platforms/instagram");
  const { loadConfig, saveConfig } = require("../stream/config");
  const title = process.argv[2] || "Test Live AnimeBeat IG";

  const config = loadConfig();
  const igCfg = {
    ...(config.platforms.instagram || {}),
    enabled: true,
    autoGoLive: true,
    startObsVirtualCam: true,
    preferObsVirtualCamera: true,
    linkUrl: config.platforms.instagram?.linkUrl || "https://leonida-vice.com",
    linkTitle: config.platforms.instagram?.linkTitle || "Site GTA VI",
  };
  console.log("IG prepare…", title, igCfg.linkUrl);
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
    console.log("Clé IG enregistrée.");
  } else if (ig.needLogin) {
    console.log("Toujours login — reconnecte-toi dans la fenêtre.");
  }

  console.log("DONE");
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
