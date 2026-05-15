# DeerFlow 架构深度分析｜对 Human-AI Text Agent 的借鉴方案 v0.1

## 0. 分析目的

本文档基于用户提供的 `deer-flow-main.zip` 源码，对 DeerFlow 的 Agent 架构进行深度拆解，并评估哪些部分可以被我们的 Human-AI Text Agent 应用借鉴、适配或暂缓。

我们的既定方向是：

```text
不复用 DeerFlow UI
借鉴 DeerFlow 的 Agent 能力架构
结合 Jasper + Cherry 的 UI 交互范式
构建我们自己的文本 Agent 应用
```

---

## 1. 总体判断

DeerFlow 的优秀之处不在于某一个页面或某一个工具，而在于它将一个 Agent 系统拆成了多个高度可组合的层：

```text
DeerFlow Agent Architecture
├── Agent SOUL / Custom Agent Config
├── Skill System
├── Tool Registry / Tool Groups
├── Skill-based Tool Permission Policy
├── System Prompt Template
├── Dynamic Context Middleware
├── Thread Data / Workspace / Uploads / Outputs
├── Memory Middleware
├── Uploads Middleware
├── Tool Error / Loop Detection / Clarification Middleware
├── Subagent Orchestration
├── MCP / ACP Extension
└── Frontend Stream + Tool Call Visualization
```

这非常适合成为我们产品的 Agent 能力模型参考。

但 DeerFlow 的 UI 不是我们的目标 UI。我们的 UI 仍然应该基于：

```text
Jasper-like Layered Workspace
+ Cherry-like Bottom Command Bar
+ 自定义 AgentCard 结构化输入
+ Doc-style Collaborative Canvas
+ AI Conversation Drawer
```

---

## 2. DeerFlow 最值得借鉴的 10 个架构点

## 2.1 Skill 作为 Agent 能力模块

DeerFlow 的 Skill 是一个独立能力模块，通常以 `SKILL.md` 形式存在。

源码中可见：

```text
skills/public/*/SKILL.md
```

示例：

```text
skills/public/deep-research/SKILL.md
skills/public/newsletter-generation/SKILL.md
skills/public/academic-paper-review/SKILL.md
skills/public/frontend-design/SKILL.md
skills/public/find-skills/SKILL.md
```

每个 Skill 的基本结构是：

```md
---
name: deep-research
description: ...
---

# Skill Name

## Overview
## When to Use This Skill
## Workflow
## Best Practices
...
```

DeerFlow 的 Skill 不是简单 Prompt，而是包含：

```text
Skill
├── Metadata
│   ├── name
│   ├── description
│   ├── license, optional
│   └── allowed-tools, optional
│
├── Use Case
├── Workflow
├── Best Practices
├── Search / Tool Strategy
├── Output Requirements
└── Supporting Resources, optional
```

### 对我们项目的启发

我们的 AgentCard 不应该只写一段 identity prompt，而应该绑定一个或多个 Skill。

```text
AgentCard = UI 入口
Skill = Agent 能力内容
```

建议我们直接建立：

```text
skills/
├── research/SKILL.md
├── summary/SKILL.md
├── report-outline/SKILL.md
├── email-writing/SKILL.md
├── rewrite-polish/SKILL.md
└── lesson-plan/SKILL.md
```

其中 Research / Report / Newsletter / Academic Review 等可以借鉴 DeerFlow 现有 public skills 的写法。

---

## 2.2 Skill Frontmatter 协议

DeerFlow 的 `skills/parser.py` 解析 `SKILL.md` 的 YAML frontmatter。

它要求至少包含：

```yaml
name: string
description: string
```

并支持可选字段：

```yaml
license: string
allowed-tools:
  - web_search
  - web_fetch
```

DeerFlow 还在 validation 中允许：

```text
name
description
license
allowed-tools
metadata
compatibility
version
author
```

### 对我们项目的启发

我们可以为自己的 AgentCard Skill 定义兼容 DeerFlow 的 frontmatter，同时扩展 UI 所需字段。

建议格式：

```yaml
---
name: research-explanation
description: Helps users research a topic and generate clear explanation text.
category: research
allowed-tools:
  - web_search
  - web_fetch
ui:
  cardTitle: Research / Explanation Agent
  cardDescription: Research a topic and turn it into clear, audience-aware text.
  icon: search
  color: blue
output:
  type: explanation
  defaultFormat: markdown
---
```

