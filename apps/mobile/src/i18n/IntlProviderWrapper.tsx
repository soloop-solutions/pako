import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { IntlProvider } from 'react-intl';
import * as SecureStore from 'expo-secure-store';

import { messages } from './messages';
import { setCurrentLocale } from '@/api/client';

const LANGUAGE_KEY = 'pako.language';
const DEFAULT_LOCALE = 'en';

type LocaleContextValue = {
  locale: string;
  setLocale: (locale: string) => void;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
});

export function useLocale() {
  return useContext(LocaleContext);
}

export function IntlProviderWrapper({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await SecureStore.getItemAsync(LANGUAGE_KEY);
        if (stored && messages[stored]) {
          setLocaleState(stored);
          setCurrentLocale(stored);
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const setLocale = useCallback((newLocale: string) => {
    setLocaleState(newLocale);
    setCurrentLocale(newLocale);
    void SecureStore.setItemAsync(LANGUAGE_KEY, newLocale);
  }, []);

  if (!ready) {
    return null;
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <IntlProvider locale={locale} messages={messages[locale] ?? messages[DEFAULT_LOCALE]} defaultLocale={DEFAULT_LOCALE}>
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}
