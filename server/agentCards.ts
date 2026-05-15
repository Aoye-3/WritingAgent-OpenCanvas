import type { ToolRef } from "./tools/catalog.js";

export type LocaleText = {
  en: string;
  zh: string;
};

export type AgentCardField = {
  id: string;
  kind: "text" | "textarea" | "select" | "chips" | "segmented";
  label: LocaleText;
  options?: string[];
  placeholder: LocaleText;
  required?: boolean;
};

export type AgentCard = {
  id: string;
  category: "writing" | "education" | "summarise" | "rewrite";
  accent: "blue" | "green" | "orange" | "violet" | "rose";
  icon: "pen" | "lines" | "mail" | "book" | "report" | "refresh";
  title: LocaleText;
  description: LocaleText;
  identityPrompt: string;
  skillRefs: string[];
  toolRefs: ToolRef[];
  outputContract: {
    type: string;
    defaultFormat: string;
  };
  defaultValues: Record<string, string | string[]>;
  fields: AgentCardField[];
  settings?: AgentSettings;
};

export type AgentModelResponseMode = "normal" | "prefix_completion";

export type AgentSettings = {
  model: {
    providerId: "deepseek" | "openai" | "openai-compatible";
    model: string;
    responseMode?: AgentModelResponseMode;
    temperature: number;
    topP: number;
    contextCount: number;
    maxTokens: number;
    maxTokensEnabled: boolean;
    streaming: boolean;
    toolCallMode: "auto" | "function" | "none";
    maxToolCalls: number;
    thinkingMode?: "enabled" | "disabled";
    reasoningEffort?: "high" | "max" | "low" | "medium" | "xhigh";
  };
  prompt: {
    name: string;
    description: string;
    identityPrompt: string;
    outputType: string;
    outputFormat: string;
    skillRefs: string[];
  };
  tools: Partial<Record<ToolRef, boolean>>;
  knowledge: {
    enabled: boolean;
    scope: string;
  };
  memory: {
    enabled: boolean;
  };
  quickMessages: string[];
};

const emptyValues = {
  topic: "",
  audience: "",
  tone: "",
  language: "",
  length: "",
  format: "",
  keyPoints: "",
  instruction: ""
};

const sharedFields: AgentCardField[] = [
  {
    id: "topic",
    kind: "text",
    label: { en: "Topic", zh: "主题" },
    required: true,
    placeholder: { en: "Enter the subject you want to write about", zh: "输入你想生成的主题" }
  },
  {
    id: "audience",
    kind: "select",
    label: { en: "Audience", zh: "受众" },
    options: ["Secondary school students", "General readers", "Teachers", "Professionals"],
    placeholder: { en: "Select the target audience", zh: "选择目标受众" }
  },
  {
    id: "tone",
    kind: "chips",
    label: { en: "Tone", zh: "语气" },
    options: ["Friendly", "Formal", "Academic"],
    placeholder: { en: "Choose a tone", zh: "选择语气" }
  },
  {
    id: "language",
    kind: "select",
    label: { en: "Language", zh: "生成语言" },
    options: ["English", "Chinese"],
    placeholder: { en: "Select output language", zh: "选择生成语言" }
  },
  {
    id: "length",
    kind: "select",
    label: { en: "Length", zh: "长度" },
    options: ["300 words", "Short", "Medium", "Long"],
    placeholder: { en: "Select output length", zh: "选择输出长度" }
  },
  {
    id: "format",
    kind: "segmented",
    label: { en: "Output Format", zh: "输出格式" },
    options: ["Paragraph", "Bullet points", "Outline"],
    placeholder: { en: "Choose an output format", zh: "选择输出格式" }
  },
  {
    id: "keyPoints",
    kind: "textarea",
    label: { en: "Key Points", zh: "关键要点" },
    placeholder: { en: "Add the points the output should cover", zh: "输入希望覆盖的关键要点" }
  },
  {
    id: "instruction",
    kind: "textarea",
    label: { en: "Additional notes", zh: "补充说明" },
    placeholder: { en: "Add constraints, style notes, or special requirements", zh: "输入约束、风格或其他特殊要求" }
  }
];

