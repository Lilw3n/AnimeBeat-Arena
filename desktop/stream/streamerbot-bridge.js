const WebSocket = require("ws");
const { notify, pushToWindows } = require("./notify");

let ws = null;
let pending = new Map();
let reqCounter = 0;
let reconnectTimer = null;
let connecting = false;
let lastConfig = null;
let lastStatus = {
  connected: false,
  message: "Streamer.bot déconnecté",
  actions: [],
  broadcaster: null,
  platforms: [],
  port: null,
};

function platformList(broadcaster) {
  if (!broadcaster) return [];
  if (Array.isArray(broadcaster.connected)) return broadcaster.connected.filter(Boolean);
  if (broadcaster.platforms && typeof broadcaster.platforms === "object") {
    return Object.keys(broadcaster.platforms).filter((k) => broadcaster.platforms[k]);
  }
  return [];
}

function statusMessage(port, platforms) {
  const plats = platforms?.length ? ` · ${platforms.join(", ")}` : "";
  return `Streamer.bot connecté (:${port})${plats}`;
}

function scheduleReconnect(delayMs = 4000) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!lastConfig?.streamerBot?.enabled) return;
    if (lastStatus.connected || connecting) return;
    connect(lastConfig).catch(() => {});
  }, delayMs);
}

function getStatus() {
  return { ...lastStatus };
}

function setStatus(partial) {
  lastStatus = { ...lastStatus, ...partial };
  pushToWindows({ type: "streamerbot-status", ...getStatus() });
}

function nextId() {
  reqCounter += 1;
  return `ab-${Date.now()}-${reqCounter}`;
}

function sendRequest(payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error("Streamer.bot non connecté"));
      return;
    }
    const id = payload.id || nextId();
    const body = { ...payload, id };
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout Streamer.bot: ${payload.request}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify(body));
  });
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error("déconnecté"));
  }
  pending.clear();
  setStatus({
    connected: false,
    message: "Streamer.bot déconnecté",
    actions: [],
    broadcaster: null,
    platforms: [],
  });
}

function candidatePorts(config) {
  const preferred = Number(config.streamerBot?.port || 4457);
  const list = [preferred, 4457, 8080, 4456];
  return [...new Set(list.filter((n) => Number.isFinite(n)))];
}

function connectSocket(url) {
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      resolve({ ok: false, reason: err.message });
      return;
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, reason: "timeout hello" });
    }, 2500);

    socket.on("open", () => {
      /* wait for Hello */
    });

    socket.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (data.request === "Hello" && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true, socket, hello: data });
        return;
      }
      const id = data.id;
      if (id && pending.has(id)) {
        const p = pending.get(id);
        pending.delete(id);
        clearTimeout(p.timer);
        if (data.status === "error" || data.error) {
          p.reject(new Error(data.error || data.status?.error || "erreur SB"));
        } else {
          p.resolve(data);
        }
      }
    });

    socket.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, reason: "ws error" });
    });

    socket.on("close", () => {
      if (ws === socket) {
        ws = null;
        setStatus({
          connected: false,
          message: "Streamer.bot déconnecté",
          platforms: [],
        });
        scheduleReconnect();
      }
    });
  });
}

async function tryConnectOnce(config) {
  const sb = config.streamerBot || {};
  const host = sb.host || "127.0.0.1";

  for (const port of candidatePorts(config)) {
    const url = `ws://${host}:${port}/`;
    const result = await connectSocket(url);
    if (!result.ok) continue;

    ws = result.socket;
    ws.removeAllListeners("message");
    ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(String(raw));
      } catch {
        return;
      }
      const id = data.id;
      if (id && pending.has(id)) {
        const p = pending.get(id);
        pending.delete(id);
        clearTimeout(p.timer);
        if (data.status === "error" || data.error) {
          p.reject(new Error(data.error || "erreur SB"));
        } else {
          p.resolve(data);
        }
      }
    });
    ws.on("close", () => {
      if (ws === result.socket) {
        ws = null;
        setStatus({
          connected: false,
          message: "Streamer.bot déconnecté",
          platforms: [],
        });
        scheduleReconnect();
      }
    });

    setStatus({
      connected: true,
      message: statusMessage(port, []),
      port,
    });

    try {
      await sendRequest({
        request: "Subscribe",
        events: { general: ["Custom"] },
      });
    } catch {
      /* optional */
    }

    try {
      const actions = await getActions();
      const broadcaster = await getBroadcaster().catch(() => null);
      const platforms = platformList(broadcaster);
      setStatus({
        connected: true,
        message: statusMessage(port, platforms),
        port,
        actions,
        broadcaster,
        platforms,
      });
      notify(
        "Streamer.bot",
        platforms.length
          ? `WS :${port} · comptes: ${platforms.join(", ")}`
          : `WebSocket OK sur ${port} (aucun compte plateforme)`,
        platforms.length ? "info" : "warn",
      );
    } catch (err) {
      setStatus({
        connected: true,
        message: `Connecté (:${port}) — ${err.message}`,
        port,
      });
    }
    return getStatus();
  }
  return null;
}

