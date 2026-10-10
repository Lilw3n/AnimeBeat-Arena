/**
 * Viewers live par plateforme (Kick API + SSN viewer_update).
 * TikTok / IG / FB : compteurs publics via SSN uniquement (pas de liste « privée »).
 */
const { pushToWindows } = require("./notify");

const POLL_MS = 15000;

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

function getSnapshot() {
  return {
    platforms: { ...snapshot },
    at: Date.now(),
    notes: {
      kick: "API Kick publique (viewer_count). 0 si le streamer masque le compteur.",
      tiktok:
        "Total viewers public via SSN (source TikTok ouverte). TikTok n’expose pas la liste des viewers « privés » / guests aux apps tierces.",
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

/** Normalise les types SSN → clé hub. */
function mapSsnType(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("kick")) return "kick";
  if (t.includes("twitch")) return "twitch";
  if (t.includes("tiktok")) return "tiktok";
  if (t.includes("instagram")) return "instagram";
  if (t.includes("facebook") || t === "fb") return "facebook";
  if (t.includes("youtube") || t === "youtubeshorts") return "youtube";
  return t || null;
}

/** Appelé par ssn-bridge quand un event viewers arrive. */
function ingestSsnPayload(data) {
  if (!data || typeof data !== "object") return;

  const event = String(data.event || "").toLowerCase();

  if (event === "viewer_updates" && data.meta && typeof data.meta === "object") {
    for (const [type, count] of Object.entries(data.meta)) {
      const key = mapSsnType(type);
      if (!key) continue;
      const n = Number(count);
      if (!Number.isFinite(n)) continue;
      setPlatform(key, {
        count: n,
        live: n > 0 ? true : snapshot[key]?.live,
        source: "ssn",
      });
    }
    return;
  }

  if (event === "viewer_update" || event === "likes_update") {
    const key = mapSsnType(data.type || data.platform || data.source);
    if (!key) return;
    const n = Number(data.meta);
    if (!Number.isFinite(n)) return;
    if (event === "likes_update") {
      setPlatform(key, {
        likes: n,
        source: "ssn",
      });
      return;
    }
    setPlatform(key, {
      count: n,
      live: n > 0 ? true : snapshot[key]?.live,
      source: "ssn",
    });
  }
}

async function fetchKickViewers(login) {
  const slug = String(login || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!slug) return null;
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "AnimeBeatLiveHub/1.0",
      },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const json = await res.json();
    const live = json?.livestream || null;
    if (!live) {
      return { ok: true, live: false, count: 0 };
    }
    const count = Number(live.viewer_count);
    return {
      ok: true,
      live: true,
      count: Number.isFinite(count) ? count : 0,
      title: live.session_title || "",
    };
  } catch (err) {
    return { ok: false, reason: err.message || "kick fetch" };
  }
}

async function fetchTwitchViewers(twitch) {
  const login = String(twitch?.login || "")
    .trim()
    .toLowerCase();
  const token = String(twitch?.accessToken || "").trim();
  const clientId = String(twitch?.clientId || "").trim();
  if (!login || !token || !clientId) return null;
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Client-Id": clientId,
        },
      },
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
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function pollOnce(config) {
  lastConfig = config || lastConfig;
  const cfg = lastConfig || {};
  const kickLogin = cfg.platforms?.kick?.login || "";
  if (kickLogin) {
    const k = await fetchKickViewers(kickLogin);
    if (k?.ok) {
      setPlatform("kick", {
        count: k.count,
        live: k.live,
        source: "kick-api",
        title: k.title || undefined,
      });
    }
  }

  const tw = cfg.platforms?.twitch;
  if (tw?.enabled && tw.accessToken && tw.clientId) {
    const t = await fetchTwitchViewers(tw);
    if (t?.ok) {
      setPlatform("twitch", {
        count: t.count,
        live: t.live,
        source: "twitch-helix",
        title: t.title || undefined,
      });
    }
  }
}

function start(config) {
  lastConfig = config || lastConfig;
  stop();
  pollOnce(lastConfig);
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
};
