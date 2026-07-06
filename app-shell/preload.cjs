const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openCanvasShell", {
  onStage(callback) {
    ipcRenderer.on("shell:stage", (_event, payload) => callback(payload));
  },
  onSourceUpdateProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("shell:source-update-progress", listener);
    return () => ipcRenderer.removeListener("shell:source-update-progress", listener);
  },
  sourceUpdatePreview(request) {
    return ipcRenderer.invoke("shell:source-update-preview", request);
  },
  sourceUpdateApply(request) {
    return ipcRenderer.invoke("shell:source-update-apply", request);
  },
  captureProjectThumbnail(request) {
    return ipcRenderer.invoke("shell:capture-project-thumbnail", request);
  },
});