MVP 可只严格读取 `name`、`description`、`allowed-tools`，UI 字段先由 `agentCards.ts` 管理。P1 再考虑完全从 Skill metadata 生成 AgentCard。

---

## 2.3 Public / Custom Skill 分层

DeerFlow 将 Skill 分为：

```text
skills/public/   built-in, read-only
skills/custom/   user-authored, editable
```

源码中的 `SkillCategory` 明确区分：

```text
PUBLIC = public
CUSTOM = custom
```

### 对我们项目的启发

我们也应该区分：

```text
Built-in Agent Skills
Custom Agent Skills, later
```

MVP：

```text
skills/builtin/
```

或兼容 DeerFlow：

```text
skills/public/
skills/custom/
```

推荐直接采用 DeerFlow 风格：

```text
skills/public/research-explanation/SKILL.md
skills/public/summary/SKILL.md
skills/public/report-outline/SKILL.md
skills/public/email-writing/SKILL.md
skills/public/rewrite-polish/SKILL.md
```

这样未来如果接 DeerFlow runtime，会更自然。

---

## 2.4 Skill Loader 与 Skill Cache

DeerFlow 的 Skill 系统不是每次都直接读文件，而是有：

```text
LocalSkillStorage
SkillStorage
parse_skill_file
load_skills(enabled_only)
get_cached_enabled_skills
clear_skills_system_prompt_cache
```

它支持：

```text
扫描 Skill 文件
解析 frontmatter
合并 enabled 状态
缓存 enabled skills
在 Skill 变更后清理 prompt cache
```

### 对我们项目的启发

我们的 MVP 也应该建立 `skillLoader.ts`，而不是在 promptBuilder 里随意读文件。

建议：

```ts
type LoadedSkill = {
  name: string;
  description: string;
  content: string;
  path: string;
  allowedTools?: string[];
  category: "public" | "custom";
};
```

`skillLoader.ts` 职责：

```text
loadSkill(skillName)
loadSkillsForAgent(agentCard)
parseSkillFrontmatter(content)
cache loaded skills
validate skill exists
```

---

## 2.5 Skill Progressive Loading Pattern

DeerFlow 的系统提示中有一个非常重要的设计：

```text
Progressive Loading Pattern
1. 当用户请求匹配某个 Skill 时，先读取 Skill 主文件
2. 理解 Skill workflow
3. Skill 文件中可能引用额外资源
4. 只有需要时才继续加载资源
5. 严格遵循 Skill 指令
```

这是 DeerFlow 很优秀的地方：它不是把所有技能内容一次性塞进上下文，而是先在 system prompt 里列出可用 Skill，然后让 Agent 按需读取。

### 对我们项目的启发

我们的产品有两种可能策略：

#### MVP 策略：显式加载当前 AgentCard 的 Skill

用户选择 AgentCard 后，我们已经知道当前任务类型，因此可以直接加载对应 Skill。

```text
AgentCard selected
→ load related SKILL.md
→ Prompt Preview 显示 Skill Instruction
→ Generate
```

这适合我们的结构化界面。

#### P2 策略：渐进式 Skill 发现

在 Direct Chat Mode 中，用户没有选择 AgentCard 时，可以借鉴 DeerFlow 的 progressive loading：

```text
用户自由输入
→ 系统判断适合哪个 Skill
→ 推荐 AgentCard / 自动加载 Skill
→ 转入 Layered Workspace
```

---

## 2.6 Agent SOUL 与 Custom Agent Config

DeerFlow 的 Custom Agent 由两个核心文件构成：

```text
config.yaml
SOUL.md
```

`config.yaml` 可包含：

```yaml
name: agent-name
description: agent description
model: optional model override
tool_groups:
  - web
skills:
  - deep-research
```

`SOUL.md` 定义 Agent 的人格、行为规则和边界。

源码中的 `AgentConfig` 包含：

```text
name
description
model
tool_groups
skills
```

### 对我们项目的启发

我们的 AgentCard 可以映射为 DeerFlow Custom Agent：

```text
AgentCard.name → AgentConfig.name
AgentCard.description → AgentConfig.description
AgentCard.toolRefs → AgentConfig.tool_groups
AgentCard.skillRefs → AgentConfig.skills
AgentCard.identityPrompt → SOUL.md
```

这说明我们的 AgentCard 设计方向是正确的。

### 建议适配

MVP 内部数据：

