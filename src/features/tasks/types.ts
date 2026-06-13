import type { Locale, TranslationKey } from "../i18n/types";

export type TaskCategory = "chat";

export type TaskValues = Record<string, string | string[]>;

export type TaskField = {
  id: string;
  kind: "text" | "textarea" | "select" | "chips" | "segmented";
  labelKey: TranslationKey;
  options?: string[];
  placeholder: Record<Locale, string>;
  required?: boolean;
};

export type TaskDefinition = {
  id: string;
  category: TaskCategory;
  accent: "blue" | "green" | "orange" | "violet" | "rose";
  icon: "bot" | "pen" | "lines" | "mail" | "book" | "report" | "refresh";
  i18nTitle: Record<Locale, string>;
  i18nDescription: Record<Locale, string>;
  defaultValues: TaskValues;
  fields: TaskField[];
};
