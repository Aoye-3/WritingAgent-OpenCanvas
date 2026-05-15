# Human-AI Text Agent 施工 PRD v0.2  
## DeerFlow Skill / ToolUse Integration Edition

---

## 0. 文档状态

**版本**：v0.2  
**用途**：给 Coding Agent / Codex / 开发执行者使用的施工 PRD  
**更新重点**：将 DeerFlow 从“未来后端参考”前移为 MVP 阶段的 **Skill / ToolUse 能力层参考**。  
**核心结论**：不复用 DeerFlow UI，但从最初阶段就吸收 DeerFlow 的 Agent 架构，包括 Skill、Tool Registry、Tool Groups、Prompt Section、Tool Call Timeline、Thread / Workspace 模型。

---

## 1. 产品定义

### 1.1 产品一句话

一个面向文本任务的人机协同 Agent 应用，通过 AgentCard、结构化输入、Prompt Preview、Doc 式协作画板、AI 对话流与 ToolUse 输入栏，帮助用户完成从意图表达、内容生成到协同修改的完整文本工作流。

### 1.2 核心定位

```text
Custom UI, DeerFlow-inspired Agent capability.
```

中文：

```text
自定义 UI，借助 DeerFlow 的 Agent 能力架构。
```

### 1.3 三个参考来源的职责

```text
DeerFlow = Agent 架构 / Skill / ToolUse / Runtime 能力参考
Jasper   = Workspace / Canvas / Agent Panel / Project UI 参考
Cherry   = Chatbar / ToolUse 输入栏 / Agent-Topic 结构参考
```

### 1.4 不做什么

MVP 不做：

- 不直接复用 DeerFlow UI。
- 不完整复刻 DeerFlow runtime。
- 不接真实 Gmail / Calendar / Contacts。
- 不做完整 MCP 管理器。
- 不做复杂 Sandbox / Bash 执行。
- 不做长期记忆对实验结果的干扰。
- 不做多人协作和账号权限系统。

---

## 2. 产品目标

### 2.1 用户目标

用户可以：

1. 从 AgentCard 选择任务型 Agent，而不是从空白 Prompt 开始。
2. 通过结构化字段明确任务目标、受众、语气、长度、格式、上下文和约束。
3. 看到系统如何把 Agent Skill、结构化字段和 ToolUse 状态合成为 Prompt。
4. 在 Doc 式画板中编辑和迭代 AI 生成结果。
5. 在右侧 AI Drawer 中查看对话、工具调用、修改说明和建议追问。
6. 通过底部 AI Command Bar 持续给 Agent 发指令。
7. 根据 Agent 类型使用不同 ToolUse，例如 Web Search、Knowledge Base、Quick Messages、Clear Context。
8. 保存项目、Prompt、输出版本和上下文历史。

### 2.2 产品目标

系统需要支持：

```text
AgentCard
→ Structured Input
→ Skill Loading
→ Prompt Preview
→ ToolUse State
→ Generate
→ Doc Canvas
→ AI Drawer
→ Revision / Save
```

---

## 3. 总体架构

### 3.1 三层架构

```text
Human-AI Text Agent App
├── Product UI Layer
├── AgentCard Adapter Layer
└── DeerFlow-inspired Capability Layer
```

### 3.2 Product UI Layer

由我们自己设计和实现，参考 Jasper + Cherry，不复用 DeerFlow UI。

```text
Product UI Layer
├── Home
├── AgentCard Library
├── Direct Chat Mode
├── Layered Agent Workspace
├── Doc-style Collaborative Canvas
├── AI Conversation Drawer
├── Bottom AI Command Bar
├── Projects / Topics
└── Settings / Context
```

### 3.3 AgentCard Adapter Layer

这是本项目的核心中间层，负责把 DeerFlow 的能力结构转译成我们的产品对象。

```text
AgentCard Adapter Layer
├── AgentCard metadata
├── Structured input schema
├── Skill reference mapping
├── PromptBuilder pipeline
├── Tool permission mapper
├── Context requirement mapper
└── Output action mapper
```

