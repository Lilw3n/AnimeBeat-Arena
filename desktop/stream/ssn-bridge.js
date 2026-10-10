const WebSocket = require("ws");
const { notify, pushToWindows } = require("./notify");
const companions = require("./companions");
const ssapp = require("./ssapp-control");
const liveViewers = require("./live-viewers");

let ws = null;
let lastStatus = { connected: false, message: "SSN déconnecté", sessionId: "" };
let recentChat = [];

function getStatus() {
  return { ...lastStatus, recentChat: recentChat.slice(0, 30) };
}

function dockUrl(config) {
  const ssn = config.socialStreamNinja || {};
  let url = "";
  if (ssn.dockUrl) {
    url = String(ssn.dockUrl);
  } else {
    const session = String(ssn.sessionId || "").trim();
    if (!session) return "";
    const base = (ssn.dockBase || "https://socialstream.ninja/dock.html").replace(/\?.*$/, "");
    const serverFlag = ssn.server === false ? "" : "&server";
    // noturn/novideo: évite le spam DNS TURN VDO.Ninja quand on veut seulement le chat texte
    url = `${base}?session=${encodeURIComponent(session)}${serverFlag}&noturn&novideo`;
  }
  if (url && ssn.allowTurn !== true && !/[?&]noturn(=|&|$)/i.test(url)) {
    url += (url.includes("?") ? "&" : "?") + "noturn&novideo";
  }
  return url;
}

function featuredUrl(config) {
  const ssn = config.socialStreamNinja || {};
  if (ssn.featuredUrl) return ssn.featuredUrl;
  const session = String(ssn.sessionId || "").trim();
  if (!session) return "";
  return `https://socialstream.ninja/featured.html?session=${encodeURIComponent(session)}`;
}

function setStatus(partial) {
  lastStatus = { ...lastStatus, ...partial };
  pushToWindows({ type: "ssn-status", ...getStatus() });
}

function disconnect() {
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  setStatus({ connected: false, message: "SSN déconnecté" });
}

function connect(config) {
  const ssn = config.socialStreamNinja || {};
  if (!ssn.enabled) {
    disconnect();
    setStatus({ connected: false, message: "SSN désactivé" });
    return getStatus();
  }
  const sessionId = String(ssn.sessionId || "").trim();
  if (!sessionId) {
    setStatus({ connected: false, message: "Session ID SSN manquant" });
    return getStatus();
  }

  disconnect();
  const channel = ssn.chatChannel || 4;
  const url = `wss://io.socialstream.ninja/join/${encodeURIComponent(sessionId)}/${channel}`;
  setStatus({ sessionId, message: "Connexion SSN…", connected: false });

  try {
    ws = new WebSocket(url);
  } catch (err) {
    setStatus({ connected: false, message: err.message || "WS SSN impossible" });
    return getStatus();
  }

  ws.on("open", () => {
    setStatus({ connected: true, message: "Social Stream Ninja connecté", sessionId });
    notify("Social Stream Ninja", "Chat API connecté", "info");
  });

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(String(raw));
    } catch {
      return;
    }
    try {
      liveViewers.ingestSsnPayload(data);
    } catch {
      /* ignore */
    }
    const chat = normalizeChat(data);
    if (!chat) return;
    recentChat.unshift(chat);
    if (recentChat.length > 80) recentChat.length = 80;
    pushToWindows({ type: "ssn-chat", chat });
  });

  ws.on("close", () => {
    ws = null;
    setStatus({ connected: false, message: "SSN déconnecté" });
  });

  ws.on("error", () => {
    setStatus({ connected: false, message: "Erreur WebSocket SSN" });
  });

  return getStatus();
}

