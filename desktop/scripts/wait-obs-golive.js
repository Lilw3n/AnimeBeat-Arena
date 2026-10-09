/**
 * Clés déjà en config → nginx reload → attend OBS → Go Live IG/FB.
 * Si l'écran Live Producer n'est plus là, re-prépare rapidement.
 */
const { app } = require("electron");
const { claimHubUserData } = require("./_claim-hub-userdata");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!claimHubUserData()) return;
  app.on("window-all-closed", (e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
  });
  await app.whenReady();

  const { loadConfig, saveConfig } = require("../stream/config");
  const nginxRtmp = require("../stream/nginx-rtmp");
  const obsBridge = require("../stream/obs-bridge");
  const instagram = require("../stream/platforms/instagram");
  const facebook = require("../stream/platforms/facebook");

  const title = process.argv[2] || "Live AnimeBeat";
  const game = process.argv[3] || "Just Chatting";
  let config = loadConfig();

  console.log("Clés config:");
  console.log(" IG", config.platforms?.instagram?.streamKey ? "oui" : "NON");
  console.log(" FB", config.platforms?.facebook?.streamKey ? "oui" : "NON");

  // Rouvrir les écrans Go Live (nouvelle clé IG à chaque prepare — OK)
  console.log("\n=== Re-prépare IG (écran Go Live) ===");
  let ig = await instagram.prepareAndGetCredentials(title, {
    instagramConfig: {
      ...config.platforms.instagram,
      enabled: true,
      linkUrl: "https://leonida-vice.com",
      linkTitle: "Site GTA 6",
    },
    obsConfig: config.obs,
    linkUrl: "https://leonida-vice.com",
    linkTitle: "Site GTA 6",
    autoGoLive: false,
  });
  console.log("IG", ig.ok ? `OK ${String(ig.streamKey).slice(0, 28)}…` : ig.reason);
  if (ig.ok) {
    config = loadConfig();
    config.platforms.instagram = {
      ...config.platforms.instagram,
      streamKey: ig.streamKey,
      rtmpUrl: ig.rtmpUrl,
      linkUrl: "https://leonida-vice.com",
      linkTitle: "Site GTA 6",
      enabled: true,
      lastPreparedAt: ig.at,
    };
    saveConfig(config);
  } else if (config.platforms.instagram?.streamKey) {
    console.log("IG: réutilise clé config + ouvre producer");
    await instagram.openProducer();
    ig = {
      ok: true,
      streamKey: config.platforms.instagram.streamKey,
      rtmpUrl: config.platforms.instagram.rtmpUrl,
      reused: true,
    };
  }

  console.log("\n=== Re-prépare FB ===");
  const fb = await facebook.prepareViaProducer(loadConfig().platforms.facebook, {
    title,
    game,
    description: `${title} — ${game}`,
  });
  console.log("FB", fb.ok ? `OK ${fb.streamKey}` : fb.reason);
  if (fb.ok) {
    config = loadConfig();
    config.platforms.facebook = {
      ...config.platforms.facebook,
      streamKey: fb.streamKey,
      rtmpUrl: fb.rtmpUrl,
      enabled: true,
      lastPreparedAt: fb.at,
    };
    saveConfig(config);
  }

  config = loadConfig();
  console.log("\n=== nginx ===");
  const ngx = nginxRtmp.applyLiveKeys(config, {
    facebookKey: config.platforms.facebook?.streamKey || "",
    instagramKey: config.platforms.instagram?.streamKey || "",
  });
  console.log(ngx.ok ? "nginx OK" : ngx.reason);

  // Republish OBS obligatoire après reload nginx (sinon pas de push vers IG/FB)
  console.log("\n=== Restart OBS → nginx ===");
  await obsBridge.connect(config.obs);
  try {
    const st0 = await obsBridge.getStreamStatus(config.obs);
    if (st0?.outputActive) {
      await obsBridge.stopStream(config.obs);
      await sleep(2500);
    }
  } catch {
    /* ignore */
  }
  await obsBridge.setCustomRtmp(config.obs, "rtmp://127.0.0.1:1935/live", "obs");
  await obsBridge.startStream(config.obs);
  await sleep(4000);
  const st = await obsBridge.getStreamStatus(config.obs);
  console.log("OBS streaming?", Boolean(st?.outputActive));
  if (!st?.outputActive) {
    console.log("\n>>> LANCE LE STREAM OBS MANUELLEMENT <<<");
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const s = await obsBridge.getStreamStatus(config.obs);
      if (s?.outputActive) break;
      process.stdout.write(".");
      await sleep(2000);
    }
  }
  console.log("\nPause 15s pour stunnel/nginx…");
  await sleep(15000);

  console.log("\n=== GO LIVE ===");
  if (ig.ok) {
    const r = await instagram.goLive({ waitForReady: true, timeoutMs: 300000, probePreview: true });
    console.log("IG", r);
  }
  if (fb.ok) {
    const r = await facebook.goLive({ waitForReady: true, timeoutMs: 300000, probePreview: true });
    console.log("FB", r);
  }
  console.log("DONE");
}

main().catch((e) => {
  console.error("FATAL", e);
  app.exit(1);
});
