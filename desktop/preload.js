const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("liveHub", {
  getCatalog: () => ipcRenderer.invoke("hub:get-catalog"),
  setScreenCount: (count) => ipcRenderer.send("set-screen-count", count),
  setSlotSource: (slotIndex, sourceId) => ipcRenderer.send("set-slot-source", { slotIndex, sourceId }),
  setSlotMode: (slotIndex, mode) => ipcRenderer.send("set-slot-mode", { slotIndex, mode }),
  setSourcePower: (sourceId, powered) => ipcRenderer.send("toggle-source-power", { sourceId, powered }),
  setChatVisible: (visible) => ipcRenderer.send("set-chat-visible", visible),
  setChatMode: (mode) => ipcRenderer.send("set-chat-mode", mode),
  toggleFullScreen: () => ipcRenderer.send("toggle-fullscreen"),
  openCommandCenter: () => ipcRenderer.send("open-command-center"),
  setToolbarHeight: (height) => ipcRenderer.send("set-toolbar-height", height),
});

