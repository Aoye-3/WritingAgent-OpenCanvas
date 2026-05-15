# DeerFlow × Jasper × Cherry 功能结合思考 v0.2  
## 如何有机融合 Agent 架构与 UI 架构

---

## 1. 核心问题

我们现在面对的不是“选哪个框架”的问题，而是如何把三个优秀参考的能力放到正确层级：

```text
DeerFlow 很强，但强在 Agent 架构。
Jasper 很强，但强在 Workspace 和 Canvas 交互。
Cherry 很强，但强在 Chatbar、ToolUse 和 Agent / Topic 组织。
```

因此本项目最合理的路线不是三选一，而是分层融合：

```text
DeerFlow → Agent capability architecture
Jasper   → Layered workspace interaction
Cherry   → Command bar and ToolUse interaction
Our App  → AgentCard adapter + text collaboration product
```

---

## 2. 为什么不直接复用 DeerFlow UI

DeerFlow 的 UI 是为 super agent harness 服务的，它的主要目标是：

```text
处理复杂任务
展示 tool call
管理 thread / run
支持 upload / artifact
支持 streaming
支持多模式 agent execution
```

而我们的目标 UI 是：

```text
AgentCard
Structured Input
Prompt Preview
Doc-style Collaborative Canvas
AI Conversation Drawer
Bottom ToolUse Command Bar
```

这两者并不冲突，但产品心智不同。

如果直接复用 DeerFlow UI，风险是：

1. 结构化输入和 Prompt Preview 会变成附属功能。
2. Doc 式协作编辑画板不容易成为中心。
3. Jasper-like 三栏工作台难以自然形成。
4. Cherry-like 底部 ToolUse 输入栏会被弱化。
5. 研究核心会被 DeerFlow 的 runtime complexity 淹没。

因此：

```text
DeerFlow UI 不复用。
DeerFlow 架构要深度借鉴。
```

---

## 3. DeerFlow 最值得吸收的能力思想

## 3.1 Skill-first Capability Design

DeerFlow 将能力放在 `SKILL.md` 中，而不是硬编码在某个组件或某段 prompt 里。

这给我们的启发是：

```text
AgentCard 不应该只是卡片 + prompt。
AgentCard 应该引用 Skill。
Skill 才是 Agent 能力内容。
```

我们的映射：

```text
AgentCard = 用户看见的任务入口
Skill     = Agent 背后的能力说明
PromptBuilder = 把 Skill 与用户输入结合的管道
```

## 3.2 Agent SOUL + Config Separation

DeerFlow 将 Agent 的身份与配置分开：

```text
SOUL.md      → Agent 的人格、行为规则、边界
config.yaml  → Agent 的 skills、tool_groups、model 等配置
```

这可以映射为：

```text
identityPrompt → SOUL.md 思想
skillRefs      → config.yaml skills
toolGroups     → config.yaml tool_groups
inputFields    → 我们新增的 UI schema
```

换句话说，我们比 DeerFlow 多了一层：

```text
Structured Input Schema
```

这正是我们的研究和产品创新点。

## 3.3 Tool Groups / Tool Registry

DeerFlow 不是随便把工具放到界面上，而是通过：

```text
tool_groups
tools
allowed-tools
```

管理工具能力。

这对我们非常关键，因为我们的 ToolUse 不能是按钮堆砌。

正确做法：

```text
每个 AgentCard 声明 toolGroups / toolRefs
底部 Command Bar 根据当前 AgentCard 显示工具
Prompt Preview 显示启用工具
AI Drawer 显示工具调用结果
```

## 3.4 Middleware-driven Runtime

DeerFlow 的 middleware 很多，例如：

```text
ThreadDataMiddleware
UploadsMiddleware
DynamicContextMiddleware
MemoryMiddleware
LoopDetectionMiddleware
ClarificationMiddleware
ToolErrorHandlingMiddleware
TokenUsageMiddleware
TitleMiddleware
```

我们不需要复制这些中间件，但要学习它的职责拆分。

我们的对应设计应该是：

