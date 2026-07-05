const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openCanvasShell", {
  onStage(callback) {
    ipcRenderer.on("shell:stage", (_event, payload) => callback(payload));
  },
  captureProjectThumbnail(request) {
    return ipcRenderer.invoke("shell:capture-project-thumbnail", request);
  },
});
