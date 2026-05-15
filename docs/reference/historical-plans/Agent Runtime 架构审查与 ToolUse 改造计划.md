# Agent Runtime 架构审查与 ToolUse 改造计划

## Summary
- 目标：把当前 Agent 生成链路升级为 provider-agnostic runtime，以 Chat Completions 为 v1 公共基线，先支持 DeepSeek/OpenAI-compatible/OpenAI 配置隔离，并建立完整 ToolUse 平台。
- 当前主要问题：ToolUse 只是 prompt hint，没有真实 `tools/tool_calls/tool` 消息循环；`streaming/contextCount/toolCallMode/maxToolCalls` 设置未真实生效；provider 靠 baseURL 字符串推断；DeepSeek 模型预设仍偏旧；聊天历史没有按 Agent 设置进入模型上下文。
- 文档依据：DeepSeek Chat Completion 支持 `tools`、`tool_choice`、`stream`、`thinking`，Tool Call 结果需用 `role: "tool"` 和 `tool_call_id` 送回模型；OpenAI Chat Completions 也以 `tools`/`tool_choice`/`tool_calls` 作为兼容基线。

## Key Changes
- Provider 隔离：
  - 新增 provider profile/adapter 层，统一输出 `createChatCompletion`, `streamChatCompletion`, `normalizeToolChoice`, `normalizeModelSettings`, `supports`。
  - v1 公共请求协议固定为 Chat Completions；DeepSeek/OpenAI/OpenAI-compatible 都从同一 runtime 调用。
  - Settings 不再用 `baseURL.includes("deepseek")` 推断 provider，改为显式 `providerId + baseURL + model + capability flags`。
  - DeepSeek 预设更新为 `deepseek-v4-flash`、`deepseek-v4-pro`，保留 `deepseek-chat`/`deepseek-reasoner` 为兼容 alias，并映射 thinking 模式。

- ToolUse 平台：
  - 将现有 `web_search`、`knowledge_base`、`quick_messages`、`clear_context` 从 prompt hint 升级为 ToolDefinition：包含 name、description、JSON Schema、executor、permission/safety metadata。
  - 第一版执行边界为“本地安全工具优先”：`knowledge_base` 返回本地上下文摘要，`quick_messages` 规范化编辑意图，`clear_context` 控制消息裁剪，`web_search` 保留可插拔占位并明确返回未配置状态。
  - `/api/generate` 改为 Agent run loop：构建 messages -> 调模型 -> 如有 `tool_calls` 执行工具 -> 追加 assistant tool_calls 与 tool result messages -> 继续调用，直到最终 content 或达到 `maxToolCalls`。
  - Tool 事件写入现有 `tool_events`，新增事件类型：`tool_call_requested`、`tool_call_completed`、`tool_call_failed`、`tool_loop_stopped`。

- Streaming：
  - 新增 SSE 生成接口，例如 `/api/generate/stream`，用于流式返回 token delta、tool events、final run metadata。
  - 前端保留当前非流式接口作为 fallback；Agent 设置中的 `streaming` 为 true 时走 SSE。
  - UI 在工具调用期间显示 tool event，而不是只等最终文本。

- 逻辑 Bug 修复：
  - `contextCount` 用于裁剪历史 messages；`clear_context` 打开时只保留当前结构化输入、当前草稿和当前用户指令。
  - chat 模式避免前端乐观插入消息后又被后端刷新造成重复或顺序不一致，统一以后端 thread state 为最终真相。
  - Agent 设置保存后同步 active agent、gallery、runtime resolved card，避免旧 settings 残留。
  - 模型参数按 provider capability 校验：temperature/top_p 不合法、maxTokens 非正数、toolCallMode 与工具列表冲突时返回明确错误或降级说明。

## Public Interfaces / Types
- `SettingsStatus` 增加 `providerId`, `providerLabel`, `capabilities`, `modelAliases?`；`provider` 不再承载 mock/真实混合语义。
- `AgentSettings.model` 增加 `providerId`, `thinkingMode?`, `reasoningEffort?`；保留 `model`, `temperature`, `topP`, `streaming`, `toolCallMode`, `maxToolCalls`。
- `ToolDefinition` 增加 `schema`, `executorKind`, `enabledByDefault`, `requiresExternalConfig`。
- `GenerateResponse` 增加 `events`, `finishReason`, `usage?`；SSE 事件包含 `token`, `tool_event`, `final`, `error` 四类。

## Test Plan
- Typecheck/build：`npm.cmd run typecheck`、`npm.cmd run build`。
- Provider tests：DeepSeek/OpenAI-compatible request payload snapshots，验证 `tools/tool_choice/stream/thinking/max_tokens` 映射。
- Tool loop tests：单工具、多工具、工具报错、超过 `maxToolCalls`、无工具直接回答。
- Context tests：`contextCount=0/5`、`clear_context=true`、chat history 顺序与去重。
- API tests：非流式 `/api/generate` 与 SSE `/api/generate/stream` 都能记录 run、messages、output_versions、tool_events。
- UI smoke tests：Agent 设置保存、切换 provider/model、开启工具、流式生成、工具事件抽屉展示、mock/fallback 状态展示。

## Assumptions
- v1 以 Chat Completions 为公共协议，不使用 OpenAI Responses API。
- 第一版不接入真实外部搜索 API；`web_search` 作为可插拔工具返回“未配置/不可用”的结构化结果。
- DeepSeek strict mode 暂不默认开启；后续只有在 tool schema 全部满足 strict JSON Schema 约束时再加 beta base URL 开关。
- 现有 `.env.local` 保存方式可暂时保留，但 provider 设置应在类型和 UI 上显式隔离，避免后续多供应商扩展被全局 env 绑死。

## References
- [DeepSeek Tool Calls](https://api-docs.deepseek.com/zh-cn/guides/tool_calls)
- [DeepSeek Chat Completion](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)
- [DeepSeek Models & Pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
- [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create-chat-completion)