### 3.4 DeerFlow-inspired Capability Layer

MVP 阶段不要求完整运行 DeerFlow backend，但必须从架构上吸收它。

```text
DeerFlow-inspired Capability Layer
├── SKILL.md
├── Skill frontmatter
├── Skill loader
├── Tool registry
├── Tool groups
├── allowed-tools policy
├── Web Search / Web Fetch abstraction
├── Tool call notice model
├── Thread / Workspace / Uploads / Outputs model
└── Future runtime adapter
```

---

## 4. DeerFlow 源码中可借鉴的结构

基于上传源码，重点可借鉴目录如下：

```text
deer-flow-main/
├── skills/public/
│   ├── deep-research/SKILL.md
│   ├── newsletter-generation/SKILL.md
│   ├── academic-paper-review/SKILL.md
│   ├── systematic-literature-review/SKILL.md
│   ├── frontend-design/SKILL.md
│   └── ...
│
├── backend/packages/harness/deerflow/
│   ├── skills/
│   │   ├── parser.py
│   │   ├── storage/local_skill_storage.py
│   │   ├── tool_policy.py
│   │   ├── validation.py
│   │   └── types.py
│   │
│   ├── agents/
│   │   ├── lead_agent/
│   │   ├── middlewares/
│   │   └── memory/
│   │
│   ├── community/
│   │   ├── ddg_search/tools.py
│   │   ├── jina_ai/tools.py
│   │   ├── tavily/tools.py
│   │   ├── serper/tools.py
│   │   └── infoquest/tools.py
│   │
│   ├── mcp/
│   ├── sandbox/
│   ├── subagents/
│   ├── tools/
│   └── runtime/
│
└── backend/app/gateway/routers/
    ├── skills.py
    ├── mcp.py
    ├── memory.py
    ├── uploads.py
    ├── thread_runs.py
    ├── runs.py
    └── suggestions.py
```

---

## 5. 信息架构

```text
Human-AI Text Agent
├── Home
│   ├── Primary Input
│   ├── Mode Entry
│   ├── Recommended AgentCards
│   └── Recent Projects / Topics
│
├── AgentCard Library
│   ├── Agent Categories
│   ├── AgentCards
│   └── Agent Detail, optional
│
├── Direct Chat Mode
│   ├── Conversation Stream
│   ├── Agent Selector
│   ├── Bottom AI Command Bar
│   └── Generated Output in Chat
│
├── Layered Agent Workspace
│   ├── Top Bar
│   ├── Left Structured Input Panel
│   ├── Center Doc-style Collaborative Canvas
│   ├── Right AI Conversation Drawer
│   └── Bottom AI Command Bar
│
├── Projects / Topics
│   ├── Project List
│   ├── Topic History
│   ├── Prompt Sessions
│   ├── Output Versions
│   └── Tool Call History
│
└── Settings / Context
    ├── API Settings
    ├── Tool Registry
    ├── Knowledge Base
    ├── Quick Messages
    ├── Default Preferences
    └── Runtime Integration, later
```

---

## 6. 双交互模式

## 6.1 Direct Chat Mode

### 目标

保留传统自由输入体验，同时通过 Agent selector 和底部 ToolUse 输入栏增强。

### 页面结构

```text
Direct Chat Mode
├── Header
│   ├── Current Agent
│   ├── Mode Switch
│   └── New Chat / Clear
│
├── Conversation Stream
│   ├── User Message
│   ├── AI Response
│   ├── Tool Use Notice
│   └── Generated Output Card
│
└── Bottom AI Command Bar
    ├── Text Input
    ├── Web Search
    ├── Quick Messages
    ├── Knowledge Base Reference
    ├── Clear Context
    └── Send Button
```

### 规则

- Direct Chat Mode 不展示完整左侧结构化表单。
- 可通过 Agent selector 切换当前 Agent。
- 可将生成结果 `Open in Workspace`，进入 Layered Agent Workspace。
- 如果用户输入明显匹配某个 Skill，可推荐对应 AgentCard，P1 实现。

