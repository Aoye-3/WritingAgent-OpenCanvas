# Cherry Studio 架构调研报告

调研对象：[CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio)

本地参考源码：`reference/sources/cherry-studio/`

拉取快照：`353340ea55bb29880fa9b8a1fc0ec1ab908c104a`

调研重点：知识库 RAG、Embedding/向量库/文件处理、多模型 API provider 集成，以及可供 FacetWrite 后续知识库和上下文机制参考的工程模式。

## 1. 项目概览

Cherry Studio 是一个 Electron + Vite + TypeScript 桌面端 AI 客户端。它的工程结构是典型桌面应用分层：

- `src/main/`：Electron 主进程、IPC、文件系统、KnowledgeService、API server、模型调用桥接。
- `src/renderer/`：React UI、Redux store、设置页、知识库页面、会话流式渲染。
- `packages/`：内部包，例如 AI SDK provider 扩展、AI core、表格扩展等。
- `src/main/apiServer/`：提供本地 HTTP API，部分能力复用主进程服务。

从 `package.json` 看，项目使用 `electron-vite` 构建，多平台通过 `electron-builder` 发布；模型调用层大量使用 Vercel AI SDK provider 包，同时保留 OpenAI-compatible fallback。

对 FacetWrite 的启发：Cherry Studio 的多能力桌面端规模很大，但它仍然把“主进程能力边界”和“渲染进程产品状态”分开。FacetWrite 目前是 Web + Express，更适合保留清晰的 server/runtime 边界，而不是照搬 Electron IPC 模型。

## 2. 知识库 RAG 实现

核心代码位置：

- `src/main/services/KnowledgeService.ts`
- `src/main/knowledge/embedjs/`
- `src/main/knowledge/preprocess/`
- `src/main/knowledge/reranker/`
- `src/renderer/src/services/KnowledgeService.ts`
- `src/renderer/src/store/knowledge.ts`
- `src/renderer/src/pages/knowledge/`

### 2.1 数据模型

Cherry Studio 的知识库类型主要定义在 `src/renderer/src/types/knowledge.ts`：

- `KnowledgeBase`：包含 `id`、`name`、embedding `model`、`dimensions`、`items`、`documentCount`、`chunkSize`、`chunkOverlap`、`threshold`、`rerankModel`、`preprocessProvider`。
- `KnowledgeItem`：支持 `file`、`url`、`note`、`sitemap`、`directory`、`memory`、`video`。
- `KnowledgeBaseParams`：运行时参数，包含 embedding API client、rerank API client、chunk 配置、预处理 provider。
- `KnowledgeSearchResult`：返回 `pageContent`、`score`、`metadata`。

这个模型的优点是把“知识库配置”和“检索运行参数”拆开。UI 维护 `KnowledgeBase`，真正调用主进程搜索时转成 `KnowledgeBaseParams`，从而可以在运行时注入实际 provider API key、base URL 和 provider 特殊路径。

### 2.2 创建与存储

`src/main/services/KnowledgeService.ts` 使用 `@cherrystudio/embedjs` 的 `RAGApplicationBuilder`：

- embedding model：自定义 `Embeddings` 包装。
- vector database：`@cherrystudio/embedjs-libsql` 的 `LibSqlDb`。
- 每个知识库通过 `id` 映射到本地 `KnowledgeBase` 存储目录。
- 内存里缓存 `ragApplications` 和 `dbInstances`，避免每次搜索重复初始化。
- 删除时先清理内存实例，再删除本地向量库目录；如果文件句柄占用导致删除失败，会记录到 `knowledge_pending_delete.json`，下次启动清理。

官方文档也说明 Cherry Studio 的知识库数据本地保存，文档导入后会复制到应用数据目录，文本切分后交给 embedding 模型，问答时检索相关片段并注入大模型上下文；向量数据库使用 libSQL/Turso 方案。

### 2.3 导入与加载器

知识来源覆盖面很完整：

