import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type Skill = {
  name: string;
  description: string;
  allowedTools: string[];
  content: string;
  relativePath: string;
};

type Frontmatter = {
  name?: string;
  description?: string;
  "allowed-tools"?: string[];
};

const skillsRoots = [
  path.resolve(process.cwd(), "skills", "public"),
  path.resolve(process.cwd(), "modules", "agent-runtime", "skills", "public")
];

export async function loadSkillsByRefs(skillRefs: string[]) {
  const requested = new Set(skillRefs);
  const loaded = await loadPublicSkills();
  return loaded.filter((skill) => requested.has(skill.name) || requested.has(skill.relativePath));
}

export async function loadPublicSkills() {
  const skills: Skill[] = [];
  for (const root of skillsRoots) {
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    const loaded = await Promise.all(entries.map((entry) => readSkill(root, entry)));
    for (const skill of loaded) {
      if (skill && !skills.some((item) => item.name === skill.name)) skills.push(skill);
    }
  }
  return skills;
}

async function readSkill(root: string, relativePath: string): Promise<Skill | null> {
  const skillFile = path.join(root, relativePath, "SKILL.md");
  try {
    const raw = await readFile(skillFile, "utf8");
    const parsed = parseSkillMarkdown(raw);
    if (!parsed.frontmatter.name || !parsed.frontmatter.description) return null;

    return {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      allowedTools: parsed.frontmatter["allowed-tools"] ?? [],
      content: parsed.body.trim(),
      relativePath
    };
  } catch {
    return null;
  }
}

function parseSkillMarkdown(raw: string): { frontmatter: Frontmatter; body: string } {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  return { frontmatter: parseFrontmatter(match[1]), body: match[2] };
}

function parseFrontmatter(source: string): Frontmatter {
  const metadata: Frontmatter = {};
  const lines = source.split(/\r?\n/);
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
      metadata[key] = value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
      arrayKey = key;
    } else if (key === "name" || key === "description") {
      metadata[key] = stripQuotes(value);
    }
  }

  return metadata;
}

function stripQuotes(value: string) {
  return value.replace(/^["']|["']$/g, "");
}
