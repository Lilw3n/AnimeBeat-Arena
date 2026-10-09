const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("liveHub", {
  getAppInfo: () => ipcRenderer.invoke("hub:get-app-info"),
  getCatalog: () => ipcRenderer.invoke("hub:get-catalog"),
  getLiveLinks: () => ipcRenderer.invoke("hub:get-live-links"),
  copyText: (text) => ipcRenderer.invoke("hub:copy-text", text),
  setScreenCount: (count) => ipcRenderer.send("set-screen-count", count),
  setSlotSource: (slotIndex, sourceId) => ipcRenderer.send("set-slot-source", { slotIndex, sourceId }),
  setSlotMode: (slotIndex, mode) => ipcRenderer.send("set-slot-mode", { slotIndex, mode }),
  setSourcePower: (sourceId, powered) => ipcRenderer.send("toggle-source-power", { sourceId, powered }),
  setChatVisible: (visible) => ipcRenderer.send("set-chat-visible", visible),
  setChatMode: (mode) => ipcRenderer.send("set-chat-mode", mode),
  toggleFullScreen: () => ipcRenderer.send("toggle-fullscreen"),
  openCommandCenter: () => ipcRenderer.send("open-command-center"),
  setToolbarHeight: (height) => ipcRenderer.send("set-toolbar-height", height),
  openSourceLink: (sourceId) => ipcRenderer.invoke("hub:open-source-link", sourceId),
  openSourceLinks: (payload) => ipcRenderer.invoke("hub:open-source-links", payload),
  openUrl: (url) => ipcRenderer.invoke("hub:open-url", url),
  nav: (action, slotIndex) => ipcRenderer.invoke("hub:nav", { action, slotIndex }),
});

