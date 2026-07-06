import assert from "node:assert/strict";
import test from "node:test";
import { buildPreview, createSourceUpdateController, isProtectedPath, parseNameStatus, parsePorcelain } from "./source-update.mjs";

test("parses git status output", () => {
  assert.deepEqual(parsePorcelain(" M src/app.ts\n?? docs/new.md\n!! node_modules/pkg\n"), {
    trackedDirty: ["src/app.ts"],
    untracked: ["docs/new.md"],
  });
});

test("parses changed files and protected paths", () => {
  assert.deepEqual(parseNameStatus("M\tpackage.json\nR100\told.md\tnew.md\n"), [
    { status: "M", path: "package.json" },
    { status: "R100", previousPath: "old.md", path: "new.md" },
  ]);
  assert.equal(isProtectedPath(".facetwrite/data/facetwrite.db"), true);
  assert.equal(isProtectedPath(".env.local"), true);
  assert.equal(isProtectedPath(".env.local.example"), false);
});

test("blocks dirty source worktrees", async () => {
  const preview = await buildPreview({
    root: "F:\\project",
    run: fakeGit({
      "branch --show-current": "main\n",
      "rev-parse HEAD": "abc\n",
      "config --get remote.origin.url": "https://github.com/Aoye-3/WritingAgent-OpenCanvas.git\n",
      "rev-parse origin/main": "def\n",
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/main\n",
      "status --porcelain=v1 -uall": " M src/app.ts\n",
      "diff --name-status HEAD..def": "M\tsrc/app.ts\n",
      "rev-list --left-right --count HEAD...def": "0\t1\n",
    }),
    now: () => "2026-07-06T00:00:00.000Z",
  });

  assert.equal(preview.canApply, false);
  assert.match(preview.blockers.join("\n"), /Tracked files have local modifications/);
});

test("blocks protected target changes", async () => {
  const preview = await buildPreview({
    root: "F:\\project",
    run: fakeGit({
      "branch --show-current": "main\n",
      "rev-parse HEAD": "abc\n",
      "config --get remote.origin.url": "https://github.com/Aoye-3/WritingAgent-OpenCanvas.git\n",
      "rev-parse origin/main": "def\n",
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/main\n",
      "status --porcelain=v1 -uall": "",
      "diff --name-status HEAD..def": "M\t.facetwrite/data/facetwrite.db\n",
      "rev-list --left-right --count HEAD...def": "0\t1\n",
    }),
  });

  assert.equal(preview.canApply, false);
  assert.match(preview.blockers.join("\n"), /protected local data/);
});

test("blocks branches without upstream tracking", async () => {
  const preview = await buildPreview({
    root: "F:\\project",
    run: fakeGit({
      "branch --show-current": "main\n",
      "rev-parse HEAD": "abc\n",
      "config --get remote.origin.url": "https://github.com/Aoye-3/WritingAgent-OpenCanvas.git\n",
      "rev-parse origin/main": "def\n",
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": "",
      "status --porcelain=v1 -uall": "",
      "diff --name-status HEAD..def": "M\tsrc/app.ts\n",
      "rev-list --left-right --count HEAD...def": "0\t1\n",
    }),
  });

  assert.equal(preview.canApply, false);
  assert.match(preview.blockers.join("\n"), /no upstream tracking branch/);
});

test("applies a clean fast-forward update and installs root dependencies", async () => {
  const calls = [];
  const stages = [];
  const controller = createSourceUpdateController({
    root: "F:\\project",
    run: fakeGit({
      "fetch --prune origin": "",
      "branch --show-current": "main\n",
      "rev-parse HEAD": "abc\n",
      "config --get remote.origin.url": "https://github.com/Aoye-3/WritingAgent-OpenCanvas.git\n",
      "rev-parse origin/main": "def\n",
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/main\n",
      "status --porcelain=v1 -uall": "",
      "diff --name-status HEAD..def": "M\tpackage-lock.json\nM\tsrc/app.ts\n",
      "rev-list --left-right --count HEAD...def": "0\t2\n",
      "merge --ff-only def": "",
      "npm.cmd install": "",
    }, calls),
    stopServices: async () => calls.push("stopServices"),
    relaunch: () => calls.push("relaunch"),
    onProgress: (event) => stages.push(event.stage),
  });

  const result = await controller.apply({ expectedHead: "abc", installDependencies: true });

  assert.deepEqual(result, { applied: true, targetSha: "def" });
  assert.ok(calls.indexOf("git.exe merge --ff-only def") < calls.indexOf("npm.cmd install"));
  assert.ok(calls.indexOf("npm.cmd install") < calls.indexOf("stopServices"));
  assert.ok(calls.indexOf("stopServices") < calls.indexOf("relaunch"));
  assert.deepEqual(stages, ["checking", "fetching", "previewed", "applying", "installing", "restarting"]);
});

