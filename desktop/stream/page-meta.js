/**
 * Vérifie titre/jeu sur chaque plateforme via les liens publics,
 * et corrige via les pages (dashboard / Live Producer) si Streamer.bot a raté.
 */
const { BrowserWindow } = require("electron");
const { LIVE_SOURCES } = require("../sources");
const { buildLiveLinks } = require("./live-links");
const { getHardenedSession, flushSession } = require("./persist-session");
const { notify } = require("./notify");
const twitchApi = require("./platforms/twitch");
const facebook = require("./platforms/facebook");
const instagram = require("./platforms/instagram");
const { installWindowNavMenu } = require("../browser-nav");

const OPEN_WINDOWS = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function gamesMatch(expected, actual) {
  const a = norm(expected);
  const b = norm(actual);
  if (!a) return { ok: true, skipped: true };
  if (!b) return { ok: false, reason: "jeu absent sur la page" };
  if (a === b) return { ok: true };
  if (b.includes(a) || a.includes(b)) return { ok: true, fuzzy: true };
  const aw = a.split(" ").filter((w) => w.length > 2);
  const hit = aw.filter((w) => b.includes(w)).length;
  if (aw.length && hit / aw.length >= 0.6) return { ok: true, fuzzy: true };
  return { ok: false, reason: `attendu « ${expected} » · trouvé « ${actual} »` };
}

function titlesMatch(expected, actual) {
  const a = norm(expected);
  const b = norm(actual);
  if (!a) return { ok: true, skipped: true };
  if (!b) return { ok: false, reason: "titre absent" };
  if (a === b || b.includes(a) || a.includes(b)) return { ok: true };
  return { ok: false, reason: `titre page ≠ hub` };
}

