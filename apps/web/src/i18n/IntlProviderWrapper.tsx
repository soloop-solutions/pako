import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { IntlProvider } from "react-intl";

import { en, messages } from "@/i18n/messages";

const LANGUAGE_STORAGE_KEY = "pako.language";

function storedLanguage(): string {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "sq") return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) - fall through to default.
  }
  return "en";
}

type LocaleContextType = {
  locale: string;
  setLocale: (locale: string) => void;
};

const LocaleContext = createContext<LocaleContextType>({
  locale: "en",
  setLocale: () => {},
});

export function useLocale() {
  return useContext(LocaleContext);
}

type IntlProviderWrapperProps = {
  children: ReactNode;
};

export function IntlProviderWrapper({ children }: IntlProviderWrapperProps) {
  const [locale, setLocaleState] = useState(storedLanguage);

  const setLocale = useCallback((newLocale: string) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, newLocale);
    } catch {
      // ignore - persistence is a nice-to-have
    }
  }, []);

  const contextValue = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return (
    <LocaleContext.Provider value={contextValue}>
      <IntlProvider locale={locale} messages={messages[locale] ?? en} defaultLocale="en">
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}
