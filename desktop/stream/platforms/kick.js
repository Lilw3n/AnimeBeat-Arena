/** Catégories racines Kick (pas des jeux) — à exclure de la recherche. */
const ROOT_CATEGORY_NAMES = new Set([
  "games",
  "irl",
  "music",
  "gambling",
  "creative",
  "alternative",
]);

/**
 * Kick : recherche de SOUS-catégories (= « jeux » / catégories de stream).
 * Ne pas utiliser /api/v1/categories (renvoie Games/IRL/Music…).
 */
async function searchCategories(query) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];
  try {
    const url = new URL("https://kick.com/api/search");
    url.searchParams.set("searched_word", q);
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        // UA « navigateur » est souvent 403 Cloudflare — garder un UA simple
        "User-Agent": "AnimeBeatLiveHub/1.0",
      },
    });
    if (!res.ok) return [];
    const json = await res.json();
    // « categories » ici = sous-catégories (Aniimo, Genshin Impact, Just Chatting…)
    const list = Array.isArray(json.categories) ? json.categories : [];
    return list
      .map((c) => {
        const name = c.name || c.category?.name || String(c.slug || "");
        const slug = String(c.slug || name).toLowerCase();
        if (ROOT_CATEGORY_NAMES.has(slug) || ROOT_CATEGORY_NAMES.has(name.toLowerCase())) {
          return null;
        }
        return {
          id: String(c.id ?? c.category_id ?? c.slug ?? name),
          name,
          slug,
          boxArtUrl:
            c.banner?.src ||
            c.banner?.url ||
            (typeof c.banner?.srcset === "string" ? c.banner.srcset.split(" ")[0] : "") ||
            "",
          viewers: Number(c.viewers) || 0,
          parentCategoryId: c.category_id ?? null,
          platform: "kick",
          kind: "category", // Kick = catégorie / sous-catégorie, pas « jeu Twitch »
          label: "Kick · catégorie",
        };
      })
      .filter(Boolean)
      .slice(0, 12);
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

async function fetchChannelViewers(login) {
  const slug = String(login || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!slug) return { ok: false, reason: "login Kick manquant" };
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
    if (!live) return { ok: true, live: false, count: 0, slug };
    return {
      ok: true,
      live: true,
      count: Number(live.viewer_count) || 0,
      title: live.session_title || "",
      slug,
    };
  } catch (err) {
    return { ok: false, reason: err.message || "kick viewers" };
  }
}

module.exports = {
  searchCategories,
  getRtmpDestination,
  updateChannelMeta,
  fetchChannelViewers,
  ROOT_CATEGORY_NAMES,
};
