# FacetWrite PRD

## 1. 文档信息

- 版本: v0.1
- 状态: Draft
- 负责人: Wenjie
- 产品类型: 毕设研究原型 / Web-based AI text generation prototype
- 参考材料:
  - `Doc.md`: 导师方向, Faceted Interfaces for Prompt Engineering
  - `FinalProposalWENJIE2P_Revised.docx`: 当前修订后的 proposal
  - `Jasper/`: Jasper Canvas、Agent、IQ、Project、Homepage 界面参考
  - `Khan-Homepage.png`, `Khan-Graph.png`: Khanmigo 工具卡片与任务表单参考

## 2. 背景与目标

### 2.1 背景

生成式 AI 用户经常知道自己想要什么结果, 但不一定知道如何写出完整、有效、可控的 prompt。传统 chat box 把 prompt construction 的负担完全交给用户, 容易导致认知负荷高、输出不可预测、用户控制感弱。

本项目基于导师提出的 faceted interface 方向, 设计一个面向文本生成的结构化 prompt 构建界面。产品参考 Jasper 的 Canvas 工作台和 Khanmigo 的任务卡片模式, 但目标不是复制现有产品, 而是探索结构化输入、上下文配置和输出预览如何改善 prompt engineering 的可用性。

### 2.2 产品目标

- 通过卡片式入口帮助用户快速选择文本生成任务。
- 通过左侧抽屉式结构化表单将 prompt 拆解为可选择、可填写的 facets。
- 通过底部可扩展浮动栏集中配置上下文、知识库和参考资料。
- 通过右侧输出预览区展示生成结果, 并支持用户继续调整。
- 支持与传统 free-text prompt interface 进行用户实验对比。

### 2.3 成功指标

- 用户能在不阅读额外说明的情况下完成一次文本生成任务。
- 用户能理解左侧结构化输入、底部上下文栏、右侧输出预览之间的关系。
- 实验中可记录 prompt construction time。
- 问卷可测量 usability、cognitive workload、perceived control、output predictability 和 satisfaction。
- 原型可支持至少 3 类文本生成任务的完整流程。

## 3. 范围

### 3.1 本期范围

- 首页任务卡片列表。
- 点击卡片进入 Canvas-style 文本生成工作台。
- 工作台左侧抽屉: 结构化输入表单。
- 工作台右侧/主体区域: 文本产物预览。
- 底部浮动栏: 可折叠/展开的上下文与参考资料配置。
- Prompt Preview: 根据用户选择自动生成 prompt。
- Free-text comparison interface: 传统 chat box 对照界面。
- 基础生成结果模拟或接入文本生成 API。

### 3.2 非本期范围

- 完整 RAG 检索系统。
- 多用户协作、团队权限、分享审核。
- 真实长期文件存储。
- 复杂 agent 编排。
- 图片、视频生成。
- 真实 Web Search。
- 企业级 Brand Voice 训练。

### 3.3 假设与约束

- 本项目主要用于毕业设计研究和用户实验, 原型完整度优先于商业级系统能力。
- Knowledge Base 功能采用轻量实现: 预设资料选择或用户粘贴参考资料, 作为 prompt context 注入。
- 如果 API 接入受限, 可用模拟输出完成可用性测试。
- 界面应能清楚展示 prompt construction 过程, 而不是只隐藏在后台生成。

## 4. 用户与场景

### 4.1 目标用户

- 需要使用 AI 生成文本但不熟悉 prompt engineering 的学生。
- 需要快速生成教学材料、说明文本或摘要的教育相关用户。
- 需要控制语气、受众、格式和长度的普通内容创作者。

### 4.2 核心场景

- 用户想生成一篇面向特定受众的说明文本。
- 用户希望输出符合指定语气、长度和格式。
- 用户希望 AI 参考某段资料或课程知识生成内容。
- 用户希望在生成前看到系统如何组合 prompt。
- 用户需要比较结构化 prompt interface 与传统 chat box 的体验差异。

### 4.3 用户故事

