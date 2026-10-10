/**
 * Client HTTP pour SSApp Control API (Social Stream Ninja desktop).
 * Port défaut: http://127.0.0.1:17777 — nécessite --ssapp-control-api au lancement.
 */
const { notify } = require("./notify");

const DEFAULT_BASE = "http://127.0.0.1:17777";

function baseUrl(config = {}) {
  return String(config.socialStreamNinja?.ssappControlUrl || DEFAULT_BASE).replace(/\/$/, "");
}

async function request(config, method, path, body) {
  const url = `${baseUrl(config)}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: json?.error?.message || json?.message || text.slice(0, 200) || res.statusText,
        json,
      };
    }
    return { ok: true, status: res.status, ...json };
  } catch (err) {
    return {
      ok: false,
      reason:
        err.name === "AbortError"
          ? "timeout SSApp Control API"
          : err.message || "SSApp Control API injoignable (lance SSN avec --ssapp-control-api)",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getStatus(config) {
  return request(config, "GET", "/api/v1/status");
}

async function getCapabilities(config) {
  return request(config, "GET", "/api/v1/capabilities");
}

async function command(config, action, value = {}) {
  return request(config, "POST", "/api/v1/command", { action, value });
}

async function waitUntilReady(config, { timeoutMs = 45000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await getStatus(config);
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, 1200));
  }
  return last || { ok: false, reason: "SSApp Control API pas prêt" };
}

function extractSources(statusOrCmd) {
  const payload = statusOrCmd?.payload || statusOrCmd;
  const list =
    payload?.sources ||
    payload?.normalizedSources ||
    payload?.app?.sources ||
    statusOrCmd?.sources ||
    [];
  return Array.isArray(list) ? list : [];
}

function isInstagramLiveSource(src) {
  const id = String(src?.id || src?.sourceId || "").toLowerCase();
  const target = String(src?.target || src?.platform || src?.type || "").toLowerCase();
  return (
    target === "instagramlive" ||
    id.includes("instagramlive") ||
    (/instagram/.test(id) && /live/.test(id))
  );
}

function resolveIgHandle(config = {}) {
  const ig = config.platforms?.instagram || {};
  let user = String(ig.username || "")
    .replace(/^@/, "")
    .trim();
  if (!user && ig.liveUrl) {
    const m = String(ig.liveUrl).match(/instagram\.com\/([A-Za-z0-9._]+)\/live/i);
    if (m) user = m[1];
  }
  if (!user && ig.profileUrl) {
    const m = String(ig.profileUrl).match(/instagram\.com\/([A-Za-z0-9._]+)/i);
    if (m && !/^(p|reel|stories|accounts)$/i.test(m[1])) user = m[1];
  }
  return user;
}

/**
 * Assure qu’une source Instagram Live est présente, à jour, et démarrée dans SSN.
 */
async function ensureInstagramLiveSource(config, { liveUrl, username, forceRestart = true } = {}) {
  const handle = String(username || resolveIgHandle(config) || "").replace(/^@/, "").trim();
  const url =
    String(liveUrl || config.platforms?.instagram?.liveUrl || "").trim() ||
    (handle ? `https://www.instagram.com/${handle}/live/` : "");

  if (!handle && !url) {
    return {
      ok: false,
      reason: "Username / liveUrl Instagram manquant pour SSN",
    };
  }

  let status = await getStatus(config);
  if (!status.ok) {
    return {
      ok: false,
      needControlApi: true,
      reason:
        status.reason ||
        "SSApp Control API off — relance Social Stream avec le hub (flag --ssapp-control-api)",
    };
  }

  let sourcesCmd = await command(config, "getSources", {});
  let sources = extractSources(sourcesCmd.ok ? sourcesCmd : status);
  if (!sources.length) sources = extractSources(status);

  let igSrc = sources.find(isInstagramLiveSource);
  const sourceId = igSrc?.id || igSrc?.sourceId || (handle ? `instagramlive-user-${handle}` : "");

  // Si source active: stop → update URL/user → start (API 1.1.4)
  if (igSrc && forceRestart) {
    await command(config, "stopSource", { sourceId: igSrc.id || igSrc.sourceId });
    await new Promise((r) => setTimeout(r, 800));
    const upd = await command(config, "updateSource", {
      sourceId: igSrc.id || igSrc.sourceId,
      updates: {
        username: handle || igSrc.username,
        url: url || undefined,
        autoActivate: true,
      },
    });
    if (!upd.ok) {
      // certains builds préfèrent restart seul
      const restart = await command(config, "restartSource", {
        sourceId: igSrc.id || igSrc.sourceId,
        confirm: true,
      });
      if (restart.ok) {
        notify("SSN", `Instagram Live relancé (${handle || sourceId})`, "info");
        return { ok: true, restarted: true, sourceId: igSrc.id || igSrc.sourceId, handle, url };
      }
      return { ok: false, reason: upd.reason || restart.reason, sourceId };
    }
    const start = await command(config, "startSource", {
      sourceId: igSrc.id || igSrc.sourceId,
    });
    if (start.ok) {
      notify("SSN", `Chat Instagram Live démarré (${handle})`, "info");
      return { ok: true, started: true, sourceId: igSrc.id || igSrc.sourceId, handle, url };
    }
    const restart = await command(config, "restartSource", {
      sourceId: igSrc.id || igSrc.sourceId,
      confirm: true,
    });
    return {
      ok: Boolean(restart.ok),
      restarted: Boolean(restart.ok),
      reason: restart.reason,
      sourceId: igSrc.id || igSrc.sourceId,
      handle,
      url,
    };
  }

  if (!igSrc) {
    const added = await command(config, "addSource", {
      target: "instagramlive",
      username: handle,
      url: url || undefined,
      autoActivate: true,
    });
    if (!added.ok) {
      return { ok: false, reason: added.reason || "addSource Instagram Live échoué" };
    }
    // re-fetch id
    sourcesCmd = await command(config, "getSources", {});
    sources = extractSources(sourcesCmd);
    igSrc = sources.find(isInstagramLiveSource);
    const id = igSrc?.id || igSrc?.sourceId || sourceId;
    if (id) {
      await command(config, "startSource", { sourceId: id });
    }
    notify("SSN", `Source Instagram Live ajoutée (${handle})`, "info");
    return { ok: true, added: true, sourceId: id, handle, url };
  }

  const start = await command(config, "startSource", {
    sourceId: igSrc.id || igSrc.sourceId,
  });
  return {
    ok: Boolean(start.ok),
    started: Boolean(start.ok),
    reason: start.reason,
    sourceId: igSrc.id || igSrc.sourceId,
    handle,
    url,
  };
}

module.exports = {
  DEFAULT_BASE,
  baseUrl,
  getStatus,
  getCapabilities,
  command,
  waitUntilReady,
  ensureInstagramLiveSource,
  resolveIgHandle,
  isInstagramLiveSource,
};
