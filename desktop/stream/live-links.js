/**
 * Liens publics de chaque live (hub + Stream Command).
 * Prefère liveUrl (direct en cours) si présent dans la config.
 * URLs éditables via config.liveLinks.overrides — plateformes catalogue non supprimables.
 */
const { LIVE_SOURCES, getDefaultSourceUrl } = require("../sources");

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

/** IDs du catalogue : toujours présents, non effaçables. */
const LOCKED_IDS = new Set(LIVE_SOURCES.map((s) => s.id));

function upsert(list, entry) {
  const i = list.findIndex((l) => l.id === entry.id);
  if (i >= 0) list[i] = { ...list[i], ...entry };
  else list.push(entry);
  return list;
}

function overridesOf(config = {}) {
  const raw = config.liveLinks?.overrides;
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [id, url] of Object.entries(raw)) {
    const u = String(url || "").trim();
    if (u) out[String(id)] = u;
  }
  return out;
}

function resolveCatalogUrl(config, src) {
  const ov = overridesOf(config)[src.id];
  if (ov) return ov;
  // TikTok principal : profil config si présent
  if (src.id === "tiktok") {
    const tt = config.platforms?.tiktok || {};
    const fromCfg = String(tt.liveUrl || tt.profileUrl || "").trim();
    if (fromCfg) return fromCfg;
  }
  return src.url;
}

function buildLiveLinks(config = {}) {
  const fb = config.platforms?.facebook || {};
  const ig = config.platforms?.instagram || {};
  const list = [];
  const overrides = overridesOf(config);

  for (const src of LIVE_SOURCES) {
    const url = resolveCatalogUrl(config, src);
    list.push({
      id: src.id,
      title: src.title,
      url,
      defaultUrl: src.url,
      kind: src.isSite ? "site" : "live",
      openInHub: true,
      isOnAir: false,
      locked: true,
      editable: true,
      overridden: Boolean(overrides[src.id]) || url !== src.url,
    });
  }

  // Facebook : vrai lien du direct si capturé, sinon page (sauf override catalogue)
  if (!overrides.facebook) {
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
      defaultUrl: getDefaultSourceUrl("facebook"),
      kind: fbLive ? "onair" : "live",
      openInHub: true,
      isOnAir: Boolean(fbLive),
      liveAt: fb.liveAt || "",
      liveId: fb.liveId || "",
      locked: true,
      editable: true,
      overridden: false,
    });

    if (fbLive && fbPage && fbLive !== fbPage) {
      upsert(list, {
        id: "facebook-page",
        title: `Facebook page${fb.pageName ? ` · ${fb.pageName}` : ""}`,
        url: fbPage,
        kind: "profile",
        openInHub: false,
        isOnAir: false,
        locked: false,
        editable: true,
      });
    }
  }

  if (fb.groupUrl && (fb.destination === "group" || fb.liveUrl)) {
    upsert(list, {
      id: "facebook-group",
      title: fb.liveUrl && fb.destination === "group" ? "🔴 Facebook Groupe LIVE" : "Facebook Groupe",
      url: fb.destination === "group" && fb.liveUrl ? fb.liveUrl : fb.groupUrl,
      kind: fb.destination === "group" && fb.liveUrl ? "onair" : "live",
      openInHub: false,
      isOnAir: Boolean(fb.destination === "group" && fb.liveUrl),
      locked: false,
      editable: true,
    });
  }

  // Instagram : vrai lien live si capturé (sauf override)
  if (!overrides.instagram) {
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
      defaultUrl: getDefaultSourceUrl("instagram"),
      kind: igLive ? "onair" : "live",
      openInHub: true,
      isOnAir: Boolean(igLive),
      liveAt: ig.liveAt || "",
      liveId: ig.liveId || "",
      locked: true,
      editable: true,
      overridden: false,
    });

    if (igLive && igProfile && igLive !== igProfile) {
      upsert(list, {
        id: "instagram-profile",
        title: "Instagram profil",
        url: igProfile,
        kind: "profile",
        openInHub: false,
        isOnAir: false,
        locked: false,
        editable: true,
      });
    }
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
      locked: false,
      editable: true,
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
      locked: false,
      editable: true,
    });
  }

  for (const extra of EXTRA_DEFAULTS) {
    if (!list.some((l) => l.url === extra.url || l.id === extra.id)) {
      const url = overrides[extra.id] || extra.url;
      list.push({
        ...extra,
        url,
        defaultUrl: extra.url,
        openInHub: false,
        isOnAir: false,
        locked: false,
        editable: true,
        overridden: Boolean(overrides[extra.id]),
      });
    }
  }

  // On-air en premier
  list.sort((a, b) => Number(Boolean(b.isOnAir)) - Number(Boolean(a.isOnAir)));
  return list;
}

