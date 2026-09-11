const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn, execFile } = require("child_process");
const path = require("path");
const http = require("http");
const { exec } = require("child_process");
const fs = require("fs/promises");

let mainWindow;
let backendProcess;
let backendReady = false;
let backendStartError = null;
const DEEP_LINK_PROTOCOL = "lema";
const LEGACY_DEEP_LINK_PROTOCOL = "nautilus";
const pendingDeepLinks = [];
const DEV_BACKEND_PORT = 8010;

function getOfflineStatePath() {
  return path.join(app.getPath("userData"), "offline", "offline-state.json");
}

function getLegacyUserDataRoots() {
  const appDataRoot = app.getPath("appData");
  return ["Nautilus", "nautilus-electron", "nautilus"]
    .map((name) => path.join(appDataRoot, name))
    .filter((candidate) => candidate !== app.getPath("userData"));
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function migrateLegacyUserData() {
  const destinationRoot = app.getPath("userData");
  const relativePaths = ["offline", "language-data", "language-models", "runtime"];

  for (const sourceRoot of getLegacyUserDataRoots()) {
    for (const relativePath of relativePaths) {
      const source = path.join(sourceRoot, relativePath);
      const destination = path.join(destinationRoot, relativePath);
      if (!(await pathExists(source)) || await pathExists(destination)) continue;
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.cp(source, destination, { recursive: true, errorOnExist: false });
    }
  }
}

async function readOfflineStateFile() {
  const filePath = getOfflineStatePath();

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      for (const legacyRoot of getLegacyUserDataRoots()) {
        try {
          const raw = await fs.readFile(path.join(legacyRoot, "offline", "offline-state.json"), "utf8");
          return JSON.parse(raw);
        } catch (legacyError) {
          if (legacyError?.code !== "ENOENT") throw legacyError;
        }
      }
      return null;
    }

    throw error;
  }
}

async function writeOfflineStateFile(value) {
  const filePath = getOfflineStatePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
  return true;
}

