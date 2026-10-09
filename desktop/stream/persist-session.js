/**
 * Stabilise les sessions web Instagram / Facebook (cookies persistants).
 * Évite les déconnexions dues à un UA Electron + cache non flushé + multi-instances.
 */
const { session, app } = require("electron");

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const hardened = new WeakSet();
const flushTimers = new WeakMap();

function applyChromeUaFallback() {
  try {
    if (app?.userAgentFallback !== undefined) {
      app.userAgentFallback = CHROME_UA;
    }
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} partition  ex: persist:instagram-live
 */
function getHardenedSession(partition) {
  applyChromeUaFallback();
  const ses = session.fromPartition(partition, { cache: true });
  if (hardened.has(ses)) return ses;
  hardened.add(ses);

  try {
    ses.setUserAgent(CHROME_UA);
  } catch {
    /* ignore */
  }

  // Ne jamais purger cookies / storage Meta (cause #1 des décos « systématiques »)
  try {
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      if (!headers["Accept-Language"] && !headers["accept-language"]) {
        headers["Accept-Language"] = "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7";
      }
      callback({ requestHeaders: headers });
    });
  } catch {
    /* ignore */
  }

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allow = ["media", "camera", "microphone", "display-capture", "mediaKeySystem"].includes(
      permission,
    );
    callback(allow);
  });
  try {
    ses.setPermissionCheckHandler((_wc, permission) =>
      ["media", "camera", "microphone", "display-capture"].includes(permission),
    );
  } catch {
    /* ignore */
  }

  return ses;
}

async function flushSession(ses) {
  if (!ses) return;
  try {
    await ses.cookies.flushStore();
  } catch {
    /* ignore */
  }
}

/** Flush cookies debounced (évite races pendant navigation FB). */
function scheduleFlushSession(ses, delayMs = 1500) {
  if (!ses) return;
  const prev = flushTimers.get(ses);
  if (prev) clearTimeout(prev);
  flushTimers.set(
    ses,
    setTimeout(() => {
      flushSession(ses).catch(() => {});
      flushTimers.delete(ses);
    }, delayMs),
  );
}

async function hasInstagramCookies(ses) {
  try {
    const cookies = await ses.cookies.get({ domain: ".instagram.com" });
    return cookies.some((c) => c.name === "sessionid" && c.value);
  } catch {
    return false;
  }
}

async function hasFacebookCookies(ses) {
  try {
    const domains = [".facebook.com", "www.facebook.com", ".facebook.fr"];
    for (const domain of domains) {
      try {
        const cookies = await ses.cookies.get({ domain });
        if (cookies.some((c) => (c.name === "c_user" || c.name === "xs") && c.value)) {
          return true;
        }
      } catch {
        /* next */
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Anti-détection (réduit logout Meta dans Electron). */
async function patchPageAutomationFlags(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    await webContents.executeJavaScript(
      `(function () {
        try {
          Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        } catch (e) {}
        try {
          if (!window.chrome) window.chrome = { runtime: {} };
        } catch (e) {}
        try {
          Object.defineProperty(navigator, "languages", { get: () => ["fr-FR", "fr", "en-US", "en"] });
        } catch (e) {}
        try {
          Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
        } catch (e) {}
      })();`,
      true,
    );
  } catch {
    /* ignore */
  }
}

module.exports = {
  CHROME_UA,
  applyChromeUaFallback,
  getHardenedSession,
  flushSession,
  scheduleFlushSession,
  hasInstagramCookies,
  hasFacebookCookies,
  patchPageAutomationFlags,
};
