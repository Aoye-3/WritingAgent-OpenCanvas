import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function parseRunningServices(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    timeout: options.timeout ?? 120_000,
  });
}

export async function runDetachedCommand(command, args, options = {}) {
  const spawnImpl = options.spawnImpl ?? spawn;
  await new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: "ignore",
    });
    const timeout = options.timeout
      ? setTimeout(() => {
        child.kill?.();
        reject(new Error(`${command} timed out.`));
      }, options.timeout)
      : undefined;
    child.once("error", reject);
    child.once("close", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

export function buildSpawnCommand(command, args, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return {
      command: options.comspec ?? process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }
  return { command, args };
}

export function startProcess(command, args, options = {}) {
  const spawnCommand = buildSpawnCommand(command, args);
  const stdout = options.stdoutPath ? openSync(options.stdoutPath, "a") : "ignore";
  const stderr = options.stderrPath ? openSync(options.stderrPath, "a") : "ignore";
  let child;
  try {
    child = spawn(spawnCommand.command, spawnCommand.args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["ignore", stdout, stderr],
    });
  } finally {
    if (typeof stdout === "number") closeSync(stdout);
    if (typeof stderr === "number") closeSync(stderr);
  }
  child.on("error", () => undefined);
  return {
    pid: child.pid,
    async stop() {
      if (!child.pid || child.exitCode !== null) return;
      if (process.platform === "win32") {
        await run("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { timeout: 20_000 }).catch(() => undefined);
        return;
      }
      child.kill("SIGTERM");
    },
  };
}

export async function waitForHttp(url, options = {}) {
  const attempts = options.attempts ?? 60;
  const delayMs = options.delayMs ?? 1_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) return;
    } catch {
      // The service is still starting.
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`${url} did not become ready.`);
}