function loginFromUrl(url, hostRe) {
  try {
    const u = new URL(String(url || ""));
    if (!hostRe.test(u.hostname)) return "";
    const parts = u.pathname.split("/").filter(Boolean);
    return String(parts[0] || "")
      .replace(/^@/, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

function resolveHandles(config = {}) {
  const links = buildLiveLinks(config);
  const twitchSrc = LIVE_SOURCES.find((s) => s.id === "twitch")?.url || "";
  const kickSrc = LIVE_SOURCES.find((s) => s.id === "kick")?.url || "";
  const ytSrc = LIVE_SOURCES.find((s) => s.id === "youtube")?.url || "";

  const twitch =
    String(config.platforms?.twitch?.login || "").replace(/^@/, "").toLowerCase() ||
    loginFromUrl(links.find((l) => l.id === "twitch")?.url, /twitch\.tv/i) ||
    loginFromUrl(twitchSrc, /twitch\.tv/i);

  const kick =
    String(config.platforms?.kick?.login || config.platforms?.kick?.username || "")
      .replace(/^@/, "")
      .toLowerCase() ||
    loginFromUrl(links.find((l) => l.id === "kick")?.url, /kick\.com/i) ||
    loginFromUrl(kickSrc, /kick\.com/i);

  let youtube = "";
  try {
    const yu = new URL(links.find((l) => l.id === "youtube")?.url || ytSrc);
    youtube = yu.pathname.replace(/^\//, "") || "";
  } catch {
    youtube = "";
  }

  return {
    twitch,
    kick,
    youtube,
    pages: {
      twitchLive: twitch ? `https://www.twitch.tv/${twitch}` : "",
      twitchDash: twitch ? `https://dashboard.twitch.tv/u/${twitch}/stream-manager` : "",
      kickLive: kick ? `https://kick.com/${kick}` : "",
      kickDash: "https://dashboard.kick.com/stream",
      youtubeLive: links.find((l) => l.id === "youtube")?.url || ytSrc,
      facebook: links.find((l) => l.id === "facebook")?.url || "",
      instagram: links.find((l) => l.id === "instagram")?.url || "",
    },
  };
}

async function readTwitchPublic(login) {
  const handle = String(login || "").trim();
  if (!handle) return { ok: false, reason: "login Twitch manquant" };

  try {
    const res = await fetch(`https://www.twitch.tv/${encodeURIComponent(handle)}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
    });
    const html = await res.text();
    const game =
      html.match(/"gameName"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1]?.replace(/\\"/g, '"') ||
      html.match(/data-a-target="stream-game-link"[^>]*>\s*([^<]+)/i)?.[1]?.trim() ||
      "";
    const title =
      html.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1]?.replace(/\\u([\dA-Fa-f]{4})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16)),
      ) ||
      html.match(/property="og:description"\s+content="([^"]+)"/i)?.[1] ||
      "";
    const live = /"isLiveBroadcast"\s*:\s*true|"isLive"\s*:\s*true/i.test(html);
    return {
      ok: true,
      platform: "twitch",
      login: handle,
      title: title.slice(0, 200),
      game: game.slice(0, 120),
      live,
      via: "page",
      url: `https://www.twitch.tv/${handle}`,
    };
  } catch (err) {
    return { ok: false, platform: "twitch", reason: err.message };
  }
}

async function readTwitchHelix(twitchConfig, login) {
  if (!twitchConfig?.clientId) return null;
  try {
    let token = twitchConfig.accessToken;
    if (!token && twitchConfig.clientSecret) {
      // reuse internal via searchGames path — call update path helpers
      const games = await twitchApi.searchGames(twitchConfig, "a");
      void games;
    }
    // Resolve user id
    let userToken = twitchConfig.accessToken;
    if (!userToken && twitchConfig.clientSecret) {
      const body = new URLSearchParams({
        client_id: twitchConfig.clientId,
        client_secret: twitchConfig.clientSecret,
        grant_type: "client_credentials",
      });
      const tokRes = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (tokRes.ok) {
        const j = await tokRes.json();
        userToken = j.access_token;
      }
    }
    if (!userToken) return null;
    const headers = {
      "Client-ID": twitchConfig.clientId,
      Authorization: `Bearer ${userToken}`,
    };
    const userRes = await fetch(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
      { headers },
    );
    if (!userRes.ok) return null;
    const userJson = await userRes.json();
    const id = userJson.data?.[0]?.id;
    if (!id) return null;
    const chRes = await fetch(
      `https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(id)}`,
      { headers },
    );
    if (!chRes.ok) return null;
    const ch = (await chRes.json()).data?.[0];
    if (!ch) return null;
    return {
      ok: true,
      platform: "twitch",
      login,
      title: ch.title || "",
      game: ch.game_name || "",
      gameId: ch.game_id || "",
      via: "helix",
      url: `https://www.twitch.tv/${login}`,
    };
  } catch {
    return null;
  }
}

async function readKickPublic(login) {
  const handle = String(login || "").trim();
  if (!handle) return { ok: false, reason: "login Kick manquant" };
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(handle)}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "AnimeBeatLiveHub/1.0",
      },
    });
    if (!res.ok) {
      return { ok: false, platform: "kick", reason: `HTTP ${res.status}`, login: handle };
    }
    const j = await res.json();
    const live = j.livestream || j.previous_livestream || null;
    const cats = live?.categories || j.recent_categories || [];
    const game =
      cats[0]?.name ||
      cats[0]?.category?.name ||
      j.category?.name ||
      j.recent_category?.name ||
      "";
    const title = live?.session_title || j.livestream?.session_title || "";
    return {
      ok: true,
      platform: "kick",
      login: handle,
      title: String(title || "").slice(0, 200),
      game: String(game || "").slice(0, 120),
      live: Boolean(j.livestream),
      via: "api-v2",
      url: `https://kick.com/${handle}`,
    };
  } catch (err) {
    return { ok: false, platform: "kick", reason: err.message };
  }
}

