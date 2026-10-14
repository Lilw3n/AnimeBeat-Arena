/**
 * Viewers live par plateforme (Kick API + Twitch public/Helix + SSN).
 * TikTok / IG / FB : compteurs publics via SSN uniquement (pas de liste « privée »).
 */
const { pushToWindows } = require("./notify");
const { buildLiveLinks } = require("./live-links");

const POLL_MS = 12000;

/** @type {Record<string, { count: number|null, live: boolean|null, source: string, at: number, note?: string }>} */
let snapshot = {
  kick: { count: null, live: null, source: "", at: 0 },
  twitch: { count: null, live: null, source: "", at: 0 },
  tiktok: { count: null, live: null, source: "ssn", at: 0, note: "Total public via SSN — pas de liste privée" },
  instagram: { count: null, live: null, source: "ssn", at: 0 },
  facebook: { count: null, live: null, source: "ssn", at: 0 },
  youtube: { count: null, live: null, source: "ssn", at: 0 },
};

let timer = null;
let lastConfig = null;
let polling = false;
let lastKickWindowAt = 0;

function getSnapshot() {
  return {
    platforms: { ...snapshot },
    at: Date.now(),
    notes: {
      kick: "API Kick publique (viewer_count).",
      twitch: "Helix si token, sinon page publique Twitch.",
      tiktok:
        "Total viewers public via SSN (source TikTok ouverte). TikTok n’expose pas la liste des viewers privés.",
      ssn: "Active « Show viewer count » ou Hype Mode dans Social Stream Ninja.",
    },
  };
}

function setPlatform(key, patch) {
  const k = String(key || "").toLowerCase();
  if (!k) return;
  const prev = snapshot[k] || { count: null, live: null, source: "", at: 0 };
  snapshot[k] = {
    ...prev,
    ...patch,
    at: Date.now(),
  };
  pushToWindows({ type: "live-viewers", ...getSnapshot() });
}

function mapSsnType(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("kick")) return "kick";
  if (t.includes("twitch")) return "twitch";
  if (t.includes("tiktok") || t.includes("tik tok")) return "tiktok";
  if (t.includes("instagram") || t === "ig") return "instagram";
  if (t.includes("facebook") || t === "fb") return "facebook";
  if (t.includes("youtube") || t === "youtubeshorts" || t === "yt") return "youtube";
  return null;
}

function toCount(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[^\d.]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === "object") {
    return toCount(raw.count ?? raw.viewers ?? raw.viewer_count ?? raw.viewercount ?? raw.total);
  }
  return null;
}

/** Appelé par ssn-bridge quand un event viewers arrive. */
function ingestSsnPayload(data) {
  if (!data || typeof data !== "object") return;

  const event = String(data.event || data.action || "").toLowerCase();

  if ((event === "viewer_updates" || event === "viewers_update") && data.meta && typeof data.meta === "object") {
    for (const [type, count] of Object.entries(data.meta)) {
      const key = mapSsnType(type);
      if (!key) continue;
      const n = toCount(count);
      if (n == null) continue;
      setPlatform(key, {
        count: n,
        live: n > 0 ? true : snapshot[key]?.live ?? null,
        source: "ssn",
      });
    }
    return;
  }

  if (event === "viewer_update" || event === "likes_update" || event === "viewerupdate") {
    const key = mapSsnType(data.type || data.platform || data.source || data.site);
    if (!key) return;
    const n = toCount(data.meta ?? data.viewercount ?? data.viewers ?? data.count ?? data.likes);
    if (n == null) return;
    if (event === "likes_update") {
      setPlatform(key, { likes: n, source: "ssn" });
      return;
    }
    setPlatform(key, {
      count: n,
      live: n > 0 ? true : snapshot[key]?.live ?? null,
      source: "ssn",
    });
    return;
  }

  // Payloads SSN sans event explicite
  const key = mapSsnType(data.type || data.platform || data.source);
  const n = toCount(data.viewercount ?? data.viewers ?? data.viewer_count ?? data.count);
  if (key && n != null && (data.viewercount != null || data.viewers != null || data.viewer_count != null)) {
    setPlatform(key, {
      count: n,
      live: n > 0 ? true : snapshot[key]?.live ?? null,
      source: "ssn",
    });
  }
}

