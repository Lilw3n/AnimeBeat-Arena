/**
 * À appeler en premier dans les scripts Electron de test.
 * Empêche 2 process de partager animebeat-live-hub (sinon logout IG).
 */
const { app } = require("electron");
const path = require("path");
const os = require("os");

function claimHubUserData() {
  app.setPath("userData", path.join(os.homedir(), "AppData/Roaming/animebeat-live-hub"));
  const got = app.requestSingleInstanceLock();
  if (!got) {
    console.error(
      "ABORT: une autre instance (Live Hub ou script) utilise déjà la session Instagram/Facebook.\n" +
        "Ferme AnimeBeat Live Hub / les fenêtres Electron de test, puis relance.",
    );
    app.exit(2);
    return false;
  }
  return true;
}

module.exports = { claimHubUserData };
