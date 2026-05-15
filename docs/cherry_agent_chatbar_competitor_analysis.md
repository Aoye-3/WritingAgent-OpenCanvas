# Cherry 竞品分析：Agent 与对话栏架构抽取

## 1. 分析目标

本次竞品分析主要关注 Cherry 在 **Agent 管理架构**、**对话输入栏能力架构** 与 **助手配置系统** 上的设计方式。分析目的不是直接复制 Cherry 的完整功能，而是抽取其中可用于本项目原型设计的信息架构与交互模式，为后续 Codex 执行原型开发提供清晰参考。

本项目原本关注的是 faceted prompt interface，即通过任务类型、目的、受众、语气、长度、输出格式、参考材料等结构化选项帮助用户构造 prompt。Cherry 的设计补充了一个重要视角：即使在传统自由输入框中，也可以通过多功能输入栏、Agent 设置、知识库引用、快捷提示词和上下文管理来增强 prompt 构造过程。

---

## 2. Cherry 的整体信息架构

Cherry 的界面采用了明显的 **助手 / 话题分离结构**。

### 2.1 一级结构

```text
首页
├── 智能体
├── 添加助手
├── 助手列表
└── 话题列表
```

### 2.2 助手与话题的区别

| 模块 | 作用 |
|---|---|
| 助手 Agent | 预设好的任务人格、工作流入口或能力容器，例如写作 Agent、主编 Agent、编辑、分镜助手等。 |
| 话题 Topic | 某个助手下产生的具体对话历史、任务线程或上下文记录。 |

这种结构让用户可以区分：

```text
我要使用哪个能力？ → 选择助手 / Agent
我要继续哪个任务？ → 选择话题 / Topic
```

### 2.3 对本项目的启发

我们当前的 faceted interface 以“任务卡片”作为入口，而 Cherry 以“Agent 列表”作为入口。二者可以结合：

```text
任务卡片 = 面向新手的结构化 Agent 入口
Agent 列表 = 面向复用和专业流程的入口
话题列表 = 面向历史任务和上下文延续的入口
```

因此，本项目可以将 task cards 理解为一种轻量化 Agent，每张任务卡片背后对应一个 prompt template 和一组结构化输入字段。

---

## 3. Agent 架构抽取

Cherry 的 Agent 不是简单的聊天窗口，而是一个可配置对象。每个 Agent 至少包含以下几个层级。

### 3.1 Agent 基础信息

包括：

- 名称
- 图标 / emoji
- 简短身份设定
- 默认模型绑定

这些信息帮助用户快速识别不同助手的用途。

### 3.2 Agent 模型设置

Cherry 的模型设置中包含：

| 设置项 | 作用 |
|---|---|
| 默认模型 | 决定该助手调用哪个模型。 |
| 模型温度 temperature | 控制生成内容的随机性和创造性。 |
| Top-P | 控制采样范围。 |
| 上下文数量 | 控制对话历史引用范围。 |
| 最大 Token 数 | 控制输出或上下文长度。 |
| 流式输出 | 控制回答是否实时显示。 |
| 工具调用方式 | 控制是否以及如何调用外部工具。 |
| 最大工具调用次数 | 限制工具调用频率。 |
| 自定义参数 | 允许高级用户进行额外配置。 |

Cherry 将 Agent 视为一个 **模型调用配置容器**。

### 3.3 对本项目的转译方式

本项目不一定需要暴露所有底层模型参数，可以将其转译为更容易理解的用户设置。

| Cherry 设置 | 本项目可转译为 |
|---|---|
| 模型温度 | 创造性：低 / 中 / 高 |
| 上下文数量 | 是否参考历史对话 |
| 最大 Token | 输出长度 |
| 工具调用方式 | 是否允许联网 / 引用材料 / 使用知识库 |
| 自定义参数 | 高级设置，可默认隐藏 |

### 3.4 Agent 提示词设置

Cherry 提供了独立的提示词设置页面，包含：

- Agent 名称
- Agent 提示词
- 保存按钮
- Token 计数

这说明 Cherry 将提示词视为 Agent 的核心配置内容。

对本项目而言，可以把任务卡片背后的 prompt template 显性化，让用户理解结构化表单如何转化成完整 prompt。

建议结构：

```text
Agent Instruction / Task Template
↓
Faceted Inputs
↓
Prompt Preview
↓
Generated Output
```

这与本项目中的 prompt preview 和 manual adjustment 功能高度一致。

---

## 4. 对话输入栏架构抽取

Cherry 的输入栏不是简单文本框，而是一个 **多功能 prompt command bar**。

