export function parseLocalRuntimeMetadata(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

export function isLocalRuntimeStale(metadata, sourceFingerprint) {
  return !metadata?.sourceFingerprint || metadata.sourceFingerprint !== sourceFingerprint;
}
