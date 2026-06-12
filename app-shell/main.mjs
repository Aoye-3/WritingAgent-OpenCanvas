import { app, BrowserWindow } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLifecycle } from "./runtime.mjs";
import { resolveRuntimeMode } from "./runtime-config.mjs";
import { parseRunningServices, run, runDetachedCommand, startProcess, waitForHttp } from "./platform.mjs";
import { sendWindowStage } from "./window-status.mjs";

const shellDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(shellDir, "..");
const frontendPort = 17776;
const apiPort = 17777;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const runtime = resolveRuntimeMode(process.env);
const runtimePort = Number(new URL(runtime.baseUrl).port || 80);
const localBridgeUrl = `http://127.0.0.1:${apiPort}`;
const dockerBridgeUrl = `http://host.docker.internal:${apiPort}`;
const bridgeUrl = runtime.mode === "docker" ? dockerBridgeUrl : localBridgeUrl;
const iconPath = path.join(root, "public", "assets", "ui", "brand", "opencanvas-icon.png");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const viteCli = path.join(root, "node_modules", "vite", "bin", "vite.js");
const logsRoot = path.join(root, "logs");
const shellLogPath = path.join(logsRoot, "app-shell.log");
mkdirSync(logsRoot, { recursive: true });
const shellEnv = {
  ...process.env,
  PORT: String(apiPort),
  VITE_PORT: String(frontendPort),
  FACETWRITE_INTERNAL_BASE_URL: bridgeUrl,
  AGENT_RUNTIME_MODE: runtime.mode,
  AGENT_BACKEND_BASE_URL: runtime.baseUrl,
};

let splashWindow;
let mainWindow;
let lifecycle;
let shuttingDown = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = mainWindow ?? splashWindow;
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.whenReady().then(startShell).catch(showStartupError);
  app.on("before-quit", (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    void shutdown();
  });
}

async function startShell() {
  splashWindow = createSplashWindow();
  await Promise.all([assertPortAvailable(frontendPort), assertPortAvailable(apiPort)]);

  lifecycle = createLifecycle({
    inspectRuntime,
    startRuntime,
    stopRuntime,
    startApi: () => startProcess("node.exe", [tsxCli, "server/index.ts"], {
      cwd: root,
      env: shellEnv,
      stdoutPath: path.join(logsRoot, "api.out.log"),
      stderrPath: path.join(logsRoot, "api.err.log"),
    }),
    startFrontend: () => startProcess("node.exe", [viteCli, "--host", "127.0.0.1", "--port", String(frontendPort)], {
      cwd: root,
      env: shellEnv,
      stdoutPath: path.join(logsRoot, "frontend.out.log"),
      stderrPath: path.join(logsRoot, "frontend.err.log"),
    }),
    waitForRuntime: () => waitForHttp(`${runtime.baseUrl}/health`, { attempts: 90 }),
    waitForApi: () => waitForHttp(`${apiUrl}/api/health`, { attempts: 90 }),
    waitForFrontend: () => waitForHttp(frontendUrl, { attempts: 90 }),
    onStage: updateStage,
  });

  await lifecycle.start();
  mainWindow = createMainWindow();
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    splashWindow?.close();
    splashWindow = undefined;
    const smokeExitMs = Number(process.env.OPENCANVAS_SHELL_SMOKE_EXIT_MS ?? 0);
    if (smokeExitMs > 0) setTimeout(() => void shutdown(), smokeExitMs);
  });
  await mainWindow.loadURL(frontendUrl);
}