- 作为不熟悉 prompt engineering 的用户, 我希望通过选择任务卡片开始, 这样我不需要从空白聊天框开始思考。
- 作为用户, 我希望通过表单选择受众、语气、长度和格式, 这样生成结果更接近我的预期。
- 作为用户, 我希望添加参考资料, 这样 AI 输出可以基于我提供的内容。
- 作为用户, 我希望看到 prompt preview, 这样我能理解系统将如何向 AI 表达我的需求。
- 作为研究者, 我希望有一个 free-text 对照界面, 这样可以比较两种 prompt interface 的可用性差异。

## 5. 信息架构

### 5.1 页面清单

- `Home / Task Cards`
  - 文本生成任务入口。
- `Canvas Workspace`
  - 左侧结构化输入抽屉。
  - 右侧输出产物预览。
  - 底部上下文与参考资料浮动栏。
- `Prompt Preview`
  - 可作为工作台内弹层、右侧面板或底部栏 tab。
- `Free-text Comparison`
  - 传统 chat box 对照界面。

### 5.2 产品结构

```text
Home
  -> Task Card
    -> Canvas Workspace
      -> Left Structured Input Drawer
      -> Output Preview Area
      -> Floating Context Bar
      -> Prompt Preview
      -> Generate / Regenerate / Refine

Comparison Mode
  -> Free-text Prompt Interface
```

## 6. 功能需求

### 6.1 Home / Task Cards

#### 入口

- 用户进入产品后默认看到任务卡片首页。

#### 页面结构

- 顶部区域:
  - 产品名称: `FacetWrite`
  - 页面标题: `Choose a text generation task`
  - 可选搜索框: `Search tasks`
- 卡片区域:
  - 网格布局展示任务卡片。
  - 每张卡片包含 icon、任务名称、简短说明、收藏按钮。

#### 任务卡片

本期建议包含:

- `Blog Post`
- `Summary`
- `Email Writer`
- `Lesson Plan`
- `Report Outline`
- `Rewrite / Polish`

#### 操作

- 点击任务卡片后进入 `Canvas Workspace`。
- 用户可通过搜索框筛选任务卡片。
- 用户可收藏任务卡片, 收藏仅前端展示即可。

#### 空态与异常

- 搜索无结果时显示: `No matching tasks found.`
- 卡片加载失败时显示基础卡片骨架或错误提示。

#### 验收标准

- Given 用户在首页, When 点击 `Blog Post` 卡片, Then 系统进入 Blog Post 对应的 Canvas Workspace。
- Given 用户输入搜索词, When 有匹配任务, Then 仅显示匹配卡片。
- Given 用户输入无匹配搜索词, Then 显示空态提示。

### 6.2 Canvas Workspace

#### 入口

- 从任务卡片进入。

#### 页面结构

Canvas Workspace 采用三层工作台结构:

- 左侧: `Structured Input Drawer`
- 右侧/主体: `Output Preview Area`
- 底部: `Floating Context Bar`

#### 顶部功能栏

- 返回按钮: 返回任务卡片首页。
- 当前任务名称: 如 `Blog Post`
- 项目名称: 默认 `Untitled Project`
- 操作按钮:
  - `Save Draft`
  - `Reset`
  - `Comparison Mode`

#### 布局规则

- 左侧抽屉宽度建议 360-420px。
- 右侧预览区占据主要空间。
- 底部浮动栏默认收起, 悬浮于页面底部中央或底部全宽区域。
- 当底部栏展开时, 不应遮挡左侧抽屉的主要提交按钮; 如遮挡, 页面主体应向上留出安全空间。

#### 验收标准

- Given 用户进入工作台, Then 左侧显示对应任务的结构化表单, 右侧显示输出预览占位, 底部显示收起状态的上下文栏。
- Given 用户点击返回, Then 回到任务卡片首页。
- Given 用户切换 Comparison Mode, Then 进入传统 free-text 对照界面。

### 6.3 Left Structured Input Drawer

#### 功能定位

左侧抽屉用于收集文本生成任务的结构化 facets, 回答“用户想生成什么”。

#### 通用字段

所有任务都应包含:

- `Task Type`
  - 自动由用户所选卡片决定。
- `Topic`
  - 文本输入。
  - 必填。
- `Audience`
  - 下拉选择。
  - 示例: `General readers`, `Students`, `Teachers`, `Professionals`, `Children`
