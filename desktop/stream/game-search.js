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
  const qTokens = q.split(" ");
  const hit = qTokens.filter((t) => n.includes(t)).length;
  return hit * 15;
}

async function searchGames(config, query) {
  const q = String(query || "").trim();
  if (!q) return { query: q, results: [], best: null };

  const [twitchGames, kickCats] = await Promise.all([
    twitch.searchGames(config.platforms.twitch || {}, q),
    kick.searchCategories(q),
  ]);

  const merged = [];
  const seen = new Set();

  for (const g of [...twitchGames, ...kickCats]) {
    const key = `${g.platform}:${normalize(g.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...g, score: scoreMatch(q, g.name) });
  }

  merged.sort((a, b) => b.score - a.score);
  const best = merged[0] && merged[0].score >= 60 ? merged[0] : null;

  return { query: q, results: merged.slice(0, 20), best };
}

async function resolveGame(config, query, { notifyIfMissing = true } = {}) {
  const search = await searchGames(config, query);
  if (!search.best) {
    if (notifyIfMissing && query.trim()) notifyGameNotFound(query);
    return { found: false, query, results: search.results, game: null };
  }

  // Prefer Twitch id for Helix patch when available among top matches
  const twitchBest =
    search.results.find((r) => r.platform === "twitch" && scoreMatch(query, r.name) >= 60) ||
    (search.best.platform === "twitch" ? search.best : null);

  const game = {
    name: (twitchBest || search.best).name,
    twitchId: twitchBest?.id || null,
    kickId: search.results.find((r) => r.platform === "kick")?.id || null,
    results: search.results,
  };

  return { found: true, query, game, results: search.results };
}

module.exports = { searchGames, resolveGame, normalize, scoreMatch };