function loginFromUrl(url, hostRe, pathIndex = 0) {
  try {
    const u = new URL(String(url || ""));
    if (!hostRe.test(u.hostname)) return "";
    const parts = u.pathname.split("/").filter(Boolean);
    let handle = parts[pathIndex] || "";
    if (handle === "popout" || handle === "u") handle = parts[pathIndex + 1] || "";
    return String(handle || "")
      .replace(/^@/, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

function resolveLogins(config = {}) {
  const links = buildLiveLinks(config);
  const byId = Object.fromEntries(links.map((l) => [l.id, l.url]));
  const kick =
    String(config.platforms?.kick?.login || "")
      .replace(/^@/, "")
      .toLowerCase() || loginFromUrl(byId.kick, /kick\.com/i);
  const twitch =
    String(config.platforms?.twitch?.login || "")
      .replace(/^@/, "")
      .toLowerCase() || loginFromUrl(byId.twitch, /twitch\.tv/i);
  const tiktok =
    String(config.platforms?.tiktok?.username || "")
      .replace(/^@/, "")
      .toLowerCase() ||
    loginFromUrl(byId.tiktok || byId["tiktok-1"], /tiktok\.com/i)?.replace(/^@/, "") ||
    "";
  return { kick, twitch, tiktok };
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Kick bloque souvent le fetch Node (403) — utilise la session Chromium Electron. */
async function electronFetch(url, { partition = "persist:kick-viewers", headers = {} } = {}) {
  try {
    const { session } = require("electron");
    const ses = session.fromPartition(partition);
    if (typeof ses.fetch === "function") {
      return await ses.fetch(url, { headers });
    }
  } catch {
    /* pas encore prêt / hors Electron */
  }
  return fetch(url, { headers });
}

async function fetchKickViaHiddenWindow(slug) {
  let win = null;
  try {
    const { BrowserWindow } = require("electron");
    win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        partition: "persist:kick-viewers",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await win.loadURL(`https://kick.com/${encodeURIComponent(slug)}`);
    const result = await Promise.race([
      win.webContents.executeJavaScript(
        `(async () => {
          const res = await fetch("/api/v2/channels/${slug.replace(/[^a-z0-9_-]/gi, "")}", {
            headers: { Accept: "application/json" },
            credentials: "include",
          });
          if (!res.ok) return { ok: false, status: res.status };
          const json = await res.json();
          const live = json && json.livestream;
          if (!live) return { ok: true, live: false, count: 0 };
          return {
            ok: true,
            live: true,
            count: Number(live.viewer_count || live.viewers || 0) || 0,
            title: live.session_title || "",
          };
        })()`,
        true,
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout kick window")), 15000)),
    ]);
    return result;
  } catch (err) {
    return { ok: false, reason: err.message || "kick window" };
  } finally {
    try {
      if (win && !win.isDestroyed()) win.destroy();
    } catch {
      /* ignore */
    }
  }
}

function parseKickChannelJson(json) {
  const live = json?.livestream || null;
  if (!live) return { ok: true, live: false, count: 0 };
  const count = Number(live.viewer_count ?? live.viewers);
  return {
    ok: true,
    live: true,
    count: Number.isFinite(count) ? count : 0,
    title: live.session_title || "",
  };
}

async function fetchKickViewers(login) {
  const slug = String(login || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!slug) return null;

  const headers = {
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Referer: `https://kick.com/${slug}`,
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  };

  try {
    const res = await electronFetch(
      `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
      { partition: "persist:kick-viewers", headers },
    );
    if (res.ok) {
      const json = await res.json();
      return { ...parseKickChannelJson(json), source: "kick-api" };
    }
    if (res.status === 403 || res.status === 429) {
      // Fenêtre Chromium max 1× / 45s (Kick bloque le fetch Node)
      if (Date.now() - lastKickWindowAt > 45000) {
        lastKickWindowAt = Date.now();
        const viaWin = await fetchKickViaHiddenWindow(slug);
        if (viaWin?.ok) return { ...viaWin, source: "kick-page" };
        return viaWin || { ok: false, status: res.status };
      }
      return {
        ok: false,
        status: res.status,
        reason: "Kick anti-bot — attend SSN ou réessai",
      };
    }
    return { ok: false, status: res.status };
  } catch (err) {
    if (Date.now() - lastKickWindowAt > 45000) {
      lastKickWindowAt = Date.now();
      const viaWin = await fetchKickViaHiddenWindow(slug);
      if (viaWin?.ok) return { ...viaWin, source: "kick-page" };
    }
    return { ok: false, reason: err.message || "kick fetch" };
  }
}

async function fetchTwitchHelix(twitch) {
  const login = String(twitch?.login || "")
    .trim()
    .toLowerCase();
  const token = String(twitch?.accessToken || "").trim();
  const clientId = String(twitch?.clientId || "").trim();
  if (!login || !token || !clientId) return null;
  try {
    const res = await fetchWithTimeout(
      `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Client-Id": clientId,
        },
      },
      10000,
    );
    if (!res.ok) return { ok: false, status: res.status };
    const json = await res.json();
    const stream = Array.isArray(json.data) ? json.data[0] : null;
    if (!stream) return { ok: true, live: false, count: 0 };
    return {
      ok: true,
      live: true,
      count: Number(stream.viewer_count) || 0,
      title: stream.title || "",
      source: "twitch-helix",
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/** Sans token Helix : lit le compteur public sur la page Twitch. */
async function fetchTwitchPublic(login) {
  const handle = String(login || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!handle) return null;
  try {
    const res = await fetchWithTimeout(
      `https://www.twitch.tv/${encodeURIComponent(handle)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html",
        },
      },
      10000,
    );
    if (!res.ok) return { ok: false, status: res.status };
    const html = await res.text();
    const live = /"isLiveBroadcast"\s*:\s*true|"isLive"\s*:\s*true/i.test(html);
    const viewersRaw =
      html.match(/"viewersCount"\s*:\s*(\d+)/i)?.[1] ||
      html.match(/"viewerCount"\s*:\s*(\d+)/i)?.[1] ||
      html.match(/data-a-target="animated-channel-viewers-count"[^>]*>\s*([\d\s.,]+)/i)?.[1] ||
      "";
    const count = Number(String(viewersRaw).replace(/[^\d]/g, ""));
    if (!live) {
      return { ok: true, live: false, count: 0, source: "twitch-page" };
    }
    return {
      ok: true,
      live: true,
      count: Number.isFinite(count) ? count : null,
      source: "twitch-page",
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function fetchTwitchViewers(twitchConfig, login) {
  const helix = await fetchTwitchHelix({ ...(twitchConfig || {}), login });
  if (helix?.ok) return helix;
  return fetchTwitchPublic(login);
}

async function pollOnce(config) {
  if (polling) return getSnapshot();
  polling = true;
  lastConfig = config || lastConfig;
  const cfg = lastConfig || {};
  try {
    const { kick, twitch } = resolveLogins(cfg);

    if (kick) {
      const k = await fetchKickViewers(kick);
      if (k?.ok) {
        setPlatform("kick", {
          count: k.count,
          live: k.live,
          source: k.source || "kick-api",
          title: k.title || undefined,
          note: undefined,
        });
      } else if (k && !k.ok) {
        setPlatform("kick", {
          source: "kick",
          note: k.reason || `HTTP ${k.status || "?"} — utilise SSN si bloqué`,
        });
      }
    }

    if (twitch) {
      const t = await fetchTwitchViewers(cfg.platforms?.twitch, twitch);
      if (t?.ok) {
        setPlatform("twitch", {
          count: t.count,
          live: t.live,
          source: t.source || "twitch",
          title: t.title || undefined,
        });
      } else if (t && !t.ok) {
        setPlatform("twitch", {
          source: "twitch",
          note: t.reason || `HTTP ${t.status || "?"}`,
        });
      }
    }
  } finally {
    polling = false;
  }
  return getSnapshot();
}

function start(config) {
  lastConfig = config || lastConfig;
  stop();
  pollOnce(lastConfig).catch(() => {});
  timer = setInterval(() => {
    pollOnce(lastConfig).catch(() => {});
  }, POLL_MS);
  return getSnapshot();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function refresh(config) {
  return pollOnce(config || lastConfig).then(() => getSnapshot());
}

module.exports = {
  start,
  stop,
  refresh,
  getSnapshot,
  ingestSsnPayload,
  fetchKickViewers,
  mapSsnType,
  resolveLogins,
};