```text
PromptBuildPipeline
├── injectSkill
├── injectIdentity
├── injectStructuredInputs
├── injectReference
├── injectToolState
├── injectOutputContract
└── validateBeforeGenerate
```

UI 对应：

```text
AI Drawer
├── Prompt Built Notice
├── Tool Use Notice
├── Context Injected Notice
├── Revision Explanation
└── Clarification Request
```

## 3.5 Thread Data / Workspace / Uploads / Outputs

DeerFlow 的线程数据模型很适合我们设计 Project / Topic：

```text
thread
└── user-data
    ├── workspace
    ├── uploads
    └── outputs
```

我们的映射：

```text
Project
└── Topic / Session
    ├── Workspace Draft
    ├── Reference Materials
    ├── Prompt Sessions
    ├── Generated Outputs
    └── Version History
```

这使得后续接 DeerFlow runtime 时有天然映射关系。

---

## 4. Jasper 对 UI 架构的贡献

Jasper 的关键价值是：

```text
Workspace-first
Canvas-centered
Agent Panel as structured control
Projects as asset management
Context settings as reusable intelligence
```

我们吸收后形成：

```text
Layered Agent Workspace
├── Left Structured Input Panel
├── Center Doc-style Canvas
├── Right AI Drawer
└── Bottom Command Bar
```

Jasper 让我们明确：

1. 文档画板应该是中心，而不是聊天气泡。
2. 结构化输入应该放在侧边，作为控制面板。
3. Agent 不是聊天头像，而是任务配置面板。
4. 生成后的内容需要继续编辑，而不是只复制。
5. Project / History 是产品感的重要来源。

---

## 5. Cherry 对 UI 架构的贡献

Cherry 的关键价值是：

```text
Agent / Topic separation
Multi-function chatbar
ToolUse near input
Quick prompts
Knowledge reference
Clear context
```

我们吸收后形成：

```text
Bottom AI Command Bar
├── Text Input
├── Web Search
├── Quick Messages
├── Knowledge Base
├── Clear Context
├── Context Target
└── Send
```

Cherry 让我们明确：

1. 工具应该靠近输入，而不是藏在设置里。
2. 用户的每次指令都可以选择上下文来源。
3. Agent 和 Topic 要分开理解：
   - Agent = 能力
   - Topic = 任务线程
4. 即使是自由输入，也可以有工具化增强。
5. Clear Context 是重要的用户控制按钮。

---

## 6. 三者的有机结合方式

最终融合关系：

```text
AgentCard
├── UI Presentation, our design
├── Skill Reference, DeerFlow
├── Tool Permission, DeerFlow
├── Structured Input, our innovation
├── Workspace Layout, Jasper
└── Command Bar ToolUse, Cherry
```

更完整：

```text
Home
→ AgentCard Library
→ Select AgentCard
→ Load Skill
→ Show Structured Form
→ Build Prompt Preview
→ Enable Agent-specific Tools
→ Generate into Doc Canvas
→ Continue via Bottom Command Bar
→ Show activity in AI Drawer
→ Save as Project / Topic
```

---

## 7. 功能模块融合图

```text
Human-AI Text Agent
├── AgentCard Library
│   ├── Card UI, ours
│   ├── Skill refs, DeerFlow
│   ├── Tool badges, DeerFlow + Cherry
│   └── Task categories, Jasper-like
│
├── Layered Workspace
│   ├── Left Structured Panel, Jasper-like
│   ├── Center Doc Canvas, Jasper-like
│   ├── Right AI Drawer, DeerFlow tool timeline + chat
│   └── Bottom Command Bar, Cherry-like
│
├── Agent Capability
│   ├── SKILL.md, DeerFlow
│   ├── allowed-tools, DeerFlow
│   ├── SOUL-like identity, DeerFlow
│   ├── PromptBuilder, ours
│   └── Structured Input Schema, ours
│
├── ToolUse
│   ├── toolRegistry, DeerFlow
│   ├── Web Search, DeerFlow-compatible
│   ├── Knowledge Base, Cherry + Jasper IQ inspired
│   ├── Quick Messages, Cherry
│   └── Clear Context, Cherry
│
└── Project Memory
    ├── Project, Jasper
    ├── Topic, Cherry
    ├── Thread data model, DeerFlow
    └── Output versions, ours
```

