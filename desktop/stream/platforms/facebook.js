const producer = require("./facebook-live-producer");

async function createLive(facebookConfig, { title, description }) {
  if (!facebookConfig.enabled) return { ok: false, skipped: true, platform: "facebook" };
  if (!facebookConfig.accessToken) {
    return { ok: false, platform: "facebook", reason: "accessToken Facebook manquant" };
  }

  const target = facebookConfig.pageId || "me";
  const params = new URLSearchParams({
    status: "LIVE_NOW",
    title: String(title || "Live").slice(0, 254),
    description: String(description || title || "").slice(0, 1000),
    access_token: facebookConfig.accessToken,
  });

  const res = await fetch(`https://graph.facebook.com/v21.0/${target}/live_videos`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      platform: "facebook",
      reason: json?.error?.message || res.statusText,
    };
  }

  const secure = json.secure_stream_url || json.stream_url || "";
  const parsed = splitRtmpUrl(secure);

  return {
    ok: true,
    platform: "facebook",
    liveVideoId: json.id,
    streamUrl: secure,
    rtmpUrl: parsed.server,
    streamKey: parsed.key,
  };
}

function splitRtmpUrl(fullUrl) {
  if (!fullUrl) return { server: "", key: "" };
  const marker = "/rtmp/";
  const idx = fullUrl.lastIndexOf(marker);
  if (idx === -1) {
    const lastSlash = fullUrl.lastIndexOf("/");
    return {
      server: fullUrl.slice(0, lastSlash),
      key: fullUrl.slice(lastSlash + 1),
    };
  }
  return {
    server: fullUrl.slice(0, idx + marker.length - 1),
    key: fullUrl.slice(idx + marker.length),
  };
}

async function endLive(facebookConfig, liveVideoId) {
  if (!liveVideoId || !facebookConfig.accessToken) {
    return { ok: false, reason: "liveVideoId ou token manquant" };
  }
  const params = new URLSearchParams({
    end_live_video: "true",
    access_token: facebookConfig.accessToken,
  });
  const res = await fetch(`https://graph.facebook.com/v21.0/${liveVideoId}`, {
    method: "POST",
    body: params,
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    return { ok: false, reason: json?.error?.message || res.statusText };
  }
  return { ok: true };
}

/**
 * Met à jour titre/description d’un live FB en cours via Graph (sans Producer UI).
 * Résout liveVideoId depuis la config ou /page/live_videos?broadcast_status=LIVE.
 */
async function updateLiveViaGraph(facebookConfig = {}, { title, description, game } = {}) {
  const token = String(facebookConfig.accessToken || "").trim();
  if (!token) return { ok: false, reason: "accessToken Facebook manquant" };

  let liveId = String(
    facebookConfig.liveVideoId || facebookConfig.liveId || "",
  ).trim();
  if (!liveId) {
    try {
      const found = await producer.fetchLiveUrlFromGraph(facebookConfig);
      if (found?.ok && found.liveId) liveId = String(found.liveId);
    } catch {
      /* optional */
    }
  }
  if (!liveId) {
    return { ok: false, reason: "aucun live LIVE (Graph) — Producer UI en secours" };
  }

  const cleanTitle = String(title || "").trim().slice(0, 254);
  const cleanDesc = String(
    description || `${cleanTitle}${game ? ` — ${game}` : ""}`,
  )
    .trim()
    .slice(0, 1000);
  if (!cleanTitle && !cleanDesc) {
    return { ok: false, reason: "titre/description vides" };
  }

  const params = new URLSearchParams({ access_token: token });
  if (cleanTitle) params.set("title", cleanTitle);
  if (cleanDesc) params.set("description", cleanDesc);

  const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(liveId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      platform: "facebook",
      reason: json?.error?.message || res.statusText,
      liveId,
    };
  }
  try {
    const { loadConfig, saveConfig } = require("../config");
    const cfg = loadConfig();
    saveConfig({
      ...cfg,
      platforms: {
        ...cfg.platforms,
        facebook: {
          ...(cfg.platforms?.facebook || {}),
          liveId,
          liveVideoId: liveId,
          lastTitle: cleanTitle || cfg.platforms?.facebook?.lastTitle || "",
          ...(game ? { lastGame: String(game) } : {}),
        },
      },
    });
  } catch {
    /* optional */
  }
  return {
    ok: true,
    platform: "facebook",
    live: true,
    via: "graph",
    liveId,
    title: cleanTitle,
  };
}

/**
 * Vérifie le token Graph (PAGE) et liste un live LIVE éventuel.
 */
