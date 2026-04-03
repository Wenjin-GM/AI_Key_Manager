const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  getMeta: () => ipcRenderer.invoke("app:get-meta"),
  getState: () => ipcRenderer.invoke("app:get-state"),
  createConfig: (input) => ipcRenderer.invoke("app:create-config", input),
  saveConfig: (input) => ipcRenderer.invoke("app:save-config", input),
  deleteConfig: (configId) => ipcRenderer.invoke("app:delete-config", configId),
  moveConfig: (payload) => ipcRenderer.invoke("app:move-config", payload),
  pinConfig: (configId) => ipcRenderer.invoke("app:pin-config", configId),
  setCurrentModel: (payload) => ipcRenderer.invoke("app:set-current-model", payload),
  runTest: (configId) => ipcRenderer.invoke("app:run-test", configId),
  runProbe: (configId) => ipcRenderer.invoke("app:run-probe", configId),
  runBenchmark: (payload) => ipcRenderer.invoke("app:run-benchmark", payload),
});