async function verifyPlatformMeta(config, { title, game } = {}) {
  const handles = resolveHandles(config);
  const wantTitle = String(title || "").trim();
  const wantGame = String(game || "").trim();
  const out = {
    ok: true,
    wantTitle,
    wantGame,
    handles,
    platforms: {},
    mismatches: [],
  };

  // Twitch
  if (handles.twitch) {
    let tw =
      (await readTwitchHelix(config.platforms?.twitch || {}, handles.twitch)) ||
      (await readTwitchPublic(handles.twitch));
    if (tw?.ok) {
      const g = gamesMatch(wantGame, tw.game);
      const t = titlesMatch(wantTitle, tw.title);
      tw.gameOk = g.ok;
      tw.titleOk = t.ok;
      tw.gameCheck = g;
      tw.titleCheck = t;
      tw.match = g.ok && (t.ok || !wantTitle);
      if (!tw.match) out.mismatches.push("twitch");
    } else {
      out.mismatches.push("twitch");
    }
    out.platforms.twitch = tw;
  }

  // Kick
  if (handles.kick) {
    const ki = await readKickPublic(handles.kick);
    if (ki?.ok) {
      const g = gamesMatch(wantGame, ki.game);
      const t = titlesMatch(wantTitle, ki.title);
      ki.gameOk = g.ok;
      ki.titleOk = t.ok;
      ki.gameCheck = g;
      ki.titleCheck = t;
      ki.match = g.ok && (t.ok || !ki.live || !wantTitle);
      if (!ki.match) out.mismatches.push("kick");
    } else {
      out.mismatches.push("kick");
    }
    out.platforms.kick = ki;
  }

  out.ok = out.mismatches.length === 0;
  return out;
}

function getOrCreatePageWindow(id, { partition, title, url }) {
  const existing = OPEN_WINDOWS.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    if (url) existing.loadURL(url).catch(() => {});
    return existing;
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    autoHideMenuBar: true,
    title: title || id,
    backgroundColor: "#0b0f1a",
    webPreferences: {
      partition: partition || `persist:page-meta-${id}`,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    installWindowNavMenu(win);
  } catch {
    /* optional */
  }
  win.on("closed", () => {
    if (OPEN_WINDOWS.get(id) === win) OPEN_WINDOWS.delete(id);
  });
  OPEN_WINDOWS.set(id, win);
  if (url) win.loadURL(url).catch(() => {});
  return win;
}

async function evalIn(win, fnSource, ...args) {
  if (!win || win.isDestroyed()) throw new Error("fenêtre fermée");
  return win.webContents.executeJavaScript(
    `(${fnSource})(${args.map((a) => JSON.stringify(a)).join(",")})`,
    true,
  );
}

const TWITCH_DASH_FILL_FN = `async function fillTwitchDash(title, game) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clickText = (re) => {
    const nodes = [...document.querySelectorAll("button, a, div[role='button'], span")];
    for (const el of nodes) {
      const t = ((el.innerText || "") + " " + (el.getAttribute("aria-label") || "")).trim();
      if (re.test(t) && t.length < 64) {
        el.click();
        return t.slice(0, 40);
      }
    }
    return null;
  };
  // Ouvre l’édition infos stream
  clickText(/edit stream info|modifier les infos|edit|modifier/i);
  await sleep(1200);
  const inputs = [...document.querySelectorAll("input, textarea")];
  let titleEl =
    inputs.find((el) => /title|titre/i.test((el.getAttribute("aria-label") || "") + (el.placeholder || ""))) ||
    inputs.find((el) => el.tagName === "TEXTAREA" || (el.type === "text" && el.offsetParent));
  if (titleEl && title) {
    titleEl.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(titleEl, title);
    else titleEl.value = title;
    titleEl.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // Catégorie / jeu
  let cat =
    inputs.find((el) => /category|catégorie|jeu|game/i.test((el.getAttribute("aria-label") || "") + (el.placeholder || ""))) ||
    document.querySelector("[data-a-target='category-search'] input, input[placeholder*='ategory'], input[placeholder*='atégorie']");
  if (cat && game) {
    cat.focus();
    cat.click();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(cat, game);
    else cat.value = game;
    cat.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(900);
    const opt = [...document.querySelectorAll("[role='option'], li, div[data-a-target]")].find((el) => {
      const t = (el.innerText || "").toLowerCase();
      return t && game.toLowerCase().split(" ").every((w) => w.length < 3 || t.includes(w.toLowerCase()));
    });
    if (opt) opt.click();
    await sleep(400);
  }
  const done = clickText(/done|terminé|save|enregistrer|appliquer|apply/i);
  return { ok: true, filledTitle: Boolean(titleEl), filledGame: Boolean(cat), done };
}`;

