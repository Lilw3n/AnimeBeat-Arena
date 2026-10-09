const { ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const {
  loadConfig,
  saveConfig,
  updateConfig,
  getConfigPath,
  getClipsDir,
} = require("./config");
const obsBridge = require("./obs-bridge");
const multistream = require("./multistream");
const titles = require("./titles");
const gameSearch = require("./game-search");
const clips = require("./clips");
const ssnBridge = require("./ssn-bridge");
const streamerbotBridge = require("./streamerbot-bridge");
const { discoverAll, applyDiscovery } = require("./discover-local");
const { install: installSbActions } = require("./install-sb-actions");
const instagram = require("./platforms/instagram");
const facebook = require("./platforms/facebook");
const { notify } = require("./notify");

let getScreenCount = () => 2;
let commandWindowGetter = () => null;

function publicConfig(config) {
  // Never send secrets unnecessarily — UI still needs them for editing locally.
  return config;
}

function registerStreamIpc(options = {}) {
  if (typeof options.getScreenCount === "function") {
    getScreenCount = options.getScreenCount;
  }
  if (typeof options.getCommandWindow === "function") {
    commandWindowGetter = options.getCommandWindow;
  }

  const handlers = [
    ["stream:get-config", async () => publicConfig(loadConfig())],
    [
      "stream:save-config",
      async (_e, next) => {
        const saved = saveConfig(next);
        notify("Config", "Configuration enregistrée", "info");
        return publicConfig(saved);
      },
    ],
    [
      "stream:update-config",
      async (_e, patch) => publicConfig(updateConfig(patch)),
    ],
    [
      "stream:open-config-file",
      async () => {
        shell.showItemInFolder(getConfigPath());
        return { ok: true };
      },
    ],
    [
      "stream:obs-connect",
      async () => {
        const config = loadConfig();
        return obsBridge.connect(config.obs);
      },
    ],
    ["stream:obs-status", async () => obsBridge.getStatus()],
    [
      "stream:obs-list",
      async () => {
        const config = loadConfig();
        const [inputs, scenes] = await Promise.all([
          obsBridge.listInputs(config.obs).catch(() => []),
          obsBridge.listScenes(config.obs).catch(() => []),
        ]);
        return { inputs, scenes };
      },
    ],
    [
      "stream:search-games",
      async (_e, query) => gameSearch.searchGames(loadConfig(), query),
    ],
    [
      "stream:apply-titles",
      async (_e, payload) => {
        const config = loadConfig();
        return titles.applyEverywhere(config, {
          title: payload?.title,
          gameQuery: payload?.gameQuery,
          gameOverride: payload?.gameOverride,
          screenCount: getScreenCount(),
        });
      },
    ],
    [
      "stream:apply-preset",
      async (_e, presetId) => {
        const config = loadConfig();
        const preset = (config.presets || []).find((p) => p.id === presetId);
        if (!preset) return { ok: false, reason: "Preset introuvable" };
        return titles.applyEverywhere(config, {
          title: preset.title,
          gameQuery: preset.gameQuery,
          screenCount: getScreenCount(),
        });
      },
    ],
    [
      "stream:save-preset",
      async (_e, preset) => {
        const config = loadConfig();
        const id =
          preset.id ||
          String(preset.label || "preset")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-");
        const nextPreset = {
          id,
          label: preset.label || id,
          title: preset.title || "",
          gameQuery: preset.gameQuery || "",
        };
        const presets = [...(config.presets || []).filter((p) => p.id !== id), nextPreset];
        return publicConfig(saveConfig({ ...config, presets }));
      },
    ],
    [
      "stream:multistream-start",
      async (_e, payload) => {
        const config = loadConfig();
        const started = await multistream.start(config, {
          title: payload?.title,
          game: payload?.game,
        });
        // Persiste clés IG/FB récupérées via Live Producer
        if (started?.configPatch?.platforms) {
          saveConfig({
            ...config,
            platforms: {
              ...config.platforms,
              ...(started.configPatch.platforms.instagram
                ? {
                    instagram: {
                      ...config.platforms?.instagram,
                      ...started.configPatch.platforms.instagram,
                    },
                  }
                : {}),
              ...(started.configPatch.platforms.facebook
                ? {
                    facebook: {
                      ...config.platforms?.facebook,
                      ...started.configPatch.platforms.facebook,
                    },
                  }
                : {}),
            },
          });
        }
        const ingest = multistream.pointObsToIngest(config);
        try {
          await obsBridge.setCustomRtmp(config.obs, ingest.server, ingest.key);
          notify("OBS", "Destination RTMP pointée vers le relais local", "info");
        } catch (err) {
          notify("OBS", err.message || "Impossible de régler le RTMP OBS", "warn");
        }
        if (typeof payload?.screenCount === "number" || getScreenCount()) {
          try {
            await obsBridge.switchSceneForScreenCount(
              config.obs,
              payload?.screenCount || getScreenCount(),
            );
          } catch {
            /* optional */
          }
        }
        return started;
      },
    ],
    [
      "stream:instagram-prepare",
      async (_e, payload) => {
        const config = loadConfig();
        const title =
          String(payload?.title || "").trim() ||
          config.presets?.[0]?.title ||
          "Live AnimeBeat";
        const prepared = await instagram.prepareAndGetCredentials(title);
        if (!prepared.ok) return prepared;
        const next = {
          ...config,
          platforms: {
            ...config.platforms,
            instagram: {
              ...(config.platforms?.instagram || {}),
              enabled: true,
              rtmpUrl: prepared.rtmpUrl,
              streamKey: prepared.streamKey,
              lastPreparedAt: prepared.at,
              lastTitle: prepared.title,
              autoPrepare: true,
            },
          },
        };
        saveConfig(next);
        return { ok: true, ...prepared, config: publicConfig(next) };
      },
    ],
    [
      "stream:instagram-go-live",
      async () => instagram.goLive(),
    ],
    [
      "stream:instagram-open",
      async () => instagram.openProducer(),
    ],
    [
      "stream:facebook-prepare",
      async (_e, payload) => {
        const config = loadConfig();
        const title =
          String(payload?.title || "").trim() ||
          config.presets?.[0]?.title ||
          "Live AnimeBeat";
        const game = String(payload?.game || "").trim();
        const fb = {
          ...(config.platforms?.facebook || {}),
          enabled: true,
          useLiveProducer: true,
          pageId: config.platforms?.facebook?.pageId || "100036165385264",
          pageUrl:
            config.platforms?.facebook?.pageUrl ||
            "https://www.facebook.com/profile.php?id=100036165385264",
        };
        const prepared = await facebook.prepareViaProducer(fb, {
          title,
          game,
          description: payload?.description || `${title}${game ? ` — ${game}` : ""}`,
        });
        if (!prepared.ok) return prepared;
        const next = {
          ...config,
          platforms: {
            ...config.platforms,
            facebook: {
              ...fb,
              rtmpUrl: prepared.rtmpUrl,
              streamKey: prepared.streamKey,
              lastPreparedAt: prepared.at,
              lastTitle: prepared.title,
              autoCreateLive: false,
            },
          },
        };
        saveConfig(next);
        if (payload?.autoGoLive !== false) {
          facebook.watchAndGoLive(300000);
        }
        return { ok: true, ...prepared, config: publicConfig(next) };
      },
    ],
    [
      "stream:facebook-go-live",
      async (_e, payload) =>
        facebook.goLive({
          waitForReady: payload?.waitForReady !== false,
          timeoutMs: payload?.timeoutMs || 180000,
        }),
    ],
    [
      "stream:facebook-open",
      async () => {
        const config = loadConfig();
        return facebook.openProducer(config.platforms?.facebook || {});
      },
    ],
    [
      "stream:multistream-stop",
      async () => multistream.stop(loadConfig()),
    ],
    ["stream:multistream-status", async () => multistream.getStatus()],
    [
      "stream:obs-start-stream",
      async () => {
        const config = loadConfig();
        return obsBridge.startStream(config.obs);
      },
    ],
    [
      "stream:obs-stop-stream",
      async () => {
        const config = loadConfig();
        return obsBridge.stopStream(config.obs);
      },
    ],
    [
      "stream:clip",
      async () => {
        const config = loadConfig();
        return clips.saveClipFromObs(config, commandWindowGetter());
      },
    ],
    [
      "stream:open-clips",
      async () => {
        const dir = getClipsDir(loadConfig());
        shell.openPath(dir);
        return { ok: true, dir };
      },
    ],
    [
      "stream:sync-obs-screens",
      async (_e, screenCount) => {
        const config = loadConfig();
        const count = Number(screenCount) || getScreenCount();
        return obsBridge.switchSceneForScreenCount(config.obs, count);
      },
    ],
    [
      "stream:ssn-connect",
      async () => ssnBridge.connect(loadConfig()),
    ],
    ["stream:ssn-status", async () => ssnBridge.getStatus()],
    [
      "stream:ssn-urls",
      async () => {
        const config = loadConfig();
        return {
          dock: ssnBridge.dockUrl(config),
          featured: ssnBridge.featuredUrl(config),
        };
      },
    ],
    [
      "stream:ssn-send",
      async (_e, message) => ssnBridge.sendChat(loadConfig(), message),
    ],
    [
      "stream:streamerbot-connect",
      async () => streamerbotBridge.connect(loadConfig()),
    ],
    ["stream:streamerbot-status", async () => streamerbotBridge.getStatus()],
    [
      "stream:streamerbot-actions",
      async () => {
        try {
          return { ok: true, actions: await streamerbotBridge.getActions() };
        } catch (err) {
          return { ok: false, actions: [], reason: err.message };
        }
      },
    ],
    [
      "stream:obs-set-scene",
      async (_e, sceneName) => {
        const config = loadConfig();
        try {
          return await obsBridge.setCurrentScene(config.obs, sceneName);
        } catch (err) {
          return { ok: false, reason: err.message };
        }
      },
    ],
    [
      "stream:discover-local",
      async () => {
        const discovered = discoverAll();
        const current = loadConfig();
        const { config: next } = applyDiscovery(current, discovered);
        saveConfig(next);
        notify(
          "Auto-détection",
          `SSN=${next.socialStreamNinja?.sessionId || "?"} · OBS :${next.obs?.port} · SB :${next.streamerBot?.port}`,
          "info",
        );
        return { ok: true, discovered, config: next };
      },
    ],
    [
      "stream:install-sb-actions",
      async () => {
        try {
          const result = installSbActions();
          const current = loadConfig();
          current.streamerBot = current.streamerBot || {};
          current.streamerBot.enabled = true;
          current.streamerBot.port = 4457;
          current.streamerBot.actions = {
            setTitle: "AnimeBeat Set Title",
            setGame: "AnimeBeat Set Game",
            setTitleAndGame: "AnimeBeat Set Title Game",
          };
          saveConfig(current);
          notify(
            "Streamer.bot",
            "Actions installées — redémarrage + reconnexion (attente WS 4457)…",
            "info",
          );
          // Relance SB pour charger actions.json, puis retry WS (démarrage lent ~15s)
          try {
            const { execSync } = require("child_process");
            execSync("taskkill /IM Streamer.bot.exe /F", { stdio: "ignore" });
          } catch {
            /* already stopped */
          }
          const exe = current.appPaths?.streamerBot;
          if (exe && fs.existsSync(exe)) {
            spawn(exe, [], {
              detached: true,
              stdio: "ignore",
              cwd: require("path").dirname(exe),
            }).unref();
          }
          const status = await streamerbotBridge.connect(current, {
            retries: 20,
            delayMs: 2000,
          });
          return { ok: true, ...result, status };
        } catch (err) {
          notify("Streamer.bot", err.message, "warn");
          return { ok: false, reason: err.message };
        }
      },
    ],
    [
      "stream:launch-app",
      async (_e, which) => {
        const config = loadConfig();
        const map = {
          socialstream: config.appPaths?.socialstream,
          streamerBot: config.appPaths?.streamerBot,
          obs: config.appPaths?.obs,
        };
        const exe = map[which];
        if (!exe || !fs.existsSync(exe)) {
          return { ok: false, reason: `Exécutable introuvable: ${which}` };
        }
        const cwd = which === "obs" ? require("path").dirname(exe) : undefined;
        spawn(exe, [], { detached: true, stdio: "ignore", cwd }).unref();
        return { ok: true, exe };
      },
    ],
    [
      "stream:obs-dashboard",
      async () => {
        const config = loadConfig();
        const status = obsBridge.getStatus();
        let inputs = [];
        let scenes = [];
        let stream = null;
        if (status.connected || config.obs?.enabled) {
          try {
            if (!status.connected) await obsBridge.connect(config.obs);
            inputs = await obsBridge.listInputs(config.obs);
            scenes = await obsBridge.listScenes(config.obs);
            stream = await obsBridge.getStreamStatus(config.obs);
          } catch (err) {
            return {
              ok: false,
              status: obsBridge.getStatus(),
              reason: err.message,
              config: config.obs,
            };
          }
        }
        return {
          ok: true,
          status: obsBridge.getStatus(),
          inputs,
          scenes,
          stream,
          config: config.obs,
          ingest: multistream.pointObsToIngest(config),
          multistream: multistream.getStatus(),
        };
      },
    ],
  ];

  for (const [channel, handler] of handlers) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  }
}

module.exports = { registerStreamIpc };
