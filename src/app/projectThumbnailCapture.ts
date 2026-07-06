import { getOpenCanvasShell } from "./shellBridge";

const thumbnailAspectRatio = 16 / 9;
const thumbnailWidth = 800;
const thumbnailHeight = 450;

export async function captureProjectThumbnail() {
  const capture = getOpenCanvasShell()?.captureProjectThumbnail;
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
