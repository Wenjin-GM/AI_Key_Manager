const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const {
  createConfig,
  deleteConfig,
  getState,
  moveConfig,
  pinConfig,
  runBenchmarkBatch,
  runProbeForConfig,
  runTestForConfig,
  saveConfig,
  setCurrentModel,
} = require("./services/state.cjs");

const isDev = !app.isPackaged;

function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#eef1eb",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    window.loadURL("http://127.0.0.1:5173");
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

function registerHandlers() {
  ipcMain.handle("app:get-meta", async () => ({
    version: app.getVersion(),
    userDataPath: app.getPath("userData"),
  }));
  ipcMain.handle("app:get-state", async () => getState(app));
  ipcMain.handle("app:create-config", async (_event, input) => createConfig(app, input));
  ipcMain.handle("app:save-config", async (_event, input) => saveConfig(app, input));
  ipcMain.handle("app:delete-config", async (_event, configId) => deleteConfig(app, configId));
  ipcMain.handle("app:move-config", async (_event, payload) => moveConfig(app, payload));
  ipcMain.handle("app:pin-config", async (_event, configId) => pinConfig(app, configId));
  ipcMain.handle("app:set-current-model", async (_event, payload) => setCurrentModel(app, payload));
  ipcMain.handle("app:run-test", async (_event, configId) => runTestForConfig(app, configId));
  ipcMain.handle("app:run-probe", async (_event, configId) => runProbeForConfig(app, configId));
  ipcMain.handle("app:run-benchmark", async (_event, payload) => runBenchmarkBatch(app, payload));
}

app.whenReady().then(() => {
  registerHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