const KICK_DASH_FILL_FN = `async function fillKickDash(title, game) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clickText = (re) => {
    const nodes = [...document.querySelectorAll("button, a, div[role='button'], span, label")];
    for (const el of nodes) {
      const t = ((el.innerText || "") + " " + (el.getAttribute("aria-label") || "")).trim();
      if (re.test(t) && t.length < 72) {
        el.click();
        return t.slice(0, 40);
      }
    }
    return null;
  };
  clickText(/edit|modifier|stream info|stream details|title|titre/i);
  await sleep(1000);
  const inputs = [...document.querySelectorAll("input, textarea")];
  let titleEl = inputs.find((el) => /title|titre|session/i.test((el.getAttribute("aria-label") || "") + (el.placeholder || "")))
    || inputs.find((el) => el.tagName === "TEXTAREA");
  if (titleEl && title) {
    titleEl.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(titleEl, title);
    else titleEl.value = title;
    titleEl.dispatchEvent(new Event("input", { bubbles: true }));
  }
  let cat = inputs.find((el) => /categor|jeu|game/i.test((el.getAttribute("aria-label") || "") + (el.placeholder || "")));
  if (cat && game) {
    cat.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(cat, game);
    else cat.value = game;
    cat.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(800);
    const opt = [...document.querySelectorAll("[role='option'], li, button, div")].find((el) => {
      const t = (el.innerText || "").toLowerCase();
      return t.length > 1 && t.length < 80 && game.toLowerCase().split(/\\s+/).filter((w) => w.length > 2).every((w) => t.includes(w));
    });
    if (opt) opt.click();
  }
  clickText(/save|enregistrer|update|done|terminé|apply|appliquer/i);
  return { ok: true, filledTitle: Boolean(titleEl), filledGame: Boolean(cat) };
}`;

/**
 * Ouvre chaque page (liens) et tente de corriger titre/jeu si SB a échoué / vérif KO.
 */
async function fixMetaViaPages(config, { title, game, platforms, forceOpen = true } = {}) {
  const wantTitle = String(title || "").trim();
  const wantGame = String(game || "").trim();
  const handles = resolveHandles(config);
  const want = Array.isArray(platforms) && platforms.length
    ? platforms.map((p) => String(p).toLowerCase())
    : ["twitch", "kick", "facebook", "instagram", "youtube"];
  const results = { ok: true, opened: [], fixed: {}, verifyAfter: null };

  notify("Pages meta", "Ouverture des pages titre/jeu (liens)…", "info");

  if (want.includes("twitch") && handles.pages.twitchDash) {
    const win = getOrCreatePageWindow("twitch-dash", {
      partition: "persist:twitch-meta",
      title: "Twitch Stream Manager — AnimeBeat",
      url: handles.pages.twitchDash,
    });
    results.opened.push({ platform: "twitch", url: handles.pages.twitchDash });
    await sleep(3500);
    try {
      results.fixed.twitch = await evalIn(win, TWITCH_DASH_FILL_FN, wantTitle, wantGame);
    } catch (err) {
      results.fixed.twitch = {
        ok: false,
        reason: err.message,
        tip: "Connecte-toi dans la fenêtre Twitch Dashboard puis relance Appliquer",
      };
    }
    // Ouvre aussi la page live pour contrôle visuel
    if (forceOpen && handles.pages.twitchLive) {
      getOrCreatePageWindow("twitch-live", {
        partition: "persist:twitch-meta",
        title: "Twitch live — vérif jeu",
        url: handles.pages.twitchLive,
      });
    }
  }

  if (want.includes("kick") && handles.pages.kickDash) {
    const win = getOrCreatePageWindow("kick-dash", {
      partition: "persist:kick-meta",
      title: "Kick Dashboard — AnimeBeat",
      url: handles.pages.kickDash,
    });
    results.opened.push({ platform: "kick", url: handles.pages.kickDash });
    await sleep(3500);
    try {
      results.fixed.kick = await evalIn(win, KICK_DASH_FILL_FN, wantTitle, wantGame);
    } catch (err) {
      results.fixed.kick = {
        ok: false,
        reason: err.message,
        tip: "Connecte-toi dans la fenêtre Kick Dashboard puis relance Appliquer",
      };
    }
    if (forceOpen && handles.pages.kickLive) {
      getOrCreatePageWindow("kick-live", {
        partition: "persist:kick-meta",
        title: "Kick live — vérif jeu",
        url: handles.pages.kickLive,
      });
    }
  }

  if (want.includes("youtube") && handles.pages.youtubeLive) {
    getOrCreatePageWindow("youtube-live", {
      partition: "persist:youtube-meta",
      title: "YouTube — vérif live",
      url: handles.pages.youtubeLive,
    });
    results.opened.push({ platform: "youtube", url: handles.pages.youtubeLive });
    results.fixed.youtube = { ok: true, opened: true, note: "Vérifie titre/catégorie dans YouTube Studio" };
  }

  if (want.includes("facebook")) {
    try {
      const fbCfg = config.platforms?.facebook || {};
      const fbDesc =
        String(fbCfg.lastDescription || "").trim() ||
        `${wantTitle}${wantGame ? ` — ${wantGame}` : ""}`;
      results.fixed.facebook = await facebook.updateTitleGame({
        title: wantTitle,
        game: wantGame,
        description: fbDesc,
        facebookConfig: fbCfg,
        autoOpen: true,
      });
      results.opened.push({ platform: "facebook", via: "live-producer" });
    } catch (err) {
      results.fixed.facebook = { ok: false, reason: err.message };
    }
  }

  if (want.includes("instagram")) {
    try {
      results.fixed.instagram = await instagram.updateTitle({
        title: wantTitle,
        autoOpen: true,
      });
      results.opened.push({ platform: "instagram", via: "live-producer" });
    } catch (err) {
      results.fixed.instagram = { ok: false, reason: err.message };
    }
  }

  await sleep(2500);
  results.verifyAfter = await verifyPlatformMeta(config, { title: wantTitle, game: wantGame });
  results.ok = Boolean(results.verifyAfter?.ok);
  const bad = results.verifyAfter?.mismatches || [];
  if (bad.length) {
    notify(
      "Vérif jeu",
      `Pas encore OK: ${bad.join(", ")} — regarde les fenêtres ouvertes (dashboard / live)`,
      "warn",
    );
  } else {
    notify("Vérif jeu", `OK · jeu « ${wantGame || "—"} » confirmé sur Twitch/Kick`, "info");
  }

  try {
    await flushSession(getHardenedSession("persist:twitch-meta"));
    await flushSession(getHardenedSession("persist:kick-meta"));
  } catch {
    /* optional */
  }

  return results;
}

