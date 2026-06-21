import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
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

async function writeTestSkill(folderId: string, skillId: string) {
  const folder = path.join(projectSkillsRoot, folderId, skillId);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "SKILL.md"), `---\nname: ${skillId}\ndescription: Temporary test skill.\n---\n\n# Test skill\n`);
}