### 4.1 输入栏核心能力

| 功能 | 作用 |
|---|---|
| 文本输入 | 普通 free-text prompt。 |
| 附件上传 | 上传文档、图片或参考材料。 |
| 联网搜索 | 引入外部实时信息。 |
| 知识库引用 | 使用本地或项目知识库内容。 |
| 快捷消息 / @ | 快速调用对象、上下文、助手或指令。 |
| 工具按钮 | 调用插件、MCP 或其他外部工具。 |
| 清除上下文 | 重置当前对话记忆或当前上下文。 |
| 翻译 / 语言按钮 | 快速进行语言相关操作。 |
| 发送按钮 | 提交 prompt。 |

### 4.2 关键设计特征

Cherry 的关键点在于：

> 即使用户处于自由输入模式，系统也提供了结构化能力入口。

换句话说，Cherry 并不是只依赖用户自己写 prompt，而是在输入栏周围提供了多个上下文和工具控制入口。

### 4.3 对本项目实验界定的启发

本项目不应简单比较：

```text
空白输入框 vs 表单
```

而可以更准确地界定为：

```text
Traditional Free-text Interface
= 用户主要依靠自然语言自行组织 prompt

Enhanced Faceted Interface
= 系统通过任务、目的、受众、语气、格式、参考材料、prompt preview 等结构化机制帮助用户构造 prompt
```

---

## 5. 常用短语 / Quick Prompts 架构

Cherry 提供了“常用短语”页面，虽然截图中该页面为空，但它代表一种重要机制：

> 用户可以保存和复用常用 prompt 片段。

### 5.1 可复用内容类型

常用短语可以包括：

- 常用任务模板
- 常用约束
- 常用语气
- 常用输出格式
- 常用 audience 设置
- 常用 reference instruction
- 一键填充 prompt form 的片段

### 5.2 示例短语

```text
请用适合中学生理解的语言解释。
请输出为表格。
请保持正式、学术但易懂。
请避免使用过多专业术语。
请给出分步骤说明。
请先总结，再给出例子。
```

### 5.3 对本项目的启发

在 faceted interface 中，可以将常用短语设计为 secondary feature：

```text
Quick Prompt Chips
├── Audience-related phrases
├── Tone-related phrases
├── Format-related phrases
├── Constraint-related phrases
└── Reference-related phrases
```

第一版原型不一定需要完整实现“常用短语管理”，但可以在输入栏中保留 quick prompt chips 或 preset buttons，用于降低用户构造 prompt 的成本。

---

## 6. 全局记忆架构

Cherry 的全局记忆模块包括：

- 全局记忆开关
- 已存储记忆数量
- 前往记忆页面
- 启用提示

### 6.1 Cherry 中的上下文类型

| 类型 | 说明 |
|---|---|
| 当前对话上下文 | 当前 conversation 内的内容。 |
| 全局记忆 | 跨对话、跨 Agent 的长期偏好或资料。 |
| 知识库内容 | 由用户主动添加或引用的资料。 |

### 6.2 对本项目的转译

本项目可以区分三类上下文：

| 类型 | 在本项目中的含义 |
|---|---|
| Reference material | 当前任务中用户粘贴、上传或选择的参考资料。 |
| Session context | 当前实验任务或当前页面中的上下文。 |
| User preference memory | 长期偏好，例如默认语气、语言、输出格式。 |

### 6.3 实验原型建议

为了控制实验变量，用户测试版本建议不启用复杂的长期记忆系统。

推荐策略：

```text
第一版实验原型
├── 保留 reference material
├── 保留当前 session context
└── 不启用跨任务长期记忆
```

这样可以避免记忆功能影响 A/B 测试结果。

---

## 7. 给 Codex 的实现指引

### 7.1 完整页面结构参考

```text
App
├── Sidebar
│   ├── Assistant Tab
│   ├── Topic Tab
│   ├── Add Assistant Button
│   └── Assistant List
│
├── Main Chat Area
│   ├── Header
│   │   ├── Current Assistant Name
│   │   ├── Current Model / Mode
│   │   └── Settings Button
│   │
│   ├── Message / Output Area
│   │
│   └── Chat Input Bar
│       ├── Text Input
│       ├── Attachment Button
│       ├── Web Search Toggle
│       ├── Reference Material Button
│       ├── Quick Prompt Button
│       ├── Clear Context Button
│       └── Send Button
│
└── Assistant Settings Modal
    ├── Model Settings
    ├── Prompt Settings
    ├── Knowledge Base Settings
    ├── MCP / Tool Settings
    ├── Quick Phrases
    └── Memory Settings
```