- `Tone`
  - 下拉或 chips。
  - 示例: `Formal`, `Friendly`, `Academic`, `Concise`, `Creative`
- `Language`
  - 下拉选择。
  - 示例: `English`, `Chinese`
- `Length`
  - 下拉选择或数字输入。
  - 示例: `Short`, `Medium`, `Long`, `300 words`
- `Output Format`
  - 下拉或 segmented control。
  - 示例: `Paragraph`, `Bullet points`, `Table`, `Outline`, `Step-by-step`
- `Custom Instructions`
  - 多行文本。
  - 可选。

#### 任务专属字段

`Blog Post`:

- `Blog topic`
- `Target audience`
- `Desired length`
- `Article outline`
- `Key points to include`
- `Custom instructions`

`Summary`:

- `Source text`
- `Summary length`
- `Summary style`
- `Key focus`

`Email Writer`:

- `Recipient`
- `Email purpose`
- `Tone`
- `Key message`
- `Call to action`

`Lesson Plan`:

- `Subject`
- `Grade level`
- `Learning objective`
- `Activity type`
- `Duration`

`Report Outline`:

- `Report topic`
- `Audience`
- `Sections required`
- `Level of detail`

`Rewrite / Polish`:

- `Original text`
- `Rewrite goal`
- `Tone`
- `Target audience`
- `Constraints`

#### 操作按钮

- `Preview Prompt`
  - 生成并显示 prompt preview。
- `Generate`
  - 根据当前 facets 和 context 生成文本。
- `Clear`
  - 清空当前任务表单。

#### 表单校验

- `Topic` 或任务核心输入为必填。
- 如果选择 `Reference Material Required`, 则底部上下文栏至少需要一条参考资料。
- 长度为数字输入时, 需大于 0。
- 必填项缺失时, `Generate` 不可用或点击后显示字段级错误。

#### 验收标准

- Given 用户未填写必填字段, When 点击 `Generate`, Then 显示必填提示。
- Given 用户填写所有必填字段, When 点击 `Preview Prompt`, Then 系统生成 prompt preview。
- Given 用户点击 `Clear`, Then 表单回到初始状态。

### 6.4 Floating Context Bar

#### 功能定位

底部浮动栏用于配置上下文和参考资料, 回答“AI 应该基于什么背景生成”。

#### 收起状态

收起时显示:

- `Context`
- `Knowledge`
- `References`
- `Prompt Preview`
- 当前选中数量, 如 `2 contexts selected`
- 展开按钮

#### 展开状态

展开后显示底部抽屉, 包含以下 tab:

- `Context`
- `Knowledge Source`
- `Reference Material`
- `Prompt Preview`

#### Context tab

字段:

- `Brand / Writing Style`
  - 示例: `Default`, `Academic`, `Friendly`, `Marketing`, `Custom`
- `Audience Profile`
  - 示例: `Secondary school students`, `Teachers`, `General readers`
- `Project Context`
  - 开关: `Use project context`

#### Knowledge Source tab

轻量知识库选择:

- `None`
- `Course Notes`
- `Product Information`
- `Brand Guide`
- `Uploaded / Pasted Reference`

说明:

- 本期不实现复杂检索。
- 被选中的知识源将作为 prompt context 注入。

#### Reference Material tab

支持:

- 粘贴参考文本。
- 添加关键词。
- 选择预设资料。
- 可视化显示已添加资料数量。

字段:

- `Reference title`
- `Reference content`
- `Keywords`

限制:

- 最多添加 5 条参考资料。
- 每条资料建议限制 2000-5000 字符, 具体上限待确认。

#### Prompt Preview tab

展示系统组合后的 prompt:

```text
Write a [length] [format] about [topic] for [audience].
Use a [tone] tone.
Use the following reference material as context: [reference].
Include: [key points].
Avoid: [constraints].
```

用户可执行:

- `Copy Prompt`
- `Edit Prompt Manually`
- `Reset to Generated Prompt`

#### 验收标准

