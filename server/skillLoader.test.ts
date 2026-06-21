import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createProjectSkillFolder,
  deleteProjectSkillFolder,
  loadPublicSkillFolders,
  loadPublicSkills,
  moveProjectSkillToFolder,
  renameProjectSkillFolder,
  resolveSkillFolderMetadata
} from "./skillLoader.js";

const projectSkillsRoot = path.resolve(process.cwd(), "skills", "public");
const testFolderIds = ["skill-manager-test", "skill-manager-renamed", "skill-manager-source", "skill-manager-target"];

test.afterEach(async () => {
  for (const folderId of testFolderIds) {
    const target = path.resolve(projectSkillsRoot, folderId);
    assert.ok(path.relative(projectSkillsRoot, target).startsWith("skill-manager"));
    await rm(target, { recursive: true, force: true });
  }
});

test("public skill catalog includes recursive default folder metadata", async () => {
  const skills = await loadPublicSkills();
  const summary = skills.find((skill) => skill.name === "summary");

  assert.ok(summary);
  assert.equal(summary.relativePath, "default/summary");
  assert.equal(summary.folderId, "default");
  assert.equal(summary.folderName, "Default skills");
  assert.equal(summary.folderPath, "default");
});

test("legacy project-level skills are categorized as default skills", () => {
  assert.deepEqual(resolveSkillFolderMetadata("summary", "project"), {
    folderId: "default",
    folderName: "Default skills",
    folderPath: "default"
  });
});

test("top-level Agent Runtime skills stay out of the default folder", () => {
  assert.deepEqual(resolveSkillFolderMetadata("brainstorming", "agent-runtime"), {
    folderId: "agent-runtime",
    folderName: "Agent Runtime",
    folderPath: "agent-runtime"
  });
});

test("project skill folders can be created, renamed, and deleted when empty", async () => {
  await createProjectSkillFolder("skill-manager-test");
  let folders = await loadPublicSkillFolders();
  assert.ok(folders.some((folder) => folder.folderId === "skill-manager-test" && folder.manageable));

  await renameProjectSkillFolder("skill-manager-test", "skill-manager-renamed");
  folders = await loadPublicSkillFolders();
  assert.ok(folders.some((folder) => folder.folderId === "skill-manager-renamed" && folder.manageable));

  await deleteProjectSkillFolder("skill-manager-renamed");
  folders = await loadPublicSkillFolders();
  assert.equal(folders.some((folder) => folder.folderId === "skill-manager-renamed"), false);
});

test("project skill folder management rejects unsafe or protected folders", async () => {
  await assert.rejects(() => createProjectSkillFolder("../unsafe"));
  await assert.rejects(() => createProjectSkillFolder("default"));
  await createProjectSkillFolder("skill-manager-test");
  await assert.rejects(() => createProjectSkillFolder("skill-manager-test"));
  await assert.rejects(() => renameProjectSkillFolder("default", "skill-manager-renamed"));
  await assert.rejects(() => deleteProjectSkillFolder("default"));
});

test("non-empty project skill folders cannot be deleted", async () => {
  await writeTestSkill("skill-manager-source", "skill-manager-temp");

  await assert.rejects(() => deleteProjectSkillFolder("skill-manager-source"));
});

test("project skills can move folders while runtime skills stay read-only", async () => {
  await writeTestSkill("skill-manager-source", "skill-manager-temp");
  await createProjectSkillFolder("skill-manager-target");

  await moveProjectSkillToFolder("skill-manager-temp", "skill-manager-target");
  const skills = await loadPublicSkills();
  const moved = skills.find((skill) => skill.name === "skill-manager-temp");
  assert.equal(moved?.relativePath, "skill-manager-target/skill-manager-temp");
  assert.equal(moved?.manageable, true);

  await assert.rejects(() => moveProjectSkillToFolder("brainstorming", "skill-manager-target"));
});

test("project skills load normalized inline frontmatter and sandbox sidecar metadata", async () => {
  await writeTestSkill(
    "skill-manager-source",
    "skill-manager-temp",
    `--- name: skill-manager-temp description: Inline scientific skill allowed-tools: Read Bash license: MIT ---\n\n# Inline\n`,
    {
      capabilityGroup: "analysis-viz",
      upstream: { repo: "K-Dense-AI/scientific-agent-skills", path: "skills/example", commit: "abc123" },
      license: "MIT",
      requiresEnv: ["OPENROUTER_API_KEY"],
      runtimeTools: ["read_file", "bash"],
      originalAllowedTools: ["Read", "Bash"],
      executionMode: "sandbox",
      riskLevel: "medium"
    }
  );

  const skills = await loadPublicSkills();
  const loaded = skills.find((skill) => skill.name === "skill-manager-temp");

  assert.ok(loaded);
  assert.equal(loaded.description, "Inline scientific skill");
  assert.deepEqual(loaded.allowedTools, ["Read", "Bash"]);
  assert.equal(loaded.metadata.capabilityGroup, "analysis-viz");
  assert.equal(loaded.metadata.executionMode, "sandbox");
  assert.equal(loaded.metadata.riskLevel, "medium");
  assert.equal(loaded.metadata.upstream?.repo, "K-Dense-AI/scientific-agent-skills");
  assert.deepEqual(loaded.metadata.requiresEnv, ["OPENROUTER_API_KEY"]);
  assert.deepEqual(loaded.metadata.runtimeTools, ["read_file", "bash"]);
});

test("scientific universal import is grouped and keeps complete database lookup references", async () => {
  const skills = await loadPublicSkills();
  const databaseLookup = skills.find((skill) => skill.name === "database-lookup");

  assert.ok(databaseLookup);
  assert.equal(databaseLookup.relativePath, "science-db/database-lookup");
  assert.equal(databaseLookup.folderId, "science-db");
  assert.equal(databaseLookup.metadata.executionMode, "sandbox");
  assert.equal(databaseLookup.metadata.upstream?.repo, "K-Dense-AI/scientific-agent-skills");
  assert.deepEqual(databaseLookup.metadata.runtimeTools, ["read_file", "bash"]);
  assert.equal(await fileExists(path.join(projectSkillsRoot, "science-db", "database-lookup", "references", "retrieval-contract.md")), true);
  assert.equal(await fileExists(path.join(projectSkillsRoot, "science-db", "database-lookup", "references", "pubchem.md")), true);
});

async function writeTestSkill(folderId: string, skillId: string, skillBody?: string, sidecar?: Record<string, unknown>) {
  const folder = path.join(projectSkillsRoot, folderId, skillId);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "SKILL.md"), skillBody ?? `---\nname: ${skillId}\ndescription: Temporary test skill.\n---\n\n# Test skill\n`);
  if (sidecar) {
    await writeFile(path.join(folder, "facetwrite.skill.json"), JSON.stringify(sidecar, null, 2));
  }
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
