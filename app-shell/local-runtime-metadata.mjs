export function parseLocalRuntimeMetadata(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}
