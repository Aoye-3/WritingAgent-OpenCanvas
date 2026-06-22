const internalRuntimeProtocolPatterns = [
  /<\s*(?:[\/|]\s*){0,4}DSML\s*(?:[\/|]\s*){0,4}/i,
  /\bDSML\b[\s\S]{0,120}\btool[_-]?calls?\b/i,
  /\btool[_-]?calls?\b[\s\S]{0,120}\bDSML\b/i,
  /\bDSML\b[\s\S]{0,160}\binvoke\s+name\s*=\s*["']?(?:readfile|read_file|webfetch|web_fetch|websearch|web_search|bash|grep|glob|ls)\b/i,
  /\binvoke\s+name\s*=\s*["']?(?:readfile|read_file|webfetch|web_fetch|websearch|web_search|bash|grep|glob|ls)\b[\s\S]{0,160}\bDSML\b/i,
  /\bDSML\b[\s\S]{0,160}\bparameter\s+name\s*=\s*["']?(?:url|filepath|file_path|path|maxcontentlength|max_content_length|query)\b/i
];

export function containsInternalRuntimeProtocol(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return internalRuntimeProtocolPatterns.some((pattern) => pattern.test(normalized));
}

export function internalRuntimeProtocolPreview(text: string) {
  return text.replace(/\s+/g, " ").slice(0, 160);
}