```ts
type AgentCard = {
  id: string;
  name: string;
  description: string;
  identityPrompt: string;
  skillRefs: string[];
  toolGroups: string[];
  inputFields: AgentInputField[];
};
```

未来可以导出成 DeerFlow agent：

```text
agents/{agentName}/config.yaml
agents/{agentName}/SOUL.md
```

---

## 2.7 Tool Registry / Tool Groups

DeerFlow 的工具配置在 `config.example.yaml` 中体现得很清楚：

```yaml
tool_groups:
  - name: web
  - name: file:read
  - name: file:write
  - name: bash

tools:
  - name: web_search
    group: web
    use: deerflow.community.ddg_search.tools:web_search_tool

  - name: web_fetch
    group: web
    use: deerflow.community.jina_ai.tools:web_fetch_tool

  - name: read_file
    group: file:read
    use: deerflow.sandbox.tools:read_file_tool
```

### 对我们项目的启发

我们的 ToolUse 不应该只是按钮状态，而应该也有一个 `toolRegistry.ts`。

建议：

```ts
type ToolDefinition = {
  id: string;
  name: string;
  group: "web" | "file:read" | "file:write" | "email" | "calendar" | "knowledge" | "style";
  label: string;
  description: string;
  source: "local" | "deerflow" | "mock" | "mcp";
  riskLevel: "low" | "medium" | "high";
  enabledInMVP: boolean;
};
```

AgentCard 不直接控制具体工具按钮，而是声明：

```ts
toolGroups: ["web", "knowledge"]
toolRefs: ["web_search", "web_fetch"]
```

UI 再根据当前 AgentCard 显示可用工具。

---

## 2.8 Skill-based Tool Permission Policy

DeerFlow 有一个很关键的安全设计：`allowed-tools`。

如果 Skill frontmatter 声明了 allowed-tools，系统会把可用工具限制在这些工具之内。

源码逻辑：

```text
allowed_tool_names_for_skills(skills)
filter_tools_by_skill_allowed_tools(tools, skills)
```

规则是：

```text
如果没有任何 Skill 声明 allowed-tools → legacy allow-all
如果某些 Skill 声明 allowed-tools → 只允许这些工具合集
```

### 对我们项目的启发

这非常适合我们的 ToolUse 权限系统。

例如：

```yaml
---
name: research-explanation
allowed-tools:
  - web_search
  - web_fetch
---
```

那么 Research AgentCard 只显示：

```text
Web Search
Web Fetch
Knowledge Base, if app-level tool
```

Email AgentCard：

```yaml
allowed-tools:
  - email_thread_read
  - contact_lookup
  - calendar_check
```

MVP 先 mock，P2 接真实 MCP。

---

## 2.9 Middleware Chain

DeerFlow 的 Agent 不是单次 API 调用，而是通过一串 middleware 执行。

关键 middleware 包括：

```text
ThreadDataMiddleware
UploadsMiddleware
SandboxMiddleware
DynamicContextMiddleware
SummarizationMiddleware
TodoMiddleware
TokenUsageMiddleware
TitleMiddleware
MemoryMiddleware
ViewImageMiddleware
DeferredToolFilterMiddleware
SubagentLimitMiddleware
LoopDetectionMiddleware
ClarificationMiddleware
ToolErrorHandlingMiddleware
```

### 对我们项目的启发

我们不需要直接复制 middleware 机制，但可以借鉴其职责拆分。

在我们的前后端中，可拆为：

```text
PromptBuildPipeline
├── injectAgentIdentity
├── injectSkillInstruction
├── injectStructuredInputs
├── injectReferenceMaterial
├── injectToolState
├── injectMemory, later
├── injectUploadedFiles, later
├── applyOutputContract
└── validatePrompt
```

同时，在 UI 中对应：

```text
AI Drawer
├── Tool Use Notice
├── Context Injected Notice
├── Prompt Built Notice
├── Revision Explanation
└── Error / Clarification Notice
```

---

## 2.10 Thread Data / Workspace / Uploads / Outputs 模型

DeerFlow 的路径模型非常清晰：

```text
{base_dir}/threads/{thread_id}/user-data/
├── workspace/
├── uploads/
└── outputs/
```

在 sandbox 中映射为：

```text
/mnt/user-data/workspace
/mnt/user-data/uploads
/mnt/user-data/outputs
```

### 对我们项目的启发