### 7.2 本项目第一版建议保留的最小结构

为了避免原型过度复杂，建议第一版只实现以下结构：

```text
App
├── Sidebar
│   ├── Task Cards / Agents
│   └── Recent Topics
│
├── Main Area
│   ├── Chat / Output Area
│   ├── Prompt Preview Area
│   └── Input Bar
│       ├── Text Input
│       ├── Reference Material Button
│       ├── Quick Prompt Button
│       ├── Clear Context Button
│       └── Generate Button
│
└── Settings Panel / Modal
    ├── Agent Name
    ├── Task Instruction
    ├── Default Tone
    ├── Default Output Format
    └── Reference Material Toggle
```

### 7.3 推荐组件拆分

```text
components/
├── Sidebar.tsx
├── AssistantList.tsx
├── TopicList.tsx
├── ChatHeader.tsx
├── ChatWindow.tsx
├── ChatInputBar.tsx
├── PromptPreview.tsx
├── ReferenceMaterialPanel.tsx
├── QuickPromptMenu.tsx
├── AssistantSettingsModal.tsx
└── MemoryNotice.tsx
```

### 7.4 推荐状态结构

```ts
type Assistant = {
  id: string;
  name: string;
  icon: string;
  instruction: string;
  defaultTone?: string;
  defaultFormat?: string;
  referenceEnabled?: boolean;
};

type Topic = {
  id: string;
  assistantId: string;
  title: string;
  messages: Message[];
};

type PromptState = {
  taskType: string;
  purpose: string;
  audience: string;
  tone: string;
  length: string;
  outputFormat: string;
  referenceMaterial: string;
  constraints: string;
  promptPreview: string;
};
```

---

## 8. 对本项目的设计启发总结

Cherry 给本项目的关键启发不是复制其完整功能，而是理解：

> 传统聊天输入框也可以被增强为一个多入口的 prompt construction surface。

因此，本项目的设计方向可以进一步明确为：

> The proposed interface does not simply replace free-text prompting with forms. Instead, it explores how structured facets, task cards, reference controls, prompt preview, and contextual action buttons can work together to support prompt construction.

中文表述：

> 本项目并非单纯用表单替代自由输入，而是探索如何通过任务卡片、结构化参数、参考材料控制、提示词预览和上下文操作按钮，共同降低用户进行提示词构造时的认知负担。

---

## 9. 可落地到本项目的功能优先级

### P0：必须实现

| 功能 | 说明 |
|---|---|
| 任务卡片 / Agent 入口 | 用户从任务类型开始，而不是直接面对空白输入框。 |
| 结构化 prompt 表单 | 包括任务、目的、受众、语气、长度、格式、参考材料、约束。 |
| Prompt Preview | 将结构化输入实时转换为完整 prompt。 |
| Free-text Chat Input | 作为传统对照组界面。 |
| Generate / Copy / Regenerate | 基础生成结果操作。 |

### P1：建议实现

| 功能 | 说明 |
|---|---|
| Quick Prompt Chips | 快速插入常用约束或语气。 |
| Reference Material Panel | 单独管理当前任务的参考资料。 |
| Clear Context Button | 允许用户清除当前上下文。 |
| Recent Topics | 保存最近任务或对话。 |

### P2：后续扩展

| 功能 | 说明 |
|---|---|
| Agent Settings Modal | 允许用户配置任务模板和默认参数。 |
| Global Memory | 长期保存用户偏好。实验版本中建议暂不启用。 |
| Knowledge Base | 引入长期资料库。 |
| Tool / MCP Settings | 高级工具调用设置。 |

---

## 10. 建议写入 proposal 的一句话

可以将以下表述加入 proposal 的 interface design 或 competitive analysis 部分：

> The competitive analysis of Cherry suggests that prompt construction is increasingly supported not only through free-text input, but also through configurable agents, contextual input bars, reusable prompt phrases, reference controls, and memory settings. This insight informs the proposed prototype, which combines task-based cards, structured facets, reference-material controls, and prompt previews to reduce cognitive load and improve users’ perceived control over generative text outputs.

中文版本：

> 对 Cherry 的竞品分析表明，提示词构造正在从单一自由输入框扩展为由可配置 Agent、上下文输入栏、可复用提示词短语、参考材料控制和记忆设置共同组成的复合交互系统。这一发现将指导本项目原型设计：通过任务卡片、结构化参数、参考材料控制和提示词预览，降低用户构造 prompt 的认知负担，并提升用户对生成结果的控制感。
