import { mkdir, readdir, readFile, rename, rmdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

export type SkillRiskLevel = "low" | "medium" | "high";
export type SkillExecutionMode = "instruction" | "sandbox";

export type SkillSecurityMetadata = {
  capabilityGroup?: string;
  upstream?: {
    repo: string;
    path: string;
    commit?: string;
    url?: string;
  };
  license?: string;
  requiresEnv: string[];
  runtimeTools: string[];
  originalAllowedTools: string[];
  executionMode: SkillExecutionMode;
  riskLevel: SkillRiskLevel;
};

export type Skill = {
  name: string;
  description: string;
  allowedTools: string[];
  content: string;
  relativePath: string;
  folderId: string;
  folderName: string;
  folderPath: string;
  source: SkillsRoot["source"];
  manageable: boolean;
  metadata: SkillSecurityMetadata;
};

export type SkillFolder = {
  folderId: string;
  folderName: string;
  folderPath: string;
  source: SkillsRoot["source"];
  manageable: boolean;
  skillCount: number;
};

type Frontmatter = {
  name?: string;
  description?: string;
  "allowed-tools"?: string[];
  license?: string;
};

type SkillsRoot = {
  path: string;
  source: "project" | "agent-runtime";
};

const projectSkillsRoot = path.resolve(process.cwd(), "skills", "public");

const skillsRoots: SkillsRoot[] = [
  { path: projectSkillsRoot, source: "project" },
  { path: path.resolve(process.cwd(), "modules", "agent-runtime", "skills", "public"), source: "agent-runtime" }
];

export async function loadSkillsByRefs(skillRefs: string[]) {
  const requested = new Set(skillRefs);
  const loaded = await loadPublicSkills();
  return loaded.filter((skill) => requested.has(skill.name) || requested.has(skill.relativePath));
}

export async function loadPublicSkills() {
  const skills: Skill[] = [];
  for (const root of skillsRoots) {
    const entries = await findSkillDirectories(root.path);
    const loaded = await Promise.all(entries.map((entry) => readSkill(root, entry)));
    for (const skill of loaded) {
      if (skill && !skills.some((item) => item.name === skill.name)) skills.push(skill);
    }
  }
  return skills;
}

export async function loadPublicSkillFolders() {
  const skills = await loadPublicSkills();
  const folders = new Map<string, SkillFolder>();
  for (const skill of skills) {
    const existing = folders.get(skill.folderId) ?? {
      folderId: skill.folderId,
      folderName: skill.folderName,
      folderPath: skill.folderPath,
      source: skill.source,
      manageable: skill.manageable && skill.folderId !== "default",
      skillCount: 0
    };
    existing.skillCount += 1;
    folders.set(skill.folderId, existing);
  }

  folders.set("default", {
    folderId: "default",
    folderName: "Default skills",
    folderPath: "default",
    source: "project",
    manageable: false,
    skillCount: folders.get("default")?.skillCount ?? 0
  });

  for (const folderPath of await listProjectTopLevelFolders()) {
    const folder = resolveSkillFolderMetadata(`${folderPath}/placeholder`, "project");
    if (!folders.has(folder.folderId)) {
      folders.set(folder.folderId, {
        folderId: folder.folderId,
        folderName: folder.folderName,
        folderPath: folder.folderPath,
        source: "project",
        manageable: folder.folderId !== "default",
        skillCount: 0
      });
    }
  }

  return Array.from(folders.values()).sort((left, right) => {
    if (left.folderId === "default") return -1;
    if (right.folderId === "default") return 1;
    if (left.source !== right.source) return left.source === "project" ? -1 : 1;
    return left.folderName.localeCompare(right.folderName);
  });
}

export async function createProjectSkillFolder(folderId: string) {
  const folderPath = resolveProjectFolderPath(folderId, { allowDefault: false });
  try {
    await mkdir(folderPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Skill folder already exists");
    }
    throw error;
  }
}

export async function renameProjectSkillFolder(currentFolderId: string, nextFolderId: string) {
  const currentPath = resolveProjectFolderPath(currentFolderId, { allowDefault: false });
  const nextPath = resolveProjectFolderPath(nextFolderId, { allowDefault: false });
  await rename(currentPath, nextPath);
}

export async function deleteProjectSkillFolder(folderId: string) {
  const folderPath = resolveProjectFolderPath(folderId, { allowDefault: false });
  await rmdir(folderPath);
}

export async function moveProjectSkillToFolder(skillRef: string, folderId: string) {
  const targetFolder = resolveProjectFolderPath(folderId, { allowDefault: true });
  await mkdir(targetFolder, { recursive: true });
  const skill = await findProjectSkill(skillRef);
  if (!skill) throw new Error("Project skill not found or not manageable");
  const currentPath = resolveProjectSkillDirectory(skill.relativePath);
  const nextPath = resolveProjectSkillDirectory(`${folderId}/${path.basename(skill.relativePath)}`);
  if (currentPath === nextPath) return;
  await rename(currentPath, nextPath);
}

async function findSkillDirectories(root: string) {
  const entries: string[] = [];
  async function visit(relativePath = "") {
    const directory = path.join(root, relativePath);
    let children: Dirent[];
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    if (children.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      entries.push(relativePath);
      return;
    }

    for (const child of children) {
      if (child.isDirectory()) await visit(path.join(relativePath, child.name));
    }
  }

  await visit();
  return entries;
}

async function readSkill(root: SkillsRoot, relativePath: string): Promise<Skill | null> {
  const skillFile = path.join(root.path, relativePath, "SKILL.md");
  try {
    const raw = await readFile(skillFile, "utf8");
    const parsed = parseSkillMarkdown(raw);
    if (!parsed.frontmatter.name || !parsed.frontmatter.description) return null;
    const folder = resolveSkillFolderMetadata(relativePath, root.source);
    const metadata = await readSkillMetadata(root, relativePath, parsed.frontmatter);

    return {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      allowedTools: parsed.frontmatter["allowed-tools"] ?? [],
      content: parsed.body.trim(),
      relativePath: normalizeSkillPath(relativePath),
      folderId: folder.folderId,
      folderName: folder.folderName,
      folderPath: folder.folderPath,
      source: root.source,
      manageable: root.source === "project",
      metadata
    };
  } catch {
    return null;
  }
}

async function readSkillMetadata(root: SkillsRoot, relativePath: string, frontmatter: Frontmatter): Promise<SkillSecurityMetadata> {
  const sidecar = await readSkillSidecar(root, relativePath);
  return {
    capabilityGroup: readOptionalString(sidecar.capabilityGroup),
    upstream: readUpstream(sidecar.upstream),
    license: readOptionalString(sidecar.license) ?? frontmatter.license,
    requiresEnv: readStringArray(sidecar.requiresEnv),
    runtimeTools: readStringArray(sidecar.runtimeTools),
    originalAllowedTools: readStringArray(sidecar.originalAllowedTools),
    executionMode: readExecutionMode(sidecar.executionMode),
    riskLevel: readRiskLevel(sidecar.riskLevel)
  };
}

async function readSkillSidecar(root: SkillsRoot, relativePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path.join(root.path, relativePath, "facetwrite.skill.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readUpstream(value: unknown): SkillSecurityMetadata["upstream"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const repo = readOptionalString(record.repo);
  const upstreamPath = readOptionalString(record.path);
  if (!repo || !upstreamPath) return undefined;
  return {
    repo,
    path: upstreamPath,
    commit: readOptionalString(record.commit),
    url: readOptionalString(record.url)
  };
}

function readExecutionMode(value: unknown): SkillExecutionMode {
  return value === "sandbox" ? "sandbox" : "instruction";
}

function readRiskLevel(value: unknown): SkillRiskLevel {
  return value === "high" || value === "medium" ? value : "low";
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

export function resolveSkillFolderMetadata(relativePath: string, source: SkillsRoot["source"]) {
  const normalized = normalizeSkillPath(relativePath);
  const parts = normalized.split("/").filter(Boolean);
  const folderPath = parts.length > 1
    ? parts.slice(0, -1).join("/")
    : source === "project" ? "default" : "agent-runtime";
  const folderId = slugifySkillFolder(folderPath);
  return {
    folderId,
    folderName: folderId === "default" ? "Default skills" : humanizeSkillFolder(folderPath),
    folderPath
  };
}

function normalizeSkillPath(value: string) {
  return value.split(path.sep).join("/");
}

function slugifySkillFolder(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "default";
}

function humanizeSkillFolder(value: string) {
  return value
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()))
    .join(" / ");
}

async function listProjectTopLevelFolders() {
  let entries: Dirent[];
  try {
    entries = await readdir(projectSkillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((name) => isValidFolderId(name));
}

async function findProjectSkill(skillRef: string) {
  const entries = await findSkillDirectories(projectSkillsRoot);
  const loaded = await Promise.all(entries.map((entry) => readSkill({ path: projectSkillsRoot, source: "project" }, entry)));
  return loaded.find((skill) => skill && (skill.name === skillRef || skill.relativePath === skillRef)) ?? null;
}

function resolveProjectFolderPath(folderId: string, options: { allowDefault: boolean }) {
  assertValidFolderId(folderId);
  if (folderId === "default" && !options.allowDefault) throw new Error("Default skill folder cannot be managed");
  return assertInsideProjectSkills(path.resolve(projectSkillsRoot, folderId));
}

function resolveProjectSkillDirectory(relativePath: string) {
  const normalized = normalizeSkillPath(relativePath);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("Project skill path must include a folder");
  for (const part of parts) assertValidFolderId(part);
  return assertInsideProjectSkills(path.resolve(projectSkillsRoot, ...parts));
}

function assertInsideProjectSkills(resolvedPath: string) {
  const relative = path.relative(projectSkillsRoot, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Skill path must stay inside project skills");
  }
  return resolvedPath;
}

function assertValidFolderId(folderId: string) {
  if (!isValidFolderId(folderId)) {
    throw new Error("Skill folder id must use lowercase letters, numbers, and dashes");
  }
}

function isValidFolderId(folderId: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(folderId);
}

function parseSkillMarkdown(raw: string): { frontmatter: Frontmatter; body: string } {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/)
    ?? raw.match(/^---\s+([\s\S]*?)\s+---\s*([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  return { frontmatter: parseFrontmatter(match[1]), body: match[2] };
}

function parseFrontmatter(source: string): Frontmatter {
  const metadata: Frontmatter = {};
  const normalizedSource = source.includes("\n")
    ? source
    : source.replace(/\s+(description|allowed-tools|license|required_environment_variables|metadata|compatibility):/g, "\n$1:");
  const lines = normalizedSource.split(/\r?\n/);
  let arrayKey: keyof Frontmatter | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (arrayKey && trimmed.startsWith("- ")) {
      const current = metadata[arrayKey];
      if (Array.isArray(current)) {
        current.push(trimmed.slice(2).trim());
      }
      continue;
    }

    arrayKey = null;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;

    const key = trimmed.slice(0, colon).trim() as keyof Frontmatter;
    const value = trimmed.slice(colon + 1).trim();
    if (key === "allowed-tools") {
      metadata[key] = value ? value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean) : [];
      arrayKey = key;
    } else if (key === "name" || key === "description" || key === "license") {
      metadata[key] = stripQuotes(value);
    }
  }

  return metadata;
}

function stripQuotes(value: string) {
  return value.replace(/^["']|["']$/g, "");
}
