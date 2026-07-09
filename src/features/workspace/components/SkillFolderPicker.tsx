import { useEffect, useMemo, useState } from "react";
import type { SkillCatalogItem, SkillFolderItem } from "../../agents/types";

export type SkillFolderPickerProps = {
  activeSkillRefs: string[];
  disabledSkillRefs: string[];
  enabledSkillRefs: string[];
  folders?: SkillFolderItem[];
  locale: "en" | "zh";
  skills: SkillCatalogItem[];
  status: "idle" | "loading" | "ready" | "error";
  onCreateFolder?: (folderId: string) => Promise<void>;
  onDeleteFolder?: (folderId: string) => Promise<void>;
  onMoveSkill?: (skill: SkillCatalogItem, folderId: string) => Promise<void>;
  onRenameFolder?: (folderId: string, nextFolderId: string) => Promise<void>;
  onToggleSkill: (skill: SkillCatalogItem, enabled: boolean) => void;
};

export function SkillFolderPicker({
  activeSkillRefs,
  disabledSkillRefs,
  enabledSkillRefs,
  folders = [],
  locale,
  skills,
  status,
  onCreateFolder,
  onDeleteFolder,
  onMoveSkill,
  onRenameFolder,
  onToggleSkill
}: SkillFolderPickerProps) {
  const groupedSkills = useMemo(() => groupSkills(skills, folders), [folders, skills]);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(["default"]));
  const managementEnabled = Boolean(onCreateFolder && onDeleteFolder && onMoveSkill && onRenameFolder);

  useEffect(() => {
    if (groupedSkills.some((group) => group.folderId === "default")) {
      setOpenFolders((current) => new Set([...current, "default"]));
    }
  }, [groupedSkills]);

  if (status === "loading" || status === "idle") {
    return <p className="skill-folder-message">{copy(locale, "loading")}</p>;
  }
  if (status === "error") {
    return <p className="skill-folder-message">{copy(locale, "error")}</p>;
  }
  if (groupedSkills.length === 0) {
    return <p className="skill-folder-message">{copy(locale, "empty")}</p>;
  }

  if (managementEnabled) {
    return (
      <SkillFolderManager
        activeSkillRefs={activeSkillRefs}
        disabledSkillRefs={disabledSkillRefs}
        enabledSkillRefs={enabledSkillRefs}
        folders={groupedSkills}
        locale={locale}
        onCreateFolder={onCreateFolder!}
        onDeleteFolder={onDeleteFolder!}
        onMoveSkill={onMoveSkill!}
        onRenameFolder={onRenameFolder!}
        onToggleSkill={onToggleSkill}
      />
    );
  }

  return (
    <div className="skill-folder-picker">
      {groupedSkills.map((group) => (
        <details
          className="skill-folder-group"
          key={group.folderId}
          open={openFolders.has(group.folderId)}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setOpenFolders((current) => {
              const next = new Set(current);
              if (open) next.add(group.folderId);
              else next.delete(group.folderId);
              return next;
            });
          }}
        >
          <summary>
            <span>{folderLabel(locale, group.folderId, group.folderName)}</span>
            <small>{group.skills.length}</small>
          </summary>
          <div className="skill-folder-list">
            {group.skills.map((skill) => {
              const defaultSkill = isSkillRefSelected(skill, activeSkillRefs);
              const checked = defaultSkill
                ? !isSkillRefSelected(skill, disabledSkillRefs)
                : isSkillRefSelected(skill, enabledSkillRefs);
              return (
                <label className="skill-folder-row" key={skill.id}>
                  <span>
                    <strong>{skill.name}</strong>
                    <em>{skill.description}</em>
                    <small>
                      {defaultSkill
                        ? checked ? copy(locale, "defaultEnabled") : copy(locale, "disabled")
                        : checked ? copy(locale, "enabled") : copy(locale, "available")}
                    </small>
                    {arrayValues(skill.allowedTools).length ? <b>{arrayValues(skill.allowedTools).join(", ")}</b> : null}
                  </span>
                  <input
                    aria-label={`${checked ? copy(locale, "disable") : copy(locale, "enable")} ${skill.name}`}
                    checked={checked}
                    onChange={(event) => onToggleSkill(skill, event.target.checked)}
                    type="checkbox"
                  />
                </label>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}

export function isSkillRefSelected(skill: Pick<SkillCatalogItem, "id" | "name" | "relativePath">, refs: string[]) {
  return refs.some((ref) => ref === skill.id || ref === skill.name || ref === skill.relativePath);
}

function SkillFolderManager({
  activeSkillRefs,
  disabledSkillRefs,
  enabledSkillRefs,
  folders,
  locale,
  onCreateFolder,
  onDeleteFolder,
  onMoveSkill,
  onRenameFolder,
  onToggleSkill
}: {
  activeSkillRefs: string[];
  disabledSkillRefs: string[];
  enabledSkillRefs: string[];
  folders: SkillFolderGroup[];
  locale: "en" | "zh";
  onCreateFolder: (folderId: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onMoveSkill: (skill: SkillCatalogItem, folderId: string) => Promise<void>;
  onRenameFolder: (folderId: string, nextFolderId: string) => Promise<void>;
  onToggleSkill: (skill: SkillCatalogItem, enabled: boolean) => void;
}) {
  const [selectedFolderId, setSelectedFolderId] = useState(folders[0]?.folderId ?? "default");
  const selectedFolder = folders.find((folder) => folder.folderId === selectedFolderId) ?? folders[0];
  const [selectedSkillId, setSelectedSkillId] = useState(selectedFolder?.skills[0]?.id ?? "");
  const selectedSkill = selectedFolder?.skills.find((skill) => skill.id === selectedSkillId) ?? selectedFolder?.skills[0];
  const [folderDraft, setFolderDraft] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!folders.some((folder) => folder.folderId === selectedFolderId)) {
      setSelectedFolderId(folders[0]?.folderId ?? "default");
    }
  }, [folders, selectedFolderId]);

  useEffect(() => {
    if (!selectedFolder) return;
    setRenameDraft(selectedFolder.folderId === "default" ? "" : selectedFolder.folderId);
    if (!selectedFolder.skills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId(selectedFolder.skills[0]?.id ?? "");
    }
  }, [selectedFolder, selectedSkillId]);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy(locale, "operationFailed"));
    } finally {
      setBusy("");
    }
  };

  const createFolder = () => {
    const next = folderDraft.trim();
    if (!next) return;
    void run("create", async () => {
      await onCreateFolder(next);
      setFolderDraft("");
      setSelectedFolderId(next);
    });
  };

  const renameFolder = () => {
    if (!selectedFolder?.manageable) return;
    const next = renameDraft.trim();
    if (!next || next === selectedFolder.folderId) return;
    void run("rename", async () => {
      await onRenameFolder(selectedFolder.folderId, next);
      setSelectedFolderId(next);
    });
  };

  const deleteFolder = () => {
    if (!selectedFolder?.manageable) return;
    void run("delete", async () => {
      await onDeleteFolder(selectedFolder.folderId);
      setSelectedFolderId("default");
    });
  };

  return (
    <div className="skill-manager" data-testid="skill-folder-manager">
      <aside className="skill-manager-folders" aria-label={copy(locale, "folders")}>
        <div className="skill-manager-section-header">
          <strong>{copy(locale, "folders")}</strong>
          <small>{folders.length}</small>
        </div>
        <form className="skill-manager-create" onSubmit={(event) => {
          event.preventDefault();
          createFolder();
        }}>
          <input
            aria-label={copy(locale, "newFolder")}
            disabled={Boolean(busy)}
            onChange={(event) => setFolderDraft(event.target.value)}
            placeholder="research"
            value={folderDraft}
          />
          <button disabled={Boolean(busy) || !folderDraft.trim()} type="submit">{copy(locale, "create")}</button>
        </form>
        <div className="skill-manager-folder-list" role="list">
          {folders.map((folder) => (
            <button
              className={folder.folderId === selectedFolder?.folderId ? "is-active" : ""}
              key={folder.folderId}
              onClick={() => setSelectedFolderId(folder.folderId)}
              type="button"
            >
              <span>{folderLabel(locale, folder.folderId, folder.folderName)}</span>
              <small>{folder.skills.length}</small>
              {!folder.manageable ? <em>{copy(locale, folder.source === "agent-runtime" ? "readOnly" : "locked")}</em> : null}
            </button>
          ))}
        </div>
      </aside>

      <section className="skill-manager-list" aria-label={copy(locale, "skills")}>
        <div className="skill-manager-section-header">
          <strong>{folderLabel(locale, selectedFolder.folderId, selectedFolder.folderName)}</strong>
          <small>{selectedFolder.skills.length}</small>
        </div>
        <div className="skill-manager-folder-tools">
          <input
            aria-label={copy(locale, "renameFolder")}
            disabled={!selectedFolder.manageable || Boolean(busy)}
            onChange={(event) => setRenameDraft(event.target.value)}
            value={renameDraft}
          />
          <button disabled={!selectedFolder.manageable || Boolean(busy) || !renameDraft.trim()} onClick={renameFolder} type="button">{copy(locale, "rename")}</button>
          <button disabled={!selectedFolder.manageable || Boolean(busy) || selectedFolder.skills.length > 0} onClick={deleteFolder} type="button">{copy(locale, "delete")}</button>
        </div>
        <div className="skill-manager-skill-list">
          {selectedFolder.skills.map((skill) => {
            const defaultSkill = isSkillRefSelected(skill, activeSkillRefs);
            const checked = defaultSkill
              ? !isSkillRefSelected(skill, disabledSkillRefs)
              : isSkillRefSelected(skill, enabledSkillRefs);
            return (
              <div
                className={skill.id === selectedSkill?.id ? "skill-manager-skill is-selected" : "skill-manager-skill"}
                key={skill.relativePath}
              >
                <button className="skill-manager-skill-main" onClick={() => setSelectedSkillId(skill.id)} type="button">
                  <span>
                    <strong>{skill.name}</strong>
                    <em>{skill.description}</em>
                    <small>{skill.manageable ? copy(locale, "projectSkill") : copy(locale, "runtimeSkill")}</small>
                  </span>
                </button>
                <input
                  aria-label={`${checked ? copy(locale, "disable") : copy(locale, "enable")} ${skill.name}`}
                  checked={checked}
                  onChange={(event) => onToggleSkill(skill, event.target.checked)}
                  type="checkbox"
                />
              </div>
            );
          })}
          {selectedFolder.skills.length === 0 ? <p className="skill-folder-message">{copy(locale, "emptyFolder")}</p> : null}
        </div>
      </section>

      <aside className="skill-manager-detail" aria-label={copy(locale, "details")}>
        <div className="skill-manager-section-header">
          <strong>{copy(locale, "details")}</strong>
        </div>
        {selectedSkill ? (
          <>
            <h3>{selectedSkill.name}</h3>
            <p>{selectedSkill.description}</p>
            <dl>
              <dt>{copy(locale, "source")}</dt>
              <dd>{selectedSkill.source === "project" ? copy(locale, "projectSkill") : copy(locale, "runtimeSkill")}</dd>
              <dt>{copy(locale, "folder")}</dt>
              <dd>{folderLabel(locale, selectedSkill.folderId, selectedSkill.folderName)}</dd>
              <dt>{copy(locale, "path")}</dt>
              <dd>{selectedSkill.relativePath}</dd>
              <dt>{copy(locale, "tools")}</dt>
              <dd>{arrayValues(selectedSkill.allowedTools).length ? arrayValues(selectedSkill.allowedTools).join(", ") : copy(locale, "none")}</dd>
              <dt>{copy(locale, "execution")}</dt>
              <dd>{selectedSkill.executionMode === "sandbox" ? copy(locale, "sandbox") : copy(locale, "instruction")}</dd>
              <dt>{copy(locale, "risk")}</dt>
              <dd>{riskLabel(locale, selectedSkill.riskLevel)}</dd>
              <dt>{copy(locale, "runtimeTools")}</dt>
              <dd>{arrayValues(selectedSkill.runtimeTools).length ? arrayValues(selectedSkill.runtimeTools).join(", ") : copy(locale, "none")}</dd>
              {arrayValues(selectedSkill.requiresEnv).length ? (
                <>
                  <dt>{copy(locale, "requiresEnv")}</dt>
                  <dd>{arrayValues(selectedSkill.requiresEnv).join(", ")}</dd>
                </>
              ) : null}
              {selectedSkill.upstream ? (
                <>
                  <dt>{copy(locale, "upstream")}</dt>
                  <dd>{selectedSkill.upstream.repo}/{selectedSkill.upstream.path}</dd>
                </>
              ) : null}
            </dl>
            <label className="skill-manager-move">
              <span>{copy(locale, "moveTo")}</span>
              <select
                disabled={!selectedSkill.manageable || Boolean(busy)}
                onChange={(event) => {
                  const nextFolderId = event.target.value;
                  void run("move", () => onMoveSkill(selectedSkill, nextFolderId));
                }}
                value={selectedSkill.folderId}
              >
                {folders.filter((folder) => folder.source === "project").map((folder) => (
                  <option key={folder.folderId} value={folder.folderId}>{folderLabel(locale, folder.folderId, folder.folderName)}</option>
                ))}
              </select>
            </label>
            {!selectedSkill.manageable ? <p className="skill-manager-note">{copy(locale, "readOnlyReason")}</p> : null}
          </>
        ) : (
          <p className="skill-folder-message">{copy(locale, "selectSkill")}</p>
        )}
        {message ? <p className="skill-manager-error" role="alert">{message}</p> : null}
      </aside>
    </div>
  );
}

