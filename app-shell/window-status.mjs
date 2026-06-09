export function sendWindowStage(window, stage, message) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
  window.webContents.send("shell:stage", { stage, message });
  return true;
}
