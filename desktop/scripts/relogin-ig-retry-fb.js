const { app, BrowserWindow, session } = require("electron");
const path = require("path");
const os = require("os");

async function main() {
  app.setPath("userData", path.join(os.homedir(), "AppData/Roaming/animebeat-live-hub"));
  await app.whenReady();

  const ig = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "Instagram — reconnecte-toi puis dis OK dans le chat",
    webPreferences: {
      session: session.fromPartition("persist:instagram-live"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await ig.loadURL("https://www.instagram.com/");

  const facebook = require("../stream/platforms/facebook");
  const { loadConfig, saveConfig } = require("../stream/config");
  const cfg = loadConfig().platforms.facebook || {};

  console.log("Relance FB prepare…");
  const fb = await facebook.prepareViaProducer(
    {
      ...cfg,
      enabled: true,
      useLiveProducer: true,
      pageId: "100036165385264",
      pageUrl: "https://www.facebook.com/profile.php?id=100036165385264",
    },
    {
      title: "Test Live AnimeBeat IG+FB",
      game: "Just Chatting",
      description: "Test Live AnimeBeat — Just Chatting",
    },
  );
  console.log("FB", JSON.stringify(fb, null, 2));
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
  }
  console.log("IG: connecte-toi dans la fenêtre Instagram, puis dis OK dans le chat");
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