---

## 8. AgentCard Adapter Layer 的必要性

没有 Adapter Layer 会出现两个问题：

1. DeerFlow Skill 是能力文档，但用户需要可见、可操作的 UI。
2. Jasper / Cherry 的 UI 是交互结构，但需要背后真实 Agent 能力支撑。

Adapter Layer 正是桥梁。

```text
DeerFlow Skill / Tool
→ AgentCard Adapter
→ Structured Form / Tool Buttons / Prompt Preview
→ User-facing Workspace
```

Adapter Layer 需要完成：

```text
1. 读取 Skill metadata。
2. 绑定到 AgentCard。
3. 决定显示哪些结构化字段。
4. 决定显示哪些工具按钮。
5. 将字段、Skill、工具状态组合成 Prompt。
6. 将工具调用和结果转译为 AI Drawer 消息。
7. 将输出转译为 Doc Canvas 内容。
```

---

## 9. Prompt Preview 的新意义

在旧版 Faceted Prompt Interface 中，Prompt Preview 的作用是：

```text
把结构化字段拼成完整 Prompt。
```

在新版架构中，Prompt Preview 的作用升级为：

```text
展示 Agent 能力如何被组装。
```

它应该显示：

```text
Agent Identity
Skill Instruction
Structured Inputs
Reference Material
Tool State
Output Contract
Final Prompt
```

这样用户看到的不是一段黑箱 prompt，而是：

```text
这个 Agent 为什么这样工作
它参考了什么 Skill
它使用了哪些工具
它如何理解我的任务
它将如何生成输出
```

这是我们区别于普通 Agent UI 的重要创新点。

---

## 10. ToolUse 的新意义

在普通聊天产品中，ToolUse 常常是：

```text
按钮
```

在我们的产品中，ToolUse 应该是：

```text
Agent capability permission + task context control
```

也就是说：

```text
ToolUse 不是用户随机打开工具。
ToolUse 是当前 Agent 任务能力的一部分。
```

例如：

```text
Research Agent
→ Web Search 是核心能力

Email Agent
→ Email Thread Context 是核心能力

Rewrite Agent
→ Style Guide 是核心能力

Summary Agent
→ Source Text / File Reader 是核心能力
```

这意味着底部工具栏应该根据 AgentCard 变化。

---

## 11. MVP 中如何借用 DeerFlow，而不被 DeerFlow 拖重

最合理策略：

```text
借用 DeerFlow 的文件协议和架构思想
不接完整 DeerFlow runtime
```

P0 具体做法：

```text
1. 本地建立 skills/public。
2. SKILL.md 使用 DeerFlow-like frontmatter。
3. AgentCard 绑定 skillRefs。
4. PromptBuilder 读取 Skill 内容。
5. toolRegistry 使用 DeerFlow-like tool_groups。
6. Web Search 先 mock。
7. AI Drawer 展示 Tool Use Notice。
```

这样做的好处：

1. Agent 能力不再空泛。
2. 后续接 DeerFlow runtime 有迁移路径。
3. Coding Agent 可以清晰施工。
4. 产品 UI 仍然保持我们自己的形态。
5. 研究核心不会被复杂 runtime 干扰。

---

## 12. 哪些 DeerFlow 内容适合直接借鉴

## 12.1 适合 P0 借鉴

```text
SKILL.md 文件组织
YAML frontmatter
allowed-tools
Skill description / workflow / best practices
Tool groups 思想
Prompt section 思想
Tool call notice 思想
Thread workspace/uploads/outputs 映射思想
```

## 12.2 适合 P1 借鉴

```text
DuckDuckGo web_search
Jina web_fetch
Skill management UI
Tool Call Log
Uploads reference handling
Suggestions router
Streaming response handling
```