这可以直接映射到我们的 Project / Topic / Workspace：

```text
Project
└── Topic / Session
    ├── Workspace Draft
    ├── Uploaded / Reference Materials
    ├── Generated Outputs
    └── Version History
```

MVP 可以本地化：

```text
localStorage project
├── document blocks
├── prompt sessions
├── reference materials
└── output versions
```

P2 如果接 DeerFlow runtime，则可以映射到 thread user-data。

---

## 3. DeerFlow 可直接借鉴到我们产品的具体模块

## 3.1 AgentCard = DeerFlow Custom Agent + Skill

建议映射：

| 我们的 AgentCard | DeerFlow 对应 |
|---|---|
| cardTitle / description | Agent config description |
| identityPrompt | SOUL.md |
| skillRefs | config.yaml skills |
| toolGroups | config.yaml tool_groups |
| inputFields | 我们自定义 UI schema |
| outputActions | 我们自定义 UI schema |

DeerFlow 本身没有结构化输入 schema，这正是我们需要补上的价值。

## 3.2 Prompt Preview = DeerFlow System Prompt 的可视化版本

DeerFlow 的 system prompt 已经分成多个 XML-like section：

```text
<role>
<soul>
<thinking_style>
<clarification_system>
<skill_system>
<available_skills>
<working_directory>
<response_style>
<citations>
<critical_reminders>
```

我们的 Prompt Preview 可以借鉴这种分区结构，但改成用户可理解的 UI：

```text
Prompt Preview
├── Agent Role
├── Skill Instruction
├── Structured Inputs
├── Reference / Context
├── Tool State
├── Output Requirements
└── Safety / Confirmation Rules
```

## 3.3 AI Drawer = DeerFlow Chain-of-Thought / Tool Call Visualization 的产品化版本

DeerFlow 前端已经实现了 Tool Call 可视化：

```text
web_search → search result list
web_fetch → fetched page title / link
read_file → file path
write_file → artifact link
bash → command block
ask_clarification → need your help
write_todos → todo step
```

我们可以借鉴这个思路，但放在右侧 AI Drawer 中：

```text
Right AI Drawer
├── User instruction
├── Agent response
├── Tool Call Step
├── Tool Result Summary
├── Revision Explanation
└── Suggested Follow-ups
```

## 3.4 Bottom Command Bar = DeerFlow InputBox + Cherry ToolUse

DeerFlow 的 InputBox 已有：

```text
attachments
mode selector: flash / thinking / pro / ultra
model selector
suggestions / follow-ups
submit / stop
```

Cherry 给我们补充：

```text
web search
quick messages
knowledge base
clear context
```

我们的底部 Command Bar 可以融合：

```text
Bottom Command Bar
├── Text Input
├── Attachments, P1
├── Web Search
├── Quick Messages
├── Knowledge Base
├── Clear Context
├── Context Target
├── Mode / Effort, optional
└── Send
```

---

## 4. DeerFlow 的哪些部分适合 MVP 直接借鉴

## 4.1 强烈建议进入 MVP

### A. Skill 文件协议

使用 `SKILL.md` + YAML frontmatter。

### B. AgentCard 绑定 SkillRefs

每个 AgentCard 必须声明 skillRefs。

### C. Tool Registry / Tool Groups

建立本地 `toolRegistry.ts`，按 DeerFlow 的 group 思路组织。

### D. Prompt Preview 分区

借鉴 DeerFlow XML section 思路，把 Prompt Preview 分成可读模块。

### E. Web Search 工具模型

即使 MVP 不真实联网，也按 DeerFlow 的 `web_search` / `web_fetch` 模型设计接口。

### F. Tool Call Notice UI

AI Drawer 中必须显示工具调用状态。

---

## 4.2 可进入 P1

### A. 真实 web_search

可优先抽取 DeerFlow 的 DuckDuckGo web_search 实现。

它不需要 API key，适合快速增强原型。

### B. 真实 web_fetch

可抽取 Jina AI web_fetch 或保留为 mock。

### C. 上传文件与 reference material

借鉴 UploadsMiddleware，但先不做完整 sandbox。

### D. Skill 管理 UI

可简单显示 Skill 来源、描述和启用状态。

---

## 4.3 放入 P2

### A. 完整 DeerFlow runtime

包括 LangGraph、thread、run、stream、checkpoint。

### B. MCP 管理

DeerFlow 的 MCP config 很完整，但对 MVP 过重。