type SkillFolderGroup = SkillFolderItem & { skills: SkillCatalogItem[] };

function groupSkills(skills: SkillCatalogItem[], folders: SkillFolderItem[]) {
  const groups = new Map<string, SkillFolderGroup>();
  for (const folder of folders) {
    groups.set(folder.folderId, { ...folder, skills: [] });
  }
  for (const skill of skills) {
    const folderId = skill.folderId || "default";
    const folderName = skill.folderName || folderId;
    const group = groups.get(folderId) ?? {
      folderId,
      folderName,
      folderPath: skill.folderPath || folderId,
      source: skill.source || "project",
      manageable: Boolean(skill.manageable) && folderId !== "default",
      skillCount: 0,
      skills: []
    };
    group.skills.push(skill);
    group.skillCount = group.skills.length;
    groups.set(folderId, group);
  }
  return Array.from(groups.values()).sort((left, right) => {
    if (left.folderId === "default") return -1;
    if (right.folderId === "default") return 1;
    return (left.folderName || left.folderId).localeCompare(right.folderName || right.folderId);
  });
}

function folderLabel(locale: "en" | "zh", folderId: string, folderName: string) {
  if (folderId === "default") return locale === "zh" ? "\u9ed8\u8ba4\u6280\u80fd" : "Default skills";
  return folderName;
}

