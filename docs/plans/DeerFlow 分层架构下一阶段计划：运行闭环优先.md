# DeerFlow 分层架构下一阶段计划：运行闭环优先

## Summary

目标是把 FacetWrite + DeerFlow 从“适配层已写好”推进到“真实 DeerFlow sidecar 可运行、可观测、可回退”。下一步重点放在运行层和契约验证，不急着扩展复杂 ToolUse。

## Key Changes

- **运行层：先解决 DeerFlow sidecar**
  - 优先走 Docker/容器化 DeerFlow sidecar，避免 Windows 原生 `uv` cache 权限问题。
  - 若 Docker 因 `C:\Users\123\.docker\config.json` 权限失败，再回退到修复 `uv` 本地 cache。
  - 成功标准：`/health` 可访问，FacetWrite `/api/deerflow/status` 返回 `enabled:true`、`reachable:true`。

- **适配层：验证 FacetWrite ↔ DeerFlow 契约**
  - 用一个 Task 卡片跑通 `/api/runs/stream`。
  - 确认 DeerFlow stream 事件能被 `server/deerflow/client.ts` 正确解析。
  - 确认生成结果 provider 为 `deerflow`。
  - 确认 run events 至少记录 DeerFlow runtime metadata 或 `deerflow_*` 事件。

- **产品层：保持 Human-in-the-loop 边界**
  - 不让 DeerFlow 直接写 FacetWrite SQLite。
  - 不开放 DeerFlow 写配置 UI。
  - Canvas 写入仍只走 pending approval。
  - 前端只展示 DeerFlow 状态、Skill 数量、MCP server 概览。

- **文档层：记录运行事实**
  - 新建或更新一个 live validation 记录。
  - 如果 sidecar 成功，记录启动方式、端口、环境变量、验证结果。
  - 如果失败，记录具体阻塞点和下一步处理。

## Test Plan

- `npm.cmd run typecheck`
- `npm.cmd test`
- 手动验证：
  - 启动 DeerFlow sidecar
  - 设置 `DEERFLOW_ENABLED=true`
  - 打开项目设置面板，确认 DeerFlow online
  - 用一个 Task 卡片生成
  - 确认结果来自 `deerflow`
  - 确认 TypeScript fallback 仍可关闭 DeerFlow 后正常工作

## Assumptions

- 下一步优先 Docker sidecar，因为它更符合“DeerFlow 作为独立智能运行层”的分层设计。
- 暂不迁移数据库 schema。
- 暂不全量桥接 FacetWrite tools 到 DeerFlow。
- DeerFlow 稳定跑通前，不做更远的 AgentToolUse 架构升级。