async function testGraph(facebookConfig = {}) {
  const token = String(facebookConfig.accessToken || "").trim();
  const pageId = String(facebookConfig.pageId || "").trim();
  if (!token) {
    return {
      ok: false,
      reason: "Colle un Page Access Token dans Facebook → Token Graph API",
    };
  }
  try {
    const meUrl = `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`;
    const meRes = await fetch(meUrl);
    const me = await meRes.json().catch(() => ({}));
    if (!meRes.ok) {
      return { ok: false, reason: me?.error?.message || "Token invalide", me };
    }

    let page = null;
    if (pageId) {
      const pUrl =
        `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}` +
        `?fields=id,name,access_token&access_token=${encodeURIComponent(token)}`;
      const pRes = await fetch(pUrl);
      page = await pRes.json().catch(() => ({}));
      if (!pRes.ok) {
        return {
          ok: false,
          reason: page?.error?.message || `Page ${pageId} inaccessible avec ce token`,
          me,
          page,
        };
      }
    }

    const live = await producer.fetchLiveUrlFromGraph({
      ...facebookConfig,
      accessToken: token,
      pageId: pageId || me.id,
    });

    return {
      ok: true,
      tokenAs: me.name || me.id,
      tokenId: me.id,
      page: page
        ? { id: page.id, name: page.name }
        : null,
      live: live?.ok
        ? { liveId: live.liveId, liveUrl: live.liveUrl }
        : { active: false, reason: live?.reason || "pas de live LIVE en ce moment" },
      tip: live?.ok
        ? "OK — maj titre via Graph possible pendant ce live"
        : "Token OK — la maj Graph marchera dès qu’un live PAGE est LIVE",
    };
  } catch (err) {
    return { ok: false, reason: err.message || "échec test Graph" };
  }
}

/**
 * Titre/jeu FB : Graph si live en cours + token, sinon Live Producer (auto-ouverture).
 */
async function updateTitleGame(opts = {}) {
  const facebookConfig = opts.facebookConfig || {};
  const graph = await updateLiveViaGraph(facebookConfig, opts).catch((err) => ({
    ok: false,
    reason: err.message,
  }));
  if (graph?.ok) return graph;

  const ui = await producer.updateTitleGame({
    ...opts,
    facebookConfig,
    autoOpen: opts.autoOpen !== false,
  });
  if (ui?.ok) return ui;
  return {
    ok: false,
    platform: "facebook",
    reason: ui?.reason || graph?.reason || "échec titre FB",
    graph,
    ui,
  };
}

function getRtmpDestination(facebookConfig, liveSession) {
  if (!facebookConfig.enabled) return null;
  if (liveSession?.rtmpUrl && liveSession?.streamKey) {
    return {
      platform: "facebook",
      server: liveSession.rtmpUrl,
      key: liveSession.streamKey,
      url: `${liveSession.rtmpUrl.replace(/\/$/, "")}/${liveSession.streamKey}`,
    };
  }
  if (facebookConfig.streamKey) {
    const server = (facebookConfig.rtmpUrl || "rtmps://live-api-s.facebook.com:443/rtmp").replace(
      /\/$/,
      "",
    );
    return {
      platform: "facebook",
      server,
      key: facebookConfig.streamKey,
      url: `${server}/${facebookConfig.streamKey}`,
    };
  }
  return null;
}

/**
 * Live Producer web sur la PAGE (pas le profil perso).
 */
async function prepareViaProducer(
  facebookConfig,
  { title, game, description, linkUrl, linkTitle } = {},
) {
  return producer.prepareLive(facebookConfig, {
    title,
    game,
    description,
    linkUrl: linkUrl ?? facebookConfig.linkUrl,
    linkTitle: linkTitle ?? facebookConfig.linkTitle,
  });
}

async function goLive(options) {
  return producer.goLive(options || {});
}

async function watchAndGoLive(timeoutMs) {
  return producer.watchAndGoLive(timeoutMs);
}

module.exports = {
  createLive,
  endLive,
  getRtmpDestination,
  splitRtmpUrl,
  prepareViaProducer,
  goLive,
  watchAndGoLive,
  openProducer: (cfg) => producer.openProducer(cfg),
  getProducerStatus: () => producer.getStatus(),
  updateTitleGame,
  updateLiveViaGraph,
  testGraph,
  updateStickyLink: (opts) =>
    producer.updateStickyLink({
      ...opts,
      facebookConfig: opts?.facebookConfig,
      autoOpen: opts?.autoOpen !== false,
    }),
  capturePublicLiveUrl: (cfg) => producer.capturePublicLiveUrl(cfg),
  endBroadcast: () => producer.endBroadcast(),
  DEFAULT_PAGE_URL: producer.DEFAULT_PAGE_URL,
};