- 文件：`file`
- 目录批量导入：`directory`
- URL：`url`
- sitemap：`sitemap`
- 笔记：`note`
- 视频：`video`

`src/main/knowledge/embedjs/loader/index.ts` 根据扩展名选择 loader：

- `.pdf`、`.csv`、`.doc`、`.docx`、`.pptx`、`.xlsx`、`.md` 走通用 `LocalPathLoader`。
- `.odt`、`.ods`、`.odp` 走 OpenDocument loader。
- `.epub` 走 EPUB loader。
- `.draftsexport` 走 Drafts 导出 loader。
- `.html` / `.htm` 先按文本读取，再走 WebLoader。
- `.json` 优先 JSON loader，解析失败回退文本 loader。
- 其他类型默认走 `TextLoader`。

这是非常值得借鉴的地方：文件类型分发在 loader 层集中处理，而不是散落在 UI 或业务流程里。

### 2.4 预处理

`src/main/knowledge/preprocess/` 提供 PDF/文档预处理 provider：

- Doc2x
- Mineru
- Mistral
- OpenMineru
- PaddleOCR

主流程只在 `base.preprocessProvider` 存在且文件为 PDF 时触发预处理；先检查是否已有缓存结果，再执行 provider 解析，完成后通知 UI。失败时抛出明确错误，由上层标记 item 处理失败。

对 FacetWrite 的启发：知识库导入应预留“预处理 provider”扩展点，尤其是扫描 PDF、OCR、多模态文档，不应把解析策略写死在第一版导入函数里。

### 2.5 队列与并发控制

Cherry Studio 没有简单地把所有文件同时塞给 embedding，而是做了一个轻量队列：

- `MAXIMUM_WORKLOAD = 80MB`
- `MAXIMUM_PROCESSING_ITEM_COUNT = 30`
- 每个 loader task 带 `evaluateTaskWorkload`
- 队列调度时只启动未超过 workload 和 item count 的任务
- 目录导入会拆成多个文件任务，并通过 IPC 通知目录处理进度

这对 FacetWrite 很有参考价值。知识库导入是高成本任务，应该有任务状态、进度、失败重试、并发上限，而不是普通 request/response。

### 2.6 检索、阈值与 rerank

渲染层 `src/renderer/src/services/KnowledgeService.ts` 负责完整问答检索编排：

1. 根据 embedding 模型最大上下文截断 query，避免 embedding 请求超限。
2. 从知识库配置生成 `KnowledgeBaseParams`。
3. 调用 `window.api.knowledgeBase.search`。
4. 用 `threshold` 过滤低分结果。
5. 如果配置了 `rerankModel`，调用主进程 rerank。
6. 限制 `documentCount`。
7. 解析 source 对应文件元数据，生成引用。

rerank 由 `src/main/knowledge/reranker/` 管理，策略包括：

- Default
- Jina
- VoyageAI
- Bailian
- TEI-compatible provider

优秀点：检索和重排被当成两段 pipeline，rerank 是可选增强，不破坏基础向量检索。

### 2.7 上下文注入

`injectUserMessageWithKnowledgeSearchPrompt` 会在 assistant 绑定知识库时：

1. 读取最后一条 user message。
2. 搜索 assistant 绑定的知识库。
3. 创建 citation block。
4. 用 `REFERENCE_PROMPT` 把原问题和 references 组合成最终 user message。

也就是说 Cherry Studio 的知识库不是隐藏在系统 prompt 里，而是生成结构化引用块，并把引用上下文显式注入模型消息。这对 FacetWrite 的 Canvas/Agent 场景很重要：后续可以把“检索引用”作为 run event 或 citation block 持久化，而不是只拼到 prompt 后丢失来源。

### 2.8 当前架构风险

Cherry Studio 自己也在源码里标记了知识库数据层迁移风险：

- `src/renderer/src/store/knowledge.ts` 标记为 deprecated，计划 v2 重构。
- `src/main/apiServer/routes/knowledge/handlers.ts` 仍通过 ReduxService 读取 `state.knowledge.bases` 和 `state.llm.providers`。
- API server 在主窗口不可用时会返回 503，说明知识库 API 还依赖 renderer store。