function createSplashWindow() {
  const window = new BrowserWindow({
    width: 520,
    height: 360,
    resizable: false,
    frame: false,
    show: true,
    transparent: false,
    backgroundColor: "#f5f7fb",
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(shellDir, "preload.cjs"),
    },
  });
  window.loadFile(path.join(shellDir, "splash.html"));
  window.on("closed", () => {
    if (splashWindow === window) splashWindow = undefined;
    if (!mainWindow && !shuttingDown) void shutdown();
  });
  return window;
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: "#f6f7f9",
    icon: iconPath,
    title: "OpenCanvas",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.on("close", (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    void shutdown();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  return window;
}

async function inspectRuntime() {
  if (runtime.mode === "local") return inspectLocalRuntime();
  if (runtime.mode === "external") {
    await waitForHttp(`${runtime.baseUrl}/health`, { attempts: 1, delayMs: 0 });
    return ["facetwrite-agent-runtime-nginx", "facetwrite-agent-runtime-frontend", "facetwrite-agent-runtime-gateway"];
  }
  await ensureDockerReady();
  const { stdout } = await run("docker.exe", [
    "ps",
    "--filter",
    "label=com.docker.compose.project=facetwrite-agent-runtime",
    "--format",
    "{{.Names}}",
  ], { cwd: root, timeout: 20_000 });
  const services = parseRunningServices(stdout);
  if (services.length === 3 && !(await existingRuntimeTargetsBridge())) {
    await stopRuntime();
    return [];
  }
  return services;
}

async function inspectLocalRuntime() {
  const healthy = await waitForHttp(`${runtime.baseUrl}/health`, { attempts: 1, delayMs: 0 }).then(() => true, () => false);
  if (!healthy) return [];
  const metadataPath = path.join(root, "modules", "agent-runtime", "logs", "agent-runtime-local.json");
  if (!existsSync(metadataPath)) throw new Error("A local Agent Runtime is running but is not owned by this project. Use external mode or stop it.");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (metadata.projectRoot !== root || metadata.bridgeBaseUrl !== bridgeUrl) {
    throw new Error("The running local Agent Runtime uses incompatible project or bridge settings.");
  }
  return ["facetwrite-agent-runtime-nginx", "facetwrite-agent-runtime-frontend", "facetwrite-agent-runtime-gateway"];
}

async function ensureDockerReady() {
  if (await isDockerReady()) return;
  throw new Error("Docker mode requires a reachable Docker daemon. Start Docker Desktop or select AGENT_RUNTIME_MODE=local.");
}

async function isDockerReady() {
  return run("docker.exe", ["info"], { cwd: root, timeout: 10_000 }).then(() => true, () => false);
}

async function existingRuntimeTargetsBridge() {
  const { stdout } = await run("docker.exe", [
    "inspect",
    "facetwrite-agent-runtime-gateway",
    "--format",
    "{{range .Config.Env}}{{println .}}{{end}}",
  ], { cwd: root, timeout: 20_000 });
  return stdout.split(/\r?\n/).includes(`FACETWRITE_INTERNAL_BASE_URL=${bridgeUrl}`);
}

async function startRuntime() {
  const script = runtime.mode === "local" ? "scripts/agent-runtime-local.ps1" : "scripts/agent-runtime.ps1";
  const extraArgs = runtime.mode === "local" ? ["-Port", String(runtimePort), "-BridgeBaseUrl", bridgeUrl] : [];
  const command = runtime.mode === "local" ? runDetachedCommand : run;
  await command("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "up",
    ...extraArgs,
  ], { cwd: root, env: shellEnv, timeout: 300_000 });
}

async function stopRuntime() {
  if (!runtime.managed) return;
  const script = runtime.mode === "local" ? "scripts/agent-runtime-local.ps1" : "scripts/agent-runtime.ps1";
  const extraArgs = runtime.mode === "local" ? ["-Port", String(runtimePort), "-BridgeBaseUrl", bridgeUrl] : [];
  await run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "down",
    ...extraArgs,
  ], { cwd: root, env: shellEnv, timeout: 120_000 });
}

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      const detail = error.code === "EACCES"
        ? "is unavailable or reserved by Windows"
        : "is already in use";
      reject(new Error(`Port ${port} ${detail}. Resolve the conflict and try again.`));
    });
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

function updateStage(stage) {
  writeShellLog(`stage=${stage}`);
  sendWindowStage(splashWindow, stage);
}

function showStartupError(error) {
  const message = error instanceof Error ? error.message : String(error);
  writeShellLog(`startup-error=${error instanceof Error ? error.stack ?? message : message}`);
  console.error("OpenCanvas app shell startup failed:", error);
  sendWindowStage(splashWindow, "error", message);
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  updateStage("stopping");
  try {
    await lifecycle?.stop();
  } catch (error) {
    writeShellLog(`cleanup-error=${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    console.error("OpenCanvas app shell cleanup failed:", error);
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
    app.quit();
  }
}

function writeShellLog(message) {
  appendFileSync(shellLogPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}