## 12.3 适合 P2 借鉴

```text
LangGraph runtime
MCP client
Memory middleware
Sandbox
Subagents
ACP agents
Run manager
Checkpointer
Auth / user isolation
```

---

## 13. 哪些 DeerFlow 内容不适合当前使用

```text
完整 IM channels
完整 Docker sandbox
bash execution
file write tools
full MCP manager
full memory queue
multi-user auth
production deployment stack
full LangGraph runtime
```

原因：

1. 和 final project 的核心交互目标关系较弱。
2. 会显著增加施工复杂度。
3. 会干扰实验变量。
4. 安全和配置成本较高。
5. UI 目标并不是 super agent platform。

---

## 14. 对 AgentCard 的重新理解

旧理解：

```text
TaskCard = 进入某个表单
```

新理解：

```text
AgentCard = 可见的任务 Agent
```

完整结构：

```text
AgentCard
├── UI card
├── Identity Prompt
├── Skill refs
├── Tool permissions
├── Structured form schema
├── Context requirement
├── Prompt preview strategy
└── Output / revision actions
```

这让 AgentCard 成为真正的产品核心对象。

---

## 15. 对 Projects / Topics 的重新理解

借鉴 Cherry 和 DeerFlow：

```text
Agent = 能力
Topic = 某次任务线程
Project = 任务成果容器
Thread = runtime/session 层概念
```

映射：

```text
AgentCard
→ Topic / PromptSession
→ Doc Canvas
→ OutputVersion
→ Project
```

如果未来接 DeerFlow：

```text
Topic ≈ DeerFlow thread
Project workspace ≈ thread user-data/workspace
Reference materials ≈ uploads
Generated outputs ≈ outputs
```

---

## 16. 推荐的最终产品架构

```text
Frontend
├── Home
├── AgentCard Library
├── Direct Chat Mode
├── Layered Workspace
│   ├── Structured Input Panel
│   ├── Doc Canvas
│   ├── AI Drawer
│   └── Command Bar
├── Projects
└── Settings

Adapter
├── AgentCard Adapter
├── Skill Loader
├── PromptBuilder
├── Tool Registry
├── Tool Router
└── Project Mapper

Capability
├── Local SKILL.md
├── Mock Tools
├── Local Knowledge
├── Real Web Search, P1
├── DeerFlow Runtime, P2
└── MCP / Memory / Sandbox, P2
```

---

## 17. 推荐的产品口径

对外解释：

```text
This project explores a human-AI collaborative text agent interface that combines task-specific AgentCards, structured prompt construction, visible Prompt Preview, document-style editing, conversational revision, and task-aware ToolUse.
```

中文：

```text
本项目探索一种人机协同文本 Agent 界面，它结合任务型 AgentCard、结构化 Prompt 构造、可见化 Prompt Preview、文档式编辑、对话式修改和任务感知 ToolUse。
```

技术架构口径：

```text
The interface is custom-built, drawing on Jasper-like workspace design and Cherry-like command bar interaction, while adopting a DeerFlow-inspired Skill and ToolUse capability architecture.
```

中文：

```text
界面层采用自定义设计，吸收 Jasper 的工作台结构和 Cherry 的指令栏交互；能力层采用 DeerFlow 启发的 Skill 与 ToolUse 架构。
```

---

## 18. 下一步建议

建议下一步产出：

```text
1. PRD v0.2, done
2. Functional integration thinking, this document
3. AgentCard schema finalization
4. 5 个 SKILL.md 草案
5. Codex 施工任务书
6. Figma IA / Functional map 更新
```

---

## 19. 最终共识

```text
Jasper 和 Cherry 定义交互表层。
DeerFlow 定义 Agent 能力架构。
我们的产品通过 AgentCard Adapter Layer 把二者连接起来。
```

最短版本：

```text
Custom UI.
DeerFlow-inspired capability.
AgentCard as the bridge.
```

中文：

```text
自定义 UI。
借鉴 DeerFlow 能力架构。
AgentCard 是桥梁。
```