function normalizeChat(data) {
  if (!data || typeof data !== "object") return null;
  // viewer_update / likes_update → live-viewers, pas le fil chat
  const ev = String(data.event || "").toLowerCase();
  if (ev === "viewer_update" || ev === "viewer_updates" || ev === "likes_update") {
    return null;
  }
  const text = data.chatmessage || data.message || data.text || data.comment || "";
  const user = data.chatname || data.displayname || data.username || data.name || "";
  if (!text && !user && !ev) return null;
  const platform = String(data.type || data.platform || data.source || "ssn").toLowerCase();
  return {
    user: user || (ev ? `[${ev}]` : ""),
    text: String(text || ev || "").slice(0, 500),
    platform,
    event: ev || "",
    // alias pour filtres hub
    isInstagram: /instagram/.test(platform),
    at: Date.now(),
  };
}

/**
 * Lance SSN (Control API) + démarre / relance Instagram pour les messages.
 * mode: "auto" | "live" | "profile" — profile = hors live (inbox follows/likes/commentaires).
 */
async function ensureInstagramChat(config, opts = {}) {
  const ssn = config.socialStreamNinja || {};
  if (ssn.enabled === false) {
    return { ok: false, skipped: true, reason: "SSN désactivé" };
  }

  const mode = opts.mode === "live" || opts.mode === "profile" ? opts.mode : "auto";

  // 1) App SSN up (avec --ssapp-control-api)
  let launch = null;
  if (!companions.isRunning("socialstream")) {
    launch = companions.launchOne("socialstream", config, { force: true });
  } else {
    // Déjà ouvert sans flag → Control API souvent absente
    const probe = await ssapp.getStatus(config);
    if (!probe.ok && opts.relaunchIfNoApi !== false) {
      notify(
        "SSN",
        "Social Stream ouvert sans Control API — ferme-le puis le hub le relance avec le bon flag",
        "warn",
      );
      // ne tue pas de force (données session) ; on tente quand même
      launch = { ok: true, alreadyRunning: true, needRelaunchWithApi: true };
    } else {
      launch = { ok: true, alreadyRunning: true };
    }
  }

  // 2) Attendre API
  const ready = await ssapp.waitUntilReady(config, { timeoutMs: opts.timeoutMs || 40000 });
  if (!ready.ok) {
    // Fallback: au moins reconnecter le WS chat
    connect(config);
    return {
      ok: false,
      launch,
      api: ready,
      reason:
        ready.reason ||
        "Control API :17777 injoignable. Ferme Social Stream Ninja, puis « Lancer SSN » / Préparer IG depuis le hub.",
      tip: "Dans SSN: source Instagram connectée (compte loggé). Hors live = page profil pour l’inbox.",
    };
  }

  // 3) Source Instagram (live ou profil hors live)
  const ensured = await ssapp.ensureInstagramLiveSource(config, {
    liveUrl: opts.liveUrl,
    username: opts.username,
    forceRestart: opts.forceRestart !== false,
    mode,
  });

  // 4) WS chat hub
  connect(config);

  if (ensured.ok) {
    const label =
      ensured.mode === "profile"
        ? `Messages IG hors live OK (${ensured.handle || "profil"})`
        : `Messages Instagram Live OK (${ensured.handle || "source"})`;
    notify("SSN", label, "info");
  } else {
    notify("SSN", ensured.reason || "Instagram non démarré dans SSN", "warn");
  }

  return { ok: Boolean(ensured.ok), launch, api: ready, source: ensured, ws: getStatus() };
}

function sendChat(config, message) {
  const ssn = config.socialStreamNinja || {};
  const sessionId = String(ssn.sessionId || "").trim();
  if (!sessionId || !message) return { ok: false, reason: "session ou message vide" };

  // Control channel (1) for sendChat
  return new Promise((resolve) => {
    const url = `wss://io.socialstream.ninja/join/${encodeURIComponent(sessionId)}/1`;
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      resolve({ ok: false, reason: err.message });
      return;
    }
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, reason: "timeout sendChat" });
    }, 5000);

    socket.on("open", () => {
      socket.send(JSON.stringify({ action: "sendChat", value: String(message) }));
      clearTimeout(timer);
      setTimeout(() => {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        resolve({ ok: true });
      }, 200);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: "WS sendChat error" });
    });
  });
}

module.exports = {
  connect,
  disconnect,
  getStatus,
  dockUrl,
  featuredUrl,
  sendChat,
  ensureInstagramChat,
};