- Given 底部栏处于收起状态, When 用户点击展开按钮, Then 显示上下文配置抽屉。
- Given 用户添加一条参考资料, Then 收起状态显示参考资料数量增加。
- Given 用户切换 Knowledge Source, Then prompt preview 中体现对应 context。
- Given 用户编辑 prompt preview, Then 点击 Generate 时使用编辑后的 prompt。

### 6.5 Output Preview Area

#### 功能定位

右侧输出预览区用于展示生成产物, 回答“生成结果是什么”。

#### 初始状态

- 显示空白文档或引导卡片。
- 文案: `Complete the structured inputs and generate your text.`

#### 生成中状态

- 显示 loading 状态。
- 禁用重复提交。

#### 成功状态

显示:

- 输出标题。
- 生成文本正文。
- 使用的 task type。
- 可选显示 `Generated from structured prompt` 标签。

#### 操作

- `Copy`
- `Regenerate`
- `Make shorter`
- `Make longer`
- `Make more formal`
- `Simplify`
- `Convert to bullet points`

#### 异常状态

- API 失败或模拟生成失败时显示:
  - `Generation failed. Please try again.`
- 用户可重试。

#### 验收标准

- Given 用户完成表单并点击 Generate, When 生成成功, Then 右侧显示文本结果。
- Given 用户点击 `Make shorter`, Then 系统基于当前输出生成更短版本或模拟展示修改结果。
- Given 生成失败, Then 显示错误提示且允许重试。

### 6.6 Free-text Comparison Interface

#### 功能定位

用于用户实验中的传统 prompt interface 对照组。

#### 页面结构

- 一个普通 chat box。
- 一个 `Generate` 按钮。
- 一个输出结果区域。
- 不提供结构化 facets。
- 不提供底部上下文栏。

#### 记录数据

- prompt construction time。
- 用户输入的原始 prompt。
- 生成结果。

#### 验收标准

- Given 用户进入 Comparison Mode, Then 页面仅显示自由文本输入和生成结果区域。
- Given 用户输入 prompt 并点击 Generate, Then 系统生成或模拟生成结果。

## 7. 状态流转

### 7.1 工作台状态

- `Idle`
  - 用户进入工作台, 尚未填写表单。
- `Editing`
  - 用户正在填写结构化输入或上下文。
- `Prompt Previewed`
  - 用户已生成 prompt preview。
- `Generating`
  - 用户点击 Generate 后等待结果。
- `Generated`
  - 右侧已有输出结果。
- `Refining`
  - 用户基于输出继续调整。
- `Error`
  - 生成失败。

### 7.2 状态规则

- 未满足必填项时不能进入 `Generating`。
- `Generating` 状态下禁止重复点击 Generate。
- `Generated` 状态下允许 regenerate 和 refine。
- 修改左侧表单或底部 context 后, prompt preview 应标记为需要更新。

## 8. 数据、埋点与实验记录

### 8.1 数据字段

- `task_type`
- `topic`
- `audience`
- `tone`
- `language`
- `length`
- `output_format`
- `custom_instructions`
- `knowledge_source`
- `reference_material_count`
- `generated_prompt`
- `manual_prompt_edited`
- `output_text`
- `interface_type`
  - `faceted`
  - `free_text`

### 8.2 实验记录

- `participant_id`
- `group`
  - `A`: free-text -> faceted
  - `B`: faceted -> free-text
- `task_start_time`
- `generate_click_time`
- `prompt_construction_time`
- `questionnaire_score_usability`
- `questionnaire_score_cognitive_load`
- `questionnaire_score_perceived_control`
- `questionnaire_score_output_predictability`
- `questionnaire_score_satisfaction`

### 8.3 埋点事件

- `task_card_clicked`
- `facet_changed`
- `context_bar_expanded`
- `reference_added`
- `prompt_preview_clicked`
- `prompt_manually_edited`
- `generate_clicked`
- `generation_completed`
- `generation_failed`
- `refine_action_clicked`
- `comparison_mode_entered`

## 9. 非功能需求

### 9.1 可用性

- 表单字段分组清晰, 不应让用户误以为所有字段都必须填写。
- 必填字段应有清晰标记。
- 生成按钮状态应明确。
- Prompt preview 应可读, 不应只显示系统变量。

### 9.2 兼容性