---

## 6.2 Layered Agent Workspace

### 目标

核心协作模式，结合结构化控制、文档画板、AI 对话流和工具化输入栏。

### 布局

```text
┌──────────────────────────────────────────────────────────────┐
│ Top Bar                                                      │
│ Agent Name | Project Title | Mode Switch | Save | Export      │
├───────────────┬──────────────────────────┬───────────────────┤
│ Left Panel    │ Center Canvas             │ Right AI Drawer   │
│ Structured    │ Doc-style Editor          │ Conversation Flow │
│ Input Form    │ Generated / Editable Doc  │ Collapsible       │
├───────────────┴──────────────────────────┴───────────────────┤
│ Bottom AI Command Bar                                         │
│ Input + Web Search + Quick Messages + Knowledge + Clear Ctx   │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. AgentCard 规格

### 7.1 定义

AgentCard 是任务型 Agent 的 UI 入口和能力容器。

```text
AgentCard
├── Identity Prompt
├── Structured Input Schema
├── Skill Reference
├── Tool Groups
├── Tool References
├── Context Requirements
├── Prompt Preview Rules
└── Output & Revision Actions
```

### 7.2 AgentCard TypeScript Schema

```ts
export type AgentCard = {
  id: string;
  name: string;
  cardTitle: string;
  cardDescription: string;
  category: "research" | "summary" | "writing" | "email" | "editing" | "education";
  icon: string;
  color?: string;

  identityPrompt: string;

  skillRefs: string[];
  toolGroups: string[];
  toolRefs: string[];

  inputFields: AgentInputField[];

  context: {
    requiredReferences: boolean;
    acceptedContextTypes: Array<"text" | "file" | "url" | "email_thread" | "project_context" | "knowledge">;
    canUseProjectContext: boolean;
    canUseUserMemory: boolean;
  };

  output: {
    type: "draft" | "summary" | "email" | "outline" | "lesson_plan" | "revision" | "research_brief";
    defaultFormat: "markdown" | "paragraph" | "bullet_points" | "table" | "outline" | "email";
    actions: RevisionAction[];
  };
};
```

### 7.3 AgentInputField Schema

```ts
export type AgentInputField = {
  id: string;
  label: string;
  description?: string;
  type: "text" | "textarea" | "select" | "multi_select" | "radio" | "switch" | "number";
  required: boolean;
  placeholder?: string;
  options?: string[];
  defaultValue?: string | string[] | boolean | number;
  group?: "task" | "audience" | "style" | "context" | "constraint" | "tool";
};
```

---

## 8. Skill Layer 规格

## 8.1 本地目录

MVP 采用 DeerFlow-compatible Skill 文件结构。

```text
skills/
├── public/
│   ├── research-explanation/SKILL.md
│   ├── summary/SKILL.md
│   ├── report-outline/SKILL.md
│   ├── email-writing/SKILL.md
│   ├── rewrite-polish/SKILL.md
│   └── lesson-plan/SKILL.md
│
└── custom/
    └── later
```

## 8.2 SKILL.md Frontmatter

MVP 推荐格式：

```yaml
---
name: research-explanation
description: Helps users research a topic and generate clear, audience-aware explanatory text.
category: research
allowed-tools:
  - web_search
  - web_fetch
  - knowledge_base
output:
  type: explanation
  defaultFormat: markdown
---
```

正文结构：

```md
# Research Explanation

## Overview

## When to Use This Skill

## Workflow

## Best Practices

## Tool Strategy

## Output Requirements

