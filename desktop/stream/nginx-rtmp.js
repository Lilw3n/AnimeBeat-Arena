/**
 * Met à jour les push RTMP nginx (FB/IG via stunnel) puis reload.
 * OBS → nginx:1935/live → stunnel:19350 (FB) / 19351 (IG)
 */
const fs = require("fs");
const path = require("path");
const { spawnSync, execSync } = require("child_process");
const os = require("os");
const { notify } = require("./notify");

const DEFAULT_NGINX_DIR = path.join(
  os.homedir(),
  "Documents",
  "Stream",
  "nginx 1.7.12.1 Lizard",
);

const MARK = {
  fbStart: "# ANIMEBEAT-FB-START",
  fbEnd: "# ANIMEBEAT-FB-END",
  igStart: "# ANIMEBEAT-IG-START",
  igEnd: "# ANIMEBEAT-IG-END",
};

function resolveNginxPaths(config = {}) {
  const dir = config.appPaths?.nginxDir || DEFAULT_NGINX_DIR;
  const exe = config.appPaths?.nginx || path.join(dir, "nginx.exe");
  const conf = config.appPaths?.nginxConf || path.join(dir, "conf", "nginx.conf");
  return { dir, exe, conf };
}

function isNginxListening1935() {
  try {
    const out = execSync("netstat -ano", { encoding: "utf8", windowsHide: true });
    const line = out.split(/\r?\n/).find((l) => /:1935\s/.test(l) && /LISTENING/i.test(l));
    if (!line) return { ok: false };
    const pid = line.trim().split(/\s+/).pop();
    let name = "";
    try {
      name = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        encoding: "utf8",
        windowsHide: true,
      });
    } catch {
      /* ignore */
    }
    return {
      ok: true,
      pid,
      isNginx: /nginx/i.test(name),
    };
  } catch {
    return { ok: false };
  }
}

function stripManagedBlock(text, startMark, endMark) {
  const re = new RegExp(
    `\\s*${startMark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${endMark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`,
    "g",
  );
  return text.replace(re, "\n");
}

function buildFbPush(streamKey) {
  const key = String(streamKey || "").trim();
  if (!key) return "";
  // Via stunnel FB → live-api-s.facebook.com:443
  return `                        ${MARK.fbStart}\n                        push rtmp://127.0.0.1:19350/rtmp/${key};\n                        ${MARK.fbEnd}\n`;
}

function buildIgPush(streamKey) {
  const key = String(streamKey || "").trim();
  if (!key) return "";
  // Via stunnel IG → live-upload.instagram.com:443 (port 19351)
  return `                        ${MARK.igStart}\n                        push rtmp://127.0.0.1:19351/rtmp/${key};\n                        ${MARK.igEnd}\n`;
}

/**
 * Injecte / remplace les push AnimeBeat FB + IG dans application live {}.
 */
function updatePushKeys(config, { facebookKey, instagramKey }) {
  const { conf } = resolveNginxPaths(config);
  if (!fs.existsSync(conf)) {
    return { ok: false, reason: `nginx.conf introuvable: ${conf}` };
  }

  let text = fs.readFileSync(conf, "utf8");
  // backup
  const bak = `${conf}.animebeat-bak`;
  try {
    fs.writeFileSync(bak, text, "utf8");
  } catch {
    /* ignore */
  }

  text = stripManagedBlock(text, MARK.fbStart, MARK.fbEnd);
  text = stripManagedBlock(text, MARK.igStart, MARK.igEnd);

  const insert = `${buildFbPush(facebookKey)}${buildIgPush(instagramKey)}`;

  // Insère juste après "application live {" / "live on;" (ou strip seul si plus de clés)
  if (insert.trim()) {
    const appRe = /(application\s+live\s*\{[\s\S]*?live\s+on\s*;)/i;
    if (!appRe.test(text)) {
      return { ok: false, reason: "Bloc application live {} introuvable dans nginx.conf" };
    }
    text = text.replace(appRe, `$1\n${insert}`);
  }

  fs.writeFileSync(conf, text, "utf8");
  return {
    ok: true,
    conf,
    bak,
    facebook: Boolean(String(facebookKey || "").trim()),
    instagram: Boolean(String(instagramKey || "").trim()),
  };
}

function reloadNginx(config) {
  const { dir, exe } = resolveNginxPaths(config);
  if (!fs.existsSync(exe)) {
    return { ok: false, reason: `nginx.exe introuvable: ${exe}` };
  }
  const r = spawnSync(exe, ["-s", "reload"], {
    cwd: dir,
    windowsHide: true,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    return {
      ok: false,
      reason: r.stderr || r.stdout || `nginx reload exit ${r.status}`,
    };
  }
  return { ok: true };
}

/**
 * Applique les clés Live Producer dans nginx + reload.
 */
function applyLiveKeys(config, { facebookKey, instagramKey } = {}) {
  const listen = isNginxListening1935();
  if (!listen.ok || !listen.isNginx) {
    return {
      ok: false,
      reason: listen.ok
        ? `Port 1935 pris par PID ${listen.pid} (pas nginx)`
        : "nginx n'écoute pas sur 1935",
      listen,
    };
  }

  const fbKey =
    facebookKey !== undefined && facebookKey !== null
      ? facebookKey
      : config.platforms?.facebook?.streamKey;
  const igKey =
    instagramKey !== undefined && instagramKey !== null
      ? instagramKey
      : config.platforms?.instagram?.streamKey;

  const updated = updatePushKeys(config, {
    facebookKey: fbKey,
    instagramKey: igKey,
  });
  if (!updated.ok) return updated;

  const reloaded = reloadNginx(config);
  if (!reloaded.ok) {
    notify("nginx", reloaded.reason, "warn");
    return { ...updated, ...reloaded };
  }

  const parts = [];
  if (updated.facebook) parts.push("FB");
  if (updated.instagram) parts.push("IG");
  notify(
    "nginx",
    parts.length
      ? `Push ${parts.join("+")} (stunnel) mis à jour + reload`
      : "Push FB/IG retirés + reload — OBS peut continuer sans Meta",
    "info",
  );
  return { ok: true, ...updated, reloaded: true, listen };
}

/**
 * Coupe le republish nginx d’une plateforme Meta sans toucher au stream OBS.
 * L’autre plateforme garde sa clé si elle est encore active.
 */
function clearPlatformPush(config, platform) {
  const which = String(platform || "").toLowerCase();
  const fbKeep =
    which === "facebook" ? "" : config.platforms?.facebook?.streamKey || "";
  const igKeep =
    which === "instagram" ? "" : config.platforms?.instagram?.streamKey || "";
  return applyLiveKeys(config, {
    facebookKey: fbKeep,
    instagramKey: igKeep,
  });
}

module.exports = {
  DEFAULT_NGINX_DIR,
  resolveNginxPaths,
  isNginxListening1935,
  updatePushKeys,
  reloadNginx,
  applyLiveKeys,
  clearPlatformPush,
};
