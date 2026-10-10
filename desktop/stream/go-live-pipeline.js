/**
 * Go Live IG/FB avec la stack réelle :
 * OBS → nginx:1935/live → stunnel (19350 FB / 19351 IG) → Meta
 * 1) Prépare Live Producer (écran Go Live)
 * 2) Injecte les clés dans nginx + reload
 * 3) Vérifie OBS → ingest local
 * 4) Attend bouton actif (preview) → clique
 * Garde-fou: streamGuard.autoGoLive (sauf force)
 */
const { loadConfig, saveConfig } = require("./config");
const obsBridge = require("./obs-bridge");
const multistream = require("./multistream");
const nginxRtmp = require("./nginx-rtmp");
const instagram = require("./platforms/instagram");
const facebook = require("./platforms/facebook");
const { notify } = require("./notify");

function guardAllows(config, force) {
  if (force) return true;
  return config.streamGuard?.autoGoLive === true;
}

/** IG via Aitum Vertical Streaming (pas OBS Start Stream classique). */
function usesAitumForIg(config) {
  const a = config?.aitumVertical || {};
  if (a.enabled === false || a.pushIgCredentials === false) return false;
  if (a.igVia === "nginx") return false;
  // stunnel = OBS→nginx→IG ; producer = Aitum → RTMPS IG direct
  if (String(a.serverMode || "producer").toLowerCase() === "stunnel" && a.igVia !== "aitum") {
    return false;
  }
  return true;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureObsToNginx(config, { forceRestart = false } = {}) {
  await obsBridge.connect(config.obs);
  const st = await obsBridge.getStreamStatus(config.obs);
  const preserve = obsBridge.shouldPreserveObsDestination(config.obs);

  // Mode Restream / leave: NE JAMAIS stop ni écraser la destination OBS
  if (preserve) {
    const svc = await obsBridge.getStreamServiceSettings(config.obs).catch(() => null);
    if (st?.outputActive) {
      notify(
        "OBS",
        "Stream OBS déjà ON (Restream préservé) — pas de stop / pas de nginx",
        "info",
      );
      return {
        ok: true,
        skipped: true,
        preserved: true,
        via: "restream-leave",
        server: svc?.streamServiceSettings?.server || "",
        alreadyLive: true,
      };
    }
    // Démarre le stream SANS changer Restream
    try {
      await obsBridge.startStream(config.obs);
      await sleep(3000);
      const live = await obsBridge.getStreamStatus(config.obs);
      if (!live?.outputActive) {
        return {
          ok: false,
          preserved: true,
          reason: "OBS StartStream échoué — vérifie Restream / clé OBS",
        };
      }
      notify("OBS", "Start Stream OBS (destination Restream intacte)", "info");
      return { ok: true, preserved: true, via: "restream-leave", started: true };
    } catch (err) {
      return { ok: false, preserved: true, reason: err.message };
    }
  }

  // Mode nginx: OBS → 127.0.0.1:1935/live (stack Meta)
  const server = "rtmp://127.0.0.1:1935/live";
  const key = config.multistream?.streamKey || "obs";
  if (st?.outputActive) {
    notify(
      "OBS",
      forceRestart
        ? "Restart stream pour activer les push nginx FB/IG…"
        : "Stop pour repointer nginx:1935/live…",
      "info",
    );
    try {
      await obsBridge.stopStream(config.obs);
    } catch {
      /* ignore */
    }
    await sleep(2500);
  }
  await obsBridge.setCustomRtmp(config.obs, server, key, { force: true });
  await sleep(500);
  await obsBridge.startStream(config.obs);
  await sleep(4000);
  const live = await obsBridge.getStreamStatus(config.obs);
  if (!live?.outputActive) {
    return { ok: false, reason: "OBS n'est pas en stream après StartStream" };
  }
  notify("OBS", `Stream → ${server}/${key}`, "info");
  return { ok: true, server, key, restarted: true, via: "nginx" };
}

/**
 * @param {object} [options]
 */
async function armPushAndGoLive(options = {}) {
  const force = Boolean(options.force);
  const startObsStream = options.startObsStream !== false;
  const want = options.platforms || ["instagram", "facebook"];
  const timeoutMs = Number(options.timeoutMs) || 300000;
  const title = options.title || "Live AnimeBeat";
  const game = options.game || "";
  let config = loadConfig();

  if (!guardAllows(config, force)) {
    const msg =
      "Auto Go Live désactivé (garde-fou). Coche l’option dans Stream Command, ou lance avec force.";
    notify("Go Live", msg, "warn");
    return { ok: false, blocked: true, reason: msg };
  }

  const platforms = { ...config.platforms };
  if (want.includes("instagram")) {
    platforms.instagram = { ...(platforms.instagram || {}), enabled: true, autoGoLive: true };
  }
  if (want.includes("facebook")) {
    platforms.facebook = { ...(platforms.facebook || {}), enabled: true, autoGoLive: true };
  }
  config = { ...config, platforms };
  saveConfig(config);

  const results = {
    mode: "nginx-stunnel",
    prepared: {},
    nginx: null,
    obs: null,
    instagram: null,
    facebook: null,
  };

  const nginxListen = nginxRtmp.isNginxListening1935();
  if (!nginxListen.ok || !nginxListen.isNginx) {
    // Fallback: ancien multistream NMS (si nginx absent)
    results.mode = "multistream-nms";
    notify(
      "Go Live",
      "nginx absent sur 1935 — fallback multistream NMS (peut échouer si port pris)",
      "warn",
    );
  }

  // ——— 1) Live Producer ———
  if (want.includes("instagram")) {
    notify("Instagram", "Préparation Live Producer (nouvelle clé)…", "info");
    // Wipe ancienne clé avant scrape
    platforms.instagram = {
      ...platforms.instagram,
      streamKey: "",
      rtmpUrl: "",
    };
    config.platforms.instagram = platforms.instagram;
    saveConfig(config);
    const ig = await instagram.prepareAndGetCredentials(title, {
      instagramConfig: platforms.instagram,
      obsConfig: config.obs,
      aitumVertical: config.aitumVertical || {},
      linkUrl: platforms.instagram.linkUrl,
      linkTitle: platforms.instagram.linkTitle,
      autoGoLive: false,
    });
    results.prepared.instagram = ig;
    if (ig.ok && ig.streamKey) {
      config.platforms.instagram = {
        ...platforms.instagram,
        rtmpUrl: ig.rtmpUrl,
        streamKey: ig.streamKey,
        lastPreparedAt: ig.at,
        lastTitle: ig.title,
        linkUrl: ig.linkUrl || platforms.instagram.linkUrl,
        linkTitle: ig.linkTitle || platforms.instagram.linkTitle,
      };
      // Clé → OBS/Aitum + Start Streaming (toujours après scrape)
      results.aitumIg = ig.aitumPush || null;
      try {
        if (!results.aitumIg?.ok || results.aitumIg?.skipped) {
          results.aitumIg = await obsBridge.pushInstagramKeyToAitum(
            config.obs,
            { rtmpUrl: ig.rtmpUrl, streamKey: ig.streamKey },
            config.aitumVertical || {},
          );
        }
        if (results.aitumIg?.ok && !results.aitumIg?.skipped) {
          results.aitumStart = await obsBridge.startAitumStreaming(config.obs);
          results.aitumIg = {
            ...results.aitumIg,
            streamingStarted: Boolean(results.aitumStart?.ok),
          };
        }
      } catch (err) {
        results.aitumIg = { ok: false, reason: err.message };
      }
      config.platforms.instagram.lastAitumPushOk = Boolean(results.aitumIg?.ok);
      saveConfig(config);
    } else {
      notify("Instagram", ig.reason || "échec", "warn");
    }
  }

  if (want.includes("facebook")) {
    const fbCfg = config.platforms.facebook || {};
    const dest = fbCfg.destination || "page";
    notify(
      "Facebook",
      dest === "profile"
        ? "⚠ Préparation Live PROFIL PERSO…"
        : dest === "group"
          ? "Préparation Live GROUPE…"
          : "Préparation Live PAGE…",
      dest === "profile" ? "warn" : "info",
    );
    const fbDesc =
      String(fbCfg.lastDescription || "").trim() ||
      `${title}${game ? ` — ${game}` : ""}`;
    const fb = await facebook.prepareViaProducer(fbCfg, {
      title,
      game,
      description: fbDesc,
      linkUrl: fbCfg.linkUrl,
      linkTitle: fbCfg.linkTitle,
    });
    results.prepared.facebook = fb;
    if (fb.ok) {
      config.platforms.facebook = {
        ...fbCfg,
        rtmpUrl: fb.rtmpUrl,
        streamKey: fb.streamKey,
        lastPreparedAt: fb.at,
        lastTitle: fb.title,
        lastDescription: fbDesc,
        destination: fb.destination || dest,
        linkUrl: fb.linkUrl || fbCfg.linkUrl,
        linkTitle: fb.linkTitle || fbCfg.linkTitle,
      };
      saveConfig(config);
    } else {
      notify("Facebook", fb.reason || "échec", "warn");
    }
  }

  config = loadConfig();

  const igViaAitum = want.includes("instagram") && usesAitumForIg(config);

  // ——— 2) nginx → stunnel (FB / IG nginx seulement ; IG Aitum = pas de clé nginx) ———
  if (results.mode === "nginx-stunnel") {
    results.nginx = nginxRtmp.applyLiveKeys(config, {
      facebookKey: want.includes("facebook") ? config.platforms.facebook?.streamKey : "",
      instagramKey:
        want.includes("instagram") && !igViaAitum
          ? config.platforms.instagram?.streamKey
          : "",
    });
    if (!results.nginx.ok) {
      notify("nginx", results.nginx.reason || "échec update clés", "warn");
    }
  } else if (!igViaAitum) {
    // NMS fallback (pas pour IG-only Aitum)
    let ms = multistream.getStatus();
    if (!ms.running) {
      await multistream.start(config, {
        title,
        game,
        skipInstagramPrepare: true,
        skipFacebookPrepare: true,
      });
    }
    multistream.applyInstagramDestination(config);
  }

  // ——— 3) OBS stream — Restream préservé par défaut (pas de stop / nginx) ———
  const preserveObs = obsBridge.shouldPreserveObsDestination(config.obs);
  const needMainObsStream =
    startObsStream &&
    !preserveObs &&
    (want.includes("facebook") ||
      (want.includes("instagram") && !igViaAitum) ||
      (want.includes("instagram") &&
        igViaAitum &&
        !results.aitumIg?.streamingStarted &&
        !results.aitumStart?.ok));

  if (needMainObsStream) {
    results.obs = await ensureObsToNginx(config, {
      forceRestart: Boolean(results.nginx?.ok),
    });
    if (!results.obs.ok) {
      return { ok: false, step: "obs", ...results };
    }
  } else if (preserveObs) {
    results.obs = { ok: true, skipped: true, via: "restream-leave" };
  } else if (igViaAitum) {
    results.obs = { ok: true, skipped: true, via: "aitum-vertical-only" };
    results.mode = "aitum-vertical";
  }

  // Laisse nginx/stunnel digérer le RTMPS
  await sleep(igViaAitum || preserveObs ? 8000 : 15000);

  // ——— 4) Go Live dès preview ———
  if (want.includes("instagram") && results.prepared.instagram?.ok) {
    notify("Instagram", "Attente preview → Lancer un direct…", "info");
    results.instagram = await instagram.goLive({
      waitForReady: true,
      timeoutMs,
      probePreview: true,
    });
  }

  if (want.includes("facebook") && results.prepared.facebook?.ok) {
    notify("Facebook", "Attente preview → Lancer un direct…", "info");
    results.facebook = await facebook.goLive({
      waitForReady: true,
      timeoutMs,
      probePreview: true,
    });
  }

  const ok = Boolean(results.instagram?.ok || results.facebook?.ok);
  notify(
    "Go Live",
    ok
      ? `OK · IG=${results.instagram?.ok ? "live" : results.instagram?.reason || "—"} · FB=${results.facebook?.ok ? "live" : results.facebook?.reason || "—"}`
      : "Aucun Go Live — vérifie preview / stunnel / clés nginx",
    ok ? "info" : "warn",
  );

  return { ok, ...results, config: loadConfig() };
}

function isAutoGoLiveEnabled(config = loadConfig()) {
  return config.streamGuard?.autoGoLive === true;
}

/**
 * Suite après Préparer : nginx/stunnel + OBS + clic Go Live (sans re-préparer).
 * À appeler quand les clés sont déjà en config / fenêtres Producer ouvertes.
 */
async function continuePushAndGoLive(options = {}) {
  const force = options.force !== false;
  const startObsStream = options.startObsStream !== false;
  const want = options.platforms || ["instagram", "facebook"];
  const timeoutMs = Number(options.timeoutMs) || 300000;
  let config = loadConfig();

  if (!guardAllows(config, force)) {
    const msg =
      "Auto Go Live désactivé — coche le garde-fou, ou utilise Relancer (force).";
    notify("Go Live", msg, "warn");
    return { ok: false, blocked: true, reason: msg };
  }

  const results = {
    mode: "nginx-stunnel",
    nginx: null,
    obs: null,
    instagram: null,
    facebook: null,
    continued: true,
  };

  const nginxListen = nginxRtmp.isNginxListening1935();
  if (!nginxListen.ok || !nginxListen.isNginx) {
    results.mode = "multistream-nms";
    notify("Go Live", "nginx absent sur 1935 — fallback NMS", "warn");
  }

  const igViaAitum = want.includes("instagram") && usesAitumForIg(config);

  if (results.mode === "nginx-stunnel") {
    // Si IG part via Aitum, ne PAS injecter la clé IG dans nginx (sinon OBS classique republie vers IG)
    results.nginx = nginxRtmp.applyLiveKeys(config, {
      facebookKey: want.includes("facebook") ? config.platforms.facebook?.streamKey : "",
      instagramKey:
        want.includes("instagram") && !igViaAitum
          ? config.platforms.instagram?.streamKey
          : "",
    });
    if (!results.nginx.ok) {
      notify("nginx", results.nginx.reason || "échec update clés", "warn");
    } else if (want.includes("facebook") || !igViaAitum) {
      notify("nginx", "Clés push appliquées — republish OBS…", "info");
    }
  }

  // Clé IG → Aitum Vertical + Start Streaming (dock Vertical, pas Stream OBS)
  if (want.includes("instagram") && config.platforms?.instagram?.streamKey) {
    try {
      results.aitumIg = await obsBridge.pushInstagramKeyToAitum(
        config.obs,
        {
          rtmpUrl: config.platforms.instagram.rtmpUrl,
          streamKey: config.platforms.instagram.streamKey,
        },
        config.aitumVertical || {},
      );
      if (results.aitumIg?.ok && !results.aitumIg?.skipped) {
        results.aitumStart = await obsBridge.startAitumStreaming(config.obs);
        if (results.aitumStart?.ok) {
          notify(
            "Aitum",
            "IG = Streaming Vertical ON — ignore le bouton Stream OBS classique",
            "info",
          );
        }
      }
    } catch (err) {
      results.aitumIg = { ok: false, reason: err.message };
    }
  }

  // OBS Start Stream classique seulement si FB / nginx IG (jamais si Restream préservé)
  const preserveObs = obsBridge.shouldPreserveObsDestination(config.obs);
  const needMainObsStream =
    startObsStream &&
    !preserveObs &&
    (want.includes("facebook") ||
      (want.includes("instagram") && !igViaAitum) ||
      (want.includes("instagram") && igViaAitum && !results.aitumStart?.ok));

  if (needMainObsStream) {
    results.obs = await ensureObsToNginx(config, {
      forceRestart: Boolean(results.nginx?.ok),
    });
    if (!results.obs.ok) {
      return { ok: false, step: "obs", ...results };
    }
  } else if (preserveObs) {
    results.obs = { ok: true, skipped: true, via: "restream-leave" };
  } else if (igViaAitum) {
    results.obs = { ok: true, skipped: true, via: "aitum-vertical-only" };
    results.mode = "aitum-vertical";
  }

  notify(
    "Go Live",
    preserveObs
      ? "Attente preview (Restream OBS intact + Aitum IG)…"
      : igViaAitum && !needMainObsStream
        ? "Attente 12s (Aitum Vertical → preview IG)…"
        : "Attente 12s (flux OBS → preview)…",
    "info",
  );
  await sleep(preserveObs || igViaAitum ? 8000 : 12000);

  if (want.includes("instagram") && config.platforms?.instagram?.streamKey) {
    notify("Instagram", "Suite auto → Lancer un direct…", "info");
    results.instagram = await instagram.goLive({
      waitForReady: true,
      timeoutMs,
      probePreview: true,
    });
  }

  if (want.includes("facebook") && config.platforms?.facebook?.streamKey) {
    notify("Facebook", "Suite auto → Lancer un direct…", "info");
    results.facebook = await facebook.goLive({
      waitForReady: true,
      timeoutMs,
      probePreview: true,
      facebookConfig: config.platforms.facebook,
    });
  }

  const ok = Boolean(results.instagram?.ok || results.facebook?.ok);
  notify(
    "Go Live",
    ok
      ? `Suite OK · IG=${results.instagram?.ok ? "live" : results.instagram?.reason || "—"} · FB=${results.facebook?.ok ? "live" : results.facebook?.reason || "—"}`
      : "Suite bloquée — preview / OBS / bouton Lancer un direct ?",
    ok ? "info" : "warn",
  );

  return { ok, ...results, config: loadConfig() };
}

module.exports = {
  armPushAndGoLive,
  continuePushAndGoLive,
  guardAllows,
  isAutoGoLiveEnabled,
  usesAitumForIg,
};