## Failure / Clarification Rules
```

## 8.3 AgentSkill Schema

```ts
export type AgentSkill = {
  name: string;
  description: string;
  category: "public" | "custom";
  allowedTools?: string[];
  content: string;
  path: string;
  enabled: boolean;
};
```

## 8.4 skillLoader.ts

职责：

```text
loadSkill(skillName)
loadSkillsForAgent(agentCard)
parseSkillFrontmatter(markdown)
cache loaded skills
validate missing skills
return skill content for promptBuilder
```

---

## 9. Tool Registry 规格

## 9.1 设计来源

借鉴 DeerFlow 的：

```text
tool_groups
tools
allowed-tools
web_search
web_fetch
file:read
file:write
bash
mcp tools
```

## 9.2 MVP ToolDefinition Schema

```ts
export type ToolDefinition = {
  id: string;
  name: string;
  group: "web" | "knowledge" | "file:read" | "file:write" | "email" | "calendar" | "contacts" | "style" | "context";
  label: string;
  description: string;
  source: "mock" | "local" | "deerflow_compatible" | "mcp";
  riskLevel: "low" | "medium" | "high";
  enabledInMVP: boolean;
  requiresUserConfirmation: boolean;
};
```

## 9.3 P0 Tool Registry

```ts
export const toolRegistry = [
  {
    id: "web_search",
    name: "web_search",
    group: "web",
    label: "Web Search",
    source: "mock",
    riskLevel: "medium",
    enabledInMVP: true,
    requiresUserConfirmation: false
  },
  {
    id: "web_fetch",
    name: "web_fetch",
    group: "web",
    label: "Web Fetch",
    source: "mock",
    riskLevel: "medium",
    enabledInMVP: false,
    requiresUserConfirmation: false
  },
  {
    id: "knowledge_base",
    name: "knowledge_base",
    group: "knowledge",
    label: "Knowledge Base",
    source: "local",
    riskLevel: "low",
    enabledInMVP: true,
    requiresUserConfirmation: false
  },
  {
    id: "quick_messages",
    name: "quick_messages",
    group: "context",
    label: "Quick Messages",
    source: "local",
    riskLevel: "low",
    enabledInMVP: true,
    requiresUserConfirmation: false
  },
  {
    id: "clear_context",
    name: "clear_context",
    group: "context",
    label: "Clear Context",
    source: "local",
    riskLevel: "low",
    enabledInMVP: true,
    requiresUserConfirmation: true
  }
];
```

## 9.4 ToolUse 风险规则

```text
Low-risk:
- Quick Messages
- Knowledge Base sample selection
- Clear local context

Medium-risk:
- Web Search
- Web Fetch
- File Read, later
- Email Thread Read, later