- 支持主流桌面浏览器。
- 本期优先桌面端, 移动端可作为后续范围。

### 9.3 性能

- 页面切换应在 1 秒内完成。
- 模拟生成应在 1-2 秒内反馈。
- API 生成应显示 loading, 避免用户误以为页面卡死。

### 9.4 可访问性

- 表单控件应有 label。
- 按钮应有明确文本。
- 颜色不能作为唯一状态提示。
- 键盘应能访问主要输入和按钮。

## 10. 验收标准总表

### 10.1 首页

- 用户可以看到至少 6 个任务卡片。
- 用户点击卡片后进入对应工作台。
- 搜索无结果时有空态。

### 10.2 工作台

- 左侧抽屉、右侧预览、底部浮动栏同时存在。
- 左侧字段随任务类型变化。
- 底部栏可以收起和展开。
- 用户可以添加参考资料。
- 用户可以生成 prompt preview。
- 用户可以生成文本输出。

### 10.3 Prompt Preview

- Prompt preview 能反映用户选择的 task、audience、tone、length、format 和 reference material。
- 用户可以复制 prompt。
- 用户可以手动编辑 prompt。

### 10.4 对照界面

- Free-text interface 不展示结构化 facets。
- 用户可以直接输入 prompt 并生成结果。
- 系统能记录 prompt construction time。

## 11. 设计与原型参考

### 11.1 参考界面

- Jasper Canvas:
  - 顶部项目栏。
  - 左侧抽屉式 agent / structured input 面板。
  - 底部可扩展功能栏。
  - 中央 canvas / 产物区域。
- Khanmigo:
  - 卡片式工具首页。
  - 点击工具后进入任务表单。

### 11.2 原创设计方向

本项目不直接复制 Jasper 或 Khanmigo, 而是形成面向 prompt engineering 研究的三层结构:

- `Task Layer`: 通过卡片选择文本生成任务。
- `Facet Layer`: 通过左侧抽屉填写结构化 prompt facets。
- `Context Layer`: 通过底部浮动栏配置上下文、知识库和参考资料。
- `Output Layer`: 通过右侧区域展示文本产物和后续 refine 操作。

### 11.3 视觉建议

- 风格: 清晰、轻量、研究原型友好, 避免过度商业化。
- 颜色: 以中性灰白为主, 蓝色作为主操作色, 少量柔和色块区分任务类型。
- 卡片: 简洁边框, 轻微 hover, 不使用过重阴影。
- 抽屉: 固定宽度, 字段分组明显, 支持滚动。
- 底部栏: 悬浮但不遮挡关键操作, 展开时像配置面板而不是聊天框。

### 11.4 反模式

- 不要把主界面做成纯聊天框。
- 不要把所有配置都塞在左侧, 否则上下文层次不清楚。
- 不要让 Knowledge Base 看起来像完整企业知识库, 本期只做轻量 context support。
- 不要隐藏 prompt preview, 否则削弱 prompt engineering 研究价值。
- 不要使用视频、图片生成作为核心任务, 避免偏离导师方向。

## 12. 依赖、风险与待确认问题

### 12.1 依赖

- 是否接入真实文本生成 API。
- 是否需要保存用户实验数据。
- 是否需要导出 questionnaire 数据。
- 是否需要支持本地文件上传。

### 12.2 风险

- 功能范围过大, 导致原型无法按时完成。
- 底部浮动栏与左侧抽屉交互复杂, 可能影响可用性。
- 用户可能不理解 `Knowledge Source` 与 `Reference Material` 的区别。
- 如果没有 prompt preview, 研究论证会变弱。
- 如果生成结果质量不稳定, 用户评价可能受到模型能力影响, 而不是界面影响。

### 12.3 待确认问题

- 最终产品名称是否使用 `FacetWrite`。
- 是否接入真实 API, 还是采用模拟生成完成实验。
- 第一版需要支持几个任务卡片: 3 个、6 个还是更多。
- 是否需要真实上传文件, 还是只支持粘贴参考资料。
- 用户实验任务是否固定为教育说明文本生成。
- Questionnaire 是否采用 SUS + NASA-TLX + 自定义 perceived control / predictability items。