async function saveLibraryExport(value) {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export Lema library",
    defaultPath: path.join(app.getPath("documents"), `lema-library-${new Date().toISOString().slice(0, 10)}.lema`),
    filters: [{ name: "Lema Library", extensions: ["lema"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, JSON.stringify(value), "utf8");
  return { ok: true, path: result.filePath };
}

async function openLibraryImport() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import Lema library",
    properties: ["openFile"],
    filters: [{ name: "Lema Library", extensions: ["lema", "json"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const raw = await fs.readFile(result.filePaths[0], "utf8");
  return JSON.parse(raw);
}

function mergeSearchPath(existingPath, extraEntries) {
  const delimiter = process.platform === "win32" ? ";" : ":";
  const merged = [];

  for (const entry of [existingPath, ...extraEntries]) {
    if (!entry || merged.includes(entry)) continue;
    merged.push(entry);
  }

  return merged.join(delimiter);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

function extractDeepLink(argv = []) {
  return argv.find((value) =>
    typeof value === "string" &&
    (value.startsWith(`${DEEP_LINK_PROTOCOL}://`) || value.startsWith(`${LEGACY_DEEP_LINK_PROTOCOL}://`))
  ) ?? null;
}

function dispatchDeepLink(url) {
  if (!url) return;

  if (!mainWindow?.webContents) {
    pendingDeepLinks.push(url);
    return;
  }

  const send = () => {
    mainWindow?.webContents.send("deep-link-url", url);
  };

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once("did-finish-load", send);
    return;
  }

  send();
}

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function getMacNowPlaying() {
  if (process.platform !== "darwin") {
    return {
      source: "electron",
      is_playing: false,
      progress_ms: null,
      duration_ms: null,
      timestamp: null,
      track: null,
      device: { name: "Desktop", type: process.platform },
    };
  }

  const scripts = [
    {
      source: "Spotify",
      script: `
tell application "Spotify"
  if it is running then
    set track_name to name of current track
    set artist_name to artist of current track
    set album_name to album of current track
    set player_state to player state as text
    set duration_value to duration of current track
    set position_value to player position
    return "Spotify | " & track_name & " | " & artist_name & " | " & album_name & " | " & player_state & " | " & (duration_value as text) & " | " & (position_value as text)
  end if
end tell
return ""
`,
    },
    {
      source: "Music",
      script: `
tell application "Music"
  if it is running then
    set player_state to player state as text
    if player_state is "stopped" then return ""
    set track_name to name of current track
    set artist_name to artist of current track
    set album_name to album of current track
    set duration_value to duration of current track
    set position_value to player position
    return "Music | " & track_name & " | " & artist_name & " | " & album_name & " | " & player_state & " | " & (duration_value as text) & " | " & (position_value as text)
  end if
end tell
return ""
`,
    },
  ];

  try {
    let raw = "";

    for (const item of scripts) {
      try {
        raw = await execFileAsync("osascript", ["-e", item.script]);
        console.log(`[now-playing] raw osascript (${item.source}):`, JSON.stringify(raw));
        if (raw.trim()) {
          break;
        }
      } catch (error) {
        console.error(`[now-playing] osascript failed (${item.source}):`, error);
      }
    }

    if (!raw.trim()) {
      console.log("[now-playing] no active desktop player payload");
      return {
        source: "electron",
        is_playing: false,
        progress_ms: null,
        duration_ms: null,
        timestamp: null,
        track: null,
        device: { name: "Mac", type: "macOS" },
      };
    }

    const parts = raw.trim().split(" | ");
    console.log("[now-playing] parsed parts:", parts);
    if (parts.length < 7) {
      console.log("[now-playing] insufficient parts");
      return {
        source: "electron",
        is_playing: false,
        progress_ms: null,
        duration_ms: null,
        timestamp: null,
        track: null,
        device: { name: "Mac", type: "macOS" },
      };
    }

    const [source, name, artist, album, state, rawDuration, rawPosition] = parts;
    const durationNumber = Number(rawDuration);
    const positionNumber = Number(rawPosition);
    const durationMs = durationNumber > 0
      ? (durationNumber > 1000 ? Math.round(durationNumber) : Math.round(durationNumber * 1000))
      : null;
    const progressMs = positionNumber >= 0 ? Math.round(positionNumber * 1000) : null;

    return {
      source,
      is_playing: state === "playing",
      progress_ms: progressMs,
      duration_ms: durationMs,
      timestamp: Date.now(),
      track: {
        id: null,
        uri: null,
        name,
        artists: artist ? [artist] : [],
        album: album || null,
        image_url: null,
        external_url: null,
        isrc: null,
      },
      device: {
        name: "Mac",
        type: source,
      },
    };
  } catch (error) {
    console.error("[now-playing] unexpected now-playing failure:", error);
    return {
      source: "electron",
      is_playing: false,
      progress_ms: null,
      duration_ms: null,
      timestamp: null,
      track: null,
      device: { name: "Mac", type: "macOS" },
    };
  }
}

function killPort(port) {
  return new Promise((resolve) => {
    const cmd =
      process.platform === "win32"
        ? `netstat -ano | findstr :${port}`
        : `lsof -ti:${port}`;

    exec(cmd, (err, stdout) => {
      if (err || !stdout.trim()) return resolve(); // 이미 비어있음

      const pid = process.platform === "win32"
        ? stdout.trim().split(/\s+/).pop()
        : stdout.trim();

      const killCmd =
        process.platform === "win32"
          ? `taskkill /PID ${pid} /F`
          : `kill -9 ${pid}`;

      exec(killCmd, () => resolve());
    });
  });
}

// ─── FastAPI 서버 실행 ───────────────────────────────────────
async function startBackend() {
  await killPort(DEV_BACKEND_PORT);
  backendReady = false;
  backendStartError = null;

  // 개발: 시스템 python / 배포: 번들된 실행파일
  const isPackaged = app.isPackaged;

  let backendExecutable;
  let backendCwd = path.join(__dirname, "..", "backend");

  if (isPackaged) {
    backendExecutable = path.join(
      process.resourcesPath,
      "backend",
      process.platform === "win32" ? "main.exe" : "main"
    );
    backendCwd = path.join(process.resourcesPath, "backend");
  } else {
    // venv 안의 python으로 uvicorn 모듈을 직접 실행한다.
    // `venv/bin/uvicorn`은 경로 변경 후 shebang이 깨질 수 있다.
    backendExecutable = path.join(
      __dirname, "..", "backend", "venv", "bin", "python"
    );
  }

  const args = isPackaged
    ? []
    : ["-m", "uvicorn", "main:app", "--reload", "--port", String(DEV_BACKEND_PORT), "--host", "127.0.0.1"];

  const userDataRoot = app.getPath("userData");
  const runtimeRoot = path.join(userDataRoot, "runtime");
  const runtimePackageRoot = path.join(runtimeRoot, "site-packages");
  const dataStaticRoot = path.join(userDataRoot, "language-data", "static");
  const stanzaModelRoot = path.join(userDataRoot, "language-models", "stanza");
  const classlaModelRoot = path.join(userDataRoot, "language-models", "classla");
  const libraryRoot = path.join(userDataRoot, "library");
  const libraryDbPath = path.join(libraryRoot, "lema.sqlite");

  const env = {
    ...process.env,
    LEMA_BACKEND_ROOT: backendCwd,
    NAUTILUS_BACKEND_ROOT: backendCwd,
    ...(isPackaged
        ? {
          LEMA_RUNTIME_ROOT: runtimeRoot,
          LEMA_RUNTIME_PACKAGE_ROOT: runtimePackageRoot,
          LEMA_DATA_STATIC_ROOT: dataStaticRoot,
          LEMA_STANZA_MODEL_ROOT: stanzaModelRoot,
          LEMA_CLASSLA_MODEL_ROOT: classlaModelRoot,
          NAUTILUS_RUNTIME_ROOT: runtimeRoot,
          NAUTILUS_RUNTIME_PACKAGE_ROOT: runtimePackageRoot,
          NAUTILUS_DATA_STATIC_ROOT: dataStaticRoot,
          NAUTILUS_STANZA_MODEL_ROOT: stanzaModelRoot,
          NAUTILUS_CLASSLA_MODEL_ROOT: classlaModelRoot,
        }
      : {}),
    LEMA_FRONTEND_DIST: isPackaged
      ? path.join(backendCwd, "frontend")
      : path.join(__dirname, "..", "frontend", "dist"),
    NAUTILUS_FRONTEND_DIST: isPackaged
      ? path.join(backendCwd, "frontend")
      : path.join(__dirname, "..", "frontend", "dist"),
    LEMA_LIBRARY_DB_PATH: libraryDbPath,
    LEMA_LIBRARY_ROOT: libraryRoot,
  };

  if (isPackaged && process.platform === "darwin") {
    env.PATH = mergeSearchPath(process.env.PATH, [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/opt/local/bin",
      "/usr/bin",
      "/bin",
    ]);
  }

  backendProcess = spawn(backendExecutable, args, {
    cwd: backendCwd,
    env,
    stdio: "pipe",
  });

  backendProcess.once("error", (error) => {
    backendStartError = new Error(
      `백엔드 실행 실패: ${error.message || "알 수 없는 오류"}`
    );
  });

  backendProcess.stdout.on("data", (data) => {
    console.log(`[FastAPI] ${data}`);
  });

  backendProcess.stderr.on("data", (data) => {
    console.error(`[FastAPI ERR] ${data}`);
  });

  backendProcess.on("exit", (code, signal) => {
    console.log(`[FastAPI] exit code: ${code}, signal: ${signal}`);
    if (!backendReady && !backendStartError) {
      backendStartError = new Error(
        `백엔드가 준비되기 전에 종료되었습니다. (code: ${code ?? "null"}, signal: ${signal ?? "none"})`
      );
    }
  });
}

// ─── FastAPI 준비될 때까지 대기 ──────────────────────────────
function waitForBackend(url, retries = 120, delay = 500) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      if (backendStartError) {
        reject(backendStartError);
        return;
      }

      const request = http.get(url, (res) => {
        if (res.statusCode < 500) {
          backendReady = true;
          resolve();
          return;
        }

        if (n > 0) {
          setTimeout(() => check(n - 1), delay);
          return;
        }

        reject(new Error(`백엔드 응답 이상: HTTP ${res.statusCode}`));
      });

      request.setTimeout(2000, () => {
        request.destroy(new Error("백엔드 요청 시간 초과"));
      });

      request.on("error", () => {
        if (backendStartError) {
          reject(backendStartError);
        } else if (n > 0) {
          setTimeout(() => check(n - 1), delay);
        } else {
          reject(new Error("백엔드 연결 실패"));
        }
      });
    };

    check(retries);
  });
}