export const agentCards: AgentCard[] = [
  {
    id: "blog-post",
    category: "writing",
    accent: "blue",
    icon: "pen",
    title: { en: "Blog Post", zh: "博客文章" },
    description: {
      en: "Draft a structured article from topic, audience, tone, and references.",
      zh: "根据主题、受众、语气和参考资料生成结构化文章。"
    },
    identityPrompt: "You are a writing agent that turns structured requirements into clear article drafts.",
    skillRefs: ["blog-post"],
    toolRefs: ["web_search", "knowledge_base", "quick_messages", "clear_context", "canvas_write"],
    outputContract: { type: "article", defaultFormat: "markdown" },
    defaultValues: emptyValues,
    fields: sharedFields
  },
  {
    id: "summary",
    category: "summarise",
    accent: "green",
    icon: "lines",
    title: { en: "Summary", zh: "摘要总结" },
    description: {
      en: "Condense source text into a clear output for a selected reader.",
      zh: "把来源文本压缩成适合指定读者的清晰摘要。"
    },
    identityPrompt: "You are a summarisation agent that preserves meaning while reducing cognitive load.",
    skillRefs: ["summary"],
    toolRefs: ["knowledge_base", "quick_messages", "clear_context", "canvas_write"],
    outputContract: { type: "summary", defaultFormat: "markdown" },
    defaultValues: emptyValues,
    fields: sharedFields
  },
  {
    id: "email-writer",
    category: "writing",
    accent: "orange",
    icon: "mail",
    title: { en: "Email Writer", zh: "邮件写作" },
    description: {
      en: "Create concise emails with purpose, recipient, message, and call to action.",
      zh: "根据目的、收件人、信息和行动请求生成简洁邮件。"
    },
    identityPrompt: "You are an email writing agent focused on clarity, tact, and concrete calls to action.",
    skillRefs: ["email-writer"],
    toolRefs: ["quick_messages", "clear_context", "canvas_write"],
    outputContract: { type: "email", defaultFormat: "markdown" },
    defaultValues: emptyValues,
    fields: sharedFields
  },
  {
    id: "lesson-plan",
    category: "education",
    accent: "violet",
    icon: "book",
    title: { en: "Lesson Plan", zh: "课程计划" },
    description: {
      en: "Build teaching materials from subject, grade level, objective, and duration.",
      zh: "根据学科、年级、目标和时长生成教学材料。"
    },
    identityPrompt: "You are an education agent that creates practical, classroom-ready learning materials.",
    skillRefs: ["lesson-plan"],
    toolRefs: ["web_search", "knowledge_base", "quick_messages", "clear_context", "canvas_write"],
    outputContract: { type: "lesson_plan", defaultFormat: "markdown" },
    defaultValues: emptyValues,
    fields: sharedFields
  },
  {
    id: "report-outline",
    category: "writing",
    accent: "rose",
    icon: "report",
    title: { en: "Report Outline", zh: "报告大纲" },
    description: {
      en: "Plan sections and detail levels for reports before writing the full draft.",
      zh: "在正式写作前规划报告结构和每部分详略。"
    },
    identityPrompt: "You are a planning agent that turns messy goals into useful report structures.",
    skillRefs: ["report-outline"],
    toolRefs: ["web_search", "knowledge_base", "quick_messages", "clear_context", "canvas_write"],
    outputContract: { type: "outline", defaultFormat: "markdown" },
    defaultValues: emptyValues,
    fields: sharedFields
  },
  {
    id: "rewrite-polish",
    category: "rewrite",
    accent: "blue",
    icon: "refresh",
    title: { en: "Rewrite / Polish", zh: "改写润色" },
    description: {
      en: "Improve existing text for clarity, tone, audience, and format constraints.",
      zh: "根据清晰度、语气、受众和格式约束改进已有文本。"
    },
    identityPrompt: "You are a revision agent that improves existing text without losing the user's intent.",
    skillRefs: ["rewrite-polish"],
    toolRefs: ["quick_messages", "clear_context", "canvas_write"],
    outputContract: { type: "revision", defaultFormat: "markdown" },
    defaultValues: emptyValues,
    fields: sharedFields
  }
];

export function getAgentCard(agentCardId?: string) {
  return agentCards.find((card) => card.id === agentCardId) ?? agentCards[0];
}

export function defaultAgentSettings(card: AgentCard): AgentSettings {
  return {
    model: {
      providerId: "deepseek",
      model: "",
      responseMode: "normal",
      temperature: 0.7,
      topP: 1,
      contextCount: 5,
      maxTokens: 2000,
      maxTokensEnabled: false,
      streaming: true,
      toolCallMode: "function",
      maxToolCalls: 20
    },
    prompt: {
      name: card.title.en,
      description: card.description.en,
      identityPrompt: card.identityPrompt,
      outputType: card.outputContract.type,
      outputFormat: card.outputContract.defaultFormat,
      skillRefs: [...card.skillRefs]
    },
    tools: Object.fromEntries(card.toolRefs.map((tool) => [tool, true])) as Partial<Record<ToolRef, boolean>>,
    knowledge: {
      enabled: card.toolRefs.includes("knowledge_base"),
      scope: "current_workspace"
    },
    memory: {
      enabled: false
    },
    quickMessages: [
      "Make this clearer.",
      "Shorten the current draft.",
      "Rewrite in a more professional tone."
    ]
  };
}

export function applyAgentSettings(card: AgentCard, settings: AgentSettings): AgentCard {
  const enabledTools = card.toolRefs.filter((tool) => settings.tools[tool] !== false);
  return {
    ...card,
    title: {
      ...card.title,
      en: settings.prompt.name || card.title.en
    },
    description: {
      ...card.description,
      en: settings.prompt.description || card.description.en
    },
    identityPrompt: settings.prompt.identityPrompt || card.identityPrompt,
    skillRefs: settings.prompt.skillRefs.length > 0 ? settings.prompt.skillRefs : card.skillRefs,
    toolRefs: enabledTools.length > 0 ? enabledTools : card.toolRefs,
    outputContract: {
      type: settings.prompt.outputType || card.outputContract.type,
      defaultFormat: settings.prompt.outputFormat || card.outputContract.defaultFormat
    },
    settings
  };
}
