const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const DEFAULT_PATH = path.join(__dirname, "config.default.json");

function deepMerge(base, override) {
  if (!override || typeof override !== "object") return structuredClone(base);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function getConfigPath() {
  return path.join(app.getPath("userData"), "stream-command.json");
}

function loadDefault() {
  return JSON.parse(fs.readFileSync(DEFAULT_PATH, "utf8"));
}

function loadConfig() {
  const defaults = loadDefault();
  const file = getConfigPath();
  let merged;
  if (!fs.existsSync(file)) {
    merged = structuredClone(defaults);
  } else {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      merged = deepMerge(defaults, raw);
    } catch {
      merged = structuredClone(defaults);
    }
  }

  try {
    const { applyDiscovery } = require("./discover-local");
    const { config: discovered } = applyDiscovery(merged);
    // Persist auto-filled session/ports once so UI shows them
    const needsWrite =
      !merged.socialStreamNinja?.sessionId &&
      discovered.socialStreamNinja?.sessionId;
    const obsChanged =
      discovered.obs?.port !== merged.obs?.port ||
      discovered.obs?.password !== merged.obs?.password;
    merged = discovered;
    if (needsWrite || obsChanged || !fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(merged, null, 2), "utf8");
    }
  } catch {
    /* discovery optional */
  }

  return merged;
}

function saveConfig(next) {
  const file = getConfigPath();
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function updateConfig(patch) {
  const current = loadConfig();
  const next = deepMerge(current, patch);
  return saveConfig(next);
}

function getClipsDir(config) {
  if (config.clips?.outputDir) return config.clips.outputDir;
  const dir = path.join(app.getPath("videos"), "AnimeBeat Clips");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  getConfigPath,
  loadConfig,
  saveConfig,
  updateConfig,
  getClipsDir,
  loadDefault,
};
