function pushToWindows(payload) {
  try {
    const { BrowserWindow } = require("electron");
    if (!BrowserWindow?.getAllWindows) return;
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("stream:event", payload);
    }
  } catch {
    /* hors Electron */
  }
}

function notify(title, body, level = "info") {
  pushToWindows({ type: "toast", level, title, body, at: Date.now() });
  try {
    const { Notification } = require("electron");
    if (Notification?.isSupported?.()) {
      const n = new Notification({ title, body, silent: level === "info" });
      n.show();
    }
  } catch {
    /* hors Electron */
  }
}

function notifyGameNotFound(query) {
  notify(
    "Jeu introuvable",
    `Aucun jeu trouvé pour « ${query} ». Vérifie l’orthographe ou choisis une suggestion.`,
    "warn",
  );
}

module.exports = { notify, notifyGameNotFound, pushToWindows };
