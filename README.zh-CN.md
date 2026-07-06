<p align="center">
  <img src="public/assets/ui/brand/opencanvas-icon.png" alt="OpenCanvas 图标" width="96" height="96" />
</p>

# OpenCanvas

## 近期画布能力

- 底部浮动工具栏已接入选择、拖动画布、便签/文本、文档、Role、自由箭头、基础形状、轻量表格、本地资源和选区 Agent 操作。
- 自由箭头、形状、表格与资源保存为独立视觉对象，不会混入思维链或 Role 语义关系。
- 本地资源支持图片预览，以及 PDF、DOCX、TXT、MD 文件卡片，文件保存在当前线程的 `user-data/uploads/` 目录。

**语言：** [English](README.md) | 中文

OpenCanvas 是一个基于 FacetWrite 架构的本地优先 AI 画板工作区。它把类 FigJam 的画板、可编辑写作节点、AgentCard、可配置工具、项目历史、模型 Provider 设置、知识库、记忆能力，以及内部 LangGraph Agent Runtime Gateway 组合在一起，用于更丰富的 AI 编排。

OpenCanvas 先对标用户熟悉的画板体验：无限画布、节点、连线、悬浮工具栏、对象快捷操作和本地画板文件体验。真正的产品创新点在于其上的 Agent 层：Agent 工具调度 + 人机协作上下文管理。Agent 在行动前应理解当前选区、显式发送的思维链、工作流阶段、Role 节点关系和写入审批状态。

## 产品形态

- **本地优先画板：** Vite/React 前端、Express API、SQLite/本地文件持久化，以及 `.facetwrite/` 下的本地工作区文件。
- **Canvas V2：** 基于 React Flow 的画板，支持 document、note、reference、role 节点；有向边；拖拽/缩放/编辑/删除；右键创建；工作流阶段；Role 建议；会话级 Undo。
- **Agent Runtime：** LangGraph-compatible AgentBackend Gateway 负责 Lead Agent/subagent 编排、ToolUse bridge、运行时仪表盘、知识库、记忆控制和明确的运行时/模型诊断。
- **Human-in-the-loop 写入：** Agent 发起的 Canvas 改动必须先创建 pending write request。只有用户确认，或同一轮明确写入指令触发审批路径后，Canvas 内容才会改变。
- **画板方向：** OpenCanvas 会逐步演进为类似 PS/Figma 的画板文件，保存节点、连线、资源、工作流状态、Agent 对话、工具事件和写入审批记录。

## 命名

`OpenCanvas` 是外部产品名，应作为 UI 中的主品牌。`FacetWrite` 是技术血缘和内部工程名，用于代码路径、API 边界、本地数据目录、Docker 项目名和技术文档；这些边界暂不重命名，以避免不必要的迁移风险。

## 运行

### 推荐：OpenCanvas + 本地 Agent Runtime

本地开发和验收优先使用项目托管的 Python Gateway。双击 `start-opencanvas-shell.vbs` 会强制使用 `local` 模式，启动 App Shell、本地 Agent Runtime、FacetWrite API 和前端；该入口不会启动 Docker Desktop，也不会执行 Docker 命令。Gateway 暴露 LangGraph-compatible runs API，默认入口是 `lead_agent`，由 `modules/agent-runtime/backend/langgraph.json` 注册并由 `deerflow.agents:make_lead_agent` 实现。Agent Runtime 仍是 Skills、MCP、Memory、Web Search、子 Agent 和 FacetWrite Bridge 的唯一真实执行路径。

前置条件：

- Node.js 22+
- `uv`，Python 3.12 由 `uv` 管理
- 如果 `node_modules/` 缺失，启动器会安装 npm 依赖
- 已在项目设置中保存并启用至少一个带 API Key 的聊天模型

推荐启动入口：

```powershell
.\start-opencanvas-shell.vbs
```

或通过 npm：

```bash
npm run dev
```

本地入口固定使用 `AGENT_RUNTIME_MODE=local`，但 Runtime 端口由启动器动态选择，除非显式设置 `AGENT_RUNTIME_PORT`。实际端口从 `/api/agent-runtime/status` 或 `modules/agent-runtime/logs/agent-runtime-local.json` 读取；`127.0.0.1:8001` 只是直接低层调试 fallback。Docker 仅通过显式的 `agent-runtime:docker:*` 命令启用；正常生成失败会返回明确错误，不会静默保存 Mock 回复。

常用地址：

- OpenCanvas UI：`http://127.0.0.1:17776`
- FacetWrite API health：`http://127.0.0.1:17777/api/health`
- FacetWrite 代理的 Agent Runtime 状态：`http://127.0.0.1:17777/api/agent-runtime/status`
- 本地 Agent Runtime health：从 `/api/agent-runtime/status` 或 `modules/agent-runtime/logs/agent-runtime-local.json` 读取实际端口后访问 `/health`