test("rejects apply when expected head does not match without stopping services", async () => {
  const calls = [];
  const controller = createSourceUpdateController({
    root: "F:\\project",
    run: fakeGit({
      "fetch --prune origin": "",
      "branch --show-current": "main\n",
      "rev-parse HEAD": "abc\n",
      "config --get remote.origin.url": "https://github.com/Aoye-3/WritingAgent-OpenCanvas.git\n",
      "rev-parse origin/main": "def\n",
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/main\n",
      "status --porcelain=v1 -uall": "",
      "diff --name-status HEAD..def": "M\tsrc/app.ts\n",
      "rev-list --left-right --count HEAD...def": "0\t1\n",
    }, calls),
    stopServices: async () => calls.push("stopServices"),
    relaunch: () => calls.push("relaunch"),
  });

  await assert.rejects(controller.apply({ expectedHead: "older" }), /changed since the update preview/);
  assert.equal(calls.includes("git.exe merge --ff-only def"), false);
  assert.equal(calls.includes("stopServices"), false);
  assert.equal(calls.includes("relaunch"), false);
});

test("keeps services running when fast-forward merge fails", async () => {
  const calls = [];
  const stages = [];
  const controller = createSourceUpdateController({
    root: "F:\\project",
    run: fakeGit({
      "fetch --prune origin": "",
      "branch --show-current": "main\n",
      "rev-parse HEAD": "abc\n",
      "config --get remote.origin.url": "https://github.com/Aoye-3/WritingAgent-OpenCanvas.git\n",
      "rev-parse origin/main": "def\n",
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/main\n",
      "status --porcelain=v1 -uall": "",
      "diff --name-status HEAD..def": "M\tsrc/app.ts\n",
      "rev-list --left-right --count HEAD...def": "0\t1\n",
      "merge --ff-only def": new Error("merge failed"),
    }, calls),
    stopServices: async () => calls.push("stopServices"),
    relaunch: () => calls.push("relaunch"),
    onProgress: (event) => stages.push(event.stage),
  });

  await assert.rejects(controller.apply({ expectedHead: "abc" }), /merge failed/);
  assert.equal(calls.includes("stopServices"), false);
  assert.equal(calls.includes("relaunch"), false);
  assert.equal(stages.at(-1), "failed");
});

test("rejects concurrent apply requests", async () => {
  let releaseStop;
  const controller = createSourceUpdateController({
    root: "F:\\project",
    run: fakeGit({
      "fetch --prune origin": "",
      "branch --show-current": "main\n",
      "rev-parse HEAD": "abc\n",
      "config --get remote.origin.url": "https://github.com/Aoye-3/WritingAgent-OpenCanvas.git\n",
      "rev-parse origin/main": "def\n",
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/main\n",
      "status --porcelain=v1 -uall": "",
      "diff --name-status HEAD..def": "M\tsrc/app.ts\n",
      "rev-list --left-right --count HEAD...def": "0\t1\n",
      "merge --ff-only def": "",
    }),
    stopServices: async () => new Promise((resolve) => {
      releaseStop = resolve;
    }),
    relaunch: () => undefined,
  });

  const first = controller.apply({ expectedHead: "abc" });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(controller.apply({ expectedHead: "abc" }), /already running/);
  releaseStop();
  await first;
});

function fakeGit(responses, calls = []) {
  return async (command, args) => {
    const key = command === "npm.cmd" ? ["npm.cmd", ...args].join(" ") : args.join(" ");
    calls.push(command === "npm.cmd" ? key : `${command} ${args.join(" ")}`);
    if (!(key in responses)) throw new Error(`Unexpected command: ${key}`);
    if (responses[key] instanceof Error) throw responses[key];
    return { stdout: responses[key], stderr: "" };
  };
}
