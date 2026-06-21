# Skill Management

FacetWrite treats Skills as private runtime instructions, not user-visible chat content. The UI can list, group, enable, disable, and move Skills, but the server remains responsible for loading `SKILL.md` bodies and injecting them into the run context.

## Sources And Layout

The public Skill catalog is built from two roots:

- Project Skills: `skills/public/**/SKILL.md`
- Agent Runtime Skills: `modules/agent-runtime/skills/public/**/SKILL.md`

Project Skills are manageable. Agent Runtime Skills are read-only because they belong to the runtime package and may be updated with the runtime.

The default project folder is:

```text
skills/public/default/<skill>/SKILL.md
```

The UI displays this folder as `Default skills` in English and `默认技能` in Chinese. Legacy one-level project Skills such as `skills/public/summary/SKILL.md` are temporarily categorized as `default`, but new project Skills should use the folder layout.

Additional folders are created directly under `skills/public`:

```text
skills/public/research/<skill>/SKILL.md
skills/public/writing/<skill>/SKILL.md
```

Adding a new top-level folder does not require frontend category code. The loader derives folder metadata from the filesystem and returns it through the catalog API.

## Catalog Contract

`GET /api/skills/catalog` returns the full read model:

```ts
type SkillCatalogResponse = {
  skills: SkillCatalogItem[];
  folders: SkillFolderItem[];
};

type SkillCatalogItem = {
  id: string;
  name: string;
  description: string;
  allowedTools: string[];
  folderId: string;
  folderName: string;
  folderPath: string;
  relativePath: string;
  source: "project" | "agent-runtime";
  manageable: boolean;
  status: "available";
};

type SkillFolderItem = {
  folderId: string;
  folderName: string;
  folderPath: string;
  source: "project" | "agent-runtime";
  manageable: boolean;
  skillCount: number;
};
```

`id` currently equals the Skill `name`. Consumers should accept `id`, `name`, or `relativePath` when matching user selections because persisted Agent settings may contain older refs.

## Management API

All management operations return a fresh `{ skills, folders }` catalog response. Frontend code should apply that response directly instead of guessing the filesystem state.

| Method | Path | Body | Behavior |
| --- | --- | --- | --- |
| `POST` | `/api/skills/folders` | `{ folderId }` | Create a project folder under `skills/public/<folderId>`. |
| `PATCH` | `/api/skills/folders/:folderId` | `{ folderId }` | Rename a project folder by moving its directory. |
| `DELETE` | `/api/skills/folders/:folderId` | none | Delete an empty project folder. |
| `PATCH` | `/api/skills/:skillRef/folder` | `{ folderId }` | Move a project Skill directory into another project folder. |

Validation rules:

- `folderId` must match lowercase letters, numbers, and dashes: `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- `default` is protected. It can receive moved Skills, but it cannot be renamed or deleted.
- Non-empty folders cannot be deleted.
- Runtime Skills cannot be moved.
- Resolved paths must stay inside `skills/public`.
- Hidden directories and path traversal are rejected by the folder id and resolved-path checks.
- Existing target directories are not overwritten.

## Per-Message Enable And Disable

Agent settings remain the durable default Skill source. The workspace also supports one-message overrides:

- `transientSkillRefs`: non-default Skills enabled for the next message.
- `disabledSkillRefs`: Agent/default Skills disabled for the next message.

The backend builds the effective run Skills in this order:

```text
Agent default skillRefs
  + transientSkillRefs
  - disabledSkillRefs
  + server-forced Plan Skills
```

Plan-forced Skills are server policy and cannot be disabled by the UI. Per-message choices are cleared after a successful send, Agent switch, or Thread switch. They are not persisted to Agent settings, Project state, or Thread defaults.

## Frontend Surfaces

`src/features/workspace/components/SkillFolderPicker.tsx` has two modes:

- Compact selector: used in the right collaboration composer. It groups Skills by folder and exposes only per-message enable/disable.
- Management panel: used from the bottom Canvas toolbar `Skills` button. It has three independently scrollable columns: folders, Skills, and Skill details.

The management panel can:

- Create a project folder.
- Rename a manageable project folder.
- Delete an empty manageable project folder.
- Move a project Skill to another project folder.
- Show Skill details, including source, folder, path, and allowed tools.
- Toggle the Skill for the next message.

The panel intentionally does not edit `SKILL.md` content. Editing Skill bodies should be designed as a separate capability because it changes prompt/runtime behavior, not only catalog organization.

## Backend Ownership

`server/skillLoader.ts` owns Skill discovery and filesystem mutation:

- `loadPublicSkills()` recursively scans both public roots.
- `loadPublicSkillFolders()` returns folder metadata, including empty project folders.
- `createProjectSkillFolder()`, `renameProjectSkillFolder()`, `deleteProjectSkillFolder()`, and `moveProjectSkillToFolder()` are the only project Skill folder write helpers.

`server/routes/catalogRoutes.ts` exposes those operations. Routes should not duplicate path validation or construct Skill filesystem paths directly.

`server/services/agentDefinitionService.ts` converts loaded Skills into the public catalog shape and validates Agent settings against available Skill ids, names, and relative paths.

## Safety Notes

Skill file bodies are private runtime context. Catalog and management responses must never return the body of `SKILL.md`, prompt sections, internal messages, tool arguments, or raw runtime state.

Runtime Skills are read-only in this UI. If users later need to customize a Runtime Skill, add an explicit "copy to project Skills" flow rather than writing into `modules/agent-runtime`.

Because Skill instructions can change model behavior, folder management should stay limited to classification and directory movement. Editing Skill content should require its own validation, preview, and test path.

## Verification

Use these checks after changing Skill loading, folder management, or per-message Skill selection:

```powershell
npm.cmd run typecheck
npm.cmd run test:frontend
npm.cmd test
npx.cmd playwright test tests/e2e/canvas.spec.ts -g "skill folder"
```

Relevant tests:

- `server/skillLoader.test.ts`: recursive loading, legacy default categorization, folder CRUD, safe path validation, project Skill moves, runtime read-only behavior.
- `tests/frontend/composerSkillPicker.test.ts`: frontend wiring, request payloads, and management component structure.
- `tests/e2e/canvas.spec.ts`: toolbar Skill panel, folder creation, moving `summary`, scrolling runtime Skills, and streaming request payload overrides.
