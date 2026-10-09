/** Shared live source catalog for the Live Hub viewer. */
const LIVE_SOURCES = [
  { id: "tiktok-1", title: "TikTok 1", url: "https://www.tiktok.com/@idontlikeuspam/live" },
  { id: "tiktok-2", title: "TikTok 2", url: "https://www.tiktok.com/@kanekiakadiddy/live" },
  { id: "kick", title: "Kick", url: "https://kick.com/lilwen54" },
  { id: "twitch", title: "Twitch", url: "https://www.twitch.tv/lilwen54" },
  { id: "youtube", title: "YouTube", url: "https://www.youtube.com/@lilwen54/live" },
  { id: "facebook", title: "Facebook", url: "https://www.facebook.com/profile.php?id=100036165385264" },
  { id: "instagram", title: "Instagram", url: "https://www.instagram.com/" },
  { id: "x", title: "X", url: "https://x.com/" },
  { id: "telegram", title: "Telegram", url: "https://web.telegram.org/k/" },
  { id: "site", title: "Site", url: "https://animebeat-arena.vercel.app", isSite: true },
];

/** Viewer slots (E1…E10). Site is selectable per slot; not counted as a power toggle. */
const SLOT_COUNT = 10;
const MAX_SCREENS = 10;

/** Power toggles = platforms only (exclude site). */
const POWER_SOURCES = LIVE_SOURCES.filter((s) => !s.isSite);

function defaultSlotSourceIds() {
  const ids = POWER_SOURCES.map((s) => s.id);
  while (ids.length < SLOT_COUNT) ids.push(ids[ids.length % POWER_SOURCES.length]);
  return ids.slice(0, SLOT_COUNT);
}

function defaultSourcePower() {
  const power = {};
  for (const s of POWER_SOURCES) power[s.id] = true;
  return power;
}

module.exports = {
  LIVE_SOURCES,
  POWER_SOURCES,
  SLOT_COUNT,
  MAX_SCREENS,
  defaultSlotSourceIds,
  defaultSourcePower,
};
