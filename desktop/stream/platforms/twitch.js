let cachedAppToken = { token: "", expiresAt: 0 };

async function getAppAccessToken(clientId, clientSecret) {
  if (!clientId || !clientSecret) return null;
  if (cachedAppToken.token && Date.now() < cachedAppToken.expiresAt) {
    return cachedAppToken.token;
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });
  const res = await fetch(`https://id.twitch.tv/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const json = await res.json();
  cachedAppToken = {
    token: json.access_token,
    expiresAt: Date.now() + Math.max(60, (json.expires_in || 3600) - 120) * 1000,
  };
  return cachedAppToken.token;
}

function authHeaders(clientId, token) {
  return {
    "Client-ID": clientId,
    Authorization: `Bearer ${token}`,
  };
}

async function searchGames(twitchConfig, query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const clientId = twitchConfig.clientId;
  if (!clientId) return [];

  let token = twitchConfig.accessToken;
  if (!token) {
    token = await getAppAccessToken(clientId, twitchConfig.clientSecret);
  }
  if (!token) return [];

  const url = new URL("https://api.twitch.tv/helix/search/categories");
  url.searchParams.set("query", q);
  url.searchParams.set("first", "12");
  const res = await fetch(url, { headers: authHeaders(clientId, token) });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data || []).map((g) => ({
    id: g.id,
    name: g.name,
    boxArtUrl: g.box_art_url,
    platform: "twitch",
  }));
}

async function resolveBroadcasterId(twitchConfig) {
  if (twitchConfig.broadcasterId) return twitchConfig.broadcasterId;
  if (!twitchConfig.accessToken || !twitchConfig.clientId) return null;
  const res = await fetch("https://api.twitch.tv/helix/users", {
    headers: authHeaders(twitchConfig.clientId, twitchConfig.accessToken),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.data?.[0]?.id || null;
}

async function updateChannel(twitchConfig, { title, gameId }) {
  if (!twitchConfig.enabled) return { ok: false, skipped: true, platform: "twitch" };
  if (!twitchConfig.accessToken || !twitchConfig.clientId) {
    return { ok: false, platform: "twitch", reason: "Token Twitch manquant" };
  }
  const broadcasterId = await resolveBroadcasterId(twitchConfig);
  if (!broadcasterId) {
    return { ok: false, platform: "twitch", reason: "broadcasterId introuvable" };
  }

  const body = {};
  if (typeof title === "string" && title.trim()) body.title = title.trim().slice(0, 140);
  if (gameId) body.game_id = String(gameId);

  const res = await fetch(
    `https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(broadcasterId)}`,
    {
      method: "PATCH",
      headers: {
        ...authHeaders(twitchConfig.clientId, twitchConfig.accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, platform: "twitch", reason: text || res.statusText };
  }
  return { ok: true, platform: "twitch", broadcasterId };
}

function getRtmpDestination(twitchConfig) {
  if (!twitchConfig.enabled || !twitchConfig.streamKey) return null;
  const server = (twitchConfig.rtmpUrl || "rtmp://live.twitch.tv/app").replace(/\/$/, "");
  return {
    platform: "twitch",
    server,
    key: twitchConfig.streamKey,
    url: `${server}/${twitchConfig.streamKey}`,
  };
}

module.exports = {
  searchGames,
  updateChannel,
  getRtmpDestination,
  resolveBroadcasterId,
};
