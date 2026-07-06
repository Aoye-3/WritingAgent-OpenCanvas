const updateRemote = "origin";
const updateTargetRef = "origin/main";
const allowedRemoteUrls = new Set([
  "https://github.com/Aoye-3/WritingAgent-OpenCanvas.git",
  "https://github.com/Aoye-3/WritingAgent-OpenCanvas",
  "git@github.com:Aoye-3/WritingAgent-OpenCanvas.git",
]);

const protectedPrefixes = [
  ".facetwrite/",
  ".facetwrite-test/",
  ".pytest-tmp/",
  ".agent-tmp/",
  ".git/",
  "node_modules/",
  "dist/",
  "logs/",
  "modules/agent-runtime/backend/.venv/",
  "modules/agent-runtime/backend/.uv-cache/",
  "modules/agent-runtime/backend/.uv-python/",
  "modules/agent-runtime/frontend/node_modules/",
  "modules/agent-runtime/logs/",
  "modules/agent-runtime/log/",
];

const rootDependencyFiles = new Set(["package.json", "package-lock.json"]);
const runtimeDependencyFiles = new Set([
  "modules/agent-runtime/backend/pyproject.toml",
  "modules/agent-runtime/backend/uv.lock",
]);

export function createSourceUpdateController(options) {
  const root = options.root;
  const run = options.run;
  const now = options.now ?? (() => new Date().toISOString());
  const onProgress = options.onProgress ?? (() => undefined);
  const stopServices = options.stopServices ?? (async () => undefined);
  const relaunch = options.relaunch ?? (() => undefined);
  let applying = false;

  async function preview(input = {}) {
    emit(onProgress, "checking");
    if (input.refresh) {
      emit(onProgress, "fetching");
      await git(run, root, ["fetch", "--prune", updateRemote], 120_000);
    }
    const result = await buildPreview({ root, run, now });
    emit(onProgress, "previewed", result);
    return result;
  }

  async function apply(input = {}) {
    if (applying) throw new Error("A source update is already running.");
    applying = true;
    try {
      const current = await preview({ refresh: true });
      if (input.expectedHead && input.expectedHead !== current.headSha) {
        throw new Error("The workspace changed since the update preview was generated.");
      }
      if (!current.canApply) {
        throw new Error(current.blockers[0] ?? "The source update cannot be applied.");
      }

      emit(onProgress, "applying");
      await git(run, root, ["merge", "--ff-only", current.targetSha], 120_000);

      if (current.dependencyChanges.root && input.installDependencies !== false) {
        emit(onProgress, "installing");
        await run("npm.cmd", ["install"], { cwd: root, timeout: 300_000 });
      }

      emit(onProgress, "restarting");
      await stopServices();
      relaunch();
      return { applied: true, targetSha: current.targetSha };
    } catch (error) {
      emit(onProgress, "failed", { message: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      applying = false;
    }
  }

  return { preview, apply };
}

export async function buildPreview({ root, run, now = () => new Date().toISOString() }) {
  const blockers = [];
  const branch = await gitOptional(run, root, ["branch", "--show-current"]);
  const detached = !branch;
  const headSha = await gitRequired(run, root, ["rev-parse", "HEAD"], blockers, "Unable to resolve the current HEAD.");
  const remoteUrl = await gitRequired(run, root, ["config", "--get", "remote.origin.url"], blockers, "The origin remote is not configured.");
  const targetSha = await gitRequired(run, root, ["rev-parse", updateTargetRef], blockers, "Unable to resolve origin/main. Run update preview with refresh enabled.");
  const upstream = await gitOptional(run, root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const status = parsePorcelain(await gitOptional(run, root, ["status", "--porcelain=v1", "-uall"]));
  const changedFiles = targetSha ? parseNameStatus(await gitOptional(run, root, ["diff", "--name-status", `HEAD..${targetSha}`])) : [];
  const counts = targetSha ? parseAheadBehind(await gitOptional(run, root, ["rev-list", "--left-right", "--count", `HEAD...${targetSha}`])) : { ahead: 0, behind: 0 };
  const protectedChanges = changedFiles.filter((file) => isProtectedPath(file.path) || (file.previousPath && isProtectedPath(file.previousPath)));
  const untrackedCollisions = status.untracked.filter((file) => changedFiles.some((changed) => changed.path === file || changed.previousPath === file));
  const untrackedApplicationFiles = status.untracked.filter((file) => !isProtectedPath(file));
  const dependencyChanges = summarizeDependencyChanges(changedFiles);

  if (detached) blockers.push("The workspace is in detached HEAD state.");
  if (!upstream) blockers.push("The current branch has no upstream tracking branch.");
  if (remoteUrl && !allowedRemoteUrls.has(remoteUrl)) blockers.push("The origin remote is not an allowed OpenCanvas source.");
  if (status.trackedDirty.length > 0) blockers.push("Tracked files have local modifications. Commit or clear them before updating.");
  if (untrackedApplicationFiles.length > 0) blockers.push("Untracked application files are present. Commit or remove them before updating.");
  if (untrackedCollisions.length > 0) blockers.push("Untracked files would be overwritten by the target update.");
  if (protectedChanges.length > 0) blockers.push("The target update touches protected local data paths.");
  if (counts.ahead > 0) blockers.push("The current branch has local commits ahead of origin/main.");
  if (counts.behind === 0 && blockers.length === 0) blockers.push("No source update is available.");

  return {
    mode: "source-git",
    branch,
    headSha,
    remote: remoteUrl,
    upstream,
    targetRef: updateTargetRef,
    targetSha,
    ahead: counts.ahead,
    behind: counts.behind,
    dirty: status.trackedDirty.length > 0 || untrackedApplicationFiles.length > 0,
    changedFiles,
    dependencyChanges,
    protectedChanges,
    blockers,
    canApply: blockers.length === 0 && counts.behind > 0 && Boolean(headSha && targetSha),
    lastCheckedAt: now(),
  };
}

export function parsePorcelain(output) {
  const trackedDirty = [];
  const untracked = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith("?? ")) {
      untracked.push(normalizeGitPath(line.slice(3)));
      continue;
    }
    if (line.startsWith("!! ")) continue;
    trackedDirty.push(normalizeGitPath(parseStatusPath(line.slice(3))));
  }
  return { trackedDirty, untracked };
}

export function parseNameStatus(output) {
  const files = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0];
    if (status.startsWith("R") || status.startsWith("C")) {
      files.push({
        status,
        previousPath: normalizeGitPath(parts[1] ?? ""),
        path: normalizeGitPath(parts[2] ?? parts[1] ?? ""),
      });
      continue;
    }
    files.push({ status, path: normalizeGitPath(parts[1] ?? "") });
  }
  return files.filter((file) => file.path);
}

