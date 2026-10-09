/**
 * Mises à jour auto AnimeBeat Live Hub (Windows NSIS + feed local sur le PC).
 *
 * - App installée: electron-updater lit latest.yml depuis un dossier local (HTTP éphémère)
 *   ou une URL (GitHub / serveur).
 * - Mode DEV (bat / npx electron): pas d’install NSIS — on signale si release/ a une version plus récente.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { notify, pushToWindows } = require("./notify");
const { loadConfig, updateConfig } = require("./config");

let lastStatus = {
  ok: true,
  checking: false,
  mode: "idle",
  currentVersion: "",
  availableVersion: "",
  message: "",
  downloaded: false,
};

let updater = null;
let localServer = null;

function defaultLocalReleaseDir() {
  // …/desktop/release (à côté du code source)
  return path.join(__dirname, "..", "release");
}

function resolveUpdateSettings(config = loadConfig()) {
  const u = config.updates || {};
  return {
    enabled: u.enabled !== false,
    checkOnLaunch: u.checkOnLaunch !== false,
    autoDownload: u.autoDownload !== false,
    autoInstallOnQuit: u.autoInstallOnQuit !== false,
    localDir: String(u.localDir || defaultLocalReleaseDir()).trim(),
    remoteUrl: String(u.remoteUrl || "").trim(),
  };
}

function setStatus(patch) {
  lastStatus = {
    ...lastStatus,
    currentVersion: app.getVersion(),
    ...patch,
    at: new Date().toISOString(),
  };
  pushToWindows({ type: "app-update", ...lastStatus });
  return lastStatus;
}

function getStatus() {
  return {
    ...lastStatus,
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    settings: resolveUpdateSettings(),
  };
}

function parseYmlVersion(ymlText) {
  const m = String(ymlText || "").match(/^\s*version:\s*['"]?([0-9]+\.[0-9]+\.[0-9]+)/m);
  return m ? m[1] : "";
}

function compareSemver(a, b) {
  const pa = String(a || "0")
    .split(".")
    .map((n) => Number(n) || 0);
  const pb = String(b || "0")
    .split(".")
    .map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function readLocalLatest(localDir) {
  const yml = path.join(localDir, "latest.yml");
  if (!fs.existsSync(yml)) {
    return { ok: false, reason: `Pas de latest.yml dans ${localDir}` };
  }
  const text = fs.readFileSync(yml, "utf8");
  const version = parseYmlVersion(text);
  if (!version) return { ok: false, reason: "version introuvable dans latest.yml" };
  return { ok: true, version, yml, localDir, text };
}

/** Petit serveur HTTP pour que electron-updater lise le dossier release/ local. */
function startLocalFeedServer(localDir) {
  return new Promise((resolve, reject) => {
    if (localServer) {
      try {
        localServer.close();
      } catch {
        /* ignore */
      }
      localServer = null;
    }
    const root = path.resolve(localDir);
    const server = http.createServer((req, res) => {
      try {
        const raw = decodeURIComponent((req.url || "/").split("?")[0]);
        const rel = raw.replace(/^\/+/, "") || "latest.yml";
        const filePath = path.normalize(path.join(root, rel));
        if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": rel.endsWith(".yml") ? "text/yaml" : "application/octet-stream",
          "Cache-Control": "no-cache",
        });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err.message || err));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      localServer = server;
      const { port } = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${port}/`,
        stop: () =>
          new Promise((r) => {
            server.close(() => {
              if (localServer === server) localServer = null;
              r();
            });
          }),
      });
    });
    server.on("error", reject);
  });
}

function ensureUpdater() {
  if (updater) return updater;
  // eslint-disable-next-line global-require
  const { autoUpdater } = require("electron-updater");
  updater = autoUpdater;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowDowngrade = false;
  // Builds non signés (signAndEditExecutable: false)
  updater.verifyUpdateCodeSignature = async () => null;

  updater.on("checking-for-update", () => {
    setStatus({ checking: true, mode: "checking", message: "Recherche de mise à jour…" });
  });
  updater.on("update-available", (info) => {
    setStatus({
      checking: false,
      mode: "available",
      availableVersion: info?.version || "",
      message: `Mise à jour ${info?.version} disponible — téléchargement…`,
    });
    notify("Mise à jour", `v${info?.version} disponible`, "info");
  });
  updater.on("update-not-available", () => {
    setStatus({
      checking: false,
      mode: "up-to-date",
      message: `À jour (v${app.getVersion()})`,
    });
  });
  updater.on("download-progress", (p) => {
    setStatus({
      mode: "downloading",
      message: `Téléchargement ${Math.round(p.percent || 0)}%`,
      percent: Math.round(p.percent || 0),
    });
  });
  updater.on("update-downloaded", (info) => {
    setStatus({
      checking: false,
      mode: "ready",
      downloaded: true,
      availableVersion: info?.version || lastStatus.availableVersion,
      message: `v${info?.version || "?"} prête — redémarre pour installer`,
    });
    notify("Mise à jour prête", "Redémarre le hub pour installer", "info");
  });
  updater.on("error", (err) => {
    setStatus({
      checking: false,
      mode: "error",
      ok: false,
      message: err?.message || String(err),
    });
  });
  return updater;
}

async function checkDevChannel() {
  const settings = resolveUpdateSettings();
  const local = readLocalLatest(settings.localDir);
  const current = app.getVersion();
  if (!local.ok) {
    return setStatus({
      ok: true,
      checking: false,
      mode: "dev",
      message: `Mode DEV v${current} — ${local.reason}. Pour publier: npm run publish:local`,
    });
  }
  const newer = compareSemver(local.version, current) > 0;
  return setStatus({
    ok: true,
    checking: false,
    mode: newer ? "dev-newer" : "dev",
    availableVersion: local.version,
    message: newer
      ? `Mode DEV v${current} — installateur v${local.version} prêt dans release/ (lance-le ou npm run publish:local)`
      : `Mode DEV v${current} — release locale v${local.version}`,
  });
}

async function checkForUpdates({ silent = false } = {}) {
  const settings = resolveUpdateSettings();
  if (!settings.enabled) {
    return setStatus({
      ok: true,
      mode: "disabled",
      message: "Mises à jour désactivées (config.updates.enabled)",
    });
  }

  if (!app.isPackaged) {
    const st = await checkDevChannel();
    if (!silent && st.mode === "dev-newer") {
      notify("Mise à jour", st.message, "info");
    }
    return st;
  }

  const au = ensureUpdater();
  au.autoDownload = settings.autoDownload;
  au.autoInstallOnAppQuit = settings.autoInstallOnQuit;

  let feedStop = null;
  try {
    setStatus({ checking: true, mode: "checking", message: "Recherche…" });

    if (settings.remoteUrl) {
      au.setFeedURL({ provider: "generic", url: settings.remoteUrl.replace(/\/?$/, "/") });
    } else {
      const local = readLocalLatest(settings.localDir);
      if (!local.ok) {
        return setStatus({
          ok: false,
          checking: false,
          mode: "error",
          message: local.reason,
        });
      }
      const feed = await startLocalFeedServer(settings.localDir);
      feedStop = feed.stop;
      au.setFeedURL({ provider: "generic", url: feed.url });
    }

    await au.checkForUpdates();
    return getStatus();
  } catch (err) {
    const msg = err?.message || String(err);
    if (!silent) notify("Mise à jour", msg, "warn");
    return setStatus({ ok: false, checking: false, mode: "error", message: msg });
  } finally {
    if (feedStop) {
      // Laisse le temps au téléchargement de démarrer si besoin
      setTimeout(() => feedStop().catch(() => {}), 120000);
    }
  }
}

function quitAndInstall() {
  if (!app.isPackaged) {
    return { ok: false, reason: "Mode DEV — lance l’installeur dans release/" };
  }
  try {
    const au = ensureUpdater();
    au.quitAndInstall(false, true);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function saveSettings(patch = {}) {
  const next = updateConfig({
    updates: {
      ...resolveUpdateSettings(),
      ...patch,
    },
  });
  return { ok: true, settings: resolveUpdateSettings(next) };
}

function startBackgroundChecks() {
  const settings = resolveUpdateSettings();
  if (!settings.enabled || !settings.checkOnLaunch) return;
  setTimeout(() => {
    checkForUpdates({ silent: true }).catch(() => {});
  }, 8000);
  // Recheck toutes les 6 h
  setInterval(
    () => {
      checkForUpdates({ silent: true }).catch(() => {});
    },
    6 * 60 * 60 * 1000,
  );
}

module.exports = {
  getStatus,
  checkForUpdates,
  quitAndInstall,
  saveSettings,
  startBackgroundChecks,
  resolveUpdateSettings,
  defaultLocalReleaseDir,
};