常用命令：

```bash
npm run agent-runtime:up
npm run agent-runtime:status
npm run agent-runtime:down
npm run agent-runtime:doctor
```

显式 Docker 隔离模式保留为可选路径：

```bash
npm run agent-runtime:docker:up
npm run agent-runtime:docker:up:local-images
npm run agent-runtime:docker:status
npm run agent-runtime:docker:down
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 通过 `start-facetwrite.ps1` 启动托管本地开发栈。 |
| `npm run shell:dev` | 打开 Electron 开发 Shell。 |
| `npm run dev:services` | 仅启动 Vite 和 Express API，用于窄范围调试。 |
| `npm run agent-runtime:up` | 启动或刷新项目托管的本地 Agent Runtime Gateway。 |
| `npm run agent-runtime:status` | 读取本地 Runtime ownership/status metadata。 |
| `npm run agent-runtime:down` | 只停止项目拥有的本地 Runtime 进程。 |
| `npm run agent-runtime:doctor` | 检查本地 Runtime 前置条件。 |
| `npm run typecheck` | 运行 TypeScript 项目检查。 |
| `npm test` | 运行 server 与轻量 frontend Node 测试。 |
| `npm run test:frontend` | 运行 frontend-focused Node 测试。 |
| `npm run shell:test` | 运行 Electron shell 单元测试。 |
| `npm run test:e2e` | 运行 Playwright 测试。 |
| `npm run test:e2e:canvas` | 运行 Canvas Playwright 测试。 |
| `npm run build` | TypeScript 检查并构建 Vite 应用。 |
| `npm run preview` | 本地预览生产构建。 |

### 低层服务调试

```bash
npm install
npm run dev:services
```

这只启动 Vite 前端和 FacetWrite API，仅用于窄范围前后端调试。正常本地启动应使用 `start-opencanvas-shell.vbs`，确保本地 Agent Runtime 先启动并完成检查。

## 验收检查

- `/api/agent-runtime/status` 返回 `reachable:true`、`deploymentMode:"local"`、`sandboxProvider:"LocalSandboxProvider"` 和 `runtimeProvider:"agent-backend"`。
- Summary 或 Blog 生成返回 `provider:"agent-backend"`。
- 主 runtime 检查期间没有 `agent_backend_runtime_failed` 事件。
- `canvas_write` 只创建 pending write proposal/request；Canvas 内容只有在用户明确确认后才通过审批路径改变。

运行与真实点击入口相同的无 Docker 完整验收：

```powershell
npm.cmd run acceptance:local-runtime
```

## 技术文档

- [项目简介](docs/PROJECT_BRIEF.md)
- [架构](docs/ARCHITECTURE.md)
- [Canvas](docs/CANVAS.md)
- [UI 资产](docs/UI_ASSETS.md)
- [API](docs/API.md)
- [数据库](docs/DATABASE.md)
- [Agent 与工具](docs/AGENT.md)
- [Agent Runtime Runbook](docs/AGENT_RUNTIME_RUNBOOK.md)
- [决策记录](docs/DECISIONS.md)
- [重构日志](docs/REFACTOR_LOG.md)
- [安全](docs/SECURITY.md)
- [参考资料归档](docs/reference/README.md)

## 路线图

1. **画板文件模型：** 将每个 project/thread 视为 OpenCanvas 画板文件，聚合节点、连线、工作流状态、资源、Agent 对话、工具事件、写入审批和版本元数据。
2. **FigJam 风格画板工具：** 扩展悬浮工具栏和对象快捷栏，支持选择、拖动画布、文本、便签/卡片、文档、形状、表格/栅格、连接线、Role 节点、资源和未来插入工具。
3. **Agent 可调用画板工具：** 将当前 `canvas_write` 扩展为更细的画板工具意图，例如创建节点、追加内容、连接节点、提出布局整理建议、创建 Role 建议、总结选中链路。
4. **本地资源与导出：** 在数据模型稳定后加入画板资源记录、快照/版本历史，以及便携 `.opencanvas` 导入/导出。
5. **线上协作：** 只有在本地画板模型和 Agent 工具边界稳定后，再加入账户/空间、同步、presence、评论、权限和分享链接。

## 产品原则

- 先本地闭环，再云同步。
- 先复用现有 Canvas API、存储、Agent Runtime adapter 和 Tool policy，再创建新边界。
- Agent 行为必须可检查、尽可能可撤销，并在破坏性操作上走审批。
- 画板 UI 优先服务真实创作流程：快速工具入口、可靠选区、干净快捷操作，以及没有隐藏上下文惊喜。
