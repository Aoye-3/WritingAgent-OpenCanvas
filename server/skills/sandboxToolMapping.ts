export const sandboxToolMap: Record<string, string> = {
  bash: "bash",
  shell: "bash",
  read: "read_file",
  readfile: "read_file",
  read_file: "read_file",
  write: "write_file",
  writefile: "write_file",
  write_file: "write_file",
  edit: "str_replace",
  str_replace: "str_replace",
  webfetch: "web_fetch",
  web_fetch: "web_fetch",
  websearch: "web_search",
  web_search: "web_search",
  grep: "grep",
  glob: "glob",
  ls: "ls"
};

export function mapExternalToolsToSandboxTools(toolNames: string[]) {
  return Array.from(new Set(toolNames
    .map((tool) => sandboxToolMap[normalizeToolName(tool)])
    .filter((tool): tool is string => Boolean(tool))));
}

function normalizeToolName(toolName: string) {
  return toolName.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