High-risk:
- Send Email
- Create Calendar Event
- Write external data
```

MVP 不实现 high-risk external write actions。

---

## 10. PromptBuilder Pipeline

### 10.1 目标

PromptBuilder 负责把以下内容组合成最终 Prompt，并同时生成 Prompt Preview sections。

```text
Skill Content
+ Agent Identity
+ Structured Inputs
+ Reference Material
+ Tool State / Tool Results
+ Output Contract
```

### 10.2 Pipeline

```text
PromptBuildPipeline
├── resolveAgentCard
├── loadSkills
├── validateRequiredInputs
├── injectAgentIdentity
├── injectSkillInstruction
├── injectStructuredInputs
├── injectReferenceMaterial
├── injectToolState
├── injectToolResults, P1
├── injectOutputContract
└── buildPromptPreviewSections
```

### 10.3 Prompt Preview Sections

```ts
export type PromptPreviewSection = {
  id: string;
  title: string;
  content: string;
  source: "agent" | "skill" | "input" | "reference" | "tool" | "output";
  editable: boolean;
};
```

### 10.4 UI 展示

```text
Prompt Preview
├── Agent Role
├── Skill Instruction
├── Structured Inputs
├── Reference / Context
├── Tool State
├── Output Requirements
└── Final Prompt
```

### 10.5 同步规则

- 默认状态：Auto-generated。
- 用户手动编辑 Prompt Preview 后状态变为 Manually edited。
- 手动编辑后结构化字段继续变更时，显示“字段已更新，Prompt Preview 可能不同步”。
- 提供 Reset from fields。

---

## 11. 初始 P0 AgentCards

## 11.1 Research / Explanation Agent

```text
Skill: research-explanation
Potential DeerFlow reference: deep-research
Tools: web_search, web_fetch, knowledge_base
Output: explanation / article draft / source-aware brief
```

字段：

```text
Topic
Purpose
Audience
Depth
Tone
Length
Output format
Need web sources?
Constraints
```

## 11.2 Summary Agent

```text
Skill: summary
Potential DeerFlow reference: deep-research / report synthesis
Tools: knowledge_base, web_fetch later, file_read later
Output: summary / key points / action items
```

字段：

```text
Source text
Summary purpose
Focus
Length
Format
Include key points?
Include action items?
Include quotes?
```

## 11.3 Report Outline Agent

```text
Skill: report-outline
Potential DeerFlow reference: deep-research / consulting-analysis / newsletter-generation
Tools: web_search, knowledge_base
Output: report outline / section plan
```

字段：

```text
Report topic
Purpose
Audience
Required sections
Research depth
Output format
Constraints
```

## 11.4 Email Writing Agent

```text
Skill: email-writing
Potential DeerFlow reference: custom skill
Tools: email_thread_mock, contacts later, calendar later
Output: email draft
```

字段：

```text
Recipient
Relationship
Email goal
Key points
Tone
Urgency
Call to action
Signature
Email thread context
```

MVP 不真实发送邮件。

## 11.5 Rewrite / Polish Agent

```text
Skill: rewrite-polish
Potential DeerFlow reference: custom writing/editing skill
Tools: knowledge_base, style_guide later
Output: rewritten text / polished text / change explanation
```

字段：

```text
Original text
Rewrite goal
Target tone
Degree of change
Preserve meaning?
Simplify vocabulary?
Improve structure?
Target audience
```

---

## 12. Layered Agent Workspace 详细规格

## 12.1 Top Bar

```text
Top Bar
├── Back Home
├── Current Agent
├── Project Title
├── Mode Switch
├── Save
└── Export, P1
```

## 12.2 Left Structured Input Panel

```text
Left Panel
├── Agent Summary
│   ├── Agent name
│   ├── Skill badges
│   ├── Tool badges
│   └── Change Agent
│
├── Agent-specific Fields
├── Common Facets
├── Reference / Context
└── Prompt Preview
```

## 12.3 Center Doc Canvas

MVP 可用 textarea / markdown editable area，不强制复杂富文本。

```text
Doc Canvas
├── Document Title
├── Editable Draft
├── AI Generated Blocks
├── User Written Blocks
├── Copy / Regenerate
└── Version Snapshot, P1
```

P1 增加：

```text
Selection Toolbar
├── Rewrite
├── Polish
├── Expand
├── Shorten
├── Change Tone
└── Convert Format
```

## 12.4 Right AI Drawer

```text
AI Drawer
├── Conversation Timeline
├── Tool Use Notices
├── Tool Result Summary
├── Prompt Built Notice
├── Revision Explanation
└── Suggested Follow-ups
```

## 12.5 Bottom AI Command Bar

```text
Bottom Command Bar
├── Text Input
├── Web Search
├── Quick Messages
├── Knowledge Base
├── Clear Context
├── Context Target
└── Send
```

Context Target：

```text
Whole document
Selected text
Current section
Ask only
```

---

## 13. Projects / Topics / History

### 13.1 映射 DeerFlow Thread Data 思路

DeerFlow 有：

```text
thread user-data
├── workspace
├── uploads
└── outputs
```

我们映射为：

```text
Project
└── Topic / Session
    ├── Workspace Draft
    ├── Reference Materials
    ├── Generated Outputs
    ├── Prompt Sessions
    └── Tool Call History
```

### 13.2 MVP Storage

MVP 使用 localStorage：

```text
recentProjects
agentSessions
promptSessions
outputVersions
referenceMaterials
toolCallLogs
```

不做登录和云端数据库。

---

## 14. API 规格

## 14.1 POST /api/generate

```ts
type GenerateRequest = {
  agentId: string;
  mode: "direct_chat" | "layered_workspace";
  structuredInputs?: Record<string, unknown>;
  referenceMaterial?: string;
  userInstruction?: string;
  promptOverride?: string;
  toolState?: ToolUseState;
};

