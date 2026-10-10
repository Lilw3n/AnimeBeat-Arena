/**
 * Routage des flux H / V — couche UI au-dessus des réglages déjà en place.
 *
 * Horizontal (défaut Restream):
 *   restream → OBS destination inchangée (Twitch/Kick/…) — streamDestinationMode=leave
 *   nginx    → OBS → 127.0.0.1:1935/live → nginx.conf
 *              → stunnel = UNIQUEMENT Meta : FB :19350 + IG :19351 (pas Twitch/Kick)
 *
 * Vertical Instagram (défaut Aitum):
 *   aitum → Aitum Vertical Streaming → RTMPS IG direct (igVia=aitum)
 *   nginx → OBS/nginx → stunnel IG :19351 → Instagram
 *
 * Ne remplace pas go-live / Aitum / nginx : mappe seulement les knobs existants.
 */

function horizontalEngine(config = {}) {
  return (config.obs?.streamDestinationMode || "leave") === "nginx"
    ? "nginx"
    : "restream";
}

function verticalEngine(config = {}) {
  const a = config.aitumVertical || {};
  if (a.enabled === false || a.pushIgCredentials === false) return "nginx";
  if (a.igVia === "nginx") return "nginx";
  if (
    String(a.serverMode || "producer").toLowerCase() === "stunnel" &&
    a.igVia !== "aitum"
  ) {
    return "nginx";
  }
  return "aitum";
}

function getRoutes(config = {}) {
  const h = horizontalEngine(config);
  const v = verticalEngine(config);
  const a = config.aitumVertical || {};
  return {
    horizontal: {
      engine: h,
      label:
        h === "nginx"
          ? "nginx local (OBS → :1935 → push nginx.conf)"
          : "OBS Restream (recommandé — destination OBS intacte)",
      destinations:
        h === "nginx"
          ? [
              "Facebook → stunnel:19350 (Meta)",
              "Instagram → stunnel:19351 si vertical=nginx (Meta)",
              "Twitch/Kick seulement si push nginx dédiés (sinon Restream)",
            ]
          : ["Twitch / Kick / YT via Restream OBS", "FB/IG Meta ≠ stunnel ici (sauf Restream Meta)"],
    },
    vertical: {
      engine: v,
      label:
        v === "aitum"
          ? "Aitum Vertical → Instagram (recommandé, sans stunnel)"
          : "nginx → stunnel IG :19351 (Meta Instagram)",
      destinations: ["Instagram Live (Meta)"],
      width: Number(a.width) || 1080,
      height: Number(a.height) || 1920,
      aitumIndex: Number(a.instagramOutputIndex ?? 0),
      serverMode: a.serverMode || "producer",
    },
    diagram:
      h === "restream" && v === "aitum"
        ? "OBS (H) → Restream (Twitch/Kick…) ·||· Aitum (V) → Instagram · stunnel = FB/IG Meta seulement"
        : h === "nginx" && v === "aitum"
          ? "OBS (H) → nginx → stunnel FB:19350 ·||· Aitum (V) → Instagram"
          : h === "restream" && v === "nginx"
            ? "OBS (H) → Restream ·||· nginx → stunnel IG:19351 → Instagram"
            : "OBS → nginx:1935 → stunnel Meta (FB:19350 + IG:19351)",
    defaults: {
      horizontal: "restream",
      vertical: "aitum",
      note: "stunnel = Facebook + Instagram (Meta RTMPS). Twitch/Kick = Restream, pas stunnel.",
    },
  };
}

/**
 * Applique le choix H/V sur la config existante (obs + aitumVertical).
 * @returns {{ config, routes, changed: string[] }}
 */
function applyRoutes(config, { horizontal, vertical } = {}) {
  const next = structuredClone(config || {});
  next.obs = { ...(next.obs || {}) };
  next.aitumVertical = { ...(next.aitumVertical || {}) };
  const changed = [];

  if (horizontal === "nginx" || horizontal === "restream") {
    const mode = horizontal === "nginx" ? "nginx" : "leave";
    if ((next.obs.streamDestinationMode || "leave") !== mode) {
      next.obs.streamDestinationMode = mode;
      changed.push(`horizontal→${horizontal}`);
    }
  }

  if (vertical === "aitum" || vertical === "nginx") {
    if (vertical === "aitum") {
      if (next.aitumVertical.igVia !== "aitum") {
        next.aitumVertical.igVia = "aitum";
        changed.push("vertical→aitum");
      }
      if ((next.aitumVertical.serverMode || "producer") === "stunnel") {
        next.aitumVertical.serverMode = "producer";
        changed.push("aitum serverMode→producer");
      }
      next.aitumVertical.pushIgCredentials = true;
      next.aitumVertical.autoStartStreaming =
        next.aitumVertical.autoStartStreaming !== false;
    } else {
      if (next.aitumVertical.igVia !== "nginx") {
        next.aitumVertical.igVia = "nginx";
        changed.push("vertical→nginx");
      }
      // nginx IG = push stunnel ; Aitum peut rester éteint pour IG
      next.aitumVertical.serverMode = "stunnel";
    }
  }

  // Miroir optionnel pour lecture future
  next.streamRoutes = {
    horizontal: horizontalEngine(next),
    vertical: verticalEngine(next),
    note: "Dérivé de obs.streamDestinationMode + aitumVertical.igVia — source de vérité = ces champs.",
  };

  return { config: next, routes: getRoutes(next), changed };
}

function syncStreamRoutesMirror(config) {
  const routes = getRoutes(config);
  return {
    ...config,
    streamRoutes: {
      horizontal: routes.horizontal.engine,
      vertical: routes.vertical.engine,
      note: "Dérivé de obs.streamDestinationMode + aitumVertical.igVia",
    },
  };
}

module.exports = {
  getRoutes,
  applyRoutes,
  horizontalEngine,
  verticalEngine,
  syncStreamRoutesMirror,
};
