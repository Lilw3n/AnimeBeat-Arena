const WebSocket = require("ws");
const { notify, pushToWindows } = require("./notify");

let ws = null;
let lastStatus = { connected: false, message: "SSN déconnecté", sessionId: "" };
let recentChat = [];

function getStatus() {
  return { ...lastStatus, recentChat: recentChat.slice(0, 30) };
}

function dockUrl(config) {
  const ssn = config.socialStreamNinja || {};
  if (ssn.dockUrl) return ssn.dockUrl;
  const session = String(ssn.sessionId || "").trim();
  if (!session) return "";
  const base = (ssn.dockBase || "https://socialstream.ninja/dock.html").replace(/\?.*$/, "");
  const serverFlag = ssn.server === false ? "" : "&server";
  return `${base}?session=${encodeURIComponent(session)}${serverFlag}`;
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
  const text = data.chatmessage || data.message || data.text || data.comment || "";
  const user = data.chatname || data.displayname || data.username || data.name || "";
  if (!text && !user) return null;
  return {
    user,
    text: String(text).slice(0, 500),
    platform: data.type || data.platform || data.source || "ssn",
    at: Date.now(),
  };
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
};
