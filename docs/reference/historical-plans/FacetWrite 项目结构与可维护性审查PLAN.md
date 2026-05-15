# FacetWrite 项目结构与可维护性审查

## 1. 总体评价

当前项目已经具备清晰的产品雏形：前端按 `features/*` 分区，后端有 Agent、Provider、Tool、Storage 等模块，整体方向是对的。主要问题不是“没有架构”，而是几个核心文件承担了太多职责，导致后续接入更多 Agent、Tool、权限策略、知识库和真实模型时会变得难维护。

最需要优先处理的是：密钥管理风险、后端入口过重、前端根组件过重、Tool 定义重复、Agent 配置与权限策略耦合、API 返回格式不统一、中文文案编码损坏。

## 2. 主要问题，按严重程度排序

### P0：本地存在明文密钥文件，安全风险高

涉及文件：

- [.env.local](F:/.FinalProject/.env.local)
- [API-Key.txt](F:/.FinalProject/API-Key.txt)
- [.gitignore](F:/.FinalProject/.gitignore)

原因：

- 工作区根目录存在明文 API key。
- `.gitignore` 已忽略 `.env.*` 和 `API-Key.txt`，这是好的，但本地文件仍容易被复制、截图、误上传或被 AI 工具读取。
- [server/index.ts](F:/.FinalProject/server/index.ts:298) 提供 `/api/settings/save`，会把 key 写回 `.env.local`，属于高敏感操作。

建议：

- 删除 `API-Key.txt`，只保留 `.env.local` 或改为 `.env.local.example` 模板。
- 新增 `docs/SECURITY.md`，说明 key 存储、轮换、不要上传。
- `/api/settings/save` 增加本地模式限制、写入确认、敏感字段不回显。
- 如果 key 已经暴露过，应立即轮换。

### P1：后端入口文件过大，API、配置、Agent 运行、SSE、mock fallback 混在一起

涉及文件：

- [server/index.ts](F:/.FinalProject/server/index.ts:1)，约 601 行

原因：

- Express 路由、settings API、generate API、SSE、Provider 校验、env 写入、Agent 执行、mock fallback 都在一个文件。
- `request.body as GenerateRequest`、`request.body as SettingsPayload` 直接断言，缺少 runtime validation。
- API 响应风格不统一：有 `{ ok: true }`、`{ error }`、裸业务对象、`ok:false` 但 HTTP 仍为 200。

建议：

- 拆成 `server/app.ts`、`server/routes/*`、`server/services/*`。
- 新增统一响应工具：`ok(data)`、`fail(code, message, details?)`。
- 新增请求校验层：先用轻量手写 validator，后续可换 zod。
- `generateAndRecord` 移到 `server/services/generationService.ts`。

### P1：Agent/Tool 权限边界不够清楚，`canvas_write` 被强制开启

涉及文件：

- [server/index.ts](F:/.FinalProject/server/index.ts:365)
- [server/toolRegistry.ts](F:/.FinalProject/server/toolRegistry.ts:1)
- [server/toolRuntime.ts](F:/.FinalProject/server/toolRuntime.ts:1)
- [server/agentCards.ts](F:/.FinalProject/server/agentCards.ts:43)

原因：

- `generateAndRecord` 里强制 `{ ...payload.toolState, canvas_write: true }`，前端/Agent 设置无法真正关闭 Canvas 写入能力。
- `AgentSettings["tools"]` 类型没有包含 `canvas_write`，但默认设置会从 `card.toolRefs` 塞进去。
- `toolRegistry.ts` 和 `toolRuntime.ts` 各维护一份 Tool 定义，容易漂移。
- Tool 的能力、UI 展示、prompt hint、运行时 schema、权限策略还没有统一来源。

建议：

- 新增 `server/tools/catalog.ts`，统一定义 Tool 元数据、schema、默认开关、风险等级、是否需要确认。
- 新增 `server/tools/policies.ts`，集中管理 `requiresApproval`、`canAutoRun`、`requiresExternalConfig`。
- `canvas_write` 保持“可请求，不可直接写入”，但不要在服务端无条件强制开启。
- Agent settings 类型必须包含所有 ToolRef，前后端共享或镜像一致。

