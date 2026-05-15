import { createContext, useContext, useMemo, useState } from "react";
import { translations } from "./translations";
import type { Locale, TranslationKey } from "./types";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function getStoredLocale(): Locale {
  const stored = window.localStorage.getItem("facetwrite-locale");
  return stored === "zh" ? "zh" : "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getStoredLocale);

  const value = useMemo<I18nContextValue>(() => {
    const setLocale = (nextLocale: Locale) => {
      window.localStorage.setItem("facetwrite-locale", nextLocale);
      setLocaleState(nextLocale);
    };

    return {
      locale,
      setLocale,
      t: (key) => translations[locale][key]
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}