function riskLabel(locale: "en" | "zh", risk: SkillCatalogItem["riskLevel"]) {
  const labels = {
    en: { low: "Low", medium: "Medium", high: "High" },
    zh: { low: "\u4f4e", medium: "\u4e2d", high: "\u9ad8" }
  } as const;
  return labels[locale][risk ?? "low"];
}

function arrayValues(value: string[] | undefined) {
  return Array.isArray(value) ? value : [];
}

function copy(locale: "en" | "zh", key: "available" | "create" | "defaultEnabled" | "delete" | "details" | "disable" | "disabled" | "empty" | "emptyFolder" | "enable" | "enabled" | "error" | "execution" | "folder" | "folders" | "instruction" | "loading" | "locked" | "moveTo" | "newFolder" | "none" | "operationFailed" | "path" | "projectSkill" | "readOnly" | "readOnlyReason" | "rename" | "renameFolder" | "requiresEnv" | "risk" | "runtimeSkill" | "runtimeTools" | "sandbox" | "selectSkill" | "skills" | "source" | "tools" | "upstream") {
  const values = {
    en: {
      available: "Available for this message",
      create: "Create",
      defaultEnabled: "Default enabled",
      delete: "Delete",
      details: "Details",
      disable: "Disable",
      disabled: "Disabled for this message",
      empty: "No skills available",
      emptyFolder: "No skills in this folder",
      enable: "Enable",
      enabled: "Enabled for this message",
      execution: "Execution",
      folder: "Folder",
      folders: "Folders",
      instruction: "Instruction only",
      error: "Unable to load skills",
      loading: "Loading skills...",
      locked: "Locked",
      moveTo: "Move to folder",
      newFolder: "New folder",
      none: "None",
      operationFailed: "Skill folder operation failed",
      path: "Path",
      projectSkill: "Project skill",
      readOnly: "Read-only",
      readOnlyReason: "Agent Runtime skills are read-only. Move or edit project skills only.",
      rename: "Rename",
      renameFolder: "Rename folder",
      requiresEnv: "Required env",
      risk: "Risk",
      runtimeSkill: "Runtime skill",
      runtimeTools: "Runtime tools",
      sandbox: "Runtime sandbox",
      selectSkill: "Select a skill to view details",
      skills: "Skills",
      source: "Source",
      tools: "Allowed tools",
      upstream: "Upstream"
    },
    zh: {
      available: "\u53ef\u7528\u4e8e\u672c\u6b21\u6d88\u606f",
      create: "\u65b0\u5efa",
      defaultEnabled: "\u9ed8\u8ba4\u542f\u7528",
      delete: "\u5220\u9664",
      details: "\u8be6\u60c5",
      disable: "\u7981\u7528",
      disabled: "\u672c\u6b21\u5df2\u7981\u7528",
      empty: "\u6682\u65e0\u53ef\u7528\u6280\u80fd",
      emptyFolder: "\u8be5\u6587\u4ef6\u5939\u6682\u65e0\u6280\u80fd",
      enable: "\u542f\u7528",
      enabled: "\u672c\u6b21\u542f\u7528",
      execution: "\u6267\u884c\u6a21\u5f0f",
      folder: "\u6587\u4ef6\u5939",
      folders: "\u6587\u4ef6\u5939",
      instruction: "\u4ec5\u6307\u4ee4",
      error: "\u65e0\u6cd5\u52a0\u8f7d\u6280\u80fd\u5217\u8868",
      loading: "\u6b63\u5728\u52a0\u8f7d\u6280\u80fd...",
      locked: "\u9501\u5b9a",
      moveTo: "\u79fb\u52a8\u5230\u6587\u4ef6\u5939",
      newFolder: "\u65b0\u5efa\u6587\u4ef6\u5939",
      none: "\u65e0",
      operationFailed: "\u6280\u80fd\u6587\u4ef6\u5939\u64cd\u4f5c\u5931\u8d25",
      path: "\u8def\u5f84",
      projectSkill: "\u9879\u76ee\u6280\u80fd",
      readOnly: "\u53ea\u8bfb",
      readOnlyReason: "Agent Runtime \u6280\u80fd\u4e3a\u53ea\u8bfb\uff0c\u53ea\u80fd\u79fb\u52a8\u9879\u76ee\u6280\u80fd\u3002",
      rename: "\u91cd\u547d\u540d",
      renameFolder: "\u91cd\u547d\u540d\u6587\u4ef6\u5939",
      requiresEnv: "\u9700\u8981\u73af\u5883\u53d8\u91cf",
      risk: "\u98ce\u9669",
      runtimeSkill: "\u8fd0\u884c\u65f6\u6280\u80fd",
      runtimeTools: "\u8fd0\u884c\u65f6\u5de5\u5177",
      sandbox: "\u8fd0\u884c\u65f6\u6c99\u7bb1",
      selectSkill: "\u9009\u62e9\u4e00\u4e2a\u6280\u80fd\u67e5\u770b\u8be6\u60c5",
      skills: "\u6280\u80fd",
      source: "\u6765\u6e90",
      tools: "\u5141\u8bb8\u5de5\u5177",
      upstream: "\u4e0a\u6e38"
    }
  } as const;
  return values[locale][key];
}
