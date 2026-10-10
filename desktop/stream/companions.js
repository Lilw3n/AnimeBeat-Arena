const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { notify } = require("./notify");

const DEFAULT_STUNNEL = path.join(
  os.homedir(),
  "Documents",
  "Stream",
  "stunnel",
  "bin",
  "stunnel.exe",
);

/** @type {Record<string, { label: string, processNames: string[], pathKey: string, defaultPath?: string, cwd?: (exe: string) => string }>} */
const COMPANIONS = {
  socialstream: {
    label: "Social Stream Ninja",
    processNames: ["socialstream.exe"],
    pathKey: "socialstream",
  },
  streamerBot: {
    label: "Streamer.bot",
    processNames: ["Streamer.bot.exe", "streamer.bot.exe"],
    pathKey: "streamerBot",
  },
  obs: {
    label: "OBS Studio",
    processNames: ["obs64.exe", "obs32.exe", "obs.exe"],
    pathKey: "obs",
    cwd: (exe) => path.dirname(exe),
  },
  stunnel: {
    label: "stunnel (FB/IG RTMPS)",
    processNames: ["stunnel.exe"],
    pathKey: "stunnel",
    defaultPath: DEFAULT_STUNNEL,
    // conf souvent à côté / parent de bin/
    cwd: (exe) => {
      const bin = path.dirname(exe);
      const parent = path.dirname(bin);
      if (fs.existsSync(path.join(bin, "stunnel.conf"))) return bin;
      if (fs.existsSync(path.join(parent, "stunnel.conf"))) return parent;
      return bin;
    },
  },
};

/** Fermés manuellement cette session → pas de relaunch auto */
const sessionDismissed = new Set();
/** Lancés (ou vus démarrés) par le hub cette session */
const sessionLaunched = new Set();
let watchTimer = null;
let tasklistCache = { at: 0, text: "" };

function resolveExe(id, config) {
  const def = COMPANIONS[id];
  if (!def) return "";
  const fromConfig = config.appPaths?.[def.pathKey];
  if (fromConfig && fs.existsSync(fromConfig)) return fromConfig;
  if (def.defaultPath && fs.existsSync(def.defaultPath)) return def.defaultPath;
  return fromConfig || def.defaultPath || "";
}

function readTasklist() {
  const now = Date.now();
  if (now - tasklistCache.at < 2000 && tasklistCache.text) return tasklistCache.text;
  try {
    const text = execSync("tasklist /FO CSV /NH", {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
    });
    tasklistCache = { at: now, text };
    return text;
  } catch {
    return "";
  }
}

function isRunning(id) {
  const def = COMPANIONS[id];
  if (!def) return false;
  const list = readTasklist().toLowerCase();
  if (!list) return false;
  return def.processNames.some((name) => {
    const n = name.toLowerCase();
    return list.includes(`"${n}"`) || list.includes(n);
  });
}

function isSkipped(id, config) {
  if (sessionDismissed.has(id)) return true;
  const skip = config.companions?.skip || {};
  return Boolean(skip[id]);
}

function markDismissed(id, reason = "Fermé manuellement") {
  const def = COMPANIONS[id];
  if (!def) return;
  sessionDismissed.add(id);
  sessionLaunched.delete(id);
  notify(def.label, `${reason} — pas de réouverture auto cette session`, "info");
}

function clearDismissed(id) {
  sessionDismissed.delete(id);
}

function launchOne(id, config, { force = false } = {}) {
  const def = COMPANIONS[id];
  if (!def) return { ok: false, reason: `Inconnu: ${id}` };

  if (!force && isSkipped(id, config)) {
    return {
      ok: true,
      skipped: true,
      reason: sessionDismissed.has(id)
        ? "Ignoré (fermé manuellement cette session)"
        : "Ignoré (case ne pas ouvrir)",
      id,
    };
  }

  if (isRunning(id)) {
    sessionLaunched.add(id);
    return { ok: true, alreadyRunning: true, id, label: def.label };
  }

  if (force) clearDismissed(id);

  const exe = resolveExe(id, config);
  if (!exe || !fs.existsSync(exe)) {
    return { ok: false, reason: `Exécutable introuvable: ${def.label}`, id, exe };
  }

  try {
    const cwd = def.cwd ? def.cwd(exe) : path.dirname(exe);
    // SSN: active Control API locale pour démarrer/relancer Instagram Live depuis le hub
    const args =
      id === "socialstream"
        ? ["--ssapp-control-api", "--ssapp-control-port=17777"]
        : [];
    spawn(exe, args, {
      detached: true,
      stdio: "ignore",
      cwd,
      windowsHide: id === "stunnel",
      env: {
        ...process.env,
        ...(id === "socialstream"
          ? { SSAPP_CONTROL_API: "1", SSAPP_CONTROL_PORT: "17777" }
          : {}),
      },
    }).unref();
    sessionLaunched.add(id);
    clearDismissed(id);
    notify(
      def.label,
      id === "socialstream" ? "Démarré (Control API :17777)" : "Démarré",
      "info",
    );
    return { ok: true, launched: true, id, exe, label: def.label, args };
  } catch (err) {
    return { ok: false, reason: err.message || "Échec lancement", id };
  }
}

/**
 * Démarre SSN / Streamer.bot / OBS / stunnel si besoin.
 * Ne relance pas ce qui est coché « ne pas ouvrir » ou fermé manuellement.
 */
function ensureAll(config, { force = false } = {}) {
  if (!force && config.companions?.autoLaunch === false) {
    return { ok: true, disabled: true, results: [] };
  }
  const order = ["stunnel", "obs", "streamerBot", "socialstream"];
  const results = order.map((id) => launchOne(id, config, { force }));
  ensureWatch(config);
  const launched = results.filter((r) => r.launched).map((r) => r.label || r.id);
  const running = results.filter((r) => r.alreadyRunning).map((r) => r.id);
  const failed = results.filter((r) => !r.ok);
  if (launched.length) {
    notify("Companions", `Ouverts: ${launched.join(", ")}`, "info");
  }
  return { ok: failed.length === 0, results, launched, running, failed };
}

function ensureWatch() {
  if (watchTimer) return;
  watchTimer = setInterval(() => {
    tasklistCache = { at: 0, text: "" };
    for (const id of [...sessionLaunched]) {
      if (sessionDismissed.has(id)) continue;
      if (!isRunning(id)) {
        markDismissed(id, "Fermé manuellement");
      }
    }
  }, 10000);
  if (typeof watchTimer.unref === "function") watchTimer.unref();
}

function getStatus(config) {
  return Object.keys(COMPANIONS).map((id) => {
    const def = COMPANIONS[id];
    const exe = resolveExe(id, config);
    return {
      id,
      label: def.label,
      running: isRunning(id),
      skipped: isSkipped(id, config),
      sessionDismissed: sessionDismissed.has(id),
      configSkip: Boolean(config.companions?.skip?.[id]),
      exe,
      exeExists: Boolean(exe && fs.existsSync(exe)),
    };
  });
}

function stopWatch() {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

module.exports = {
  COMPANIONS,
  DEFAULT_STUNNEL,
  resolveExe,
  isRunning,
  launchOne,
  ensureAll,
  ensureWatch,
  stopWatch,
  markDismissed,
  clearDismissed,
  getStatus,
};
