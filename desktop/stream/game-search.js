const twitch = require("./platforms/twitch");
const kick = require("./platforms/kick");
const { notifyGameNotFound } = require("./notify");

function normalize(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreMatch(query, name) {
  const q = normalize(query);
  const n = normalize(name);
  if (!q || !n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 90;
  if (n.includes(q)) return 75;
  const qTokens = q.split(" ").filter(Boolean);
  if (!qTokens.length) return 0;
  const hit = qTokens.filter((t) => t.length > 1 && n.includes(t)).length;
  if (!hit) return 0;
  return Math.round((hit / qTokens.length) * 55);
}

/**
 * Recherche unifiée :
 * - Twitch = jeux (Helix categories/games)
 * - Kick = catégories / sous-catégories (pas les racines Games/IRL/…)
 * Les deux sont listés séparément ; le « best » privilégie Twitch pour l’id Helix,
 * et garde le match Kick si le nom correspond.
 */
async function searchGames(config, query) {
  const q = String(query || "").trim();
  if (!q) return { query: q, results: [], best: null, twitch: [], kick: [] };

  const [twitchGames, kickCats] = await Promise.all([
    twitch.searchGames(config.platforms?.twitch || {}, q),
    kick.searchCategories(q),
  ]);

  const twitchResults = (twitchGames || []).map((g) => ({
    ...g,
    kind: "game",
    label: "Twitch · jeu",
    score: scoreMatch(q, g.name),
  }));

  const kickResults = (kickCats || []).map((g) => ({
    ...g,
    kind: g.kind || "category",
    label: g.label || "Kick · catégorie",
    score: scoreMatch(q, g.name),
  }));

  // Ne garder que les résultats pertinents (évite score 0 = bruit)
  const minScore = 40;
  const merged = [...twitchResults, ...kickResults]
    .filter((g) => g.score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // À score égal: Twitch jeu avant Kick catégorie
      if (a.platform !== b.platform) return a.platform === "twitch" ? -1 : 1;
      return (b.viewers || 0) - (a.viewers || 0);
    });

  // Dédup par nom normalisé (garde le meilleur score / twitch en premier déjà trié)
  const seen = new Set();
  const results = [];
  for (const g of merged) {
    const key = normalize(g.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(g);
  }

  const best = results[0] && results[0].score >= 60 ? results[0] : null;

  return {
    query: q,
    results: results.slice(0, 20),
    best,
    twitch: twitchResults.filter((g) => g.score >= minScore).slice(0, 12),
    kick: kickResults.filter((g) => g.score >= minScore).slice(0, 12),
  };
}

async function resolveGame(config, query, { notifyIfMissing = true } = {}) {
  const search = await searchGames(config, query);
  if (!search.best) {
    if (notifyIfMissing && query.trim()) notifyGameNotFound(query);
    return { found: false, query, results: search.results, game: null };
  }

  // Twitch jeu pour Helix ; Kick catégorie pour SB / affichage
  const twitchBest =
    search.results.find((r) => r.platform === "twitch" && r.score >= 60) || null;
  const kickBest =
    search.results.find((r) => r.platform === "kick" && r.score >= 60) || null;

  const primary = twitchBest || search.best;
  const game = {
    name: primary.name,
    twitchId: twitchBest?.id || null,
    kickId: kickBest?.id || null,
    twitchName: twitchBest?.name || null,
    kickName: kickBest?.name || null,
    kind: primary.kind,
    results: search.results,
  };

  return { found: true, query, game, results: search.results };
}

module.exports = { searchGames, resolveGame, normalize, scoreMatch };
