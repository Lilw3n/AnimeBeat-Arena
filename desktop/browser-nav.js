/**
 * Navigation navigateur (retour / avant / actualiser) pour BrowserWindow & BrowserView.
 */
const { Menu } = require("electron");

/**
 * @param {import('electron').WebContents} webContents
 * @param {{ homeUrl?: string }} [options]
 */
function attachNavigation(webContents, options = {}) {
  if (!webContents || webContents.isDestroyed()) return;
  if (webContents.__abNavAttached) return;
  webContents.__abNavAttached = true;

  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || webContents.isDestroyed()) return;

    const key = input.key;
    const lower = String(key || "").toLowerCase();

    // F5 / Ctrl+R → actualiser
    if (key === "F5" || ((input.control || input.meta) && lower === "r" && !input.shift)) {
      event.preventDefault();
      webContents.reload();
      return;
    }
    // Ctrl+Shift+R → hard reload
    if ((input.control || input.meta) && input.shift && lower === "r") {
      event.preventDefault();
      webContents.reloadIgnoringCache();
      return;
    }
    // Alt+← → retour
    if (input.alt && (key === "ArrowLeft" || key === "Left")) {
      if (webContents.canGoBack()) {
        event.preventDefault();
        webContents.goBack();
      }
      return;
    }
    // Alt+→ → avant
    if (input.alt && (key === "ArrowRight" || key === "Right")) {
      if (webContents.canGoForward()) {
        event.preventDefault();
        webContents.goForward();
      }
      return;
    }
    // Alt+Home → page d'accueil (si fournie)
    if (input.alt && (key === "Home" || lower === "home") && options.homeUrl) {
      event.preventDefault();
      webContents.loadURL(options.homeUrl);
    }
  });

  webContents.on("context-menu", (_event, params) => {
    if (webContents.isDestroyed()) return;
    const template = [
      {
        label: "Retour",
        enabled: webContents.canGoBack(),
        click: () => webContents.goBack(),
      },
      {
        label: "Avancer",
        enabled: webContents.canGoForward(),
        click: () => webContents.goForward(),
      },
      { type: "separator" },
      {
        label: "Actualiser",
        click: () => webContents.reload(),
      },
      {
        label: "Actualiser (ignorer le cache)",
        click: () => webContents.reloadIgnoringCache(),
      },
    ];
    if (options.homeUrl) {
      template.push({ type: "separator" });
      template.push({
        label: "Page d'accueil",
        click: () => webContents.loadURL(options.homeUrl),
      });
    }
    if (params?.linkURL) {
      template.push({ type: "separator" });
      template.push({
        label: "Ouvrir le lien",
        click: () => webContents.loadURL(params.linkURL),
      });
    }
    Menu.buildFromTemplate(template).popup({
      window: require("electron").BrowserWindow.fromWebContents(webContents) || undefined,
    });
  });
}

/**
 * Barre de menu Navigation pour une BrowserWindow producteur.
 * @param {import('electron').BrowserWindow} win
 * @param {{ homeUrl?: string }} [options]
 */
function installWindowNavMenu(win, options = {}) {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  attachNavigation(wc, options);

  const menu = Menu.buildFromTemplate([
    {
      label: "Navigation",
      submenu: [
        {
          label: "Retour",
          accelerator: "Alt+Left",
          click: () => {
            if (wc.canGoBack()) wc.goBack();
          },
        },
        {
          label: "Avancer",
          accelerator: "Alt+Right",
          click: () => {
            if (wc.canGoForward()) wc.goForward();
          },
        },
        { type: "separator" },
        {
          label: "Actualiser",
          accelerator: "F5",
          click: () => wc.reload(),
        },
        {
          label: "Actualiser sans cache",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => wc.reloadIgnoringCache(),
        },
        ...(options.homeUrl
          ? [
              { type: "separator" },
              {
                label: "Accueil",
                accelerator: "Alt+Home",
                click: () => wc.loadURL(options.homeUrl),
              },
            ]
          : []),
      ],
    },
  ]);
  win.setMenu(menu);
  win.setAutoHideMenuBar(false);
  win.setMenuBarVisibility(true);
}

function goBack(webContents) {
  if (webContents && !webContents.isDestroyed() && webContents.canGoBack()) {
    webContents.goBack();
    return true;
  }
  return false;
}

function goForward(webContents) {
  if (webContents && !webContents.isDestroyed() && webContents.canGoForward()) {
    webContents.goForward();
    return true;
  }
  return false;
}

function reload(webContents, hard = false) {
  if (!webContents || webContents.isDestroyed()) return false;
  if (hard) webContents.reloadIgnoringCache();
  else webContents.reload();
  return true;
}

module.exports = {
  attachNavigation,
  installWindowNavMenu,
  goBack,
  goForward,
  reload,
};