### P1：前端根组件承担了应用状态机、API 编排、业务逻辑和视图组装

涉及文件：

- [src/app/App.tsx](F:/.FinalProject/src/app/App.tsx:1)，约 438 行

原因：

- `App.tsx` 管理 view、agent、thread、generation、canvas、projects、trash、streaming、tool events、localStorage。
- 业务数据流写在页面根组件里，新的开发者很难判断“线程状态刷新”“画布刷新”“生成请求”“项目刷新”分别属于谁。
- streaming tool event 在组件里做临时类型转换，说明数据边界还没有稳定。

建议：

- 拆出 hooks：
  - `useAgentCards`
  - `useThreadState`
  - `useGeneration`
  - `useCanvas`
  - `useProjects`
  - `useAppNavigation`
- `App.tsx` 只保留路由/页面编排。
- 生成、聊天、恢复线程、刷新项目这些流程移到 hooks 或 service。

### P1：中文文案出现乱码，信息架构可读性受损

涉及文件：

- [src/app/App.tsx](F:/.FinalProject/src/app/App.tsx:18)
- [src/features/start/StartView.tsx](F:/.FinalProject/src/features/start/StartView.tsx:1)
- [src/features/tasks/HomeView.tsx](F:/.FinalProject/src/features/tasks/HomeView.tsx:1)
- [src/shared/AppSidebar.tsx](F:/.FinalProject/src/shared/AppSidebar.tsx:1)
- [server/agentCards.ts](F:/.FinalProject/server/agentCards.ts:1)

原因：

- 多处中文显示为 mojibake。
- `src/features/i18n/translations.ts` 已经存在正常 i18n 结构，但很多组件仍直接写 `locale === "zh" ? ... : ...`。
- Agent 卡片中文也写在 server 数据里，和前端 i18n 来源不一致。

建议：

- 所有 UI 文案迁入 `src/features/i18n/translations.ts`。
- Agent 卡片文案可以保留在服务端，但需要保证 UTF-8，并考虑独立 `server/agents/cards/*.ts` 或 JSON。
- 删除组件内散落的中英文三元表达式。

### P2：Storage 文件过大，数据库 schema、迁移、Repository、业务规则混合

涉及文件：

- [server/storage.ts](F:/.FinalProject/server/storage.ts:1)，约 752 行

原因：

- SQLite 初始化、schema migration、thread/message/run/canvas/write request/agent settings 都在一个类里。
- Canvas write approval 逻辑和数据库访问耦合。
- 后续加知识库、权限、审计日志时会继续膨胀。

建议：

- 拆成：
  - `server/db/schema.ts`
  - `server/db/client.ts`
  - `server/repositories/threadRepository.ts`
  - `server/repositories/canvasRepository.ts`
  - `server/repositories/agentSettingsRepository.ts`
- Canvas 写入审批规则放到 `server/services/canvasWriteService.ts`。

### P2：API client 重复，缺少统一错误处理和响应解包

涉及文件：

- [src/features/agents/agentClient.ts](F:/.FinalProject/src/features/agents/agentClient.ts:1)
- [src/features/canvas/canvasClient.ts](F:/.FinalProject/src/features/canvas/canvasClient.ts:1)
- [src/features/generation/generationClient.ts](F:/.FinalProject/src/features/generation/generationClient.ts:1)
- [src/features/settings/settingsClient.ts](F:/.FinalProject/src/features/settings/settingsClient.ts:1)

原因：

- 每个 client 都手写 `fetch`、状态判断、`response.json() as Type`。
- 没有统一的 `ApiError`、超时、JSON parse 错误、错误 message 解包。
- 前端类型完全相信后端返回。

建议：

