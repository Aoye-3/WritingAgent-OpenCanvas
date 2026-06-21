import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const repo = "K-Dense-AI/scientific-agent-skills";
const ref = "main";
const workspaceRoot = process.cwd();
const skillsRoot = path.resolve(workspaceRoot, "skills", "public");

const selectedSkills = [
  {
    name: "database-lookup",
    group: "science-db",
    capabilityGroup: "science-db",
    riskLevel: "medium",
    allowedTools: ["web_search", "knowledge_base"],
    description: "Deterministically query public scientific, regulatory, finance, and demographics databases with explicit provenance."
  },
  {
    name: "paper-lookup",
    group: "science-db",
    capabilityGroup: "science-db",
    riskLevel: "medium",
    allowedTools: ["web_search", "knowledge_base"],
    description: "Look up papers and source metadata for auditable research reference nodes."
  },
  {
    name: "exploratory-data-analysis",
    group: "analysis-viz",
    capabilityGroup: "analysis-viz",
    riskLevel: "medium",
    allowedTools: ["knowledge_base", "canvas_write"],
    description: "Perform broad exploratory data analysis on scientific and structured data files."
  },
  {
    name: "matplotlib",
    group: "analysis-viz",
    capabilityGroup: "analysis-viz",
    riskLevel: "medium",
    allowedTools: ["canvas_write"],
    description: "Create publication-quality Python visualizations with Matplotlib."
  },
  {
    name: "literature-review",
    group: "writing-review",
    capabilityGroup: "writing-review",
    riskLevel: "medium",
    allowedTools: ["web_search", "knowledge_base", "canvas_write"],
    description: "Conduct structured literature reviews and synthesize findings with citations."
  },
  {
    name: "peer-review",
    group: "writing-review",
    capabilityGroup: "writing-review",
    riskLevel: "low",
    allowedTools: ["web_search", "knowledge_base", "canvas_write"],
    description: "Review research papers, reports, and proposals with structured critique."
  },
  {
    name: "citation-management",
    group: "writing-review",
    capabilityGroup: "writing-review",
    riskLevel: "low",
    allowedTools: ["knowledge_base", "canvas_write"],
    description: "Manage citations and bibliography formats for research writing."
  },
  {
    name: "markdown-mermaid-writing",
    group: "diagram-assets",
    capabilityGroup: "diagram-assets",
    riskLevel: "low",
    allowedTools: ["canvas_write"],
    description: "Write Markdown documents and Mermaid diagrams as editable source-of-truth artifacts."
  },
  {
    name: "infographics",
    group: "diagram-assets",
    capabilityGroup: "diagram-assets",
    riskLevel: "medium",
    allowedTools: ["canvas_write"],
    description: "Create information graphics and visual communication artifacts."
  },
  {
    name: "generate-image",
    group: "diagram-assets",
    capabilityGroup: "diagram-assets",
    riskLevel: "medium",
    allowedTools: ["canvas_write"],
    description: "Generate or edit general-purpose images; technical diagrams should prefer Mermaid or Canvas diagram delivery."
  },
  {
    name: "markitdown",
    group: "document-ingestion",
    capabilityGroup: "document-ingestion",
    riskLevel: "medium",
    allowedTools: ["knowledge_base", "canvas_write"],
    description: "Convert documents and source material into Markdown for Knowledge and Canvas use."
  },
  {
    name: "pdf",
    group: "document-ingestion",
    capabilityGroup: "document-ingestion",
    riskLevel: "medium",
    allowedTools: ["knowledge_base", "canvas_write"],
    description: "Process PDF documents for research reading, extraction, and review workflows."
  },
  {
    name: "docx",
    group: "document-ingestion",
    capabilityGroup: "document-ingestion",
    riskLevel: "medium",
    allowedTools: ["knowledge_base", "canvas_write"],
    description: "Process DOCX documents for writing, review, and import workflows."
  }
];

const sandboxToolMap = {
  bash: "bash",
  shell: "bash",
  read: "read_file",
  readfile: "read_file",
  write: "write_file",
  writefile: "write_file",
  edit: "str_replace",
  webfetch: "web_fetch",
  websearch: "web_search",
  grep: "grep",
  glob: "glob",
  ls: "ls"
};

