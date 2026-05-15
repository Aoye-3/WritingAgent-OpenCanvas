import type { TaskDefinition } from "./types";

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

const sharedFields: TaskDefinition["fields"] = [
  {
    id: "topic",
    kind: "text",
    labelKey: "workspace.topic",
    required: true,
    placeholder: { en: "Enter the subject you want to write about", zh: "输入你想生成的主题" }
  },
  {
    id: "audience",
    kind: "select",
    labelKey: "workspace.audience",
    options: ["Secondary school students", "General readers", "Teachers", "Professionals"],
    placeholder: { en: "Select the target audience", zh: "选择目标受众" }
  },
  {
    id: "tone",
    kind: "chips",
    labelKey: "workspace.tone",
    options: ["Friendly", "Formal", "Academic"],
    placeholder: { en: "Choose a tone", zh: "选择语气" }
  },
  {
    id: "language",
    kind: "select",
    labelKey: "workspace.language",
    options: ["English", "Chinese"],
    placeholder: { en: "Select output language", zh: "选择生成语言" }
  },
  {
    id: "length",
    kind: "select",
    labelKey: "workspace.length",
    options: ["300 words", "Short", "Medium", "Long"],
    placeholder: { en: "Select output length", zh: "选择输出长度" }
  },
  {
    id: "format",
    kind: "segmented",
    labelKey: "workspace.format",
    options: ["Paragraph", "Bullet points", "Outline"],
    placeholder: { en: "Choose an output format", zh: "选择输出格式" }
  },
  {
    id: "keyPoints",
    kind: "textarea",
    labelKey: "workspace.keyPoints",
    placeholder: { en: "Add the points the output should cover", zh: "输入希望覆盖的关键要点" }
  },
  {
    id: "instruction",
    kind: "textarea",
    labelKey: "workspace.instruction",
    placeholder: { en: "Add constraints, style notes, or special requirements", zh: "输入约束、风格或其他特殊要求" }
  }
];

export const taskDefinitions: TaskDefinition[] = [
  {
    id: "blog-post",
    category: "writing",
    accent: "blue",
    icon: "pen",
    i18nTitle: { en: "Blog Post", zh: "博客文章" },
    i18nDescription: {
      en: "Draft a structured article from topic, audience, tone, and references.",
      zh: "根据主题、受众、语气和参考资料生成结构化文章。"
    },
    defaultValues: emptyValues,
    fields: sharedFields
  },
  {
    id: "summary",
    category: "summarise",
    accent: "green",
    icon: "lines",
    i18nTitle: { en: "Summary", zh: "摘要总结" },
    i18nDescription: {
      en: "Condense source text into a clear output for a selected reader.",
      zh: "把来源文本压缩成适合指定读者的清晰摘要。"
    },
    defaultValues: emptyValues,
    fields: sharedFields
  },
  {
    id: "email-writer",
    category: "writing",
    accent: "orange",
    icon: "mail",
    i18nTitle: { en: "Email Writer", zh: "邮件写作" },
    i18nDescription: {
      en: "Create concise emails with purpose, recipient, message, and call to action.",
      zh: "根据目的、收件人、信息和行动请求生成简洁邮件。"
    },
    defaultValues: emptyValues,
    fields: sharedFields
  },
  {
    id: "lesson-plan",
    category: "education",
    accent: "violet",
    icon: "book",
    i18nTitle: { en: "Lesson Plan", zh: "课程计划" },
    i18nDescription: {
      en: "Build teaching materials from subject, grade level, objective, and duration.",
      zh: "根据学科、年级、目标和时长生成教学材料。"
    },
    defaultValues: emptyValues,
    fields: sharedFields
  },
  {
    id: "report-outline",
    category: "writing",
    accent: "rose",
    icon: "report",
    i18nTitle: { en: "Report Outline", zh: "报告大纲" },
    i18nDescription: {
      en: "Plan sections and detail levels for reports before writing the full draft.",
      zh: "在正式写作前规划报告结构和每部分详略。"
    },
    defaultValues: emptyValues,
    fields: sharedFields
  },
  {
    id: "rewrite-polish",
    category: "rewrite",
    accent: "blue",
    icon: "refresh",
    i18nTitle: { en: "Rewrite / Polish", zh: "改写润色" },
    i18nDescription: {
      en: "Improve existing text for clarity, tone, audience, and format constraints.",
      zh: "根据清晰度、语气、受众和格式约束改进已有文本。"
    },
    defaultValues: emptyValues,
    fields: sharedFields
  }
];
