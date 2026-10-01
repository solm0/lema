const { contextBridge, ipcRenderer } = require("electron");

// 필요하다면 여기서 안전하게 Node API를 renderer에 노출
contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  getNowPlaying: () => ipcRenderer.invoke("now-playing:get"),
  relaunchApp: () => ipcRenderer.invoke("app:relaunch"),
  readOfflineState: () => ipcRenderer.invoke("offline-state:read"),
  writeOfflineState: (value) => ipcRenderer.invoke("offline-state:write", value),
  saveLibraryExport: (value) => ipcRenderer.invoke("library:export", value),
  openLibraryImport: () => ipcRenderer.invoke("library:import"),
  setActiveLibraryUser: (userId) => ipcRenderer.invoke("library:set-active-user", userId),
  onDeepLink: (callback) => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on("deep-link-url", listener);

    return () => {
      ipcRenderer.removeListener("deep-link-url", listener);
    };
  },
});
