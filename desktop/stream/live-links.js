/**
 * Liens publics de chaque live (hub + Stream Command).
 * Prefère liveUrl (direct en cours) si présent dans la config.
 */
const { LIVE_SOURCES } = require("../sources");

const EXTRA_DEFAULTS = [
  {
    id: "site-gta",
    title: "Site sticky (Leonida)",
    url: "https://leonida-vice.com",
    kind: "sticky",
  },
  {
    id: "twitch-chat",
    title: "Chat Twitch",
    url: "https://www.twitch.tv/popout/lilwen54/chat",
    kind: "chat",
  },
  {
    id: "kick-chat",
    title: "Chat Kick",
    url: "https://kick.com/popout/lilwen54/chat",
    kind: "chat",
  },
];

function upsert(list, entry) {
  const i = list.findIndex((l) => l.id === entry.id);
  if (i >= 0) list[i] = { ...list[i], ...entry };
  else list.push(entry);
  return list;
}

function buildLiveLinks(config = {}) {
  const fb = config.platforms?.facebook || {};
  const ig = config.platforms?.instagram || {};
  const list = [];

  for (const src of LIVE_SOURCES) {
    list.push({
      id: src.id,
      title: src.title,
      url: src.url,
      kind: src.isSite ? "site" : "live",
      openInHub: true,
      isOnAir: false,
    });
  }

  // Facebook : vrai lien du direct si capturé, sinon page
  const fbLive = String(fb.liveUrl || "").trim();
  const fbPage =
    fb.pageUrl ||
    (fb.pageId ? `https://www.facebook.com/profile.php?id=${fb.pageId}` : "") ||
    list.find((l) => l.id === "facebook")?.url ||
    "";
  upsert(list, {
    id: "facebook",
    title: fbLive
      ? `🔴 Facebook LIVE${fb.pageName ? ` · ${fb.pageName}` : ""}`
      : fb.pageName
        ? `Facebook · ${fb.pageName}`
        : "Facebook PAGE",
    url: fbLive || fbPage,
    kind: fbLive ? "onair" : "live",
    openInHub: true,
    isOnAir: Boolean(fbLive),
    liveAt: fb.liveAt || "",
    liveId: fb.liveId || "",
  });

  if (fbLive && fbPage && fbLive !== fbPage) {
    upsert(list, {
      id: "facebook-page",
      title: `Facebook page${fb.pageName ? ` · ${fb.pageName}` : ""}`,
      url: fbPage,
      kind: "profile",
      openInHub: false,
      isOnAir: false,
    });
  }

  if (fb.groupUrl && (fb.destination === "group" || fb.liveUrl)) {
    upsert(list, {
      id: "facebook-group",
      title: fbLive && fb.destination === "group" ? "🔴 Facebook Groupe LIVE" : "Facebook Groupe",
      url: fb.destination === "group" && fbLive ? fbLive : fb.groupUrl,
      kind: fb.destination === "group" && fbLive ? "onair" : "live",
      openInHub: false,
      isOnAir: Boolean(fb.destination === "group" && fbLive),
    });
  }

  // Instagram : vrai lien live si capturé
  const igLive = String(ig.liveUrl || "").trim();
  const igProfile =
    ig.profileUrl ||
    (ig.username ? `https://www.instagram.com/${String(ig.username).replace(/^@/, "")}/` : "") ||
    list.find((l) => l.id === "instagram")?.url ||
    "https://www.instagram.com/";
  upsert(list, {
    id: "instagram",
    title: igLive ? "🔴 Instagram LIVE" : "Instagram",
    url: igLive || igProfile,
    kind: igLive ? "onair" : "live",
    openInHub: true,
    isOnAir: Boolean(igLive),
    liveAt: ig.liveAt || "",
    liveId: ig.liveId || "",
  });

  if (igLive && igProfile && igLive !== igProfile) {
    upsert(list, {
      id: "instagram-profile",
      title: "Instagram profil",
      url: igProfile,
      kind: "profile",
      openInHub: false,
      isOnAir: false,
    });
  }

  const stickyIg = String(ig.linkUrl || "").trim();
  if (stickyIg) {
    upsert(list, {
      id: "instagram-sticky",
      title: `IG sticky · ${ig.linkTitle || "lien"}`,
      url: stickyIg.startsWith("http") ? stickyIg : `https://${stickyIg}`,
      kind: "sticky",
      openInHub: false,
      isOnAir: false,
    });
  }

  const stickyFb = String(fb.linkUrl || "").trim();
  if (stickyFb && stickyFb !== stickyIg) {
    upsert(list, {
      id: "facebook-sticky",
      title: `FB sticky · ${fb.linkTitle || "lien"}`,
      url: stickyFb.startsWith("http") ? stickyFb : `https://${stickyFb}`,
      kind: "sticky",
      openInHub: false,
      isOnAir: false,
    });
  }

  for (const extra of EXTRA_DEFAULTS) {
    if (!list.some((l) => l.url === extra.url || l.id === extra.id)) {
      list.push({ ...extra, openInHub: false, isOnAir: false });
    }
  }

  // On-air en premier
  list.sort((a, b) => Number(Boolean(b.isOnAir)) - Number(Boolean(a.isOnAir)));
  return list;
}

module.exports = { buildLiveLinks, EXTRA_DEFAULTS };
