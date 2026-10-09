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
async function prepareViaProducer(facebookConfig, { title, game, description } = {}) {
  return producer.prepareLive(facebookConfig, { title, game, description });
}

async function goLive(options) {
  return producer.goLive(options);
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
  DEFAULT_PAGE_URL: producer.DEFAULT_PAGE_URL,
};