- 新增 `src/shared/apiClient.ts`：
  - `apiGet<T>()`
  - `apiPost<T>()`
  - `apiPut<T>()`
  - `apiDelete<T>()`
  - 统一处理 `{ error }`、HTTP status、JSON 解析失败。
- 后端统一响应格式后，前端再统一解包。

### P2：样式文件过大，功能样式、布局样式、组件样式混在一起

涉及文件：

- [src/app/styles.css](F:/.FinalProject/src/app/styles.css:1)，约 2207 行

原因：

- 所有页面和组件样式集中在一个 CSS 文件。
- 工作区、首页、Agent 设置、项目、Canvas、Drawer 等样式缺少边界。
- 后续重构 UI 容易误伤。

建议：

- 短期不急着全拆，先按页面加注释分区。
- 中期拆为：
  - `src/app/tokens.css`
  - `src/app/layout.css`
  - `src/features/home/home.css`
  - `src/features/workspace/workspace.css`
  - `src/features/agents/agent-settings.css`
  - `src/features/projects/projects.css`

### P2：类型总体严格，但运行时边界不完整

涉及文件：

- [tsconfig.app.json](F:/.FinalProject/tsconfig.app.json:1)
- [tsconfig.node.json](F:/.FinalProject/tsconfig.node.json:1)
- [server/index.ts](F:/.FinalProject/server/index.ts:268)
- [server/providerRuntime.ts](F:/.FinalProject/server/providerRuntime.ts:188)

原因：

- TypeScript `strict` 已开启，这是优点。
- `any` 不多，主要用 `unknown`，方向也对。
- 风险在于大量 `as SomeType` 发生在 API 边界、OpenAI SDK 边界、JSON parse 边界。

建议：

- 保留 `unknown`，但给 API payload 增加 validator。
- Provider SDK 的 `request as never` 封装在 provider adapter 内，不要扩散。
- 前后端共享 DTO 类型可放到 `src/shared` 不合适，建议新建根级 `shared/` 或 `server/contracts/` 后由前端镜像导入，当前 Vite/NodeNext 结构下先保持复制但加测试。

## 3. 推荐目标目录结构

```text
F:/.FinalProject
  src/
    app/
      App.tsx
      routes.ts
      styles/
        tokens.css
        layout.css
    shared/
      apiClient.ts
      components/
      icons/
      types/
    features/
      home/
      workspace/
        hooks/
        components/
        workspace.css
      agents/
        hooks/
        components/
        types.ts
      canvas/
        hooks/
        canvasClient.ts
      generation/
        hooks/
        generationClient.ts
      projects/
      settings/
      knowledge/
      i18n/

  server/
    app.ts
    index.ts
    config/
      env.ts
      providerConfig.ts
    routes/
      healthRoutes.ts
      agentRoutes.ts
      threadRoutes.ts
      canvasRoutes.ts
      settingsRoutes.ts
      generationRoutes.ts
    services/
      generationService.ts
      agentService.ts
      canvasWriteService.ts
      settingsService.ts
    agents/
      agentCards.ts
      defaults.ts
      promptBuilder.ts
      skillLoader.ts
    tools/
      catalog.ts
      runtime.ts
      policies.ts
    providers/
      providerRuntime.ts
      openAICompatibleClient.ts
    db/
      client.ts
      schema.ts
    repositories/
      threadRepository.ts
      canvasRepository.ts
      runRepository.ts
      agentSettingsRepository.ts
    contracts/
      api.ts
      generation.ts
      agents.ts
```

## 4. 前端信息架构

当前前端大致是一个 local-first Agent writing workspace，信息架构可以描述为：

- Start：产品入口与语言切换，对应 [StartView.tsx](F:/.FinalProject/src/features/start/StartView.tsx:1)
- Home：工作起点，包含 prompt 输入、快捷动作、最近项目、常用 Agent，对应 [HomeView.tsx](F:/.FinalProject/src/features/tasks/HomeView.tsx:1)
- Workspace：核心写作工作台，对应 [WorkspaceView.tsx](F:/.FinalProject/src/features/workspace/WorkspaceView.tsx:1)
  - 左侧：AgentCard 结构化输入
  - 中间：Document Canvas
  - 右侧：AI Collaboration Drawer，包含聊天、Tool 状态、Canvas 写入申请
  - 底部：Context / Prompt Preview