function waitForUrl(url, retries = 10, delay = 250) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      const request = http.get(url, (res) => {
        if (res.statusCode && res.statusCode < 500) {
          resolve();
          return;
        }

        if (n > 0) {
          setTimeout(() => check(n - 1), delay);
          return;
        }

        reject(new Error(`URL 응답 이상: HTTP ${res.statusCode}`));
      });

      request.setTimeout(1000, () => {
        request.destroy(new Error("URL 요청 시간 초과"));
      });

      request.on("error", () => {
        if (n > 0) {
          setTimeout(() => check(n - 1), delay);
        } else {
          reject(new Error("URL 연결 실패"));
        }
      });
    };

    check(retries);
  });
}

async function ensureBackendReady() {
  const backendUrl = `http://localhost:${DEV_BACKEND_PORT}/`;

  try {
    await waitForUrl(backendUrl, 1, 100);
    backendReady = true;
    return true;
  } catch {
    // Ignore and attempt a fresh backend start below.
  }

  await startBackend();

  try {
    await waitForBackend(backendUrl);
    return true;
  } catch (e) {
    dialog.showErrorBox(
      "Backend 오류",
      `FastAPI 서버를 시작할 수 없습니다.\n${e.message || "백엔드 로그를 확인하세요."}`
    );
    app.quit();
    return false;
  }
}