/**
 * Après Streamer.bot: vérifie le jeu ; si KO → ouvre les pages + corrige.
 */
async function verifyAndFixAfterStreamerBot(config, { title, game, streamerbotResult } = {}) {
  const wantGame = String(game || "").trim();
  const wantTitle = String(title || "").trim();
  if (!wantGame && !wantTitle) {
    return { ok: true, skipped: true, reason: "rien à vérifier" };
  }

  await sleep(2000); // laisse SB propager
  let verify = await verifyPlatformMeta(config, { title: wantTitle, game: wantGame });
  const sbFailed = streamerbotResult && streamerbotResult.ok === false && !streamerbotResult.skipped;
  const needFix = sbFailed || !verify.ok;

  if (!needFix) {
    notify("Vérif jeu", `Streamer.bot OK · pages confirmées (${wantGame || wantTitle})`, "info");
    return { ok: true, verify, fixed: false };
  }

  notify(
    "Vérif jeu",
    sbFailed
      ? "Streamer.bot a échoué — correction via les pages (liens)…"
      : `Jeu incorrect sur: ${(verify.mismatches || []).join(", ")} — correction via pages…`,
    "warn",
  );

  const fix = await fixMetaViaPages(config, {
    title: wantTitle,
    game: wantGame,
    platforms: verify.mismatches?.length
      ? [...verify.mismatches, "facebook", "instagram"]
      : ["twitch", "kick", "facebook", "instagram"],
  });

  return {
    ok: Boolean(fix?.ok || fix?.verifyAfter?.ok),
    verify,
    fix,
    fixed: true,
  };
}

module.exports = {
  resolveHandles,
  verifyPlatformMeta,
  fixMetaViaPages,
  verifyAndFixAfterStreamerBot,
  gamesMatch,
  readTwitchPublic,
  readKickPublic,
};
