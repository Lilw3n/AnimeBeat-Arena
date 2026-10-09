async function searchCategories(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  try {
    const url = new URL("https://kick.com/api/v1/categories");
    url.searchParams.set("q", q);
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "AnimeBeatLiveHub/1.0",
      },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const list = Array.isArray(json) ? json : json.data || json.categories || [];
    return list.slice(0, 12).map((c) => ({
      id: String(c.id ?? c.category_id ?? c.slug ?? c.name),
      name: c.name || c.category?.name || String(c.slug || ""),
      boxArtUrl: c.banner?.url || c.category?.banner?.url || "",
      platform: "kick",
    }));
  } catch {
    return [];
  }
}

function getRtmpDestination(kickConfig) {
  if (!kickConfig.enabled || !kickConfig.streamKey) return null;
  const server = (kickConfig.rtmpUrl || "").replace(/\/$/, "");
  if (!server) return null;
  return {
    platform: "kick",
    server,
    key: kickConfig.streamKey,
    url: `${server}/${kickConfig.streamKey}`,
  };
}

async function updateChannelMeta(kickConfig, { title, gameName }) {
  // Pas d'API write publique Kick — le hub doit passer par Streamer.bot.
  return {
    ok: false,
    skipped: !kickConfig?.enabled,
    platform: "kick",
    localOnly: true,
    title,
    gameName,
    reason:
      "Kick: utilise Streamer.bot (compte Kick lié + AnimeBeat Set Title Game) — pas d’API write dans le hub",
  };
}

module.exports = {
  searchCategories,
  getRtmpDestination,
  updateChannelMeta,
};