/**
 * Persiste une URL custom. Plateformes catalogue restent (locked) — on ne peut que changer l’URL.
 */
function applyLiveLinkOverride(config, { id, url, reset = false } = {}) {
  const key = String(id || "").trim();
  if (!key) return { ok: false, reason: "id manquant", config };
  const next = structuredClone(config || {});
  next.liveLinks = next.liveLinks || { overrides: {} };
  next.liveLinks.overrides = { ...(next.liveLinks.overrides || {}) };

  const defaultUrl = getDefaultSourceUrl(key) || EXTRA_DEFAULTS.find((e) => e.id === key)?.url || "";
  const clean = String(url || "").trim();

  if (reset || !clean || (defaultUrl && clean === defaultUrl)) {
    delete next.liveLinks.overrides[key];
  } else {
    next.liveLinks.overrides[key] = clean;
  }

  // Aligne les champs plateforme utiles aux viewers / SSN
  syncPlatformFieldsFromUrl(next, key, next.liveLinks.overrides[key] || defaultUrl || clean);

  return { ok: true, config: next, links: buildLiveLinks(next) };
}

function syncPlatformFieldsFromUrl(config, id, url) {
  const u = String(url || "").trim();
  if (!u) return;
  config.platforms = config.platforms || {};

  if (id === "twitch" || /twitch\.tv/i.test(u)) {
    const login = u.match(/twitch\.tv\/(?:popout\/)?([^/?#]+)/i)?.[1];
    if (login && !/popout|directory|videos/i.test(login)) {
      config.platforms.twitch = {
        ...(config.platforms.twitch || {}),
        login: login.replace(/^@/, "").toLowerCase(),
      };
    }
  }
  if (id === "kick" || /kick\.com/i.test(u)) {
    const login = u.match(/kick\.com\/(?:popout\/)?([^/?#]+)/i)?.[1];
    if (login && !/popout|categories|search/i.test(login)) {
      config.platforms.kick = {
        ...(config.platforms.kick || {}),
        login: login.replace(/^@/, "").toLowerCase(),
      };
    }
  }
  if (id === "tiktok" || (id.startsWith("tiktok") && /tiktok\.com/i.test(u))) {
    const user = u.match(/tiktok\.com\/@([^/?#]+)/i)?.[1];
    if (user) {
      config.platforms.tiktok = {
        ...(config.platforms.tiktok || {}),
        username: user.replace(/^@/, ""),
        profileUrl: `https://www.tiktok.com/@${user.replace(/^@/, "")}`,
        liveUrl: /\/live\/?$/i.test(u)
          ? u
          : `https://www.tiktok.com/@${user.replace(/^@/, "")}/live`,
      };
    }
  }
  if (id === "instagram" || /instagram\.com/i.test(u)) {
    const user = u.match(/instagram\.com\/([^/?#]+)/i)?.[1];
    if (user && !/^(p|reel|stories|explore|accounts)$/i.test(user)) {
      config.platforms.instagram = {
        ...(config.platforms.instagram || {}),
        username: user.replace(/^@/, ""),
        profileUrl: `https://www.instagram.com/${user.replace(/^@/, "")}/`,
      };
    }
  }
  if (id === "youtube" || /youtube\.com|youtu\.be/i.test(u)) {
    config.platforms.youtube = {
      ...(config.platforms.youtube || {}),
      channelUrl: u,
    };
  }
}

module.exports = {
  buildLiveLinks,
  applyLiveLinkOverride,
  EXTRA_DEFAULTS,
  LOCKED_IDS,
  syncPlatformFieldsFromUrl,
};