type GenerateResponse = {
  content: string;
  promptUsed: string;
  promptPreviewSections: PromptPreviewSection[];
  toolNotices: ToolUseNotice[];
  suggestions: string[];
};
```

## 14.2 POST /api/build-prompt

```ts
type BuildPromptRequest = {
  agentId: string;
  structuredInputs: Record<string, unknown>;
  referenceMaterial?: string;
  toolState?: ToolUseState;
};

type BuildPromptResponse = {
  promptPreviewSections: PromptPreviewSection[];
  finalPrompt: string;
  missingRequiredFields: string[];
};
```

## 14.3 POST /api/revise

```ts
type ReviseRequest = {
  agentId: string;
  documentContent: string;
  selectedText?: string;
  instruction: string;
  revisionAction: "rewrite" | "polish" | "expand" | "shorten" | "changeTone" | "translate" | "format";
  contextTarget: "whole_document" | "selected_text" | "current_section" | "ask_only";
};

type ReviseResponse = {
  revisedText: string;
  explanation?: string;
  replacementMode: "replace_selection" | "insert_below" | "append" | "answer_only";
};
```

## 14.4 POST /api/tool/mock-search

MVP mock web search。

```ts
type MockSearchRequest = {
  query: string;
  agentId?: string;
};

type MockSearchResponse = {
  results: {
    title: string;
    url: string;
    snippet: string;
  }[];
  notice: string;
};
```

---

## 15. 前端目录建议

```text
src/
├── app/
│   ├── App.tsx
│   ├── routes.ts
│   └── styles.css
│
├── data/
│   ├── agentCards.ts
│   ├── toolRegistry.ts
│   ├── quickMessages.ts
│   └── sampleKnowledge.ts
│
├── entities/
│   ├── agent/
│   ├── skill/
│   ├── tool/
│   ├── project/
│   ├── topic/
│   ├── document/
│   └── promptSession/
│
├── features/
│   ├── agentLibrary/
│   ├── directChat/
│   ├── layeredWorkspace/
│   ├── structuredInput/
│   ├── promptPreview/
│   ├── documentCanvas/
│   ├── conversationDrawer/
│   ├── commandBar/
│   ├── toolUse/
│   └── projectHistory/
│
└── shared/
    ├── ui/
    ├── api/
    ├── hooks/
    ├── utils/
    └── types/
```

---

## 16. 后端目录建议

```text
server/
├── index.ts
├── generation.ts
├── promptBuilder.ts
├── skillLoader.ts
├── toolRouter.ts
├── mockTools.ts
├── storage.ts
└── deerflowAdapter/
    ├── skillAdapter.ts
    ├── toolAdapter.ts
    └── runtimeAdapter.ts, P2
