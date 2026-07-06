import { useEffect, useMemo, useState } from "react";
import { getOpenCanvasShell, type SourceUpdatePreview, type SourceUpdateProgress } from "../../../app/shellBridge";
import { Button } from "../../../shared/ui";

export function SourceUpdatePanel() {
  const [preview, setPreview] = useState<SourceUpdatePreview | undefined>();
  const [progress, setProgress] = useState<SourceUpdateProgress | undefined>();
  const [busy, setBusy] = useState<"idle" | "checking" | "applying">("idle");
  const [error, setError] = useState<string | undefined>();
  const shell = getOpenCanvasShell();
  const updateAvailable = Boolean(preview && preview.behind > 0);
  const stageLabel = progress ? sourceUpdateStageLabel(progress.stage) : "Idle";
  const dependencyLabel = useMemo(() => {
    if (!preview) return "Unknown";
    const changes = [];
    if (preview.dependencyChanges.root) changes.push("npm install");
    if (preview.dependencyChanges.runtime) changes.push("Agent Runtime sync on restart");
    return changes.join(", ") || "No dependency changes";
  }, [preview]);

  useEffect(() => {
    if (!shell?.sourceUpdatePreview) return;
    let cancelled = false;
    setBusy("checking");
    shell.sourceUpdatePreview({ refresh: false })
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setError(readErrorMessage(nextError));
      })
      .finally(() => {
        if (!cancelled) setBusy("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [shell]);

  useEffect(() => {
    if (!shell?.onSourceUpdateProgress) return undefined;
    return shell.onSourceUpdateProgress(setProgress);
  }, [shell]);

  async function handleCheck() {
    if (!shell?.sourceUpdatePreview) return;
    setBusy("checking");
    setError(undefined);
    try {
      setPreview(await shell.sourceUpdatePreview({ refresh: true }));
    } catch (nextError) {
      setError(readErrorMessage(nextError));
    } finally {
      setBusy("idle");
    }
  }

  async function handleApply() {
    if (!shell?.sourceUpdateApply || !preview?.headSha) return;
    const confirmed = window.confirm("Apply the source Git update now? OpenCanvas will restart after the update.");
    if (!confirmed) return;
    setBusy("applying");
    setError(undefined);
    try {
      await shell.sourceUpdateApply({ expectedHead: preview.headSha, installDependencies: true });
    } catch (nextError) {
      setError(readErrorMessage(nextError));
      setBusy("idle");
    }
  }

  if (!shell?.sourceUpdatePreview || !shell.sourceUpdateApply) {
    return (
      <section className="settings-runtime-section" aria-label="Source Git update">
        <div className="settings-runtime-heading">
          <div>
            <p className="eyebrow">Source update</p>
            <h3>Source Git update</h3>
          </div>
          <span className="runtime-pill">Shell unavailable</span>
        </div>
        <p className="settings-message is-error">Desktop Shell source updates are unavailable in this browser session.</p>
      </section>
    );
  }

  return (
    <section className="settings-runtime-section" aria-label="Source Git update">
      <div className="settings-runtime-heading">
        <div>
          <p className="eyebrow">Source update</p>
          <h3>Source Git update</h3>
        </div>
        <span className={preview?.canApply ? "runtime-pill is-online" : "runtime-pill"}>
          {preview?.canApply ? "Update ready" : stageLabel}
        </span>
      </div>
      <dl className="settings-status-list source-update-status">
        <StatusRow label="Branch" value={preview?.branch || "Unknown"} />
        <StatusRow label="Current" value={shortSha(preview?.headSha)} />
        <StatusRow label="Target" value={`${preview?.targetRef ?? "origin/main"} ${shortSha(preview?.targetSha)}`} />
        <StatusRow label="Remote" value={preview?.remote || "Unknown"} />
        <StatusRow label="Behind" value={preview ? String(preview.behind) : "Unknown"} />
        <StatusRow label="Dependencies" value={dependencyLabel} />
      </dl>
      {preview?.blockers.length ? (
        <ul className="source-update-blockers" aria-label="Source update blockers">
          {preview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
        </ul>
      ) : null}
      {error ? <p className="settings-message is-error">{error}</p> : null}
      <div className="source-update-actions">
        <Button loading={busy === "checking"} onClick={handleCheck} type="button" variant="secondary">
          Check updates
        </Button>
        <Button disabled={!preview?.canApply || busy !== "idle" || !updateAvailable} loading={busy === "applying"} onClick={handleApply} type="button" variant="primary">
          Apply update
        </Button>
      </div>
    </section>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-status-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function shortSha(value: string | undefined) {
  return value ? value.slice(0, 8) : "Unknown";
}

function sourceUpdateStageLabel(stage: SourceUpdateProgress["stage"]) {
  if (stage === "checking") return "Checking";
  if (stage === "fetching") return "Fetching";
  if (stage === "previewed") return "Preview ready";
  if (stage === "applying") return "Applying";
  if (stage === "installing") return "Installing";
  if (stage === "restarting") return "Restarting";
  return "Failed";
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