对 FacetWrite 的警示：不要把知识库的 source of truth 放在前端 store。FacetWrite 应以 server/db 为主，前端只做视图和交互状态。

## 3. 模型 API Provider 集成

核心代码位置：

- `src/renderer/src/config/providers.ts`
- `src/renderer/src/config/models/`
- `src/renderer/src/store/llm.ts`
- `src/renderer/src/types/provider.ts`
- `src/renderer/src/aiCore/provider/providerConfig.ts`
- `src/renderer/src/aiCore/provider/factory.ts`
- `src/main/aiCore/provider/providerConfig.ts`
- `src/renderer/src/pages/settings/ProviderSettings/`

### 3.1 Provider 数据模型

`Provider` 类型包括：

- `id`
- `type`
- `name`
- `apiKey`
- `apiHost`
- `anthropicApiHost`
- `apiVersion`
- `models`
- `enabled`
- `isSystem`
- `authType`
- `extra_headers`
- provider-specific API options

`SystemProviderIdSchema` 列出了大量内置 provider，包括 OpenAI、Anthropic、Gemini、Azure OpenAI、Vertex AI、AWS Bedrock、Ollama、LM Studio、GPUStack、OpenRouter、DeepSeek、Qwen/Bailian、Jina、VoyageAI、GitHub Models、Copilot 等。

成熟点：provider 不是简单的 `{ apiKey, baseUrl }`，而是统一承载 endpoint、模型、认证、额外 headers、API 能力开关和 provider 特性。

### 3.2 系统 Provider 与自定义 Provider

`src/renderer/src/config/providers.ts` 维护 `SYSTEM_PROVIDERS_CONFIG`：

- 每个 provider 有默认 API host、模型列表、logo、官网、API key 地址、文档地址、模型列表地址。
- `SYSTEM_PROVIDERS` 由配置表导出，作为 LLM store 的初始 provider 列表。
- 设置页支持新增自定义 provider，并允许选择 provider 类型、logo、API host、API key。

对 FacetWrite 的启发：模型设置页可以把“配置”和“帮助入口”放在同一 provider registry 中，降低用户配置成本。

### 3.3 Provider 到 SDK 配置转换

`providerToAiSdkConfig` 是 Cherry Studio 多模型集成最关键的抽象：

- 先通过 `getAiSdkProviderId` 把应用 provider 映射到 AI SDK provider。
- 根据 provider 特性选择 builder。
- 支持 Copilot token、CherryAI signature、Anthropic OAuth、Ollama、Azure、Bedrock、Vertex、CherryIN、New API、AiHubMix。
- 如果 AI SDK 原生支持，就走 generic provider config。
- 如果不支持，就走 OpenAI-compatible fallback。

这个设计非常适合 FacetWrite 学习：我们可以保持 `providerRuntime.ts` 的边界，但把 provider registry 和 provider-to-runtime-config 做得更结构化，减少 UI、服务端和模型调用之间的重复判断。

### 3.4 Host 格式化与兼容层

Cherry Studio 有专门的 `formatProviderApiHost`：

- Anthropic 使用 `anthropicApiHost` 并和 `apiHost` 同步。
- Gemini 默认补 `v1beta`。
- Ollama 去掉 OpenAI-style `/api`。
- Azure 单独处理 `/openai`、`/v1`、Responses endpoint。
- Vertex AI 有独立 host 格式。

对 FacetWrite 的启发：provider base URL 不能只靠用户手填。应该有 provider-specific normalization，并在保存或调用前统一执行。

### 3.5 模型能力识别

`src/renderer/src/config/models/` 按能力拆分：

- embedding
- rerank
- reasoning
- tool use
- vision
- web search
- OpenAI/Qwen 等特殊模型

例如 `embedding.ts` 通过模型名称正则识别 embedding 和 rerank 模型，同时允许用户显式设置模型类型。

