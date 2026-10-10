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
const liveViewers = require("./live-viewers");
const streamerbotBridge = require("./streamerbot-bridge");
const { discoverAll, applyDiscovery } = require("./discover-local");
const { install: installSbActions } = require("./install-sb-actions");
const instagram = require("./platforms/instagram");
const facebook = require("./platforms/facebook");
const companions = require("./companions");
const goLivePipeline = require("./go-live-pipeline");
const nginxRtmp = require("./nginx-rtmp");
const autoUpdate = require("./auto-update");
const { buildLiveLinks } = require("./live-links");
const { verifyLiveUpdates } = require("./verify-live-updates");
const streamRoutes = require("./stream-routes");
const streamDestinations = require("./stream-destinations");
const { notify } = require("./notify");

/**
 * Termine un live Meta (FB ou IG) sans Stop Stream OBS:
 * 1) clic « Terminer le direct » dans Live Producer
 * 2) retire le push nginx de cette plateforme (l’autre reste)
 * 3) efface liveUrl / clé de session dans la config
 */
async function endMetaLivePlatform(platform) {
  const which = String(platform || "").toLowerCase();
  if (which !== "facebook" && which !== "instagram") {
    return { ok: false, reason: "platform doit être facebook ou instagram" };
  }
  const config = loadConfig();
  let ended = { ok: false, reason: "non tenté" };
  try {
    ended =
      which === "facebook"
        ? await facebook.endBroadcast()
        : await instagram.endBroadcast();
  } catch (err) {
    ended = { ok: false, reason: err.message || "échec Producer" };
  }

  // Graph API FB en secours si on a encore un liveVideoId + token
  if (which === "facebook" && !ended.ok) {
    const fb = config.platforms?.facebook || {};
    const liveId = fb.liveVideoId || fb.liveId || "";
    if (liveId && fb.accessToken) {
      try {
        const graph = await facebook.endLive(fb, liveId);
        if (graph.ok) ended = { ...graph, via: "graph" };
      } catch {
        /* ignore */
      }
    }
  }

  let nginx = { ok: false, skipped: true };
  try {
    nginx = nginxRtmp.clearPlatformPush(config, which);
  } catch (err) {
    nginx = { ok: false, reason: err.message };
  }

  const cleared = {
    ...config,
    platforms: {
      ...config.platforms,
      [which]: {
        ...(config.platforms?.[which] || {}),
        streamKey: "",
        rtmpUrl: "",
        liveUrl: "",
        liveId: "",
        liveVideoId: "",
        lastEndedAt: new Date().toISOString(),
      },
    },
  };
  saveConfig(cleared);

  const ok = Boolean(ended.ok || nginx.ok);
  let msg;
  if (ended.ok && nginx.ok) {
    msg = "Direct terminé + push nginx retiré — OBS continue";
  } else if (ended.ok) {
    msg = "Direct terminé dans Producer — OBS continue";
  } else if (nginx.ok) {
    msg =
      "Push nginx coupé (plus de flux Meta) — si le badge LIVE reste, clique Terminer dans la fenêtre IG/FB";
  } else {
    msg = ended.reason || nginx.reason || "échec fin de live";
  }
  notify(which === "facebook" ? "Facebook" : "Instagram", msg, ok ? "info" : "warn");
  return {
    ok,
    platform: which,
    ended,
    nginx,
    obsUntouched: true,
    message: msg,
    config: publicConfig(loadConfig()),
  };
}

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
    ["stream:update-status", async () => autoUpdate.getStatus()],
    [
      "stream:update-check",
      async () => autoUpdate.checkForUpdates({ silent: false }),
    ],
    ["stream:update-install", async () => autoUpdate.quitAndInstall()],
    [
      "stream:update-settings",
      async (_e, patch) => autoUpdate.saveSettings(patch || {}),
    ],
    [
      "stream:update-open-release",
      async () => {
        const dir =
          autoUpdate.resolveUpdateSettings().localDir ||
          autoUpdate.defaultLocalReleaseDir();
        fs.mkdirSync(dir, { recursive: true });
        shell.openPath(dir);
        return { ok: true, dir };
      },
    ],
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
      "stream:open-url",
      async (_e, rawUrl) => {
        let url = String(rawUrl || "").trim();
        if (!url) return { ok: false, reason: "URL vide" };
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        await shell.openExternal(url);
        return { ok: true, url };
      },
    ],
    ["stream:get-live-links", async () => buildLiveLinks(loadConfig())],
    [
      "stream:routes-status",
      async () => {
        const config = loadConfig();
        const routes = streamRoutes.getRoutes(config);
        const nginx = nginxRtmp.isNginxListening1935();
        const paths = nginxRtmp.resolveNginxPaths(config);
        return {
          ok: true,
          routes,
          nginx: {
            listening: Boolean(nginx.ok && nginx.isNginx),
            pid: nginx.pid || null,
            conf: paths.conf,
            exe: paths.exe,
          },
          obsMode: config.obs?.streamDestinationMode || "leave",
          igVia: config.aitumVertical?.igVia || "aitum",
        };
      },
    ],
    [
      "stream:routes-apply",
      async (_e, payload = {}) => {
        const config = loadConfig();
        const applied = streamRoutes.applyRoutes(config, {
          horizontal: payload.horizontal,
          vertical: payload.vertical,
        });
        saveConfig(applied.config);
        notify(
          "Flux",
          applied.changed.length
            ? `Mis à jour: ${applied.changed.join(", ")}`
            : `OK · ${applied.routes.diagram}`,
          "info",
        );
        return {
          ok: true,
          changed: applied.changed,
          routes: applied.routes,
          config: applied.config,
        };
      },
    ],
    [
      "stream:destinations-status",
      async () => streamDestinations.getStatus(),
    ],
    [
      "stream:destination-toggle",
      async (_e, payload = {}) => {
        const id = String(payload.platform || payload.id || "").toLowerCase();
        const enabled = Boolean(payload.enabled);
        return streamDestinations.setEnabled(id, enabled);
      },
    ],
    [
      "stream:destinations-all",
      async (_e, payload = {}) => {
        return streamDestinations.setAllWithKeys(Boolean(payload.enabled));
      },
    ],
    [
      "stream:copy-text",
      async (_e, text) => {
        const { clipboard } = require("electron");
        clipboard.writeText(String(text || ""));
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
          platforms: payload?.platforms,
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
          platforms: "all",
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
          // Respecte Restream: setCustomRtmp no-op si streamDestinationMode=leave
          await obsBridge.setCustomRtmp(config.obs, ingest.server, ingest.key);
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
        const igPatch = {};
        if (payload?.videoDeviceId != null) igPatch.videoDeviceId = payload.videoDeviceId;
        if (payload?.videoDeviceLabel != null) igPatch.videoDeviceLabel = payload.videoDeviceLabel;
        if (payload?.linkUrl != null) igPatch.linkUrl = payload.linkUrl;
        if (payload?.linkTitle != null) igPatch.linkTitle = payload.linkTitle;
        const igCfg = {
          ...(config.platforms?.instagram || {}),
          ...igPatch,
          enabled: true,
          autoPrepare: true,
          startObsVirtualCam: true,
          // Efface l’ancienne clé en config pour ne pas la repousser vers Aitum/nginx
          streamKey: "",
          rtmpUrl: "",
        };
        // Persiste le wipe avant prepare (évite push Aitum avec stale key)
        saveConfig({
          ...config,
          platforms: {
            ...config.platforms,
            instagram: {
              ...(config.platforms?.instagram || {}),
              ...igCfg,
            },
          },
        });
        // 1) Live Producer: titre + lien + NOUVELLE clé (Réinitialiser si écran déjà ouvert)
        const prepared = await instagram.prepareAndGetCredentials(title, {
          instagramConfig: igCfg,
          obsConfig: config.obs,
          aitumVertical: config.aitumVertical || {},
          linkUrl: igCfg.linkUrl,
          linkTitle: igCfg.linkTitle,
          autoGoLive: goLivePipeline.isAutoGoLiveEnabled({
            ...config,
            platforms: { ...config.platforms, instagram: igCfg },
          }),
        });
        if (!prepared.ok) return prepared;
        if (!prepared.streamKey) {
          return { ok: false, reason: "Aucune nouvelle clé IG récupérée" };
        }

        // 1b) Clé → OBS (Aitum Vertical) + Start Streaming, puis Go Live
        let aitumPush = prepared.aitumPush || null;
        try {
          if (!aitumPush?.ok || aitumPush?.skipped) {
            aitumPush = await obsBridge.pushInstagramKeyToAitum(
              config.obs,
              {
                rtmpUrl: prepared.rtmpUrl,
                streamKey: prepared.streamKey,
              },
              config.aitumVertical || {},
            );
          }
          if (aitumPush?.ok && !aitumPush.skipped) {
            const started = await obsBridge.startAitumStreaming(config.obs);
            aitumPush = { ...aitumPush, streamingStarted: Boolean(started?.ok), start: started };
            if (!started?.ok) {
              notify("Aitum", started?.reason || "Start Streaming Vertical échoué", "warn");
            }
          }
        } catch (err) {
          aitumPush = { ...(aitumPush || {}), ok: false, reason: err.message };
        }

        const next = {
          ...config,
          platforms: {
            ...config.platforms,
            instagram: {
              ...igCfg,
              enabled: true,
              rtmpUrl: prepared.rtmpUrl,
              streamKey: prepared.streamKey,
              lastPreparedAt: prepared.at,
              lastTitle: prepared.title,
              linkUrl: prepared.linkUrl || igCfg.linkUrl || "",
              linkTitle: prepared.linkTitle || igCfg.linkTitle || "",
              videoDeviceId: igCfg.videoDeviceId || "",
              videoDeviceLabel: igCfg.videoDeviceLabel || "OBS Virtual Camera",
              lastAitumPushAt: new Date().toISOString(),
              lastAitumPushOk: Boolean(aitumPush?.ok),
            },
          },
        };
        saveConfig(next);

        // 2) Multistream local optionnel — NE PAS écraser Restream (IG = Aitum)
        let ms = multistream.getStatus();
        const igViaAitum = goLivePipeline.usesAitumForIg(next);
        const preserveObs = obsBridge.shouldPreserveObsDestination(next.obs);
        if (!ms.running && !igViaAitum && !preserveObs) {
          const started = await multistream.start(next, {
            title,
            game: payload?.game || "",
            skipInstagramPrepare: true,
          });
          if (started?.configPatch?.platforms) {
            Object.assign(next.platforms, started.configPatch.platforms);
            saveConfig(next);
          }
          const ingest = multistream.pointObsToIngest(next);
          try {
            await obsBridge.connect(next.obs);
            await obsBridge.setCustomRtmp(next.obs, ingest.server, ingest.key);
          } catch (err) {
            notify("OBS", err.message || "Impossible de régler le RTMP OBS", "warn");
          }
          ms = started;
        } else if (preserveObs || igViaAitum) {
          notify(
            "OBS",
            igViaAitum
              ? "IG via Aitum — Restream / stream OBS principal intact"
              : "Destination OBS préservée (Restream)",
            "info",
          );
        }

        const wired = multistream.applyInstagramDestination(next);
        if (wired.needsMultistream && !igViaAitum && !preserveObs) {
          notify("Instagram", "Démarre le multistream puis republie OBS", "warn");
        }

        // 3) Suite auto Go Live IG — sans stop/repoint Restream
        let continued = null;
        if (payload?.continueGoLive !== false) {
          continued = await goLivePipeline.continuePushAndGoLive({
            force: true,
            platforms: ["instagram"],
            startObsStream:
              payload?.startObsStream === true
                ? true
                : payload?.startObsStream === false
                  ? false
                  : !igViaAitum && !preserveObs,
            timeoutMs: payload?.timeoutMs || 300000,
          });
        } else if (wired.pending) {
          notify(
            "Instagram",
            "Clé prête — utilise Relancer Instagram pour pousser + Go Live",
            "info",
          );
        }

        // 4) Chat IG SSN en arrière-plan (ne bloque / ne plante pas le Go Live)
        let ssnIg = null;
        try {
          ssnIg = await Promise.race([
            ssnBridge.ensureInstagramChat(loadConfig(), {
              liveUrl: next.platforms?.instagram?.liveUrl || prepared.liveUrl,
              username: next.platforms?.instagram?.username,
              forceRestart: true,
              timeoutMs: 12000,
              relaunchIfNoApi: false,
            }),
            new Promise((resolve) =>
              setTimeout(
                () => resolve({ ok: false, skipped: true, reason: "SSN timeout (non bloquant)" }),
                15000,
              ),
            ),
          ]);
        } catch (err) {
          ssnIg = { ok: false, reason: err.message };
        }

        return {
          ok: true,
          ...prepared,
          aitumPush,
          wired,
          continued,
          ssnIg,
          multistream: ms,
          config: publicConfig(loadConfig()),
        };
      },
    ],
    [
      "stream:aitum-push-ig",
      async () => {
        const config = loadConfig();
        const ig = config.platforms?.instagram || {};
        return obsBridge.pushInstagramKeyToAitum(
          config.obs,
          { rtmpUrl: ig.rtmpUrl, streamKey: ig.streamKey },
          config.aitumVertical || {},
        );
      },
    ],
    [
      "stream:instagram-go-live",
      async (_e, payload) => {
        const live = await instagram.goLive({
          waitForReady: payload?.waitForReady !== false,
          timeoutMs: payload?.timeoutMs || 180000,
          probePreview: true,
        });
        let ssnIg = null;
        try {
          const config = loadConfig();
          ssnIg = await ssnBridge.ensureInstagramChat(config, {
            liveUrl: config.platforms?.instagram?.liveUrl,
            username: config.platforms?.instagram?.username,
            forceRestart: true,
            mode: "live",
          });
        } catch (err) {
          ssnIg = { ok: false, reason: err.message };
        }
        return { ...live, ssnIg };
      },
    ],
    [
      "stream:ssn-ensure-instagram",
      async (_e, payload) => {
        const config = loadConfig();
        return ssnBridge.ensureInstagramChat(config, {
          liveUrl: payload?.liveUrl || config.platforms?.instagram?.liveUrl,
          username: payload?.username || config.platforms?.instagram?.username,
          forceRestart: payload?.forceRestart !== false,
          relaunchIfNoApi: payload?.relaunchIfNoApi !== false,
          mode: payload?.mode || "auto",
        });
      },
    ],
    [
      "stream:instagram-open",
      async () => {
        const config = loadConfig();
        const ig = config.platforms?.instagram || {};
        instagram.setCameraPreference({
          deviceId: ig.videoDeviceId,
          deviceLabel: ig.videoDeviceLabel || "OBS Virtual Camera",
        });
        return instagram.openProducer();
      },
    ],
    [
      "stream:list-cameras",
      async () => {
        const devices = await instagram.listCameras();
        const config = loadConfig();
        let virtualCam = { ok: false, active: false };
        try {
          await obsBridge.connect(config.obs);
          virtualCam = await obsBridge.getVirtualCamStatus(config.obs);
        } catch {
          /* optional */
        }
        return { ...devices, virtualCam };
      },
    ],
    [
      "stream:obs-virtual-cam-start",
      async (_e, payload) => {
        const config = loadConfig();
        await obsBridge.connect(config.obs);
        // Par défaut: Aitum Vertical Canvas (IG/TikTok), pas seulement VirtualCam paysage
        return obsBridge.startVirtualCam(config.obs, {
          preferAitum: payload?.preferAitum !== false,
        });
      },
    ],
    [
      "stream:obs-virtual-cam-status",
      async () => {
        const config = loadConfig();
        try {
          await obsBridge.connect(config.obs);
          return obsBridge.getVirtualCamStatus(config.obs);
        } catch (err) {
          return { ok: false, active: false, reason: err.message };
        }
      },
    ],
    [
      "stream:aitum-vertical-start",
      async () => {
        const config = loadConfig();
        await obsBridge.connect(config.obs);
        return obsBridge.startAitumVerticalVirtualCam(config.obs);
      },
    ],
    [
      "stream:aitum-vertical-status",
      async () => {
        const config = loadConfig();
        try {
          await obsBridge.connect(config.obs);
          return obsBridge.getAitumVerticalStatus(config.obs);
        } catch (err) {
          return { ok: false, virtualCamera: false, reason: err.message };
        }
      },
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
        const baseFb = config.platforms?.facebook || {};
        const fb = {
          ...baseFb,
          enabled: true,
          useLiveProducer: true,
          destination: payload?.destination || baseFb.destination || "page",
          pageId: payload?.pageId || baseFb.pageId || "100036165385264",
          pageUrl:
            payload?.pageUrl ||
            baseFb.pageUrl ||
            "https://www.facebook.com/profile.php?id=100036165385264",
          pageName: payload?.pageName || baseFb.pageName || "Lilwen54",
          businessAssetId: payload?.businessAssetId || baseFb.businessAssetId,
          groupId: payload?.groupId ?? baseFb.groupId,
          groupUrl: payload?.groupUrl ?? baseFb.groupUrl,
          savedPages: Array.isArray(baseFb.savedPages) ? baseFb.savedPages : [],
          savedGroups: Array.isArray(baseFb.savedGroups) ? baseFb.savedGroups : [],
          personalProfileUrl:
            baseFb.personalProfileUrl || "https://www.facebook.com/DiddySong/",
          linkUrl: payload?.linkUrl ?? baseFb.linkUrl,
          linkTitle: payload?.linkTitle ?? baseFb.linkTitle,
        };
        const description = String(
          payload?.description ||
            baseFb.lastDescription ||
            `${title}${game ? ` — ${game}` : ""}`,
        ).trim();
        const prepared = await facebook.prepareViaProducer(fb, {
          title,
          game,
          description,
          linkUrl: fb.linkUrl,
          linkTitle: fb.linkTitle,
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
              lastTitle: prepared.title || title,
              lastDescription: description,
              lastGame: game || fb.lastGame || "",
              destination: prepared.destination || fb.destination,
              linkUrl: prepared.linkUrl || fb.linkUrl,
              linkTitle: prepared.linkTitle || fb.linkTitle,
              autoCreateLive: false,
            },
          },
        };
        saveConfig(next);
        let continued = null;
        // Par défaut: enchaîner nginx + OBS + Go Live (sinon l'auto s'arrête après Préparer)
        if (payload?.continueGoLive !== false) {
          continued = await goLivePipeline.continuePushAndGoLive({
            force: true,
            platforms: ["facebook"],
            startObsStream: payload?.startObsStream !== false,
            timeoutMs: payload?.timeoutMs || 300000,
          });
        } else if (payload?.autoGoLive !== false && goLivePipeline.isAutoGoLiveEnabled(next)) {
          facebook.watchAndGoLive(300000);
        }
        return {
          ok: true,
          ...prepared,
          continued,
          config: publicConfig(loadConfig()),
        };
      },
    ],
    [
      "stream:facebook-go-live",
      async (_e, payload) => {
        const config = loadConfig();
        return facebook.goLive({
          waitForReady: payload?.waitForReady !== false,
          timeoutMs: payload?.timeoutMs || 180000,
          probePreview: true,
          facebookConfig: config.platforms?.facebook || {},
        });
      },
    ],
    [
      "stream:facebook-end-live",
      async () => endMetaLivePlatform("facebook"),
    ],
    [
      "stream:facebook-test-graph",
      async (_e, payload) => {
        const config = loadConfig();
        const fb = {
          ...(config.platforms?.facebook || {}),
          ...(payload?.accessToken
            ? { accessToken: String(payload.accessToken).trim() }
            : {}),
          ...(payload?.pageId ? { pageId: String(payload.pageId).trim() } : {}),
        };
        if (payload?.save) {
          saveConfig({
            ...config,
            platforms: {
              ...config.platforms,
              facebook: {
                ...(config.platforms?.facebook || {}),
                accessToken: fb.accessToken || "",
                ...(fb.pageId ? { pageId: fb.pageId } : {}),
              },
            },
          });
        }
        const result = await facebook.testGraph(fb);
        return { ...result, config: publicConfig(loadConfig()) };
      },
    ],
    [
      "stream:instagram-end-live",
      async () => endMetaLivePlatform("instagram"),
    ],
    [
      "stream:end-meta-lives",
      async (_e, payload) => {
        const want = Array.isArray(payload?.platforms)
          ? payload.platforms.map((p) => String(p).toLowerCase())
          : ["instagram", "facebook"];
        const out = { ok: true, obsUntouched: true, results: {} };
        for (const p of want) {
          if (p !== "facebook" && p !== "instagram") continue;
          out.results[p] = await endMetaLivePlatform(p);
          if (!out.results[p].ok) out.ok = false;
        }
        out.config = publicConfig(loadConfig());
        return out;
      },
    ],
    [
      "stream:instagram-apply-camera",
      async (_e, payload) => {
        const config = loadConfig();
        const deviceId = String(payload?.deviceId || payload?.videoDeviceId || "").trim();
        const deviceLabel = String(
          payload?.deviceLabel || payload?.videoDeviceLabel || "",
        ).trim();
        const next = {
          ...config,
          platforms: {
            ...config.platforms,
            instagram: {
              ...(config.platforms?.instagram || {}),
              ...(deviceId ? { videoDeviceId: deviceId } : {}),
              ...(deviceLabel ? { videoDeviceLabel: deviceLabel } : {}),
            },
          },
        };
        saveConfig(next);
        const applied = await instagram.applyCameraPreferenceNow({
          deviceId: deviceId || next.platforms.instagram.videoDeviceId,
          deviceLabel:
            deviceLabel ||
            next.platforms.instagram.videoDeviceLabel ||
            "OBS Virtual Camera",
        });
        return {
          ...applied,
          config: publicConfig(loadConfig()),
        };
      },
    ],
    [
      "stream:push-live-meta",
      async (_e, payload) => {
        const config = loadConfig();
        const platform = String(payload?.platform || "").toLowerCase();
        const title =
          String(payload?.title || "").trim() ||
          config.platforms?.[platform]?.lastTitle ||
          config.presets?.[0]?.title ||
          "";
        const description = String(
          payload?.description ||
            config.platforms?.[platform]?.lastDescription ||
            "",
        ).trim();
        const game = String(payload?.game || "").trim();
        const linkUrl = String(payload?.linkUrl || "").trim();
        const linkTitle = String(payload?.linkTitle || "").trim();
        const wantTitle = payload?.updateTitle !== false;
        const wantLink = payload?.updateLink !== false && Boolean(linkUrl);

        if (platform === "facebook") {
          const next = {
            ...config,
            platforms: {
              ...config.platforms,
              facebook: {
                ...(config.platforms?.facebook || {}),
                ...(title ? { lastTitle: title } : {}),
                ...(description ? { lastDescription: description } : {}),
                ...(game ? { lastGame: game } : {}),
                ...(linkUrl ? { linkUrl } : {}),
                ...(linkTitle ? { linkTitle } : {}),
              },
            },
          };
          saveConfig(next);
          const out = {
            ok: true,
            saved: true,
            platform: "facebook",
            title: null,
            link: null,
            producerOpen: Boolean(facebook.getProducerStatus?.()?.open),
          };
          const fbCfg = next.platforms.facebook;
          if (wantTitle && title) {
            out.title = await facebook.updateTitleGame({
              title,
              game,
              description:
                description ||
                `${title}${game ? ` — ${game}` : ""}`,
              facebookConfig: fbCfg,
              autoOpen: true,
            });
          }
          if (wantLink) {
            out.link = await facebook.updateStickyLink({
              linkUrl,
              linkTitle,
              facebookConfig: fbCfg,
              autoOpen: true,
            });
          }
          out.live = Boolean(out.title?.live || out.link?.live || out.title?.ok || out.link?.ok);
          out.skippedLive = Boolean(
            (wantTitle && out.title?.skipped) || (wantLink && out.link?.skipped),
          );
          out.ok = Boolean(out.live || out.saved);
          if ((wantTitle || wantLink) && !out.live) {
            out.reason =
              out.title?.reason ||
              out.link?.reason ||
              "Infos sauvées — Producer FB non joignable";
          }
          out.config = publicConfig(loadConfig());
          return out;
        }

        if (platform === "instagram") {
          const next = {
            ...config,
            platforms: {
              ...config.platforms,
              instagram: {
                ...(config.platforms?.instagram || {}),
                ...(title ? { lastTitle: title } : {}),
                ...(linkUrl ? { linkUrl } : {}),
                ...(linkTitle ? { linkTitle } : {}),
              },
            },
          };
          saveConfig(next);
          const out = {
            ok: true,
            saved: true,
            platform: "instagram",
            title: null,
            link: null,
            producerOpen: Boolean(instagram.getProducerStatus?.()?.open),
          };
          if (wantTitle && title) {
            out.title = await instagram.updateTitle({ title, autoOpen: true });
          }
          if (wantLink) {
            out.link = await instagram.updateStickyLink({
              linkUrl,
              linkTitle,
              autoOpen: true,
            });
          }
          out.live = Boolean(out.title?.live || out.link?.live || out.title?.ok || out.link?.ok);
          out.skippedLive = Boolean(
            (wantTitle && out.title?.skipped) || (wantLink && out.link?.skipped),
          );
          out.ok = Boolean(out.live || out.saved);
          if ((wantTitle || wantLink) && !out.live) {
            out.reason =
              out.title?.reason ||
              out.link?.reason ||
              "Infos sauvées — Producer IG non joignable";
          }
          out.config = publicConfig(loadConfig());
          return out;
        }

        return { ok: false, reason: "platform = facebook | instagram" };
      },
    ],
    [
      "stream:verify-live-updates",
      async (_e, payload) =>
        verifyLiveUpdates({
          probe: Boolean(payload?.probe),
          fixPages: Boolean(payload?.fixPages),
          title: payload?.title,
          gameQuery: payload?.gameQuery,
          platforms: payload?.platforms,
        }),
    ],
    [
      "stream:verify-fix-pages",
      async (_e, payload) => {
        const pageMeta = require("./page-meta");
        const config = loadConfig();
        const title = String(payload?.title || "").trim();
        const game = String(payload?.game || payload?.gameQuery || "").trim();
        return pageMeta.fixMetaViaPages(config, {
          title,
          game,
          platforms: payload?.platforms,
          forceOpen: payload?.forceOpen !== false,
        });
      },
    ],
    [
      "stream:refresh-live-urls",
      async (_e, payload) => {
        const config = loadConfig();
        const want = payload?.platforms || ["facebook", "instagram"];
        const out = { ok: true, facebook: null, instagram: null };
        if (want.includes("facebook")) {
          out.facebook = await facebook.capturePublicLiveUrl(config.platforms?.facebook || {});
        }
        if (want.includes("instagram")) {
          out.instagram = await instagram.capturePublicLiveUrl(config.platforms?.instagram || {});
        }
        out.links = buildLiveLinks(loadConfig());
        out.config = publicConfig(loadConfig());
        const any = Boolean(out.facebook?.ok || out.instagram?.ok);
        notify(
          "Liens live",
          any
            ? `FB=${out.facebook?.liveUrl ? "OK" : "—"} · IG=${out.instagram?.liveUrl ? "OK" : "—"}`
            : "Aucun lien live trouvé — lance le direct puis réessaie",
          any ? "info" : "warn",
        );
        return out;
      },
    ],
    [
      "stream:arm-go-live",
      async (_e, payload) =>
        goLivePipeline.armPushAndGoLive({
          force: Boolean(payload?.force),
          startObsStream: payload?.startObsStream !== false,
          platforms: payload?.platforms,
          timeoutMs: payload?.timeoutMs || 300000,
          title: payload?.title,
          game: payload?.game,
        }),
    ],
    [
      "stream:continue-go-live",
      async (_e, payload) =>
        goLivePipeline.continuePushAndGoLive({
          force: payload?.force !== false,
          startObsStream: payload?.startObsStream !== false,
          platforms: payload?.platforms,
          timeoutMs: payload?.timeoutMs || 300000,
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
      async () => {
        const config = loadConfig();
        liveViewers.start(config);
        return ssnBridge.connect(config);
      },
    ],
    ["stream:ssn-status", async () => ssnBridge.getStatus()],
    ["stream:live-viewers", async () => liveViewers.getSnapshot()],
    [
      "stream:live-viewers-refresh",
      async () => liveViewers.refresh(loadConfig()),
    ],
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
        return companions.launchOne(String(which), config, { force: true });
      },
    ],
    [
      "stream:companions-ensure",
      async (_e, payload) => {
        const config = loadConfig();
        return companions.ensureAll(config, { force: Boolean(payload?.force) });
      },
    ],
    [
      "stream:companions-status",
      async () => companions.getStatus(loadConfig()),
    ],
    [
      "stream:companions-dismiss",
      async (_e, which) => {
        companions.markDismissed(String(which), "Marqué ignoré");
        return { ok: true, status: companions.getStatus(loadConfig()) };
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

  try {
    liveViewers.start(loadConfig());
  } catch {
    /* ignore */
  }
}

module.exports = { registerStreamIpc };
