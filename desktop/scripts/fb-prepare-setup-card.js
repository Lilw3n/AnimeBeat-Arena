/**
 * Test: ouvre la carte « Configurer la vidéo en direct » + titre/Public depuis l'app.
 * Usage: electron scripts/fb-prepare-setup-card.js ["Live AnimeBeat"]
 */
const { app } = require("electron");
const path = require("path");
const os = require("os");

async function main() {
  app.setPath("userData", path.join(os.homedir(), "AppData/Roaming/animebeat-live-hub"));
  await app.whenReady();

  const facebook = require("../stream/platforms/facebook");
  const { loadConfig, saveConfig } = require("../stream/config");
  const title = process.argv[2] || "Live AnimeBeat";
  const game = process.argv[3] || "";
  const cfg = loadConfig().platforms.facebook || {};

  console.log("FB prepare… titre=", title, "jeu=", game || "(aucun)");
  console.log("streamKey config:", cfg.streamKey ? String(cfg.streamKey).slice(0, 12) + "…" : "(vide)");

  const fb = await facebook.prepareViaProducer(
    {
      ...cfg,
      enabled: true,
      useLiveProducer: true,
      destination: cfg.destination || "page",
      pageId: cfg.pageId || "100036165385264",
      pageUrl:
        cfg.pageUrl || "https://www.facebook.com/profile.php?id=100036165385264",
      linkUrl: cfg.linkUrl,
      linkTitle: cfg.linkTitle,
    },
    {
      title,
      game,
      description: title,
    },
  );
  console.log(JSON.stringify(fb, null, 2));

  if (fb.ok) {
    const c = loadConfig();
    c.platforms.facebook = {
      ...c.platforms.facebook,
      ...cfg,
      enabled: true,
      rtmpUrl: fb.rtmpUrl,
      streamKey: fb.streamKey,
      lastPreparedAt: fb.at,
      lastTitle: fb.title,
    };
    saveConfig(c);
    console.log("OK — clé sauvée, fenêtre Live Producer laissée ouverte");
  } else {
    console.error("FAIL:", fb.reason || fb);
    app.exit(1);
    return;
  }

  // Garde le process vivant pour laisser la fenêtre ouverte
  setTimeout(() => {
    console.log("Fin test (fenêtre peut rester ouverte via autre instance hub)");
    app.exit(0);
  }, 8000);
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