对 FacetWrite 的启发：模型能力应从 provider/model registry 派生，而不是在功能代码中用字符串临时判断。知识库创建时尤其需要筛选 embedding 模型和 rerank 模型。

## 4. 其他优秀设计

### 4.1 可观测性

知识库搜索使用 OpenTelemetry 风格 span：

- `knowledgeSearch`
- 单个 base search
- `RagSearch`
- `rerank`

FacetWrite 当前已有 run events 和 DeerFlow dashboard，后续知识库应继续走可观察事件，而不是黑盒检索。

### 4.2 引用块与消息块

Cherry Studio 把知识库引用创建为 citation block，并和 assistant message 关联。这比单纯 prompt 拼接更适合产品化：用户能看到引用来源，后续也能做点击定位、文件打开、可信度解释。

### 4.3 设置体验

Provider 设置页不仅有 API key/base URL，还包括：

- provider logo
- 官方文档/API key/model 链接
- 连接检查
- 多 key 管理
- provider 特殊设置面板
- 自定义 header
- provider 排序和启用状态

FacetWrite 的 provider 设置如果继续增长，应避免堆成一个表单，而应逐步变成 provider registry + 专用设置面板。

### 4.4 多来源知识库

Cherry Studio 的知识库不是“上传文件”单一功能，而是统一了文件、目录、URL、sitemap、笔记、视频等来源。这个方向很适合 FacetWrite 后续做知识库和上下文机制：用户写作时需要的不只是文档，还包括项目资料、网页、笔记和历史会话。

## 5. FacetWrite 借鉴建议

### 5.1 适合优先借鉴

- 建立 server-owned knowledge base 数据层：`knowledge_bases`、`knowledge_items`、`knowledge_chunks`、`knowledge_runs`。
- 知识库配置区分 UI model 与 runtime params，运行时再注入 provider API key/base URL。
- 支持 embedding model、rerank model、chunk size、chunk overlap、threshold、document count。
- 文件导入做任务队列，有 processing status、progress、error、retry count。
- loader 层统一处理文件类型，而不是 UI 层判断。
- 搜索结果持久化为 citation/reference event，供 Canvas 和 Agent 输出展示。
- provider registry 增加模型能力标注：chat、embedding、rerank、vision、tool、reasoning。

### 5.2 需要谨慎借鉴

- 不要把知识库 source of truth 放到前端 store。Cherry Studio 当前 Redux 依赖已经成为它 API server 的约束。
- 不要在第一版就支持过多 provider-specific UI。FacetWrite 可以先建立 registry 结构，再逐步补 provider 面板。
- 不要直接照搬 Electron IPC。FacetWrite 应保留 Express/server 服务边界。
- 不要让知识库检索只在 prompt 拼接中存在。必须把引用、来源、分数、检索参数作为 run metadata 保存。

### 5.3 建议的 FacetWrite 演进路线

1. 先做最小知识库核心：本地文件/文本导入、chunk、embedding、SQLite/向量存储、检索 API。
2. 再做 Agent 绑定：AgentCard 可选择知识库，生成时先检索再注入引用上下文。
3. 然后做引用 UI：在 AI collaboration drawer 和 Canvas write proposal 中显示引用来源。
4. 最后做高级能力：rerank、URL/sitemap、OCR/PDF 预处理、多 provider embedding、导入队列 dashboard。

## 6. 结论

Cherry Studio 在知识库和多 provider 集成上最成熟的地方，不是某个单点算法，而是“配置 registry + runtime adapter + loader pipeline + citation-aware UX”的整体工程组织。

FacetWrite 后续应重点吸收三件事：

- 知识库要成为 server-owned capability，而不是前端附属状态。
- 模型 provider 要有统一 registry 和能力描述，供聊天、embedding、rerank、工具调用共同使用。
- RAG 结果要以 citation/run event 形式进入产品界面和持久化层，不能只作为临时 prompt 文本。