export function parseAheadBehind(output) {
  const [aheadText, behindText] = output.trim().split(/\s+/);
  return {
    ahead: Number(aheadText) || 0,
    behind: Number(behindText) || 0,
  };
}

export function isProtectedPath(value) {
  const file = normalizeGitPath(value);
  if (!file) return false;
  if (isEnvExample(file)) return false;
  if (file === ".env" || file.startsWith(".env.") || file.endsWith("/.env") || file.includes("/.env.")) return true;
  if (file === "modules/agent-runtime/.env") return true;
  return protectedPrefixes.some((prefix) => file === prefix.slice(0, -1) || file.startsWith(prefix));
}

function summarizeDependencyChanges(files) {
  const paths = files.flatMap((file) => [file.path, file.previousPath].filter(Boolean));
  return {
    root: paths.some((file) => rootDependencyFiles.has(file)),
    runtime: paths.some((file) => runtimeDependencyFiles.has(file)),
  };
}

function emit(onProgress, stage, payload = undefined) {
  onProgress({ stage, payload, at: new Date().toISOString() });
}

async function git(run, root, args, timeout = 30_000) {
  return run("git.exe", args, { cwd: root, timeout });
}

async function gitOptional(run, root, args) {
  try {
    const result = await git(run, root, args);
    return result.stdout.trim();
  } catch {
    return "";
  }
}

async function gitRequired(run, root, args, blockers, blocker) {
  const value = await gitOptional(run, root, args);
  if (!value) blockers.push(blocker);
  return value;
}

function parseStatusPath(value) {
  const arrowIndex = value.indexOf(" -> ");
  if (arrowIndex >= 0) return value.slice(arrowIndex + 4);
  return value;
}

function normalizeGitPath(value) {
  return value.trim().replace(/^"|"$/g, "").replace(/\\/g, "/");
}

function isEnvExample(file) {
  return file === ".env.example"
    || file === ".env.local.example"
    || file.endsWith("/.env.example")
    || file.endsWith("/.env.local.example");
}