// ─── BrowserWindow 생성 ──────────────────────────────────────
async function createWindow() {
  const isDev = !app.isPackaged;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    vibrancy: 'fullscreen-ui',
    backgroundMaterial: 'acrylic',
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 개발: Vite dev server / 배포: FastAPI가 서빙하는 dist
  let startUrl = `http://localhost:${DEV_BACKEND_PORT}`;

  if (isDev) {
    try {
      await waitForUrl("http://localhost:5173");
      startUrl = "http://localhost:5173";
    } catch {
      startUrl = `http://localhost:${DEV_BACKEND_PORT}`;
    }
  }

  mainWindow.loadURL(startUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);

    return { action: "deny" };
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on("did-finish-load", () => {
    while (pendingDeepLinks.length > 0) {
      const url = pendingDeepLinks.shift();
      if (url) {
        mainWindow?.webContents.send("deep-link-url", url);
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── 앱 라이프사이클 ─────────────────────────────────────────
app.on("open-url", (event, url) => {
  event.preventDefault();
  dispatchDeepLink(url);
});

app.on("second-instance", (_event, argv) => {
  const url = extractDeepLink(argv);

  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }

  dispatchDeepLink(url);
});

app.whenReady().then(async () => {
  const isDev = !app.isPackaged;
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(
      DEEP_LINK_PROTOCOL,
      process.execPath,
      [path.resolve(process.argv[1])]
    );
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
  }

  await migrateLegacyUserData();

  if (!(await ensureBackendReady())) {
    return;
  }

  await createWindow();

  ipcMain.handle("now-playing:get", async () => getMacNowPlaying());
  ipcMain.handle("app:relaunch", async () => {
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle("offline-state:read", async () => readOfflineStateFile());
  ipcMain.handle("offline-state:write", async (_event, value) => writeOfflineStateFile(value));
  ipcMain.handle("library:export", async (_event, value) => saveLibraryExport(value));
  ipcMain.handle("library:import", async () => openLibraryImport());

  dispatchDeepLink(extractDeepLink(process.argv));

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!(await ensureBackendReady())) {
        return;
      }
      await createWindow();
    }
  });
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock.setIcon(path.join(__dirname, "resources", "icon.png"));
  }
});

app.on("window-all-closed", () => {
  // FastAPI 프로세스 종료
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
    backendReady = false;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
    backendReady = false;
  }
});
