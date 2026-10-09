/**
 * 1) Prépare IG + FB (clés + lien)
 * 2) Injecte dans nginx → stunnel + reload
 * 3) Attend que TOI tu lances le stream OBS
 * 4) Go Live IG puis FB dès que le preview active les boutons
 *
 * Usage: npx electron scripts/prepare-then-go-live.js "Titre" "Jeu"
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
  const companions = require("../stream/companions");
  const nginxRtmp = require("../stream/nginx-rtmp");
  const obsBridge = require("../stream/obs-bridge");
  const instagram = require("../stream/platforms/instagram");
  const facebook = require("../stream/platforms/facebook");

  const title = process.argv[2] || "Live AnimeBeat";
  const game = process.argv[3] || "Just Chatting";

  let config = loadConfig();
  config.streamGuard = { ...(config.streamGuard || {}), autoGoLive: true };
  config.platforms.instagram = {
    ...(config.platforms.instagram || {}),
    enabled: true,
    autoGoLive: true,
  };
  config.platforms.facebook = {
    ...(config.platforms.facebook || {}),
    enabled: true,
    autoGoLive: true,
  };
  saveConfig(config);

  try {
    companions.ensureAll(config);
  } catch {
    /* optional */
  }

  console.log("=== 1) INSTAGRAM Live Producer ===");
  const ig = await instagram.prepareAndGetCredentials(title, {
    instagramConfig: config.platforms.instagram,
    obsConfig: config.obs,
    linkUrl: config.platforms.instagram.linkUrl,
    linkTitle: config.platforms.instagram.linkTitle,
    autoGoLive: false,
  });
  console.log("IG", ig.ok ? `OK clé=${String(ig.streamKey).slice(0, 24)}…` : ig.reason);
  if (ig.ok) {
    config = loadConfig();
    config.platforms.instagram = {
      ...config.platforms.instagram,
      rtmpUrl: ig.rtmpUrl,
      streamKey: ig.streamKey,
      lastPreparedAt: ig.at,
      lastTitle: ig.title,
      linkUrl: ig.linkUrl || config.platforms.instagram.linkUrl,
      linkTitle: ig.linkTitle || config.platforms.instagram.linkTitle,
      enabled: true,
    };
    saveConfig(config);
  }

  console.log("\n=== 2) FACEBOOK PAGE Live Producer ===");
  const fb = await facebook.prepareViaProducer(loadConfig().platforms.facebook, {
    title,
    game,
    description: `${title} — ${game}`,
  });
  console.log("FB", fb.ok ? `OK clé=${fb.streamKey}` : fb.reason);
  if (fb.ok) {
    config = loadConfig();
    config.platforms.facebook = {
      ...config.platforms.facebook,
      rtmpUrl: fb.rtmpUrl,
      streamKey: fb.streamKey,
      lastPreparedAt: fb.at,
      lastTitle: fb.title,
      enabled: true,
    };
    saveConfig(config);
  }

  if (!ig.ok && !fb.ok) {
    console.error("Aucune clé récupérée — abandon.");
    return;
  }

  config = loadConfig();
  console.log("\n=== 3) nginx push FB/IG + reload ===");
  const ngx = nginxRtmp.applyLiveKeys(config, {
    facebookKey: fb.ok ? fb.streamKey : "",
    instagramKey: ig.ok ? ig.streamKey : "",
  });
  console.log("nginx", ngx.ok ? "OK reloaded" : ngx.reason);

  console.log("\n=== 4) ATTENTE — lance le stream OBS maintenant ===");
  console.log("Cible attendue: rtmp://127.0.0.1:1935/live (clé obs ou autre)");
  await obsBridge.connect(config.obs);

  const deadline = Date.now() + 10 * 60 * 1000;
  let sawLive = false;
  while (Date.now() < deadline) {
    const st = await obsBridge.getStreamStatus(config.obs);
    if (st?.outputActive) {
      sawLive = true;
      console.log("OBS stream détecté — attente preview Meta…");
      break;
    }
    process.stdout.write(".");
    await sleep(2000);
  }
  console.log("");
  if (!sawLive) {
    console.error("Timeout: OBS toujours pas en stream après 10 min.");
    return;
  }

  // Laisse nginx démarrer les push stunnel
  await sleep(12000);

  console.log("\n=== 5) GO LIVE ===");
  let igLive = { ok: false, skipped: true };
  let fbLive = { ok: false, skipped: true };

  if (ig.ok) {
    console.log("IG: attente bouton Lancer un direct…");
    igLive = await instagram.goLive({
      waitForReady: true,
      timeoutMs: 300000,
      probePreview: true,
    });
    console.log("IG Go Live", igLive);
  }

  if (fb.ok) {
    console.log("FB: attente bouton Lancer un direct…");
    fbLive = await facebook.goLive({
      waitForReady: true,
      timeoutMs: 300000,
      probePreview: true,
    });
    console.log("FB Go Live", fbLive);
  }

  console.log("\n=== RÉSUMÉ ===");
  console.log({
    igKey: ig.ok,
    fbKey: fb.ok,
    nginx: ngx.ok,
    igLive: igLive.ok,
    fbLive: fbLive.ok,
  });
  console.log("DONE — fenêtres gardées ouvertes.");
}

main().catch((e) => {
  console.error("FATAL", e);
  app.exit(1);
});
