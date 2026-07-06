export type ShellProjectThumbnailRequest = {
  x: number;
  y: number;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
};

export type ShellProjectThumbnailResult = {
  imageBase64: string;
  mimeType: string;
};

export type SourceUpdateChangedFile = {
  status: string;
  path: string;
  previousPath?: string;
};

export type SourceUpdatePreview = {
  mode: "source-git";
  branch: string;
  headSha: string;
  remote: string;
  upstream?: string;
  targetRef: string;
  targetSha: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  changedFiles: SourceUpdateChangedFile[];
  dependencyChanges: {
    root: boolean;
    runtime: boolean;
  };
  protectedChanges: SourceUpdateChangedFile[];
  blockers: string[];
  canApply: boolean;
  lastCheckedAt: string;
};

export type SourceUpdateProgress = {
  stage: "checking" | "fetching" | "previewed" | "applying" | "installing" | "restarting" | "failed";
  payload?: unknown;
  at: string;
};

export type OpenCanvasShellBridge = {
  onStage?: (callback: (payload: unknown) => void) => void;
  onSourceUpdateProgress?: (callback: (payload: SourceUpdateProgress) => void) => () => void;
  sourceUpdatePreview?: (request?: { refresh?: boolean }) => Promise<SourceUpdatePreview>;
  sourceUpdateApply?: (request: { expectedHead: string; installDependencies?: boolean }) => Promise<{ applied: boolean; targetSha: string }>;
  captureProjectThumbnail?: (request: ShellProjectThumbnailRequest) => Promise<ShellProjectThumbnailResult | undefined>;
};

declare global {
  interface Window {
    openCanvasShell?: OpenCanvasShellBridge;
  }
}

export function getOpenCanvasShell() {
  if (typeof window === "undefined") return undefined;
  return window.openCanvasShell;
}
