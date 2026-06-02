<p align="center">
  <img src="public/assets/ui/brand/opencanvas-icon.png" alt="OpenCanvas 图标" width="96" height="96" />
</p>

# OpenCanvas

**语言：** [English](README.md) | 中文

OpenCanvas 是一个基于 FacetWrite 架构的本地优先 AI 画板工作区。它把类 FigJam 的画板、可编辑写作节点、AgentCard、可配置工具、项目历史、模型 Provider 设置、知识库、记忆能力，以及内部 Agent Runtime sidecar 组合在一起，用于更丰富的 AI 编排。

OpenCanvas 先对标用户熟悉的画板体验：无限画布、节点、连线、悬浮工具栏、对象快捷操作和本地画板文件体验。真正的产品创新点在于其上的 Agent 层：Agent 工具调度 + 人机协作上下文管理。Agent 在行动前应理解当前选区、显式发送的思维链、工作流阶段、Role 节点关系和写入审批状态。

## 产品形态

- **本地优先画板：** Vite/React 前端、Express API、SQLite/本地文件持久化，以及 `.facetwrite/` 下的本地工作区文件。
- **Canvas V2：** 基于 React Flow 的画板，支持 document、note、reference、role 节点；有向边；拖拽/缩放/编辑/删除；右键创建；工作流阶段；Role 建议；会话级 Undo。
- **Agent Runtime：** AgentBackend sidecar 负责 Lead Agent/subagent 编排、ToolUse bridge、运行时仪表盘、知识库、记忆控制和 Provider fallback。
- **Human-in-the-loop 写入：** Agent 发起的 Canvas 改动必须先创建 pending write request。只有用户确认，或同一轮明确写入指令触发审批路径后，Canvas 内容才会改变。
- **画板方向：** OpenCanvas 会逐步演进为类似 PS/Figma 的画板文件，保存节点、连线、资源、工作流状态、Agent 对话、工具事件和写入审批记录。

## 命名

`OpenCanvas` 是外部产品名，应作为 UI 中的主品牌。`FacetWrite` 是技术血缘和内部工程名，用于代码路径、API 边界、本地数据目录、Docker 项目名和技术文档；这些边界暂不重命名，以避免不必要的迁移风险。

## 运行

### 推荐：OpenCanvas + Agent Runtime

本地开发和验收优先使用这个路径。OpenCanvas 运行前端/后端，内部 Agent Runtime 模块通过 Docker Compose 作为主要 AI 执行子系统运行。当前内部 runtime 实现是 AgentBackend。Provider 和 mock fallback 只应作为运行时安全网。

前置条件：

- Docker Desktop 已运行
- Node.js 22+
- 如果 `node_modules/` 缺失，启动器会安装 npm 依赖
- `.env.local` 配置 `AGENT_BACKEND_ENABLED=true` 和 `AGENT_BACKEND_BASE_URL=http://127.0.0.1:2026`
- `modules/agent-runtime/.env` 配置 provider 值和 `FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:8837`

启动全部服务：

```powershell
.\start-facetwrite.ps1
```

或通过 npm：

```bash
npm run dev
```

启动器要求 `AGENT_BACKEND_ENABLED=true`，会启动 Agent Runtime Docker 服务，等待 `http://127.0.0.1:2026/health`，然后启动 OpenCanvas。本地启动有意强绑定 Agent Runtime；Provider/mock fallback 只用于 app 内部运行失败处理，不用于正常启动时跳过 sidecar。

常用地址：

- OpenCanvas UI：默认 `http://127.0.0.1:5173`。如果本地端口不可用，可让 Vite 跑在 `http://127.0.0.1:3000`。
- FacetWrite API health：`http://127.0.0.1:8837/api/health`
- FacetWrite 代理的 Agent Runtime 状态：`http://127.0.0.1:8837/api/agent-runtime/status`
- Agent Runtime sidecar health：`http://127.0.0.1:2026/health`

常用命令：

```bash
npm run agent-runtime:up
npm run agent-runtime:status
npm run agent-runtime:down
```

如果 Docker Hub 不可用，可在 `modules/agent-runtime/.env` 配置 FacetWrite 拥有的 runtime 镜像覆盖：

```bash
NODE_IMAGE=<可访问的 node:22-alpine 镜像或本地 tag>
PYTHON_IMAGE=<可访问的 python:3.12-slim-bookworm 镜像或本地 tag>
DOCKER_CLI_IMAGE=<可访问的 docker:cli 镜像或本地 tag>
UV_IMAGE=<可访问的 ghcr.io/astral-sh/uv:0.7.20 镜像或本地 tag>
```

### 低层服务调试

```bash
npm install
npm run dev:services
```

这只启动 Vite 前端和 FacetWrite API，仅用于窄范围前后端调试。正常本地启动应使用 `npm run dev` 或 `.\start-facetwrite.ps1`，确保 Agent Runtime 先启动并完成检查。

## 验收检查

- `/api/agent-runtime/status` 返回 `reachable:true`、`authState:"authenticated"` 和 `runtimeProvider:"agent-backend"`。
- Summary 或 Blog 生成返回 `provider:"agent-backend"`。
- 主 runtime 检查期间没有 `agent_backend_runtime_failed` 事件。
- `canvas_write` 只创建 pending write proposal/request；Canvas 内容只有在用户明确确认后才通过审批路径改变。

## 技术文档

- [项目简介](docs/PROJECT_BRIEF.md)
- [架构](docs/ARCHITECTURE.md)
- [Canvas](docs/CANVAS.md)
- [UI 资产](docs/UI_ASSETS.md)
- [API](docs/API.md)
- [数据库](docs/DATABASE.md)
- [Agent 与工具](docs/AGENT.md)
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
