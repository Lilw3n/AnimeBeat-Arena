const { app } = require("electron");
const path = require("path");
const os = require("os");

async function main() {
  app.setPath("userData", path.join(os.homedir(), "AppData/Roaming/animebeat-live-hub"));
  await app.whenReady();
  const { loadConfig } = require("../stream/config");
  const obs = require("../stream/obs-bridge");
  const c = loadConfig();
  const conn = await obs.connect(c.obs);
  const st = await obs.getStreamStatus(c.obs);
  const svc = await obs.getStreamServiceSettings(c.obs);
  console.log(JSON.stringify({ conn, st, svc }, null, 2));
  app.exit(0);
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
