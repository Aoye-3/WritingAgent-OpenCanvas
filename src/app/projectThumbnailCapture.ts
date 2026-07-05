type ShellProjectThumbnailRequest = {
  x: number;
  y: number;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
};

type ShellProjectThumbnailResult = {
  imageBase64: string;
  mimeType: string;
};

type OpenCanvasShellBridge = {
  captureProjectThumbnail?: (request: ShellProjectThumbnailRequest) => Promise<ShellProjectThumbnailResult | undefined>;
};

declare global {
  interface Window {
    openCanvasShell?: OpenCanvasShellBridge;
  }
}

const thumbnailAspectRatio = 16 / 9;
const thumbnailWidth = 800;
const thumbnailHeight = 450;

export async function captureProjectThumbnail() {
  if (typeof window === "undefined") return undefined;
  const capture = window.openCanvasShell?.captureProjectThumbnail;
  if (!capture) return undefined;
  const target = document.querySelector<HTMLElement>("[data-project-thumbnail-target='true']");
  if (!target) return undefined;
  const rect = target.getBoundingClientRect();
  if (rect.width < 80 || rect.height < 80) return undefined;
  const cropped = cropRectToAspectRatio(rect, thumbnailAspectRatio);
  return capture({
    x: Math.round(cropped.x),
    y: Math.round(cropped.y),
    width: Math.round(cropped.width),
    height: Math.round(cropped.height),
    outputWidth: thumbnailWidth,
    outputHeight: thumbnailHeight
  });
}

function cropRectToAspectRatio(rect: DOMRect, ratio: number) {
  const currentRatio = rect.width / rect.height;
  if (currentRatio > ratio) {
    const width = rect.height * ratio;
    return {
      x: rect.left + (rect.width - width) / 2,
      y: rect.top,
      width,
      height: rect.height
    };
  }
  const height = rect.width / ratio;
  return {
    x: rect.left,
    y: rect.top + (rect.height - height) / 2,
    width: rect.width,
    height
  };
}