- Projects：线程、项目、回收站管理
- Agent Settings：Agent 模型、Prompt、知识、工具、快捷消息、记忆设置
- Knowledge Settings：知识库/上下文设置入口
- Project Settings：Provider、API key、Base URL、Model、健康检查

建议的信息架构命名：

```text
Start
Home
Projects
Agents
Knowledge
Workspace
  Agent Inputs
  Canvas
  Collaboration
  Context Preview
Settings
  Provider Settings
  Agent Settings
  Knowledge Settings
```

## 5. 功能架构

当前功能架构可以分为 7 层：

- UI Shell：`App`、Sidebar、Topbar、Start/Home/Workspace 页面
- Agent 配置层：AgentCard、AgentSettings、Prompt、SkillRefs、ToolRefs
- Workspace 状态层：当前 thread、canvas nodes、write requests、output versions、tool events
- Generation 层：普通生成、流式生成、chat instruction、mock fallback
- Tool 层：knowledge_base、quick_messages、clear_context、canvas_write、web_search placeholder
- Persistence 层：SQLite threads/messages/runs/output_versions/canvas/write_requests/settings
- Provider 层：DeepSeek/OpenAI/OpenAI-compatible，模型别名、tool choice、thinking 参数

建议把未来维护心智模型固定为：

```text
User intent
 -> AgentCard + structured input
 -> PromptBuilder + Skills + Tool policy
 -> Provider runtime / Tool runtime
 -> Run record + Canvas write request
 -> UI refresh thread state
```

## 6. 应拆分、移动、重命名的文件

优先拆分：

- [server/index.ts](F:/.FinalProject/server/index.ts:1)
  - 路由拆到 `server/routes/*`
  - 生成流程拆到 `server/services/generationService.ts`
  - settings/env 写入拆到 `server/services/settingsService.ts`
- [server/storage.ts](F:/.FinalProject/server/storage.ts:1)
  - DB schema、repositories、canvas write service 分开
- [src/app/App.tsx](F:/.FinalProject/src/app/App.tsx:1)
  - 拆 hooks：thread、canvas、generation、projects、agents
- [src/app/styles.css](F:/.FinalProject/src/app/styles.css:1)
  - 按页面/组件拆 CSS
- [server/agentCards.ts](F:/.FinalProject/server/agentCards.ts:1)
  - 类型、默认设置、AgentCard 数据拆开

建议重命名：

- `src/features/tasks/HomeView.tsx` -> `src/features/home/HomeView.tsx`
- `ProjectSettingsPanel` 如果只管 Provider，应改为 `ProviderSettingsPanel`
- `agentClient.ts` 里同时管 projects/thread/agent，建议拆为 `agentClient.ts`、`threadClient.ts`、`projectClient.ts`

## 7. 需要新增的 service、types、hooks、tools、policies

新增 service：

- `generationService`
- `settingsService`
- `agentService`
- `canvasWriteService`
- `toolExecutionService`

新增 hooks：

- `useAgentCards`
- `useThreadState`
- `useCanvas`
- `useGeneration`
- `useProjects`
- `useProviderSettings`

新增 types/contracts：

- `ApiSuccess<T>`
- `ApiFailure`
- `ApiResponse<T>`
- `GenerateRequestDto`
- `GenerateResponseDto`
- `SettingsStatusDto`
- `ToolPolicy`
- `ToolRiskLevel`

新增 Tool/Policy：

- `toolCatalog`
- `toolPolicies`
- `requireApproval(toolName, operation)`
- `isToolEnabledForAgent(agentCard, settings, toolState)`

## 8. 分阶段重构计划

### Phase 1：安全与稳定边界