### C. Memory Middleware

长期记忆需要谨慎，因为会影响实验变量。

### D. Sandbox / Bash / File Write

强大但安全风险高，不适合最初版本。

### E. Subagent orchestration

优秀，但会显著增加产品复杂度。

---

## 5. 对我们现有 PRD 的修改建议

## 5.1 新增一章：DeerFlow Capability Integration

建议加入：

```text
本项目不复用 DeerFlow UI，但从 MVP 开始借鉴 DeerFlow 的 Agent capability architecture。

MVP 集成策略：
1. 建立本地 skills/public 目录。
2. 每个 AgentCard 绑定 skillRefs。
3. Skill 使用 DeerFlow-compatible frontmatter。
4. PromptBuilder 读取 Skill 内容并构造分区 Prompt Preview。
5. ToolRegistry 按 DeerFlow tool_groups 设计。
6. Web Search / Web Fetch 先 mock 或轻量接入。
7. 未来可将 AgentCard 映射为 DeerFlow custom agent。
```

## 5.2 修改 AgentCard Schema

```ts
type AgentCard = {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;

  identityPrompt: string;
  skillRefs: string[];
  toolGroups: string[];
  toolRefs: string[];

  inputFields: AgentInputField[];
  promptPreviewSections: PromptPreviewSection[];
  outputActions: RevisionAction[];
};
```

## 5.3 新增 Skill Schema

```ts
type AgentSkill = {
  name: string;
  description: string;
  category: "public" | "custom";
  allowedTools?: string[];
  content: string;
  path: string;
  enabled: boolean;
};
```

## 5.4 新增 Tool Registry Schema

```ts
type ToolDefinition = {
  id: string;
  name: string;
  group: string;
  label: string;
  description: string;
  source: "mock" | "local" | "deerflow" | "mcp";
  riskLevel: "low" | "medium" | "high";
  enabledInMVP: boolean;
};
```

---

## 6. 推荐实施路线

## Phase 1：Skill 化现有 AgentCard

```text
1. 建立 skills/public 目录
2. 为 5 个 P0 AgentCard 编写 SKILL.md
3. 实现 skillLoader.ts
4. AgentCard 引用 skillRefs
5. PromptBuilder 读取 Skill 内容
```

## Phase 2：Tool Registry 化

```text
1. 建立 toolRegistry.ts
2. 定义 web_search / web_fetch / knowledge_base / clear_context / quick_messages
3. AgentCard 声明 toolGroups / toolRefs
4. Bottom Command Bar 根据当前 AgentCard 显示工具
5. Prompt Preview 显示 Tool State
```

## Phase 3：Prompt Preview 分区化

```text
1. Agent Identity
2. Skill Instruction
3. Structured Inputs
4. Reference Material
5. Tool State
6. Output Requirements
```

## Phase 4：AI Drawer 工具调用可视化

```text
1. 显示 Tool Use Notice
2. 显示 mock search results
3. 显示 reference injected notice
4. 显示 revision explanation
5. 显示 suggested follow-ups
```

## Phase 5：轻量接入 DeerFlow Web Search，P1

```text
1. 抽取 DuckDuckGo web_search 逻辑，或独立实现
2. 返回统一结构：title / url / content
3. 将结果写入 Tool Call Log
4. 将结果注入 PromptBuilder
```

---

## 7. 对 DeerFlow 的最终评价

DeerFlow 的架构非常值得学习，尤其是：

```text
Skill-first capability design
Agent SOUL + Config separation
Tool Groups and Skill-based Tool Permissions
Middleware-driven Agent Runtime
Thread Data / Uploads / Outputs model
Progressive Skill Loading
Tool Call Visualization
Subagent Orchestration
MCP extensibility
```

但我们的产品不应该变成 DeerFlow 的 UI 变体。

我们最适合采用的方向是：

```text
Custom Human-AI Text Agent UI
+ DeerFlow-compatible Skill Layer
+ DeerFlow-inspired Tool Registry
+ Future DeerFlow Runtime Adapter
```

一句话：

```text
Jasper + Cherry define the interaction surface.
DeerFlow defines the Agent capability architecture.
Our product connects them through AgentCard Adapter Layer.
```

中文：

```text
Jasper 和 Cherry 定义交互表层。
DeerFlow 定义 Agent 能力架构。
我们的产品通过 AgentCard Adapter Layer 把二者有机连接。
```

