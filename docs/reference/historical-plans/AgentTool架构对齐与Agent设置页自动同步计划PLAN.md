# Agent/Tool 架构对齐与 Agent 设置页自动同步计划

## Summary

目标是把 FacetWrite 的业务层、Agent 层、Tool/Skill 层彻底分清：业务层只表达“写作工作流和画布状态”，Agent 层负责 Prompt/Model/Skill/Tool 编排，Tool/Skill catalog 作为单一事实来源，前端 Agent 设置页自动从后端 catalog 渲染，不再手写工具列表。

同时为 DeepSeek 后续能力预留 Provider capability 层。DeepSeek 对话前缀续写要求最后一条 message 为 `assistant` 且 `prefix: true`，并使用 `https://api.deepseek.com/beta` base URL；这应作为 Provider 能力配置，而不是写死在页面或生成逻辑里。参考：[DeepSeek 对话前缀续写文档](https://api-docs.deepseek.com/zh-cn/guides/chat_prefix_completion)。

## Key Changes

- **Agent/业务边界**
  - 业务层保留：Thread、Project、Canvas、写入申请、用户选择状态。
  - Agent 层新增 `AgentDefinitionService`：统一解析 AgentCard、默认 settings、已保存 settings、可用 tools、可用 skills、provider capabilities。
  - 生成流程只接收 resolved agent runtime config，不直接猜测默认工具或补 settings。

- **Tool/Skill 自动对齐**
  - 后端新增只读接口：
    - `GET /api/tools/catalog`
    - `GET /api/skills/catalog`
    - `GET /api/agent-cards/:id/runtime-config`
  - `runtime-config` 返回 Agent 设置页需要的完整配置：agent card、merged settings、available tools、enabled tools、missing/deprecated tools、available skills、provider capabilities。
  - `AgentSettingsView` 不再硬编码 `["web_search", ...]`，改为根据 `runtime-config.availableTools` 渲染。
  - 保存 Agent settings 时，后端执行 normalize：
    - 新增 tool 默认使用 catalog 的 `enabledByDefault`
    - 已删除 tool 标记为 `deprecatedToolRefs`，不参与运行
    - AgentCard 不允许的 tool 不可保存为 enabled
    - `canvas_write` 始终显示为高风险、需要审批

- **Provider Capability**
  - 扩展 `ProviderCapabilities`，加入：
    - `chatPrefixCompletion`
    - `betaBaseURL`
    - `supportsAssistantPrefix`
  - 扩展 `AgentSettings.model`，加入可选 `responseMode`：
    - `"normal"` 默认
    - `"prefix_completion"` 仅在 provider 支持时可用
  - `providerRuntime.normalizeChatRequest` 负责把 prefix completion 转成 provider wire shape：最后一条 assistant message 带 `prefix: true`，并使用 beta base URL。
  - UI 只显示 provider 支持的能力；DeepSeek 可显示 prefix completion，OpenAI-compatible 默认不显示。

- **编码与当前遗留问题**
  - 先修复当前仍存在的 mojibake：`server/agentCards.ts`、`server/services/generationService.ts`、`src/features/agents/AgentSettingsView.tsx` 中的中文字符串。
  - 后续新增 Agent/Tool/Skill 必须通过 catalog，不再在组件内写死中文标签或 tool id。

## Implementation Steps

1. **Catalog API**
   - 新增 `server/routes/catalogRoutes.ts`，注册 `/api/tools/catalog` 和 `/api/skills/catalog`。
   - Tool catalog 返回 `name/group/label/description/riskLevel/requiresApproval/enabledByDefault/requiresExternalConfig`，不返回 executor 私有实现。
   - Skill catalog 从现有 `skills/` 或 `skillLoader` 可识别来源生成 MVP 列表；若暂时只有 refs，也返回 `id/name/description/status`。

2. **Agent Runtime Config**
   - 在 `AgentRuntimeAdapter` 增加 `getAgentRuntimeConfig(agentCardId)`。
   - 返回 merged settings、available tool definitions、tool policies、missing/deprecated refs、provider profile。
   - `saveAgentSettings` 调用 `normalizeAgentSettings(base, saved, catalog)`，保证新增 Tool/Skill 自动补齐。

3. **Frontend Agent Settings**
   - 新增 `fetchAgentRuntimeConfig(agentCardId)`。
   - `AgentSettingsView` 选择 Agent 后拉 runtime-config。
   - Tools tab 根据 catalog 渲染，并显示风险/审批/外部配置状态。
   - Skills tab 或 Prompt tab 的 `skillRefs` 从 available skills 中选择，不再只是逗号字符串输入；MVP 可先保留文本输入，但旁边显示 unknown skill warning。

4. **Provider Capability / DeepSeek Prefix**
   - 扩展 provider profile 和 model settings 类型。
   - `createOpenAIChatClient` 支持 per-request baseURL override，或在 service 层按 responseMode 创建 beta client。
   - `normalizeChatRequest` 增加 prefix completion 分支。
   - UI 在 Model tab 增加 response mode selector；仅 provider 支持时显示。

5. **Tests**
   - Tool catalog API：新增 tool 后 Agent settings 自动出现。
   - Agent settings normalize：新 tool 默认补齐、废弃 tool 不运行、不允许越权启用非 AgentCard tool。
   - Canvas write policy：仍然只能创建 pending request。
   - DeepSeek prefix completion：生成 request 时最后 message 为 assistant prefix，baseURL 使用 beta。
   - Frontend typecheck/build 必须通过。

## Assumptions

- 现阶段不开放真正的前端新建 Agent，只先把架构准备好：Agent settings 能自动消费 catalog，后续创建 Agent 时复用同一套 runtime-config。
- 不改变现有生成、Canvas、Project API URL；新增 catalog/runtime-config 是增量 API。
- `storage.ts` 暂不深拆，等 Agent/Tool/Provider 边界稳定后再拆 repository。
- Provider 能力以后端 profile 为准，前端只展示后端返回的 capabilities，避免 UI 和 provider wire protocol 漂移。