async function connect(config, options = {}) {
  const sb = config.streamerBot || {};
  lastConfig = config;
  if (!sb.enabled) {
    disconnect();
    setStatus({ connected: false, message: "Streamer.bot désactivé" });
    return getStatus();
  }

  if (connecting) return getStatus();
  connecting = true;

  // Keep retrying: Streamer.bot can take 10–20s after launch before :4457 listens.
  const retries = Number.isFinite(options.retries) ? options.retries : 12;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 1500;

  try {
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error("reconnect"));
    }
    pending.clear();

    setStatus({ message: "Connexion Streamer.bot…", connected: false });

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) {
        setStatus({
          connected: false,
          message: `Streamer.bot démarre… (${attempt}/${retries})`,
        });
        await new Promise((r) => setTimeout(r, delayMs));
      }
      const ok = await tryConnectOnce(config);
      if (ok?.connected) {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        return ok;
      }
    }

    setStatus({
      connected: false,
      message: "Streamer.bot injoignable (port 4457 — Servers/Clients, attendre le démarrage)",
    });
    scheduleReconnect(6000);
    return getStatus();
  } finally {
    connecting = false;
  }
}

async function getActions() {
  const res = await sendRequest({ request: "GetActions" });
  const list = res.actions || [];
  return list.map((a) => ({
    id: a.id,
    name: a.name,
    enabled: a.enabled !== false,
    subaction_count: a.subaction_count ?? a.subActionCount ?? 0,
  }));
}

async function getBroadcaster() {
  const res = await sendRequest({ request: "GetBroadcaster" });
  return {
    connected: res.connected || [],
    disconnected: res.disconnected || [],
    platforms: res.platforms || {},
  };
}

async function doAction(actionRef, args = {}) {
  const action =
    typeof actionRef === "string"
      ? { name: actionRef }
      : actionRef.id
        ? { id: actionRef.id }
        : { name: actionRef.name };
  return sendRequest({
    request: "DoAction",
    action,
    args,
  });
}

function resolveActionNames(config, actions) {
  const configured = config.streamerBot?.actions || {};
  const byName = new Map((actions || lastStatus.actions || []).map((a) => [a.name, a]));

  const pick = (...names) => {
    for (const n of names) {
      if (!n) continue;
      const hit = byName.get(n);
      if (hit && (hit.subaction_count === undefined || hit.subaction_count > 0 || n.startsWith("AnimeBeat"))) {
        return n;
      }
      if (hit) return n;
    }
    return names.find(Boolean) || "";
  };

  return {
    setTitle: pick(configured.setTitle, "AnimeBeat Set Title"),
    setGame: pick(configured.setGame, "AnimeBeat Set Game", "ChangeGameName"),
    setTitleAndGame: pick(configured.setTitleAndGame, "AnimeBeat Set Title Game"),
  };
}

async function applyTitleAndGame(config, { title, game }) {
  const sb = config.streamerBot || {};
  if (!sb.enabled) return { ok: false, skipped: true, platform: "streamerbot" };

  if (!lastStatus.connected) await connect(config, { retries: 8, delayMs: 1500 });
  if (!lastStatus.connected) {
    return { ok: false, platform: "streamerbot", reason: "Streamer.bot non connecté (port 4457 ?)" };
  }
  const platforms = lastStatus.platforms || platformList(lastStatus.broadcaster);
  if (!platforms.length) {
    notify(
      "Streamer.bot",
      "Connecté au WS mais aucun compte Twitch/Kick — vérifie Platforms dans Streamer.bot",
      "warn",
    );
  }

  let actions = lastStatus.actions || [];
  try {
    actions = await getActions();
    setStatus({ ...lastStatus, actions });
  } catch {
    /* keep cache */
  }

  const names = resolveActionNames(config, actions);
  const args = { title: title || "", game: game || "" };
  const results = [];

  try {
    if (names.setTitleAndGame) {
      results.push({
        action: names.setTitleAndGame,
        ...(await doAction(names.setTitleAndGame, args)),
      });
    } else {
      if (names.setTitle && title) {
        results.push({
          action: names.setTitle,
          ...(await doAction(names.setTitle, args)),
        });
      }
      if (names.setGame && game) {
        results.push({
          action: names.setGame,
          ...(await doAction(names.setGame, args)),
        });
      }
    }

    if (!results.length) {
      return {
        ok: false,
        platform: "streamerbot",
        reason:
          "Aucune action titre/jeu. Dans Stream Command → Installer actions AnimeBeat (ou crée AnimeBeat Set Title Game).",
        available: actions.map((a) => `${a.name} (${a.subaction_count} sub)`),
      };
    }

    const empty = actions.filter(
      (a) =>
        (a.name === names.setGame || a.name === names.setTitle || a.name === names.setTitleAndGame) &&
        a.subaction_count === 0,
    );
    if (empty.length) {
      notify(
        "Streamer.bot",
        `Action(s) vide(s): ${empty.map((a) => a.name).join(", ")} — installe les actions AnimeBeat`,
        "warn",
      );
    }

    return { ok: true, platform: "streamerbot", results, used: names };
  } catch (err) {
    return { ok: false, platform: "streamerbot", reason: err.message };
  }
}

module.exports = {
  connect,
  disconnect,
  getStatus,
  getActions,
  getBroadcaster,
  doAction,
  applyTitleAndGame,
};