- 清理 `API-Key.txt`，补 `.env.local.example`。
- 修复乱码中文文案。
- 给 settings save / validate 增加更明确的本地安全提示。
- 统一 API 错误格式，不大规模改业务逻辑。

### Phase 2：后端拆分

- 把 `server/index.ts` 拆成 routes + services。
- 把 env/provider settings 逻辑独立出来。
- 把 `generateAndRecord` 移入 generation service。
- 保持现有 URL 不变，避免前端联动过大。

### Phase 3：Tool 与 Agent 策略重构

- 合并 `toolRegistry.ts` 和 `toolRuntime.ts` 的重复定义。
- 新增 Tool policy，明确哪些 tool 可自动执行，哪些必须用户批准。
- 修正 `AgentSettings.tools` 类型，包含 `canvas_write`。
- 移除服务端无条件强制开启 `canvas_write` 的逻辑，改为 policy 控制。

### Phase 4：前端状态拆分

- 从 `App.tsx` 抽出 hooks。
- 拆 API client，统一错误处理。
- 保持 UI 结构不变，只降低组件职责。
- 把 Home 从 `features/tasks` 移到 `features/home`。

### Phase 5：Storage 与测试补强

- 拆 `storage.ts` 为 db/repositories/services。
- 给 API response、Tool policy、Canvas approval、mock fallback 增加测试。
- 保持 SQLite schema 兼容，不做破坏性迁移。

## 9. 现在不要动的地方

- 不要重写 UI 视觉系统。当前问题主要是结构，不是视觉。
- 不要一次性替换 SQLite 或引入复杂 ORM。
- 不要马上引入大型状态管理库；先用 hooks 分层即可。
- 不要改变现有 API URL，先稳定响应格式和内部结构。
- 不要移除 mock fallback，它对本地开发有价值，但要让状态更透明。
- 不要把所有类型强行做成前后端共享包，当前项目体量可以先用 contracts + 测试控制漂移。

## 10. 适合交给 AI 编程助手执行的 TODO 清单

1. 审查并清理本地密钥文件：删除 `API-Key.txt`，新增 `.env.local.example` 和 `docs/SECURITY.md`。
2. 修复所有 UI 与 AgentCard 中文乱码，优先迁移组件内中文到 `translations.ts`。
3. 新增 `src/shared/apiClient.ts`，替换现有 feature client 中重复的 fetch/error/json 逻辑。
4. 在后端新增统一 API response helper，并逐步统一 `{ data, error }` 或 `{ ok, data, error }` 格式。
5. 将 `server/index.ts` 的 settings routes 拆到 `server/routes/settingsRoutes.ts` 和 `server/services/settingsService.ts`。
6. 将 `server/index.ts` 的 generation 逻辑拆到 `server/routes/generationRoutes.ts` 和 `server/services/generationService.ts`。
7. 合并 `toolRegistry.ts` 与 `toolRuntime.ts` 的 Tool 元数据，新增 `server/tools/catalog.ts`。
8. 新增 `server/tools/policies.ts`，定义 `canvas_write` 必须用户批准，`web_search` 需要外部配置。
9. 修正 `AgentSettings.tools` 类型，加入 `canvas_write`，并让 Agent Settings UI 能显示/解释该工具。
10. 移除 `generateAndRecord` 中无条件强制 `canvas_write: true`，改用 Tool policy 决定。
11. 从 `App.tsx` 抽出 `useAgentCards`、`useThreadState`、`useCanvas`、`useGeneration`、`useProjects`。
12. 将 `src/features/tasks/HomeView.tsx` 移动到 `src/features/home/HomeView.tsx`，更新引用。
13. 给 API payload 增加 runtime validation，先覆盖 settings save/validate 和 generate。
14. 拆分 `storage.ts`：先拆 schema 初始化，再拆 canvas/thread repositories。
15. 补测试：API response shape、Tool policy、Canvas write approval、settings save 不回显 key、generate mock fallback。

