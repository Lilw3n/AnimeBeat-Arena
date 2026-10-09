/** Prépare IG + nginx + Go Live (OBS déjà en stream). */
const { app } = require("electron");
const { claimHubUserData } = require("./_claim-hub-userdata");

async function main() {
  if (!claimHubUserData()) return;
  app.on("window-all-closed", (e) => {
    if (e?.preventDefault) e.preventDefault();
  });
  await app.whenReady();

  const { loadConfig, saveConfig } = require("../stream/config");
  const nginxRtmp = require("../stream/nginx-rtmp");
  const instagram = require("../stream/platforms/instagram");

  const title = process.argv[2] || "Live AnimeBeat";
  let config = loadConfig();

  console.log("Prépare IG…");
  const ig = await instagram.prepareAndGetCredentials(title, {
    instagramConfig: { ...config.platforms.instagram, enabled: true },
    obsConfig: config.obs,
    linkUrl: config.platforms.instagram?.linkUrl,
    linkTitle: config.platforms.instagram?.linkTitle,
    autoGoLive: false,
  });
  console.log(ig.ok ? `Clé OK ${String(ig.streamKey).slice(0, 28)}…` : ig.reason);
  if (!ig.ok) return;

  config = loadConfig();
  config.platforms.instagram = {
    ...config.platforms.instagram,
    streamKey: ig.streamKey,
    rtmpUrl: ig.rtmpUrl,
    enabled: true,
    lastPreparedAt: ig.at,
  };
  saveConfig(config);

  const ngx = nginxRtmp.applyLiveKeys(config, {
    facebookKey: config.platforms.facebook?.streamKey || "",
    instagramKey: ig.streamKey,
  });
  console.log("nginx", ngx.ok ? "OK" : ngx.reason);

  console.log("Attente preview → Go Live…");
  await new Promise((r) => setTimeout(r, 10000));
  const live = await instagram.goLive({
    waitForReady: true,
    timeoutMs: 240000,
    probePreview: true,
  });
  console.log("IG Go Live", live);
  console.log("DONE");
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
