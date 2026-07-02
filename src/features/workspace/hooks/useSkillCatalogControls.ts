import { useCallback, useEffect, useState } from "react";
import type { AgentCard, SkillCatalogItem, SkillFolderItem } from "../../agents/types";
import { createSkillFolder, deleteSkillFolder, fetchSkillCatalogState, moveSkillToFolder, renameSkillFolder } from "../../agents/agentClient";
import { isSkillRefSelected } from "../components/SkillFolderPicker";

type UseSkillCatalogControlsOptions = {
  activeAgent: AgentCard;
  currentThreadId?: string;
};

export function useSkillCatalogControls({ activeAgent, currentThreadId = "" }: UseSkillCatalogControlsOptions) {
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogItem[]>([]);
  const [skillFolders, setSkillFolders] = useState<SkillFolderItem[]>([]);
  const [skillCatalogStatus, setSkillCatalogStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [enabledSkillRefs, setEnabledSkillRefs] = useState<string[]>([]);
  const [disabledSkillRefs, setDisabledSkillRefs] = useState<string[]>([]);

  const requestSkillCatalog = useCallback(() => {
    if (skillCatalogStatus === "loading" || skillCatalogStatus === "ready") return;
    setSkillCatalogStatus("loading");
    fetchSkillCatalogState()
      .then((catalog) => {
        setSkillCatalog(catalog.skills);
        setSkillFolders(catalog.folders);
        setSkillCatalogStatus("ready");
      })
      .catch(() => {
        setSkillCatalog([]);
        setSkillFolders([]);
        setSkillCatalogStatus("error");
      });
  }, [skillCatalogStatus]);

  const applySkillCatalogState = useCallback((catalog: { skills: SkillCatalogItem[]; folders: SkillFolderItem[] }) => {
    setSkillCatalog(catalog.skills);
    setSkillFolders(catalog.folders);
    setSkillCatalogStatus("ready");
  }, []);

  const handleCreateSkillFolder = useCallback(async (folderId: string) => {
    applySkillCatalogState(await createSkillFolder(folderId));
  }, [applySkillCatalogState]);

  const handleRenameSkillFolder = useCallback(async (folderId: string, nextFolderId: string) => {
    applySkillCatalogState(await renameSkillFolder(folderId, nextFolderId));
  }, [applySkillCatalogState]);

  const handleDeleteSkillFolder = useCallback(async (folderId: string) => {
    applySkillCatalogState(await deleteSkillFolder(folderId));
  }, [applySkillCatalogState]);

  const handleMoveSkillToFolder = useCallback(async (skill: SkillCatalogItem, folderId: string) => {
    applySkillCatalogState(await moveSkillToFolder(skill.name, folderId));
  }, [applySkillCatalogState]);

  const clearSkillOverrides = useCallback(() => {
    setEnabledSkillRefs([]);
    setDisabledSkillRefs([]);
  }, []);

  useEffect(() => {
    clearSkillOverrides();
  }, [activeAgent.id, clearSkillOverrides, currentThreadId]);

  const toggleMessageSkill = useCallback((skill: SkillCatalogItem, enabled: boolean) => {
    const skillRef = skill.id;
    const defaultSkill = isSkillRefSelected(skill, activeAgent.skillRefs);
    if (defaultSkill) {
      setDisabledSkillRefs((current) => enabled ? removeRef(current, skillRef) : addRef(current, skillRef));
      setEnabledSkillRefs((current) => removeRef(current, skillRef));
    } else {
      setEnabledSkillRefs((current) => enabled ? addRef(current, skillRef) : removeRef(current, skillRef));
      setDisabledSkillRefs((current) => removeRef(current, skillRef));
    }
  }, [activeAgent.skillRefs]);

  return {
    skillCatalog,
    skillFolders,
    skillCatalogStatus,
    enabledSkillRefs,
    disabledSkillRefs,
    requestSkillCatalog,
    handleCreateSkillFolder,
    handleRenameSkillFolder,
    handleDeleteSkillFolder,
    handleMoveSkillToFolder,
    clearSkillOverrides,
    toggleMessageSkill
  };
}

function addRef(current: string[], value: string) {
  return current.includes(value) ? current : [...current, value];
}

function removeRef(current: string[], value: string) {
  return current.filter((item) => item !== value);
}
