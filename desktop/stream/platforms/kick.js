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
  // Kick n'a pas d'API publique stable pour titre/catégorie sans OAuth partenaire.
  // On conserve les valeurs côté hub pour l'UI / OBS.
  if (!kickConfig.enabled) return { ok: false, skipped: true, platform: "kick" };
  return {
    ok: true,
    platform: "kick",
    localOnly: true,
    title,
    gameName,
    note: "Kick: titre/jeu appliqués localement (API write limitée). Vérifie dans le dashboard Kick.",
  };
}

module.exports = {
  searchCategories,
  getRtmpDestination,
  updateChannelMeta,
};