async function main() {
  assertInsideWorkspace(skillsRoot);
  console.log(`Import destination: ${skillsRoot}`);

  const commit = await readCommitSha();
  const importedAt = new Date().toISOString();
  const manifest = {
    upstream: { repo, ref, commit },
    importedAt,
    policy: {
      scope: "universal-first-round",
      executionMode: "sandbox",
      note: "The database-lookup skill is imported with its complete upstream references. Other standalone domain-specific skills remain intentionally excluded from this import."
    },
    skills: []
  };

  for (const spec of selectedSkills) {
    const targetDirectory = path.resolve(skillsRoot, spec.group, spec.name);
    assertInsideWorkspace(targetDirectory);
    console.log(`Importing ${spec.name} -> ${targetDirectory}`);
    const files = await listSkillFiles(spec.name);
    const originalSkill = files.find((file) => file.path.endsWith("/SKILL.md"));
    let originalAllowedTools = [];
    let requiresEnv = [];
    let license = "MIT";
    let referenceCount = 0;

    for (const file of files) {
      if (!file.path || !file.download_url) continue;
      const relative = file.path.split(`skills/${spec.name}/`)[1];
      if (!relative) continue;
      if (relative.startsWith("references/")) referenceCount += 1;
      const target = path.resolve(targetDirectory, relative);
      assertInsideWorkspace(target);
      await mkdir(path.dirname(target), { recursive: true });
      const content = await fetchBuffer(file.download_url);
      if (relative === "SKILL.md") {
        const raw = content.toString("utf8");
        originalAllowedTools = readAllowedTools(raw);
        requiresEnv = readRequiredEnv(raw);
        license = readLicense(raw) ?? license;
        await writeFile(target, normalizeSkillMarkdown(raw, spec, license), "utf8");
      } else {
        await writeFile(target, content);
      }
    }

    const runtimeTools = mapExternalToolsToSandboxTools(originalAllowedTools);
    const sidecar = {
      capabilityGroup: spec.capabilityGroup,
      upstream: {
        repo,
        path: `skills/${spec.name}`,
        commit,
        url: `https://github.com/${repo}/tree/${commit}/skills/${spec.name}`
      },
      license,
      requiresEnv,
      runtimeTools,
      originalAllowedTools,
      executionMode: "sandbox",
      riskLevel: spec.riskLevel,
      importedAt
    };
    await writeFile(path.resolve(targetDirectory, "facetwrite.skill.json"), `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
    manifest.skills.push({
      name: spec.name,
      group: spec.group,
      relativePath: `${spec.group}/${spec.name}`,
      riskLevel: spec.riskLevel,
      runtimeTools,
      requiresEnv,
      originalAllowedTools,
      upstreamPath: `skills/${spec.name}`,
      ...(spec.name === "database-lookup" ? {
        referencePolicy: "complete-upstream-references",
        referenceCount
      } : {})
    });

    if (!originalSkill) {
      throw new Error(`No SKILL.md found for ${spec.name}`);
    }
  }

  await writeFile(
    path.resolve(skillsRoot, "scientific-agent-skills.import.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

async function readCommitSha() {
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${ref}`, {
    headers: { "User-Agent": "FacetWrite scientific skills importer" }
  });
  if (!response.ok) throw new Error(`Unable to read upstream commit: ${response.status}`);
  const payload = await response.json();
  return payload.sha;
}

async function listSkillFiles(skillName) {
  const root = `skills/${skillName}`;
  const results = [];
  async function visit(apiPath) {
    const response = await fetch(`https://api.github.com/repos/${repo}/contents/${apiPath}?ref=${ref}`, {
      headers: { "User-Agent": "FacetWrite scientific skills importer" }
    });
    if (!response.ok) throw new Error(`Unable to list ${apiPath}: ${response.status}`);
    const entries = await response.json();
    for (const entry of entries) {
      if (entry.type === "dir") await visit(entry.path);
      if (entry.type === "file") results.push(entry);
    }
  }
  await visit(root);
  return results;
}

async function fetchBuffer(url) {
  const response = await fetch(url, { headers: { "User-Agent": "FacetWrite scientific skills importer" } });
  if (!response.ok) throw new Error(`Unable to download ${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function normalizeSkillMarkdown(raw, spec, license) {
  const body = stripFrontmatter(raw).trim();
  return [
    "---",
    `name: ${spec.name}`,
    `description: ${spec.description}`,
    "allowed-tools:",
    ...spec.allowedTools.map((tool) => `  - ${tool}`),
    `license: ${license}`,
    "---",
    "",
    body,
    ""
  ].join("\n");
}

function stripFrontmatter(raw) {
  const block = raw.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n([\s\S]*)$/);
  if (block) return block[1];
  const inline = raw.match(/^---\s+[\s\S]*?\s+---\s*([\s\S]*)$/);
  return inline ? inline[1] : raw;
}

function readAllowedTools(raw) {
  const listBlock = raw.match(/allowed-tools:\s*\r?\n((?:\s*-\s*.+\r?\n?)+)/);
  if (listBlock) return listBlock[1].split(/\r?\n/).map((line) => line.trim().replace(/^-\s*/, "")).filter(Boolean);
  const inline = raw.match(/allowed-tools:\s*([\s\S]*?)(?:\s+license:|\s+metadata:|\s+compatibility:|\s+required_environment_variables:|\s+---)/);
  return inline ? inline[1].split(/[\s,]+/).map((tool) => tool.trim()).filter(Boolean) : [];
}

function readRequiredEnv(raw) {
  const matches = [...raw.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
  return Array.from(new Set(matches));
}

function readLicense(raw) {
  const match = raw.match(/license:\s*("?)([^"\n]+?)\1(?:\s+metadata:|\s+compatibility:|\s+required_environment_variables:|\s+---|\r?\n)/);
  return match?.[2]?.trim();
}

function mapExternalToolsToSandboxTools(toolNames) {
  return Array.from(new Set(toolNames
    .map((tool) => sandboxToolMap[tool.toLowerCase().replace(/[^a-z0-9]+/g, "")])
    .filter(Boolean)));
}

function assertInsideWorkspace(target) {
  const relative = path.relative(workspaceRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside workspace: ${target}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
