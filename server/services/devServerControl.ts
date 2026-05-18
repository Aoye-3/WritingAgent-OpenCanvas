import { spawn } from "node:child_process";

export function scheduleDevServerShutdown() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development server shutdown is not available in production.");
  }

  setTimeout(() => {
    shutdownLocalDevProcesses();
  }, 250).unref();
}

function shutdownLocalDevProcesses() {
  if (process.platform === "win32") {
    shutdownWindowsProjectProcesses();
    return;
  }

  process.exit(0);
}

function shutdownWindowsProjectProcesses() {
  const command = [
    "$root = (Resolve-Path '.').Path",
    "$selfId = $PID",
    "$processes = Get-CimInstance Win32_Process",
    "$targets = $processes | Where-Object { $_.ProcessId -ne $selfId -and $_.CommandLine -like \"*$root*\" -and $_.CommandLine -match \"(vite|tsx|npm)\" }",
    "$targets | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
  ].join("; ");

  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });

  child.unref();
}