```

根目录：

```text
skills/
├── public/
└── custom/
```

---

## 17. 功能优先级

## 17.1 P0 必做

```text
P0
├── Home
├── AgentCard Library
├── 5 个 AgentCards
├── skills/public + SKILL.md
├── skillLoader.ts
├── toolRegistry.ts
├── PromptBuilder pipeline
├── Prompt Preview sections
├── Direct Chat Mode
├── Layered Workspace
├── Left Structured Input Panel
├── Center Editable Doc Canvas
├── Right AI Drawer
├── Bottom AI Command Bar
├── Web Search mock
├── Quick Messages
├── Knowledge Base sample
├── Clear Context
├── Generate / Copy / Regenerate
└── localStorage recent history
```

## 17.2 P1 建议

```text
P1
├── Real lightweight web_search
├── URL web_fetch
├── Tool Call Log
├── Version History
├── Selection-based Revision
├── Save Project
├── Export Markdown / TXT
├── Skill Summary / Agent Detail
├── Local Knowledge Base management
└── Quick Messages management
```

## 17.3 P2 未来扩展

```text
P2
├── Full DeerFlow runtime adapter
├── MCP tools
├── Gmail / Calendar / Contacts
├── File upload and parsing
├── Sandbox
├── Memory
├── Subagents
├── Custom Agent Builder
├── Cloud project storage
└── Collaboration
```

---

## 18. 施工步骤

### Phase 1：建立 DeerFlow-compatible 能力层

1. 新建 `skills/public`。
2. 为 5 个 AgentCard 编写 `SKILL.md`。
3. 实现 `skillLoader.ts`。
4. 实现 `toolRegistry.ts`。
5. 更新 AgentCard schema，加入 `skillRefs`、`toolGroups`、`toolRefs`。

### Phase 2：重建 PromptBuilder

1. 从 AgentCard 读取 identity。
2. 从 skillLoader 读取 Skill。
3. 注入 structured inputs。
4. 注入 reference material。
5. 注入 tool state。
6. 输出 `promptPreviewSections` 和 `finalPrompt`。

### Phase 3：实现双模式 UI

1. Home。
2. Direct Chat Mode。
3. Layered Workspace。
4. Mode switch。
5. Open in Workspace。

### Phase 4：实现三栏工作台

1. Left Structured Input Panel。
2. Center Doc Canvas。
3. Right AI Drawer。
4. Bottom Command Bar。
5. 可收起 Drawer。
6. Prompt Preview 可展开 / 折叠。

### Phase 5：实现 ToolUse mock

1. Web Search mock。
2. Quick Messages。
3. Knowledge Base picker。
4. Clear Context。
5. Tool Use Notice 写入 AI Drawer。

### Phase 6：生成与修改

1. `/api/generate`。
2. 将 output 写入 Doc Canvas。
3. AI Drawer 记录 prompt built / tool notice / agent response。
4. Copy / Regenerate。
5. P1 再做 selection revision。

### Phase 7：localStorage 历史

1. 保存最近项目。
2. 保存 prompt sessions。
3. 保存 output versions。
4. 保存 tool call logs。

---

## 19. 验收标准

### 19.1 架构验收

- AgentCard 必须绑定至少一个 Skill。
- PromptBuilder 必须读取 Skill 内容。
- ToolUse 必须来自 toolRegistry，不允许散落硬编码。
- Prompt Preview 必须分区显示。
- AgentCard 必须声明 toolGroups / toolRefs。
- Web Search 即使是 mock，也必须通过 ToolUse pipeline 触发。

### 19.2 UI 验收

- Direct Chat Mode 可用。
- Layered Workspace 可用。
- 左侧结构化输入、中心文档画板、右侧 AI Drawer、底部 Command Bar 同时存在。
- AI Drawer 可收起。
- Prompt Preview 可查看。
- 工具按钮状态可见。
- 生成结果可编辑。

### 19.3 体验验收

用户应能理解：

```text
我选择了哪个 Agent
这个 Agent 使用哪个 Skill
我填写的字段如何进入 Prompt
我启用了哪些工具
AI 生成结果如何继续修改
```

---

## 20. 当前需要继续确认的问题

1. P0 五个 AgentCard 是否最终确定为：Research / Summary / Report Outline / Email / Rewrite？
2. Lesson Plan 是否放 P1，还是替代 Report Outline？
3. Web Search 在 P0 是否只 mock，还是尝试接一个无 key 的 DuckDuckGo？
4. Doc Canvas 是否先用 markdown textarea？
5. 是否需要在 UI 上显示 Skill 原文摘要？
6. 是否保留原 A/B test 作为页面入口？
7. 是否继续沿用当前 React + Vite + Express 技术栈？
8. Prompt Preview 是否允许全量手动编辑，还是只允许编辑 Final Prompt section？

---

## 21. 最终执行原则

```text
Jasper 和 Cherry 定义交互表层。
DeerFlow 定义 Agent 能力架构。
我们的产品通过 AgentCard Adapter Layer 把二者有机连接。
```

中文：

```text
Jasper 和 Cherry 决定用户如何操作。
DeerFlow 决定 Agent 如何具备能力。
AgentCard Adapter Layer 决定二者如何结合。
```
